import { afterEach, describe, expect, it } from 'vitest'
import {
  crc,
  ErrorMoneda,
  esMonedaRegistrada,
  eur,
  monedaFuncional,
  monedasActivas,
  monedasRegistradas,
  MONEDAS_POR_DEFECTO,
  Money,
  registrarMonedas,
  restablecerMonedas,
  sum,
  usd,
} from './money'
import { formatMoney, formatNumero, parseMonto } from './format'

describe('Money: precisión', () => {
  it('no sufre el error clásico del punto flotante', () => {
    // 0.1 + 0.2 === 0.30000000000000004 en float
    expect(crc('0.1').plus(crc('0.2')).toApi()).toBe('0.30')
  })

  it('mantiene precisión al sumar muchos importes pequeños', () => {
    const centavos = Array.from({ length: 1000 }, () => crc('0.01'))
    expect(sum(centavos, 'CRC').toApi()).toBe('10.00')
  })

  it('no pierde precisión en montos grandes propios de colones', () => {
    // Un importe en colones supera con facilidad el rango seguro de float
    const a = crc('99999999999999.99')
    expect(a.plus(crc('0.01')).toApi()).toBe('100000000000000.00')
  })

  it('redondea a la mitad hacia arriba, como la convención contable', () => {
    expect(crc('0.005').redondear().toApi()).toBe('0.01')
    expect(crc('2.675').redondear().toApi()).toBe('2.68')
  })

  it('no redondea en cálculos intermedios', () => {
    const tercio = crc('100').dividedBy(3)
    expect(tercio.times(3).redondear().toApi()).toBe('100.00')
  })
})

describe('Money: moneda', () => {
  it('impide operar monedas distintas', () => {
    expect(() => crc('100').plus(usd('100'))).toThrow(ErrorMoneda)
  })

  it('convierte aplicando tipo de cambio', () => {
    const enDolares = usd('100')
    expect(enDolares.convertir('CRC', '505.25').toApi()).toBe('50525.00')
  })

  it('rechaza tipo de cambio no positivo', () => {
    expect(() => usd('100').convertir('CRC', '0')).toThrow(ErrorMoneda)
  })

  it('igualA distingue moneda', () => {
    expect(crc('100').igualA(crc('100'))).toBe(true)
    expect(crc('100').igualA(usd('100'))).toBe(false)
  })
})

describe('Money: API', () => {
  it('serializa siempre como string con decimales fijos', () => {
    expect(crc('1234.5').toApi()).toBe('1234.50')
    expect(JSON.stringify({ total: crc('1234.5') })).toBe('{"total":"1234.50"}')
  })

  it('reconstruye exactamente lo que envió la API', () => {
    const original = crc('987654321.99')
    expect(Money.desdeApi(original.toApi(), 'CRC').igualA(original)).toBe(true)
  })
})

describe('formatMoney: convención costarricense', () => {
  it('formatea colones con punto de miles y coma decimal', () => {
    expect(formatMoney(crc('1234567.89'))).toBe('₡1.234.567,89')
  })

  it('formatea dólares con la convención anglosajona', () => {
    expect(formatMoney(usd('1234567.89'))).toBe('$1,234,567.89')
  })

  it('maneja negativos con signo o con paréntesis', () => {
    expect(formatMoney(crc('-1500'))).toBe('-₡1.500,00')
    expect(formatMoney(crc('-1500'), { parentesisNegativos: true })).toBe(
      '(₡1.500,00)',
    )
  })

  it('omite el símbolo cuando se pide', () => {
    expect(formatMoney(crc('1500'), { simbolo: false })).toBe('1.500,00')
  })

  it('oculta el cero en columnas de cargo y abono', () => {
    expect(formatMoney(crc('0'), { ocultarCero: true })).toBe('')
    expect(formatMoney(crc('0'))).toBe('₡0,00')
  })

  it('no muestra "-₡0,00" cuando el negativo se redondea a cero', () => {
    expect(formatMoney(crc('-0.001'))).toBe('₡0,00')
  })

  it('formatea el euro con el símbolo detrás del importe', () => {
    expect(formatMoney(eur('1234567.89'))).toBe('1.234.567,89 €')
    expect(formatMoney(eur('-1500'), { parentesisNegativos: true })).toBe(
      '(1.500,00 €)',
    )
  })

  it('formatea números sin moneda', () => {
    expect(formatNumero('505.2534', 4)).toBe('505,2534')
  })
})

describe('Catálogo configurable de monedas', () => {
  afterEach(restablecerMonedas)

  it('trae el euro de fábrica junto al colón y el dólar', () => {
    expect(monedasRegistradas().map((m) => m.codigo)).toEqual([
      'CRC',
      'USD',
      'EUR',
    ])
    expect(monedaFuncional()).toBe('CRC')
  })

  it('adopta el catálogo que configura la empresa', () => {
    registrarMonedas([
      {
        codigo: 'GBP',
        nombre: 'Libra esterlina',
        simbolo: '£',
        decimales: 4,
        grupo: ' ',
        decimal: '.',
        posicionSimbolo: 'antes',
        activa: true,
        funcional: true,
        tipoCambio: '1',
      },
    ])

    expect(monedaFuncional()).toBe('GBP')
    // Decimales, agrupador y separador salen del catálogo, no del código
    expect(formatMoney(new Money('1234567.891', 'GBP'))).toBe(
      '£1 234 567.8910',
    )
    // Y el redondeo del contrato los respeta
    expect(new Money('1.00005', 'GBP').toApi()).toBe('1.0001')
  })

  it('conserva el catálogo anterior si la respuesta viene vacía', () => {
    registrarMonedas([])
    expect(monedasRegistradas()).toHaveLength(3)
  })

  it('sigue formateando una moneda que ya no está en el catálogo', () => {
    // Un asiento histórico en una moneda retirada debe poder verse.
    registrarMonedas(MONEDAS_POR_DEFECTO.filter((m) => m.codigo !== 'EUR'))
    expect(esMonedaRegistrada('EUR')).toBe(false)
    expect(formatMoney(eur('1500'))).toBe('1,500.00 EUR')
  })

  it('solo ofrece las monedas activas para capturar', () => {
    registrarMonedas(
      MONEDAS_POR_DEFECTO.map((m) =>
        m.codigo === 'EUR' ? { ...m, activa: false } : m,
      ),
    )
    expect(monedasActivas().map((m) => m.codigo)).toEqual(['CRC', 'USD'])
  })
})

describe('parseMonto: captura del usuario', () => {
  it('acepta punto o coma como separador decimal', () => {
    expect(parseMonto('1234.56')?.toFixed(2)).toBe('1234.56')
    expect(parseMonto('1234,56')?.toFixed(2)).toBe('1234.56')
  })

  it('resuelve la ambigüedad tomando el último separador como decimal', () => {
    expect(parseMonto('1.234,56')?.toFixed(2)).toBe('1234.56')
    expect(parseMonto('1,234.56')?.toFixed(2)).toBe('1234.56')
    expect(parseMonto('1.234.567,89')?.toFixed(2)).toBe('1234567.89')
  })

  it('trata tres dígitos tras un único separador como miles', () => {
    expect(parseMonto('1.234')?.toFixed(2)).toBe('1234.00')
    expect(parseMonto('1,234')?.toFixed(2)).toBe('1234.00')
  })

  it('ignora el símbolo de moneda y los espacios', () => {
    expect(parseMonto('₡ 1.500,00')?.toFixed(2)).toBe('1500.00')
    expect(parseMonto('$1,500.00')?.toFixed(2)).toBe('1500.00')
    expect(parseMonto('1.500,00 €')?.toFixed(2)).toBe('1500.00')
  })

  it('ignora también el código ISO al pegar desde otro sistema', () => {
    expect(parseMonto('1.500,00 EUR')?.toFixed(2)).toBe('1500.00')
    // Pero unas letras cualesquiera siguen siendo un importe inválido
    expect(parseMonto('1.500,00 XYZ')).toBeNull()
  })

  it('interpreta paréntesis como negativo', () => {
    expect(parseMonto('(1.500,00)')?.toFixed(2)).toBe('-1500.00')
  })

  it('devuelve null ante texto inválido', () => {
    expect(parseMonto('')).toBeNull()
    expect(parseMonto('abc')).toBeNull()
    expect(parseMonto('-')).toBeNull()
    expect(parseMonto('.')).toBeNull()
  })

  it('hace ida y vuelta con formatMoney', () => {
    const original = crc('1234567.89')
    const texto = formatMoney(original)
    expect(parseMonto(texto)?.toFixed(2)).toBe(original.toApi())
  })
})
