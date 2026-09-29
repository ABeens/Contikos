import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import { rutaApi } from '@/shared/api/entorno'
import {
  SolicitudCalculoPlanillaSchema,
  SolicitudEmpleadoSchema,
  SolicitudPagoPlanillaSchema,
  SolicitudParametrosPlanillaSchema,
  type Empleado,
  type Planilla,
  type SolicitudEmpleado,
  type SolicitudParametrosPlanilla,
} from '@/shared/api/contracts/rh'
import { monedaFuncional } from '@/shared/money/money'
import { formatPeriodo } from '@/shared/format/fecha'
import { calcularPlanilla, parametrosVigentes } from '@/modules/rh/domain/calculo'
import { asientoDePago, asientoDePlanilla } from '@/modules/rh/domain/asiento'
import { latencia } from '../latencia'
import { PERIODOS } from '../seed/periodos'
import {
  MAPEO_RH,
  empleadosMock,
  parametrosPlanillaMock,
  persistirEmpleados,
  persistirParametrosPlanilla,
  persistirPlanillas,
  planillasMock,
} from '../seed/rh'
import { emitirAsiento } from './conta'
import { cuentasBancariasServidas, registrarMovimientoExterno } from './bancos'

/**
 * Mock de recursos humanos (docs/08).
 *
 * Todas las rutas pasan por la guardia de permisos con `planilla.ver` para
 * leer y `planilla.operar` para escribir: los datos salariales no los ve quien
 * no lleva la planilla, aunque sea el contador (docs/08 §7).
 *
 * El ciclo de la planilla es el de docs/08 §3, sin el timbrado:
 * calcular (se puede repetir) → contabilizar → pagar.
 */

function error(codigo: string, mensaje: string, detalles: string[] = [], status = 422) {
  return HttpResponse.json({ codigo, mensaje, detalles }, { status })
}

function invalida(issues: { path: PropertyKey[]; message: string }[]) {
  return error(
    'SOLICITUD_INVALIDA',
    'La solicitud no cumple el contrato',
    issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  )
}

/* ------------------------------------------------------------- Parámetros */

/**
 * Reglas de una vigencia nueva de parámetros.
 *
 * Los tramos tienen que encadenarse sin huecos ni solapes, empezando en cero y
 * con el último abierto: un hueco dejaría salarios sin tasa, y un solape los
 * gravaría dos veces.
 */
export function validarParametros(
  datos: SolicitudParametrosPlanilla,
  existentes: readonly { vigenteDesde: string }[],
): string[] {
  const errores: string[] = []
  if (existentes.some((p) => p.vigenteDesde === datos.vigenteDesde)) {
    errores.push(`Ya hay parámetros vigentes desde ${datos.vigenteDesde}: una fecha, una vigencia`)
  }
  if (datos.fuente.trim() === '') {
    errores.push('Indique la norma que respalda los valores: decreto o acuerdo')
  }
  const tramos = datos.tramosRenta
  if (!new Decimal(tramos[0].desde).isZero()) {
    errores.push('El primer tramo de renta empieza en cero')
  }
  tramos.forEach((t, i) => {
    const siguiente = tramos[i + 1]
    if (siguiente && (t.hasta === null || !new Decimal(t.hasta).equals(siguiente.desde))) {
      errores.push(`El tramo ${i + 1} tiene que terminar donde empieza el ${i + 2}`)
    }
    if (!siguiente && t.hasta !== null) {
      errores.push('El último tramo de renta no tiene tope')
    }
  })
  const codigos = datos.cargas.map((c) => c.codigo)
  if (new Set(codigos).size !== codigos.length) {
    errores.push('Hay dos cargas sociales con el mismo código')
  }
  return errores
}

/* -------------------------------------------------------------- Empleados */

function validarEmpleado(datos: SolicitudEmpleado, id?: string): string[] {
  const errores: string[] = []
  if (empleadosMock.some((e) => e.codigo === datos.codigo.trim() && e.id !== id)) {
    errores.push(`Ya hay un empleado con el código ${datos.codigo}`)
  }
  if (!new Decimal(datos.salarioBase).greaterThan(0)) {
    errores.push('El salario base tiene que ser mayor que cero')
  }
  if (!/^CR\d{20}$/.test(datos.cuentaIban.replace(/\s/g, ''))) {
    errores.push('La cuenta IBAN de Costa Rica es CR seguida de 20 dígitos')
  }
  if (datos.fechaSalida && datos.fechaSalida < datos.fechaIngreso) {
    errores.push('La fecha de salida no puede ser anterior a la de ingreso')
  }
  return errores
}

function normalizarEmpleado(datos: SolicitudEmpleado): SolicitudEmpleado {
  return {
    ...datos,
    codigo: datos.codigo.trim(),
    nombre: datos.nombre.trim(),
    identificacion: datos.identificacion.replace(/\D/g, ''),
    cuentaIban: datos.cuentaIban.replace(/\s/g, '').toUpperCase(),
    salarioBase: new Decimal(datos.salarioBase).toFixed(2),
  }
}

/* --------------------------------------------------------------- Planilla */

const idPlanilla = (periodoId: string) => `pla-${periodoId.replace(/^per-/, '')}`

/** La planilla anterior a un periodo, para la variación. */
function planillaAnterior(periodoId: string): Planilla | undefined {
  const periodo = PERIODOS.find((p) => p.id === periodoId)
  if (!periodo) return undefined
  return planillasMock
    .map((pl) => ({ pl, periodo: PERIODOS.find((p) => p.id === pl.periodoId) }))
    .filter((x) => x.periodo && x.periodo.fechaFin < periodo.fechaInicio)
    .sort((a, b) => b.periodo!.fechaFin.localeCompare(a.periodo!.fechaFin))[0]?.pl
}

function etiquetaDe(periodoId: string): string {
  const p = PERIODOS.find((x) => x.id === periodoId)
  return p ? formatPeriodo(p.ejercicio, p.numero) : periodoId
}

export const handlersRh = [
  http.get(rutaApi('/rh/mapeo'), () => HttpResponse.json(MAPEO_RH)),

  http.get(rutaApi('/rh/parametros'), async () => {
    await latencia(80)
    return HttpResponse.json(
      [...parametrosPlanillaMock].sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde)),
    )
  }),

  /** Registra una vigencia nueva. Las anteriores no se tocan: rigen su pasado. */
  http.post(rutaApi('/rh/parametros'), async ({ request }) => {
    await latencia(250)
    const parsed = SolicitudParametrosPlanillaSchema.safeParse(await request.json())
    if (!parsed.success) return invalida(parsed.error.issues)
    const errores = validarParametros(parsed.data, parametrosPlanillaMock)
    if (errores.length > 0) return error('PARAMETROS_INVALIDOS', errores[0], errores)
    const nuevos = { ...parsed.data, id: `par-${parsed.data.vigenteDesde.slice(0, 7)}` }
    parametrosPlanillaMock.push(nuevos)
    persistirParametrosPlanilla()
    return HttpResponse.json(nuevos, { status: 201 })
  }),

  http.get(rutaApi('/rh/empleados'), async () => {
    await latencia(80)
    return HttpResponse.json(
      [...empleadosMock].sort((a, b) => a.codigo.localeCompare(b.codigo)),
    )
  }),

  http.post(rutaApi('/rh/empleados'), async ({ request }) => {
    await latencia(200)
    const parsed = SolicitudEmpleadoSchema.safeParse(await request.json())
    if (!parsed.success) return invalida(parsed.error.issues)
    const datos = normalizarEmpleado(parsed.data)
    const errores = validarEmpleado(datos)
    if (errores.length > 0) return error('EMPLEADO_INVALIDO', errores[0], errores)
    const nuevo: Empleado = { ...datos, id: `emp-rh-${crypto.randomUUID().slice(0, 8)}` }
    empleadosMock.push(nuevo)
    persistirEmpleados()
    return HttpResponse.json(nuevo, { status: 201 })
  }),

  http.put(rutaApi('/rh/empleados/:id'), async ({ params, request }) => {
    await latencia(200)
    const empleado = empleadosMock.find((e) => e.id === String(params.id))
    if (!empleado) return error('EMPLEADO_NO_ENCONTRADO', 'El empleado no existe', [], 404)
    const parsed = SolicitudEmpleadoSchema.safeParse(await request.json())
    if (!parsed.success) return invalida(parsed.error.issues)
    const datos = normalizarEmpleado(parsed.data)
    const errores = validarEmpleado(datos, empleado.id)
    if (errores.length > 0) return error('EMPLEADO_INVALIDO', errores[0], errores)
    Object.assign(empleado, datos)
    persistirEmpleados()
    return HttpResponse.json(empleado)
  }),

  http.get(rutaApi('/rh/planillas'), async () => {
    await latencia(100)
    return HttpResponse.json(
      [...planillasMock].sort((a, b) => b.periodoId.localeCompare(a.periodoId)),
    )
  }),

  http.get(rutaApi('/rh/planillas/:id'), async ({ params }) => {
    await latencia(80)
    const planilla = planillasMock.find((p) => p.id === String(params.id))
    return planilla
      ? HttpResponse.json(planilla)
      : error('PLANILLA_NO_ENCONTRADA', 'La planilla no existe', [], 404)
  }),

  /**
   * Calcula la planilla de un periodo. Se puede repetir mientras no esté
   * contabilizada: el cálculo nuevo reemplaza al anterior, con las
   * incidencias que se manden.
   */
  http.post(rutaApi('/rh/planillas'), async ({ request }) => {
    await latencia(300)
    const parsed = SolicitudCalculoPlanillaSchema.safeParse(await request.json())
    if (!parsed.success) return invalida(parsed.error.issues)
    const solicitud = parsed.data

    const periodo = PERIODOS.find((p) => p.id === solicitud.periodoId)
    if (!periodo) return error('PERIODO_NO_ENCONTRADO', 'El periodo no existe', [], 404)
    const id = idPlanilla(periodo.id)
    const existente = planillasMock.find((p) => p.id === id)
    if (existente && existente.estado !== 'calculada') {
      return error(
        'PLANILLA_YA_CONTABILIZADA',
        `La planilla de ${etiquetaDe(periodo.id)} ya está ${existente.estado}`,
        ['Para cambiarla, hay que reversar su asiento en contabilidad'],
      )
    }

    // Los parámetros del último día del mes: si la ley cambia a medio mes,
    // rige lo que rige al pagarlo.
    const parametros = parametrosVigentes(parametrosPlanillaMock, periodo.fechaFin)
    if (!parametros) {
      return error(
        'SIN_PARAMETROS',
        `No hay parámetros de planilla vigentes al ${periodo.fechaFin}`,
        ['Registre en Parámetros de planilla los que rigen para ese año'],
      )
    }

    const { lineas, totales } = calcularPlanilla(
      empleadosMock,
      solicitud.incidencias,
      periodo,
      parametros,
      solicitud.pymeMenosDe5,
      planillaAnterior(periodo.id),
    )
    if (lineas.length === 0) {
      return error('SIN_EMPLEADOS', `No hay empleados en planilla en ${etiquetaDe(periodo.id)}`)
    }
    const negativos = lineas.filter((l) => new Decimal(l.neto).isNegative())
    if (negativos.length > 0) {
      return error(
        'NETO_NEGATIVO',
        'Las deducciones superan el salario de algún empleado',
        negativos.map((l) => `${l.empleadoNombre}: neto ${l.neto}`),
      )
    }

    const planilla: Planilla = {
      id,
      periodoId: periodo.id,
      fechaPago: solicitud.fechaPago,
      parametrosId: parametros.id,
      pymeMenosDe5: solicitud.pymeMenosDe5,
      incidencias: solicitud.incidencias,
      lineas,
      ...totales,
      estado: 'calculada',
      asientoId: null,
      asientoPagoId: null,
      cuentaBancariaId: null,
      calculadaEn: new Date().toISOString(),
    }
    if (existente) planillasMock.splice(planillasMock.indexOf(existente), 1, planilla)
    else planillasMock.push(planilla)
    persistirPlanillas()
    return HttpResponse.json(planilla, { status: existente ? 200 : 201 })
  }),

  /** Contabiliza la planilla con sus provisiones (docs/08 §4 y §5). */
  http.post(rutaApi('/rh/planillas/:id/contabilizar'), async ({ params }) => {
    await latencia(400)
    const planilla = planillasMock.find((p) => p.id === String(params.id))
    if (!planilla) return error('PLANILLA_NO_ENCONTRADA', 'La planilla no existe', [], 404)
    if (planilla.estado !== 'calculada') {
      return error('PLANILLA_YA_CONTABILIZADA', `La planilla ya está ${planilla.estado}`)
    }
    const emision = emitirAsiento(
      asientoDePlanilla(planilla, MAPEO_RH, etiquetaDe(planilla.periodoId), monedaFuncional()),
    )
    if (!emision.ok) return error(emision.error.codigo, emision.error.mensaje, emision.error.detalles)
    planilla.estado = 'contabilizada'
    planilla.asientoId = emision.asiento.id
    persistirPlanillas()
    return HttpResponse.json(planilla)
  }),

  /**
   * Paga la planilla: el asiento que salda los sueldos por pagar y el retiro
   * en el auxiliar bancario, que después se concilia contra el estado de
   * cuenta como cualquier otro (docs/08 §3, docs/06 §2.1).
   */
  http.post(rutaApi('/rh/planillas/:id/pagar'), async ({ params, request }) => {
    await latencia(400)
    const planilla = planillasMock.find((p) => p.id === String(params.id))
    if (!planilla) return error('PLANILLA_NO_ENCONTRADA', 'La planilla no existe', [], 404)
    if (planilla.estado !== 'contabilizada') {
      return error(
        'PLANILLA_NO_CONTABILIZADA',
        planilla.estado === 'pagada'
          ? 'La planilla ya está pagada'
          : 'Primero hay que contabilizar la planilla',
      )
    }
    const parsed = SolicitudPagoPlanillaSchema.safeParse(await request.json())
    if (!parsed.success) return invalida(parsed.error.issues)

    const banco = cuentasBancariasServidas().find((c) => c.id === parsed.data.cuentaBancariaId)
    if (!banco || !banco.activa) {
      return error('CUENTA_BANCARIA_NO_ENCONTRADA', 'La cuenta bancaria no existe o está inactiva')
    }
    if (banco.moneda !== monedaFuncional()) {
      return error(
        'MONEDA_DISTINTA',
        'La planilla se paga en moneda funcional',
        [`${banco.nombre} es una cuenta en ${banco.moneda}`],
      )
    }

    const etiqueta = etiquetaDe(planilla.periodoId)
    const emision = emitirAsiento(
      asientoDePago(
        planilla,
        MAPEO_RH,
        { cuentaContable: banco.cuentaContable, id: banco.id, nombre: banco.nombre },
        parsed.data.fecha,
        etiqueta,
        monedaFuncional(),
      ),
    )
    if (!emision.ok) return error(emision.error.codigo, emision.error.mensaje, emision.error.detalles)

    registrarMovimientoExterno({
      cuentaBancariaId: banco.id,
      fecha: parsed.data.fecha,
      importe: new Decimal(planilla.totalNeto).negated().toFixed(2),
      concepto: `Pago de planilla de ${etiqueta}`,
      referencia: planilla.id,
      origen: { modulo: 'rh', tipo: 'pago_planilla', id: planilla.id },
      asientoId: emision.asiento.id,
    })

    planilla.estado = 'pagada'
    planilla.asientoPagoId = emision.asiento.id
    planilla.cuentaBancariaId = banco.id
    persistirPlanillas()
    return HttpResponse.json(planilla)
  }),
]
