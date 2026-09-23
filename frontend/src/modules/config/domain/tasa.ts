import Decimal from 'decimal.js'
import type { ConfigMoneda } from '@/shared/money/money'

/**
 * Tipos de cambio como número, no como importe.
 *
 * Una tasa se expresa en la moneda funcional pero no es un importe de ella, y
 * tratarla como tal la estropeaba de dos maneras: `MoneyInput` la redondeaba a
 * los decimales de la funcional al enfocar (con el dólar como funcional, el
 * colón a 0,0019 quedaba en 0,00), y `parseMonto` lee "512,125" como quinientos
 * doce mil ciento veinticinco porque tres cifras tras la coma parecen miles.
 * Aquí el separador, sea coma o punto, siempre es el decimal: nadie teclea un
 * tipo de cambio con separador de miles.
 */

/** Más que suficiente para cualquier par de monedas publicado. */
export const DECIMALES_TASA = 6

/**
 * Texto tecleado a tasa canónica ("512.125"). Devuelve null si no es un número
 * positivo con, como mucho, `DECIMALES_TASA` decimales.
 */
export function parseTasa(texto: string): string | null {
  const limpio = texto.trim().replace(/\s/g, '')
  if (!/^\d*([.,]\d*)?$/.test(limpio)) return null
  const canonico = limpio.replace(',', '.')
  if (canonico === '' || canonico === '.') return null

  const [entero, decimales = ''] = canonico.split('.')
  if (decimales.length > DECIMALES_TASA) return null

  const valor = new Decimal(`${entero || '0'}.${decimales || '0'}`)
  if (valor.lessThanOrEqualTo(0)) return null
  // Sin ceros de relleno: "512.10" y "512.1" son la misma tasa.
  return valor.toString()
}

/**
 * Tasa canónica para enseñar, con los separadores de la funcional y al menos
 * dos decimales, pero SIN recortar los que tenga: una tasa de cuatro decimales
 * redondeada a dos ya no es la tasa que se contabiliza.
 */
export function formatTasa(
  valor: string,
  config: Pick<ConfigMoneda, 'decimal' | 'grupo'>,
): string {
  const d = new Decimal(valor)
  const texto = d.toFixed(Math.max(2, d.decimalPlaces()))
  const [entero, decimales] = texto.split('.')
  const agrupado = entero.replace(/\B(?=(\d{3})+(?!\d))/g, config.grupo)
  return `${agrupado}${config.decimal}${decimales}`
}
