import { describe, expect, it } from 'vitest'
import type { TarifaImpuesto } from '@/shared/api/contracts/impuestos'
import { calcularImpuestoLinea } from './iva'
import {
  nombreTarifa,
  resolutorDe,
  tarifaVigente,
  tarifasVigentesEn,
  vigenteEn,
} from './impuestos'

/**
 * La tabla de impuestos resuelve por la fecha del documento (docs/13). Lo que
 * se prueba aquí es esa resolución: que la factura de antes del cambio siga
 * calculándose con la tasa de antes.
 */

const GENERAL_2019: TarifaImpuesto = {
  id: 'imp-general-2019',
  codigo: 'GENERAL',
  nombre: 'General 13%',
  tipo: 'iva',
  porcentaje: '13',
  vigenteDesde: '2019-07-01',
  vigenteHasta: '2027-06-30',
  activa: true,
  codigoHacienda: '08',
  generaImpuesto: true,
}

const GENERAL_2027: TarifaImpuesto = {
  ...GENERAL_2019,
  id: 'imp-general-2027',
  nombre: 'General 15%',
  porcentaje: '15',
  vigenteDesde: '2027-07-01',
  vigenteHasta: null,
}

const EXENTO: TarifaImpuesto = {
  id: 'imp-exento',
  codigo: 'EXENTO',
  nombre: 'Exento',
  tipo: 'iva',
  porcentaje: '0',
  vigenteDesde: '2019-07-01',
  vigenteHasta: null,
  activa: true,
  codigoHacienda: '10',
  generaImpuesto: false,
}

const TABLA = [GENERAL_2019, GENERAL_2027, EXENTO]

describe('Vigencia de tarifas', () => {
  it('los extremos de la vigencia son inclusivos', () => {
    expect(vigenteEn(GENERAL_2019, '2019-07-01')).toBe(true)
    expect(vigenteEn(GENERAL_2019, '2027-06-30')).toBe(true)
    expect(vigenteEn(GENERAL_2019, '2019-06-30')).toBe(false)
    expect(vigenteEn(GENERAL_2019, '2027-07-01')).toBe(false)
  })

  it('sin fecha de fin sigue vigente', () => {
    expect(vigenteEn(GENERAL_2027, '2099-12-31')).toBe(true)
  })

  it('a una fecha rige una sola fila por código', () => {
    expect(tarifaVigente(TABLA, 'GENERAL', '2026-08-20')?.porcentaje).toBe('13')
    expect(tarifaVigente(TABLA, 'GENERAL', '2027-08-20')?.porcentaje).toBe('15')
    expect(tarifaVigente(TABLA, 'GENERAL', '2019-01-01')).toBeUndefined()
  })

  it('lista lo que rige a la fecha', () => {
    expect(tarifasVigentesEn(TABLA, '2026-08-20').map((t) => t.id)).toEqual([
      'imp-general-2019',
      'imp-exento',
    ])
  })
})

describe('Cálculo por la fecha del documento', () => {
  it('la misma línea da distinto impuesto según cuándo se emitió', () => {
    const linea = { cantidad: '1', precioUnitario: '100000', tarifa: 'GENERAL' }

    const antes = calcularImpuestoLinea(linea, 'CRC', resolutorDe(TABLA, '2026-08-20'))
    const despues = calcularImpuestoLinea(linea, 'CRC', resolutorDe(TABLA, '2027-08-20'))

    expect(antes.impuesto.toApi()).toBe('13000.00')
    expect(despues.impuesto.toApi()).toBe('15000.00')
  })

  it('el resolutor no conoce el código fuera de su vigencia', () => {
    expect(resolutorDe(TABLA, '2018-01-01')('GENERAL')).toBeUndefined()
  })
})

describe('Nombre para pantalla', () => {
  it('prefiere la fila vigente a la fecha', () => {
    expect(nombreTarifa(TABLA, 'GENERAL', '2027-08-20')).toBe('General 15%')
  })

  it('sin fecha, toma la primera fila del código', () => {
    expect(nombreTarifa(TABLA, 'GENERAL')).toBe('General 13%')
  })

  it('cae a la tabla por defecto y, al final, al código', () => {
    expect(nombreTarifa([], 'REDUCIDA_4')).toBe('Reducida 4%')
    expect(nombreTarifa([], 'INVENTADA')).toBe('INVENTADA')
  })
})
