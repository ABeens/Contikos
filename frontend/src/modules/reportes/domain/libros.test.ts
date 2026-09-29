import { describe, expect, it } from 'vitest'
import type { Libro } from '@/shared/api/contracts/comunes'
import type {
  Asiento,
  Balanza,
  Cuenta,
  LineaAsiento,
  RenglonBalanza,
} from '@/shared/api/contracts/conta'
import { compararLibros, construirDiario, construirMayor } from './libros'

function linea(
  cuentaCodigo: string,
  cargo: string,
  abono: string,
  libros: Libro[] = ['fiscal', 'corporativo'],
): LineaAsiento {
  return {
    id: `${cuentaCodigo}-${cargo}-${abono}`,
    orden: 1,
    cuentaCodigo,
    cuentaNombre: cuentaCodigo,
    concepto: '',
    cargo,
    abono,
    libros,
    centroCosto: null,
    auxiliarTipo: null,
    auxiliarId: null,
    auxiliarNombre: null,
  }
}

function asiento(
  numero: number,
  fecha: string,
  lineas: LineaAsiento[],
): Asiento {
  return {
    id: `as-${numero}`,
    numero,
    ejercicio: 2026,
    codigo: `AS-2026-${String(numero).padStart(6, '0')}`,
    fecha,
    concepto: `Asiento ${numero}`,
    origenModulo: null,
    origenTipo: null,
    origenId: null,
    moneda: 'CRC',
    tipoCambio: '1',
    estado: 'contabilizado',
    reversaDeId: null,
    reversadoPorId: null,
    motivoReversa: null,
    documentoRelacionado: null,
    libros: ['fiscal', 'corporativo'],
    totales: [],
    lineas,
    creadoPor: 'prueba',
    creadoEn: '2026-01-01T00:00:00Z',
  }
}

function cuenta(codigo: string, naturaleza: 'deudora' | 'acreedora'): Cuenta {
  return {
    id: codigo,
    codigo,
    nombre: `Cuenta ${codigo}`,
    cuentaPadreId: null,
    nivel: 4,
    naturaleza,
    tipo: naturaleza === 'deudora' ? 'activo' : 'ingreso',
    esDetalle: true,
    requiereAuxiliar: null,
    esCuentaControl: false,
    moduloDueno: null,
    moneda: null,
    clasificacionNiifId: null,
    notaEeffId: null,
    activa: true,
  }
}

function renglon(
  codigo: string,
  naturaleza: 'deudora' | 'acreedora',
  saldoInicial: string,
  saldoFinal = saldoInicial,
): RenglonBalanza {
  return {
    cuentaId: codigo,
    codigo,
    nombre: `Cuenta ${codigo}`,
    nivel: 4,
    esDetalle: true,
    naturaleza,
    saldoInicial,
    cargos: '0.00',
    abonos: '0.00',
    saldoFinal,
  }
}

function balanza(libro: Libro, renglones: RenglonBalanza[]): Balanza {
  return {
    periodo: {
      id: 'per-2026-08',
      ejercicio: 2026,
      numero: 8,
      fechaInicio: '2026-08-01',
      fechaFin: '2026-08-31',
      estado: 'abierto',
      cerradoEn: null,
      cerradoPor: null,
      motivoCierre: null,
    },
    libro,
    moneda: 'CRC',
    renglones,
    totalCargos: '0.00',
    totalAbonos: '0.00',
    cuadra: true,
  }
}

const CUENTAS = [cuenta('1.1.01.001', 'deudora'), cuenta('4.1.01.001', 'acreedora')]

const ASIENTOS = [
  asiento(2, '2026-08-10', [
    linea('1.1.01.001', '300.00', '0.00'),
    linea('4.1.01.001', '0.00', '300.00'),
  ]),
  asiento(1, '2026-08-05', [
    linea('1.1.01.001', '100.00', '0.00'),
    linea('4.1.01.001', '0.00', '100.00'),
  ]),
  // Solo corporativo: no existe para el libro fiscal.
  asiento(3, '2026-08-20', [
    linea('1.1.01.001', '0.00', '50.00', ['corporativo']),
    linea('4.1.01.001', '50.00', '0.00', ['corporativo']),
  ]),
]

describe('Libro diario', () => {
  it('ordena por fecha y deja fuera lo que no es del libro', () => {
    const diario = construirDiario(ASIENTOS, 'fiscal')
    expect(diario.asientos.map((a) => a.codigo)).toEqual([
      'AS-2026-000001',
      'AS-2026-000002',
    ])
    expect(diario.totalCargos).toBe('400.00')
    expect(diario.cuadra).toBe(true)
  })

  it('el corporativo sí incluye el asiento que solo es suyo', () => {
    expect(construirDiario(ASIENTOS, 'corporativo').asientos).toHaveLength(3)
  })
})

describe('Libro mayor', () => {
  const inicial = balanza('fiscal', [
    renglon('1.1.01.001', 'deudora', '1000.00'),
    renglon('4.1.01.001', 'acreedora', '0.00'),
  ])

  it('arranca en el saldo de la balanza y lleva el saldo corrido', () => {
    const [caja] = construirMayor(ASIENTOS, inicial, CUENTAS, 'fiscal')
    expect(caja.saldoInicial).toBe('1000.00')
    expect(caja.movimientos.map((m) => m.saldo)).toEqual(['1100.00', '1400.00'])
    expect(caja.saldoFinal).toBe('1400.00')
  })

  it('en una cuenta acreedora el saldo crece con los abonos', () => {
    const ventas = construirMayor(ASIENTOS, inicial, CUENTAS, 'fiscal').find(
      (c) => c.codigo === '4.1.01.001',
    )
    expect(ventas?.saldoFinal).toBe('400.00')
  })

  it('como auxiliar, enseña la cuenta aunque no haya tenido movimientos', () => {
    const auxiliar = construirMayor([], inicial, CUENTAS, 'fiscal', '4.1.01.001')
    expect(auxiliar).toHaveLength(1)
    expect(auxiliar[0].movimientos).toHaveLength(0)
  })
})

describe('Comparativo fiscal contra corporativo', () => {
  it('enfrenta los dos libros por cuenta y cuenta las diferencias', () => {
    const comparativo = compararLibros(
      balanza('fiscal', [
        renglon('1.1.01.001', 'deudora', '0.00', '400.00'),
        renglon('4.1.01.001', 'acreedora', '0.00', '400.00'),
      ]),
      balanza('corporativo', [
        renglon('1.1.01.001', 'deudora', '0.00', '350.00'),
        renglon('4.1.01.001', 'acreedora', '0.00', '350.00'),
      ]),
    )
    expect(comparativo.renglones.map((r) => r.diferencia)).toEqual([
      '-50.00',
      '-50.00',
    ])
    expect(comparativo.conDiferencia).toBe(2)
  })
})
