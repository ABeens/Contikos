import Decimal from 'decimal.js'
import type { TipoCambio } from '@/shared/api/contracts/config'
import { tabla } from '@/shared/almacen/almacen'

/**
 * ⚠️ PLANTILLA DE DEMOSTRACIÓN. ESTOS TIPOS DE CAMBIO NO SON DATOS OFICIALES.
 *
 * Son una serie de ejemplo para poder trabajar con documentos en dólares y en
 * euros mientras el poblado automático desde la fuente oficial no exista. Salen
 * de valores realistas de Costa Rica a inicios de 2026 (el dólar alrededor de
 * 505 de compra y 512 de venta, el euro por una paridad cercana a 1,08) y de
 * ahí varían suavemente, pero **ninguno de ellos es el que publicó el Banco
 * Central ese día**. Por eso todos se sirven con `origen: 'derivado'` y con la
 * fuente `Plantilla de demostración`: nadie debería confundirlos con un
 * indicador oficial, ni al leerlos en pantalla ni al ver el asiento que salió
 * de ellos.
 *
 * **La serie es determinista.** Cada día del ejercicio sale de una función del
 * número de día y de nada más: ni `Math.random` ni la hora de carga. Si la
 * serie cambiara entre dos recargas, los importes convertidos de los documentos
 * ya capturados cambiarían solos, y un saldo que se mueve sin que nadie lo toque
 * es exactamente lo que un sistema contable no puede permitirse.
 *
 * TODO(robot): cuando se retome el robot de tipo de cambio (hoy en pausa), esta
 * plantilla deja de sembrarse y la tabla se puebla día a día desde los
 * indicadores del Ministerio de Hacienda (docs/13 §7, `mocks/hacienda.ts`). Lo
 * que queda pendiente son dos cosas distintas: el poblado diario de la serie
 * desde la fuente oficial, y la consulta automática al cambiar la fecha de un
 * documento para proponer el tipo de ese día.
 */

/** Se ve en la pantalla y en el detalle de cada fila. Es la advertencia. */
export const FUENTE_PLANTILLA = 'Plantilla de demostración'

const EJERCICIO = 2026

/** Primer día de la serie. */
const DESDE = `${EJERCICIO}-01-01`

/**
 * Último día de la serie.
 *
 * Cierra en setiembre porque hasta ahí llega la demo: el periodo en curso es
 * agosto y el mes siguiente es el que se está capturando. Una fecha posterior
 * pediría un tipo de cambio que ni siquiera el Banco Central ha publicado, y
 * para eso está la regla del último valor anterior.
 */
const HASTA = `${EJERCICIO}-09-30`

/* --------------------------------------------------------- La serie */

/** Dólar del día 1 de la serie, en colones. */
const USD_COMPRA_INICIAL = 505
const USD_VENTA_INICIAL = 512

/** Euros por dólar del día 1. La paridad también se mueve, más despacio. */
const PARIDAD_INICIAL = 1.08

/**
 * Variación suave del día `dia`.
 *
 * Una deriva lenta hacia arriba más una onda de unos tres meses. No pretende
 * imitar el mercado: pretende que la serie no sea una línea plana, para que se
 * note en pantalla que el tipo de cambio es un dato con fecha y no una
 * constante.
 */
function dolarDelDia(dia: number): { compra: Decimal; venta: Decimal } {
  const deriva = dia * 0.015
  const onda = Math.sin((dia / 45) * Math.PI) * 4.5
  const compra = new Decimal(USD_COMPRA_INICIAL + deriva + onda).toDecimalPlaces(2)
  // El diferencial compra-venta se mantiene: es comisión, no cotización.
  const venta = compra
    .plus(USD_VENTA_INICIAL - USD_COMPRA_INICIAL)
    .toDecimalPlaces(2)
  return { compra, venta }
}

/** Dólares que cuesta un euro ese día. */
function paridadDelDia(dia: number): Decimal {
  return new Decimal(PARIDAD_INICIAL + Math.sin((dia / 60) * Math.PI) * 0.02)
}

const dosDigitos = (n: number) => String(n).padStart(2, '0')

function fechaISO(fecha: Date): string {
  return `${fecha.getUTCFullYear()}-${dosDigitos(fecha.getUTCMonth() + 1)}-${dosDigitos(fecha.getUTCDate())}`
}

function diasEntre(desde: string, hasta: string): string[] {
  const fechas: string[] = []
  const cursor = new Date(`${desde}T00:00:00Z`)
  const fin = new Date(`${hasta}T00:00:00Z`)
  while (cursor.getTime() <= fin.getTime()) {
    fechas.push(fechaISO(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return fechas
}

/**
 * Serie completa de la plantilla, día a día, dólar y euro.
 *
 * Día a día y no solo los hábiles: la regla del último valor anterior sigue
 * haciendo falta igual, porque una factura puede fecharse fuera del rango
 * sembrado, y así la demo no tiene huecos que expliquen mal la serie.
 */
function construirTiposCambio(): TipoCambio[] {
  const filas: TipoCambio[] = []

  diasEntre(DESDE, HASTA).forEach((fecha, dia) => {
    const dolar = dolarDelDia(dia)
    const paridad = paridadDelDia(dia)

    filas.push({
      moneda: 'USD',
      fecha,
      compra: dolar.compra.toFixed(2),
      venta: dolar.venta.toFixed(2),
      origen: 'derivado',
      fuente: FUENTE_PLANTILLA,
    })
    filas.push({
      moneda: 'EUR',
      fecha,
      compra: dolar.compra.times(paridad).toFixed(2),
      venta: dolar.venta.times(paridad).toFixed(2),
      origen: 'derivado',
      fuente: FUENTE_PLANTILLA,
    })
  })

  return filas
}

const tablaTiposCambio = tabla<TipoCambio>(
  'config.tipos-cambio',
  construirTiposCambio,
)

export const tiposCambioMock: TipoCambio[] = tablaTiposCambio.filas

export function persistirTiposCambio(): void {
  tablaTiposCambio.persistir()
}
