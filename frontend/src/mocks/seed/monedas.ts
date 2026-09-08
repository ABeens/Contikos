import type { MonedaBase } from '@/shared/api/contracts/config'
import { MONEDAS_POR_DEFECTO } from '@/shared/money/money'
import { tabla } from '@/shared/almacen/almacen'

/**
 * Catálogo de monedas de la empresa demo.
 *
 * Parte del catálogo por defecto del registro de formato: lo que el mock sirve
 * y lo que la aplicación asume mientras la API no responde son la misma cosa.
 *
 * El estado mutable vive aquí y no dentro de un handler porque lo leen dos:
 * `config` lo administra y `conta` necesita saber cuál es la funcional para
 * expresar la balanza.
 */
export const MONEDAS_SEED: readonly MonedaBase[] = MONEDAS_POR_DEFECTO.map(
  (m) => ({ ...m }),
)

const tablaMonedas = tabla<MonedaBase>('config.monedas', () =>
  MONEDAS_SEED.map((m) => ({ ...m })),
)

export const monedasMock: MonedaBase[] = tablaMonedas.filas

export function persistirMonedas(): void {
  tablaMonedas.persistir()
}

export function monedaFuncionalMock(): string {
  return (monedasMock.find((m) => m.funcional) ?? monedasMock[0]).codigo
}
