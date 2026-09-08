import { describe, expect, it } from 'vitest'
import type {
  MonedaConfig,
  SolicitudMoneda,
} from '@/shared/api/contracts/config'
import {
  aplicarFuncional,
  aSolicitud,
  validarEliminacion,
  validarFuncional,
  validarMoneda,
} from './moneda'

const CATALOGO: MonedaConfig[] = [
  {
    codigo: 'CRC',
    nombre: 'Colón costarricense',
    simbolo: '₡',
    decimales: 2,
    grupo: '.',
    decimal: ',',
    posicionSimbolo: 'antes',
    activa: true,
    funcional: true,
    tipoCambio: '1',
    enUso: true,
  },
  {
    codigo: 'USD',
    nombre: 'Dólar estadounidense',
    simbolo: '$',
    decimales: 2,
    grupo: ',',
    decimal: '.',
    posicionSimbolo: 'antes',
    activa: true,
    funcional: false,
    tipoCambio: '505.25',
    enUso: false,
  },
]

const CRC = CATALOGO[0]
const USD = CATALOGO[1]

const EURO: SolicitudMoneda = {
  codigo: 'EUR',
  nombre: 'Euro',
  simbolo: '€',
  decimales: 2,
  grupo: '.',
  decimal: ',',
  posicionSimbolo: 'despues',
  activa: true,
  tipoCambio: '592.40',
}

const codigos = (r: { errores: readonly { codigo: string }[] }) =>
  r.errores.map((e) => e.codigo)

describe('Alta de moneda', () => {
  it('acepta el euro sobre un catálogo que no lo tiene', () => {
    const r = validarMoneda(EURO, { monedas: CATALOGO }, true)
    expect(r.valido).toBe(true)
  })

  it('exige un código ISO 4217 de tres letras', () => {
    const r = validarMoneda({ ...EURO, codigo: 'EU' }, { monedas: CATALOGO }, true)
    expect(codigos(r)).toContain('CODIGO_INVALIDO')
  })

  it('rechaza un código que ya está en el catálogo', () => {
    const r = validarMoneda({ ...EURO, codigo: 'USD' }, { monedas: CATALOGO }, true)
    expect(codigos(r)).toContain('CODIGO_DUPLICADO')
  })

  it('exige nombre y símbolo', () => {
    const r = validarMoneda(
      { ...EURO, nombre: '  ', simbolo: '' },
      { monedas: CATALOGO },
      true,
    )
    expect(codigos(r)).toEqual(
      expect.arrayContaining(['NOMBRE_REQUERIDO', 'SIMBOLO_REQUERIDO']),
    )
  })

  it('rechaza el mismo carácter como separador de miles y decimal', () => {
    // Con ambos en punto, 1.234.567 y 1.234,567 serían el mismo texto.
    const r = validarMoneda(
      { ...EURO, grupo: '.', decimal: '.' },
      { monedas: CATALOGO },
      true,
    )
    expect(codigos(r)).toContain('SEPARADORES_IGUALES')
  })

  it('admite no agrupar los miles', () => {
    const r = validarMoneda({ ...EURO, grupo: '' }, { monedas: CATALOGO }, true)
    expect(r.valido).toBe(true)
  })

  it('exige un tipo de cambio mayor que cero', () => {
    for (const tipoCambio of ['0', '-3']) {
      const r = validarMoneda({ ...EURO, tipoCambio }, { monedas: CATALOGO }, true)
      expect(codigos(r)).toContain('TIPO_CAMBIO_INVALIDO')
    }
  })

  it('admite monedas sin decimales', () => {
    const r = validarMoneda({ ...EURO, decimales: 0 }, { monedas: CATALOGO }, true)
    expect(r.valido).toBe(true)
  })
})

describe('Edición de moneda', () => {
  it('rechaza editar una que no está en el catálogo', () => {
    const r = validarMoneda(EURO, { monedas: CATALOGO }, false)
    expect(codigos(r)).toContain('MONEDA_NO_ENCONTRADA')
  })

  it('impide desactivar la moneda funcional', () => {
    const r = validarMoneda(
      { ...aSolicitud(CRC), activa: false },
      { monedas: CATALOGO },
      false,
    )
    expect(codigos(r)).toContain('FUNCIONAL_INACTIVA')
  })

  it('obliga a que la funcional tenga tipo de cambio 1', () => {
    const r = validarMoneda(
      { ...aSolicitud(CRC), tipoCambio: '1.05' },
      { monedas: CATALOGO },
      false,
    )
    expect(codigos(r)).toContain('FUNCIONAL_TIPO_CAMBIO')
  })

  it('congela los decimales de una moneda con movimientos', () => {
    const r = validarMoneda(
      { ...aSolicitud(USD), decimales: 4 },
      { monedas: CATALOGO, enUso: true },
      false,
    )
    expect(codigos(r)).toContain('MONEDA_EN_USO')
  })

  it('deja cambiar el tipo de cambio aunque tenga movimientos', () => {
    // El de los asientos ya está congelado en ellos (docs/13 §7).
    const r = validarMoneda(
      { ...aSolicitud(USD), tipoCambio: '512.00' },
      { monedas: CATALOGO, enUso: true },
      false,
    )
    expect(r.valido).toBe(true)
  })
})

describe('Eliminación', () => {
  it('no elimina la moneda funcional', () => {
    const r = validarEliminacion('CRC', { monedas: CATALOGO })
    expect(codigos(r)).toContain('FUNCIONAL_UNICA')
  })

  it('no elimina una moneda con movimientos', () => {
    const r = validarEliminacion('USD', { monedas: CATALOGO, enUso: true })
    expect(codigos(r)).toContain('MONEDA_EN_USO')
  })

  it('elimina una moneda sin uso', () => {
    const r = validarEliminacion('USD', { monedas: CATALOGO, enUso: false })
    expect(r.valido).toBe(true)
  })
})

describe('Moneda funcional', () => {
  it('no admite una moneda inactiva', () => {
    const catalogo = CATALOGO.map((m) =>
      m.codigo === 'USD' ? { ...m, activa: false } : m,
    )
    const r = validarFuncional('USD', { monedas: catalogo })
    expect(codigos(r)).toContain('FUNCIONAL_INACTIVA')
  })

  it('mueve la marca y pone su tipo de cambio a la par', () => {
    const nuevo = aplicarFuncional('USD', CATALOGO)
    expect(nuevo.find((m) => m.codigo === 'USD')).toMatchObject({
      funcional: true,
      tipoCambio: '1',
    })
    expect(nuevo.find((m) => m.codigo === 'CRC')?.funcional).toBe(false)
    // El de las demás no se reexpresa: eso es una decisión contable
    expect(nuevo.find((m) => m.codigo === 'CRC')?.tipoCambio).toBe('1')
  })
})
