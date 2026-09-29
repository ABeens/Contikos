import type { Asiento } from '@/shared/api/contracts/conta'

/**
 * Terna de origen del asiento de cierre del ejercicio (docs/03 §6).
 *
 * Es parte del contrato de origen de docs/02 §4 y no un detalle privado de
 * `conta`: la escribe el cierre y la lee la balanza, que deja ese asiento fuera
 * cuando se lo piden los estados que miden el resultado. El id lleva el
 * ejercicio, así que la idempotencia por origen garantiza un solo cierre por
 * año.
 */
export const TIPO_ORIGEN_CIERRE_EJERCICIO = 'cierre_ejercicio'

export function origenCierreEjercicio(ejercicio: number): string {
  return `cierre-${ejercicio}`
}

export function esAsientoDeCierre(
  asiento: Pick<Asiento, 'origenModulo' | 'origenTipo'>,
): boolean {
  return (
    asiento.origenModulo === 'conta' &&
    asiento.origenTipo === TIPO_ORIGEN_CIERRE_EJERCICIO
  )
}
