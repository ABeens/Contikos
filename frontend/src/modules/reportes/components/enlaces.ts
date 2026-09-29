import type { Libro } from '@/shared/api/contracts/comunes'
import type { Periodo } from '@/shared/api/contracts/conta'

/**
 * Enlace al auxiliar de una cuenta en el mayor.
 *
 * Es el escalón del drill-down que une un estado financiero con los asientos
 * (docs/09 §5). Lleva el mismo libro y el mismo intervalo que el estado desde
 * el que se abre: el auxiliar tiene que sumar exactamente la cifra en la que se
 * hizo clic.
 */
export function enlaceAuxiliar({
  codigo,
  desde,
  hasta,
  libro,
}: {
  codigo: string
  desde: Periodo | undefined
  hasta: Periodo | undefined
  libro: Libro
}): string {
  const parametros = new URLSearchParams({ cuenta: codigo, libro })
  if (desde) parametros.set('desde', desde.id)
  if (hasta) parametros.set('periodo', hasta.id)
  return `/reportes/mayor?${parametros.toString()}`
}
