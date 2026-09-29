import type { Permiso, Rol, Usuario } from '@/shared/api/contracts/auth'

/**
 * Qué puede hacer cada rol, y qué permiso pide cada operación.
 *
 * Es la única tabla de autorización del sistema. La lee el servidor (hoy el
 * mock) para rechazar, y la lee la interfaz para no ofrecer lo que se va a
 * rechazar. Que las dos lean la misma es lo que evita el botón que invita a
 * hacer algo y después contesta 403.
 */

export const ETIQUETA_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  contador: 'Contador',
  auxiliar: 'Auxiliar contable',
  planilla: 'Planilla',
  consulta: 'Consulta',
}

export const DESCRIPCION_ROL: Record<Rol, string> = {
  administrador: 'Todo, incluidos usuarios y planilla',
  contador: 'Todo lo contable: captura, catálogo, cierres y configuración',
  auxiliar: 'Documentos del día: facturas, cobros, pagos, bancos y activos',
  planilla: 'Solo recursos humanos: empleados, planilla y su pago',
  consulta: 'Ver y sacar reportes, sin cambiar nada',
}

const TODOS: readonly Permiso[] = [
  'contabilidad.capturar',
  'contabilidad.catalogo',
  'contabilidad.cerrar',
  'contabilidad.reabrir',
  'operaciones',
  'configuracion',
  'usuarios',
  'planilla.ver',
  'planilla.operar',
]

/**
 * Los datos salariales no vienen con "ver todo" (docs/08 §7): el contador no
 * los ve por serlo. Solo el administrador y quien lleva la planilla.
 */
export const PERMISOS_POR_ROL: Record<Rol, readonly Permiso[]> = {
  administrador: TODOS,
  contador: [
    'contabilidad.capturar',
    'contabilidad.catalogo',
    'contabilidad.cerrar',
    'contabilidad.reabrir',
    'operaciones',
    'configuracion',
  ],
  auxiliar: ['operaciones'],
  planilla: ['planilla.ver', 'planilla.operar'],
  consulta: [],
}

export function rolEn(usuario: Usuario | null | undefined, empresaId: string): Rol | null {
  return usuario?.roles.find((r) => r.empresaId === empresaId)?.rol ?? null
}

export function puede(rol: Rol | null, permiso: Permiso): boolean {
  return rol !== null && PERMISOS_POR_ROL[rol].includes(permiso)
}

/** Empresas que el usuario puede abrir: las que le dan un rol. */
export function empresasDe(usuario: Usuario): string[] {
  return usuario.roles.map((r) => r.empresaId)
}

/**
 * Qué permiso pide una operación de la API.
 *
 * Por prefijo de ruta y método. Las lecturas no piden nada salvo las de
 * planilla y usuarios: cualquiera con rol en la empresa ve su contabilidad,
 * pero no los salarios ni quién puede entrar.
 *
 * `null` = basta con tener rol en la empresa.
 */
export function permisoDeOperacion(metodo: string, ruta: string): Permiso | null {
  const lectura = metodo === 'GET'

  if (ruta.startsWith('/auth/usuarios')) return 'usuarios'
  if (ruta.startsWith('/rh')) return lectura ? 'planilla.ver' : 'planilla.operar'
  if (lectura) return null

  if (ruta.startsWith('/conta/periodos/') && ruta.endsWith('/reabrir')) {
    return 'contabilidad.reabrir'
  }
  if (ruta.startsWith('/conta/periodos/') || ruta.startsWith('/conta/ejercicios/')) {
    return 'contabilidad.cerrar'
  }
  if (ruta.startsWith('/conta/asientos')) return 'contabilidad.capturar'
  if (ruta.startsWith('/conta/')) return 'contabilidad.catalogo'
  if (
    ruta.startsWith('/config') ||
    ruta.startsWith('/impuestos') ||
    ruta.startsWith('/empresas')
  ) {
    return 'configuracion'
  }
  // Todo lo demás que escribe es un documento de un módulo.
  return 'operaciones'
}
