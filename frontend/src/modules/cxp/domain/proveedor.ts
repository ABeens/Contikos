import Decimal from 'decimal.js'
import { esMonedaRegistrada } from '@/shared/money/money'
import {
  normalizarIdentificacion,
  validarIdentificacion,
} from '@/shared/fiscal/identificacion'
import {
  validarActividadEconomica,
  validarCorreo,
  validarTelefono,
} from '@/shared/fiscal/contacto'
import type {
  ProveedorBase,
  SolicitudProveedor,
} from '@/shared/api/contracts/cxp'

/**
 * Reglas del maestro de proveedores (docs/05 §1, docs/13 §4.4).
 *
 * Espejo del de clientes, con menos datos: al proveedor no se le vende, así
 * que no lleva condición de venta ni ubicación de receptor. Lo que sí lleva
 * es lo que el buzón de comprobantes recibidos necesita para responderle a
 * Hacienda: identificación, correo, teléfono y actividad.
 */

export type CodigoErrorProveedor =
  | 'CODIGO_REQUERIDO'
  | 'CODIGO_DUPLICADO'
  | 'RAZON_SOCIAL_REQUERIDA'
  | 'IDENTIFICACION_INVALIDA'
  | 'IDENTIFICACION_DUPLICADA'
  | 'CORREO_INVALIDO'
  | 'TELEFONO_INVALIDO'
  | 'ACTIVIDAD_INVALIDA'
  | 'CREDITO_INVALIDO'
  | 'RETENCION_INVALIDA'
  | 'MONEDA_INVALIDA'

export interface ErrorProveedor {
  readonly codigo: CodigoErrorProveedor
  readonly campo?: keyof SolicitudProveedor
  readonly mensaje: string
}

export interface ContextoProveedor {
  readonly proveedores: readonly ProveedorBase[]
  /** El que se edita. Ausente = alta. */
  readonly proveedor?: ProveedorBase
}

export interface ResultadoProveedor {
  readonly valido: boolean
  readonly errores: readonly ErrorProveedor[]
}

function decimalDe(valor: string): Decimal | null {
  try {
    const numero = new Decimal(valor)
    return numero.isFinite() ? numero : null
  } catch {
    return null
  }
}

export function validarProveedor(
  solicitud: SolicitudProveedor,
  contexto: ContextoProveedor,
): ResultadoProveedor {
  const errores: ErrorProveedor[] = []
  const codigo = solicitud.codigo.trim()
  const identificacion = normalizarIdentificacion(solicitud.identificacion)
  const otros = contexto.proveedores.filter(
    (p) => p.id !== contexto.proveedor?.id,
  )

  if (!codigo) {
    errores.push({
      codigo: 'CODIGO_REQUERIDO',
      campo: 'codigo',
      mensaje: 'El código es obligatorio',
    })
  } else if (
    otros.some((p) => p.codigo.trim().toLowerCase() === codigo.toLowerCase())
  ) {
    errores.push({
      codigo: 'CODIGO_DUPLICADO',
      campo: 'codigo',
      mensaje: `Ya existe un proveedor con el código ${codigo}`,
    })
  }

  if (solicitud.razonSocial.trim() === '') {
    errores.push({
      codigo: 'RAZON_SOCIAL_REQUERIDA',
      campo: 'razonSocial',
      mensaje: 'La razón social es obligatoria',
    })
  }

  const cedula = validarIdentificacion(identificacion, solicitud.tipoIdentificacion)
  if (!cedula.valido) {
    errores.push({
      codigo: 'IDENTIFICACION_INVALIDA',
      campo: 'identificacion',
      mensaje: cedula.error ?? 'Identificación inválida',
    })
  } else if (otros.some((p) => p.identificacion === identificacion)) {
    errores.push({
      codigo: 'IDENTIFICACION_DUPLICADA',
      campo: 'identificacion',
      mensaje: `La identificación ${identificacion} ya está registrada`,
    })
  }

  const correo = validarCorreo(solicitud.correo)
  if (correo) {
    errores.push({ codigo: 'CORREO_INVALIDO', campo: 'correo', mensaje: correo })
  }

  const telefono = validarTelefono(solicitud.telefono)
  if (telefono) {
    errores.push({ codigo: 'TELEFONO_INVALIDO', campo: 'telefono', mensaje: telefono })
  }

  const actividad = validarActividadEconomica(solicitud.actividadEconomica)
  if (actividad) {
    errores.push({
      codigo: 'ACTIVIDAD_INVALIDA',
      campo: 'actividadEconomica',
      mensaje: actividad,
    })
  }

  if (!Number.isInteger(solicitud.diasCredito) || solicitud.diasCredito < 0) {
    errores.push({
      codigo: 'CREDITO_INVALIDO',
      campo: 'diasCredito',
      mensaje: 'Los días de crédito no pueden ser negativos',
    })
  }

  // La retención es un porcentaje: fuera de 0..100 no significa nada, y una
  // retención mal tecleada se descuenta de cada factura sin que nadie la vea.
  const retencion = decimalDe(solicitud.retencionRenta)
  if (!retencion || retencion.lessThan(0) || retencion.greaterThan(100)) {
    errores.push({
      codigo: 'RETENCION_INVALIDA',
      campo: 'retencionRenta',
      mensaje: 'La retención de renta es un porcentaje entre 0 y 100',
    })
  }

  if (!esMonedaRegistrada(solicitud.moneda)) {
    errores.push({
      codigo: 'MONEDA_INVALIDA',
      campo: 'moneda',
      mensaje: `La moneda ${solicitud.moneda} no está en el catálogo`,
    })
  }

  return { valido: errores.length === 0, errores }
}
