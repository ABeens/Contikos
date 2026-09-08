import { describe, expect, it } from 'vitest'
import type { Balanza, RenglonBalanza } from '@/shared/api/contracts/conta'
import {
  compararBalanzas,
  variacionAbsoluta,
  variacionPorcentual,
} from './balanza'

/**
 * Variación entre dos periodos (docs/09 §3.2).
 *
 * Lo que se prueba aquí es la aritmética, que es la parte que no se ve: los
 * saldos vienen de la balanza, que ya tiene sus propias pruebas de punta a
 * punta.
 */

const periodo = (numero: number) => ({
  id: `per-2026-${String(numero).padStart(2, '0')}`,
  ejercicio: 2026,
  numero,
  fechaInicio: `2026-${String(numero).padStart(2, '0')}-01`,
  fechaFin: `2026-${String(numero).padStart(2, '0')}-28`,
  estado: 'abierto' as const,
  cerradoEn: null,
  cerradoPor: null,
  motivoCierre: null,
})

function renglon(
  codigo: string,
  saldoFinal: string,
  extra: Partial<RenglonBalanza> = {},
): RenglonBalanza {
  return {
    cuentaId: `cta-${codigo}`,
    codigo,
    nombre: `Cuenta ${codigo}`,
    nivel: 4,
    esDetalle: true,
    naturaleza: 'deudora',
    saldoInicial: '0.00',
    cargos: '0.00',
    abonos: '0.00',
    saldoFinal,
    ...extra,
  }
}

function balanza(numero: number, renglones: RenglonBalanza[]): Balanza {
  return {
    periodo: periodo(numero),
    libro: 'fiscal',
    moneda: 'CRC',
    renglones,
    totalCargos: '0.00',
    totalAbonos: '0.00',
    cuadra: true,
  }
}

describe('Variación entre periodos', () => {
  it('resta con precisión decimal, no en coma flotante', () => {
    expect(variacionAbsoluta('0.10', '0.30')).toBe('0.20')
    expect(variacionAbsoluta('1000000.05', '999999.95')).toBe('-0.10')
  })

  it('el porcentaje es null cuando el saldo base es cero', () => {
    expect(variacionPorcentual('0.00', '5000.00')).toBeNull()
    // Y también cuando los dos son cero: sin base no hay porcentaje, aunque
    // la variación sea nula y la tentación de escribir 0% sea grande.
    expect(variacionPorcentual('0.00', '0.00')).toBeNull()
  })

  it('el porcentaje va sobre el valor absoluto de la base', () => {
    expect(variacionPorcentual('200.00', '300.00')).toBe('50.00')
    // Con saldo base negativo (una cuenta contra su naturaleza), el signo del
    // porcentaje sigue al de la variación: bajó 50, así que es -50%. Dividir
    // entre el saldo con signo daría +50% junto a una variación negativa.
    expect(variacionPorcentual('-100.00', '-150.00')).toBe('-50.00')
    expect(variacionPorcentual('300.00', '100.00')).toBe('-66.67')
  })
})

describe('Balanza comparativa', () => {
  it('cruza las dos balanzas y conserva las cuentas de un solo periodo', () => {
    const comparativa = compararBalanzas(
      balanza(7, [renglon('1.1.01.001', '100000.00'), renglon('6.1.02.004', '5000.00')]),
      balanza(8, [renglon('1.1.01.001', '150000.00'), renglon('4.1.01.001', '80000.00')]),
    )

    expect(comparativa.periodoA.numero).toBe(7)
    expect(comparativa.periodoB.numero).toBe(8)
    expect(comparativa.libro).toBe('fiscal')
    expect(comparativa.renglones.map((r) => r.codigo)).toEqual([
      '1.1.01.001',
      '4.1.01.001',
      '6.1.02.004',
    ])

    const caja = comparativa.renglones[0]
    expect(caja.variacion).toBe('50000.00')
    expect(caja.variacionPorcentual).toBe('50.00')

    // Nació en B: su saldo entero es la variación y no hay base contra la que
    // medirla.
    const ingreso = comparativa.renglones[1]
    expect(ingreso.saldoA).toBe('0.00')
    expect(ingreso.variacion).toBe('80000.00')
    expect(ingreso.variacionPorcentual).toBeNull()

    // Dejó de moverse en B: se pierde entera, y eso es -100%.
    const papeleria = comparativa.renglones[2]
    expect(papeleria.saldoB).toBe('0.00')
    expect(papeleria.variacion).toBe('-5000.00')
    expect(papeleria.variacionPorcentual).toBe('-100.00')
  })

  it('la variación de una cuenta acreedora se lee en su naturaleza', () => {
    const acreedora = { naturaleza: 'acreedora' as const }
    const comparativa = compararBalanzas(
      balanza(7, [renglon('2.1.01.001', '400000.00', acreedora)]),
      balanza(8, [renglon('2.1.01.001', '500000.00', acreedora)]),
    )
    // Deber 100.000 más es +100.000, igual que tener 100.000 más de caja: los
    // saldos ya llegan con el signo de la naturaleza desde la balanza.
    expect(comparativa.renglones[0].variacion).toBe('100000.00')
    expect(comparativa.renglones[0].variacionPorcentual).toBe('25.00')
  })
})
