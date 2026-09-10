import Decimal from 'decimal.js'
import { Money, type Moneda } from '@/shared/money/money'
import type {
  LineaSolicitud,
  Periodo,
  SolicitudAsiento,
} from '@/shared/api/contracts/conta'
import type {
  CorridaRevaluacion,
  CuentaBancaria,
  LineaRevaluacion,
  MapeoBancos,
} from '@/shared/api/contracts/bancos'
import { MODULO_ORIGEN } from './movimiento'

/**
 * Revaluación de saldos en moneda extranjera al cierre (docs/06 §6).
 *
 * Una cuenta en dólares tiene dos saldos que dicen lo mismo de dos maneras: los
 * dólares que hay, que no cambian solos, y lo que valen en colones, que cambia
 * todos los días. El mayor lleva el segundo, y al cierre hay que ponerlo al
 * tipo de cambio de esa fecha.
 *
 * La diferencia va a resultado cambiario **no realizado**: nadie vendió esos
 * dólares, solo valen otra cosa. Es exactamente lo contrario de la diferencia
 * de un cobro o un pago, que sí es realizada porque el dinero se movió.
 *
 * El punto delicado, y por eso el saldo funcional llega de fuera: lo que se
 * revalúa es lo que dice EL MAYOR, no lo que diga esta ficha. Calcular la
 * diferencia contra un saldo propio produciría un asiento que deja la cuenta
 * de control en un valor que su auxiliar no explica, que es justamente lo que
 * la verificación de integridad de docs/06 §4 existe para detectar.
 */

export const TIPO_ORIGEN_REVALUACION = 'revaluacion'

/** Identificador de la corrida. Con el periodo forma la terna de origen. */
export function origenRevaluacion(periodoId: string): string {
  return `rev-${periodoId.replace(/^per-/, '')}`
}

export interface ContextoRevaluacion {
  /** Solo las activas: una cuenta cerrada no se revalúa. */
  readonly cuentasBancarias: readonly CuentaBancaria[]
  /**
   * Saldo que el mayor lleva de cada cuenta bancaria, en funcional, a la fecha
   * de cierre. Lo calcula quien tiene el libro delante.
   */
  readonly saldoFuncionalPorCuenta: ReadonlyMap<string, string>
  /** Tipo de cambio de cierre por moneda. Sin entrada, la cuenta se salta. */
  readonly tipoCambioPorMoneda: ReadonlyMap<string, string>
  readonly monedaFuncional: Moneda
  readonly mapeo: MapeoBancos
}

/**
 * Calcula la revaluación de un periodo.
 *
 * Solo entran las cuentas en moneda distinta de la funcional: revaluar una
 * cuenta en colones contra el colón es multiplicar por uno.
 */
export function calcularRevaluacion(
  periodo: Periodo,
  contexto: ContextoRevaluacion,
): CorridaRevaluacion {
  const funcional = contexto.monedaFuncional
  const lineas: LineaRevaluacion[] = []

  for (const cuenta of contexto.cuentasBancarias) {
    if (!cuenta.activa) continue
    if (cuenta.moneda === funcional) continue

    const tipoCambio = contexto.tipoCambioPorMoneda.get(cuenta.moneda)
    // Sin tipo de cambio de cierre no se inventa uno: la cuenta se queda fuera
    // y quien revisa la corrida ve que falta.
    if (!tipoCambio) continue

    const saldoMoneda = new Decimal(cuenta.saldoLibros)
    const actual = new Decimal(
      contexto.saldoFuncionalPorCuenta.get(cuenta.id) ?? '0',
    )
    const revaluado = new Money(
      saldoMoneda.times(tipoCambio),
      funcional,
    ).redondear()

    lineas.push({
      cuentaBancariaId: cuenta.id,
      codigo: cuenta.codigo,
      nombre: cuenta.nombre,
      cuentaContable: cuenta.cuentaContable,
      moneda: cuenta.moneda,
      saldoMoneda: saldoMoneda.toFixed(2),
      tipoCambio,
      saldoFuncionalActual: actual.toFixed(2),
      saldoFuncionalRevaluado: revaluado.toApi(),
      diferencia: revaluado.monto.minus(actual).toFixed(2),
    })
  }

  const total = lineas.reduce(
    (acc, l) => acc.plus(l.diferencia),
    new Decimal(0),
  )

  return {
    periodoId: periodo.id,
    fecha: periodo.fechaFin,
    moneda: funcional,
    lineas,
    total: total.toFixed(2),
    hayQueContabilizar: lineas.some((l) => !new Decimal(l.diferencia).isZero()),
  }
}

/**
 * Asiento de la revaluación (docs/06 §5 y §6).
 *
 * Una línea por cuenta con diferencia, contra la cuenta de resultado cambiario
 * que corresponda al signo. No se agrupan las cuentas en una sola línea a
 * propósito: cada saldo se revalúa por su cuenta y el mayor tiene que poder
 * decir cuánto le tocó a cada una.
 *
 * Devuelve `null` cuando no hay nada que revaluar, que es el caso normal de una
 * empresa sin cuentas en moneda extranjera. Un asiento vacío no se emite.
 */
export function armarAsientoRevaluacion(
  corrida: CorridaRevaluacion,
  mapeo: MapeoBancos,
): SolicitudAsiento | null {
  const lineas: LineaSolicitud[] = []
  let ganancia = new Decimal(0)
  let perdida = new Decimal(0)

  for (const linea of corrida.lineas) {
    const diferencia = new Decimal(linea.diferencia)
    if (diferencia.isZero()) continue

    lineas.push({
      cuenta: linea.cuentaContable,
      concepto: `Revaluación de ${linea.codigo} al ${linea.tipoCambio}`,
      cargo: diferencia.isPositive() ? diferencia.toFixed(2) : '0',
      abono: diferencia.isNegative() ? diferencia.abs().toFixed(2) : '0',
      auxiliarTipo: 'banco',
      auxiliarId: linea.cuentaBancariaId,
    })

    if (diferencia.isPositive()) ganancia = ganancia.plus(diferencia)
    else perdida = perdida.plus(diferencia.abs())
  }

  if (lineas.length === 0) return null

  // La contrapartida sí se agrupa: es una sola cuenta de resultados y el
  // detalle por cuenta bancaria ya está en las líneas de arriba.
  if (ganancia.greaterThan(0)) {
    lineas.push({
      cuenta: mapeo.diferencialGanado,
      concepto: 'Ganancia cambiaria no realizada',
      cargo: '0',
      abono: ganancia.toFixed(2),
    })
  }
  if (perdida.greaterThan(0)) {
    lineas.push({
      cuenta: mapeo.diferencialPerdido,
      concepto: 'Pérdida cambiaria no realizada',
      cargo: perdida.toFixed(2),
      abono: '0',
    })
  }

  return {
    fecha: corrida.fecha,
    concepto: `Revaluación de saldos en moneda extranjera`,
    moneda: corrida.moneda,
    tipoCambio: '1',
    // Idempotente por periodo, igual que la depreciación y la amortización:
    // correr dos veces la revaluación del mismo mes no duplica el resultado.
    origen: {
      modulo: MODULO_ORIGEN,
      tipo: TIPO_ORIGEN_REVALUACION,
      id: origenRevaluacion(corrida.periodoId),
    },
    lineas,
  }
}
