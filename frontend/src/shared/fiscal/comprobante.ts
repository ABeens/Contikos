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

/**
 * Situación del comprobante al emitirse (docs/13 §4.2): normal, en
 * contingencia (Hacienda no respondía) o sin internet.
 */
export const SITUACION_COMPROBANTE = {
  normal: '1',
  contingencia: '2',
  sinInternet: '3',
} as const

export type SituacionComprobante =
  (typeof SITUACION_COMPROBANTE)[keyof typeof SITUACION_COMPROBANTE]

/** Código de país de Costa Rica en la clave. */
const CODIGO_PAIS = '506'

/**
 * Clave numérica del comprobante: 50 dígitos (docs/13 §4.2).
 *
 *   [3 país][2 día][2 mes][2 año][12 cédula emisor]
 *   [20 consecutivo][1 situación][8 código de seguridad]
 *
 * El código de seguridad lo pone quien emite, aleatorio; se recibe como
 * parámetro para que la función sea pura y se pueda probar. La fecha es la de
 * emisión del comprobante, no la de hoy.
 */
export function generarClaveNumerica({
  fecha,
  identificacionEmisor,
  consecutivo,
  situacion = SITUACION_COMPROBANTE.normal,
  codigoSeguridad,
}: {
  fecha: string
  identificacionEmisor: string
  consecutivo: string
  situacion?: SituacionComprobante
  codigoSeguridad: string
}): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error(`Fecha inválida para la clave: "${fecha}"`)
  }
  if (!/^\d{20}$/.test(consecutivo)) {
    throw new Error(`El consecutivo de la clave tiene 20 dígitos (recibido "${consecutivo}")`)
  }
  if (!/^\d{8}$/.test(codigoSeguridad)) {
    throw new Error('El código de seguridad tiene 8 dígitos')
  }
  const [anio, mes, dia] = fecha.split('-')
  return (
    CODIGO_PAIS +
    dia +
    mes +
    anio.slice(2) +
    soloDigitos(identificacionEmisor, 12, 'La identificación del emisor') +
    consecutivo +
    situacion +
    codigoSeguridad
  )
}

/** Ocho dígitos aleatorios, con el generador criptográfico del entorno. */
export function codigoSeguridadAleatorio(): string {
  const valor = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000
  return String(valor).padStart(8, '0')
}
