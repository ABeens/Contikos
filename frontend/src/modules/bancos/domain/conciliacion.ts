import Decimal from 'decimal.js'
import type {
  CuentaBancaria,
  MovimientoBancario,
  MovimientoEstadoCuenta,
  PartidaConciliatoria,
  ResumenConciliacion,
  SugerenciaEmparejamiento,
} from '@/shared/api/contracts/bancos'

/**
 * Conciliación bancaria (docs/06 §2.3).
 *
 * Es el flujo más valioso del módulo y el que justifica que haya dos tablas de
 * movimientos separadas: lo que la empresa registró y lo que el banco dice. La
 * conciliación es el único sitio donde se cruzan, y lo que produce es una
 * explicación de por qué los dos saldos no coinciden.
 *
 * La ecuación que tiene que cerrar:
 *
 * ```
 * saldo_banco − cheques_en_tránsito + depósitos_en_tránsito = saldo_libros
 * ```
 *
 * Los dos ajustes son movimientos que la empresa ya registró y el banco todavía
 * no procesó. Lo que el banco movió y la empresa no registró NO entra en la
 * ecuación: eso no se ajusta, se registra y se contabiliza, y por eso su
 * partida exige acción. Un módulo que dejara "ajustar" esa diferencia estaría
 * ofreciendo cuadrar la conciliación sin arreglar el mayor.
 */

/** Ventana de días de la segunda regla. Tres días cubre un fin de semana. */
export const DIAS_VENTANA = 3

/** Palabras que no distinguen nada al comparar descripciones. */
const RUIDO = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'por',
  'para',
  'con',
  'sin',
  'a',
  'y',
  'en',
  'pago',
  'cobro',
  'transferencia',
  'deposito',
  'movimiento',
])

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function palabrasSignificativas(texto: string): Set<string> {
  return new Set(
    normalizar(texto)
      .split(' ')
      .filter((p) => p.length >= 4 && !RUIDO.has(p)),
  )
}

/** Días entre dos fechas contables. Siempre positivo. */
export function diasEntre(a: string, b: string): number {
  const uno = Date.parse(`${a}T00:00:00Z`)
  const otro = Date.parse(`${b}T00:00:00Z`)
  return Math.round(Math.abs(uno - otro) / 86_400_000)
}

/** Importe con signo de una línea del banco: abono menos cargo. */
export function importeBanco(linea: MovimientoEstadoCuenta): Decimal {
  return new Decimal(linea.abono).minus(linea.cargo)
}

function mismaReferencia(
  propio: MovimientoBancario,
  linea: MovimientoEstadoCuenta,
): boolean {
  const uno = propio.referencia?.trim().toLowerCase()
  const otra = linea.referencia?.trim().toLowerCase()
  return Boolean(uno && otra && uno === otra)
}

/* ---------------------------------------------- Emparejamiento automático */

export interface OpcionesEmparejamiento {
  /** Ventana de la regla 2. Por omisión, `DIAS_VENTANA`. */
  readonly dias?: number
}

/**
 * Propone emparejamientos por reglas en cascada (docs/06 §2.3).
 *
 * Las cuatro reglas se aplican en orden, de más estricta a menos, y **cada
 * movimiento se consume en cuanto una regla lo casa**. Ese consumo es la razón
 * de la cascada: sin él, la regla del importe suelto emparejaría por su cuenta
 * un movimiento que la de la referencia ya había casado bien, y la propuesta
 * dependería del orden de la lista en vez de la calidad de la coincidencia.
 *
 * Ninguna sugerencia se aplica sola. Las tres primeras son fiables y se pueden
 * aceptar en bloque; la cuarta se marca para que alguien la mire una a una.
 */
export function sugerirEmparejamientos(
  propios: readonly MovimientoBancario[],
  banco: readonly MovimientoEstadoCuenta[],
  opciones: OpcionesEmparejamiento = {},
): SugerenciaEmparejamiento[] {
  const dias = opciones.dias ?? DIAS_VENTANA
  const sugerencias: SugerenciaEmparejamiento[] = []

  const propiosLibres = new Map(
    propios
      .filter((m) => m.estado === 'registrado')
      .map((m) => [m.id, m] as const),
  )
  const bancoLibres = new Map(
    banco.filter((l) => l.conciliacionId === null).map((l) => [l.id, l] as const),
  )

  const consumir = (idsPropios: readonly string[], idBanco: string) => {
    for (const id of idsPropios) propiosLibres.delete(id)
    bancoLibres.delete(idBanco)
  }

  /** Recorre lo que queda libre y casa lo que cumpla el criterio. */
  const aplicarRegla = (
    regla: SugerenciaEmparejamiento['regla'],
    requiereConfirmacion: boolean,
    criterio: (
      propio: MovimientoBancario,
      linea: MovimientoEstadoCuenta,
    ) => string | null,
  ) => {
    for (const linea of [...bancoLibres.values()]) {
      for (const propio of [...propiosLibres.values()]) {
        const motivo = criterio(propio, linea)
        if (motivo === null) continue
        sugerencias.push({
          regla,
          movimientosPropios: [propio.id],
          movimientoBanco: linea.id,
          diasDiferencia: diasEntre(propio.fecha, linea.fechaOperacion),
          requiereConfirmacion,
          motivo,
        })
        consumir([propio.id], linea.id)
        break
      }
    }
  }

  const mismoImporte = (
    propio: MovimientoBancario,
    linea: MovimientoEstadoCuenta,
  ) => new Decimal(propio.importe).equals(importeBanco(linea))

  // 1. Referencia exacta e importe exacto. Es la única que no se equivoca casi
  //    nunca: dos movimientos con la misma referencia y el mismo importe son el
  //    mismo movimiento.
  aplicarRegla('referencia_importe', false, (propio, linea) =>
    mismaReferencia(propio, linea) && mismoImporte(propio, linea)
      ? `Misma referencia ${propio.referencia} y mismo importe`
      : null,
  )

  // 2. Importe exacto dentro de la ventana de días. El banco procesa con
  //    retraso y el fin de semana no existe para él.
  aplicarRegla('importe_fecha', false, (propio, linea) => {
    if (!mismoImporte(propio, linea)) return null
    const distancia = diasEntre(propio.fecha, linea.fechaOperacion)
    if (distancia > dias) return null
    return distancia === 0
      ? 'Mismo importe y misma fecha'
      : `Mismo importe con ${distancia} día${distancia === 1 ? '' : 's'} de diferencia`
  })

  // 3. Importe exacto y algo en común en la descripción. Sin ventana de fechas:
  //    lo que la sostiene es el texto, no el calendario.
  aplicarRegla('importe_descripcion', false, (propio, linea) => {
    if (!mismoImporte(propio, linea)) return null
    const unas = palabrasSignificativas(propio.concepto)
    const otras = palabrasSignificativas(linea.descripcion)
    const comunes = [...unas].filter((p) => otras.has(p))
    return comunes.length > 0
      ? `Mismo importe y coincide "${comunes[0]}" en la descripción`
      : null
  })

  // 4. Varios movimientos propios sumados contra uno del banco: el depósito
  //    agrupado del día. **Es la que más falsos positivos produce** y por eso
  //    sale marcada para confirmar, nunca aplicada en silencio (docs/06 §2.3).
  for (const linea of [...bancoLibres.values()]) {
    const objetivo = importeBanco(linea)
    if (objetivo.isZero()) continue

    // Solo del mismo signo y dentro de la ventana: agrupar movimientos de
    // signos contrarios encuentra combinaciones que no significan nada.
    const candidatos = [...propiosLibres.values()]
      .filter(
        (m) =>
          new Decimal(m.importe).isNegative() === objetivo.isNegative() &&
          diasEntre(m.fecha, linea.fechaOperacion) <= dias,
      )
      .sort((a, b) => a.fecha.localeCompare(b.fecha))

    const grupo = subconjuntoQueSuma(candidatos, objetivo)
    if (!grupo) continue

    sugerencias.push({
      regla: 'agrupado',
      movimientosPropios: grupo.map((m) => m.id),
      movimientoBanco: linea.id,
      diasDiferencia: Math.max(
        ...grupo.map((m) => diasEntre(m.fecha, linea.fechaOperacion)),
      ),
      requiereConfirmacion: true,
      motivo: `${grupo.length} movimientos propios suman el importe de esta línea`,
    })
    consumir(
      grupo.map((m) => m.id),
      linea.id,
    )
  }

  return sugerencias
}

/**
 * Subconjunto de movimientos cuya suma da el importe buscado.
 *
 * Búsqueda exhaustiva acotada a grupos de dos a cuatro movimientos. El límite
 * es deliberado y no una limitación técnica: cuantos más elementos se permiten,
 * más combinaciones casan por casualidad, y una sugerencia de siete
 * movimientos que suman lo mismo es casi siempre una coincidencia aritmética y
 * no un depósito agrupado. Cuatro cubre el caso real, que es el depósito de
 * varios cheques del día.
 */
function subconjuntoQueSuma(
  candidatos: readonly MovimientoBancario[],
  objetivo: Decimal,
): MovimientoBancario[] | null {
  const maximo = Math.min(candidatos.length, 8)
  const lista = candidatos.slice(0, maximo)

  for (let tamano = 2; tamano <= Math.min(4, lista.length); tamano += 1) {
    const encontrado = buscar(lista, objetivo, tamano, 0, [])
    if (encontrado) return encontrado
  }
  return null
}

function buscar(
  lista: readonly MovimientoBancario[],
  objetivo: Decimal,
  tamano: number,
  desde: number,
  acumulado: MovimientoBancario[],
): MovimientoBancario[] | null {
  if (acumulado.length === tamano) {
    const suma = acumulado.reduce(
      (acc, m) => acc.plus(m.importe),
      new Decimal(0),
    )
    return suma.equals(objetivo) ? [...acumulado] : null
  }

  for (let i = desde; i < lista.length; i += 1) {
    acumulado.push(lista[i])
    const encontrado = buscar(lista, objetivo, tamano, i + 1, acumulado)
    acumulado.pop()
    if (encontrado) return encontrado
  }
  return null
}

/* ------------------------------------------------------ Resumen y cierre */

export interface ContextoConciliacion {
  readonly cuenta: CuentaBancaria
  readonly movimientos: readonly MovimientoBancario[]
  readonly lineasBanco: readonly MovimientoEstadoCuenta[]
  readonly fechaCorte: string
  /** El del estado de cuenta, o el que capturó quien concilia. */
  readonly saldoBanco: string | null
}

/**
 * Estado de la conciliación de una cuenta a una fecha de corte.
 *
 * Se calcula entero sobre el estado vigente y no se almacena, igual que la
 * balanza: un resumen guardado es un resumen que un día deja de coincidir con
 * los movimientos que lo explican.
 */
export function calcularConciliacion(
  contexto: ContextoConciliacion,
): ResumenConciliacion {
  const { cuenta, fechaCorte } = contexto

  const propios = contexto.movimientos.filter(
    (m) => m.cuentaBancariaId === cuenta.id && m.fecha <= fechaCorte,
  )
  const banco = contexto.lineasBanco.filter(
    (l) => l.cuentaBancariaId === cuenta.id && l.fechaOperacion <= fechaCorte,
  )

  const saldoLibros = propios.reduce(
    (acc, m) => acc.plus(m.importe),
    new Decimal(0),
  )

  const propiosSinConciliar = propios.filter((m) => m.estado === 'registrado')
  const bancoSinConciliar = banco.filter((l) => l.conciliacionId === null)

  const partidas: PartidaConciliatoria[] = []
  let chequesEnTransito = new Decimal(0)
  let depositosEnTransito = new Decimal(0)

  for (const movimiento of propiosSinConciliar) {
    const importe = new Decimal(movimiento.importe)
    const enTransito = importe.isNegative()
    if (enTransito) chequesEnTransito = chequesEnTransito.plus(importe.abs())
    else depositosEnTransito = depositosEnTransito.plus(importe)

    partidas.push({
      // La empresa ya lo registró y el banco todavía no lo procesó: es
      // informativo y se resuelve solo cuando el banco lo procese.
      tipo: enTransito ? 'cheque_transito' : 'deposito_transito',
      descripcion: movimiento.concepto,
      fecha: movimiento.fecha,
      importe: importe.toFixed(2),
      movimientoId: movimiento.id,
      exigeAccion: false,
    })
  }

  for (const linea of bancoSinConciliar) {
    const importe = importeBanco(linea)
    partidas.push({
      // El banco lo movió y la empresa no lo registró. No se ajusta: se
      // registra y se contabiliza, y hasta entonces la conciliación no cierra.
      tipo: importe.isNegative() ? 'cargo_no_registrado' : 'abono_no_registrado',
      descripcion: linea.descripcion,
      fecha: linea.fechaOperacion,
      importe: importe.toFixed(2),
      movimientoId: linea.id,
      exigeAccion: true,
    })
  }

  const saldoBanco =
    contexto.saldoBanco !== null ? new Decimal(contexto.saldoBanco) : null
  const ajustado = saldoBanco
    ? saldoBanco.minus(chequesEnTransito).plus(depositosEnTransito)
    : null
  const diferencia = ajustado ? ajustado.minus(saldoLibros) : null

  const impedimentos: string[] = []
  if (saldoBanco === null) {
    impedimentos.push(
      'Falta el saldo del estado de cuenta: importe uno o cápturelo a mano',
    )
  }
  const exigenAccion = partidas.filter((p) => p.exigeAccion)
  if (exigenAccion.length > 0) {
    impedimentos.push(
      `${exigenAccion.length} movimiento${exigenAccion.length === 1 ? '' : 's'} del banco sin registrar: hay que capturarlos y contabilizarlos`,
    )
  }
  if (diferencia && !diferencia.isZero()) {
    impedimentos.push(
      `La diferencia es ${diferencia.toFixed(2)} y tiene que ser cero`,
    )
  }

  return {
    cuentaBancariaId: cuenta.id,
    moneda: cuenta.moneda,
    fechaCorte,
    saldoBanco: saldoBanco?.toFixed(2) ?? null,
    saldoLibros: saldoLibros.toFixed(2),
    saldoBancoAjustado: ajustado?.toFixed(2) ?? null,
    diferencia: diferencia?.toFixed(2) ?? null,
    partidas,
    propiosSinConciliar,
    bancoSinConciliar,
    sugerencias: sugerirEmparejamientos(propiosSinConciliar, bancoSinConciliar),
    puedeCerrar: impedimentos.length === 0,
    impedimentos,
  }
}

export type CodigoErrorEmparejamiento =
  | 'MOVIMIENTO_NO_ENCONTRADO'
  | 'MOVIMIENTO_YA_CONCILIADO'
  | 'CUENTA_DISTINTA'
  | 'IMPORTES_NO_CUADRAN'

export interface ErrorEmparejamiento {
  readonly codigo: CodigoErrorEmparejamiento
  readonly mensaje: string
}

/**
 * Comprueba que un emparejamiento sea posible antes de aplicarlo.
 *
 * La condición que no se negocia es la última: lo que se casa tiene que sumar
 * exactamente lo mismo a los dos lados. Un emparejamiento que no cuadra no
 * concilia nada, solo esconde la diferencia en un sitio donde ya nadie la
 * busca.
 */
export function validarEmparejamiento(
  cuentaBancariaId: string,
  idsPropios: readonly string[],
  idBanco: string,
  movimientos: readonly MovimientoBancario[],
  lineasBanco: readonly MovimientoEstadoCuenta[],
): { valido: boolean; errores: readonly ErrorEmparejamiento[] } {
  const errores: ErrorEmparejamiento[] = []

  const linea = lineasBanco.find((l) => l.id === idBanco)
  if (!linea) {
    errores.push({
      codigo: 'MOVIMIENTO_NO_ENCONTRADO',
      mensaje: 'La línea del estado de cuenta no existe',
    })
  } else if (linea.conciliacionId !== null) {
    errores.push({
      codigo: 'MOVIMIENTO_YA_CONCILIADO',
      mensaje: 'Esa línea del estado de cuenta ya está conciliada',
    })
  } else if (linea.cuentaBancariaId !== cuentaBancariaId) {
    errores.push({
      codigo: 'CUENTA_DISTINTA',
      mensaje: 'La línea del estado de cuenta es de otra cuenta bancaria',
    })
  }

  const propios: MovimientoBancario[] = []
  for (const id of idsPropios) {
    const movimiento = movimientos.find((m) => m.id === id)
    if (!movimiento) {
      errores.push({
        codigo: 'MOVIMIENTO_NO_ENCONTRADO',
        mensaje: `El movimiento ${id} no existe`,
      })
      continue
    }
    if (movimiento.estado === 'conciliado') {
      errores.push({
        codigo: 'MOVIMIENTO_YA_CONCILIADO',
        mensaje: `El movimiento ${id} ya está conciliado`,
      })
    }
    if (movimiento.cuentaBancariaId !== cuentaBancariaId) {
      errores.push({
        codigo: 'CUENTA_DISTINTA',
        mensaje: `El movimiento ${id} es de otra cuenta bancaria`,
      })
    }
    propios.push(movimiento)
  }

  if (linea && propios.length > 0 && errores.length === 0) {
    const suma = propios.reduce((acc, m) => acc.plus(m.importe), new Decimal(0))
    if (!suma.equals(importeBanco(linea))) {
      errores.push({
        codigo: 'IMPORTES_NO_CUADRAN',
        mensaje: `Lo seleccionado suma ${suma.toFixed(2)} y la línea del banco es ${importeBanco(linea).toFixed(2)}`,
      })
    }
  }

  return { valido: errores.length === 0, errores }
}

/** Consecutivo del identificador de conciliación. */
export function siguienteIdConciliacion(
  existentes: readonly { id: string }[],
): string {
  const mayor = existentes.reduce((acc, c) => {
    const numero = Number(c.id.replace(/\D/g, ''))
    return Number.isNaN(numero) ? acc : Math.max(acc, numero)
  }, 0)
  return `con-${String(mayor + 1).padStart(4, '0')}`
}
