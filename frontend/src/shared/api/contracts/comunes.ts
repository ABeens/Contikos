import { z } from 'zod'
import type { IdTarifaIva } from '@/shared/fiscal/iva'
import type { TipoIdentificacion } from '@/shared/fiscal/identificacion'

/**
 * Importe monetario en el contrato de API.
 *
 * SIEMPRE string. Nunca `z.number()`.
 *
 * JSON.parse convierte cualquier número a doble precisión IEEE-754, y ahí la
 * precisión ya se perdió — antes de que el frontend pueda hacer nada. Un total
 * de ₡99.999.999.999.999,99 no sobrevive el viaje como number.
 *
 * Ver docs/14-arquitectura-frontend.md §4.
 */
export const Importe = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Importe inválido: debe ser un decimal en texto')

/** Fecha contable: un día, sin hora ni zona. */
export const FechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida: se espera yyyy-MM-dd')

/**
 * Código de moneda ISO 4217.
 *
 * No es un `z.enum` a propósito: el catálogo de monedas lo configura la empresa
 * (docs/10 §2 — entidad `Moneda`). El contrato valida la FORMA del código; qué
 * monedas existen es un dato, no una decisión de compilación.
 */
export const MonedaSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Moneda inválida: se espera un código ISO 4217')

/**
 * Libro contable.
 *
 * La empresa lleva **dos contabilidades sobre el mismo catálogo de cuentas**:
 *
 * - `fiscal`: la que se declara ante Hacienda. Sigue las reglas tributarias.
 * - `corporativo`: la que mide el negocio de verdad. Sigue NIIF para PYMES.
 *
 * Casi todo hecho económico entra igual en las dos, así que **el asiento es uno
 * solo** y cada línea declara a qué libros afecta. Omitir `libros` significa
 * ambos: el caso normal no requiere que nadie decida nada (docs/02 §3.1).
 *
 * Esto NO es un enum abierto como la moneda. Son exactamente dos libros y el
 * código depende de esa cardinalidad: la balanza, el cierre y los estados
 * financieros se emiten por libro, no por una lista arbitraria.
 */
export const LibroSchema = z.enum(['fiscal', 'corporativo'])

export type Libro = z.infer<typeof LibroSchema>

/** El orden es significativo: el fiscal manda en lo que se muestra primero. */
export const LIBROS_TODOS: readonly Libro[] = ['fiscal', 'corporativo']

export const AuxiliarTipoSchema = z.enum([
  'cliente',
  'proveedor',
  'empleado',
  'activo',
  'banco',
])

export const ModuloSchema = z.enum([
  'conta',
  'cxc',
  'cxp',
  'bancos',
  'activos',
  'rh',
])

export type Modulo = z.infer<typeof ModuloSchema>
export type AuxiliarTipo = z.infer<typeof AuxiliarTipoSchema>

/** Error de negocio devuelto por la API. Los códigos son los de docs/02 §3. */
export const ErrorApiSchema = z.object({
  codigo: z.string(),
  mensaje: z.string(),
  detalles: z.array(z.string()).optional(),
})

export type ErrorApi = z.infer<typeof ErrorApiSchema>

export function paginado<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    datos: z.array(item),
    total: z.number().int(),
    pagina: z.number().int(),
    porPagina: z.number().int(),
  })
}

/**
 * Cantidad de una línea de documento (unidades, horas, kilos).
 *
 * String por la misma razón que `Importe`: cantidad × precio es dinero, y si la
 * cantidad llega como number la multiplicación ya arrastra el error de IEEE-754.
 */
export const Cantidad = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Cantidad inválida: debe ser un decimal en texto')

/**
 * Tarifa de IVA aplicable a una línea (Costa Rica, Ley 9635).
 *
 * Es el CÓDIGO de una fila de la tabla de impuestos (`contracts/impuestos`),
 * no un enum cerrado: las tarifas cambian por reglamento y la tabla es dato
 * de la empresa, con vigencia por fecha (docs/13 §3). El contrato valida la
 * forma; qué códigos existen y qué porcentaje tienen a la fecha del documento
 * lo resuelve el servidor. `shared/fiscal/iva` conserva la tabla por defecto
 * con la que se siembra y que sirve de respaldo.
 */
export const TarifaIvaSchema: z.ZodType<IdTarifaIva> = z
  .string()
  .min(1, 'La tarifa es obligatoria')

/**
 * Archivo adjunto a un documento.
 *
 * Transversal: hoy lo usa la factura de compra (el PDF del proveedor), pero
 * un cobro, un pago o un activo lo van a necesitar igual. El contenido NO
 * viaja aquí: se pide aparte por su propio endpoint, para que listar
 * facturas no descargue megabytes de PDF.
 */
export const AdjuntoSchema = z.object({
  id: z.string(),
  nombre: z.string().min(1),
  tipoMime: z.string().min(1),
  /** Bytes del archivo original. Entero: no es dinero. */
  tamano: z.number().int().min(0),
  /** Instante ISO completo: aquí sí importa la hora. */
  fechaCarga: z.string(),
  cargadoPor: z.string(),
  descripcion: z.string().nullable(),
})

export type Adjunto = z.infer<typeof AdjuntoSchema>

/**
 * Alta de un adjunto.
 *
 * JSON con el contenido en base64 y no multipart, a propósito: el mock lo
 * maneja sin más y el backend real puede aceptar las dos formas. Un PDF de
 * 5 MB en base64 son 6,7 MB de cuerpo, que es tolerable para un adjunto.
 */
export const SolicitudAdjuntoSchema = z.object({
  nombre: z.string().min(1, 'El archivo requiere un nombre'),
  tipoMime: z.string().min(1),
  tamano: z.number().int().min(0),
  descripcion: z.string().nullable().optional(),
  contenidoBase64: z.string().min(1, 'El archivo está vacío'),
})

export type SolicitudAdjunto = z.infer<typeof SolicitudAdjuntoSchema>

/** Tipo de identificación tributaria costarricense (docs/13 §2). */
export const TipoIdentificacionSchema: z.ZodType<TipoIdentificacion> = z.enum([
  'FISICA',
  'JURIDICA',
  'DIMEX',
  'NITE',
])

/**
 * Estado de un documento subsidiario (docs/02 §7).
 *
 * El ciclo completo es borrador → validado → contabilizado → cancelado. Esta
 * fase construye el tramo que va de la captura al asiento, así que el documento
 * nace contabilizado; `pagada` es el estado al que llega cuando el saldo queda
 * en cero.
 */
export const EstadoDocumentoSchema = z.enum([
  'contabilizada',
  'pagada',
  'cancelada',
])

export type EstadoDocumento = z.infer<typeof EstadoDocumentoSchema>
