import { crearSesion, publico, usuariosMock } from '@/mocks/seed/usuarios'
import { establecerSesion } from '@/shared/auth/sesion'

/**
 * Abre una sesión de verdad contra el mock para un usuario de la semilla, sin
 * pasar por la pantalla de inicio. La crea en la tabla de sesiones del mock,
 * así que la guardia la reconoce igual que a una abierta con contraseña.
 */
export function iniciarSesionDePrueba(usuarioId: string): void {
  const usuario = usuariosMock.find((u) => u.id === usuarioId)
  if (!usuario) throw new Error(`No hay usuario ${usuarioId} en la semilla`)
  const sesion = crearSesion(usuario.id)
  establecerSesion({
    token: sesion.token,
    usuario: publico(usuario),
    expiraEn: sesion.expiraEn,
  })
}
