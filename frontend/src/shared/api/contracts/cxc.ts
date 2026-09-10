import { z } from 'zod'
import {
  Cantidad,
  EstadoDocumentoSchema,
  FechaISO,
  Importe,
  MonedaSchema,
  TarifaIvaSchema,
  TipoIdentificacionSchema,
} from './comunes'
import {
  ActividadEconomicaSchema,
  CondicionVentaSchema,
  MedioPagoSchema,
  TelefonoSchema,
  UbicacionSchema,
} from './terceros'

/**
 * Contrato de CxC (docs/04).
 *
 * El ciclo que cubre esta fase es el de ingresos completo: se emite la factura
 * y esa emisión crea el saldo del cliente; se registra el cobro y ese cobro lo
 * baja. La factura nace con `saldo = total` y son las aplicaciones de los
 * cobros las que lo reducen, hasta dejarla `pagada` cuando llega a cero.
 */

/* --------------------------------------------------------------- Clientes */

export const ClienteSchema = z.object({
  id: z.string(),
  codigo: z.string(),
  razonSocial: z.string(),
  nombreComercial: z.string().nullable(),
  tipoIdentificacion: TipoIdentificacionSchema,
  identificacion: z.string(),
  correo: z.string().nullable(),
  /** 0 = contado. La fecha de vencimiento se propone a partir de aquí. */
  diasCredito: z.number().int().min(0),
  limiteCredito: Importe,
  moneda: MonedaSchema,
  /**
   * Cuenta de ingreso propia del cliente. Nula = la del mapeo del módulo.
   *
   * Es el `override` de docs/04 §1: el mapeo por evento resuelve el caso
   * general y el cliente solo se declara cuando se sale de él.
   */
  cuentaIngreso: z.string().nullable(),
  activo: z.boolean(),

  /* Datos del receptor del comprobante electrónico (docs/13 §4). Todos
     opcionales: se puede facturar sin ellos mientras no exista la emisión
     electrónica, y `listoParaFe` dice a quién le falta qué. */
  telefono: TelefonoSchema.nullable(),
  ubicacion: UbicacionSchema.nullable(),
  actividadEconomica: ActividadEconomicaSchema.nullable(),
  /** Cómo se le vende por defecto. Nulo = se decide en cada factura. */
  condicionVenta: CondicionVentaSchema.nullable(),
  medioPago: MedioPagoSchema.nullable(),

  /** Derivado: suma de los saldos pendientes de sus facturas. */
  saldo: Importe,
  /** Derivado: cuántas facturas suyas siguen con saldo. */
  facturasPendientes: z.number().int(),
  /**
   * Derivado: tiene correo, teléfono, ubicación y actividad económica.
   *
   * Lo calcula el servidor con la misma regla que aplicará al emitir el
   * comprobante, para que la lista marque a quién hay que completar antes de
   * que la emisión falle.
   */
  listoParaFe: z.boolean(),
})

export type Cliente = z.infer<typeof ClienteSchema>

/** Los campos derivados los calcula quien tiene los datos, no la pantalla. */
export type ClienteBase = Omit<
  Cliente,
  'saldo' | 'facturasPendientes' | 'listoParaFe'
>

export const SolicitudClienteSchema = ClienteSchema.omit({
  id: true,
  saldo: true,
  facturasPendientes: true,
  listoParaFe: true,
})

export type SolicitudCliente = z.infer<typeof SolicitudClienteSchema>

/* -------------------------------------- Catálogo de productos y servicios */

/**
 * Qué se vende.
 *
 * Un producto es un bien y un servicio no lo es, y la distinción no es
 * decorativa: cambia la tarifa que suele aplicarse y, cuando exista el módulo
 * de inventarios, cambia si la venta descarga existencias.
 */
export const TipoItemSchema = z.enum(['producto', 'servicio'])

export type TipoItem = z.infer<typeof TipoItemSchema>

/**
 * Producto o servicio del catálogo de venta (docs/04 §1.1).
 *
 * Existe para que la cuenta de ingreso y la tarifa de IVA se decidan UNA vez,
 * al dar de alta lo que se vende, y no en cada factura. Quien factura no tiene
 * por qué saber que la consultoría va a `4.1.01.001` al 13% y la consulta
 * médica al 4%: lo sabe el catálogo.
 *
 * Lo que el item aporta a la línea es un valor inicial, nunca una imposición.
 * La línea sigue siendo editable, y lo que se contabiliza es lo que quedó en
 * ella: hay ventas que salen de la lista de precios y facturas que cargan a una
 * cuenta distinta de la habitual, y bloquearlas obligaría a inventar un item
 * por excepción.
 */
export const ItemCatalogoSchema = z.object({
  id: z.string(),
  /** Llave visible. Es lo que se teclea al facturar. */
  codigo: z.string(),
  nombre: z.string(),
  /** Texto que se copia a la línea. Nulo = se copia el nombre. */
  descripcion: z.string().nullable(),
  tipo: TipoItemSchema,
  /** Precio de lista, expresado en `moneda`. Cero = precio a convenir. */
  precioUnitario: Importe,
  /**
   * Moneda en la que está fijado el precio.
   *
   * El precio solo se precarga cuando coincide con la de la factura: convertir
   * por el tipo de cambio del día daría un precio de lista que nadie pactó.
   */
  moneda: MonedaSchema,
  tarifa: TarifaIvaSchema,
  /**
   * Cuenta de ingreso que la venta acredita.
   *
   * Obligatoria: es la razón de ser del catálogo. Sin ella el item solo
   * ahorraría teclear una descripción.
   */
  cuentaIngreso: z.string(),
  activo: z.boolean(),
})

export type ItemCatalogo = z.infer<typeof ItemCatalogoSchema>

export const SolicitudItemCatalogoSchema = ItemCatalogoSchema.omit({ id: true })

export type SolicitudItemCatalogo = z.infer<typeof SolicitudItemCatalogoSchema>

/* --------------------------------------------------------------- Facturas */

/**
 * Línea ya emitida.
 *
 * Trae la base, el impuesto y el total calculados: son los que se declararon
 * en el comprobante electrónico y los que sustentan el asiento. Recalcularlos
 * al presentar abriría la puerta a que la pantalla muestre un número distinto
 * del que se contabilizó.
 */
export const LineaFacturaVentaSchema = z.object({
  id: z.string(),
  /**
   * Item del catálogo del que salió la línea. Nulo = se capturó a mano.
   *
   * El código va copiado junto al id, como el nombre del cliente en la
   * factura: es lo que se vendió, y renombrar el catálogo después no puede
   * cambiar lo que dice un comprobante ya emitido.
   */
  itemId: z.string().nullable().default(null),
  itemCodigo: z.string().nullable().default(null),
  descripcion: z.string(),
  cantidad: Cantidad,
  precioUnitario: Importe,
  descuento: Importe,
  tarifa: TarifaIvaSchema,
  cuentaIngreso: z.string(),
  base: Importe,
  impuesto: Importe,
  total: Importe,
})

export type LineaFacturaVenta = z.infer<typeof LineaFacturaVentaSchema>

export const FacturaVentaSchema = z.object({
  id: z.string(),
  /**
   * Número interno: FV-000113. Lo asigna el sistema, correlativo por
   * empresa, y nunca se edita. Es el que se teclea para buscar.
   */
  numeroInterno: z.string(),
  /**
   * Consecutivo del comprobante electrónico: 20 dígitos según Hacienda
   * (docs/13 §4.2): casa matriz, terminal, tipo de documento y correlativo.
   * Sale de un contador independiente del interno.
   */
  consecutivo: z.string(),
  /**
   * Clave numérica de 50 dígitos. Nula hasta que exista la facturación
   * electrónica: necesita firmar el XML y un código de seguridad aleatorio.
   */
  claveNumerica: z.string().nullable(),
  clienteId: z.string(),
  clienteNombre: z.string(),
  fechaEmision: FechaISO,
  fechaVencimiento: FechaISO,
  moneda: MonedaSchema,
  tipoCambio: Importe,
  lineas: z.array(LineaFacturaVentaSchema).min(1),
  subtotal: Importe,
  descuentos: Importe,
  impuesto: Importe,
  total: Importe,
  /** Lo que queda por cobrar. Es la cuenta por cobrar del cliente. */
  saldo: Importe,
  estado: EstadoDocumentoSchema,
  /** Nulo solo si la factura se anuló antes de contabilizarse. */
  asientoId: z.string().nullable(),
  creadoEn: z.string(),
})

export type FacturaVenta = z.infer<typeof FacturaVentaSchema>

export const LineaSolicitudFacturaVentaSchema = z.object({
  /** Item del catálogo que precargó la línea. Vacío = captura libre. */
  itemId: z.string().optional(),
  descripcion: z.string().min(1, 'La descripción es obligatoria'),
  cantidad: Cantidad,
  precioUnitario: Importe,
  descuento: Importe.optional(),
  tarifa: TarifaIvaSchema,
  /** Vacío = se resuelve por el mapeo del módulo (docs/02 §5). */
  cuentaIngreso: z.string().optional(),
})

export const SolicitudFacturaVentaSchema = z.object({
  clienteId: z.string().min(1, 'Seleccione un cliente'),
  fechaEmision: FechaISO,
  fechaVencimiento: FechaISO,
  moneda: MonedaSchema,
  tipoCambio: Importe,
  lineas: z
    .array(LineaSolicitudFacturaVentaSchema)
    .min(1, 'La factura requiere al menos una línea'),
})

export type SolicitudFacturaVenta = z.infer<typeof SolicitudFacturaVentaSchema>
export type LineaSolicitudFacturaVenta = z.infer<
  typeof LineaSolicitudFacturaVentaSchema
>

/* ------------------------------------------------ Antigüedad de saldos */

/**
 * Cubetas de antigüedad (docs/04 §3).
 *
 * Se calcula a una fecha de corte y no solo a hoy: un aging del cierre pasado
 * tiene que seguir siendo reproducible. Su suma debe ser exactamente el saldo
 * de la cuenta de control en el mayor a esa fecha.
 */
export const SaldosPorAntiguedadSchema = z.object({
  porVencer: Importe,
  d1a30: Importe,
  d31a60: Importe,
  d61a90: Importe,
  mas90: Importe,
  total: Importe,
})

export const FilaAntiguedadSchema = SaldosPorAntiguedadSchema.extend({
  clienteId: z.string(),
  clienteNombre: z.string(),
})

export const AntiguedadSchema = z.object({
  corte: FechaISO,
  moneda: MonedaSchema,
  filas: z.array(FilaAntiguedadSchema),
  totales: SaldosPorAntiguedadSchema,
})

export type SaldosPorAntiguedad = z.infer<typeof SaldosPorAntiguedadSchema>
export type FilaAntiguedad = z.infer<typeof FilaAntiguedadSchema>
export type Antiguedad = z.infer<typeof AntiguedadSchema>

/* ------------------------------------------------------ Mapeo contable */

/**
 * A qué cuenta va cada rol de los eventos del módulo (docs/02 §5, docs/04 §5).
 *
 * Es configuración, no código: cambiar el catálogo de cuentas no debe obligar a
 * tocar CxC. La pantalla lo consulta para poder mostrar el asiento antes de
 * emitir.
 *
 * Los tres primeros roles son de `factura_emitida`; los cuatro siguientes, de
 * `cobro_registrado`. Van en el mismo mapeo y no en dos porque la cuenta de
 * clientes es la misma en los dos eventos, y tenerla dos veces permitiría el
 * estado imposible de facturar contra una cuenta de control y cobrar contra
 * otra.
 */
export const MapeoCxcSchema = z.object({
  cliente: z.string(),
  ingreso: z.string(),
  impuestoTrasladado: z.string(),
  /**
   * Cuenta de depósito que se propone al cobrar. El cobro puede cambiarla:
   * un mismo cliente paga hoy por transferencia y mañana en efectivo.
   */
  deposito: z.string(),
  /** Lo recibido de más, que todavía no es de ninguna factura. */
  anticipo: z.string(),
  /** Cobrar a un tipo de cambio mayor que el de la factura es una ganancia. */
  diferenciaCambiariaGanada: z.string(),
  diferenciaCambiariaPerdida: z.string(),
})

export type MapeoCxc = z.infer<typeof MapeoCxcSchema>

/* ----------------------------------------------------------------- Cobros */

/**
 * Estado del cobro (docs/02 §7).
 *
 * Solo dos: el documento nace contabilizado, porque capturar un cobro y
 * emitir su asiento son la misma operación (docs/02 §8), y de ahí solo puede
 * anularse. No hay borrador ni validado: mientras el dinero no entró no hay
 * cobro que guardar, y una vez que entró ya movió el mayor.
 */
export const EstadoCobroSchema = z.enum(['contabilizado', 'anulado'])

export type EstadoCobro = z.infer<typeof EstadoCobroSchema>

/**
 * Aplicación de un cobro a UNA factura (docs/04 §1).
 *
 * La relación es N a N: un cobro paga varias facturas y una factura recibe
 * varios cobros parciales. Por eso la aplicación es una entidad propia y no un
 * `cobroId` en la factura; modelarlo al revés obliga a rehacer el módulo en
 * cuanto aparece el primer abono parcial.
 */
export const AplicacionCobroSchema = z.object({
  facturaId: z.string(),
  /** Copiado al aplicar, como el nombre del cliente en la factura. */
  facturaNumero: z.string(),
  /** Importe aplicado, en la MONEDA DE LA FACTURA: es lo que baja su saldo. */
  importeAplicado: Importe,
  /** Saldo con el que la factura quedó tras esta aplicación. */
  saldoResultante: Importe,
  /** Tipo de cambio con el que la factura entró al mayor. */
  tipoCambioFactura: Importe,
  /**
   * Diferencia cambiaria que produjo esta aplicación, en moneda funcional.
   *
   * Positiva = ganancia: se recibieron más colones de los que la cuenta por
   * cobrar reconocía. Cero cuando el cobro se hace al mismo tipo de cambio con
   * el que se facturó, que es siempre el caso en moneda funcional.
   */
  diferenciaCambiaria: Importe,
})

export type AplicacionCobro = z.infer<typeof AplicacionCobroSchema>

/**
 * Cobro recibido de un cliente (docs/04 §2.2).
 *
 *   capturar → aplicar a facturas → contabilizar → notificar a bancos
 *
 * Los importes en `moneda` son los del documento: lo que el cliente pagó y lo
 * que se aplicó a cada factura. Los que llevan el sufijo `Funcional` son los
 * mismos llevados a la moneda del mayor, que es donde el asiento cuadra y donde
 * aparece la diferencia cambiaria.
 */
export const CobroSchema = z.object({
  id: z.string(),
  /** Consecutivo propio del cobro: COB-000089. Independiente del de facturas. */
  numero: z.string(),
  clienteId: z.string(),
  clienteNombre: z.string(),
  fecha: FechaISO,
  moneda: MonedaSchema,
  tipoCambio: Importe,
  /** Catálogo de Hacienda, el mismo que el medio de pago del comprobante. */
  medio: MedioPagoSchema,
  /** Número de transferencia, de cheque o de voucher. Vacío = sin referencia. */
  referencia: z.string().nullable(),
  /** Cuenta contable donde entró el dinero: la bancaria o la de caja. */
  cuentaDeposito: z.string(),
  /**
   * Cuenta bancaria del catálogo de `bancos` en la que entró el dinero.
   *
   * Es el auxiliar con el que la cuenta de depósito vive en el mayor (docs/06
   * §1). Nulo cuando se cobra contra caja, que no exige auxiliar y es lo que
   * permite registrar un cobro sin banco de por medio.
   */
  auxiliarBanco: z.string().nullable(),
  /** Lo que entró, en la moneda del cobro. */
  importeRecibido: Importe,
  aplicaciones: z.array(AplicacionCobroSchema),
  /** Suma de las aplicaciones, en la moneda del cobro. */
  importeAplicado: Importe,
  /** Lo recibido de más. Queda como anticipo del cliente (docs/04 §2.2). */
  importeSinAplicar: Importe,
  /** Lo que se abonó a la cuenta de clientes, en moneda funcional. */
  abonoClientesFuncional: Importe,
  /** Diferencia cambiaria del asiento, en funcional. Positiva = ganancia. */
  diferenciaCambiaria: Importe,
  estado: EstadoCobroSchema,
  asientoId: z.string().nullable(),
  /** Asiento de reversa, cuando el cobro se anuló. */
  asientoReversaId: z.string().nullable(),
  /**
   * Fecha contable de la anulación. Nula mientras el cobro está vigente.
   *
   * Es la fecha de la reversa, no el instante en que alguien apretó el botón:
   * la antigüedad a una fecha de corte necesita saber si el cobro seguía vivo
   * ESE día, y un cobro anulado en octubre sí bajaba el saldo en agosto
   * (docs/04 §3: el aging de un cierre pasado tiene que ser reproducible).
   */
  anuladoEn: FechaISO.nullable(),
  motivoAnulacion: z.string().nullable(),
  creadoEn: z.string(),
})

export type Cobro = z.infer<typeof CobroSchema>

export const LineaSolicitudCobroSchema = z.object({
  facturaId: z.string().min(1, 'Seleccione la factura a la que se aplica'),
  importeAplicado: Importe,
})

export type LineaSolicitudCobro = z.infer<typeof LineaSolicitudCobroSchema>

/**
 * Alta de un cobro.
 *
 * Las aplicaciones pueden venir vacías: un cliente que adelanta dinero sin
 * decir a qué factura va produce un cobro entero de anticipo, y rechazarlo
 * obligaría a inventar una aplicación falsa.
 */
export const SolicitudCobroSchema = z.object({
  clienteId: z.string().min(1, 'Seleccione un cliente'),
  fecha: FechaISO,
  moneda: MonedaSchema,
  tipoCambio: Importe,
  medio: MedioPagoSchema,
  referencia: z.string().nullable().optional(),
  cuentaDeposito: z.string().min(1, 'Seleccione la cuenta de depósito'),
  auxiliarBanco: z.string().nullable().optional(),
  importeRecibido: Importe,
  aplicaciones: z.array(LineaSolicitudCobroSchema),
})

export type SolicitudCobro = z.infer<typeof SolicitudCobroSchema>

/**
 * Anulación de un cobro.
 *
 * Misma forma que la reversa de un asiento (docs/02 §6) y por la misma razón:
 * lo que se decide es cuándo y por qué. Las líneas las construye el servidor
 * invirtiendo las del asiento original, y el saldo vuelve a las facturas que
 * el cobro había bajado.
 */
export const SolicitudAnulacionCobroSchema = z.object({
  /** Debe caer en periodo abierto. Si el del cobro ya cerró, va en el actual. */
  fecha: FechaISO,
  motivo: z.string().min(1, 'El motivo de la anulación es obligatorio'),
})

export type SolicitudAnulacionCobro = z.infer<
  typeof SolicitudAnulacionCobroSchema
>
