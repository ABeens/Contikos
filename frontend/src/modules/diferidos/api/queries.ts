import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { servicioDiferidos } from '@/shared/api/servicios'
import type {
  EstadoDiferido,
  SolicitudCancelacionDiferido,
  SolicitudCorridaDiferidos,
  SolicitudDiferido,
} from '@/shared/api/contracts/diferidos'

/**
 * Único punto del módulo que habla con el servidor (docs/14 §2).
 *
 * Qué se pide lo describe `shared/api/servicios/diferidos`; aquí se decide
 * cuándo pedirlo y qué invalidar después.
 */

export const clavesDiferidos = {
  todo: ['diferidos'] as const,
  lista: (estado?: EstadoDiferido) =>
    ['diferidos', 'lista', estado ?? 'todos'] as const,
  diferido: (id: string) => ['diferidos', 'diferido', id] as const,
  amortizacion: (periodoId: string) =>
    ['diferidos', 'amortizacion', 'previsualizacion', periodoId] as const,
  historialAmortizacion: ['diferidos', 'amortizacion', 'historial'] as const,
}

export function useDiferidos(estado?: EstadoDiferido) {
  return useQuery({
    queryKey: clavesDiferidos.lista(estado),
    queryFn: ({ signal }) => servicioDiferidos.listar({ estado }, { signal }),
  })
}

export function useDiferido(id: string | undefined) {
  return useQuery({
    queryKey: clavesDiferidos.diferido(id ?? ''),
    queryFn: ({ signal }) => servicioDiferidos.obtener(id!, { signal }),
    enabled: Boolean(id),
  })
}

/**
 * Alta y edición del plan de amortización.
 *
 * No invalida el mayor: el alta no genera asiento porque el documento que
 * originó el diferido ya reconoció el importe en la cuenta de balance
 * (docs/15 §3.1). Lo que contabiliza es la corrida.
 */
export function useGuardarDiferido() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      datos,
      id,
    }: {
      datos: SolicitudDiferido
      /** Sin id se da de alta. */
      id?: string
    }) =>
      id
        ? servicioDiferidos.actualizar(id, datos)
        : servicioDiferidos.crear(datos),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesDiferidos.todo })
    },
  })
}

/**
 * Cancelación anticipada.
 *
 * Sí toca el mayor: reconoce el saldo remanente de golpe (docs/15 §3.4), así
 * que invalida también los asientos y la balanza.
 */
export function useCancelarDiferido() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      datos,
    }: {
      id: string
      datos: SolicitudCancelacionDiferido
    }) => servicioDiferidos.cancelar(id, datos),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesDiferidos.todo })
      void cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
    },
  })
}

/* ----------------------------------------------------- Amortización */

/**
 * Verificación previa de la corrida (docs/15 §3.2).
 *
 * Solo se pide cuando el usuario la manda verificar: calcularla al abrir la
 * pantalla mostraría una corrida que nadie pidió revisar. No se cachea entre
 * visitas, porque la corrida depende del estado vigente de las fichas y del
 * mayor, y una previsualización vieja es justo lo que la verificación previa
 * evita.
 */
export function usePrevisualizacionAmortizacion(
  periodoId: string | undefined,
  habilitado: boolean,
) {
  return useQuery({
    queryKey: clavesDiferidos.amortizacion(periodoId ?? ''),
    queryFn: ({ signal }) =>
      servicioDiferidos.previsualizarAmortizacion(periodoId!, { signal }),
    enabled: habilitado && Boolean(periodoId),
    staleTime: 0,
    gcTime: 0,
  })
}

/**
 * Contabiliza la corrida.
 *
 * Toca las fichas (saldo, estado, historial) y el mayor, así que invalida los
 * dos: el auxiliar de diferidos y la balanza tienen que contar lo mismo.
 */
export function useContabilizarAmortizacion() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (solicitud: SolicitudCorridaDiferidos) =>
      servicioDiferidos.contabilizarAmortizacion(solicitud),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesDiferidos.todo })
      void cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
    },
  })
}

export function useHistorialAmortizacion() {
  return useQuery({
    queryKey: clavesDiferidos.historialAmortizacion,
    queryFn: ({ signal }) => servicioDiferidos.historialAmortizacion({ signal }),
  })
}
