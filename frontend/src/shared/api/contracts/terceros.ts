import { z } from 'zod'

/**
 * Datos de contacto y de facturación electrónica de un tercero.
 *
 * Los comparten el cliente (receptor del comprobante que emitimos) y el
 * proveedor (emisor del que recibimos): el XML de Hacienda pide lo mismo de
 * los dos lados (docs/13 §4). Viven en su propio contrato para que `cxc` y
 * `cxp` los importen sin depender uno del otro.
 */

/**
 * Teléfono con código de país, tal como lo pide el comprobante electrónico.
 *
 * Costa Rica es 506. Se guarda separado del número para no tener que
 * partirlo al construir el XML.
 */
export const TelefonoSchema = z.object({
  codigoPais: z.string().min(1).max(3),
  numero: z.string().min(1),
})

export type Telefono = z.infer<typeof TelefonoSchema>

/**
 * Ubicación según el catálogo de Hacienda.
 *
 * Códigos, no nombres: 1 dígito de provincia, 2 de cantón y 2 de distrito
 * (docs/13 §4). El nombre para pantalla sale de `shared/fiscal/ubicaciones`.
 */
export const UbicacionSchema = z.object({
  provincia: z.string().regex(/^\d$/, 'Provincia: 1 dígito'),
  canton: z.string().regex(/^\d{2}$/, 'Cantón: 2 dígitos'),
  distrito: z.string().regex(/^\d{2}$/, 'Distrito: 2 dígitos'),
  barrio: z.string().nullable(),
  otrasSenas: z.string(),
})

export type Ubicacion = z.infer<typeof UbicacionSchema>

/**
 * Actividad económica del contribuyente: código CIIU de 6 dígitos.
 *
 * Texto libre validado por longitud. El catálogo completo es de Hacienda y
 * cambia; aquí solo se comprueba la forma.
 */
export const ActividadEconomicaSchema = z
  .string()
  .regex(/^\d{6}$/, 'La actividad económica es un código de 6 dígitos')

/** Condición de venta del comprobante (catálogo de Hacienda). */
export const CondicionVentaSchema = z.enum([
  '01', // contado
  '02', // crédito
  '03', // consignación
  '04', // apartado
  '05', // arrendamiento con opción de compra
  '06', // arrendamiento en función financiera
  '99', // otros
])

export type CondicionVenta = z.infer<typeof CondicionVentaSchema>

export const CONDICIONES_VENTA: readonly {
  codigo: CondicionVenta
  nombre: string
}[] = [
  { codigo: '01', nombre: 'Contado' },
  { codigo: '02', nombre: 'Crédito' },
  { codigo: '03', nombre: 'Consignación' },
  { codigo: '04', nombre: 'Apartado' },
  { codigo: '05', nombre: 'Arrendamiento con opción de compra' },
  { codigo: '06', nombre: 'Arrendamiento en función financiera' },
  { codigo: '99', nombre: 'Otros' },
]

/** Medio de pago del comprobante (catálogo de Hacienda). */
export const MedioPagoSchema = z.enum([
  '01', // efectivo
  '02', // tarjeta
  '03', // cheque
  '04', // transferencia
  '05', // recaudado por tercero
  '99', // otros
])

export type MedioPago = z.infer<typeof MedioPagoSchema>

export const MEDIOS_PAGO: readonly { codigo: MedioPago; nombre: string }[] = [
  { codigo: '01', nombre: 'Efectivo' },
  { codigo: '02', nombre: 'Tarjeta' },
  { codigo: '03', nombre: 'Cheque' },
  { codigo: '04', nombre: 'Transferencia' },
  { codigo: '05', nombre: 'Recaudado por tercero' },
  { codigo: '99', nombre: 'Otros' },
]
