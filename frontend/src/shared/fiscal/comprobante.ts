/**
 * Numeración de comprobantes electrónicos, Costa Rica (docs/13 §4.2).
 *
 * El consecutivo tiene 20 dígitos y lo genera el emisor:
 *
 *   [3 casa matriz][5 terminal][2 tipo de documento][10 consecutivo]
 *
 * Es distinto del número interno del sistema (`FV-000123`), que es el que la
 * empresa usa para buscar y ordenar. Los dos conviven en la factura: el
 * interno lo asigna el sistema y nunca se edita; el del comprobante es el que
 * viaja a Hacienda y al cliente.
 *
 * La clave numérica de 50 dígitos se construirá cuando exista la facturación
 * electrónica: necesita la cédula del emisor, la situación y un código de
 * seguridad aleatorio, y no tiene sentido inventarla sin firmar el XML.
 */

/** Tipos de documento del catálogo de Hacienda (docs/13 §4.1). */
export const TIPO_DOCUMENTO_HACIENDA = {
  /** Factura electrónica */
  FE: '01',
  /** Nota de débito electrónica */
  ND: '02',
  /** Nota de crédito electrónica */
  NC: '03',
  /** Tiquete electrónico */
  TE: '04',
  /** Factura electrónica de compra */
  FEC: '08',
  /** Factura electrónica de exportación */
  FEE: '09',
  /** Recibo electrónico de pago */
  REP: '10',
} as const

export type TipoDocumentoHacienda =
  (typeof TIPO_DOCUMENTO_HACIENDA)[keyof typeof TIPO_DOCUMENTO_HACIENDA]

export const LONGITUD_CONSECUTIVO = 20

const LONGITUD_SUCURSAL = 3
const LONGITUD_TERMINAL = 5
const LONGITUD_TIPO = 2
const LONGITUD_NUMERO = 10

function soloDigitos(valor: string, longitud: number, nombre: string): string {
  const limpio = valor.replace(/\D/g, '')
  if (limpio.length === 0 || limpio.length > longitud) {
    throw new Error(
      `${nombre} debe tener entre 1 y ${longitud} dígitos (recibido "${valor}")`,
    )
  }
  return limpio.padStart(longitud, '0')
}

/**
 * Consecutivo de 20 dígitos de un comprobante.
 *
 * `sucursal` y `terminal` se completan con ceros a la izquierda; `n` es el
 * número correlativo, sin huecos y por terminal. Lanza si algo no cabe: un
 * consecutivo mal formado no es un comprobante válido y es mejor fallar al
 * generarlo que al enviarlo.
 */
export function formatearConsecutivoHacienda(
  sucursal: string,
  terminal: string,
  tipoDoc: string,
  n: number,
): string {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`El consecutivo debe ser un entero positivo (recibido ${n})`)
  }
  const numero = String(n)
  if (numero.length > LONGITUD_NUMERO) {
    throw new Error(`El consecutivo ${n} excede los ${LONGITUD_NUMERO} dígitos`)
  }
  return (
    soloDigitos(sucursal, LONGITUD_SUCURSAL, 'La casa matriz') +
    soloDigitos(terminal, LONGITUD_TERMINAL, 'La terminal') +
    soloDigitos(tipoDoc, LONGITUD_TIPO, 'El tipo de documento') +
    numero.padStart(LONGITUD_NUMERO, '0')
  )
}

export interface PartesConsecutivo {
  readonly sucursal: string
  readonly terminal: string
  readonly tipoDoc: string
  readonly numero: number
}

/** Inverso de `formatearConsecutivoHacienda`. Nulo si no tiene la forma. */
export function descomponerConsecutivo(
  consecutivo: string,
): PartesConsecutivo | null {
  if (!/^\d{20}$/.test(consecutivo)) return null
  return {
    sucursal: consecutivo.slice(0, 3),
    terminal: consecutivo.slice(3, 8),
    tipoDoc: consecutivo.slice(8, 10),
    numero: Number(consecutivo.slice(10)),
  }
}

/**
 * Presentación del consecutivo con separadores: 001-00001-01-0000000113.
 *
 * Solo para pantalla. El XML y el almacenamiento llevan los 20 dígitos
 * seguidos.
 */
export function formatConsecutivo(consecutivo: string): string {
  const partes = descomponerConsecutivo(consecutivo)
  if (!partes) return consecutivo
  return `${partes.sucursal}-${partes.terminal}-${partes.tipoDoc}-${consecutivo.slice(10)}`
}

/** Número interno correlativo: FV-000123. */
export function formatearNumeroInterno(prefijo: string, n: number): string {
  return `${prefijo}-${String(n).padStart(6, '0')}`
}
