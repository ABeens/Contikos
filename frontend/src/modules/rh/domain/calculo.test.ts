import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type { Periodo } from '@/shared/api/contracts/conta'
import type { Empleado } from '@/shared/api/contracts/rh'
import { PARAMETROS_2026, MAPEO_RH } from '@/mocks/seed/rh'
import {
  calcularLinea,
  calcularPlanilla,
  diasLaborados,
  impuestoRenta,
  INCIDENCIA_VACIA,
  parametrosVigentes,
} from './calculo'
import { asientoDePago, asientoDePlanilla } from './asiento'

/*
 * Los importes esperados están calculados a mano con las tasas de 2026
 * (docs/13 §6), para que la prueba compruebe el cálculo y no se limite a
 * repetirlo.
 */

const AGOSTO: Periodo = {
  id: 'per-2026-08',
  ejercicio: 2026,
  numero: 8,
  fechaInicio: '2026-08-01',
  fechaFin: '2026-08-31',
  estado: 'abierto',
  cerradoEn: null,
  cerradoPor: null,
  motivoCierre: null,
}

function empleado(extra: Partial<Empleado> = {}): Empleado {
  return {
    id: 'e1',
    codigo: 'E-001',
    nombre: 'Prueba',
    tipoIdentificacion: 'FISICA',
    identificacion: '109870654',
    numeroAsegurado: '109870654',
    puesto: 'Asistente',
    fechaIngreso: '2024-01-01',
    fechaSalida: null,
    salarioBase: '780000.00',
    hijos: 0,
    creditoConyuge: false,
    cuentaIban: 'CR05015202001109870654',
    activo: true,
    ...extra,
  }
}

const linea = (e: Empleado, extra = {}, pyme = false) =>
  calcularLinea(e, { ...INCIDENCIA_VACIA(e.id), ...extra }, AGOSTO, PARAMETROS_2026, pyme, null)

describe('Cargas sociales', () => {
  it('cobra 10,83 % al trabajador y 26,83 % al patrono', () => {
    const l = linea(empleado())
    expect(l.bruto).toBe('780000.00')
    expect(l.cargasTrabajador).toBe('84474.00')
    expect(l.cargasPatrono).toBe('209274.00')
    expect(l.impuestoRenta).toBe('0.00')
    expect(l.neto).toBe('695526.00')
  })

  it('el patrono pequeño no agropecuario no paga el INA', () => {
    const l = linea(empleado(), {}, true)
    expect(l.cargas.some((c) => c.codigo === 'INA')).toBe(false)
    expect(l.cargasPatrono).toBe('197574.00')
  })

  it('eleva SEM e IVM a la base mínima contributiva, y no las demás', () => {
    // Entra el 16 de agosto: cobra 15 días, 210 000, menos que la base mínima.
    const l = linea(empleado({ salarioBase: '420000.00', fechaIngreso: '2026-08-16' }))
    expect(l.bruto).toBe('210000.00')
    const sem = l.cargas.find((c) => c.codigo === 'SEM-T')!
    const ivm = l.cargas.find((c) => c.codigo === 'IVM-T')!
    const bp = l.cargas.find((c) => c.codigo === 'BP-T')!
    expect(sem.base).toBe('333328.00')
    expect(sem.monto).toBe('18333.04')
    expect(ivm.monto).toBe('13509.17')
    expect(bp.base).toBe('210000.00')
  })
})

describe('Impuesto sobre la renta del salario', () => {
  it('aplica cada tasa solo a la parte de su tramo y resta los créditos', () => {
    const l = linea(empleado({ salarioBase: '1850000.00', hijos: 1, creditoConyuge: true }))
    // 429 000 al 10 % y 503 000 al 15 %: 42 900 + 75 450, menos 1 710 y 2 590.
    expect(l.impuestoRenta).toBe('114050.00')
  })

  it('nunca queda negativo', () => {
    const tramos = PARAMETROS_2026.tramosRenta
    expect(impuestoRenta(new Decimal(920000), tramos, new Decimal(10000)).toFixed(2)).toBe('0.00')
  })

  it('el último tramo no tiene tope', () => {
    const tramos = PARAMETROS_2026.tramosRenta
    // 42 900 + 152 550 + 472 600 + 25 % de 273 000.
    expect(impuestoRenta(new Decimal(5000000), tramos, new Decimal(0)).toFixed(2)).toBe(
      '736300.00',
    )
  })
})

describe('Incidencias y días', () => {
  it('paga la hora extra a tiempo y medio sobre 240 horas', () => {
    const l = linea(empleado(), { horasExtra: '10' })
    expect(l.montoHorasExtra).toBe('48750.00')
    expect(l.bruto).toBe('828750.00')
  })

  it('rebaja los días sin goce a razón de un treintavo', () => {
    const l = linea(empleado(), { diasSinGoce: 3 })
    expect(l.rebajoSinGoce).toBe('78000.00')
  })

  it('cuenta meses de treinta días aunque el mes tenga 31', () => {
    expect(diasLaborados(empleado(), AGOSTO)).toBe(30)
    expect(diasLaborados(empleado({ fechaSalida: '2026-08-10' }), AGOSTO)).toBe(10)
  })
})

describe('Parámetros con vigencia', () => {
  it('usa los vigentes a la fecha, no los más nuevos', () => {
    const futuros = { ...PARAMETROS_2026, id: 'par-2027', vigenteDesde: '2027-01-01' }
    const lista = [PARAMETROS_2026, futuros]
    expect(parametrosVigentes(lista, '2026-08-31')?.id).toBe('par-2026-01')
    expect(parametrosVigentes(lista, '2027-03-31')?.id).toBe('par-2027')
    expect(parametrosVigentes(lista, '2025-12-31')).toBeUndefined()
  })
})

describe('Asientos', () => {
  const { lineas, totales } = calcularPlanilla(
    [empleado(), empleado({ id: 'e2', codigo: 'E-002', salarioBase: '1850000.00', hijos: 1 })],
    [{ ...INCIDENCIA_VACIA('e1'), otrasDeducciones: '25000' }],
    AGOSTO,
    PARAMETROS_2026,
    false,
    undefined,
  )
  const planilla = {
    id: 'pla-2026-08',
    periodoId: AGOSTO.id,
    fechaPago: '2026-08-31',
    parametrosId: PARAMETROS_2026.id,
    pymeMenosDe5: false,
    incidencias: [],
    lineas,
    ...totales,
    estado: 'calculada' as const,
    asientoId: null,
    asientoPagoId: null,
    cuentaBancariaId: null,
    calculadaEn: '',
  }

  const sumar = (ls: { cargo: string; abono: string }[], campo: 'cargo' | 'abono') =>
    ls.reduce((acc, l) => acc.plus(l[campo]), new Decimal(0)).toFixed(2)

  it('el de la planilla cuadra y es mayor que los recibos por la parte patronal', () => {
    const asiento = asientoDePlanilla(planilla, MAPEO_RH, 'Agosto 2026', 'CRC')
    expect(sumar(asiento.lineas, 'cargo')).toBe(sumar(asiento.lineas, 'abono'))
    const gasto = asiento.lineas
      .filter((l) => l.cuenta === MAPEO_RH.gastoSalarios || l.cuenta === MAPEO_RH.gastoCargasPatronales)
      .reduce((acc, l) => acc.plus(l.cargo), new Decimal(0))
    expect(gasto.toFixed(2)).toBe(
      new Decimal(totales.totalBruto).plus(totales.totalCargasPatrono).toFixed(2),
    )
    // Una línea de sueldos por pagar por empleado, con su auxiliar.
    const porPagar = asiento.lineas.filter((l) => l.cuenta === MAPEO_RH.salariosPorPagar)
    expect(porPagar.map((l) => l.auxiliarId)).toEqual(['e1', 'e2'])
  })

  it('el del pago deja en cero los sueldos por pagar de cada empleado', () => {
    const asiento = asientoDePlanilla(planilla, MAPEO_RH, 'Agosto 2026', 'CRC')
    const pago = asientoDePago(
      planilla,
      MAPEO_RH,
      { cuentaContable: '1.1.01.010', id: 'cb-bn', nombre: 'BN' },
      '2026-08-31',
      'Agosto 2026',
      'CRC',
    )
    expect(sumar(pago.lineas, 'cargo')).toBe(sumar(pago.lineas, 'abono'))
    for (const id of ['e1', 'e2']) {
      const saldo = [...asiento.lineas, ...pago.lineas]
        .filter((l) => l.cuenta === MAPEO_RH.salariosPorPagar && l.auxiliarId === id)
        .reduce((acc, l) => acc.plus(l.abono).minus(l.cargo), new Decimal(0))
      expect(saldo.isZero()).toBe(true)
    }
  })
})
