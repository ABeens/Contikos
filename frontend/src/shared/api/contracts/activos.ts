import { z } from 'zod'
import { FechaISO, Importe, MonedaSchema } from './comunes'
import { SolicitudAsientoSchema } from './conta'

/**
 * Contrato de activos fijos (docs/07).
 *
 * El activo entra por dos puertas y la diferencia entre ellas es contable:
 *
 * - **Desde una factura de CxP.** El asiento ya lo hizo CxP al registrar la
 *   compra. Aquí solo nace la ficha, sin generar asiento nuevo. Contabilizarlo
 *   otra vez duplicaría el activo en el mayor.
 * - **Alta directa.** Aportación, donación, activo construido. Esta sí genera
 *   asiento: cargo al activo, abono a la contrapartida.
 */

export const MetodoDepreciacionSchema = z.enum([
  'linea_recta',
  'saldos_decrecientes',
])

export type MetodoDepreciacion = z.infer<typeof MetodoDepreciacionSchema>

/* ------------------------------------------------------------ Categorías */

/**
 * Categoría de activo.
 *
 * El mapeo contable se resuelve por categoría, nunca por activo individual
 * (docs/07 §6): son las tres cuentas que mueve su ciclo de vida.
 */
export const CategoriaActivoSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  vidaUtilMeses: z.number().int().min(1),
  metodo: MetodoDepreciacionSchema,
  /** Porcentaje del costo que se conserva como valor residual. */
  porcentajeResidual: Importe,
  cuentaActivo: z.string(),
  cuentaDepreciacionAcumulada: z.string(),
  cuentaGastoDepreciacion: z.string(),
  /**
   * Tasa anual del reglamento del impuesto sobre la renta, si difiere de la
   * vida útil contable. Nula cuando las dos cédulas coinciden (docs/07 §5).
   */
  tasaFiscalAnual: Importe.nullable(),
  activa: z.boolean(),
  /** Derivado: activos registrados en la categoría. */
  activos: z.number().int(),
})

export type CategoriaActivo = z.infer<typeof CategoriaActivoSchema>

export type CategoriaActivoBase = Omit<CategoriaActivo, 'activos'>

/**
 * Alta y edición de categoría.
 *
 * No lleva `id` ni `activos`: el primero lo pone el servidor y el segundo es
 * derivado del inventario, no un dato que se capture.
 */
export const SolicitudCategoriaActivoSchema = z.object({
  nombre: z.string().min(1, 'La categoría requiere un nombre'),
  vidaUtilMeses: z.number().int().min(1, 'La vida útil es de al menos un mes'),
  metodo: MetodoDepreciacionSchema,
  porcentajeResidual: Importe,
  cuentaActivo: z.string().min(1, 'Indique la cuenta de activo'),
  cuentaDepreciacionAcumulada: z
    .string()
    .min(1, 'Indique la cuenta de depreciación acumulada'),
  cuentaGastoDepreciacion: z
    .string()
    .min(1, 'Indique la cuenta de gasto por depreciación'),
  tasaFiscalAnual: Importe.nullable(),
  activa: z.boolean(),
})

export type SolicitudCategoriaActivo = z.infer<
  typeof SolicitudCategoriaActivoSchema
>

/* --------------------------------------------------------------- Activos */

export const EstadoActivoSchema = z.enum([
  'activo',
  'totalmente_depreciado',
  'dado_de_baja',
  'vendido',
])

export const OrigenActivoSchema = z.enum(['cxp', 'manual'])

export type EstadoActivo = z.infer<typeof EstadoActivoSchema>
export type OrigenActivo = z.infer<typeof OrigenActivoSchema>

/**
 * Una cuota contabilizada sobre el activo.
 *
 * Es el rastro de cada corrida en la ficha: con él se explica de dónde sale la
 * acumulada y se llega al asiento que la escribió en el mayor.
 */
export const DepreciacionActivoSchema = z.object({
  periodoId: z.string(),
  fecha: FechaISO,
  cuota: Importe,
  asientoId: z.string(),
})

export type DepreciacionActivo = z.infer<typeof DepreciacionActivoSchema>

export const ActivoSchema = z.object({
  id: z.string(),
  codigo: z.string(),
  nombre: z.string(),
  descripcion: z.string().nullable(),
  categoriaId: z.string(),
  categoriaNombre: z.string(),
  fechaAdquisicion: FechaISO,
  /** Se deprecia desde que está disponible para su uso, no desde la compra. */
  fechaInicioDepreciacion: FechaISO,
  moneda: MonedaSchema,
  costoAdquisicion: Importe,
  valorResidual: Importe,
  vidaUtilMeses: z.number().int().min(1),
  metodo: MetodoDepreciacionSchema,
  /** Acumulada por las corridas ya contabilizadas. */
  depreciacionAcumulada: Importe,
  /** Derivado: costo menos depreciación acumulada. */
  valorEnLibros: Importe,
  ubicacion: z.string().nullable(),
  responsable: z.string().nullable(),
  numeroSerie: z.string().nullable(),
  proveedorId: z.string().nullable(),
  proveedorNombre: z.string().nullable(),
  facturaId: z.string().nullable(),
  facturaFolio: z.string().nullable(),
  origen: OrigenActivoSchema,
  estado: EstadoActivoSchema,
  /** Solo el alta directa genera asiento propio; desde CxP es nulo. */
  asientoId: z.string().nullable(),
  /** Cuotas ya contabilizadas, de la más antigua a la más reciente. */
  depreciaciones: z.array(DepreciacionActivoSchema).default([]),
  creadoEn: z.string(),
})

export type Activo = z.infer<typeof ActivoSchema>

/** Alta directa: genera asiento (docs/07 §3.1). */
export const SolicitudActivoManualSchema = z.object({
  nombre: z.string().min(1, 'El activo requiere un nombre'),
  descripcion: z.string().nullable().optional(),
  categoriaId: z.string().min(1, 'Seleccione la categoría del activo'),
  fechaAdquisicion: FechaISO,
  fechaInicioDepreciacion: FechaISO,
  moneda: MonedaSchema,
  tipoCambio: Importe,
  costoAdquisicion: Importe,
  /** Vacío = el porcentaje residual de la categoría. */
  valorResidual: Importe.optional(),
  vidaUtilMeses: z.number().int().min(1).optional(),
  /**
   * Contrapartida del cargo al activo: capital, donación, construcción en
   * proceso. La elige quien captura porque depende del hecho económico.
   */
  cuentaContrapartida: z.string().min(1, 'Indique la cuenta de contrapartida'),
  ubicacion: z.string().nullable().optional(),
  responsable: z.string().nullable().optional(),
  numeroSerie: z.string().nullable().optional(),
})

export type SolicitudActivoManual = z.infer<typeof SolicitudActivoManualSchema>

/** Alta desde una factura ya contabilizada en CxP: no genera asiento. */
export const SolicitudActivoDesdeFacturaSchema = z.object({
  facturaId: z.string().min(1),
  lineaId: z.string().min(1),
  nombre: z.string().min(1, 'El activo requiere un nombre'),
  categoriaId: z.string().min(1, 'Seleccione la categoría del activo'),
  fechaInicioDepreciacion: FechaISO,
  valorResidual: Importe.optional(),
  vidaUtilMeses: z.number().int().min(1).optional(),
  ubicacion: z.string().nullable().optional(),
  responsable: z.string().nullable().optional(),
  numeroSerie: z.string().nullable().optional(),
})

export type SolicitudActivoDesdeFactura = z.infer<
  typeof SolicitudActivoDesdeFacturaSchema
>

/**
 * Línea de factura de compra que cargó una cuenta de activo fijo y todavía no
 * tiene ficha.
 *
 * Es la lista de lo que el mayor ya reconoce como activo y el auxiliar aún no.
 * Mientras tenga renglones, la conciliación de docs/07 §4 no cuadra.
 */
export const AltaPendienteSchema = z.object({
  facturaId: z.string(),
  facturaFolio: z.string(),
  lineaId: z.string(),
  proveedorId: z.string(),
  proveedorNombre: z.string(),
  fecha: FechaISO,
  descripcion: z.string(),
  cuenta: z.string(),
  cuentaNombre: z.string(),
  moneda: MonedaSchema,
  importe: Importe,
  /** Categoría cuya cuenta de activo coincide con la de la línea, si hay una. */
  categoriaSugeridaId: z.string().nullable(),
})

export type AltaPendiente = z.infer<typeof AltaPendienteSchema>

/* ---------------------------------------------------------- Depreciación */

/**
 * Corrida mensual de depreciación (docs/07 §3.2).
 *
 * Se calcula entera antes de escribir nada: la previsualización devuelve la
 * misma corrida que después se contabiliza, con sus verificaciones, para que
 * quien la revisa vea exactamente lo que va a entrar al mayor.
 */
export const SeveridadVerificacionSchema = z.enum(['error', 'aviso'])

export type SeveridadVerificacion = z.infer<typeof SeveridadVerificacionSchema>

/**
 * Hallazgo de la verificación previa.
 *
 * Un `error` impide contabilizar; un `aviso` solo exige que alguien lo lea y
 * lo confirme. La distinción es la que separa "el periodo está cerrado" de
 * "este activo termina de depreciarse este mes".
 */
export const VerificacionSchema = z.object({
  codigo: z.string(),
  severidad: SeveridadVerificacionSchema,
  mensaje: z.string(),
  /** Activo al que se refiere, cuando no es de la corrida entera. */
  activoId: z.string().optional(),
})

export type Verificacion = z.infer<typeof VerificacionSchema>

export const LineaCorridaSchema = z.object({
  activoId: z.string(),
  codigo: z.string(),
  nombre: z.string(),
  categoriaId: z.string(),
  categoriaNombre: z.string(),
  metodo: MetodoDepreciacionSchema,
  valorEnLibrosInicial: Importe,
  /** Cuota contable (NIIF). Es la que abate la acumulada de la ficha. */
  cuota: Importe,
  /**
   * Cuota fiscal, solo cuando la tasa del reglamento difiere de la vida útil
   * contable (docs/07 §5). Nula cuando los dos libros llevan la misma cuota.
   */
  cuotaFiscal: Importe.nullable(),
  depreciacionAcumuladaResultante: Importe,
  valorEnLibrosResultante: Importe,
  /** Con esta cuota el activo cierra exacto contra su valor residual. */
  ultimaCuota: z.boolean(),
  verificaciones: z.array(VerificacionSchema),
})

export type LineaCorrida = z.infer<typeof LineaCorridaSchema>

export const CorridaDepreciacionSchema = z.object({
  periodoId: z.string(),
  moneda: MonedaSchema,
  lineas: z.array(LineaCorridaSchema),
  /** Suma de las cuotas contables. */
  total: Importe,
  /** Suma de lo que entra al libro fiscal. Igual al total si nada difiere. */
  totalFiscal: Importe,
  /** Las de la corrida entera más las de cada línea, en un solo lugar. */
  verificaciones: z.array(VerificacionSchema),
  /** Sin errores y con al menos una línea. */
  puedeContabilizar: z.boolean(),
})

export type CorridaDepreciacion = z.infer<typeof CorridaDepreciacionSchema>

/** GET /activos/depreciacion: la corrida y el asiento que generaría. */
export const PrevisualizacionCorridaSchema = z.object({
  corrida: CorridaDepreciacionSchema,
  /** Nulo cuando no hay ninguna línea que contabilizar. */
  asiento: SolicitudAsientoSchema.nullable(),
})

export type PrevisualizacionCorrida = z.infer<
  typeof PrevisualizacionCorridaSchema
>

export const SolicitudCorridaSchema = z.object({
  periodoId: z.string().min(1, 'Indique el periodo'),
  /**
   * Los avisos no bloquean, pero tampoco pasan solos: quien contabiliza
   * declara que los leyó. Sin esta marca, una corrida con avisos se rechaza.
   */
  confirmarAvisos: z.boolean(),
})

export type SolicitudCorrida = z.infer<typeof SolicitudCorridaSchema>

export const ResultadoCorridaSchema = z.object({
  corrida: CorridaDepreciacionSchema,
  asientoId: z.string(),
  asientoNumero: z.number().int(),
  activosActualizados: z.number().int(),
})

export type ResultadoCorrida = z.infer<typeof ResultadoCorridaSchema>

/** Una corrida ya contabilizada, reconstruida desde las fichas. */
export const CorridaHistorialSchema = z.object({
  periodoId: z.string(),
  fecha: FechaISO,
  total: Importe,
  asientoId: z.string(),
  activos: z.number().int(),
})

export type CorridaHistorial = z.infer<typeof CorridaHistorialSchema>
