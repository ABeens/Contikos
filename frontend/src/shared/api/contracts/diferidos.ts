import { z } from 'zod'
import {
  AuxiliarTipoSchema,
  FechaISO,
  Importe,
  ModuloSchema,
  MonedaSchema,
} from './comunes'
import { SolicitudAsientoSchema } from './conta'

/**
 * Contrato de asientos diferidos (docs/15).
 *
 * Un diferido es un hecho económico que ya se pagó o se cobró y que todavía no
 * se ha consumido: la póliza anual que se paga en enero y protege los doce
 * meses, el alquiler de un semestre pagado por adelantado, el mantenimiento
 * que se cobra al firmar y se presta durante un año. El desembolso no es el
 * gasto, y el cobro no es el ingreso: por eso el importe descansa en una
 * cuenta de balance y se traslada a resultados mes a mes.
 *
 * Las dos formas son simétricas y por eso viven en la misma entidad:
 *
 * - **Gasto diferido.** Pagado por adelantado. El saldo por amortizar es un
 *   ACTIVO, y cada mes se carga la cuenta de resultados contra él.
 * - **Ingreso diferido.** Cobrado por adelantado. El saldo por amortizar es un
 *   PASIVO, y cada mes se abona la cuenta de resultados contra él.
 *
 * El diferido no nace de la nada: casi siempre lo origina la factura de CxP
 * que pagó la póliza o la de CxC que cobró el servicio. Esa factura ya hizo su
 * asiento, así que el alta del diferido NO contabiliza nada (docs/15 §3.1).
 * Lo que contabiliza es la corrida mensual.
 */

export const TipoDiferidoSchema = z.enum(['gasto', 'ingreso'])

export type TipoDiferido = z.infer<typeof TipoDiferidoSchema>

/**
 * Estado del diferido.
 *
 * `agotado` es a lo que llega solo: cuando la última cuota deja el saldo por
 * amortizar en cero. `cancelado` es una decisión de alguien (docs/15 §3.4).
 */
export const EstadoDiferidoSchema = z.enum(['vigente', 'agotado', 'cancelado'])

export type EstadoDiferido = z.infer<typeof EstadoDiferidoSchema>

/**
 * Tercero del diferido: el asegurador, el arrendante, el cliente que pagó.
 *
 * Es opcional en la forma y obligatorio en la regla cuando la cuenta de
 * balance exige auxiliar (docs/15 §5): sin él, el asiento de la corrida no
 * podría escribirse contra esa cuenta.
 */
export const TerceroDiferidoSchema = z.object({
  tipo: AuxiliarTipoSchema,
  id: z.string(),
  nombre: z.string(),
})

export type TerceroDiferido = z.infer<typeof TerceroDiferidoSchema>

/**
 * Una cuota ya contabilizada sobre el diferido.
 *
 * Es el rastro de cada corrida en la ficha: con él se explica de dónde sale el
 * monto amortizado y se llega al asiento que lo escribió en el mayor.
 */
export const AmortizacionDiferidoSchema = z.object({
  periodoId: z.string(),
  fecha: FechaISO,
  cuota: Importe,
  asientoId: z.string(),
})

export type AmortizacionDiferido = z.infer<typeof AmortizacionDiferidoSchema>

/**
 * Baja anticipada consumada.
 *
 * Vive aparte de `amortizaciones` a propósito: el reconocimiento de golpe no es
 * una cuota de la corrida mensual y mezclarlo con ellas inflaría el total del
 * historial de corridas del periodo, que se reconstruye justo de esa lista
 * (docs/15 §3.4).
 */
export const CancelacionDiferidoSchema = z.object({
  fecha: FechaISO,
  motivo: z.string(),
  /** Saldo que quedaba y que pasó entero a resultados. Puede ser cero. */
  importeReconocido: Importe,
  /** Nulo cuando no quedaba saldo: no hubo nada que contabilizar. */
  asientoId: z.string().nullable(),
})

export type CancelacionDiferido = z.infer<typeof CancelacionDiferidoSchema>

export const DiferidoSchema = z.object({
  id: z.string(),
  /** Correlativo visible: DIF-0001. */
  codigo: z.string(),
  tipo: TipoDiferidoSchema,
  descripcion: z.string(),
  tercero: TerceroDiferidoSchema.nullable(),
  monto: Importe,
  moneda: MonedaSchema,
  /**
   * Cuenta de balance donde descansa lo que falta por reconocer: activo si es
   * un gasto pagado por adelantado, pasivo si es un ingreso cobrado por
   * adelantado.
   */
  cuentaDiferido: z.string(),
  /** Cuenta de resultados que recibe el reconocimiento de cada mes. */
  cuentaDestino: z.string(),
  fechaInicio: FechaISO,
  plazoMeses: z.number().int().min(1),
  /** Derivada: monto entre plazo. La última cuota ajusta el remanente. */
  cuotaMensual: Importe,
  /**
   * Lo que ya está en resultados: las corridas contabilizadas y, si se canceló,
   * también el remanente reconocido de golpe. Es siempre lo que ya no descansa
   * en la cuenta de balance, venga de donde venga.
   */
  montoAmortizado: Importe,
  /** Derivado: monto menos amortizado. Es el saldo vivo de la cuenta. */
  saldoPorAmortizar: Importe,
  estado: EstadoDiferidoSchema,
  /** Solo cuando el estado es `cancelado`. */
  cancelacion: CancelacionDiferidoSchema.nullable(),
  /** La factura de CxP o de CxC que lo originó, si vino de ahí. */
  origen: z
    .object({ modulo: ModuloSchema, tipo: z.string(), id: z.string() })
    .nullable(),
  /** Cuotas contabilizadas, de la más antigua a la más reciente. */
  amortizaciones: z.array(AmortizacionDiferidoSchema).default([]),
  creadoEn: z.string(),
})

export type Diferido = z.infer<typeof DiferidoSchema>

/**
 * Alta y edición.
 *
 * No lleva `codigo`, `cuotaMensual`, `montoAmortizado`, `saldoPorAmortizar` ni
 * `estado`: el primero lo pone el servidor y los demás son derivados del
 * monto, del plazo y de las corridas. Capturar lo que ya se deduce es la forma
 * segura de que un día no coincidan.
 */
export const SolicitudDiferidoSchema = z.object({
  tipo: TipoDiferidoSchema,
  descripcion: z.string().min(1, 'El diferido requiere una descripción'),
  tercero: TerceroDiferidoSchema.nullable(),
  monto: Importe,
  moneda: MonedaSchema,
  cuentaDiferido: z.string().min(1, 'Indique la cuenta de balance del diferido'),
  cuentaDestino: z.string().min(1, 'Indique la cuenta de resultados'),
  fechaInicio: FechaISO,
  plazoMeses: z.number().int().min(1, 'El plazo es de al menos un mes'),
  origen: z
    .object({ modulo: ModuloSchema, tipo: z.string(), id: z.string() })
    .nullable()
    .optional(),
})

export type SolicitudDiferido = z.infer<typeof SolicitudDiferidoSchema>

/**
 * Baja anticipada (docs/15 §3.4).
 *
 * El diferido deja de amortizarse y su saldo remanente se reconoce de golpe:
 * un seguro cancelado a mitad de año ya no protege nada, así que lo que queda
 * en la cuenta de balance dejó de ser un activo. La fecha decide el periodo en
 * el que entra ese reconocimiento.
 */
export const SolicitudCancelacionDiferidoSchema = z.object({
  fecha: FechaISO,
  motivo: z.string().min(1, 'Indique el motivo de la cancelación'),
})

export type SolicitudCancelacionDiferido = z.infer<
  typeof SolicitudCancelacionDiferidoSchema
>

export const ResultadoCancelacionSchema = z.object({
  diferido: DiferidoSchema,
  /** Nulo cuando no quedaba saldo: no hay nada que reconocer. */
  asientoId: z.string().nullable(),
})

export type ResultadoCancelacion = z.infer<typeof ResultadoCancelacionSchema>

/* ------------------------------------------------------- Amortización */

export const SeveridadVerificacionSchema = z.enum(['error', 'aviso'])

export type SeveridadVerificacion = z.infer<typeof SeveridadVerificacionSchema>

/**
 * Hallazgo de la verificación previa.
 *
 * Un `error` impide contabilizar; un `aviso` solo exige que alguien lo lea y
 * lo confirme. La distinción es la que separa "el periodo está cerrado" de
 * "este diferido se agota con la cuota de este mes".
 */
export const VerificacionSchema = z.object({
  codigo: z.string(),
  severidad: SeveridadVerificacionSchema,
  mensaje: z.string(),
  /** Diferido al que se refiere, cuando no es de la corrida entera. */
  diferidoId: z.string().optional(),
})

export type Verificacion = z.infer<typeof VerificacionSchema>

export const LineaCorridaDiferidosSchema = z.object({
  diferidoId: z.string(),
  codigo: z.string(),
  descripcion: z.string(),
  tipo: TipoDiferidoSchema,
  cuentaDiferido: z.string(),
  cuentaDestino: z.string(),
  saldoInicial: Importe,
  cuota: Importe,
  montoAmortizadoResultante: Importe,
  saldoResultante: Importe,
  /** Con esta cuota el saldo cierra exacto en cero y el diferido se agota. */
  ultimaCuota: z.boolean(),
  verificaciones: z.array(VerificacionSchema),
})

export type LineaCorridaDiferidos = z.infer<typeof LineaCorridaDiferidosSchema>

/**
 * Corrida mensual de amortización (docs/15 §3.2).
 *
 * Se calcula entera antes de escribir nada: la previsualización devuelve la
 * misma corrida que después se contabiliza, con sus verificaciones, para que
 * quien la revisa vea exactamente lo que va a entrar al mayor.
 */
export const CorridaDiferidosSchema = z.object({
  periodoId: z.string(),
  moneda: MonedaSchema,
  lineas: z.array(LineaCorridaDiferidosSchema),
  /** Suma de las cuotas de gasto reconocidas. */
  totalGasto: Importe,
  /** Suma de las cuotas de ingreso reconocidas. */
  totalIngreso: Importe,
  /** Las de la corrida entera más las de cada línea, en un solo lugar. */
  verificaciones: z.array(VerificacionSchema),
  /** Sin errores y con al menos una línea. */
  puedeContabilizar: z.boolean(),
})

export type CorridaDiferidos = z.infer<typeof CorridaDiferidosSchema>

/** GET /diferidos/amortizacion: la corrida y el asiento que generaría. */
export const PrevisualizacionCorridaDiferidosSchema = z.object({
  corrida: CorridaDiferidosSchema,
  /** Nulo cuando no hay ninguna línea que contabilizar. */
  asiento: SolicitudAsientoSchema.nullable(),
})

export type PrevisualizacionCorridaDiferidos = z.infer<
  typeof PrevisualizacionCorridaDiferidosSchema
>

export const SolicitudCorridaDiferidosSchema = z.object({
  periodoId: z.string().min(1, 'Indique el periodo'),
  /**
   * Los avisos no bloquean, pero tampoco pasan solos: quien contabiliza
   * declara que los leyó. Sin esta marca, una corrida con avisos se rechaza.
   */
  confirmarAvisos: z.boolean(),
})

export type SolicitudCorridaDiferidos = z.infer<
  typeof SolicitudCorridaDiferidosSchema
>

export const ResultadoCorridaDiferidosSchema = z.object({
  corrida: CorridaDiferidosSchema,
  asientoId: z.string(),
  asientoNumero: z.number().int(),
  diferidosActualizados: z.number().int(),
})

export type ResultadoCorridaDiferidos = z.infer<
  typeof ResultadoCorridaDiferidosSchema
>

/** Una corrida ya contabilizada, reconstruida desde las fichas. */
export const CorridaDiferidosHistorialSchema = z.object({
  periodoId: z.string(),
  fecha: FechaISO,
  total: Importe,
  asientoId: z.string(),
  diferidos: z.number().int(),
})

export type CorridaDiferidosHistorial = z.infer<
  typeof CorridaDiferidosHistorialSchema
>

/**
 * Una fila de la tabla de amortización proyectada.
 *
 * No se almacena: se calcula para enseñar el plan completo antes de guardar el
 * diferido, que es lo que permite comprobar que el monto cierra exacto en cero
 * en la última cuota (docs/15 §3.1).
 */
export const FilaAmortizacionSchema = z.object({
  numero: z.number().int().min(1),
  fecha: FechaISO,
  cuota: Importe,
  acumulado: Importe,
  saldo: Importe,
})

export type FilaAmortizacion = z.infer<typeof FilaAmortizacionSchema>
