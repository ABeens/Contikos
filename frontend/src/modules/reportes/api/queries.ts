import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { servicioConta } from '@/shared/api/servicios'
import type { Libro } from '@/shared/api/contracts/comunes'
import type { Periodo } from '@/shared/api/contracts/conta'
import {
  useClasificacionesNiif,
  useCuentas,
  useNotasEeff,
} from '@/shared/api/catalogos'
import type { Catalogos } from '../domain/presentacion'

/**
 * Lo que `reportes` le pide a `conta`, y nada más (docs/09 §2).
 *
 * Reportes no tiene endpoints propios: lee la balanza, los asientos y los
 * catálogos de presentación por la API pública de `conta`, y arma los estados
 * en su dominio. Así no puede escribir en el mayor aunque quiera, que es la
 * frontera que el diseño le pide defender.
 *
 * Las claves de caché empiezan como las de `conta` a propósito: contabilizar o
 * reversar un asiento invalida `['conta', 'balanza']` y `['conta', 'asientos']`,
 * y con eso los reportes abiertos se recalculan solos.
 */

export const clavesReportes = {
  balanza: (periodoId: string, libro: Libro, excluirCierre: boolean) =>
    // Sin exclusión es exactamente la clave de la balanza de `conta`: el
    // balance y la balanza de un mismo mes comparten una sola descarga.
    excluirCierre
      ? (['conta', 'balanza', periodoId, libro, 'sin-cierre'] as const)
      : (['conta', 'balanza', periodoId, libro] as const),
  asientos: (desde: string, hasta: string, libro: Libro) =>
    ['conta', 'asientos', 'rango', desde, hasta, libro] as const,
}

/** Los tres catálogos que hacen falta para presentar, como uno solo. */
export function useCatalogosReporte() {
  const cuentas = useCuentas()
  const clasificaciones = useClasificacionesNiif()
  const notas = useNotasEeff()

  const catalogos = useMemo<Catalogos | undefined>(
    () =>
      cuentas.data && clasificaciones.data && notas.data
        ? {
            cuentas: cuentas.data,
            clasificaciones: clasificaciones.data,
            notas: notas.data,
          }
        : undefined,
    [cuentas.data, clasificaciones.data, notas.data],
  )

  const consultas = [cuentas, clasificaciones, notas]
  return {
    catalogos,
    cargando: consultas.some((c) => c.isLoading),
    error: consultas.find((c) => c.error)?.error ?? null,
    reintentar: () => consultas.forEach((c) => void c.refetch()),
  }
}

export function useBalanzaReporte(
  periodoId: string | undefined,
  libro: Libro,
  { excluirCierre = false, habilitado = true } = {},
) {
  return useQuery({
    queryKey: clavesReportes.balanza(periodoId ?? '', libro, excluirCierre),
    queryFn: ({ signal }) =>
      servicioConta.obtenerBalanza(periodoId!, libro, { signal, excluirCierre }),
    enabled: habilitado && Boolean(periodoId),
  })
}

/** Asientos de un rango de fechas y un libro, para el diario y el mayor. */
export function useAsientosRango(
  desde: string | undefined,
  hasta: string | undefined,
  libro: Libro,
) {
  return useQuery({
    queryKey: clavesReportes.asientos(desde ?? '', hasta ?? '', libro),
    queryFn: ({ signal }) =>
      servicioConta.listarAsientos({ desde, hasta, libro }, { signal }),
    enabled: Boolean(desde) && Boolean(hasta),
  })
}

/**
 * Primer periodo del ejercicio de un periodo.
 *
 * Su saldo inicial es el saldo al abrir el ejercicio: de ahí salen el
 * acumulado del año del Estado de Resultados y la fila de apertura del de
 * Cambios en el Patrimonio.
 */
export function primerPeriodoDelEjercicio(
  periodos: readonly Periodo[],
  periodo: Periodo | undefined,
): Periodo | undefined {
  if (!periodo) return undefined
  return periodos
    .filter((p) => p.ejercicio === periodo.ejercicio)
    .sort((a, b) => a.numero - b.numero)[0]
}

/** El mismo mes del ejercicio anterior, si existe. */
export function mismoPeriodoAnioAnterior(
  periodos: readonly Periodo[],
  periodo: Periodo | undefined,
): Periodo | undefined {
  if (!periodo) return undefined
  return periodos.find(
    (p) => p.ejercicio === periodo.ejercicio - 1 && p.numero === periodo.numero,
  )
}

/** El periodo inmediatamente anterior, cruzando de ejercicio si hace falta. */
export function periodoAnterior(
  periodos: readonly Periodo[],
  periodo: Periodo | undefined,
): Periodo | undefined {
  if (!periodo) return undefined
  return [...periodos]
    .filter((p) => p.fechaFin < periodo.fechaInicio)
    .sort((a, b) => b.fechaFin.localeCompare(a.fechaFin))[0]
}
