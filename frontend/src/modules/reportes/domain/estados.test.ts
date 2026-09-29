import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type {
  ClasificacionNiifBase,
  Cuenta,
  GrupoPresentacion,
  NotaEeffBase,
  TipoCuenta,
} from '@/shared/api/contracts/conta'
import type { Catalogos } from './presentacion'
import {
  construirEstadoResultados,
  construirEstadoSituacion,
  movimientosEntre,
} from './estados'
import { construirEstadoFlujos } from './flujos'
import { construirEstadoPatrimonio } from './patrimonio'
import type { Importes } from './saldos'

/*
 * Un ejercicio pequeño, calculado a mano, sobre el que se comprueban los cuatro
 * estados. Todos los saldos en convención deudor positivo.
 *
 * Apertura: caja 1000 contra capital 1000. Durante el año:
 *   venta a crédito 500, costo pagado 200, compra de equipo a crédito 300,
 *   depreciación 50, cobro 400, diferencial ganado 30 y perdido 10, y 20
 *   cargados a una cuenta que nadie clasificó.
 * Utilidad: 500 - 200 - 50 + 30 - 10 = 270.
 */

function clasificacion(
  codigo: string,
  estado: 'situacion' | 'resultados',
  tipos: TipoCuenta[],
  grupo: GrupoPresentacion,
  orden: number,
): ClasificacionNiifBase {
  return {
    id: `niif-${codigo}`,
    codigo,
    nombre: `Renglón ${codigo}`,
    estadoFinanciero: estado,
    tiposCuenta: tipos,
    seccionNiif: null,
    orden,
    grupo,
    activa: true,
  }
}

const CLASIFICACIONES: ClasificacionNiifBase[] = [
  clasificacion('A.01', 'situacion', ['activo'], 'activo_corriente', 10),
  clasificacion('A.02', 'situacion', ['activo'], 'activo_corriente', 20),
  clasificacion('A.06', 'situacion', ['activo'], 'activo_no_corriente', 60),
  clasificacion('P.01', 'situacion', ['pasivo'], 'pasivo_corriente', 70),
  clasificacion('PT.01', 'situacion', ['capital'], 'patrimonio', 100),
  clasificacion('PT.02', 'situacion', ['capital'], 'patrimonio', 110),
  clasificacion('R.01', 'resultados', ['ingreso'], 'ingresos', 120),
  clasificacion('R.03', 'resultados', ['costo'], 'costo_ventas', 140),
  clasificacion('R.06', 'resultados', ['gasto'], 'gastos_operacion', 170),
  clasificacion('R.08', 'resultados', ['ingreso', 'gasto'], 'resultado_financiero', 190),
]

const NOTAS: NotaEeffBase[] = [
  {
    id: 'nota-01a',
    clasificacionNiifId: 'niif-A.01',
    numero: 1,
    literal: 'a',
    titulo: 'Caja',
    descripcion: '',
    activa: true,
  },
  {
    id: 'nota-01b',
    clasificacionNiifId: 'niif-A.01',
    numero: 1,
    literal: 'b',
    titulo: 'Bancos',
    descripcion: '',
    activa: true,
  },
]

function cuenta(
  codigo: string,
  tipo: TipoCuenta,
  clasificacionCodigo: string | null,
  extra: Partial<Cuenta> = {},
): Cuenta {
  return {
    id: `cta-${codigo}`,
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
    clasificacionNiifId: clasificacionCodigo ? `niif-${clasificacionCodigo}` : null,
    notaEeffId: null,
    activa: true,
    ...extra,
  }
}

const CUENTAS: Cuenta[] = [
  cuenta('1.1.01.001', 'activo', 'A.01', { notaEeffId: 'nota-01a' }),
  cuenta('1.1.02.001', 'activo', 'A.02'),
  cuenta('1.1.09.001', 'activo', null),
  cuenta('1.2.01.001', 'activo', 'A.06'),
  cuenta('1.2.02.001', 'activo', 'A.06', { naturaleza: 'acreedora' }),
  cuenta('2.1.01.001', 'pasivo', 'P.01'),
  cuenta('3.1.01.001', 'capital', 'PT.01'),
  cuenta('3.2.01.001', 'capital', 'PT.02'),
  cuenta('4.1.01.001', 'ingreso', 'R.01'),
  cuenta('4.2.01.001', 'ingreso', 'R.08'),
  cuenta('5.1.01.001', 'costo', 'R.03'),
  cuenta('6.1.02.010', 'gasto', 'R.06'),
  cuenta('6.2.01.002', 'gasto', 'R.08'),
]

const CATALOGOS: Catalogos = {
  cuentas: CUENTAS,
  clasificaciones: CLASIFICACIONES,
  notas: NOTAS,
}

function importes(valores: Record<string, number>): Importes {
  return new Map(
    Object.entries(valores).map(([codigo, v]) => [codigo, new Decimal(v)]),
  )
}

const APERTURA = importes({ '1.1.01.001': 1000, '3.1.01.001': -1000 })

const CIERRE_DEL_ANIO = importes({
  '1.1.01.001': 1200,
  '1.1.02.001': 100,
  '1.1.09.001': 20,
  '1.2.01.001': 300,
  '1.2.02.001': -50,
  '2.1.01.001': -300,
  '3.1.01.001': -1000,
  '4.1.01.001': -500,
  '4.2.01.001': -30,
  '5.1.01.001': 200,
  '6.1.02.010': 50,
  '6.2.01.002': 10,
})

/** El asiento de cierre: resultados a cero contra utilidades acumuladas. */
const TRAS_EL_CIERRE = importes({
  '1.1.01.001': 1200,
  '1.1.02.001': 100,
  '1.1.09.001': 20,
  '1.2.01.001': 300,
  '1.2.02.001': -50,
  '2.1.01.001': -300,
  '3.1.01.001': -1000,
  '3.2.01.001': -270,
})

describe('Estado de Situación Financiera', () => {
  const estado = construirEstadoSituacion(
    { alCierre: CIERRE_DEL_ANIO, alAbrirEjercicio: APERTURA },
    null,
    CATALOGOS,
  )

  it('cuadra: activo igual a pasivo más patrimonio', () => {
    expect(estado.activo.total).toBe('1570.00')
    expect(estado.pasivo.total).toBe('300.00')
    expect(estado.patrimonio.total).toBe('1270.00')
    expect(estado.cuadra).toBe(true)
    expect(estado.diferencia).toBe('0.00')
  })

  it('separa lo corriente de lo no corriente, en el orden de la norma', () => {
    expect(estado.activo.grupos.map((g) => g.grupo)).toEqual([
      'activo_corriente',
      'activo_no_corriente',
      null,
    ])
  })

  it('la depreciación acumulada resta dentro de su renglón', () => {
    const ppe = estado.activo.grupos[1].renglones[0]
    expect(ppe.importe).toBe('250.00')
    expect(ppe.cuentas.map((c) => c.importe)).toEqual(['300.00', '-50.00'])
  })

  it('no esconde una cuenta sin clasificar: la presenta aparte y marcada', () => {
    const sinClasificar = estado.activo.grupos[2].renglones[0]
    expect(sinClasificar.sinClasificar).toBe(true)
    expect(sinClasificar.importe).toBe('20.00')
    expect(estado.haySinClasificar).toBe(true)
  })

  it('presenta el resultado del ejercicio dentro del patrimonio', () => {
    const renglones = estado.patrimonio.grupos[0].renglones
    expect(renglones.map((r) => [r.nombre, r.importe])).toEqual([
      ['Renglón PT.01', '1000.00'],
      ['Resultado del ejercicio', '270.00'],
    ])
  })

  it('cita solo las notas de las cuentas que tienen saldo', () => {
    expect(estado.activo.grupos[0].renglones[0].notas).toEqual(['1a'])
  })

  it('separa lo que quedó sin cerrar de ejercicios anteriores', () => {
    const conAnterior = construirEstadoSituacion(
      {
        alCierre: CIERRE_DEL_ANIO,
        // Al abrir el año ya había 100 de ventas del año anterior sin cerrar.
        alAbrirEjercicio: importes({
          '1.1.01.001': 1100,
          '3.1.01.001': -1000,
          '4.1.01.001': -100,
        }),
      },
      null,
      CATALOGOS,
    )
    const renglones = conAnterior.patrimonio.grupos[0].renglones
    expect(renglones.map((r) => [r.clave, r.importe])).toEqual([
      ['niif-PT.01', '1000.00'],
      ['resultado-anteriores', '100.00'],
      ['resultado-ejercicio', '170.00'],
    ])
  })

  it('tras el cierre, el resultado vive en resultados acumulados y sigue cuadrando', () => {
    const cerrado = construirEstadoSituacion(
      { alCierre: TRAS_EL_CIERRE, alAbrirEjercicio: APERTURA },
      null,
      CATALOGOS,
    )
    expect(cerrado.cuadra).toBe(true)
    expect(cerrado.patrimonio.total).toBe('1270.00')
  })

  it('compara con otro corte, renglón por renglón', () => {
    const comparado = construirEstadoSituacion(
      { alCierre: CIERRE_DEL_ANIO, alAbrirEjercicio: APERTURA },
      { alCierre: APERTURA, alAbrirEjercicio: APERTURA },
      CATALOGOS,
    )
    expect(comparado.activo.comparado).toBe('1000.00')
    expect(comparado.totalPasivoPatrimonioComparado).toBe('1000.00')
    expect(comparado.activo.grupos[0].renglones[0].comparado).toBe('1000.00')
  })
})

describe('Estado de Resultados', () => {
  const movimientos = movimientosEntre(CIERRE_DEL_ANIO, APERTURA)
  const estado = construirEstadoResultados(movimientos, null, CATALOGOS)

  it('llega a la utilidad neta con los subtotales intercalados', () => {
    const lineas = estado.bloques.map((b) =>
      b.tipo === 'grupo'
        ? `${b.grupo.grupo}:${b.grupo.total}`
        : `${b.etiqueta}:${b.importe}`,
    )
    expect(lineas).toEqual([
      'ingresos:500.00',
      'costo_ventas:-200.00',
      'Utilidad bruta:300.00',
      'gastos_operacion:-50.00',
      'Utilidad de operación:250.00',
      'resultado_financiero:20.00',
      'Utilidad antes de impuestos:270.00',
      'Utilidad neta:270.00',
    ])
    expect(estado.utilidadNeta).toBe('270.00')
  })

  it('presenta neto el renglón que reúne ganancias y pérdidas', () => {
    const financiero = estado.bloques.find(
      (b) => b.tipo === 'grupo' && b.grupo.grupo === 'resultado_financiero',
    )
    expect(financiero?.tipo === 'grupo' && financiero.grupo.renglones[0].importe).toBe(
      '20.00',
    )
  })

  it('coincide con el resultado del ejercicio del balance', () => {
    const balance = construirEstadoSituacion(
      { alCierre: CIERRE_DEL_ANIO, alAbrirEjercicio: APERTURA },
      null,
      CATALOGOS,
    )
    const resultado = balance.patrimonio.grupos[0].renglones.find(
      (r) => r.clave === 'resultado-ejercicio',
    )
    expect(resultado?.importe).toBe(estado.utilidadNeta)
  })
})

describe('Estado de Flujos de Efectivo', () => {
  const estado = construirEstadoFlujos(APERTURA, CIERRE_DEL_ANIO, CATALOGOS)

  it('la variación calculada es exactamente la variación del efectivo', () => {
    expect(estado.efectivoInicial).toBe('1000.00')
    expect(estado.efectivoFinal).toBe('1200.00')
    expect(estado.variacionReal).toBe('200.00')
    expect(estado.variacionCalculada).toBe('200.00')
    expect(estado.cuadra).toBe(true)
  })

  it('parte de la utilidad neta y devuelve la depreciación a operación', () => {
    expect(estado.utilidadNeta).toBe('270.00')
    const primero = estado.operacion.renglones[0]
    expect(primero.clave).toBe('no-efectivo:niif-A.06')
    expect(primero.importe).toBe('50.00')
  })

  it('la compra de equipo es inversión y resta', () => {
    expect(estado.inversion.total).toBe('-300.00')
  })

  it('lleva a operación, marcada, la variación de lo que no tiene renglón', () => {
    const sinClasificar = estado.operacion.renglones.find((r) => r.sinClasificar)
    expect(sinClasificar?.importe).toBe('-20.00')
    expect(estado.haySinClasificar).toBe(true)
  })

  it('un aporte de capital en efectivo es financiamiento', () => {
    const conAporte = construirEstadoFlujos(
      APERTURA,
      importes({ '1.1.01.001': 1500, '3.1.01.001': -1500 }),
      CATALOGOS,
    )
    expect(conAporte.financiamiento.total).toBe('500.00')
    expect(conAporte.cuadra).toBe(true)
  })
})

describe('Estado de Cambios en el Patrimonio', () => {
  it('termina en el patrimonio que presenta el balance', () => {
    const estado = construirEstadoPatrimonio(
      {
        inicio: APERTURA,
        finSinCierre: CIERRE_DEL_ANIO,
        finConCierre: CIERRE_DEL_ANIO,
      },
      CATALOGOS,
    )
    expect(estado.filas.map((f) => f.clave)).toEqual([
      'saldo-inicial',
      'resultado',
      'movimientos',
      'saldo-final',
    ])
    expect(estado.totalFinal).toBe('1270.00')
  })

  it('el cierre traslada el resultado a resultados acumulados en su propia fila', () => {
    const estado = construirEstadoPatrimonio(
      {
        inicio: APERTURA,
        finSinCierre: CIERRE_DEL_ANIO,
        finConCierre: TRAS_EL_CIERRE,
      },
      CATALOGOS,
    )
    const cierre = estado.filas.find((f) => f.clave === 'cierre')
    expect(cierre?.importes['niif-PT.02']).toBe('270.00')
    expect(cierre?.importes['resultado-ejercicio']).toBe('-270.00')
    expect(cierre?.total).toBe('0.00')

    const final = estado.filas.find((f) => f.clave === 'saldo-final')
    expect(final?.importes['resultado-ejercicio']).toBe('0.00')
    expect(final?.total).toBe('1270.00')
  })
})
