import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { CUENTAS } from '@/mocks/seed/cuentas'
import { PERIODOS } from '@/mocks/seed/periodos'
import { MAPEO_BANCOS, cuentasBancariasMock } from '@/mocks/seed/bancos'
import type {
  CuentaBancaria,
  MovimientoBancario,
  SolicitudComision,
  SolicitudInteres,
  SolicitudTraspaso,
} from '@/shared/api/contracts/bancos'
import type { LineaSolicitud } from '@/shared/api/contracts/conta'
import {
  armarAsientoComision,
  armarAsientoInteres,
  armarAsientoTraspaso,
  diferenciaTraspaso,
  movimientoDeOrigen,
  siguienteIdMovimiento,
  validarComision,
  validarInteres,
  validarTraspaso,
  type ContextoMovimiento,
} from './movimiento'

/**
 * Lo que se prueba aquí es que el asiento que el módulo emite dice lo que pasó.
 * Una comisión mal armada no da error: da un crédito fiscal perdido y un gasto
 * inflado que nadie nota hasta la declaración.
 */

const CUENTAS_BANCARIAS: CuentaBancaria[] = cuentasBancariasMock.map((c) => ({
  ...c,
  cuentaContableNombre: c.cuentaContable,
  saldoLibros: '0.00',
  saldoBanco: null,
  saldoBancoAl: null,
  movimientos: 0,
  movimientosSinConciliar: 0,
}))

const COLONES = CUENTAS_BANCARIAS.find((c) => c.id === 'bco-001')!
const DOLARES = CUENTAS_BANCARIAS.find((c) => c.id === 'bco-002')!

/**
 * Una segunda cuenta en colones, que la demo no trae.
 *
 * Hace falta para probar el traspaso entre cuentas de la misma moneda, que es
 * el caso donde lo que sale y lo que entra tienen que ser el mismo importe. Su
 * cuenta de control no importa aquí: ninguna prueba de este bloque llega a
 * validarla contra el catálogo.
 */
const SEGUNDA_CRC: CuentaBancaria = {
  ...COLONES,
  id: 'bco-003',
  codigo: 'BCO-003',
  banco: 'Banco Popular',
  nombre: 'BP, corriente colones',
}

const CONTEXTO: ContextoMovimiento = {
  cuentasBancarias: CUENTAS_BANCARIAS,
  cuentas: CUENTAS,
  periodos: PERIODOS,
  mapeo: MAPEO_BANCOS,
  monedaFuncional: 'CRC',
}

/** Agosto de 2026 es el periodo abierto del mayor de la demostración. */
const FECHA = '2026-08-20'

function comision(cambios: Partial<SolicitudComision> = {}): SolicitudComision {
  return {
    cuentaBancariaId: 'bco-001',
    fecha: FECHA,
    concepto: 'Comisión por manejo de cuenta',
    referencia: null,
    importe: '12500',
    impuesto: '1625',
    tipoCambio: '1',
    ...cambios,
  }
}

function interes(cambios: Partial<SolicitudInteres> = {}): SolicitudInteres {
  return {
    cuentaBancariaId: 'bco-001',
    fecha: FECHA,
    concepto: 'Intereses sobre saldo',
    referencia: null,
    importe: '8400',
    tipoCambio: '1',
    ...cambios,
  }
}

function traspaso(cambios: Partial<SolicitudTraspaso> = {}): SolicitudTraspaso {
  return {
    cuentaOrigenId: 'bco-001',
    cuentaDestinoId: 'bco-002',
    fecha: FECHA,
    concepto: 'Fondeo de la cuenta en dólares',
    referencia: null,
    importeOrigen: '505250',
    importeDestino: '1000',
    tipoCambioOrigen: '1',
    tipoCambioDestino: '505.25',
    ...cambios,
  }
}

const cargoA = (lineas: readonly LineaSolicitud[], cuenta: string) =>
  lineas.find((l) => l.cuenta === cuenta && l.cargo !== '0')
const abonoA = (lineas: readonly LineaSolicitud[], cuenta: string) =>
  lineas.find((l) => l.cuenta === cuenta && l.abono !== '0')

function suma(lineas: readonly LineaSolicitud[], campo: 'cargo' | 'abono') {
  return lineas
    .reduce((acc, l) => acc.plus(l[campo] ?? '0'), new Decimal(0))
    .toFixed(2)
}

describe('Comisión bancaria', () => {
  it('separa el impuesto acreditable del gasto', () => {
    // Sumarlo al gasto perdería el crédito fiscal: es lo que se compensa
    // contra el IVA por pagar, y para eso tiene que estar en su cuenta.
    const asiento = armarAsientoComision(
      'mov-00010',
      comision(),
      COLONES,
      CONTEXTO,
    )
    expect(cargoA(asiento.lineas, MAPEO_BANCOS.comision)?.cargo).toBe('12500.00')
    expect(
      cargoA(asiento.lineas, MAPEO_BANCOS.impuestoAcreditable)?.cargo,
    ).toBe('1625.00')
    expect(abonoA(asiento.lineas, COLONES.cuentaContable)?.abono).toBe(
      '14125.00',
    )
  })

  it('cuadra y sale del banco con su auxiliar', () => {
    const asiento = armarAsientoComision(
      'mov-00010',
      comision(),
      COLONES,
      CONTEXTO,
    )
    expect(suma(asiento.lineas, 'cargo')).toBe(suma(asiento.lineas, 'abono'))

    const banco = abonoA(asiento.lineas, COLONES.cuentaContable)!
    expect(banco.auxiliarTipo).toBe('banco')
    // El auxiliar es el id de la ficha, que es el mismo con el que el mayor de
    // la demostración ya estaba sembrado.
    expect(banco.auxiliarId).toBe('bco-001')
  })

  it('omite la línea de impuesto cuando no lo lleva', () => {
    const asiento = armarAsientoComision(
      'mov-00010',
      comision({ impuesto: '0' }),
      COLONES,
      CONTEXTO,
    )
    expect(asiento.lineas).toHaveLength(2)
  })

  it('firma el asiento con su terna de origen', () => {
    // Es la llave de idempotencia de docs/02 §4: reintentar la misma comisión
    // devuelve el asiento que ya existe en vez de cobrarla dos veces.
    const asiento = armarAsientoComision(
      'mov-00010',
      comision(),
      COLONES,
      CONTEXTO,
    )
    expect(asiento.origen).toEqual({
      modulo: 'bancos',
      tipo: 'comision',
      id: 'mov-00010',
    })
  })

  it('convierte a la moneda funcional cuando la cuenta no lo está', () => {
    // Diez dólares de comisión entran al mayor en colones: el asiento es
    // siempre del libro, no del documento (docs/05 §2.2).
    const asiento = armarAsientoComision(
      'mov-00010',
      comision({
        cuentaBancariaId: 'bco-002',
        importe: '10',
        impuesto: '0',
        tipoCambio: '505.25',
      }),
      DOLARES,
      CONTEXTO,
    )
    expect(asiento.moneda).toBe('CRC')
    expect(cargoA(asiento.lineas, MAPEO_BANCOS.comision)?.cargo).toBe('5052.50')
  })

  it('rechaza el importe en cero y el periodo cerrado', () => {
    expect(
      validarComision(comision({ importe: '0' }), CONTEXTO).errores.map(
        (e) => e.codigo,
      ),
    ).toContain('IMPORTE_INVALIDO')
    expect(
      validarComision(
        comision({ fecha: '2026-06-15' }),
        CONTEXTO,
      ).errores.map((e) => e.codigo),
    ).toContain('PERIODO_CERRADO')
  })

  it('exige tipo de cambio 1 en la moneda funcional', () => {
    // Aceptar otro dejaría entrar al mayor un importe distinto del que dice el
    // documento, sin que nada lo delate.
    const resultado = validarComision(comision({ tipoCambio: '505.25' }), CONTEXTO)
    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'TIPO_CAMBIO_INVALIDO',
    )
  })

  it('acepta la captura válida', () => {
    expect(validarComision(comision(), CONTEXTO).valido).toBe(true)
  })
})

describe('Interés ganado', () => {
  it('es la comisión al revés: entra al banco contra un ingreso', () => {
    const asiento = armarAsientoInteres('mov-00011', interes(), COLONES, CONTEXTO)
    expect(cargoA(asiento.lineas, COLONES.cuentaContable)?.cargo).toBe('8400.00')
    expect(abonoA(asiento.lineas, MAPEO_BANCOS.interesGanado)?.abono).toBe(
      '8400.00',
    )
  })

  it('acepta la captura válida y rechaza el importe en cero', () => {
    expect(validarInteres(interes(), CONTEXTO).valido).toBe(true)
    expect(
      validarInteres(interes({ importe: '0' }), CONTEXTO).errores.map(
        (e) => e.codigo,
      ),
    ).toContain('IMPORTE_INVALIDO')
  })
})

describe('Traspaso entre cuentas propias', () => {
  it('no toca ninguna cuenta de resultados cuando la moneda es la misma', () => {
    // El dinero no entra ni sale de la empresa: cambia de sitio.
    const asiento = armarAsientoTraspaso(
      'tra-00012',
      traspaso({
        cuentaDestinoId: 'bco-001',
        cuentaOrigenId: 'bco-002',
        importeOrigen: '1000',
        importeDestino: '505250',
        tipoCambioOrigen: '505.25',
        tipoCambioDestino: '1',
      }),
      DOLARES,
      COLONES,
      CONTEXTO,
    )
    expect(asiento.lineas).toHaveLength(2)
    expect(suma(asiento.lineas, 'cargo')).toBe(suma(asiento.lineas, 'abono'))
  })

  it('mueve las dos cuentas con su auxiliar', () => {
    const asiento = armarAsientoTraspaso(
      'tra-00012',
      traspaso(),
      COLONES,
      DOLARES,
      CONTEXTO,
    )
    const entrada = cargoA(asiento.lineas, DOLARES.cuentaContable)!
    const salida = abonoA(asiento.lineas, COLONES.cuentaContable)!
    expect(entrada.auxiliarId).toBe('bco-002')
    expect(salida.auxiliarId).toBe('bco-001')
  })

  it('reconoce la diferencia cambiaria cuando los tipos no cuadran', () => {
    // Salen ₡505.250 y entran mil dólares que al tipo del día valen ₡510.000:
    // la diferencia es una ganancia cambiaria realizada.
    const solicitud = traspaso({ tipoCambioDestino: '510' })
    expect(diferenciaTraspaso(solicitud, 'CRC').toApi()).toBe('4750.00')

    const asiento = armarAsientoTraspaso(
      'tra-00012',
      solicitud,
      COLONES,
      DOLARES,
      CONTEXTO,
    )
    expect(abonoA(asiento.lineas, MAPEO_BANCOS.diferencialGanado)?.abono).toBe(
      '4750.00',
    )
    expect(suma(asiento.lineas, 'cargo')).toBe(suma(asiento.lineas, 'abono'))
  })

  it('reconoce la pérdida cuando entra menos de lo que sale', () => {
    const asiento = armarAsientoTraspaso(
      'tra-00012',
      traspaso({ tipoCambioDestino: '500' }),
      COLONES,
      DOLARES,
      CONTEXTO,
    )
    expect(cargoA(asiento.lineas, MAPEO_BANCOS.diferencialPerdido)?.cargo).toBe(
      '5250.00',
    )
    expect(suma(asiento.lineas, 'cargo')).toBe(suma(asiento.lineas, 'abono'))
  })

  it('exige que entre lo mismo que sale entre cuentas de la misma moneda', () => {
    // Si no coincide, falta un movimiento (una comisión de traspaso, por
    // ejemplo) y hay que capturarlo aparte en vez de esconderlo aquí.
    const resultado = validarTraspaso(
      traspaso({
        cuentaDestinoId: 'bco-003',
        importeDestino: '500000',
        tipoCambioDestino: '1',
      }),
      { ...CONTEXTO, cuentasBancarias: [...CUENTAS_BANCARIAS, SEGUNDA_CRC] },
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'IMPORTES_DISTINTOS',
    )
  })

  it('rechaza el traspaso a la misma cuenta', () => {
    const resultado = validarTraspaso(
      traspaso({ cuentaDestinoId: 'bco-001' }),
      CONTEXTO,
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('MISMA_CUENTA')
  })

  it('acepta la captura válida entre monedas distintas', () => {
    expect(validarTraspaso(traspaso(), CONTEXTO).valido).toBe(true)
  })
})

describe('Idempotencia y consecutivo', () => {
  const ficha = (
    id: string,
    origen: MovimientoBancario['origen'],
  ): MovimientoBancario => ({
    id,
    cuentaBancariaId: 'bco-001',
    fecha: FECHA,
    tipo: 'deposito',
    concepto: 'Movimiento de prueba',
    referencia: null,
    importe: '1000.00',
    origen,
    estado: 'registrado',
    asientoId: null,
    conciliacionId: null,
    creadoEn: `${FECHA}T09:00:00Z`,
  })

  const registrados: MovimientoBancario[] = [
    ficha('mov-00001', { modulo: 'cxc', tipo: 'cobro', id: 'cob-088' }),
    ficha('mov-00007', null),
  ]

  it('reconoce un evento que ya se registró por su terna de origen', () => {
    expect(
      movimientoDeOrigen(registrados, 'cxc', 'cobro', 'cob-088')?.id,
    ).toBe('mov-00001')
    expect(movimientoDeOrigen(registrados, 'cxc', 'cobro', 'cob-999')).toBe(
      undefined,
    )
  })

  it('numera a partir del mayor emitido y no del tamaño de la lista', () => {
    expect(siguienteIdMovimiento(registrados)).toBe('mov-00008')
    expect(siguienteIdMovimiento([])).toBe('mov-00001')
  })
})
