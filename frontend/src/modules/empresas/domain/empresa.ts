import type { Empresa, SolicitudEmpresa } from '@/shared/api/contracts/empresas'
import {
  normalizarIdentificacion,
  validarIdentificacion,
} from '@/shared/fiscal/identificacion'

/**
 * Reglas del catálogo de empresas.
 *
 * Mismo patrón que `modules/config/domain/moneda.ts`: las aplica el backend y
 * aquí se replican para dar retroalimentación inmediata durante la captura,
 * no para sustituirlas. El handler del mock usa esta misma función, de modo
 * que rechace exactamente lo que rechazará la API real.
 */

export type CodigoErrorEmpresa =
  | 'CODIGO_REQUERIDO'
  | 'CODIGO_DUPLICADO'
  | 'NOMBRE_REQUERIDO'
  | 'IDENTIFICACION_INVALIDA'
  | 'IDENTIFICACION_DUPLICADA'
  | 'EJERCICIO_INVALIDO'
  | 'EMPRESA_NO_ENCONTRADA'
  | 'EMPRESA_ABIERTA_INACTIVA'

export interface ErrorEmpresa {
  readonly codigo: CodigoErrorEmpresa
  /** Campo del formulario al que apunta el error, si aplica. */
  readonly campo?: keyof SolicitudEmpresa
  readonly mensaje: string
}

export interface ContextoEmpresas {
  /** Catálogo vigente, incluida la empresa que se edita. */
  readonly empresas: readonly Empresa[]
  /** La que está abierta en esta sesión. No se puede desactivar desde dentro. */
  readonly empresaAbierta: string
}

export interface ResultadoEmpresa {
  readonly valido: boolean
  readonly errores: readonly ErrorEmpresa[]
}

export const MESES: readonly string[] = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

const CODIGO_MAX = 8

/** Proyecta una empresa del catálogo al cuerpo de la solicitud. */
export function aSolicitud(empresa: Empresa): SolicitudEmpresa {
  return {
    codigo: empresa.codigo,
    nombre: empresa.nombre,
    nombreComercial: empresa.nombreComercial,
    tipoIdentificacion: empresa.tipoIdentificacion,
    identificacion: empresa.identificacion,
    pais: empresa.pais,
    ejercicioInicioMes: empresa.ejercicioInicioMes,
    activa: empresa.activa,
  }
}

/**
 * Normaliza lo que se teclea antes de validar o guardar.
 *
 * El código va en mayúsculas y sin espacios porque es una sigla, y la
 * identificación sin separadores porque así se almacena y así se compara.
 */
export function normalizarSolicitud(
  solicitud: SolicitudEmpresa,
): SolicitudEmpresa {
  return {
    ...solicitud,
    codigo: solicitud.codigo.trim().toUpperCase(),
    nombre: solicitud.nombre.trim(),
    nombreComercial: solicitud.nombreComercial?.trim() || null,
    identificacion: normalizarIdentificacion(solicitud.identificacion),
  }
}

/**
 * Valida un alta (sin `id`) o una modificación (con el `id` de la editada).
 *
 * El código y la cédula son únicos en el grupo: dos empresas con la misma
 * cédula jurídica son la misma empresa, y dos con la misma sigla no se
 * distinguen en el selector.
 */
export function validarEmpresa(
  solicitud: SolicitudEmpresa,
  contexto: ContextoEmpresas,
  id?: string,
): ResultadoEmpresa {
  const errores: ErrorEmpresa[] = []
  const datos = normalizarSolicitud(solicitud)
  const otras = contexto.empresas.filter((e) => e.id !== id)

  if (id !== undefined && !contexto.empresas.some((e) => e.id === id)) {
    errores.push({
      codigo: 'EMPRESA_NO_ENCONTRADA',
      mensaje: 'La empresa no existe',
    })
  }

  if (datos.codigo === '') {
    errores.push({
      codigo: 'CODIGO_REQUERIDO',
      campo: 'codigo',
      mensaje: 'Las siglas son obligatorias',
    })
  } else if (datos.codigo.length > CODIGO_MAX) {
    errores.push({
      codigo: 'CODIGO_REQUERIDO',
      campo: 'codigo',
      mensaje: `Las siglas tienen como máximo ${CODIGO_MAX} caracteres`,
    })
  } else if (otras.some((e) => e.codigo.toUpperCase() === datos.codigo)) {
    errores.push({
      codigo: 'CODIGO_DUPLICADO',
      campo: 'codigo',
      mensaje: `Ya hay una empresa con las siglas ${datos.codigo}`,
    })
  }

  if (datos.nombre === '') {
    errores.push({
      codigo: 'NOMBRE_REQUERIDO',
      campo: 'nombre',
      mensaje: 'La razón social es obligatoria',
    })
  }

  const identificacion = validarIdentificacion(
    datos.identificacion,
    datos.tipoIdentificacion,
  )
  if (!identificacion.valido) {
    errores.push({
      codigo: 'IDENTIFICACION_INVALIDA',
      campo: 'identificacion',
      mensaje: identificacion.error ?? 'Identificación inválida',
    })
  } else if (
    otras.some(
      (e) =>
        e.tipoIdentificacion === datos.tipoIdentificacion &&
        e.identificacion === datos.identificacion,
    )
  ) {
    errores.push({
      codigo: 'IDENTIFICACION_DUPLICADA',
      campo: 'identificacion',
      mensaje: `La identificación ${datos.identificacion} ya es de otra empresa del grupo`,
    })
  }

  if (
    !Number.isInteger(datos.ejercicioInicioMes) ||
    datos.ejercicioInicioMes < 1 ||
    datos.ejercicioInicioMes > 12
  ) {
    errores.push({
      codigo: 'EJERCICIO_INVALIDO',
      campo: 'ejercicioInicioMes',
      mensaje: 'El mes de inicio del ejercicio debe estar entre 1 y 12',
    })
  }

  if (id !== undefined && id === contexto.empresaAbierta && !datos.activa) {
    errores.push({
      codigo: 'EMPRESA_ABIERTA_INACTIVA',
      campo: 'activa',
      mensaje:
        'La empresa abierta no se puede desactivar: cambie a otra empresa primero',
    })
  }

  return { valido: errores.length === 0, errores }
}

/** Las que se ofrecen en el selector: activas, la abierta siempre incluida. */
export function empresasAbribles(
  empresas: readonly Empresa[],
  empresaAbierta: string,
): Empresa[] {
  return empresas.filter((e) => e.activa || e.id === empresaAbierta)
}
