import { z } from 'zod'
import type {
  PosicionSimbolo,
  SeparadorDecimal,
  SeparadorGrupo,
} from '@/shared/money/money'
import { FechaISO, Importe, MonedaSchema } from './comunes'

/* ---------------------------------------------------------------- Monedas */

/**
 * Catálogo de monedas de la empresa — docs/10 §2.
 *
 * Las anotaciones de tipo atan estos esquemas a los del registro de formato
 * (`shared/money/money.ts`): si un día se admite un separador nuevo, no compila
 * hasta que ambos lados lo conozcan.
 */
export const SeparadorGrupoSchema: z.ZodType<SeparadorGrupo> = z.enum([
  '.',
  ',',
  ' ',
  "'",
  '',
])

export const SeparadorDecimalSchema: z.ZodType<SeparadorDecimal> = z.enum([
  '.',
  ',',
])

export const PosicionSimboloSchema: z.ZodType<PosicionSimbolo> = z.enum([
  'antes',
  'despues',
])

export const MonedaConfigSchema = z.object({
  codigo: MonedaSchema,
  nombre: z.string().min(1),
  simbolo: z.string().min(1).max(4),
  decimales: z.number().int().min(0).max(6),
  grupo: SeparadorGrupoSchema,
  decimal: SeparadorDecimalSchema,
  posicionSimbolo: PosicionSimboloSchema,
  activa: z.boolean(),
  /** Moneda del libro mayor. Exactamente una en el catálogo (docs/01 §4.2). */
  funcional: z.boolean(),
  /**
   * Tipo de cambio de referencia contra la funcional.
   *
   * Es una REFERENCIA, no la fuente de verdad. No tiene fecha, así que sirve
   * para proponer un valor cuando no hay nada mejor a mano y para presentar el
   * catálogo, pero no para contabilizar: lo que se contabiliza sale de la tabla
   * `TipoCambio` con fecha (docs/13 §7, docs/10 §2), y una vez emitido queda
   * congelado en el asiento. Se conserva porque el catálogo de monedas lo lleva
   * desde el principio y porque traer el tipo del día lo actualiza.
   */
  tipoCambio: Importe,
  /**
   * Derivado por el servidor: ya hay asientos o cuentas expresados en ella.
   *
   * Lo calcula quien tiene los datos, no la pantalla. Es lo que separa
   * "desactivar" de "eliminar" y lo que permite decírselo al usuario ANTES de
   * que intente borrar.
   */
  enUso: z.boolean(),
})

export type MonedaConfig = z.infer<typeof MonedaConfigSchema>

/** La moneda sin los campos derivados. Es lo que se almacena. */
export type MonedaBase = Omit<MonedaConfig, 'enUso'>

/**
 * Alta y modificación.
 *
 * `funcional` se omite: cambiar la moneda funcional no es editar una moneda,
 * es una operación sobre el catálogo entero — mueve la marca de una a otra.
 * Tiene su propio endpoint. `enUso` se omite por ser derivado.
 */
export const SolicitudMonedaSchema = MonedaConfigSchema.omit({
  funcional: true,
  enUso: true,
})

export type SolicitudMoneda = z.infer<typeof SolicitudMonedaSchema>

/* -------------------------------------------------------- Tipo de cambio */

/**
 * De dónde sale el par compra/venta de una moneda.
 *
 * `publicado`: la fuente lo publica tal cual.
 * `derivado`: se calculó a partir de otros valores publicados. El euro y los
 * cruces contra una moneda funcional que no sea la de la fuente entran aquí
 * (docs/13 §7).
 */
export const OrigenTipoCambioSchema = z.enum(['publicado', 'derivado'])

export type OrigenTipoCambio = z.infer<typeof OrigenTipoCambioSchema>

/**
 * Tipo de cambio de una moneda, en unidades de la moneda base de la tabla.
 *
 * Compra y venta van separadas porque así las publica la fuente y así las pide
 * docs/13 §7: la diferencia cambiaria en Costa Rica no es un caso de borde.
 */
export const TipoCambioMonedaSchema = z.object({
  moneda: MonedaSchema,
  compra: Importe,
  venta: Importe,
  origen: OrigenTipoCambioSchema,
  /** Cómo se obtuvo, cuando no es un valor publicado. Se muestra al usuario. */
  nota: z.string().optional(),
})

export type TipoCambioMoneda = z.infer<typeof TipoCambioMonedaSchema>

/**
 * Tipos de cambio de un día.
 *
 * La tabla declara su fecha y su moneda base: el consumidor no supone que sean
 * hoy ni el colón. Un tipo de cambio sin fecha no sirve para contabilizar, y el
 * que se contabiliza queda congelado en el asiento (docs/13 §7).
 */
export const TablaTipoCambioSchema = z.object({
  fecha: FechaISO,
  /** Moneda en la que se expresan compra y venta. */
  base: MonedaSchema,
  fuente: z.string(),
  monedas: z.array(TipoCambioMonedaSchema),
})

export type TablaTipoCambio = z.infer<typeof TablaTipoCambioSchema>

/* ----------------------------------- Tipo de cambio con fecha (tabla) */

/**
 * Tipo de cambio de una moneda en un día (docs/13 §7, docs/10 §2).
 *
 * Es la tabla `TipoCambio` del modelo de datos, y es **la fuente de verdad para
 * contabilizar**: un tipo de cambio sin fecha no sirve para expresar un
 * documento en la moneda funcional, porque lo que vale es el del día del
 * documento y no el de hoy. El campo `tipoCambio` de la moneda es solo la
 * referencia vigente del catálogo.
 *
 * Los valores se expresan en **unidades de la moneda funcional de la empresa
 * por una unidad de `moneda`**, que es la forma en la que se usan: importe por
 * tipo de cambio da el importe del mayor. La moneda funcional se cambia a sí
 * misma a la par y por eso no viaja en la tabla.
 *
 * Compra y venta van separadas porque así las publica la fuente y así las pide
 * docs/13 §7: la diferencia cambiaria en Costa Rica no es un caso de borde.
 */
export const TipoCambioSchema = z.object({
  moneda: MonedaSchema,
  fecha: FechaISO,
  compra: Importe,
  venta: Importe,
  origen: OrigenTipoCambioSchema,
  /** Quién lo publicó o de dónde salió. Se muestra al usuario tal cual. */
  fuente: z.string(),
})

export type TipoCambio = z.infer<typeof TipoCambioSchema>

/**
 * Captura manual de un tipo de cambio para una fecha.
 *
 * `origen` no se captura: lo que alguien teclea es un dato publicado que
 * transcribe, así que el servidor lo marca como `publicado`. Lo derivado lo
 * produce el sistema, nunca el usuario.
 */
export const SolicitudTipoCambioSchema = z.object({
  moneda: MonedaSchema,
  fecha: FechaISO,
  compra: Importe,
  venta: Importe,
  fuente: z.string().min(1, 'Indique la fuente del tipo de cambio'),
})

export type SolicitudTipoCambio = z.infer<typeof SolicitudTipoCambioSchema>
