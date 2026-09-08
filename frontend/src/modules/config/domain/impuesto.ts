import Decimal from 'decimal.js'
import type {
  SolicitudTarifaImpuesto,
  TarifaImpuesto,
} from '@/shared/api/contracts/impuestos'
import { vigenteEn } from '@/shared/fiscal/impuestos'

/**
 * Reglas de la tabla de impuestos (docs/13 §3 y su advertencia inicial).
 *
 * Mismo patrón que el resto del dominio: estas reglas las aplica el backend y
 * aquí se replican para dar retroalimentación inmediata en la captura. El
 * handler del mock usa esta misma función, así que el mock rechaza
 * exactamente lo que rechazará la API real.
 *
 * La regla que importa es la de las vigencias: para un mismo código y tipo,
 * a cualquier fecha rige como mucho UNA fila. Si dos se solaparan, la misma
 * factura tendría dos porcentajes posibles según el orden de la tabla.
 */

export type CodigoErrorImpuesto =
  | 'CODIGO_REQUERIDO'
  | 'CODIGO_INVALIDO'
  | 'NOMBRE_REQUERIDO'
  | 'PORCENTAJE_INVALIDO'
  | 'VIGENCIA_INVALIDA'
  | 'VIGENCIA_SOLAPADA'
  | 'TARIFA_NO_ENCONTRADA'
  | 'TARIFA_EN_USO'

export interface ErrorImpuesto {
  readonly codigo: CodigoErrorImpuesto
  readonly campo?: keyof SolicitudTarifaImpuesto
  readonly mensaje: string
}

export interface ContextoImpuesto {
  /** Tabla entera, incluida la fila que se edita. */
  readonly tarifas: readonly TarifaImpuesto[]
  /** La fila que se edita. Ausente = alta. */
  readonly tarifa?: TarifaImpuesto
}

export interface ResultadoImpuesto {
  readonly valido: boolean
  readonly errores: readonly ErrorImpuesto[]
}

/** Mayúsculas, dígitos y guion bajo: GENERAL, REDUCIDA_4. */
const CODIGO = /^[A-Z][A-Z0-9_]*$/

export function normalizarCodigoTarifa(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/\s+/g, '_')
}

function decimalDe(valor: string): Decimal | null {
  try {
    const numero = new Decimal(valor)
    return numero.isFinite() ? numero : null
  } catch {
    return null
  }
}

/** ¿Se cruzan las dos vigencias en algún día? Fin nulo = sin fin. */
export function vigenciasSeSolapan(
  a: { vigenteDesde: string; vigenteHasta: string | null },
  b: { vigenteDesde: string; vigenteHasta: string | null },
): boolean {
  const finA = a.vigenteHasta ?? '9999-12-31'
  const finB = b.vigenteHasta ?? '9999-12-31'
  return a.vigenteDesde <= finB && b.vigenteDesde <= finA
}

export function validarTarifaImpuesto(
  solicitud: SolicitudTarifaImpuesto,
  contexto: ContextoImpuesto,
): ResultadoImpuesto {
  const errores: ErrorImpuesto[] = []
  const codigo = normalizarCodigoTarifa(solicitud.codigo)

  if (!codigo) {
    errores.push({
      codigo: 'CODIGO_REQUERIDO',
      campo: 'codigo',
      mensaje: 'La tarifa requiere un código',
    })
  } else if (!CODIGO.test(codigo)) {
    errores.push({
      codigo: 'CODIGO_INVALIDO',
      campo: 'codigo',
      mensaje: 'El código lleva mayúsculas, dígitos y guion bajo: GENERAL, REDUCIDA_4',
    })
  }

  if (solicitud.nombre.trim() === '') {
    errores.push({
      codigo: 'NOMBRE_REQUERIDO',
      campo: 'nombre',
      mensaje: 'La tarifa requiere un nombre',
    })
  }

  const porcentaje = decimalDe(solicitud.porcentaje)
  if (!porcentaje || porcentaje.lessThan(0) || porcentaje.greaterThan(100)) {
    errores.push({
      codigo: 'PORCENTAJE_INVALIDO',
      campo: 'porcentaje',
      mensaje: 'El porcentaje debe estar entre 0 y 100',
    })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(solicitud.vigenteDesde)) {
    errores.push({
      codigo: 'VIGENCIA_INVALIDA',
      campo: 'vigenteDesde',
      mensaje: 'Indique desde cuándo rige la tarifa',
    })
  } else if (
    solicitud.vigenteHasta !== null &&
    solicitud.vigenteHasta < solicitud.vigenteDesde
  ) {
    errores.push({
      codigo: 'VIGENCIA_INVALIDA',
      campo: 'vigenteHasta',
      mensaje: 'El fin de la vigencia no puede ser anterior a su inicio',
    })
  } else if (codigo) {
    // Misma tarifa, mismo tipo, otra fila, y algún día en común: a esa fecha
    // habría dos porcentajes y ninguno tendría razón para ganar.
    const solapada = contexto.tarifas.find(
      (t) =>
        t.id !== contexto.tarifa?.id &&
        t.tipo === solicitud.tipo &&
        t.codigo === codigo &&
        vigenciasSeSolapan(t, solicitud),
    )
    if (solapada) {
      errores.push({
        codigo: 'VIGENCIA_SOLAPADA',
        campo: 'vigenteDesde',
        mensaje: `${codigo} ya rige entre ${solapada.vigenteDesde} y ${solapada.vigenteHasta ?? 'sin fin'}: cierre esa vigencia antes de abrir otra`,
      })
    }
  }

  return { valido: errores.length === 0, errores }
}

/** Un documento cita tarifas por línea y se emitió en una fecha. */
export interface DocumentoConTarifas {
  readonly fechaEmision: string
  readonly lineas: readonly { readonly tarifa: string }[]
}

/**
 * ¿Hay documentos calculados con esta fila?
 *
 * Cuenta las facturas que citan el código y se emitieron dentro de la
 * vigencia de la fila: esas son exactamente las que se calcularon con este
 * porcentaje, y borrarla las dejaría sin poder recalcularse igual.
 */
export function documentosQueUsan(
  tarifa: TarifaImpuesto,
  documentos: readonly DocumentoConTarifas[],
): number {
  return documentos.filter(
    (d) =>
      vigenteEn(tarifa, d.fechaEmision) &&
      d.lineas.some((l) => l.tarifa === tarifa.codigo),
  ).length
}

export function validarEliminacionTarifa(
  id: string,
  contexto: ContextoImpuesto & { documentos: readonly DocumentoConTarifas[] },
): ResultadoImpuesto {
  const tarifa = contexto.tarifas.find((t) => t.id === id)
  if (!tarifa) {
    return {
      valido: false,
      errores: [
        {
          codigo: 'TARIFA_NO_ENCONTRADA',
          mensaje: 'La tarifa no existe',
        },
      ],
    }
  }

  const usos = documentosQueUsan(tarifa, contexto.documentos)
  if (usos > 0) {
    return {
      valido: false,
      errores: [
        {
          codigo: 'TARIFA_EN_USO',
          mensaje: `${tarifa.codigo} se usó en ${usos} factura${usos === 1 ? '' : 's'} dentro de su vigencia. Desactívela o cierre su vigencia en vez de eliminarla`,
        },
      ],
    }
  }

  return { valido: true, errores: [] }
}
