import { describe, expect, it } from 'vitest'
import { formatTasa, parseTasa } from './tasa'

describe('parseTasa', () => {
  it('acepta coma o punto como separador decimal, siempre decimal', () => {
    expect(parseTasa('512,125')).toBe('512.125')
    expect(parseTasa('512.125')).toBe('512.125')
    expect(parseTasa(' 506.10 ')).toBe('506.1')
  })

  it('conserva los decimales que la funcional no tiene', () => {
    // Colón contra dólar con el dólar como funcional.
    expect(parseTasa('0,0019')).toBe('0.0019')
  })

  it('rechaza lo que no es una tasa positiva', () => {
    expect(parseTasa('')).toBeNull()
    expect(parseTasa('0')).toBeNull()
    expect(parseTasa('-5')).toBeNull()
    expect(parseTasa('1.234,56')).toBeNull()
    expect(parseTasa('abc')).toBeNull()
    expect(parseTasa('1.1234567')).toBeNull()
  })
})

describe('formatTasa', () => {
  it('usa los separadores de la funcional sin recortar decimales', () => {
    expect(formatTasa('1512.125', { decimal: ',', grupo: '.' })).toBe(
      '1.512,125',
    )
    expect(formatTasa('0.0019', { decimal: '.', grupo: ',' })).toBe('0.0019')
    expect(formatTasa('506', { decimal: ',', grupo: '.' })).toBe('506,00')
  })
})
