import Decimal from 'decimal.js'
import { Money, type Moneda } from '@/shared/money/money'
import { nombreMes } from '@/shared/format/fecha'
import type {
  Cuenta,
  LineaSolicitud,
  Periodo,
  SolicitudAsiento,
} from '@/shared/api/contracts/conta'
import type {
  CorridaDiferidos,
  Diferido,
  FilaAmortizacion,
  LineaCorridaDiferidos,
  SolicitudDiferido,
  TipoDiferido,
  Verificacion,
} from '@/shared/api/contracts/diferidos'
import { cuentaPorCodigo } from '@/shared/cuentas/cuenta'

/**
 * Reglas de los asientos diferidos (docs/15).
 *
 * Todo lo que hay aquí es puro: recibe las fichas, el catálogo de cuentas y el
 * periodo, y devuelve la corrida con sus verificaciones y el asiento que la
 * contabilizaría. Quien escribe (el mock hoy, el backend mañana) llama a esto
 * dos veces con los mismos datos, una para previsualizar y otra para
 * contabilizar, y por construcción obtiene lo mismo. Que lo que se revisó sea
 * lo que se contabiliza es la "verificación previa" del requerimiento, la
 * misma que aplica la corrida de depreciación (docs/07 §3.2).
 */

/**
 * Módulo con el que se firma el asiento de la corrida.
 *
 * Debería ser `diferidos`, pero `ModuloSchema` (docs/02, `contracts/comunes`)
 * enumera los siete módulos del diagrama y los diferidos no son uno de ellos:
 * son un proceso de cierre del propio libro mayor, sin auxiliar que conciliar
 * contra él. Se firma como `conta`, que es donde vive el proceso, y el `tipo`
 * distingue la operación dentro del módulo. El día que el diagrama admita un
 * módulo nuevo, esto es lo único que cambia.
 */
export const MODULO_ORIGEN = 'conta' as const

/** Tipo de origen de la corrida mensual. Con el periodo forma la terna. */
export const TIPO_ORIGEN_AMORTIZACION = 'amortizacion_diferidos'

/** Tipo de origen del reconocimiento de golpe al cancelar (docs/15 §3.4). */
export const TIPO_ORIGEN_CANCELACION = 'cancelacion_diferido'

export type CodigoErrorDiferido =
  | 'DESCRIPCION_REQUERIDA'
  | 'MONTO_INVALIDO'
  | 'PLAZO_INVALIDO'
  | 'CUENTA_DIFERIDO_INVALIDA'
  | 'CUENTA_DESTINO_INVALIDA'
  | 'AUXILIAR_REQUERIDO'
  | 'FECHA_INICIO_INVALIDA'
  | 'DIFERIDO_CON_AMORTIZACIONES'
  | 'DIFERIDO_NO_VIGENTE'
  | 'PERIODO_CERRADO'

export interface ErrorDiferido {
  readonly codigo: CodigoErrorDiferido
  readonly mensaje: string
}

export interface ResultadoDiferido {
  readonly valido: boolean
  readonly errores: readonly ErrorDiferido[]
}

export interface ContextoDiferido {
  readonly cuentas: readonly Cuenta[]
  readonly periodos: readonly Periodo[]
}

export type CodigoVerificacion =
  | 'PERIODO_NO_ABIERTO'
  | 'CORRIDA_YA_CONTABILIZADA'
  | 'CUENTA_INVALIDA'
  | 'MONEDA_DISTINTA'
  | 'DIFERIDO_SE_AGOTA'
  | 'CUOTA_CERO'
  | 'CORRIDA_VACIA'
  | 'PERIODO_ANTERIOR_SIN_CORRIDA'

export interface ContextoCorrida {
  /** Todos los periodos del ejercicio, para ubicar el anterior. */
  readonly periodos: readonly Periodo[]
  /** Corridas ya en el mayor: id del periodo → id del asiento. */
  readonly corridasContabilizadas: ReadonlyMap<string, string>
  /** Catálogo vigente: la corrida verifica las cuentas antes de escribir. */
  readonly cuentas: readonly Cuenta[]
}

/* --------------------------------------------------------------- Cuotas */

/**
 * Cuota nominal: el monto repartido a partes iguales entre los meses del plazo.
 *
 * Es la que se guarda en la ficha como referencia. La que se contabiliza sale
 * de `cuotaDe`, que además cierra el remanente en el último mes.
 */
export function cuotaNominal(
  monto: string,
  plazoMeses: number,
  moneda: Moneda,
): Money {
  if (plazoMeses < 1) return Money.cero(moneda)
  return new Money(
    new Decimal(monto).dividedBy(plazoMeses).toDecimalPlaces(2),
    moneda,
  )
}

/**
 * Número de cuota que representa el periodo para el diferido: 1 el mes en que
 * empieza a amortizarse, `plazoMeses` el último.
 *
 * Convención de mes completo, la misma que la depreciación (docs/07 §3.2): una
 * póliza que arranca el 15 de enero reconoce enero entero. Repartir el primer
 * mes a prorrata obligaría a repartir también el último, y el plazo dejaría de
 * ser el número de cuotas.
 */
export function mesDeAmortizacion(
  fechaInicio: string,
  periodo: Pick<Periodo, 'ejercicio' | 'numero'>,
): number {
  const anio = Number(fechaInicio.slice(0, 4))
  const mes = Number(fechaInicio.slice(5, 7))
  return (periodo.ejercicio - anio) * 12 + (periodo.numero - mes) + 1
}

/**
 * Cuota del mes número `mes` del plazo.
 *
 * Nunca amortiza más de lo que queda, y **la última cuota se lleva el remanente
 * entero** para que el saldo cierre exacto en cero. Es la regla que garantiza
 * "hasta agotar el monto" y la misma que aplica la depreciación contra el valor
 * residual (docs/07 §3.2): con la cuota nominal a secas, un monto que no es
 * divisible entre el plazo deja céntimos por amortizar para siempre.
 *
 * El número de cuota sale del calendario (`mesDeAmortizacion`) y no del número
 * de corridas ya hechas: si un mes se saltó, la del último mes del plazo cierra
 * todo lo que quedaba en vez de dejar el diferido vivo más allá de su plazo.
 */
export function cuotaDe(
  diferido: Pick<
    Diferido,
    'monto' | 'plazoMeses' | 'saldoPorAmortizar' | 'moneda'
  >,
  mes: number,
  moneda: Moneda = diferido.moneda,
): Money {
  const saldo = new Decimal(diferido.saldoPorAmortizar)
  if (saldo.lessThanOrEqualTo(0)) return Money.cero(moneda)
  if (mes >= diferido.plazoMeses) return new Money(saldo, moneda)

  const bruta = cuotaNominal(diferido.monto, diferido.plazoMeses, moneda).monto
  return new Money(Decimal.min(bruta, saldo), moneda)
}

/**
 * Último día del mes `desplazamiento` posterior al de `fechaInicio`.
 *
 * La cuota se reconoce al cierre del mes, no el día del aniversario: el
 * asiento de la corrida lleva la fecha de fin de periodo.
 */
function finDeMes(fechaInicio: string, desplazamiento: number): string {
  const anio = Number(fechaInicio.slice(0, 4))
  const mes = Number(fechaInicio.slice(5, 7))
  // El día 0 del mes siguiente es el último del mes buscado.
  const fecha = new Date(Date.UTC(anio, mes + desplazamiento, 0))
  return fecha.toISOString().slice(0, 10)
}

/**
 * Tabla de amortización proyectada.
 *
 * Se enseña antes de guardar (docs/15 §3.1) y no se almacena: es la
 * comprobación de que el plan cierra exacto en cero, cuota a cuota.
 */
export function tablaAmortizacion(
  datos: Pick<SolicitudDiferido, 'monto' | 'plazoMeses' | 'fechaInicio' | 'moneda'>,
): FilaAmortizacion[] {
  const total = new Decimal(datos.monto)
  if (total.lessThanOrEqualTo(0) || datos.plazoMeses < 1) return []

  const bruta = cuotaNominal(datos.monto, datos.plazoMeses, datos.moneda).monto
  const filas: FilaAmortizacion[] = []
  let acumulado = new Decimal(0)

  for (let i = 0; i < datos.plazoMeses; i += 1) {
    const remanente = total.minus(acumulado)
    // La última se lleva el remanente entero: es donde se ve que el plan cierra
    // exacto en cero aunque el monto no sea divisible entre el plazo.
    const cuota =
      i === datos.plazoMeses - 1 ? remanente : Decimal.min(bruta, remanente)
    acumulado = acumulado.plus(cuota)
    filas.push({
      numero: i + 1,
      fecha: finDeMes(datos.fechaInicio, i),
      cuota: new Money(cuota, datos.moneda).toApi(),
      acumulado: new Money(acumulado, datos.moneda).toApi(),
      saldo: new Money(total.minus(acumulado), datos.moneda).toApi(),
    })
  }

  return filas
}

/* ------------------------------------------------------------- Validación */

/** Tipos de cuenta que puede tener el saldo por amortizar, según el diferido. */
const TIPO_CUENTA_BALANCE: Record<TipoDiferido, 'activo' | 'pasivo'> = {
  gasto: 'activo',
  ingreso: 'pasivo',
}

/**
 * Tipos de cuenta admitidos en resultados.
 *
 * Un gasto diferido puede reconocerse en costo y no en gasto (el seguro de la
 * planta forma parte del costo de producción): las dos son cuentas de
 * resultados deudoras y el mapeo lo decide quien conoce el hecho económico.
 */
const TIPOS_CUENTA_RESULTADOS: Record<TipoDiferido, readonly string[]> = {
  gasto: ['gasto', 'costo'],
  ingreso: ['ingreso'],
}

function periodoDe(
  fecha: string,
  periodos: readonly Periodo[],
): Periodo | undefined {
  return periodos.find((p) => fecha >= p.fechaInicio && fecha <= p.fechaFin)
}

/**
 * Comprueba una de las dos cuentas del mapeo del diferido.
 *
 * Además de existir y admitir movimientos, cada una tiene que ser del papel que
 * le toca: sin eso, el reconocimiento periódico movería el resultado contra
 * una cuenta que no representa lo que falta por consumir, y el saldo diferido
 * dejaría de explicarse (docs/15 §5).
 */
function validarCuenta(
  codigo: string,
  papel: {
    etiqueta: string
    error: CodigoErrorDiferido
    tipos: readonly string[]
    exigencia: string
  },
  cuentas: readonly Cuenta[],
  errores: ErrorDiferido[],
): Cuenta | undefined {
  if (!codigo.trim()) {
    errores.push({
      codigo: papel.error,
      mensaje: `Indique la cuenta de ${papel.etiqueta}`,
    })
    return undefined
  }

  const cuenta = cuentaPorCodigo(cuentas, codigo)
  if (!cuenta) {
    errores.push({
      codigo: papel.error,
      mensaje: `La cuenta ${codigo} no existe en el catálogo`,
    })
    return undefined
  }
  if (!cuenta.esDetalle || !cuenta.activa) {
    errores.push({
      codigo: papel.error,
      mensaje: `La cuenta ${codigo} de ${papel.etiqueta} no admite movimientos`,
    })
    return cuenta
  }
  if (!papel.tipos.includes(cuenta.tipo)) {
    errores.push({
      codigo: papel.error,
      mensaje: `${codigo} ${cuenta.nombre} no sirve como cuenta de ${papel.etiqueta}: ${papel.exigencia}`,
    })
  }
  return cuenta
}

/**
 * Reglas del alta y la edición de un diferido (docs/15 §3.1).
 *
 * Las dos cuentas son el contrato con el mayor: la de balance guarda lo que
 * falta por consumir y la de resultados recibe lo consumido. Con un mapeo malo
 * no se rompe la pantalla, se rompe el estado de resultados y nadie lo nota
 * hasta el cierre.
 */
export function validarDiferido(
  solicitud: SolicitudDiferido,
  contexto: ContextoDiferido,
): ResultadoDiferido {
  const errores: ErrorDiferido[] = []

  if (!solicitud.descripcion.trim()) {
    errores.push({
      codigo: 'DESCRIPCION_REQUERIDA',
      mensaje: 'El diferido requiere una descripción',
    })
  }

  const monto = decimalDe(solicitud.monto)
  if (!monto || monto.lessThanOrEqualTo(0)) {
    errores.push({
      codigo: 'MONTO_INVALIDO',
      mensaje: 'El monto del diferido debe ser mayor que cero',
    })
  }

  if (!Number.isInteger(solicitud.plazoMeses) || solicitud.plazoMeses < 1) {
    errores.push({
      codigo: 'PLAZO_INVALIDO',
      mensaje: 'El plazo debe ser de al menos un mes',
    })
  }

  const balance = TIPO_CUENTA_BALANCE[solicitud.tipo]
  const cuentaDiferido = validarCuenta(
    solicitud.cuentaDiferido,
    {
      etiqueta: 'balance del diferido',
      error: 'CUENTA_DIFERIDO_INVALIDA',
      tipos: [balance],
      exigencia:
        solicitud.tipo === 'gasto'
          ? 'un gasto pagado por adelantado descansa en una cuenta de activo'
          : 'un ingreso cobrado por adelantado descansa en una cuenta de pasivo',
    },
    contexto.cuentas,
    errores,
  )

  validarCuenta(
    solicitud.cuentaDestino,
    {
      etiqueta: 'resultados',
      error: 'CUENTA_DESTINO_INVALIDA',
      tipos: TIPOS_CUENTA_RESULTADOS[solicitud.tipo],
      exigencia:
        solicitud.tipo === 'gasto'
          ? 'tiene que ser una cuenta de gasto o de costo'
          : 'tiene que ser una cuenta de ingreso',
    },
    contexto.cuentas,
    errores,
  )

  // La cuenta puede exigir auxiliar (Anticipos a proveedores lleva proveedor,
  // Anticipos de clientes lleva cliente). Sin tercero, el asiento de la corrida
  // se rechazaría cada mes: es mejor decirlo al dar de alta.
  if (cuentaDiferido?.requiereAuxiliar) {
    const exigido = cuentaDiferido.requiereAuxiliar
    if (!solicitud.tercero) {
      errores.push({
        codigo: 'AUXILIAR_REQUERIDO',
        mensaje: `${cuentaDiferido.codigo} exige auxiliar de tipo ${exigido}: indique el tercero del diferido`,
      })
    } else if (solicitud.tercero.tipo !== exigido) {
      errores.push({
        codigo: 'AUXILIAR_REQUERIDO',
        mensaje: `${cuentaDiferido.codigo} exige auxiliar de tipo ${exigido} y el tercero indicado es un ${solicitud.tercero.tipo}`,
      })
    }
  }

  // No se exige que el periodo esté abierto: el alta no contabiliza nada
  // (docs/15 §3.1). Lo que sí se exige es que la fecha caiga dentro del
  // calendario contable, porque de ahí sale el primer mes de la corrida.
  if (!periodoDe(solicitud.fechaInicio, contexto.periodos)) {
    errores.push({
      codigo: 'FECHA_INICIO_INVALIDA',
      mensaje: `No existe un periodo contable que contenga la fecha ${solicitud.fechaInicio}`,
    })
  }

  return { valido: errores.length === 0, errores }
}

/** `Decimal` del texto, o `undefined` si no es un número. */
function decimalDe(valor: string): Decimal | undefined {
  try {
    const numero = new Decimal(valor)
    return numero.isFinite() ? numero : undefined
  } catch {
    return undefined
  }
}

/* ----------------------------------------------------------- La corrida */

export function conceptoCorrida(periodo: Periodo): string {
  return `Amortización de diferidos ${nombreMes(periodo.numero).toLowerCase()} ${periodo.ejercicio}`
}

/** El periodo inmediatamente anterior dentro del catálogo, si existe. */
function periodoAnterior(
  periodo: Periodo,
  periodos: readonly Periodo[],
): Periodo | undefined {
  return periodos.find(
    (p) =>
      (p.ejercicio === periodo.ejercicio && p.numero === periodo.numero - 1) ||
      (periodo.numero === 1 &&
        p.ejercicio === periodo.ejercicio - 1 &&
        p.numero === 12),
  )
}

function etiquetaPeriodo(periodo: Periodo): string {
  return `${nombreMes(periodo.numero)} ${periodo.ejercicio}`
}

/** La cuenta sirve para lo que el diferido necesita de ella. */
function cuentaUtilizable(
  cuenta: Cuenta | undefined,
  tipos: readonly string[],
): boolean {
  return Boolean(
    cuenta && cuenta.esDetalle && cuenta.activa && tipos.includes(cuenta.tipo),
  )
}

/**
 * Calcula la corrida del periodo con su verificación previa (docs/15 §3.2).
 *
 * Selección: solo diferidos `vigente`, con fecha de inicio dentro o antes del
 * periodo, y con saldo por amortizar. La cuota nunca pasa del saldo y la
 * última cierra el remanente exacto.
 */
export function calcularCorrida(
  diferidos: readonly Diferido[],
  periodo: Periodo,
  moneda: Moneda,
  contexto: ContextoCorrida,
): CorridaDiferidos {
  const generales: Verificacion[] = []

  if (periodo.estado !== 'abierto') {
    generales.push({
      codigo: 'PERIODO_NO_ABIERTO',
      severidad: 'error',
      mensaje: `El periodo ${etiquetaPeriodo(periodo)} está ${periodo.estado}: no admite asientos`,
    })
  }

  const asientoExistente = contexto.corridasContabilizadas.get(periodo.id)
  if (asientoExistente) {
    generales.push({
      codigo: 'CORRIDA_YA_CONTABILIZADA',
      severidad: 'error',
      mensaje: `La amortización de ${etiquetaPeriodo(periodo)} ya está contabilizada en el asiento ${asientoExistente}`,
    })
  }

  // Aviso, no error: la corrida de un mes no depende técnicamente de la del
  // anterior, pero saltarse un mes deja el saldo diferido alto y nadie lo nota
  // hasta el cierre. Se calla cuando no hay ninguna corrida anterior en el
  // mayor: esa es la primera y no tiene con qué compararse.
  const anterior = periodoAnterior(periodo, contexto.periodos)
  if (
    anterior &&
    contexto.corridasContabilizadas.size > 0 &&
    !contexto.corridasContabilizadas.has(anterior.id)
  ) {
    generales.push({
      codigo: 'PERIODO_ANTERIOR_SIN_CORRIDA',
      severidad: 'aviso',
      mensaje: `${etiquetaPeriodo(anterior)} no tiene corrida de amortización contabilizada`,
    })
  }

  const lineas: LineaCorridaDiferidos[] = []
  const porDiferido: Verificacion[] = []

  const candidatos = [...diferidos]
    .filter((d) => d.estado === 'vigente')
    .sort((a, b) => a.codigo.localeCompare(b.codigo))

  for (const diferido of candidatos) {
    if (diferido.fechaInicio > periodo.fechaFin) continue

    if (diferido.moneda !== moneda) {
      porDiferido.push({
        codigo: 'MONEDA_DISTINTA',
        severidad: 'aviso',
        mensaje: `${diferido.codigo} ${diferido.descripcion} está en ${diferido.moneda} y la corrida se contabiliza en ${moneda}: se omite`,
        diferidoId: diferido.id,
      })
      continue
    }

    const saldo = new Decimal(diferido.saldoPorAmortizar)
    if (saldo.lessThanOrEqualTo(0)) {
      porDiferido.push({
        codigo: 'CUOTA_CERO',
        severidad: 'aviso',
        mensaje: `${diferido.codigo} ${diferido.descripcion} ya no tiene nada por amortizar: se omite`,
        diferidoId: diferido.id,
      })
      continue
    }

    // Las cuentas se comprueban aquí y no solo al dar de alta: entre el alta y
    // la corrida alguien pudo desactivar la cuenta o cambiarla de tipo, y el
    // asiento se rechazaría a medio contabilizar.
    const balance = cuentaPorCodigo(contexto.cuentas, diferido.cuentaDiferido)
    const destino = cuentaPorCodigo(contexto.cuentas, diferido.cuentaDestino)
    const errorCuenta =
      !cuentaUtilizable(balance, [TIPO_CUENTA_BALANCE[diferido.tipo]]) ||
      !cuentaUtilizable(destino, TIPOS_CUENTA_RESULTADOS[diferido.tipo])

    if (errorCuenta) {
      porDiferido.push({
        codigo: 'CUENTA_INVALIDA',
        severidad: 'error',
        mensaje: `${diferido.codigo} ${diferido.descripcion} apunta a una cuenta que ya no sirve para amortizarlo (${diferido.cuentaDiferido} / ${diferido.cuentaDestino})`,
        diferidoId: diferido.id,
      })
      continue
    }

    const mes = mesDeAmortizacion(diferido.fechaInicio, periodo)
    const cuota = cuotaDe(diferido, mes, moneda).monto
    if (cuota.lessThanOrEqualTo(0)) {
      porDiferido.push({
        codigo: 'CUOTA_CERO',
        severidad: 'aviso',
        mensaje: `${diferido.codigo} ${diferido.descripcion} produce cuota cero este mes: se omite`,
        diferidoId: diferido.id,
      })
      continue
    }

    const amortizadoResultante = new Decimal(diferido.montoAmortizado).plus(cuota)
    const saldoResultante = saldo.minus(cuota)
    const ultimaCuota = saldoResultante.lessThanOrEqualTo(0)
    const verificaciones: Verificacion[] = []

    if (ultimaCuota) {
      verificaciones.push({
        codigo: 'DIFERIDO_SE_AGOTA',
        severidad: 'aviso',
        mensaje: `${diferido.codigo} ${diferido.descripcion} se agota con esta cuota: el saldo por amortizar queda en cero`,
        diferidoId: diferido.id,
      })
    }

    lineas.push({
      diferidoId: diferido.id,
      codigo: diferido.codigo,
      descripcion: diferido.descripcion,
      tipo: diferido.tipo,
      cuentaDiferido: diferido.cuentaDiferido,
      cuentaDestino: diferido.cuentaDestino,
      saldoInicial: new Money(saldo, moneda).toApi(),
      cuota: new Money(cuota, moneda).toApi(),
      montoAmortizadoResultante: new Money(amortizadoResultante, moneda).toApi(),
      saldoResultante: new Money(saldoResultante, moneda).toApi(),
      ultimaCuota,
      verificaciones,
    })
    porDiferido.push(...verificaciones)
  }

  if (lineas.length === 0) {
    generales.push({
      codigo: 'CORRIDA_VACIA',
      severidad: 'aviso',
      mensaje: `Ningún diferido se amortiza en ${etiquetaPeriodo(periodo)}`,
    })
  }

  const verificaciones = [...generales, ...porDiferido]
  const totalDe = (tipo: TipoDiferido) =>
    sumar(
      lineas.filter((l) => l.tipo === tipo).map((l) => l.cuota),
      moneda,
    )

  return {
    periodoId: periodo.id,
    moneda,
    lineas,
    totalGasto: totalDe('gasto'),
    totalIngreso: totalDe('ingreso'),
    verificaciones,
    puedeContabilizar:
      lineas.length > 0 && !verificaciones.some((v) => v.severidad === 'error'),
  }
}

/**
 * Asiento de la corrida (docs/15 §5): uno solo, agrupado por par de cuentas.
 *
 * Gasto diferido:
 *
 *   Cuenta de resultados (destino)        cargo
 *   Cuenta de balance (diferido)                  abono
 *
 * Ingreso diferido, al revés:
 *
 *   Cuenta de balance (diferido)          cargo
 *   Cuenta de resultados (destino)                abono
 *
 * El lado de resultados se agrupa por par de cuentas, como la depreciación
 * agrupa el gasto por categoría; el lado de balance va detallado por diferido,
 * porque es donde vive el auxiliar y donde alguien tendrá que explicar el saldo
 * renglón por renglón.
 */
export function armarAsientoCorrida(
  corrida: CorridaDiferidos,
  diferidos: readonly Diferido[],
  periodo: Periodo,
  moneda: Moneda,
): SolicitudAsiento {
  const lineas: LineaSolicitud[] = []

  /**
   * Renglón de balance, uno por diferido.
   *
   * La descripción sale de la ficha vigente y no de la que la línea copió al
   * calcular: si alguien la editó entre la previsualización y la
   * contabilización, el mayor debe decir la vigente. El auxiliar también,
   * porque es la ficha la que lo lleva.
   */
  const renglonBalance = (
    linea: LineaCorridaDiferidos,
    lado: 'cargo' | 'abono',
  ): LineaSolicitud => {
    const ficha = diferidos.find((d) => d.id === linea.diferidoId)
    return {
      cuenta: linea.cuentaDiferido,
      concepto: `${linea.codigo} ${ficha?.descripcion ?? linea.descripcion}`,
      cargo: lado === 'cargo' ? linea.cuota : '0',
      abono: lado === 'abono' ? linea.cuota : '0',
      ...(ficha?.tercero
        ? { auxiliarTipo: ficha.tercero.tipo, auxiliarId: ficha.tercero.id }
        : {}),
    }
  }

  const renglonResultados = (
    cuenta: string,
    tipo: TipoDiferido,
    total: string,
  ): LineaSolicitud => ({
    cuenta,
    concepto:
      tipo === 'gasto'
        ? 'Amortización de gastos diferidos'
        : 'Reconocimiento de ingresos diferidos',
    cargo: tipo === 'gasto' ? total : '0',
    abono: tipo === 'gasto' ? '0' : total,
  })

  // Agrupar por par de cuentas: dos pólizas que se reconocen en la misma cuenta
  // de gasto contra la misma cuenta de balance comparten el renglón de
  // resultados. El de balance nunca se agrupa, porque es donde vive el auxiliar
  // y donde alguien tendrá que explicar el saldo renglón por renglón.
  const pares = [
    ...new Set(
      corrida.lineas.map(
        (l) => `${l.tipo}|${l.cuentaDestino}|${l.cuentaDiferido}`,
      ),
    ),
  ]

  for (const par of pares) {
    const delGrupo = corrida.lineas.filter(
      (l) => `${l.tipo}|${l.cuentaDestino}|${l.cuentaDiferido}` === par,
    )
    const { tipo, cuentaDestino } = delGrupo[0]
    const total = sumar(
      delGrupo.map((l) => l.cuota),
      moneda,
    )

    if (tipo === 'gasto') {
      lineas.push(renglonResultados(cuentaDestino, tipo, total))
      for (const linea of delGrupo) lineas.push(renglonBalance(linea, 'abono'))
    } else {
      for (const linea of delGrupo) lineas.push(renglonBalance(linea, 'cargo'))
      lineas.push(renglonResultados(cuentaDestino, tipo, total))
    }
  }

  return {
    fecha: periodo.fechaFin,
    concepto: conceptoCorrida(periodo),
    moneda,
    tipoCambio: '1',
    origen: {
      modulo: MODULO_ORIGEN,
      tipo: TIPO_ORIGEN_AMORTIZACION,
      id: periodo.id,
    },
    lineas,
  }
}

/**
 * Asiento del reconocimiento de golpe al cancelar (docs/15 §3.4).
 *
 * Es la corrida de un solo diferido por todo lo que le quedaba: un seguro
 * cancelado a mitad de año ya no protege nada, así que lo que descansaba en el
 * balance dejó de ser un activo y pasa entero a resultados. Un ingreso
 * diferido cancelado sigue el camino simétrico: la obligación de prestar el
 * servicio se extinguió y el pasivo se reconoce como ingreso.
 */
export function armarAsientoCancelacion(
  diferido: Diferido,
  fecha: string,
  moneda: Moneda,
): SolicitudAsiento {
  const saldo = new Money(diferido.saldoPorAmortizar, moneda).toApi()
  const auxiliar = diferido.tercero
    ? { auxiliarTipo: diferido.tercero.tipo, auxiliarId: diferido.tercero.id }
    : {}

  const balance: LineaSolicitud = {
    cuenta: diferido.cuentaDiferido,
    concepto: `${diferido.codigo} ${diferido.descripcion}`,
    cargo: diferido.tipo === 'ingreso' ? saldo : '0',
    abono: diferido.tipo === 'gasto' ? saldo : '0',
    ...auxiliar,
  }
  const resultados: LineaSolicitud = {
    cuenta: diferido.cuentaDestino,
    concepto: `Cancelación de ${diferido.codigo}: se reconoce el saldo remanente`,
    cargo: diferido.tipo === 'gasto' ? saldo : '0',
    abono: diferido.tipo === 'ingreso' ? saldo : '0',
  }

  return {
    fecha,
    concepto: `Cancelación de diferido ${diferido.codigo}`,
    moneda,
    tipoCambio: '1',
    origen: {
      modulo: MODULO_ORIGEN,
      tipo: TIPO_ORIGEN_CANCELACION,
      id: diferido.id,
    },
    lineas:
      diferido.tipo === 'gasto' ? [resultados, balance] : [balance, resultados],
  }
}

/**
 * Reglas de la cancelación.
 *
 * Solo se cancela lo que sigue vigente, y la fecha tiene que caer en un
 * periodo abierto porque el reconocimiento del remanente sí genera asiento.
 */
export function validarCancelacion(
  diferido: Diferido,
  fecha: string,
  periodos: readonly Periodo[],
): ResultadoDiferido {
  const errores: ErrorDiferido[] = []

  if (diferido.estado !== 'vigente') {
    errores.push({
      codigo: 'DIFERIDO_NO_VIGENTE',
      mensaje: `${diferido.codigo} está ${diferido.estado}: ya no se puede cancelar`,
    })
  }

  const periodo = periodoDe(fecha, periodos)
  if (!periodo) {
    errores.push({
      codigo: 'PERIODO_CERRADO',
      mensaje: `No existe un periodo contable que contenga la fecha ${fecha}`,
    })
  } else if (
    periodo.estado !== 'abierto' &&
    new Decimal(diferido.saldoPorAmortizar).greaterThan(0)
  ) {
    errores.push({
      codigo: 'PERIODO_CERRADO',
      mensaje: `El periodo ${etiquetaPeriodo(periodo)} está ${periodo.estado} y la cancelación reconoce el saldo remanente`,
    })
  }

  return { valido: errores.length === 0, errores }
}

/** Un diferido con cuotas contabilizadas ya no se edita (docs/15 §3.3). */
export function validarEdicion(diferido: Diferido): ResultadoDiferido {
  const errores: ErrorDiferido[] = []

  if (diferido.amortizaciones.length > 0) {
    errores.push({
      codigo: 'DIFERIDO_CON_AMORTIZACIONES',
      mensaje: `${diferido.codigo} tiene ${diferido.amortizaciones.length} cuota${diferido.amortizaciones.length === 1 ? '' : 's'} contabilizada${diferido.amortizaciones.length === 1 ? '' : 's'}: cambiar el monto o el plazo dejaría el mayor contando otra cosa`,
    })
  }
  if (diferido.estado !== 'vigente') {
    errores.push({
      codigo: 'DIFERIDO_NO_VIGENTE',
      mensaje: `${diferido.codigo} está ${diferido.estado}: ya no se edita`,
    })
  }

  return { valido: errores.length === 0, errores }
}

function sumar(importes: readonly string[], moneda: Moneda): string {
  return new Money(
    importes.reduce((acc, i) => acc.plus(new Decimal(i)), new Decimal(0)),
    moneda,
  ).toApi()
}
