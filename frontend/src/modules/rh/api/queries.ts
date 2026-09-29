import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { servicioRh } from '@/shared/api/servicios'
import type {
  SolicitudCalculoPlanilla,
  SolicitudEmpleado,
  SolicitudPagoPlanilla,
  SolicitudParametrosPlanilla,
} from '@/shared/api/contracts/rh'

/** Único punto del módulo que habla con el servidor (docs/14 §2). */

export const clavesRh = {
  todo: ['rh'] as const,
  mapeo: ['rh', 'mapeo'] as const,
  parametros: ['rh', 'parametros'] as const,
  empleados: ['rh', 'empleados'] as const,
  planillas: ['rh', 'planillas'] as const,
  planilla: (id: string) => ['rh', 'planillas', id] as const,
}

export function useMapeoRh() {
  return useQuery({
    queryKey: clavesRh.mapeo,
    queryFn: ({ signal }) => servicioRh.obtenerMapeo({ signal }),
    staleTime: 5 * 60 * 1000,
  })
}

export function useParametrosPlanilla() {
  return useQuery({
    queryKey: clavesRh.parametros,
    queryFn: ({ signal }) => servicioRh.listarParametros({ signal }),
  })
}

export function useRegistrarParametros() {
  const cliente = useQueryClient()
  return useMutation({
    meta: { exito: 'Parámetros registrados' },
    mutationFn: (datos: SolicitudParametrosPlanilla) => servicioRh.registrarParametros(datos),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesRh.parametros }),
  })
}

export function useEmpleados() {
  return useQuery({
    queryKey: clavesRh.empleados,
    queryFn: ({ signal }) => servicioRh.listarEmpleados({ signal }),
  })
}

export function useGuardarEmpleado() {
  const cliente = useQueryClient()
  return useMutation({
    meta: { exito: 'Empleado guardado' },
    mutationFn: ({ datos, id }: { datos: SolicitudEmpleado; id?: string }) =>
      id ? servicioRh.actualizarEmpleado(id, datos) : servicioRh.crearEmpleado(datos),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesRh.empleados }),
  })
}

export function usePlanillas() {
  return useQuery({
    queryKey: clavesRh.planillas,
    queryFn: ({ signal }) => servicioRh.listarPlanillas({ signal }),
  })
}

/**
 * Lo que cambia al calcular, contabilizar o pagar: la planilla, y desde que
 * hay asiento, el mayor y el auxiliar bancario. El checklist de cierre cuelga
 * de los periodos, y ahí también cambia el punto de la nómina.
 */
function invalidar(cliente: ReturnType<typeof useQueryClient>) {
  void cliente.invalidateQueries({ queryKey: clavesRh.planillas })
  void cliente.invalidateQueries({ queryKey: ['conta'] })
  void cliente.invalidateQueries({ queryKey: ['bancos'] })
}

export function useCalcularPlanilla() {
  const cliente = useQueryClient()
  return useMutation({
    meta: { exito: 'Planilla calculada' },
    mutationFn: (solicitud: SolicitudCalculoPlanilla) => servicioRh.calcularPlanilla(solicitud),
    onSuccess: () => invalidar(cliente),
  })
}

export function useContabilizarPlanilla() {
  const cliente = useQueryClient()
  return useMutation({
    meta: { exito: 'Planilla contabilizada' },
    mutationFn: (id: string) => servicioRh.contabilizarPlanilla(id),
    onSuccess: () => invalidar(cliente),
  })
}

export function usePagarPlanilla() {
  const cliente = useQueryClient()
  return useMutation({
    meta: { exito: 'Planilla pagada' },
    mutationFn: ({ id, solicitud }: { id: string; solicitud: SolicitudPagoPlanilla }) =>
      servicioRh.pagarPlanilla(id, solicitud),
    onSuccess: () => invalidar(cliente),
  })
}
