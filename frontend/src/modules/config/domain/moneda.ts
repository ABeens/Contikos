import Decimal from 'decimal.js'
import type {
  MonedaBase,
  MonedaConfig,
  SolicitudMoneda,
} from '@/shared/api/contracts/config'

/**
 * Reglas del catálogo de monedas.
 *
 * Mismo patrón que `modules/conta/domain/asiento.ts`: estas reglas las aplica
 * el backend, y aquí se replican para dar retroalimentación inmediata durante
 * la captura, NO para sustituirlas. El handler de MSW usa esta misma función,
 * de modo que el mock rechace exactamente lo que rechazará la API real.
 */

export type CodigoErrorMoneda =
  | 'CODIGO_INVALIDO'
  | 'CODIGO_DUPLICADO'
  | 'MONEDA_NO_ENCONTRADA'
  | 'NOMBRE_REQUERIDO'
  | 'SIMBOLO_REQUERIDO'
  | 'DECIMALES_INVALIDOS'
  | 'SEPARADORES_IGUALES'
  | 'TIPO_CAMBIO_INVALIDO'
  | 'FUNCIONAL_TIPO_CAMBIO'
  | 'FUNCIONAL_INACTIVA'
  | 'FUNCIONAL_UNICA'
  | 'MONEDA_EN_USO'

export interface ErrorMonedaConfig {
  readonly codigo: CodigoErrorMoneda
  /** Campo del formulario al que apunta el error, si aplica. */
  readonly campo?: keyof SolicitudMoneda
  readonly mensaje: string
}

export interface ContextoMoneda {
  /** Catálogo vigente, incluida la moneda que se edita. */
  readonly monedas: readonly MonedaBase[]
  /** true si ya hay asientos o cuentas que la referencian. */
  readonly enUso?: boolean
}

export interface ResultadoMoneda {
  readonly valido: boolean
  readonly errores: readonly ErrorMonedaConfig[]
}

/**
 * Proyecta una moneda del catálogo al cuerpo de la solicitud.
 *
 * Deja fuera lo que la pantalla no decide: `funcional` tiene su propio endpoint
 * y `enUso` lo calcula el servidor.
 */
export function aSolicitud(moneda: MonedaConfig): SolicitudMoneda {
  return {
    codigo: moneda.codigo,
    nombre: moneda.nombre,
    simbolo: moneda.simbolo,
    decimales: moneda.decimales,
    grupo: moneda.grupo,
    decimal: moneda.decimal,
    posicionSimbolo: moneda.posicionSimbolo,
    activa: moneda.activa,
    tipoCambio: moneda.tipoCambio,
  }
}

const CODIGO_ISO = /^[A-Z]{3}$/
const DECIMALES_MAX = 6

function resultado(errores: ErrorMonedaConfig[]): ResultadoMoneda {
  return { valido: errores.length === 0, errores }
}

function tipoCambioDe(valor: string): Decimal | null {
  try {
    return new Decimal(valor)
  } catch {
    return null
  }
}

/**
 * Valida un alta o una modificación.
 *
 * `creando` distingue los dos casos: al crear, el código no puede existir; al
 * editar, tiene que existir — el código es la llave del catálogo y no se cambia
 * (renombrarlo dejaría huérfanos los asientos históricos).
 */
export function validarMoneda(
  solicitud: SolicitudMoneda,
  contexto: ContextoMoneda,
  creando: boolean,
): ResultadoMoneda {
  const errores: ErrorMonedaConfig[] = []
  const codigo = solicitud.codigo.trim().toUpperCase()

  if (!CODIGO_ISO.test(codigo)) {
    errores.push({
      codigo: 'CODIGO_INVALIDO',
      campo: 'codigo',
      mensaje: 'El código debe ser el ISO 4217 de tres letras: CRC, USD, EUR',
    })
  }

  const existente = contexto.monedas.find((m) => m.codigo === codigo)

  if (creando && existente) {
    errores.push({
      codigo: 'CODIGO_DUPLICADO',
      campo: 'codigo',
      mensaje: `La moneda ${codigo} ya está en el catálogo`,
    })
  }
  if (!creando && !existente) {
    errores.push({
      codigo: 'MONEDA_NO_ENCONTRADA',
      campo: 'codigo',
      mensaje: `La moneda ${codigo} no está en el catálogo`,
    })
  }

  if (solicitud.nombre.trim() === '') {
    errores.push({
      codigo: 'NOMBRE_REQUERIDO',
      campo: 'nombre',
      mensaje: 'El nombre es obligatorio',
    })
  }

  if (solicitud.simbolo.trim() === '') {
    errores.push({
      codigo: 'SIMBOLO_REQUERIDO',
      campo: 'simbolo',
      mensaje: 'El símbolo es obligatorio',
    })
  }

  if (
    !Number.isInteger(solicitud.decimales) ||
    solicitud.decimales < 0 ||
    solicitud.decimales > DECIMALES_MAX
  ) {
    errores.push({
      codigo: 'DECIMALES_INVALIDOS',
      campo: 'decimales',
      mensaje: `Los decimales deben ser un entero entre 0 y ${DECIMALES_MAX}`,
    })
  }

  // Con el mismo carácter en ambos, ₡1.234.567 y ₡1.234,567 serían el mismo
  // texto: el importe deja de poder leerse sin ambigüedad.
  if (solicitud.grupo !== '' && solicitud.grupo === solicitud.decimal) {
    errores.push({
      codigo: 'SEPARADORES_IGUALES',
      campo: 'grupo',
      mensaje: 'El separador de miles y el decimal no pueden ser el mismo',
    })
  }

  const tc = tipoCambioDe(solicitud.tipoCambio)
  if (tc === null || tc.lessThanOrEqualTo(0)) {
    errores.push({
      codigo: 'TIPO_CAMBIO_INVALIDO',
      campo: 'tipoCambio',
      mensaje: 'El tipo de cambio debe ser mayor que cero',
    })
  } else if (existente?.funcional && !tc.equals(1)) {
    errores.push({
      codigo: 'FUNCIONAL_TIPO_CAMBIO',
      campo: 'tipoCambio',
      mensaje:
        'La moneda funcional se cambia a sí misma a la par: su tipo de cambio es 1',
    })
  }

  if (existente?.funcional && !solicitud.activa) {
    errores.push({
      codigo: 'FUNCIONAL_INACTIVA',
      campo: 'activa',
      mensaje:
        'La moneda funcional no se puede desactivar: es la del libro mayor',
    })
  }

  // El catálogo pierde sentido si una moneda en uso cambia de decimales: los
  // importes ya contabilizados se redondearían distinto al presentarse.
  if (contexto.enUso && existente && existente.decimales !== solicitud.decimales) {
    errores.push({
      codigo: 'MONEDA_EN_USO',
      campo: 'decimales',
      mensaje:
        'No se pueden cambiar los decimales de una moneda que ya tiene movimientos',
    })
  }

  return resultado(errores)
}

/** Reglas para retirar una moneda del catálogo. */
export function validarEliminacion(
  codigo: string,
  contexto: ContextoMoneda,
): ResultadoMoneda {
  const errores: ErrorMonedaConfig[] = []
  const existente = contexto.monedas.find((m) => m.codigo === codigo)

  if (!existente) {
    errores.push({
      codigo: 'MONEDA_NO_ENCONTRADA',
      mensaje: `La moneda ${codigo} no está en el catálogo`,
    })
    return resultado(errores)
  }

  if (existente.funcional) {
    errores.push({
      codigo: 'FUNCIONAL_UNICA',
      mensaje:
        'La moneda funcional no se elimina. Antes debe designarse otra como funcional',
    })
  }

  // Borrar una moneda con movimientos dejaría asientos que no se pueden
  // formatear ni revaluar. Se desactiva, no se borra.
  if (contexto.enUso) {
    errores.push({
      codigo: 'MONEDA_EN_USO',
      mensaje: `${codigo} tiene movimientos o cuentas asociadas. Desactívela en vez de eliminarla`,
    })
  }

  return resultado(errores)
}

/** Reglas para designar la moneda funcional. */
export function validarFuncional(
  codigo: string,
  contexto: ContextoMoneda,
): ResultadoMoneda {
  const errores: ErrorMonedaConfig[] = []
  const existente = contexto.monedas.find((m) => m.codigo === codigo)

  if (!existente) {
    errores.push({
      codigo: 'MONEDA_NO_ENCONTRADA',
      mensaje: `La moneda ${codigo} no está en el catálogo`,
    })
    return resultado(errores)
  }

  if (!existente.activa) {
    errores.push({
      codigo: 'FUNCIONAL_INACTIVA',
      mensaje: 'Una moneda inactiva no puede ser la funcional',
    })
  }

  return resultado(errores)
}

/**
 * Aplica el cambio de moneda funcional sobre el catálogo.
 *
 * Devuelve un catálogo nuevo: la marca se mueve y el tipo de cambio de la nueva
 * funcional pasa a 1. Los de las demás quedan como estaban — reexpresarlos es
 * una decisión contable, no un efecto colateral de la pantalla.
 */
export function aplicarFuncional<T extends MonedaBase>(
  codigo: string,
  monedas: readonly T[],
): T[] {
  return monedas.map((m) => ({
    ...m,
    funcional: m.codigo === codigo,
    tipoCambio: m.codigo === codigo ? '1' : m.tipoCambio,
  }))
}
