import { z } from 'zod'
import { FechaISO, Importe, TipoIdentificacionSchema } from './comunes'

/**
 * Contrato de recursos humanos y planilla (docs/08, docs/13 §6).
 *
 * La planilla se calcula dentro de Contikos (D-06), y todas sus tasas, tramos y
 * bases son parámetros con vigencia por fecha: el cálculo de un mes usa los
 * vigentes en ese mes, y un cambio de ley es una fila nueva, no una versión
 * nueva del sistema.
 */

/* ----------------------------------------------------------- Parámetros */

/** Una carga social: a quién se le cobra y sobre qué base. */
export const CargaSocialSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  /** Porcentaje, como texto decimal: "5.50" es 5,50 %. */
  tasa: Importe,
  paga: z.enum(['trabajador', 'patrono']),
  /**
   * Base sobre la que se calcula. `sem` e `ivm` se elevan a la base mínima
   * contributiva de su seguro cuando el salario queda por debajo; `salario`
   * es el salario reportado tal cual.
   */
  base: z.enum(['salario', 'sem', 'ivm']),
  /**
   * No se cobra a los patronos no agropecuarios con menos de cinco
   * trabajadores. Es el caso del INA (docs/13 §6.1).
   */
  exentaPymeMenosDe5: z.boolean(),
})

export type CargaSocial = z.infer<typeof CargaSocialSchema>

/** Un tramo del impuesto al salario: desde (exclusivo) hasta (inclusivo). */
export const TramoRentaSchema = z.object({
  desde: Importe,
  /** Nulo en el último: sin tope. */
  hasta: Importe.nullable(),
  tasa: Importe,
})

export type TramoRenta = z.infer<typeof TramoRentaSchema>

/**
 * Los parámetros de planilla que rigen desde una fecha.
 *
 * Se guardan enteros y no por partes (una fila para la CCSS, otra para la
 * renta) porque así se leen: "lo que rige desde el 1 de enero de 2026". Un
 * cambio a media año en una sola tasa es una fila nueva que copia el resto.
 */
export const ParametrosPlanillaSchema = z.object({
  id: z.string(),
  vigenteDesde: FechaISO,
  /** Qué norma lo respalda: decreto, acuerdo de Junta Directiva. */
  fuente: z.string(),
  cargas: z.array(CargaSocialSchema).min(1),
  baseMinimaSem: Importe,
  baseMinimaIvm: Importe,
  tramosRenta: z.array(TramoRentaSchema).min(1),
  creditoHijo: Importe,
  creditoConyuge: Importe,
  /** Provisiones mensuales sobre el salario bruto, en porcentaje. */
  provisionAguinaldo: Importe,
  provisionVacaciones: Importe,
  provisionCesantia: Importe,
  /** Recargo de la hora extra sobre la hora ordinaria: 50 es tiempo y medio. */
  recargoHoraExtra: Importe,
  /** Horas de la jornada ordinaria mensual, para el valor de la hora. */
  horasMes: Importe,
})

export type ParametrosPlanilla = z.infer<typeof ParametrosPlanillaSchema>

export const SolicitudParametrosPlanillaSchema = ParametrosPlanillaSchema.omit({ id: true })

export type SolicitudParametrosPlanilla = z.infer<typeof SolicitudParametrosPlanillaSchema>

/* ------------------------------------------------------------- Empleados */

export const EmpleadoSchema = z.object({
  id: z.string(),
  codigo: z.string(),
  nombre: z.string(),
  tipoIdentificacion: TipoIdentificacionSchema,
  identificacion: z.string(),
  /** Número de asegurado ante la CCSS. En Costa Rica suele ser la cédula. */
  numeroAsegurado: z.string(),
  puesto: z.string(),
  fechaIngreso: FechaISO,
  /** Nula mientras trabaja. */
  fechaSalida: FechaISO.nullable(),
  /** Salario mensual ordinario, en moneda funcional. */
  salarioBase: Importe,
  /** Hijos que dan derecho al crédito fiscal. */
  hijos: z.number().int().min(0),
  /** El crédito por cónyuge lo toma uno solo de los dos. */
  creditoConyuge: z.boolean(),
  /** Cuenta IBAN a la que se le paga. */
  cuentaIban: z.string(),
  activo: z.boolean(),
})

export type Empleado = z.infer<typeof EmpleadoSchema>

export const SolicitudEmpleadoSchema = EmpleadoSchema.omit({ id: true })

export type SolicitudEmpleado = z.infer<typeof SolicitudEmpleadoSchema>

/* --------------------------------------------------------------- Planilla */

/** Lo que cambia de un mes a otro para un empleado. */
export const IncidenciaSchema = z.object({
  empleadoId: z.string(),
  horasExtra: Importe,
  /** Bonos y comisiones gravados, en colones. */
  bonificaciones: Importe,
  /** Días de permiso sin goce de salario: se rebajan del salario. */
  diasSinGoce: z.number().int().min(0).max(30),
  /** Rebajos que no son cargas ni impuesto: préstamos, embargos, pensiones. */
  otrasDeducciones: Importe,
})

export type Incidencia = z.infer<typeof IncidenciaSchema>

/** El detalle de una carga en una línea de planilla. */
export const CargaCalculadaSchema = z.object({
  codigo: z.string(),
  nombre: z.string(),
  paga: z.enum(['trabajador', 'patrono']),
  base: Importe,
  tasa: Importe,
  monto: Importe,
})

export type CargaCalculada = z.infer<typeof CargaCalculadaSchema>

/** Una línea de planilla: un empleado, todo calculado. */
export const LineaPlanillaSchema = z.object({
  empleadoId: z.string(),
  empleadoCodigo: z.string(),
  empleadoNombre: z.string(),
  salarioBase: Importe,
  rebajoSinGoce: Importe,
  horasExtra: Importe,
  montoHorasExtra: Importe,
  bonificaciones: Importe,
  /** Salario bruto: base menos rebajo, más extras y bonos. Es lo que se reporta. */
  bruto: Importe,
  cargas: z.array(CargaCalculadaSchema),
  cargasTrabajador: Importe,
  cargasPatrono: Importe,
  impuestoRenta: Importe,
  otrasDeducciones: Importe,
  neto: Importe,
  provisionAguinaldo: Importe,
  provisionVacaciones: Importe,
  provisionCesantia: Importe,
  /** Variación del bruto contra la planilla anterior, en %. Nula si no había. */
  variacion: Importe.nullable(),
})

export type LineaPlanilla = z.infer<typeof LineaPlanillaSchema>

export const EstadoPlanillaSchema = z.enum(['calculada', 'contabilizada', 'pagada'])

export type EstadoPlanilla = z.infer<typeof EstadoPlanillaSchema>

export const PlanillaSchema = z.object({
  id: z.string(),
  periodoId: z.string(),
  fechaPago: FechaISO,
  /** Qué parámetros se usaron: los vigentes al cierre del mes. */
  parametrosId: z.string(),
  /** El patrono tiene menos de cinco trabajadores y no es agropecuario. */
  pymeMenosDe5: z.boolean(),
  incidencias: z.array(IncidenciaSchema),
  lineas: z.array(LineaPlanillaSchema),
  totalBruto: Importe,
  totalCargasTrabajador: Importe,
  totalCargasPatrono: Importe,
  totalRenta: Importe,
  totalOtrasDeducciones: Importe,
  totalNeto: Importe,
  totalProvisiones: Importe,
  estado: EstadoPlanillaSchema,
  asientoId: z.string().nullable(),
  asientoPagoId: z.string().nullable(),
  cuentaBancariaId: z.string().nullable(),
  calculadaEn: z.string(),
})

export type Planilla = z.infer<typeof PlanillaSchema>

export const SolicitudCalculoPlanillaSchema = z.object({
  periodoId: z.string().min(1),
  fechaPago: FechaISO,
  pymeMenosDe5: z.boolean(),
  incidencias: z.array(IncidenciaSchema),
})

export type SolicitudCalculoPlanilla = z.infer<typeof SolicitudCalculoPlanillaSchema>

export const SolicitudPagoPlanillaSchema = z.object({
  cuentaBancariaId: z.string().min(1, 'Elija la cuenta de la que sale el pago'),
  fecha: FechaISO,
})

export type SolicitudPagoPlanilla = z.infer<typeof SolicitudPagoPlanillaSchema>

/* ------------------------------------------------------- Mapeo contable */

/** Las cuentas que mueve la planilla (docs/08 §4 y §8). */
export const MapeoRhSchema = z.object({
  gastoSalarios: z.string(),
  gastoCargasPatronales: z.string(),
  gastoAguinaldo: z.string(),
  gastoVacaciones: z.string(),
  gastoCesantia: z.string(),
  ccssPorPagar: z.string(),
  rentaPorPagar: z.string(),
  otrasDeduccionesPorPagar: z.string(),
  salariosPorPagar: z.string(),
  provisionAguinaldo: z.string(),
  provisionVacaciones: z.string(),
  provisionCesantia: z.string(),
})

export type MapeoRh = z.infer<typeof MapeoRhSchema>
