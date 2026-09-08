import { z } from 'zod'
import { FechaISO, Importe } from './comunes'

/**
 * Tabla de impuestos con vigencia por fecha (docs/13 §3 y su advertencia).
 *
 * Ninguna tasa va escrita en el código: la tabla vive como dato de la empresa
 * y cada fila dice desde cuándo y hasta cuándo rige. El cálculo resuelve la
 * tarifa por la FECHA DEL DOCUMENTO, no por la de hoy, para que recalcular un
 * periodo anterior dé lo mismo que dio en su momento.
 *
 * Una misma tarifa (el mismo `codigo`) puede tener varias filas: la del 13%
 * vigente desde 2019 y, si un día cambia, otra fila con la nueva tasa y la
 * anterior cerrada. Las facturas guardan el código, no el porcentaje, y el
 * porcentaje se resuelve por la fecha de emisión.
 */

/**
 * Tipo de impuesto.
 *
 * Solo IVA por ahora. `retencion` queda declarado para que las retenciones en
 * la fuente (docs/13 §5) entren en la misma tabla sin cambiar el contrato.
 */
export const TipoImpuestoSchema = z.enum(['iva', 'retencion'])

export type TipoImpuesto = z.infer<typeof TipoImpuestoSchema>

export const TarifaImpuestoSchema = z.object({
  id: z.string(),
  /** Código de catálogo que citan las líneas: GENERAL, REDUCIDA_4, EXENTO. */
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  tipo: TipoImpuestoSchema,
  /** Porcentaje como decimal en texto: "13", "4", "0.5". */
  porcentaje: Importe,
  vigenteDesde: FechaISO,
  /** Nulo = sigue vigente. */
  vigenteHasta: FechaISO.nullable(),
  /** Inactiva no se ofrece al capturar; los documentos que la citan no cambian. */
  activa: z.boolean(),
  /**
   * Código de tarifa del XML de Hacienda (ej. "08" para la general del 13%).
   *
   * Nulo mientras no se confirme contra el catálogo oficial vigente: es
   * preferible un hueco a un código de memoria en un comprobante electrónico.
   */
  codigoHacienda: z.string().nullable(),
  /**
   * Distingue exento y no sujeto de tarifa 0%.
   *
   * Los tres dan impuesto cero, pero contablemente se tratan distinto y se
   * declaran en casillas distintas del D-104 (docs/13 §3.1).
   */
  generaImpuesto: z.boolean(),
})

export type TarifaImpuesto = z.infer<typeof TarifaImpuestoSchema>

export const SolicitudTarifaImpuestoSchema = TarifaImpuestoSchema.omit({
  id: true,
})

export type SolicitudTarifaImpuesto = z.infer<
  typeof SolicitudTarifaImpuestoSchema
>
