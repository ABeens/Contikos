import { useMemo } from 'react'
import type { Libro } from '@/shared/api/contracts/comunes'
import type { Periodo } from '@/shared/api/contracts/conta'
import { primerPeriodoDelEjercicio, useBalanzaReporte } from '../api/queries'
import {
  movimientosDelPeriodo,
  saldosAlCierre,
  saldosAlInicio,
  variacion,
  type Importes,
} from '../domain/saldos'
import type { Alcance } from './useFiltrosReporte'

/**
 * Lo que cada cuenta se movió en un intervalo: el mes, o el ejercicio hasta el
 * mes.
 *
 * Siempre sin el asiento de cierre del ejercicio: los estados que miden el
 * resultado lo necesitan así, o diciembre diría que el año no ganó nada.
 *
 * El acumulado sale de dos cortes (el saldo al cerrar el mes menos el saldo al
 * abrir el ejercicio) y no de sumar doce balanzas: dos consultas en vez de
 * doce, y la misma cifra que el balance usa para su resultado del ejercicio.
 */
export function useMovimientos(
  periodo: Periodo | undefined,
  periodos: readonly Periodo[],
  libro: Libro,
  alcance: Alcance,
  habilitado = true,
) {
  const inicio = primerPeriodoDelEjercicio(periodos, periodo)
  const alMes = useBalanzaReporte(periodo?.id, libro, {
    excluirCierre: true,
    habilitado,
  })
  const alAbrir = useBalanzaReporte(inicio?.id, libro, {
    excluirCierre: true,
    habilitado: habilitado && alcance === 'ejercicio',
  })

  const movimientos = useMemo<Importes | undefined>(() => {
    if (!alMes.data) return undefined
    if (alcance === 'mes') return movimientosDelPeriodo(alMes.data)
    if (!alAbrir.data) return undefined
    return variacion(saldosAlCierre(alMes.data), saldosAlInicio(alAbrir.data))
  }, [alMes.data, alAbrir.data, alcance])

  return {
    movimientos,
    /** Primer periodo del intervalo: el mes mismo, o el primero del ejercicio. */
    desde: alcance === 'mes' ? periodo : inicio,
    consultas: [alMes, alAbrir],
  }
}
