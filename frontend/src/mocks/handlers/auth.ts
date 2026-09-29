import { http, HttpResponse } from 'msw'
import { API_URL, rutaApi } from '@/shared/api/entorno'
import {
  SolicitudInicioSesionSchema,
  SolicitudUsuarioSchema,
  type Sesion,
} from '@/shared/api/contracts/auth'
import { permisoDeOperacion, puede, rolEn } from '@/shared/auth/permisos'
import { latencia } from '../latencia'
import {
  cerrarSesion,
  crearSesion,
  persistirUsuarios,
  publico,
  resumirClave,
  usuarioDeToken,
  usuariosMock,
  type UsuarioGuardado,
} from '../seed/usuarios'
import { empresasMock } from '../seed/empresas'

/**
 * Autenticación y autorización del mock (docs/17 §6).
 *
 * Dos piezas. La guardia de sesión, que va delante de todo: sin token vigente
 * contesta 401, sin rol en la empresa de la cabecera 403, y sin el permiso que
 * pide la operación, 403. Y los endpoints de `/auth`: abrir y cerrar sesión, y
 * el catálogo de usuarios.
 *
 * La tabla de qué pide cada operación es `shared/auth/permisos.ts`, la misma
 * que lee la interfaz. El backend la implementará con la misma forma.
 */

/** Quien hace la petición en curso. Lo usan los handlers para la bitácora. */
let usuarioEnCurso: UsuarioGuardado | null = null

/**
 * Correo de quien hace la petición en curso, para `creadoPor`, `cerradoPor` y
 * demás campos de bitácora. Antes de la autenticación todos decían
 * `demo@contikos.cr`, y eso era justo lo que había que resolver.
 */
export function autorEnCurso(): string {
  return usuarioEnCurso?.correo ?? 'sistema'
}

/** Para dar de alta roles al crear una empresa: su creador la administra. */
export function usuarioEnCursoGuardado(): UsuarioGuardado | null {
  return usuarioEnCurso
}

const BASE = new URL(API_URL, 'http://localhost').pathname.replace(/\/$/, '')

function rutaRelativa(url: string): string {
  const ruta = new URL(url).pathname
  return ruta.startsWith(BASE) ? ruta.slice(BASE.length) || '/' : ruta
}

function tokenDe(request: Request): string | null {
  const cabecera = request.headers.get('Authorization') ?? ''
  const [tipo, token] = cabecera.split(' ')
  return tipo === 'Bearer' && token ? token : null
}

function error(status: number, codigo: string, mensaje: string, detalles: string[] = []) {
  return HttpResponse.json({ codigo, mensaje, detalles }, { status })
}

function comoSesion(u: UsuarioGuardado, token: string, expiraEn: string): Sesion {
  return { token, usuario: publico(u), expiraEn }
}

/**
 * Guardia de sesión: sin token vigente, 401. Va antes que todo, incluida la
 * guardia de empresa: sin saber quién pide, no tiene sentido mirar qué empresa
 * pide.
 *
 * Devolver `undefined` deja seguir a la siguiente guardia y al handler.
 */
export const guardiaSesion = http.all(rutaApi('/*'), ({ request }) => {
  const ruta = rutaRelativa(request.url)
  // Entrar es lo único que se hace sin sesión.
  if (ruta === '/auth/sesion' && request.method === 'POST') return undefined

  const usuario = usuarioDeToken(tokenDe(request))
  usuarioEnCurso = usuario
  if (!usuario) return error(401, 'SESION_REQUERIDA', 'Inicie sesión para continuar')
  return undefined
})

/**
 * Guardia de permisos: rol en la empresa de la cabecera y permiso para la
 * operación, o 403. Va después de la guardia de empresa, que ya comprobó que la
 * cabecera existe y es la empresa abierta.
 */
export const guardiaPermisos = http.all(rutaApi('/*'), ({ request }) => {
  const ruta = rutaRelativa(request.url)
  const usuario = usuarioEnCurso
  if (!usuario) return undefined
  // La lista de empresas es del usuario, no de una empresa: es la que le dice
  // a cuáles puede entrar, y se sirve aunque no tenga rol en la abierta.
  if (ruta === '/empresas' && request.method === 'GET') return undefined

  const empresaId = request.headers.get('X-Empresa-Id') ?? ''
  const rol = rolEn(usuario, empresaId)
  if (!rol) {
    return error(
      403,
      'SIN_ACCESO_A_EMPRESA',
      'No tiene un rol en esta empresa',
      [`${usuario.correo} no tiene acceso a ${empresaId}`],
    )
  }

  const permiso = permisoDeOperacion(request.method, ruta)
  if (permiso && !puede(rol, permiso)) {
    return error(
      403,
      'PERMISO_DENEGADO',
      'Su rol no permite esta operación',
      [`Hace falta el permiso «${permiso}»`],
    )
  }
  return undefined
})

/** Sesión: del usuario, sin empresa de por medio. */
export const handlersAuthSinEmpresa = [
  /** Abre una sesión. Un error genérico: no dice si falló el correo o la clave. */
  http.post(rutaApi('/auth/sesion'), async ({ request }) => {
    await latencia(300)
    const parsed = SolicitudInicioSesionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return error(422, 'SOLICITUD_INVALIDA', 'Escriba su correo y su contraseña')
    }
    const correo = parsed.data.correo.trim().toLowerCase()
    const usuario = usuariosMock.find((u) => u.correo.toLowerCase() === correo)
    if (
      !usuario ||
      !usuario.activo ||
      usuario.claveResumen !== resumirClave(parsed.data.clave)
    ) {
      return error(401, 'CREDENCIALES_INVALIDAS', 'El correo o la contraseña no son correctos')
    }
    if (usuario.roles.length === 0) {
      return error(403, 'SIN_EMPRESAS', 'Su usuario no tiene acceso a ninguna empresa')
    }
    const sesion = crearSesion(usuario.id)
    return HttpResponse.json(comoSesion(usuario, sesion.token, sesion.expiraEn), {
      status: 201,
    })
  }),

  /** La sesión vigente: la aplicación la vuelve a pedir al recargar. */
  http.get(rutaApi('/auth/sesion'), ({ request }) => {
    const token = tokenDe(request)!
    const usuario = usuarioDeToken(token)!
    return HttpResponse.json({
      token,
      usuario: publico(usuario),
      // La vigencia exacta la sabe la sesión guardada; aquí basta con decir
      // que sigue viva.
      expiraEn: new Date(Date.now() + 60_000).toISOString(),
    } satisfies Sesion)
  }),

  http.delete(rutaApi('/auth/sesion'), ({ request }) => {
    const token = tokenDe(request)
    if (token) cerrarSesion(token)
    return new HttpResponse(null, { status: 204 })
  }),

]

/** Catálogo de usuarios: pasa por la guardia de permisos (`usuarios`). */
export const handlersUsuarios = [
  http.get(rutaApi('/auth/usuarios'), async () => {
    await latencia(100)
    return HttpResponse.json(usuariosMock.map(publico))
  }),

  http.post(rutaApi('/auth/usuarios'), async ({ request }) => {
    await latencia(250)
    const parsed = SolicitudUsuarioSchema.safeParse(await request.json())
    if (!parsed.success) {
      return error(
        422,
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }
    const rechazo = validarUsuario(parsed.data, undefined)
    if (rechazo) return rechazo
    if (!parsed.data.clave || parsed.data.clave.length < 8) {
      return error(422, 'CLAVE_CORTA', 'La contraseña inicial tiene que tener al menos 8 caracteres')
    }
    const nuevo: UsuarioGuardado = {
      id: `usr-${crypto.randomUUID().slice(0, 8)}`,
      nombre: parsed.data.nombre.trim(),
      correo: parsed.data.correo.trim().toLowerCase(),
      activo: parsed.data.activo,
      roles: parsed.data.roles,
      claveResumen: resumirClave(parsed.data.clave),
    }
    usuariosMock.push(nuevo)
    persistirUsuarios()
    return HttpResponse.json(publico(nuevo), { status: 201 })
  }),

  http.put(rutaApi('/auth/usuarios/:id'), async ({ params, request }) => {
    await latencia(250)
    const usuario = usuariosMock.find((u) => u.id === String(params.id))
    if (!usuario) return error(404, 'USUARIO_NO_ENCONTRADO', 'El usuario no existe')
    const parsed = SolicitudUsuarioSchema.safeParse(await request.json())
    if (!parsed.success) {
      return error(
        422,
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }
    const rechazo = validarUsuario(parsed.data, usuario)
    if (rechazo) return rechazo
    if (parsed.data.clave && parsed.data.clave.length < 8) {
      return error(422, 'CLAVE_CORTA', 'La contraseña tiene que tener al menos 8 caracteres')
    }
    usuario.nombre = parsed.data.nombre.trim()
    usuario.correo = parsed.data.correo.trim().toLowerCase()
    usuario.activo = parsed.data.activo
    usuario.roles = parsed.data.roles
    if (parsed.data.clave) usuario.claveResumen = resumirClave(parsed.data.clave)
    persistirUsuarios()
    return HttpResponse.json(publico(usuario))
  }),
]

/**
 * Reglas del catálogo de usuarios.
 *
 * La que importa es la última: no se puede dejar al grupo sin nadie que
 * administre usuarios. Sería una puerta que ya nadie puede abrir.
 */
function validarUsuario(
  datos: { correo: string; activo: boolean; roles: { empresaId: string; rol: string }[] },
  existente: UsuarioGuardado | undefined,
) {
  const correo = datos.correo.trim().toLowerCase()
  if (usuariosMock.some((u) => u.correo === correo && u.id !== existente?.id)) {
    return error(422, 'CORREO_DUPLICADO', `Ya hay un usuario con el correo ${correo}`)
  }
  const empresas = new Set(empresasMock.map((e) => e.id))
  const ajena = datos.roles.find((r) => !empresas.has(r.empresaId))
  if (ajena) {
    return error(422, 'EMPRESA_NO_ENCONTRADA', `La empresa ${ajena.empresaId} no existe`)
  }
  if (new Set(datos.roles.map((r) => r.empresaId)).size !== datos.roles.length) {
    return error(422, 'ROL_DUPLICADO', 'Un usuario tiene un solo rol por empresa')
  }
  if (existente) {
    const quedanAdministradores = usuariosMock.some((u) => {
      const roles = u.id === existente.id ? datos.roles : u.roles
      const activo = u.id === existente.id ? datos.activo : u.activo
      return activo && roles.some((r) => r.rol === 'administrador')
    })
    if (!quedanAdministradores) {
      return error(
        422,
        'SIN_ADMINISTRADOR',
        'Tiene que quedar al menos un administrador activo',
      )
    }
  }
  return null
}
