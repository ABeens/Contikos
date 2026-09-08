import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { servicioEmpresas } from '@/shared/api/servicios'
import type { SolicitudEmpresa } from '@/shared/api/contracts/empresas'
import { clavesCatalogo } from '@/shared/api/catalogos'

/**
 * Único punto del módulo que habla con el servidor.
 *
 * Qué se pide lo describe `shared/api/servicios/empresas`; aquí solo se decide
 * cuándo pedirlo y qué invalidar después (docs/14 §2).
 */

export const clavesEmpresas = {
  todo: ['empresas'] as const,
  lista: ['empresas', 'lista'] as const,
}

/**
 * Empresas del grupo.
 *
 * La consulta que más vive: la lee el proveedor de contexto para saber en qué
 * empresa se está, y sobrevive al cambio de empresa porque no es de ninguna.
 */
export function useEmpresas() {
  return useQuery({
    queryKey: clavesEmpresas.lista,
    queryFn: ({ signal }) => servicioEmpresas.listar({ signal }),
    staleTime: 30 * 60 * 1000,
  })
}

export function useGuardarEmpresa() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({ datos, id }: { datos: SolicitudEmpresa; id?: string }) =>
      id ? servicioEmpresas.actualizar(id, datos) : servicioEmpresas.crear(datos),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesEmpresas.todo })
      // Desactivar una empresa la saca del directorio de terceros del grupo.
      void cliente.invalidateQueries({ queryKey: clavesCatalogo.directorio })
    },
  })
}
