import Decimal from 'decimal.js'
import type { Periodo } from '@/shared/api/contracts/conta'
import type {
  CargaCalculada,
  Empleado,
  Incidencia,
  LineaPlanilla,
  ParametrosPlanilla,
  Planilla,
  TramoRenta,
} from '@/shared/api/contracts/rh'

/**
 * Motor de planilla de Costa Rica (docs/08 §1, docs/13 §6).
 *
 * Es la implementación de `MotorNominaLocal` para un país, y la única: todo lo
 * que depende de la ley está en `ParametrosPlanilla`, que se administran en la
 * aplicación con su fecha de vigencia (D-06). Aquí no hay ni una tasa escrita.
 *
 * Todo en `decimal.js` y redondeado a céntimos en cada importe que se reporta:
 * lo que se paga y lo que se declara a la CCSS tienen que coincidir con el
 * recibo hasta el céntimo.
 *
 * Lo que este motor NO hace todavía, y está dicho en docs/13 §6.4:
 * incapacidades (el subsidio lo paga en parte la CCSS), la rebaja para menores
 * de 35 años en jornada parcial y la liquidación al terminar la relación.
 */

const CERO = new Decimal(0)
const CIEN = new Decimal(100)
const DIAS_MES = 30

const centimos = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)

/** Los parámetros que rigen en una fecha: los más recientes que ya empezaron. */
export function parametrosVigentes(
  lista: readonly ParametrosPlanilla[],
  fecha: string,
): ParametrosPlanilla | undefined {
  return [...lista]
    .filter((p) => p.vigenteDesde <= fecha)
    .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))[0]
}

/**
 * Impuesto sobre la renta del salario, por tramos (docs/13 §6.2).
 *
 * Cada tasa se aplica solo a la parte del salario que cae en su tramo. Los
 * créditos por hijos y cónyuge se restan del impuesto, no del salario, y el
 * impuesto nunca queda negativo.
 */
export function impuestoRenta(
  bruto: Decimal,
  tramos: readonly TramoRenta[],
  creditos: Decimal,
): Decimal {
  let impuesto = CERO
  for (const tramo of tramos) {
    const desde = new Decimal(tramo.desde)
    if (bruto.lessThanOrEqualTo(desde)) continue
    const hasta = tramo.hasta === null ? bruto : Decimal.min(bruto, tramo.hasta)
    impuesto = impuesto.plus(hasta.minus(desde).times(tramo.tasa).dividedBy(CIEN))
  }
  return centimos(Decimal.max(impuesto.minus(creditos), CERO))
}

/**
 * Días del mes que el empleado estuvo contratado, en meses de treinta días.
 *
 * Es la convención de la planilla costarricense: el salario mensual se paga
 * entero aunque el mes tenga 31 días, y quien entra el 16 cobra quince días.
 */
export function diasLaborados(empleado: Empleado, periodo: Periodo): number {
  const dia = (fecha: string) => Math.min(Number(fecha.slice(8, 10)), DIAS_MES)
  const desde = empleado.fechaIngreso > periodo.fechaInicio ? dia(empleado.fechaIngreso) : 1
  const hasta =
    empleado.fechaSalida && empleado.fechaSalida < periodo.fechaFin
      ? dia(empleado.fechaSalida)
      : DIAS_MES
  return Math.max(0, hasta - desde + 1)
}

/** Entra en la planilla del mes: contratado en algún día del periodo. */
export function estaEnPlanilla(empleado: Empleado, periodo: Periodo): boolean {
  return (
    empleado.activo &&
    empleado.fechaIngreso <= periodo.fechaFin &&
    (empleado.fechaSalida === null || empleado.fechaSalida >= periodo.fechaInicio)
  )
}

export const INCIDENCIA_VACIA = (empleadoId: string): Incidencia => ({
  empleadoId,
  horasExtra: '0',
  bonificaciones: '0',
  diasSinGoce: 0,
  otrasDeducciones: '0',
})

/**
 * Una línea de planilla: del salario base al neto, con las cargas del
 * patrono y las provisiones.
 *
 * La base mínima contributiva sube la base del SEM y del IVM cuando el salario
 * del mes queda por debajo (docs/13 §6.1). Se aplica a las dos partes, la del
 * trabajador y la del patrono. ⚠️ Confirmar con la CCSS quién asume la
 * diferencia en jornadas parciales.
 */
export function calcularLinea(
  empleado: Empleado,
  incidencia: Incidencia,
  periodo: Periodo,
  parametros: ParametrosPlanilla,
  pymeMenosDe5: boolean,
  brutoAnterior: string | null,
): LineaPlanilla {
  const salario = new Decimal(empleado.salarioBase)
  const diario = salario.dividedBy(DIAS_MES)
  const dias = diasLaborados(empleado, periodo)

  // Lo no laborado por ingreso o salida a medio mes, más los días sin goce.
  const noLaborados = DIAS_MES - dias + incidencia.diasSinGoce
  const rebajo = centimos(diario.times(Math.min(noLaborados, DIAS_MES)))

  const valorHora = salario.dividedBy(parametros.horasMes)
  const factorExtra = CIEN.plus(parametros.recargoHoraExtra).dividedBy(CIEN)
  const montoHorasExtra = centimos(valorHora.times(factorExtra).times(incidencia.horasExtra))
  const bonificaciones = centimos(new Decimal(incidencia.bonificaciones))

  const bruto = salario.minus(rebajo).plus(montoHorasExtra).plus(bonificaciones)

  const baseDe = (base: 'salario' | 'sem' | 'ivm'): Decimal => {
    if (base === 'sem') return Decimal.max(bruto, parametros.baseMinimaSem)
    if (base === 'ivm') return Decimal.max(bruto, parametros.baseMinimaIvm)
    return bruto
  }

  // Sin salario en el mes (todo sin goce) no hay nada que cotizar: la base
  // mínima no aplica a quien no devengó nada.
  const cargas: CargaCalculada[] = parametros.cargas
    .filter((c) => !(c.exentaPymeMenosDe5 && pymeMenosDe5))
    .map((c) => {
      const base = bruto.isZero() ? CERO : baseDe(c.base)
      return {
        codigo: c.codigo,
        nombre: c.nombre,
        paga: c.paga,
        base: base.toFixed(2),
        tasa: c.tasa,
        monto: centimos(base.times(c.tasa).dividedBy(CIEN)).toFixed(2),
      }
    })

  const suma = (paga: 'trabajador' | 'patrono') =>
    cargas.filter((c) => c.paga === paga).reduce((acc, c) => acc.plus(c.monto), CERO)
  const cargasTrabajador = suma('trabajador')
  const cargasPatrono = suma('patrono')

  const creditos = new Decimal(parametros.creditoHijo)
    .times(empleado.hijos)
    .plus(empleado.creditoConyuge ? parametros.creditoConyuge : 0)
  const renta = impuestoRenta(bruto, parametros.tramosRenta, creditos)
  const otras = centimos(new Decimal(incidencia.otrasDeducciones))

  const provision = (tasa: string) => centimos(bruto.times(tasa).dividedBy(CIEN))

  const variacion =
    brutoAnterior === null || new Decimal(brutoAnterior).isZero()
      ? null
      : bruto.minus(brutoAnterior).dividedBy(brutoAnterior).times(CIEN).toFixed(2)

  return {
    empleadoId: empleado.id,
    empleadoCodigo: empleado.codigo,
    empleadoNombre: empleado.nombre,
    salarioBase: salario.toFixed(2),
    rebajoSinGoce: rebajo.toFixed(2),
    horasExtra: incidencia.horasExtra,
    montoHorasExtra: montoHorasExtra.toFixed(2),
    bonificaciones: bonificaciones.toFixed(2),
    bruto: bruto.toFixed(2),
    cargas,
    cargasTrabajador: cargasTrabajador.toFixed(2),
    cargasPatrono: cargasPatrono.toFixed(2),
    impuestoRenta: renta.toFixed(2),
    otrasDeducciones: otras.toFixed(2),
    neto: bruto.minus(cargasTrabajador).minus(renta).minus(otras).toFixed(2),
    provisionAguinaldo: provision(parametros.provisionAguinaldo).toFixed(2),
    provisionVacaciones: provision(parametros.provisionVacaciones).toFixed(2),
    provisionCesantia: provision(parametros.provisionCesantia).toFixed(2),
    variacion,
  }
}

export interface TotalesPlanilla {
  totalBruto: string
  totalCargasTrabajador: string
  totalCargasPatrono: string
  totalRenta: string
  totalOtrasDeducciones: string
  totalNeto: string
  totalProvisiones: string
}

export function totalesDe(lineas: readonly LineaPlanilla[]): TotalesPlanilla {
  const suma = (f: (l: LineaPlanilla) => string) =>
    lineas.reduce((acc, l) => acc.plus(f(l)), CERO).toFixed(2)
  return {
    totalBruto: suma((l) => l.bruto),
    totalCargasTrabajador: suma((l) => l.cargasTrabajador),
    totalCargasPatrono: suma((l) => l.cargasPatrono),
    totalRenta: suma((l) => l.impuestoRenta),
    totalOtrasDeducciones: suma((l) => l.otrasDeducciones),
    totalNeto: suma((l) => l.neto),
    totalProvisiones: suma((l) =>
      new Decimal(l.provisionAguinaldo)
        .plus(l.provisionVacaciones)
        .plus(l.provisionCesantia)
        .toFixed(2),
    ),
  }
}

/**
 * Calcula la planilla de un mes.
 *
 * Entran los empleados contratados en algún día del periodo. La incidencia que
 * no se capturó es cero: un mes sin horas extra no necesita que alguien lo
 * diga. La planilla anterior da la variación que se revisa antes de aprobar
 * (docs/08 §3): el 90 % de los errores aparecen como una variación sin
 * explicación.
 */
export function calcularPlanilla(
  empleados: readonly Empleado[],
  incidencias: readonly Incidencia[],
  periodo: Periodo,
  parametros: ParametrosPlanilla,
  pymeMenosDe5: boolean,
  anterior: Planilla | undefined,
): { lineas: LineaPlanilla[]; totales: TotalesPlanilla } {
  const lineas = empleados
    .filter((e) => estaEnPlanilla(e, periodo))
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
    .map((e) =>
      calcularLinea(
        e,
        incidencias.find((i) => i.empleadoId === e.id) ?? INCIDENCIA_VACIA(e.id),
        periodo,
        parametros,
        pymeMenosDe5,
        anterior?.lineas.find((l) => l.empleadoId === e.id)?.bruto ?? null,
      ),
    )
  return { lineas, totales: totalesDe(lineas) }
}

/** Variación que se marca para revisar, en valor absoluto. */
export const UMBRAL_VARIACION = new Decimal(10)

export function requiereRevision(linea: LineaPlanilla): boolean {
  return linea.variacion !== null && new Decimal(linea.variacion).abs().greaterThan(UMBRAL_VARIACION)
}
