import { z } from 'zod'
import {
  AdjuntoSchema,
  Cantidad,
  EstadoDocumentoSchema,
  FechaISO,
  Importe,
  MonedaSchema,
  TarifaIvaSchema,
  TipoIdentificacionSchema,
} from './comunes'
import { ActividadEconomicaSchema, TelefonoSchema } from './terceros'

/**
 * Contrato de CxP (docs/05).
 *
 * Espejo de CxC con dos diferencias que importan: el impuesto es acreditable
 * en vez de trasladado, y la línea puede capitalizarse como activo fijo. Esa
 * segunda es la que enlaza este módulo con `activos` (docs/07 §3.1): el asiento
 * lo hace CxP y la ficha del activo nace de la misma captura.
 */

/* ------------------------------------------------------------ Proveedores */

export const ProveedorSchema = z.object({
  id: z.string(),
  codigo: z.string(),
  razonSocial: z.string(),
  nombreComercial: z.string().nullable(),
  tipoIdentificacion: TipoIdentificacionSchema,
  identificacion: z.string(),
  correo: z.string().nullable(),
  /* El receptor de comprobantes (docs/13 §4.4) también los necesita: el XML
     del proveedor trae su teléfono y su actividad, y al aceptarlo o
     rechazarlo ante Hacienda hay que citarlos. */
  telefono: TelefonoSchema.nullable(),
  actividadEconomica: ActividadEconomicaSchema.nullable(),
  diasCredito: z.number().int().min(0),
  moneda: MonedaSchema,
  /** Cuenta de gasto habitual del proveedor. Nula = la del mapeo del módulo. */
  cuentaGasto: z.string().nullable(),
  /**
   * Retención de renta que le corresponde, en porcentaje.
   *
   * "0" cuando no se le retiene. Qué se retiene y a quién es materia de la
   * localización fiscal (docs/05 §8), no una regla del módulo.
   */
  retencionRenta: Importe,
  activo: z.boolean(),
  /** Derivado: suma de los saldos pendientes de sus facturas. */
  saldo: Importe,
  /** Derivado: cuántas facturas suyas siguen con saldo. */
  facturasPendientes: z.number().int(),
})

export type Proveedor = z.infer<typeof ProveedorSchema>

export type ProveedorBase = Omit<Proveedor, 'saldo' | 'facturasPendientes'>

export const SolicitudProveedorSchema = ProveedorSchema.omit({
  id: true,
  saldo: true,
  facturasPendientes: true,
})

export type SolicitudProveedor = z.infer<typeof SolicitudProveedorSchema>

/* ------------------------------------------------- Facturas de proveedor */

export const LineaFacturaCompraSchema = z.object({
  id: z.string(),
  descripcion: z.string(),
  cantidad: Cantidad,
  precioUnitario: Importe,
  descuento: Importe,
  tarifa: TarifaIvaSchema,
  /** Cuenta de cargo: gasto, inventario o activo fijo (docs/05 §1). */
  cuenta: z.string(),
  base: Importe,
  impuesto: Importe,
  total: Importe,
  /**
   * Activo creado desde esta línea, si se capitalizó.
   *
   * Es la trazabilidad que pide docs/07 §1 en sentido inverso: desde la factura
   * se llega al activo, y desde el activo a la factura que lo originó.
   */
  activoId: z.string().nullable(),
})

export type LineaFacturaCompra = z.infer<typeof LineaFacturaCompraSchema>

export const FacturaCompraSchema = z.object({
  id: z.string(),
  /** El que trae el documento del proveedor. Único junto al proveedor. */
  folioProveedor: z.string(),
  folioInterno: z.string(),
  proveedorId: z.string(),
  proveedorNombre: z.string(),
  fechaEmision: FechaISO,
  fechaVencimiento: FechaISO,
  moneda: MonedaSchema,
  tipoCambio: Importe,
  lineas: z.array(LineaFacturaCompraSchema).min(1),
  subtotal: Importe,
  descuentos: Importe,
  impuesto: Importe,
  /** Retención de renta practicada al proveedor. Reduce lo que se le paga. */
  retencion: Importe,
  total: Importe,
  /** Lo que queda por pagar. Es la cuenta por pagar del proveedor. */
  saldo: Importe,
  estado: EstadoDocumentoSchema,
  asientoId: z.string().nullable(),
  creadoEn: z.string(),
  /**
   * El PDF del proveedor y lo que haga falta para sustentar el gasto.
   *
   * Solo los metadatos: el contenido se pide por su endpoint. Es lo que
   * permite listar cien facturas sin descargar cien PDF.
   */
  adjuntos: z.array(AdjuntoSchema),
})

export type FacturaCompra = z.infer<typeof FacturaCompraSchema>

/**
 * Capitalización de una línea como activo fijo.
 *
 * Va en la solicitud de la factura y no en un segundo paso a propósito: la
 * decisión de capitalizar o mandar a gasto es del momento de la captura, y
 * separarla produce compras de activo que nadie da de alta (docs/07 §3.1).
 */
export const AltaActivoEnLineaSchema = z.object({
  categoriaId: z.string().min(1, 'Seleccione la categoría del activo'),
  nombre: z.string().min(1, 'El activo requiere un nombre'),
  /** Se deprecia desde que está disponible para su uso, no desde la compra. */
  fechaInicioDepreciacion: FechaISO,
  numeroSerie: z.string().nullable().optional(),
  ubicacion: z.string().nullable().optional(),
  responsable: z.string().nullable().optional(),
})

export type AltaActivoEnLinea = z.infer<typeof AltaActivoEnLineaSchema>

export const LineaSolicitudFacturaCompraSchema = z.object({
  descripcion: z.string().min(1, 'La descripción es obligatoria'),
  cantidad: Cantidad,
  precioUnitario: Importe,
  descuento: Importe.optional(),
  tarifa: TarifaIvaSchema,
  /** Vacío = se resuelve por el mapeo del módulo (docs/02 §5). */
  cuenta: z.string().optional(),
  /** Presente = la línea se capitaliza y crea la ficha del activo. */
  activo: AltaActivoEnLineaSchema.nullable().optional(),
})

export const SolicitudFacturaCompraSchema = z.object({
  proveedorId: z.string().min(1, 'Seleccione un proveedor'),
  folioProveedor: z.string().min(1, 'El folio del proveedor es obligatorio'),
  fechaEmision: FechaISO,
  fechaVencimiento: FechaISO,
  moneda: MonedaSchema,
  tipoCambio: Importe,
  lineas: z
    .array(LineaSolicitudFacturaCompraSchema)
    .min(1, 'La factura requiere al menos una línea'),
})

export type SolicitudFacturaCompra = z.infer<typeof SolicitudFacturaCompraSchema>
export type LineaSolicitudFacturaCompra = z.infer<
  typeof LineaSolicitudFacturaCompraSchema
>

/* ------------------------------------------------ Antigüedad de saldos */

export const SaldosPorAntiguedadCxpSchema = z.object({
  porVencer: Importe,
  d1a30: Importe,
  d31a60: Importe,
  d61a90: Importe,
  mas90: Importe,
  total: Importe,
})

export const FilaAntiguedadCxpSchema = SaldosPorAntiguedadCxpSchema.extend({
  proveedorId: z.string(),
  proveedorNombre: z.string(),
})

export const AntiguedadCxpSchema = z.object({
  corte: FechaISO,
  moneda: MonedaSchema,
  filas: z.array(FilaAntiguedadCxpSchema),
  totales: SaldosPorAntiguedadCxpSchema,
})

export type AntiguedadCxp = z.infer<typeof AntiguedadCxpSchema>
export type FilaAntiguedadCxp = z.infer<typeof FilaAntiguedadCxpSchema>

/* ------------------------------------------------------ Mapeo contable */

/** Roles de los eventos `factura_recibida` y `pago_emitido` (docs/05 §6). */
export const MapeoCxpSchema = z.object({
  proveedor: z.string(),
  gasto: z.string(),
  impuestoAcreditable: z.string(),
  retencion: z.string(),
  /** Rol `anticipo`: lo pagado de más, que queda a favor del proveedor. */
  anticipo: z.string(),
  /**
   * Diferencia cambiaria del pago, en sus dos signos.
   *
   * Son dos cuentas y no una porque el catálogo las separa por naturaleza: la
   * ganancia es ingreso y la pérdida es gasto. Presentarlas netas es cosa del
   * estado de resultados, no del registro.
   */
  diferencialGanado: z.string(),
  diferencialPerdido: z.string(),
})

export type MapeoCxp = z.infer<typeof MapeoCxpSchema>

/* ------------------------------------------------------------------ Pagos */

/**
 * Medio por el que sale el dinero (`forma_pago` en docs/05 §1).
 *
 * Es descriptivo: quien decide qué cuenta se abona es `cuentaSalida`, no esto.
 * Separarlos importa porque una transferencia y un cheque salen de la misma
 * cuenta bancaria y se concilian distinto.
 */
export const MedioPagoSchema = z.enum([
  'transferencia',
  'cheque',
  'efectivo',
  'tarjeta',
  'otro',
])

export type MedioPago = z.infer<typeof MedioPagoSchema>

export const MEDIOS_PAGO: readonly MedioPago[] = [
  'transferencia',
  'cheque',
  'efectivo',
  'tarjeta',
  'otro',
]

/**
 * Estado del pago.
 *
 * docs/05 §1 enumera `propuesto|autorizado|emitido|conciliado`. Aquí viven
 * solo dos, y no por recorte:
 *
 * - `propuesto` y `autorizado` son del circuito de control interno (docs/05
 *   §7), que exige usuarios y niveles de autorización que todavía no existen.
 *   La propuesta de pago de §2.3 no se guarda: se recalcula sobre las facturas
 *   vigentes, así que no hay documento en ese estado que persistir.
 * - `conciliado` lo pondrá bancos cuando el movimiento aparezca en el estado
 *   de cuenta. Ponerlo desde aquí sería afirmar una conciliación que nadie hizo.
 *
 * `anulado` no está en la lista de docs/05 y sí en el ciclo de vida de
 * docs/02 §7 (`cancelado`): un pago contabilizado es inmutable y solo se
 * deshace con la reversa de su asiento.
 */
export const EstadoPagoSchema = z.enum(['emitido', 'anulado'])

export type EstadoPago = z.infer<typeof EstadoPagoSchema>

/**
 * Aplicación de un pago a una factura. La relación es N a N (docs/05 §1): un
 * pago salda varias facturas y una factura admite varios pagos parciales.
 *
 * Guarda el tipo de cambio con el que la factura entró al mayor además del
 * importe: es lo que permite reconstruir la diferencia cambiaria de esta
 * aplicación sin volver a leer la factura, que para entonces ya puede tener
 * otro saldo.
 */
export const AplicacionPagoSchema = z.object({
  facturaId: z.string(),
  folioProveedor: z.string(),
  folioInterno: z.string(),
  fechaVencimiento: FechaISO,
  /** Tipo de cambio al que se reconoció la cuenta por pagar. */
  tipoCambioFactura: Importe,
  /** Lo aplicado, en la moneda del pago (que es la de la factura). */
  importe: Importe,
  saldoAnterior: Importe,
  saldoResultante: Importe,
  /**
   * Diferencia cambiaria de esta aplicación, en moneda funcional.
   *
   * Positiva = ganancia (se pagó con un tipo de cambio menor que aquel al que
   * se reconoció el pasivo). Negativa = pérdida.
   */
  diferenciaCambiaria: Importe,
})

export type AplicacionPago = z.infer<typeof AplicacionPagoSchema>

export const PagoSchema = z.object({
  id: z.string(),
  /** Consecutivo propio del pago: PAG-000231. */
  folio: z.string(),
  proveedorId: z.string(),
  proveedorNombre: z.string(),
  fecha: FechaISO,
  moneda: MonedaSchema,
  tipoCambio: Importe,
  /** Cuenta de la que sale el dinero: bancos o caja. */
  cuentaSalida: z.string(),
  /**
   * Cuenta bancaria del catálogo de `bancos`, cuando el dinero sale de un
   * banco (docs/06 §1).
   *
   * Es el auxiliar con el que la cuenta de control vive en el mayor. Nulo
   * cuando se paga desde caja, que no exige auxiliar.
   */
  auxiliarBanco: z.string().nullable(),
  medioPago: MedioPagoSchema,
  /** Número de transferencia, de cheque o lo que identifique el egreso. */
  referencia: z.string().nullable(),
  /** Lo que salió de la cuenta, en la moneda del pago. */
  importe: Importe,
  /** Suma de las aplicaciones. */
  aplicado: Importe,
  /** Lo que sobró: queda como anticipo a favor del proveedor. */
  anticipo: Importe,
  aplicaciones: z.array(AplicacionPagoSchema),
  /** Suma de las diferencias cambiarias, en moneda funcional. */
  diferenciaCambiaria: Importe,
  estado: EstadoPagoSchema,
  asientoId: z.string().nullable(),
  creadoEn: z.string(),
  /** Anulación: cuándo, por qué y con qué reversa (docs/02 §6). */
  anuladoEn: z.string().nullable(),
  motivoAnulacion: z.string().nullable(),
  asientoAnulacionId: z.string().nullable(),
})

export type Pago = z.infer<typeof PagoSchema>

export const SolicitudAplicacionPagoSchema = z.object({
  facturaId: z.string().min(1, 'Seleccione la factura a la que se aplica'),
  importe: Importe,
})

export type SolicitudAplicacionPago = z.infer<
  typeof SolicitudAplicacionPagoSchema
>

/**
 * Alta de un pago.
 *
 * Las aplicaciones viajan con el pago y no en un segundo paso: un pago sin
 * aplicar no baja ningún saldo, y separar los dos momentos produce egresos
 * que nadie termina de aplicar y una cuenta de control que deja de cuadrar
 * contra el auxiliar.
 */
export const SolicitudPagoSchema = z.object({
  proveedorId: z.string().min(1, 'Seleccione un proveedor'),
  fecha: FechaISO,
  moneda: MonedaSchema,
  tipoCambio: Importe,
  cuentaSalida: z.string().min(1, 'Seleccione la cuenta de salida'),
  auxiliarBanco: z.string().nullable().optional(),
  medioPago: MedioPagoSchema,
  referencia: z.string().nullable().optional(),
  importe: Importe,
  aplicaciones: z.array(SolicitudAplicacionPagoSchema),
})

export type SolicitudPago = z.infer<typeof SolicitudPagoSchema>

/**
 * Anulación de un pago.
 *
 * Lleva su propia fecha porque la reversa no va necesariamente en el día del
 * pago: si ese periodo ya cerró, la reversa va en el abierto y no se reabre
 * nada para corregir (docs/02 §6).
 */
export const SolicitudAnulacionPagoSchema = z.object({
  fecha: FechaISO,
  motivo: z.string().min(1, 'El motivo de la anulación es obligatorio'),
})

export type SolicitudAnulacionPago = z.infer<
  typeof SolicitudAnulacionPagoSchema
>

/* --------------------------------------------- Propuesta de pago (§2.3) */

/**
 * Una factura dentro de la propuesta.
 *
 * Lleva el saldo en la moneda del documento y su equivalente funcional: lo
 * primero es lo que se le paga al proveedor y lo segundo es contra lo que se
 * mide el efectivo disponible, que es uno solo para todas las monedas.
 */
export const LineaPropuestaPagoSchema = z.object({
  facturaId: z.string(),
  folioProveedor: z.string(),
  folioInterno: z.string(),
  proveedorId: z.string(),
  proveedorNombre: z.string(),
  fechaVencimiento: FechaISO,
  /** Días vencidos a la fecha de corte. Cero o negativo = todavía por vencer. */
  diasVencidos: z.number().int(),
  moneda: MonedaSchema,
  tipoCambio: Importe,
  saldo: Importe,
  saldoFuncional: Importe,
  /** Lo que la propuesta sugiere pagar, en la moneda de la factura. */
  propuesto: Importe,
  propuestoFuncional: Importe,
  /** true si lo propuesto salda la factura. */
  salda: z.boolean(),
})

export type LineaPropuestaPago = z.infer<typeof LineaPropuestaPagoSchema>

export const PropuestaPagoSchema = z.object({
  corte: FechaISO,
  moneda: MonedaSchema,
  /** Tope de efectivo, en moneda funcional. */
  disponible: Importe,
  lineas: z.array(LineaPropuestaPagoSchema),
  totalPendiente: Importe,
  totalPropuesto: Importe,
  /** Lo que queda del disponible después de la propuesta. */
  remanente: Importe,
  /** Lo que vence y no cabe en el disponible. */
  sinCubrir: Importe,
})

export type PropuestaPago = z.infer<typeof PropuestaPagoSchema>
