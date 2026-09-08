import { describe, expect, it } from 'vitest'
import {
  descomponerConsecutivo,
  formatConsecutivo,
  formatearConsecutivoHacienda,
  formatearNumeroInterno,
  TIPO_DOCUMENTO_HACIENDA,
} from './comprobante'
import { nombreUbicacion, ubicacionValida } from './ubicaciones'

describe('Consecutivo de Hacienda (docs/13 §4.2)', () => {
  it('arma 20 dígitos: casa matriz, terminal, tipo y correlativo', () => {
    const c = formatearConsecutivoHacienda('001', '00001', TIPO_DOCUMENTO_HACIENDA.FE, 113)
    expect(c).toBe('00100001010000000113')
    expect(c).toHaveLength(20)
  })

  it('completa con ceros lo que llega corto', () => {
    expect(formatearConsecutivoHacienda('1', '1', '1', 5)).toBe(
      '00100001010000000005',
    )
  })

  it('rechaza lo que no cabe o no es positivo', () => {
    expect(() => formatearConsecutivoHacienda('0001', '00001', '01', 1)).toThrow()
    expect(() => formatearConsecutivoHacienda('001', '00001', '01', 0)).toThrow()
    expect(() =>
      formatearConsecutivoHacienda('001', '00001', '01', 10_000_000_000),
    ).toThrow()
  })

  it('se descompone en sus partes y se presenta con separadores', () => {
    expect(descomponerConsecutivo('00100001010000000113')).toEqual({
      sucursal: '001',
      terminal: '00001',
      tipoDoc: '01',
      numero: 113,
    })
    expect(formatConsecutivo('00100001010000000113')).toBe(
      '001-00001-01-0000000113',
    )
    // Lo que no tiene la forma se deja tal cual: hay documentos viejos.
    expect(descomponerConsecutivo('FE-00000113')).toBeNull()
    expect(formatConsecutivo('FE-00000113')).toBe('FE-00000113')
  })

  it('el número interno es correlativo con prefijo', () => {
    expect(formatearNumeroInterno('FV', 123)).toBe('FV-000123')
  })
})

describe('Catálogo de ubicaciones', () => {
  it('valida la terna contra el catálogo cargado', () => {
    expect(ubicacionValida('1', '02', '01')).toBe(true)
    expect(ubicacionValida('1', '02', '99')).toBe(false)
    expect(ubicacionValida('9', '01', '01')).toBe(false)
  })

  it('una provincia sin cantones de muestra acepta cualquier código bien formado', () => {
    expect(ubicacionValida('5', '03', '02')).toBe(true)
    expect(ubicacionValida('5', '3', '02')).toBe(false)
  })

  it('nombra la ubicación para pantalla', () => {
    expect(nombreUbicacion('1', '02', '01')).toBe('Escazú, Escazú, San José')
    expect(nombreUbicacion('5', '03', '02')).toBe('Guanacaste')
  })
})
