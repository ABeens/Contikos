import Decimal from 'decimal.js'
import { Money, type Moneda } from '@/shared/money/money'
import type { Libro } from '@/shared/api/contracts/comunes'
import type {
  Asiento,
  Cuenta,
  Periodo,
  SolicitudAsiento,
  SolicitudReversa,
} from '@/shared/api/contracts/conta'
import {
  etiquetaLibro,
  lineaAfecta,
  librosAfectados,
  librosDe,
  tratamientoUniforme,
} from '@/shared/asiento/libro'

/**
 * Validación del asiento — docs/02-contrato-asientos.md §3.
 *
 * Estas mismas reglas las aplica el backend. Aquí se replican para dar
 * retroalimentación inmediata durante la captura, NO para sustituirlas: el
 * servidor nunca confía en el cliente.
 *
 * El handler de MSW también usa esta función, para que el mock rechace lo
 * mismo que rechazará la API real. Un mock permisivo produce una UI que solo
 * funciona con datos perfectos.
 *
 * Un asiento alimenta los dos libros (fiscal y corporativo) y **cada libro
 * cuadra por separado**. Cuadrar el asiento "en total" no significaría nada:
 * las líneas que solo tocan un libro no tienen contrapartida en el otro.
 */

export type CodigoErrorAsiento =
  | 'ASIENTO_DESCUADRADO'
  | 'ASIENTO_INSUFICIENTE'
  | 'LINEA_INVALIDA'
  | 'IMPORTE_NEGATIVO'
  | 'CUENTA_INVALIDA'
  | 'CUENTA_CONTROL'
  | 'PERIODO_CERRADO'
  | 'AUXILIAR_REQUERIDO'
  | 'TIPO_CAMBIO_INVALIDO'
  | 'CONCEPTO_REQUERIDO'
  | 'LIBRO_REQUERIDO'

export interface ErrorAsiento {
  readonly codigo: CodigoErrorAsiento
  readonly mensaje: string
  /** Índice de la línea afectada, si el error es de línea. */
  readonly linea?: number
  /** Libro afectado, si el error es de un libro concreto. */
  readonly libro?: Libro
}

export interface ContextoValidacion {
  readonly cuentas: readonly Cuenta[]
  readonly periodos: readonly Periodo[]
  /** true si el asiento es de captura manual: no puede tocar cuentas de control. */
  readonly esManual?: boolean
}

/** Totales de un libro. Cada libro cuadra por su cuenta. */
export interface ResumenLibro {
  readonly libro: Libro
  readonly totalCargos: Money
  readonly totalAbonos: Money
  readonly diferencia: Money
}

export interface ResultadoAsiento {
  readonly valido: boolean
  readonly errores: readonly ErrorAsiento[]
  /** Un resumen por cada libro que el asiento mueve. */
  readonly totales: readonly ResumenLibro[]
}

interface LineaImportes {
  cargo?: string
  abono?: string
  libros?: readonly Libro[] | null
}

function importe(valor: string | undefined, moneda: Moneda): Money {
  if (!valor || valor.trim() === '') return Money.cero(moneda)
  try {
    return new Money(new Decimal(valor), moneda)
  } catch {
    return Money.cero(moneda)
  }
}

/**
 * Totales de un conjunto de líneas.
 *
 * Con `libro`, solo suma las líneas que mueven ese libro. Sin `libro`, suma
 * todas.
 */
export function totalesDe(
  lineas: readonly LineaImportes[],
  moneda: Moneda,
  libro?: Libro,
): { totalCargos: Money; totalAbonos: Money; diferencia: Money } {
  const propias = libro ? lineas.filter((l) => lineaAfecta(l, libro)) : lineas
  const totalCargos = propias
    .reduce((acc, l) => acc.plus(importe(l.cargo, moneda)), Money.cero(moneda))
    .redondear()
  const totalAbonos = propias
    .reduce((acc, l) => acc.plus(importe(l.abono, moneda)), Money.cero(moneda))
    .redondear()
  return { totalCargos, totalAbonos, diferencia: totalCargos.minus(totalAbonos) }
}

/** Un resumen por libro afectado, en orden fiscal → corporativo. */
export function totalesPorLibro(
  lineas: readonly LineaImportes[],
  moneda: Moneda,
): ResumenLibro[] {
  return librosAfectados(lineas).map((libro) => ({
    libro,
    ...totalesDe(lineas, moneda, libro),
  }))
}

export function resumenDe(
  totales: readonly ResumenLibro[],
  libro: Libro,
): ResumenLibro | undefined {
  return totales.find((t) => t.libro === libro)
}

export function periodoDeFecha(
  fecha: string,
  periodos: readonly Periodo[],
): Periodo | undefined {
  return periodos.find((p) => fecha >= p.fechaInicio && fecha <= p.fechaFin)
}

/**
 * Ejercicio al que pertenece una fecha.
 *
 * Lo decide el periodo, no el año de la fecha: son lo mismo en Costa Rica
 * (docs/13 §1) pero un ejercicio irregular (una empresa que arranca en
 * octubre) los separaría. Sin periodo que la contenga se cae al año, que es lo
 * único que queda; el asiento igual no se contabiliza, porque `validarAsiento`
 * rechaza la fecha.
 */
export function ejercicioDeFecha(
  fecha: string,
  periodos: readonly Periodo[],
): number {
  return periodoDeFecha(fecha, periodos)?.ejercicio ?? Number(fecha.slice(0, 4))
}

/**
 * Consecutivo del siguiente asiento de un ejercicio (docs/03 §3).
 *
 * Único por ejercicio y sin huecos: arranca en 1 cada ejercicio y sigue donde
 * se quedó el mayor número ya emitido en ese ejercicio. Se deriva del mayor
 * número y no de contar filas: contar volvería a asignar un número usado en
 * cuanto el libro cambie de tamaño por cualquier otro motivo.
 */
export function siguienteNumero(
  asientos: readonly Pick<Asiento, 'ejercicio' | 'numero'>[],
  ejercicio: number,
): number {
  return (
    asientos
      .filter((a) => a.ejercicio === ejercicio)
      .reduce((mayor, a) => Math.max(mayor, a.numero), 0) + 1
  )
}

/**
 * Comprueba que un número no esté ya tomado en su ejercicio.
 *
 * Es la validación defensiva que el backend hará con un índice único. Aquí no
 * debería fallar nunca si se usa `siguienteNumero`; existe para que un mock
 * con dos pestañas abiertas no numere dos asientos igual sin que nadie se
 * entere.
 */
export function numeroDisponible(
  asientos: readonly Pick<Asiento, 'ejercicio' | 'numero'>[],
  ejercicio: number,
  numero: number,
): boolean {
  return !asientos.some((a) => a.ejercicio === ejercicio && a.numero === numero)
}

/* ------------------------------------------------ Reversas (docs/02 §6) */

export type CodigoErrorReversa =
  | CodigoErrorAsiento
  | 'ASIENTO_YA_REVERSADO'
  | 'REVERSA_NO_REVERSABLE'
  | 'MOTIVO_REQUERIDO'

export interface ErrorReversa {
  readonly codigo: CodigoErrorReversa
  readonly mensaje: string
}

export interface ResultadoReversa {
  readonly valido: boolean
  readonly errores: readonly ErrorReversa[]
}

/** Concepto con el que nace la reversa. Nombra al original por su código. */
export function conceptoReversa(asiento: Asiento, motivo: string): string {
  return `Reversa del asiento ${asiento.codigo}: ${motivo.trim()}`
}

/**
 * La solicitud de asiento que neutraliza a otro.
 *
 * Mismas líneas con cargos y abonos invertidos. Se conserva TODO lo demás de
 * cada línea: los libros (una línea que solo entró en la corporativa se
 * reversa solo en la corporativa, o el fiscal queda descuadrado), el auxiliar
 * (el saldo del cliente tiene que volver a donde estaba) y el centro de costo.
 *
 * El origen se deriva del original (`tipo = "reversa"`, `id = asiento_id`): es
 * lo que hace idempotente la operación por la misma llave que todo lo demás
 * (docs/02 §4) y lo que permite encontrar la reversa desde el original.
 *
 * Es una función pura: no mira periodos ni estado. De eso se ocupa
 * `validarReversa`, y separarlos es lo que permite previsualizar las líneas
 * invertidas antes de confirmar.
 */
export function construirReversa(
  asiento: Asiento,
  solicitud: SolicitudReversa,
): SolicitudAsiento {
  return {
    fecha: solicitud.fecha,
    concepto: conceptoReversa(asiento, solicitud.motivo),
    moneda: asiento.moneda,
    tipoCambio: asiento.tipoCambio,
    origen: { modulo: 'conta', tipo: 'reversa', id: asiento.id },
    lineas: asiento.lineas.map((linea) => ({
      cuenta: linea.cuentaCodigo,
      cargo: linea.abono,
      abono: linea.cargo,
      concepto: linea.concepto,
      libros: [...linea.libros],
      centroCosto: linea.centroCosto,
      auxiliarTipo: linea.auxiliarTipo,
      auxiliarId: linea.auxiliarId,
    })),
  }
}

/**
 * Reglas de la reversa (docs/02 §6), más las del asiento que produce.
 *
 * - Un asiento se reversa UNA vez.
 * - Una reversa no se reversa: para deshacer una reversa se vuelve a capturar
 *   el asiento correcto. Reversar la reversa dejaría una cadena de tres
 *   asientos que dicen lo mismo que uno.
 * - La fecha cae en periodo abierto. Si el del original ya cerró, la reversa
 *   va en el periodo abierto actual; no se reabre nada para corregir.
 *
 * Las reglas del asiento (cuadre, cuentas vigentes...) las aplica
 * `validarAsiento` sobre la solicitud construida, con `esManual: false`: la
 * reversa mueve las mismas cuentas de control que movió el original, y eso es
 * exactamente lo que tiene que hacer.
 */
export function validarReversa(
  asiento: Asiento,
  solicitud: SolicitudReversa,
  contexto: ContextoValidacion,
): ResultadoReversa {
  const errores: ErrorReversa[] = []

  if (asiento.reversaDeId !== null) {
    errores.push({
      codigo: 'REVERSA_NO_REVERSABLE',
      mensaje: `${asiento.codigo} ya es una reversa; para deshacerla capture el asiento correcto`,
    })
  }

  if (asiento.estado === 'reversado') {
    errores.push({
      codigo: 'ASIENTO_YA_REVERSADO',
      mensaje: `${asiento.codigo} ya fue reversado y un asiento solo se reversa una vez`,
    })
  }

  if (solicitud.motivo.trim() === '') {
    errores.push({
      codigo: 'MOTIVO_REQUERIDO',
      mensaje: 'El motivo de la reversa es obligatorio',
    })
  }

  // Con los tres anteriores no hay reversa que validar: los errores del
  // asiento construido serían ruido sobre una operación que no procede.
  if (errores.length > 0) return { valido: false, errores }

  const resultado = validarAsiento(construirReversa(asiento, solicitud), {
    ...contexto,
    esManual: false,
  })
  for (const error of resultado.errores) {
    errores.push({ codigo: error.codigo, mensaje: error.mensaje })
  }

  return { valido: errores.length === 0, errores }
}

export function validarAsiento(
  solicitud: SolicitudAsiento,
  contexto: ContextoValidacion,
): ResultadoAsiento {
  const errores: ErrorAsiento[] = []
  const moneda = solicitud.moneda
  const totales = totalesPorLibro(solicitud.lineas, moneda)
  const libros = totales.map((t) => t.libro)
  /**
   * Si todas las líneas van a los mismos libros, los dos mayores reciben lo
   * mismo: un solo mensaje, sin nombrar libro. Duplicar cada error una vez por
   * contabilidad haría creer que hay dos problemas donde hay uno.
   */
  const uniforme = tratamientoUniforme(solicitud.lineas)

  // 2 — al menos dos líneas
  if (solicitud.lineas.length < 2) {
    errores.push({
      codigo: 'ASIENTO_INSUFICIENTE',
      mensaje: 'El asiento requiere al menos dos líneas',
    })
  } else if (!uniforme) {
    // ...y al menos dos en cada libro que se mueve: un libro con una sola
    // línea no puede cuadrar, y el descuadre solo no diría por qué.
    for (const libro of libros) {
      const cuantas = solicitud.lineas.filter((l) =>
        lineaAfecta(l, libro),
      ).length
      if (cuantas < 2) {
        errores.push({
          codigo: 'ASIENTO_INSUFICIENTE',
          mensaje: `La contabilidad ${etiquetaLibro(libro).toLowerCase()} recibe ${cuantas} línea; requiere al menos dos`,
          libro,
        })
      }
    }
  }

  if (solicitud.concepto.trim() === '') {
    errores.push({
      codigo: 'CONCEPTO_REQUERIDO',
      mensaje: 'El concepto es obligatorio',
    })
  }

  // 10 — tipo de cambio
  let tc: Decimal
  try {
    tc = new Decimal(solicitud.tipoCambio)
  } catch {
    tc = new Decimal(0)
  }
  if (tc.lessThanOrEqualTo(0)) {
    errores.push({
      codigo: 'TIPO_CAMBIO_INVALIDO',
      mensaje: 'El tipo de cambio debe ser mayor que cero',
    })
  }

  // 7 — periodo abierto
  const periodo = periodoDeFecha(solicitud.fecha, contexto.periodos)
  if (!periodo) {
    errores.push({
      codigo: 'PERIODO_CERRADO',
      mensaje: `No existe un periodo contable que contenga la fecha ${solicitud.fecha}`,
    })
  } else if (periodo.estado !== 'abierto') {
    errores.push({
      codigo: 'PERIODO_CERRADO',
      mensaje: `El periodo ${periodo.numero}/${periodo.ejercicio} está ${periodo.estado}`,
    })
  }

  const porCodigo = new Map(contexto.cuentas.map((c) => [c.codigo, c]))

  solicitud.lineas.forEach((linea, indice) => {
    const cargo = importe(linea.cargo, moneda)
    const abono = importe(linea.abono, moneda)

    // 11: la línea va a algún libro. Omitir el campo son ambos; vaciarlo, no.
    if (librosDe(linea).length === 0) {
      errores.push({
        codigo: 'LIBRO_REQUERIDO',
        mensaje: 'La línea debe afectar al menos un libro',
        linea: indice,
      })
    }

    // 4 — sin importes negativos
    if (cargo.esNegativo() || abono.esNegativo()) {
      errores.push({
        codigo: 'IMPORTE_NEGATIVO',
        mensaje: 'Los importes no pueden ser negativos; invierta cargo y abono',
        linea: indice,
      })
    }

    // 3 — cargo o abono, no ambos, no ninguno
    const tieneCargo = cargo.esPositivo()
    const tieneAbono = abono.esPositivo()
    if (tieneCargo && tieneAbono) {
      errores.push({
        codigo: 'LINEA_INVALIDA',
        mensaje: 'Una línea no puede tener cargo y abono a la vez',
        linea: indice,
      })
    } else if (!tieneCargo && !tieneAbono) {
      errores.push({
        codigo: 'LINEA_INVALIDA',
        mensaje: 'La línea debe tener un cargo o un abono',
        linea: indice,
      })
    }

    // 5 y 6 — cuenta válida, activa y de detalle
    const cuenta = porCodigo.get(linea.cuenta)
    if (!linea.cuenta || !cuenta) {
      errores.push({
        codigo: 'CUENTA_INVALIDA',
        mensaje: linea.cuenta
          ? `La cuenta ${linea.cuenta} no existe`
          : 'Falta la cuenta contable',
        linea: indice,
      })
    } else {
      if (!cuenta.activa) {
        errores.push({
          codigo: 'CUENTA_INVALIDA',
          mensaje: `La cuenta ${cuenta.codigo} está inactiva`,
          linea: indice,
        })
      }
      if (!cuenta.esDetalle) {
        errores.push({
          codigo: 'CUENTA_INVALIDA',
          mensaje: `${cuenta.codigo} es una cuenta acumulativa; solo las de detalle reciben movimientos`,
          linea: indice,
        })
      }
      // docs/03 §2 — las cuentas de control solo las mueve su módulo dueño
      if (cuenta.esCuentaControl && contexto.esManual) {
        errores.push({
          codigo: 'CUENTA_CONTROL',
          mensaje: `${cuenta.codigo} es cuenta de control de ${cuenta.moduloDueno}; no se puede mover desde un asiento manual`,
          linea: indice,
        })
      }
      // 8 — auxiliar obligatorio
      if (cuenta.requiereAuxiliar && !linea.auxiliarId) {
        errores.push({
          codigo: 'AUXILIAR_REQUERIDO',
          mensaje: `${cuenta.codigo} exige auxiliar de tipo ${cuenta.requiereAuxiliar}`,
          linea: indice,
        })
      }
    }
  })

  // 1 — el cuadre, libro por libro. Sin tolerancia: o cuadra exacto, o se
  // rechaza. Un libro descuadrado invalida el asiento entero: no se contabiliza
  // "la mitad buena" dejando el otro libro roto.
  for (const resumen of uniforme ? totales.slice(0, 1) : totales) {
    if (resumen.diferencia.esCero()) continue
    errores.push({
      codigo: 'ASIENTO_DESCUADRADO',
      mensaje: uniforme
        ? `El asiento no cuadra: diferencia de ${resumen.diferencia.toApi()}`
        : `La contabilidad ${etiquetaLibro(resumen.libro).toLowerCase()} no cuadra: diferencia de ${resumen.diferencia.toApi()}`,
      libro: resumen.libro,
    })
  }

  return {
    valido: errores.length === 0,
    errores,
    totales,
  }
}
