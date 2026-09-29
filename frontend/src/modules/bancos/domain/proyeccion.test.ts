import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { flujosDeCartera, flujosDePlanilla, proyectar } from './proyeccion'

const CORTE = '2026-09-28'

describe('Proyección semanal', () => {
  it('acumula el saldo semana a semana y ubica el punto más bajo', () => {
    const p = proyectar({
      corte: CORTE,
      semanas: 3,
      saldoInicial: new Decimal(1000),
      flujos: [
        { fecha: '2026-09-30', importe: new Decimal(-800), concepto: 'a', origen: 'cxp', estimado: false },
        { fecha: '2026-10-06', importe: new Decimal(-400), concepto: 'b', origen: 'planilla', estimado: true },
        { fecha: '2026-10-12', importe: new Decimal(900), concepto: 'c', origen: 'cxc', estimado: false },
      ],
    })
    expect(p.semanas.map((s) => s.saldoFinal)).toEqual(['200.00', '-200.00', '700.00'])
    expect(p.semanaMinima).toBe(1)
    expect(p.saldoMinimo).toBe('-200.00')
  })

  it('lo vencido por pagar cae en la primera semana', () => {
    const p = proyectar({
      corte: CORTE,
      semanas: 2,
      saldoInicial: new Decimal(100),
      flujos: [
        { fecha: '2026-09-01', importe: new Decimal(-50), concepto: 'x', origen: 'cxp', estimado: false },
      ],
    })
    expect(p.semanas[0].salidas).toBe('50.00')
  })
})

describe('Cartera', () => {
  const porCobrar = [
    { numero: 'FV-1', tercero: 'A', fechaVencimiento: '2026-09-01', saldo: '300.00', moneda: 'CRC' },
    { numero: 'FV-2', tercero: 'B', fechaVencimiento: '2026-10-05', saldo: '500.00', moneda: 'CRC' },
    { numero: 'FV-3', tercero: 'C', fechaVencimiento: '2026-10-05', saldo: '70.00', moneda: 'USD' },
  ]

  it('deja fuera lo vencido por cobrar, pero dice cuánto es', () => {
    const r = flujosDeCartera({ porCobrar, porPagar: [], moneda: 'CRC', corte: CORTE, incluirVencidoPorCobrar: false })
    expect(r.flujos.map((f) => f.concepto)).toEqual(['Cobro de FV-2 · B'])
    expect(r.vencidoPorCobrar.toFixed(2)).toBe('300.00')
  })

  it('no mezcla monedas', () => {
    const r = flujosDeCartera({ porCobrar, porPagar: [], moneda: 'USD', corte: CORTE, incluirVencidoPorCobrar: true })
    expect(r.flujos).toHaveLength(1)
  })
})

describe('Planilla', () => {
  it('estima los meses sin planilla con la última y pone las cargas el 15', () => {
    const flujos = flujosDePlanilla({
      planillas: [{ finDeMes: '2026-08-31', neto: '1000.00', cargas: '400.00', renta: '50.00', pagada: true }],
      corte: CORTE,
      hasta: '2026-11-20',
    })
    expect(flujos.map((f) => [f.fecha, f.origen, f.importe.toFixed(2), f.estimado])).toEqual([
      // Agosto ya se pagó; sus cargas vencen el 15 de setiembre, antes del corte.
      ['2026-09-30', 'planilla', '-1000.00', true],
      ['2026-10-15', 'cargas', '-400.00', true],
      ['2026-10-15', 'renta', '-50.00', true],
      ['2026-10-31', 'planilla', '-1000.00', true],
      ['2026-11-15', 'cargas', '-400.00', true],
      ['2026-11-15', 'renta', '-50.00', true],
    ])
  })
})
