import Decimal from 'decimal.js'
import { z } from 'zod'
import { FechaISO } from '@/shared/api/contracts/comunes'
import type {
  OrigenTipoCambio,
  TablaTipoCambio,
  TipoCambio,
  TipoCambioMoneda,
} from '@/shared/api/contracts/config'
import { Money, type Moneda } from '@/shared/money/money'

/**
 * Tipo de cambio del día, Costa Rica (docs/13 §7).
 *
 * El Banco Central fija el tipo de cambio de referencia y el Ministerio de
 * Hacienda lo republica en dos endpoints abiertos, que son la fuente de
 * Contikos:
 *
 *     GET https://api.hacienda.go.cr/indicadores/tc/dolar
 *     GET https://api.hacienda.go.cr/indicadores/tc/euro
 *
 * Aquí viven SOLO las reglas: qué publica cada endpoint, cómo se completa el
 * par compra/venta del euro y cómo se expresa la tabla contra la moneda
 * funcional. La llamada de red no está aquí a propósito. La hará el backend
 * (docs/13 §8, `obtenerTipoCambio`) y, mientras no exista, el mock: ningún
 * módulo llama a Hacienda.
 */

export const URL_TC_DOLAR = 'https://api.hacienda.go.cr/indicadores/tc/dolar'
export const URL_TC_EURO = 'https://api.hacienda.go.cr/indicadores/tc/euro'

export const FUENTE_TIPO_CAMBIO = 'Ministerio de Hacienda (indicadores/tc)'

/**
 * Moneda en la que la fuente expresa los tipos de cambio.
 *
 * Los dos endpoints publican colones por unidad de la moneda extranjera. Que la
 * moneda funcional de la empresa sea el colón es lo habitual en Costa Rica,
 * pero no es obligatorio: por eso la tabla declara su base en vez de darla por
 * supuesta.
 */
export const BASE_TIPO_CAMBIO = 'CRC'

/**
 * Respuesta del endpoint del dólar.
 *
 * Es el único de los dos que trae compra y venta por separado, que es como
 * docs/13 §7 pide registrarlo.
 *
 * Los valores llegan como number porque así los publica la fuente. Se
 * convierten a texto decimal en este mismo borde y no se opera con ellos como
 * number en ningún punto (docs/14 §4).
 */
export const RespuestaDolarSchema = z.object({
  compra: z.object({ fecha: FechaISO, valor: z.number().positive() }),
  venta: z.object({ fecha: FechaISO, valor: z.number().positive() }),
})

/**
 * Respuesta del endpoint del euro.
 *
 * Aquí no hay compra ni venta: un solo valor en colones y la paridad contra el
 * dólar. Ver `euroDesdeDolar`.
 */
export const RespuestaEuroSchema = z.object({
  fecha: FechaISO,
  /** Dólares que cuesta un euro. */
  dolares: z.number().positive(),
  /** Colones que cuesta un euro. Único valor que la fuente publica del euro. */
  colones: z.number().positive(),
})

export type RespuestaDolar = z.infer<typeof RespuestaDolarSchema>
export type RespuestaEuro = z.infer<typeof RespuestaEuroSchema>

/** La fuente publica los colones con dos decimales. */
const DECIMALES_BASE = 2

/**
 * Decimales de un tipo cruzado.
 *
 * Un cruce puede ser mucho menor que uno: el colón contra el dólar ronda
 * 0,0022. Con dos decimales quedaría en cero y todo importe convertido se
 * perdería.
 */
const DECIMALES_CRUCE = 6

function enBase(valor: Decimal | number): string {
  return new Decimal(valor.toString()).toFixed(DECIMALES_BASE)
}

/**
 * Completa el par compra/venta del euro.
 *
 * La fuente publica del euro un solo valor en colones y su paridad contra el
 * dólar. Ese valor coincide con la venta del dólar multiplicada por la paridad,
 * así que la compra se obtiene aplicando la misma paridad a la compra del
 * dólar. La venta se deja como se publica, no reconstruida: entre un número
 * publicado y uno calculado manda el publicado.
 *
 * El resultado queda marcado como derivado, y eso importa en un asiento: la
 * compra del euro no es un dato oficial, es una deducción de dos que sí lo son.
 */
function euroDesdeDolar(
  dolar: RespuestaDolar,
  euro: RespuestaEuro,
): TipoCambioMoneda {
  const venta = enBase(euro.colones)

  // Derivar con un dólar de otro día mezclaría dos publicaciones distintas.
  if (euro.fecha !== dolar.compra.fecha) {
    return {
      moneda: 'EUR',
      compra: venta,
      venta,
      origen: 'derivado',
      nota: `La fuente no publica compra del euro y su paridad es del ${euro.fecha}, distinta de la del dólar. Se usa el mismo valor para compra y venta.`,
    }
  }

  const compra = enBase(
    new Decimal(dolar.compra.valor.toString()).times(euro.dolares.toString()),
  )
  return {
    moneda: 'EUR',
    compra,
    venta,
    origen: 'derivado',
    nota: `La fuente no publica compra del euro. Se deriva de la compra del dólar por la paridad ${euro.dolares}.`,
  }
}

/**
 * Arma la tabla del día con lo que responden los dos endpoints.
 *
 * La fecha de la tabla es la de la venta del dólar. Los dos endpoints fechan
 * cada valor por separado y pueden ir desacompasados unos minutos al publicar:
 * quien decide qué día es la tabla es el dólar, que es de donde sale todo lo
 * demás.
 */
export function armarTabla(
  dolar: RespuestaDolar,
  euro: RespuestaEuro,
): TablaTipoCambio {
  return {
    fecha: dolar.venta.fecha,
    base: BASE_TIPO_CAMBIO,
    fuente: FUENTE_TIPO_CAMBIO,
    monedas: [
      {
        moneda: 'USD',
        compra: enBase(dolar.compra.valor),
        venta: enBase(dolar.venta.valor),
        origen: 'publicado',
      },
      euroDesdeDolar(dolar, euro),
    ],
  }
}

export interface CambioContraFuncional {
  /** Unidades de la moneda funcional por una unidad de la moneda consultada. */
  readonly compra: string
  readonly venta: string
  readonly origen: OrigenTipoCambio
  /** Por qué el valor no es un dato publicado tal cual. */
  readonly nota?: string
}

function enTabla(
  tabla: TablaTipoCambio,
  moneda: Moneda,
): CambioContraFuncional | null {
  // La base se cambia a sí misma a la par y no viaja en la tabla.
  if (moneda === tabla.base) return { compra: '1', venta: '1', origen: 'publicado' }

  const fila = tabla.monedas.find((m) => m.moneda === moneda)
  if (!fila) return null
  return {
    compra: fila.compra,
    venta: fila.venta,
    origen: fila.origen,
    ...(fila.nota === undefined ? {} : { nota: fila.nota }),
  }
}

function cruzar(objetivo: string, referencia: string): string {
  return new Decimal(objetivo)
    .div(referencia)
    .toDecimalPlaces(DECIMALES_CRUCE)
    .toFixed()
}

/**
 * Expresa el tipo de cambio de una moneda contra la moneda funcional.
 *
 * La tabla viene en colones. Si la empresa lleva su contabilidad en colones,
 * que es el caso normal, los valores se usan tal cual. Si lleva otra moneda
 * funcional, el tipo sale de cruzar las dos contra el colón, pata por pata
 * (compra con compra, venta con venta). El cruce no es un dato publicado y se
 * devuelve marcado como derivado, para que la pantalla pueda decirlo.
 *
 * Devuelve null cuando la fuente no publica alguna de las dos monedas: es
 * preferible no ofrecer un tipo de cambio a ofrecer uno inventado.
 */
export function tipoCambioContraFuncional(
  tabla: TablaTipoCambio,
  funcional: Moneda,
  moneda: Moneda,
): CambioContraFuncional | null {
  if (moneda === funcional) return { compra: '1', venta: '1', origen: 'publicado' }

  const objetivo = enTabla(tabla, moneda)
  const referencia = enTabla(tabla, funcional)
  if (!objetivo || !referencia) return null

  if (funcional === tabla.base) return objetivo

  return {
    compra: cruzar(objetivo.compra, referencia.compra),
    venta: cruzar(objetivo.venta, referencia.venta),
    origen: 'derivado',
    nota: `La fuente publica en ${tabla.base} y la moneda funcional es ${funcional}: el tipo sale de cruzar ambas contra el ${tabla.base}.`,
  }
}

/* --------------------- La serie con fecha (docs/13 §7, docs/10 §2) */

/**
 * Lado del tipo de cambio que se aplica.
 *
 * Quién elige el lado es quien conoce la operación, no esta función: la
 * práctica en Costa Rica es valorar con la compra lo que la empresa recibe en
 * moneda extranjera y con la venta lo que tiene que pagar, pero la política la
 * fija la empresa y queda congelada en el asiento.
 */
export type LadoTipoCambio = 'compra' | 'venta'

/**
 * El tipo de cambio que rige en una fecha: el de ese día, o el último anterior.
 *
 * La regla del último valor anterior no es una comodidad, es la única respuesta
 * correcta: el Banco Central no publica los domingos ni los feriados, y una
 * factura fechada un domingo se contabiliza igual. Lo que rige ese día es el
 * último publicado, que es el que seguía vigente.
 *
 * Hacia adelante NO se extrapola: si la serie no llega a la fecha pedida se
 * devuelve el último anterior, que es un dato real; lo que nunca se hace es
 * inventar el de un día que todavía no existe. Y si no hay ninguno anterior,
 * se devuelve `undefined`: es preferible no ofrecer un tipo de cambio a
 * ofrecer uno que nadie publicó.
 */
export function tipoCambioVigente(
  serie: readonly TipoCambio[],
  moneda: Moneda,
  fecha: string,
): TipoCambio | undefined {
  return serie
    .filter((t) => t.moneda === moneda && t.fecha <= fecha)
    .reduce<TipoCambio | undefined>(
      (mejor, t) => (!mejor || t.fecha > mejor.fecha ? t : mejor),
      undefined,
    )
}

/** El valor del lado pedido. Existe para no repetir el ternario en cada uso. */
export function valorTipoCambio(
  tipo: Pick<TipoCambio, 'compra' | 'venta'>,
  lado: LadoTipoCambio,
): string {
  return lado === 'compra' ? tipo.compra : tipo.venta
}

/**
 * Expresa un importe en la moneda funcional.
 *
 * Los valores de la tabla ya vienen en unidades de la moneda funcional por una
 * unidad de la moneda consultada (`contracts/config`, `TipoCambio`), así que la
 * conversión es una multiplicación. El redondeo lo hace `Money` con los
 * decimales de la funcional: el mayor no admite más precisión de la que la
 * moneda tiene, y redondear al final y una sola vez es lo que evita que dos
 * caminos distintos lleguen a dos importes distintos.
 */
export function convertirAFuncional(
  importe: string,
  tipo: Pick<TipoCambio, 'compra' | 'venta'>,
  lado: LadoTipoCambio,
  funcional: Moneda,
): Money {
  return new Money(
    new Decimal(importe).times(valorTipoCambio(tipo, lado)),
    funcional,
  )
}
