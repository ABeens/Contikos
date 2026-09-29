import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type { Cuenta, Periodo, TipoCuenta } from '@/shared/api/contracts/conta'
import {
  construirAsientoCierre,
  construirPeriodosEjercicio,
  verificarCierreEjercicio,
  type ContextoCierreEjercicio,
} from './ejercicio'

function cuenta(codigo: string, tipo: TipoCuenta, extra: Partial<Cuenta> = {}): Cuenta {
  return {
    id: codigo,
    codigo,
    nombre: `Cuenta ${codigo}`,
    cuentaPadreId: null,
    nivel: 4,
    naturaleza: ['activo', 'costo', 'gasto'].includes(tipo) ? 'deudora' : 'acreedora',
    tipo,
    esDetalle: true,
    requiereAuxiliar: null,
    esCuentaControl: false,
    moduloDueno: null,
    moneda: null,
    clasificacionNiifId: null,
    notaEeffId: null,
    activa: true,
    ...extra,
  }
}

const CUENTAS = [
  cuenta('1.1.01.001', 'activo'),
  cuenta('3.2.01.001', 'capital'),
  cuenta('3.1.01.001', 'capital', { activa: false }),
  cuenta('4.1.01.001', 'ingreso'),
  cuenta('6.1.02.010', 'gasto'),
]

/** Doce meses de 2026: los once primeros cerrados, diciembre abierto. */
function periodos(): Periodo[] {
  return construirPeriodosEjercicio(2026).map((p) =>
    p.numero < 12 ? { ...p, estado: 'cerrado' as const } : p,
  )
}

function mapa(valores: Record<string, number>) {
  return new Map(Object.entries(valores).map(([k, v]) => [k, new Decimal(v)]))
}

function contexto(extra: Partial<ContextoCierreEjercicio> = {}): ContextoCierreEjercicio {
  return {
    periodos: periodos(),
    cuentas: CUENTAS,
    saldos: {
      // Ventas 1000, gasto 300: utilidad 700 en los dos libros.
      fiscal: mapa({ '4.1.01.001': -1000, '6.1.02.010': 300 }),
      corporativo: mapa({ '4.1.01.001': -1000, '6.1.02.010': 300 }),
    },
    cuentaDestino: '3.2.01.001',
    fechaReferencia: '2027-01-15',
    yaCerrado: false,
    ...extra,
  }
}

describe('Checklist del cierre de ejercicio', () => {
  it('con todo en orden, se puede cerrar y dice cuánto se traslada', () => {
    const r = verificarCierreEjercicio(2026, contexto())
    expect(r.puedeCerrar).toBe(true)
    expect(r.fechaCierre).toBe('2026-12-31')
    expect(r.resultados).toEqual([
      { libro: 'fiscal', resultado: '700.00' },
      { libro: 'corporativo', resultado: '700.00' },
    ])
  })

  it('no se cierra un ejercicio en curso', () => {
    const r = verificarCierreEjercicio(2026, contexto({ fechaReferencia: '2026-09-29' }))
    expect(r.puedeCerrar).toBe(false)
    expect(r.verificaciones.find((v) => v.codigo === 'EJERCICIO_EN_CURSO')?.severidad).toBe(
      'error',
    )
  })

  it('exige los meses anteriores cerrados y el último abierto', () => {
    const conAbierto = periodos().map((p) =>
      p.numero === 3 ? { ...p, estado: 'abierto' as const } : p,
    )
    const r = verificarCierreEjercicio(2026, contexto({ periodos: conAbierto }))
    expect(r.verificaciones.find((v) => v.codigo === 'MESES_ABIERTOS')?.severidad).toBe('error')

    const diciembreCerrado = periodos().map((p) => ({ ...p, estado: 'cerrado' as const }))
    const r2 = verificarCierreEjercicio(2026, contexto({ periodos: diciembreCerrado }))
    expect(
      r2.verificaciones.find((v) => v.codigo === 'ULTIMO_MES_NO_ABIERTO')?.severidad,
    ).toBe('error')
  })

  it('rechaza una cuenta destino que no es de patrimonio o está inactiva', () => {
    for (const cuentaDestino of ['4.1.01.001', '3.1.01.001', null]) {
      const r = verificarCierreEjercicio(2026, contexto({ cuentaDestino }))
      expect(r.verificaciones.find((v) => v.codigo === 'CUENTA_DESTINO')?.severidad).toBe(
        'error',
      )
    }
  })

  it('no se cierra dos veces', () => {
    expect(verificarCierreEjercicio(2026, contexto({ yaCerrado: true })).puedeCerrar).toBe(false)
  })
})

describe('Asiento de cierre', () => {
  it('salda los resultados contra la cuenta destino, en una línea por cuenta', () => {
    const asiento = construirAsientoCierre(2026, contexto(), '2026-12-31', 'CRC')!
    expect(asiento.origen).toEqual({
      modulo: 'conta',
      tipo: 'cierre_ejercicio',
      id: 'cierre-2026',
    })
    expect(asiento.lineas.map((l) => [l.cuenta, l.cargo, l.abono, l.libros])).toEqual([
      ['4.1.01.001', '1000.00', '0.00', undefined],
      ['6.1.02.010', '0.00', '300.00', undefined],
      ['3.2.01.001', '0.00', '700.00', undefined],
    ])
  })

  it('separa por libro cuando las dos contabilidades difieren', () => {
    const asiento = construirAsientoCierre(
      2026,
      contexto({
        saldos: {
          fiscal: mapa({ '4.1.01.001': -1000, '6.1.02.010': 300 }),
          corporativo: mapa({ '4.1.01.001': -1000, '6.1.02.010': 400 }),
        },
      }),
      '2026-12-31',
      'CRC',
    )!
    const porLibro = (libro: 'fiscal' | 'corporativo') =>
      asiento.lineas.filter((l) => !l.libros || l.libros.includes(libro))
    const suma = (lineas: typeof asiento.lineas, campo: 'cargo' | 'abono') =>
      lineas.reduce((acc, l) => acc.plus(l[campo]), new Decimal(0)).toFixed(2)

    // Cada libro cuadra por su cuenta.
    for (const libro of ['fiscal', 'corporativo'] as const) {
      expect(suma(porLibro(libro), 'cargo')).toBe(suma(porLibro(libro), 'abono'))
    }
    const destino = asiento.lineas.filter((l) => l.cuenta === '3.2.01.001')
    expect(destino.map((l) => [l.abono, l.libros])).toEqual([
      ['700.00', ['fiscal']],
      ['600.00', ['corporativo']],
    ])
  })

  it('una pérdida se carga a patrimonio', () => {
    const asiento = construirAsientoCierre(
      2026,
      contexto({
        saldos: {
          fiscal: mapa({ '6.1.02.010': 300 }),
          corporativo: mapa({ '6.1.02.010': 300 }),
        },
      }),
      '2026-12-31',
      'CRC',
    )!
    const destino = asiento.lineas.find((l) => l.cuenta === '3.2.01.001')
    expect(destino?.cargo).toBe('300.00')
  })

  it('sin resultados no hay asiento', () => {
    expect(
      construirAsientoCierre(
        2026,
        contexto({ saldos: { fiscal: new Map(), corporativo: new Map() } }),
        '2026-12-31',
        'CRC',
      ),
    ).toBeNull()
  })
})
