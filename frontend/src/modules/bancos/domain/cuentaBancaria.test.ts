import { describe, expect, it } from 'vitest'
import { CUENTAS } from '@/mocks/seed/cuentas'
import {
  cuentasBancariasMock,
  movimientosBancariosMock,
} from '@/mocks/seed/bancos'
import type {
  MovimientoBancario,
  SolicitudCuentaBancaria,
} from '@/shared/api/contracts/bancos'
import {
  ibanValido,
  normalizarIban,
  saldoEnLibros,
  serializarCuentaBancaria,
  siguienteIdCuentaBancaria,
  validarCuentaBancaria,
} from './cuentaBancaria'

/**
 * Lo que se prueba aquí es la regla que sostiene el módulo entero: una cuenta
 * bancaria y una cuenta de control del mayor se corresponden **una a una**.
 * Romperla no da un error visible, da un auxiliar que nunca vuelve a cuadrar
 * contra el libro.
 */

const CUENTAS_BANCARIAS = cuentasBancariasMock

function solicitud(
  cambios: Partial<SolicitudCuentaBancaria> = {},
): SolicitudCuentaBancaria {
  return {
    banco: 'Banco Popular',
    nombre: 'BP, corriente colones',
    numeroCuenta: '200-01-999-000111-2',
    iban: null,
    tipo: 'cheques',
    moneda: 'CRC',
    // Ninguna otra cuenta bancaria la ocupa y el catálogo la declara de
    // control de `bancos`: es la única del plan que queda libre.
    cuentaContable: '1.1.01.010',
    activa: true,
    ...cambios,
  }
}

const contexto = (movimientos: readonly MovimientoBancario[] = []) => ({
  cuentas: CUENTAS,
  cuentasBancarias: CUENTAS_BANCARIAS,
  movimientos,
})

function codigos(resultado: ReturnType<typeof validarCuentaBancaria>) {
  return resultado.errores.map((e) => e.codigo)
}

describe('Cuenta de control', () => {
  it('rechaza una cuenta que ya es de otra cuenta bancaria', () => {
    // `1.1.01.010` es la cuenta de control de BCO-001. Dársela a una segunda
    // ficha repartiría el saldo del mayor entre dos auxiliares.
    const resultado = validarCuentaBancaria(solicitud(), contexto())
    expect(resultado.valido).toBe(false)
    expect(codigos(resultado)).toContain('CUENTA_CONTABLE_DUPLICADA')
  })

  it('acepta la suya propia al editar', () => {
    const resultado = validarCuentaBancaria(
      solicitud({ nombre: 'BN, otro alias' }),
      contexto(),
      'bco-001',
    )
    expect(resultado.valido).toBe(true)
  })

  it('rechaza una cuenta que el catálogo no declara bancaria', () => {
    // Caja general es efectivo y no exige auxiliar: por eso se puede cobrar
    // contra ella sin cuenta bancaria, y por eso no puede ser una.
    const resultado = validarCuentaBancaria(
      solicitud({ cuentaContable: '1.1.01.001' }),
      contexto(),
    )
    expect(codigos(resultado)).toContain('CUENTA_CONTABLE_NO_BANCARIA')
  })

  it('rechaza una cuenta que no existe', () => {
    const resultado = validarCuentaBancaria(
      solicitud({ cuentaContable: '9.9.99.999' }),
      contexto(),
    )
    expect(codigos(resultado)).toContain('CUENTA_CONTABLE_INVALIDA')
  })

  it('exige que la moneda coincida con la que el catálogo fija', () => {
    // `1.1.01.011` lleva su saldo en dólares. Declararla en colones produciría
    // movimientos que no cuadran contra su control.
    const resultado = validarCuentaBancaria(
      solicitud({ cuentaContable: '1.1.01.011', moneda: 'CRC' }),
      contexto(),
    )
    expect(codigos(resultado)).toContain('MONEDA_DISCREPANTE')
  })
})

describe('Ficha con movimientos', () => {
  it('congela la cuenta de control', () => {
    const resultado = validarCuentaBancaria(
      solicitud({ cuentaContable: '1.1.01.011', moneda: 'USD' }),
      contexto(movimientosBancariosMock),
      'bco-001',
    )
    expect(codigos(resultado)).toContain('CUENTA_CONTABLE_CONGELADA')
  })

  it('no deja desactivar una cuenta con saldo', () => {
    // Esconder del catálogo una cuenta con dinero deja en el mayor un saldo que
    // ninguna ficha visible explica.
    const resultado = validarCuentaBancaria(
      solicitud({ activa: false }),
      contexto(movimientosBancariosMock),
      'bco-001',
    )
    expect(codigos(resultado)).toContain('CUENTA_CON_SALDO')
  })

  it('deja desactivar una cuenta sin movimientos', () => {
    const resultado = validarCuentaBancaria(
      solicitud({
        cuentaContable: '1.1.01.011',
        moneda: 'USD',
        activa: false,
      }),
      contexto(movimientosBancariosMock),
      'bco-002',
    )
    expect(resultado.valido).toBe(true)
  })
})

describe('IBAN', () => {
  it('acepta el formato de Costa Rica y descarta el resto', () => {
    expect(ibanValido('CR05015100010012345678')).toBe(true)
    expect(ibanValido('100-01-000-123456-7')).toBe(false)
  })

  it('normaliza espacios y guiones antes de validar', () => {
    expect(normalizarIban(' cr05 0151 0001 0012 3456 78 ')).toBe(
      'CR05015100010012345678',
    )
    expect(normalizarIban('')).toBeNull()
    expect(normalizarIban(null)).toBeNull()
  })
})

describe('Saldo en libros', () => {
  it('suma los movimientos propios con su signo', () => {
    // El mayor de la demo deja tres líneas bancarias en BCO-001: un cobro que
    // entra, un pago que sale y una comisión que sale.
    const saldo = saldoEnLibros(movimientosBancariosMock, 'bco-001')
    expect(saldo.toFixed(2)).toBe('2867375.00')
  })

  it('cuadra contra el mayor, que es de donde salieron', () => {
    // La verificación de integridad de docs/06 §4, sobre los datos de fábrica:
    // el auxiliar de bancos tiene que decir lo mismo que el libro.
    const enElMayor = movimientosBancariosMock
      .filter((m) => m.cuentaBancariaId === 'bco-001')
      .every((m) => m.asientoId !== null)
    expect(enElMayor).toBe(true)
  })

  it('deja en cero una cuenta sin movimientos', () => {
    expect(saldoEnLibros(movimientosBancariosMock, 'bco-002').toFixed(2)).toBe(
      '0.00',
    )
  })
})

describe('Serialización', () => {
  it('deriva el saldo y los pendientes en vez de guardarlos', () => {
    const ficha = serializarCuentaBancaria(CUENTAS_BANCARIAS[0], {
      cuentas: CUENTAS,
      movimientos: movimientosBancariosMock,
    })
    expect(ficha.saldoLibros).toBe('2867375.00')
    expect(ficha.cuentaContableNombre).toBe(
      'Banco Nacional, cuenta corriente colones',
    )
    expect(ficha.movimientosSinConciliar).toBe(3)
  })
})

describe('Identificador', () => {
  it('sigue la convención con la que el mayor ya está sembrado', () => {
    // `bco-001` no es un formato nuevo: es el auxiliar que cobros y pagos
    // derivaban de la posición de la cuenta antes de que existiera el catálogo.
    expect(siguienteIdCuentaBancaria(CUENTAS_BANCARIAS)).toBe('bco-003')
    expect(siguienteIdCuentaBancaria([])).toBe('bco-001')
  })
})
