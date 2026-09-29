import type { RolEmpresa, Usuario } from '@/shared/api/contracts/auth'
import { tablaGlobal } from '@/shared/almacen/almacen'
import { EMPRESA_PRINCIPAL, EMPRESA_SECUNDARIA } from './empresas'

/**
 * Usuarios y sesiones de la demostración.
 *
 * Son del grupo, no de una empresa: el usuario es uno y su rol cambia por
 * empresa (docs/01 §4.1). Por eso las dos tablas se declaran con `tablaGlobal`
 * y no se recargan al cambiar de empresa.
 *
 * AVISO: el mock no protege nada. La contraseña se guarda con un resumen
 * rápido que solo sirve para no dejarla en claro en el navegador; el backend
 * la guardará con un hash lento y con sal (argon2 o bcrypt), y el token será
 * de verdad secreto. Aquí todo vive en el almacenamiento local del navegador,
 * al alcance de cualquiera que abra las herramientas de desarrollo.
 */

export interface UsuarioGuardado extends Usuario {
  claveResumen: string
}

export interface SesionGuardada {
  token: string
  usuarioId: string
  expiraEn: string
}

/** Contraseña de todos los usuarios de la demostración. */
export const CLAVE_DEMO = 'contikos'

/**
 * Resumen FNV-1a de 32 bits, en hexadecimal. No es criptográfico y no lo
 * pretende: ver el aviso del encabezado.
 */
export function resumirClave(clave: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < clave.length; i++) {
    hash ^= clave.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function usuario(
  id: string,
  nombre: string,
  correo: string,
  roles: RolEmpresa[],
): UsuarioGuardado {
  return { id, nombre, correo, activo: true, roles, claveResumen: resumirClave(CLAVE_DEMO) }
}

/**
 * Uno por rol, para poder recorrer la aplicación con cada uno. La contadora
 * tiene dos roles distintos a propósito: es el caso que justifica que el rol
 * sea por empresa.
 */
const USUARIOS_SEED = (): UsuarioGuardado[] => [
  usuario('usr-admin', 'Administración', 'admin@contikos.cr', [
    { empresaId: EMPRESA_PRINCIPAL, rol: 'administrador' },
    { empresaId: EMPRESA_SECUNDARIA, rol: 'administrador' },
  ]),
  usuario('usr-contadora', 'Laura Contadora', 'contadora@contikos.cr', [
    { empresaId: EMPRESA_PRINCIPAL, rol: 'contador' },
    { empresaId: EMPRESA_SECUNDARIA, rol: 'consulta' },
  ]),
  usuario('usr-auxiliar', 'Marco Auxiliar', 'auxiliar@contikos.cr', [
    { empresaId: EMPRESA_PRINCIPAL, rol: 'auxiliar' },
  ]),
  usuario('usr-planilla', 'Ana Planilla', 'planilla@contikos.cr', [
    { empresaId: EMPRESA_PRINCIPAL, rol: 'planilla' },
  ]),
  usuario('usr-consulta', 'Auditoría Externa', 'consulta@contikos.cr', [
    { empresaId: EMPRESA_PRINCIPAL, rol: 'consulta' },
    { empresaId: EMPRESA_SECUNDARIA, rol: 'consulta' },
  ]),
]

const tablaUsuarios = tablaGlobal<UsuarioGuardado>('auth.usuarios', USUARIOS_SEED)
const tablaSesiones = tablaGlobal<SesionGuardada>('auth.sesiones', () => [])

export const usuariosMock: UsuarioGuardado[] = tablaUsuarios.filas
export const sesionesMock: SesionGuardada[] = tablaSesiones.filas

export function persistirUsuarios(): void {
  tablaUsuarios.persistir()
}

export function persistirSesiones(): void {
  tablaSesiones.persistir()
}

/** Ocho horas: una jornada. Después hay que volver a entrar. */
const DURACION_MS = 8 * 60 * 60 * 1000

/** Sin la contraseña: es lo único que el servidor devuelve de un usuario. */
export function publico(u: UsuarioGuardado): Usuario {
  return { id: u.id, nombre: u.nombre, correo: u.correo, activo: u.activo, roles: u.roles }
}

export function crearSesion(usuarioId: string): SesionGuardada {
  const sesion: SesionGuardada = {
    token: crypto.randomUUID(),
    usuarioId,
    expiraEn: new Date(Date.now() + DURACION_MS).toISOString(),
  }
  // Las vencidas se barren al abrir una nueva: la tabla no crece sin límite.
  const vigentes = sesionesMock.filter((s) => new Date(s.expiraEn) > new Date())
  tablaSesiones.reemplazar([...vigentes, sesion])
  return sesion
}

export function cerrarSesion(token: string): void {
  tablaSesiones.reemplazar(sesionesMock.filter((s) => s.token !== token))
}

/** El usuario de un token vigente y activo, o null. */
export function usuarioDeToken(token: string | null): UsuarioGuardado | null {
  if (!token) return null
  const sesion = sesionesMock.find((s) => s.token === token)
  if (!sesion || new Date(sesion.expiraEn) <= new Date()) return null
  const u = usuariosMock.find((x) => x.id === sesion.usuarioId)
  return u?.activo ? u : null
}
