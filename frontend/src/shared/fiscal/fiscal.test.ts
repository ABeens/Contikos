import { describe, expect, it } from 'vitest'
import {
  detectarTipo,
  formatIdentificacion,
  normalizarIdentificacion,
  validarIdentificacion,
} from './identificacion'
import { calcularDesglose, calcularImpuestoLinea } from './iva'

describe('Identificación tributaria CR', () => {
  it('valida cédula física de 9 dígitos', () => {
    expect(validarIdentificacion('112340567', 'FISICA').valido).toBe(true)
    expect(validarIdentificacion('1-1234-0567', 'FISICA').valido).toBe(true)
  })

  it('rechaza cédula física con longitud incorrecta', () => {
    const r = validarIdentificacion('11234056', 'FISICA')
    expect(r.valido).toBe(false)
    expect(r.error).toContain('9 dígitos')
  })

  it('rechaza cédula física que empieza con cero', () => {
    expect(validarIdentificacion('012340567', 'FISICA').valido).toBe(false)
  })

  it('valida cédula jurídica de 10 dígitos que empieza con 2-5', () => {
    expect(validarIdentificacion('3101123456', 'JURIDICA').valido).toBe(true)
    expect(validarIdentificacion('6101123456', 'JURIDICA').valido).toBe(false)
  })

  it('acepta DIMEX de 11 y 12 dígitos', () => {
    expect(validarIdentificacion('12345678901', 'DIMEX').valido).toBe(true)
    expect(validarIdentificacion('123456789012', 'DIMEX').valido).toBe(true)
    expect(validarIdentificacion('1234567890', 'DIMEX').valido).toBe(false)
  })

  it('deduce el tipo por longitud y primer dígito', () => {
    expect(detectarTipo('112340567')).toBe('FISICA')
    expect(detectarTipo('3101123456')).toBe('JURIDICA')
    expect(detectarTipo('9101123456')).toBe('NITE')
    expect(detectarTipo('12345678901')).toBe('DIMEX')
    expect(detectarTipo('123')).toBeNull()
  })

  it('normaliza quitando separadores', () => {
    expect(normalizarIdentificacion('3-101-123456')).toBe('3101123456')
  })

  it('formatea para pantalla', () => {
    expect(formatIdentificacion('112340567', 'FISICA')).toBe('1-1234-0567')
    expect(formatIdentificacion('3101123456', 'JURIDICA')).toBe('3-101-123456')
    expect(formatIdentificacion('12345678901', 'DIMEX')).toBe('12345678901')
  })
})

describe('IVA Costa Rica', () => {
  it('aplica la tarifa general del 13%', () => {
    const r = calcularImpuestoLinea(
      { cantidad: '1', precioUnitario: '100000', tarifa: 'GENERAL' },
      'CRC',
    )
    expect(r.base.toApi()).toBe('100000.00')
    expect(r.impuesto.toApi()).toBe('13000.00')
    expect(r.total.toApi()).toBe('113000.00')
  })

  it('aplica tarifas reducidas', () => {
    const cuatro = calcularImpuestoLinea(
      { cantidad: '1', precioUnitario: '50000', tarifa: 'REDUCIDA_4' },
      'CRC',
    )
    expect(cuatro.impuesto.toApi()).toBe('2000.00')

    const uno = calcularImpuestoLinea(
      { cantidad: '2', precioUnitario: '1500', tarifa: 'REDUCIDA_1' },
      'CRC',
    )
    expect(uno.base.toApi()).toBe('3000.00')
    expect(uno.impuesto.toApi()).toBe('30.00')
  })

  it('descuenta antes de calcular el impuesto', () => {
    const r = calcularImpuestoLinea(
      {
        cantidad: '10',
        precioUnitario: '1000',
        descuento: '1000',
        tarifa: 'GENERAL',
      },
      'CRC',
    )
    expect(r.base.toApi()).toBe('9000.00')
    expect(r.impuesto.toApi()).toBe('1170.00')
  })

  it('no genera impuesto en exento ni en no sujeto', () => {
    for (const tarifa of ['EXENTO', 'NO_SUJETO'] as const) {
      const r = calcularImpuestoLinea(
        { cantidad: '1', precioUnitario: '100000', tarifa },
        'CRC',
      )
      expect(r.impuesto.esCero()).toBe(true)
      expect(r.total.toApi()).toBe('100000.00')
    }
  })

  it('desglosa por tarifa cuando la factura mezcla varias', () => {
    const desglose = calcularDesglose(
      [
        { cantidad: '1', precioUnitario: '100000', tarifa: 'GENERAL' },
        { cantidad: '1', precioUnitario: '50000', tarifa: 'REDUCIDA_4' },
        { cantidad: '1', precioUnitario: '20000', tarifa: 'EXENTO' },
      ],
      'CRC',
    )

    expect(desglose.subtotal.toApi()).toBe('170000.00')
    expect(desglose.totalImpuesto.toApi()).toBe('15000.00')
    expect(desglose.total.toApi()).toBe('185000.00')
    expect(desglose.porTarifa).toHaveLength(3)

    const general = desglose.porTarifa.find(
      (p) => p.tarifa.codigo === 'GENERAL',
    )!
    expect(general.impuesto.toApi()).toBe('13000.00')
  })

  it('calcula con la tarifa resuelta que se le pasa, no con la constante', () => {
    // Una tabla donde la general subió al 15%: la línea sigue citando el
    // mismo código y el importe sale de lo que rige a la fecha del documento.
    const resolver = (codigo: string) =>
      codigo === 'GENERAL'
        ? { codigo, nombre: 'General 15%', porcentaje: '15', generaImpuesto: true }
        : undefined
    const r = calcularImpuestoLinea(
      { cantidad: '1', precioUnitario: '100000', tarifa: 'GENERAL' },
      'CRC',
      resolver,
    )
    expect(r.impuesto.toApi()).toBe('15000.00')
    expect(r.tarifa.nombre).toBe('General 15%')
  })

  it('cae a la tabla por defecto cuando el resolutor no conoce el código', () => {
    const r = calcularImpuestoLinea(
      { cantidad: '1', precioUnitario: '100000', tarifa: 'REDUCIDA_4' },
      'CRC',
      () => undefined,
    )
    expect(r.impuesto.toApi()).toBe('4000.00')
  })

  it('una tarifa que nadie conoce calcula a cero y se marca como desconocida', () => {
    const r = calcularImpuestoLinea(
      { cantidad: '1', precioUnitario: '100000', tarifa: 'INVENTADA' },
      'CRC',
    )
    expect(r.impuesto.esCero()).toBe(true)
    expect(r.tarifa.nombre).toBe('INVENTADA')
  })

  it('el desglose cuadra: subtotal + impuesto = total', () => {
    const desglose = calcularDesglose(
      [
        { cantidad: '3', precioUnitario: '3333.33', tarifa: 'GENERAL' },
        { cantidad: '7', precioUnitario: '777.77', tarifa: 'REDUCIDA_2' },
      ],
      'CRC',
    )
    expect(desglose.subtotal.plus(desglose.totalImpuesto).toApi()).toBe(
      desglose.total.toApi(),
    )
  })
})
