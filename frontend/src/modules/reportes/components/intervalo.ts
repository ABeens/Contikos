import type { Periodo } from '@/shared/api/contracts/conta'
import { formatFechaLarga } from '@/shared/format/fecha'
import type { Alcance } from './useFiltrosReporte'

/**
 * El intervalo que mide un estado de flujo, escrito como se imprime:
 * "Del 1 de agosto de 2026 al 31 de agosto de 2026".
 */
export function descripcionIntervalo(periodo: Periodo, alcance: Alcance): string {
  return alcance === 'mes'
    ? `Del ${formatFechaLarga(periodo.fechaInicio)} al ${formatFechaLarga(periodo.fechaFin)}`
    : `Del inicio del ejercicio ${periodo.ejercicio} al ${formatFechaLarga(periodo.fechaFin)}`
}
