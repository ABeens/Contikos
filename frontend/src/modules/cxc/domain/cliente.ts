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
import { ubicacionValida } from '@/shared/fiscal/ubicaciones'
import type { ClienteBase, SolicitudCliente } from '@/shared/api/contracts/cxc'

/**
 * Reglas del maestro de clientes (docs/04 §1, docs/13 §4).
 *
 * Es la misma función que usa el mock, para que la pantalla y la API rechacen
 * exactamente lo mismo. Los datos de facturación electrónica (teléfono,
 * ubicación, actividad) son opcionales: se puede facturar sin ellos mientras
 * no exista la emisión, pero si se capturan tienen que tener la forma que el
 * XML exige, porque el rechazo de Hacienda llegaría mucho después.
 */

export type CodigoErrorCliente =
  | 'CODIGO_REQUERIDO'
  | 'CODIGO_DUPLICADO'
  | 'RAZON_SOCIAL_REQUERIDA'
  | 'IDENTIFICACION_INVALIDA'
  | 'IDENTIFICACION_DUPLICADA'
  | 'CORREO_INVALIDO'
  | 'TELEFONO_INVALIDO'
  | 'UBICACION_INVALIDA'
  | 'ACTIVIDAD_INVALIDA'
  | 'CREDITO_INVALIDO'
  | 'MONEDA_INVALIDA'

export interface ErrorCliente {
  readonly codigo: CodigoErrorCliente
  readonly campo?: keyof SolicitudCliente
  readonly mensaje: string
}

export interface ContextoCliente {
  readonly clientes: readonly ClienteBase[]
  /** El que se edita. Ausente = alta. */
  readonly cliente?: ClienteBase
}

export interface ResultadoCliente {
  readonly valido: boolean
  readonly errores: readonly ErrorCliente[]
}

function decimalDe(valor: string): Decimal | null {
  try {
    const numero = new Decimal(valor)
    return numero.isFinite() ? numero : null
  } catch {
    return null
  }
}

/**
 * ¿Tiene todo lo que el comprobante electrónico pide del receptor?
 *
 * Correo (para entregárselo), teléfono, ubicación y actividad económica. La
 * identificación ya es obligatoria siempre. Es la misma regla que aplicará
 * la emisión, así que la lista puede marcar a quién hay que completar.
 */
export function listoParaFe(
  cliente: Pick<
    SolicitudCliente,
    'correo' | 'telefono' | 'ubicacion' | 'actividadEconomica'
  >,
): boolean {
  return Boolean(
    cliente.correo?.trim() &&
      cliente.telefono &&
      cliente.ubicacion &&
      cliente.actividadEconomica,
  )
}

export function validarCliente(
  solicitud: SolicitudCliente,
  contexto: ContextoCliente,
): ResultadoCliente {
  const errores: ErrorCliente[] = []
  const codigo = solicitud.codigo.trim()
  const identificacion = normalizarIdentificacion(solicitud.identificacion)
  const otros = contexto.clientes.filter((c) => c.id !== contexto.cliente?.id)

  if (!codigo) {
    errores.push({
      codigo: 'CODIGO_REQUERIDO',
      campo: 'codigo',
      mensaje: 'El código es obligatorio',
    })
  } else if (
    otros.some((c) => c.codigo.trim().toLowerCase() === codigo.toLowerCase())
  ) {
    errores.push({
      codigo: 'CODIGO_DUPLICADO',
      campo: 'codigo',
      mensaje: `Ya existe un cliente con el código ${codigo}`,
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
  } else if (otros.some((c) => c.identificacion === identificacion)) {
    // La identificación es la llave real del contribuyente: repetirla produce
    // dos auxiliares para el mismo deudor y un aging que no se puede cobrar.
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

  if (solicitud.ubicacion) {
    const u = solicitud.ubicacion
    if (!ubicacionValida(u.provincia, u.canton, u.distrito)) {
      errores.push({
        codigo: 'UBICACION_INVALIDA',
        campo: 'ubicacion',
        mensaje: 'Elija provincia, cantón y distrito del catálogo',
      })
    } else if (u.otrasSenas.trim() === '') {
      errores.push({
        codigo: 'UBICACION_INVALIDA',
        campo: 'ubicacion',
        mensaje: 'Las otras señas son obligatorias en la dirección',
      })
    }
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
  const limite = decimalDe(solicitud.limiteCredito)
  if (!limite || limite.lessThan(0)) {
    errores.push({
      codigo: 'CREDITO_INVALIDO',
      campo: 'limiteCredito',
      mensaje: 'El límite de crédito no puede ser negativo',
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
