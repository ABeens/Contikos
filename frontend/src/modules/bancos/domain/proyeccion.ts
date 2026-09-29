import Decimal from 'decimal.js'

/**
 * Flujo de efectivo proyectado (docs/06, etapa 7 de docs/17 §3).
 *
 * Cuánto habrá en caja y bancos semana a semana, partiendo del saldo en libros
 * de hoy y sumando lo que se espera cobrar y restando lo que se espera pagar.
 * Solo lectura: consulta CxC, CxP y la planilla por sus APIs y no escribe nada.
 *
 * Tres decisiones que conviene conocer:
 *
 * - **Por moneda.** Una proyección en colones con los dólares convertidos a un
 *   tipo de cambio que nadie sabe cuál será es una cifra inventada. Se proyecta
 *   cada moneda con sus propias cuentas y sus propios documentos.
 * - **Lo vencido por cobrar no cuenta, salvo que se pida.** Si ya venció y no
 *   entró, suponer que entra la semana que viene es la forma más común de que
 *   una proyección de caja mienta a favor. Lo vencido por pagar sí cuenta, en
 *   la primera semana: se debe.
 * - **La planilla es una estimación** hecha con la última calculada, y se marca
 *   como tal. Sin ella, la proyección quedaba sistemáticamente por encima de la
 *   realidad (docs/17 §3), que es la peor forma de equivocarse.
 */

const CERO = new Decimal(0)

export type OrigenFlujo = 'cxc' | 'cxp' | 'planilla' | 'cargas' | 'renta'

export interface FlujoProyectado {
  readonly fecha: string
  /** Positivo entra, negativo sale. */
  readonly importe: Decimal
  readonly concepto: string
  readonly origen: OrigenFlujo
  /** Sale de una estimación, no de un documento. */
  readonly estimado: boolean
}

export interface SemanaProyectada {
  readonly desde: string
  readonly hasta: string
  readonly entradas: string
  readonly salidas: string
  readonly saldoFinal: string
  readonly flujos: readonly FlujoProyectado[]
}

export interface Proyeccion {
  readonly saldoInicial: string
  readonly semanas: readonly SemanaProyectada[]
  /** La semana en que el saldo toca su punto más bajo. */
  readonly semanaMinima: number
  readonly saldoMinimo: string
  /** Lo vencido por cobrar que se dejó fuera (o se incluyó, si se pidió). */
  readonly vencidoPorCobrar: string
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Reparte los flujos en semanas a partir del corte.
 *
 * Un flujo con fecha anterior al corte cae en la primera semana: lo vencido
 * por pagar se paga en cuanto se pueda. Lo vencido por cobrar llega aquí solo
 * si quien llama decidió incluirlo.
 */
export function proyectar({
  corte,
  semanas,
  saldoInicial,
  flujos,
  vencidoPorCobrar = CERO,
}: {
  corte: string
  semanas: number
  saldoInicial: Decimal
  flujos: readonly FlujoProyectado[]
  vencidoPorCobrar?: Decimal
}): Proyeccion {
  let saldo = saldoInicial
  let minimo = saldoInicial
  let semanaMinima = 0
  const resultado: SemanaProyectada[] = []

  for (let i = 0; i < semanas; i++) {
    const desde = sumarDias(corte, i * 7)
    const hasta = sumarDias(corte, i * 7 + 6)
    const enSemana = flujos
      .filter((f) => (i === 0 ? f.fecha <= hasta : f.fecha >= desde && f.fecha <= hasta))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
    const entradas = enSemana.filter((f) => f.importe.isPositive()).reduce((a, f) => a.plus(f.importe), CERO)
    const salidas = enSemana.filter((f) => f.importe.isNegative()).reduce((a, f) => a.plus(f.importe), CERO)
    saldo = saldo.plus(entradas).plus(salidas)
    if (saldo.lessThan(minimo)) {
      minimo = saldo
      semanaMinima = i
    }
    resultado.push({
      desde,
      hasta,
      entradas: entradas.toFixed(2),
      salidas: salidas.negated().toFixed(2),
      saldoFinal: saldo.toFixed(2),
      flujos: enSemana,
    })
  }

  return {
    saldoInicial: saldoInicial.toFixed(2),
    semanas: resultado,
    semanaMinima,
    saldoMinimo: minimo.toFixed(2),
    vencidoPorCobrar: vencidoPorCobrar.toFixed(2),
  }
}

/** Un documento con saldo, en la forma mínima que la proyección necesita. */
export interface DocumentoPendiente {
  readonly numero: string
  readonly tercero: string
  readonly fechaVencimiento: string
  readonly saldo: string
  readonly moneda: string
}

/**
 * Los flujos de los documentos de cartera de una moneda.
 *
 * Devuelve también cuánto de lo por cobrar ya venció, para decirlo aunque no
 * se incluya.
 */
export function flujosDeCartera({
  porCobrar,
  porPagar,
  moneda,
  corte,
  incluirVencidoPorCobrar,
}: {
  porCobrar: readonly DocumentoPendiente[]
  porPagar: readonly DocumentoPendiente[]
  moneda: string
  corte: string
  incluirVencidoPorCobrar: boolean
}): { flujos: FlujoProyectado[]; vencidoPorCobrar: Decimal } {
  const flujos: FlujoProyectado[] = []
  let vencidoPorCobrar = CERO
  for (const d of porCobrar) {
    if (d.moneda !== moneda || new Decimal(d.saldo).isZero()) continue
    const vencido = d.fechaVencimiento < corte
    if (vencido) vencidoPorCobrar = vencidoPorCobrar.plus(d.saldo)
    if (vencido && !incluirVencidoPorCobrar) continue
    flujos.push({
      fecha: d.fechaVencimiento,
      importe: new Decimal(d.saldo),
      concepto: `Cobro de ${d.numero} · ${d.tercero}`,
      origen: 'cxc',
      estimado: false,
    })
  }
  for (const d of porPagar) {
    if (d.moneda !== moneda || new Decimal(d.saldo).isZero()) continue
    flujos.push({
      fecha: d.fechaVencimiento,
      importe: new Decimal(d.saldo).negated(),
      concepto: `Pago de ${d.numero} · ${d.tercero}`,
      origen: 'cxp',
      estimado: false,
    })
  }
  return { flujos, vencidoPorCobrar }
}

/** Lo que la proyección necesita saber de una planilla. */
export interface PlanillaResumen {
  /** Último día del mes de la planilla. */
  readonly finDeMes: string
  readonly neto: string
  readonly cargas: string
  readonly renta: string
  readonly pagada: boolean
}

/**
 * La planilla de los meses del horizonte, estimada con la más reciente.
 *
 * El neto sale el último día de cada mes; las cargas sociales y el impuesto
 * retenido, el 15 del mes siguiente. Si un mes ya tiene planilla calculada se
 * usa esa, y si ya se pagó su neto no se vuelve a restar.
 */
export function flujosDePlanilla({
  planillas,
  corte,
  hasta,
}: {
  planillas: readonly PlanillaResumen[]
  corte: string
  hasta: string
}): FlujoProyectado[] {
  if (planillas.length === 0) return []
  const ordenadas = [...planillas].sort((a, b) => a.finDeMes.localeCompare(b.finDeMes))
  const base = ordenadas[ordenadas.length - 1]
  const flujos: FlujoProyectado[] = []

  // Los meses desde el anterior al corte (sus cargas se pagan el 15 del mes
  // del corte) hasta el último del horizonte.
  const inicio = new Date(`${corte.slice(0, 7)}-01T00:00:00Z`)
  inicio.setUTCMonth(inicio.getUTCMonth() - 1)
  for (let d = inicio; d.toISOString().slice(0, 10) <= hasta; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
    const quince = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15)).toISOString().slice(0, 10)
    const propia = ordenadas.find((p) => p.finDeMes === fin)
    const planilla = propia ?? base
    const estimado = propia === undefined
    const mes = fin.slice(0, 7)

    if (fin >= corte && fin <= hasta && !(propia?.pagada ?? false)) {
      flujos.push({
        fecha: fin,
        importe: new Decimal(planilla.neto).negated(),
        concepto: `Planilla de ${mes}`,
        origen: 'planilla',
        estimado,
      })
    }
    if (quince >= corte && quince <= hasta) {
      flujos.push({
        fecha: quince,
        importe: new Decimal(planilla.cargas).negated(),
        concepto: `Cargas sociales de la planilla de ${mes}`,
        origen: 'cargas',
        estimado,
      })
      if (!new Decimal(planilla.renta).isZero()) {
        flujos.push({
          fecha: quince,
          importe: new Decimal(planilla.renta).negated(),
          concepto: `Impuesto al salario retenido en ${mes}`,
          origen: 'renta',
          estimado,
        })
      }
    }
  }
  return flujos
}
