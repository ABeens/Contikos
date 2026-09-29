import { z } from 'zod'

/**
 * Autenticación y control de acceso por empresa (docs/01 §4.1, docs/17 §6).
 *
 * El usuario es del grupo; su rol, de cada empresa. La misma contadora puede
 * cerrar periodos en una empresa y solo consultar en otra, y en una tercera no
 * existir: sin rol en una empresa, esa empresa no se le abre.
 */

/**
 * Roles. Pocos a propósito: cada uno es un conjunto de permisos que se lee de
 * una sola tabla (`shared/auth/permisos.ts`), y un rol nuevo es una fila ahí,
 * no un cambio en cada pantalla.
 */
export const RolSchema = z.enum([
  'administrador',
  'contador',
  'auxiliar',
  'planilla',
  'consulta',
])

export type Rol = z.infer<typeof RolSchema>

/**
 * Lo que se autoriza. Una operación sensible pide un permiso, nunca un rol:
 * así la pregunta "¿quién puede cerrar periodos?" se contesta en un solo
 * sitio.
 */
export const PermisoSchema = z.enum([
  /** Asientos manuales y reversas. */
  'contabilidad.capturar',
  /** Catálogo de cuentas, clasificación NIIF y notas. */
  'contabilidad.catalogo',
  /** Cierre de periodos y de ejercicio. */
  'contabilidad.cerrar',
  /** Reabrir un periodo cerrado. */
  'contabilidad.reabrir',
  /** Documentos de los módulos: facturas, cobros, pagos, bancos, activos. */
  'operaciones',
  /** Monedas, impuestos, tipos de cambio y empresas. */
  'configuracion',
  /** Usuarios y sus roles. */
  'usuarios',
  /** Ver datos salariales. Se concede aparte: no viene con "ver todo". */
  'planilla.ver',
  /** Calcular, contabilizar y pagar la planilla. */
  'planilla.operar',
])

export type Permiso = z.infer<typeof PermisoSchema>

export const RolEmpresaSchema = z.object({
  empresaId: z.string(),
  rol: RolSchema,
})

export type RolEmpresa = z.infer<typeof RolEmpresaSchema>

export const UsuarioSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  correo: z.string(),
  activo: z.boolean(),
  roles: z.array(RolEmpresaSchema),
})

export type Usuario = z.infer<typeof UsuarioSchema>

/**
 * Sesión abierta. El token es opaco para el cliente: se guarda y se manda en
 * cada petición, nada más.
 */
export const SesionSchema = z.object({
  token: z.string(),
  usuario: UsuarioSchema,
  /** Cuándo deja de valer. El servidor contesta 401 a partir de ahí. */
  expiraEn: z.string(),
})

export type Sesion = z.infer<typeof SesionSchema>

export const SolicitudInicioSesionSchema = z.object({
  correo: z.string().min(1, 'Escriba su correo'),
  clave: z.string().min(1, 'Escriba su contraseña'),
})

export type SolicitudInicioSesion = z.infer<typeof SolicitudInicioSesionSchema>

/**
 * Alta y edición de un usuario.
 *
 * La contraseña va solo al crearlo o cuando se cambia: vacía al editar deja la
 * que tenía. Nunca viaja de vuelta.
 */
export const SolicitudUsuarioSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  correo: z.string().email('Correo inválido'),
  activo: z.boolean(),
  roles: z.array(RolEmpresaSchema),
  clave: z.string().optional(),
})

export type SolicitudUsuario = z.infer<typeof SolicitudUsuarioSchema>
