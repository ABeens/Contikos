import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { servicioAuth } from '@/shared/api/servicios'
import type { SolicitudUsuario } from '@/shared/api/contracts/auth'

/**
 * Usuarios del grupo y sus roles por empresa (docs/17 §6).
 *
 * La clave empieza por `empresas` a propósito: cambiar de empresa vacía la
 * caché salvo lo que cuelga de `empresas` (ver `ProveedorEmpresa`), y los
 * usuarios son del grupo, no de la empresa abierta.
 */
export const clavesUsuarios = {
  lista: ['empresas', 'usuarios'] as const,
}

export function useUsuarios() {
  return useQuery({
    queryKey: clavesUsuarios.lista,
    queryFn: ({ signal }) => servicioAuth.listarUsuarios({ signal }),
  })
}

export function useGuardarUsuario() {
  const cliente = useQueryClient()
  return useMutation({
    meta: { exito: 'Usuario guardado' },
    mutationFn: ({ datos, id }: { datos: SolicitudUsuario; id?: string }) =>
      id ? servicioAuth.actualizarUsuario(id, datos) : servicioAuth.crearUsuario(datos),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesUsuarios.lista }),
  })
}
