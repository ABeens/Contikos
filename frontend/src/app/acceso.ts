import type { Permiso, Rol, Usuario } from '@/shared/api/contracts/auth'
import { puede, rolEn } from '@/shared/auth/permisos'
import { useSesionActual } from '@/shared/auth/sesion'
import { useEmpresa } from './empresa'

export interface Acceso {
  usuario: Usuario | null
  /** El rol en la empresa abierta. */
  rol: Rol | null
  puede: (permiso: Permiso) => boolean
}

/**
 * Qué puede hacer el usuario en la empresa abierta.
 *
 * Las pantallas lo usan para no ofrecer lo que el servidor va a rechazar. Es
 * comodidad, no seguridad: quien decide es el servidor, con la misma tabla.
 */
export function useAcceso(): Acceso {
  const sesion = useSesionActual()
  const { empresa } = useEmpresa()
  const rol = rolEn(sesion?.usuario, empresa.id)
  return {
    usuario: sesion?.usuario ?? null,
    rol,
    puede: (permiso) => puede(rol, permiso),
  }
}
