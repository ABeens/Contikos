import { describe, expect, it } from 'vitest'
import type {
  CuentaBancaria,
  MovimientoBancario,
  MovimientoEstadoCuenta,
} from '@/shared/api/contracts/bancos'
import {
  calcularConciliacion,
  diasEntre,
  sugerirEmparejamientos,
  validarEmparejamiento,
} from './conciliacion'

/**
 * Lo que se prueba aquí es lo que el diseño señala como el riesgo del módulo
 * (docs/06 §2.3): que el emparejamiento automático no case lo que no es, y que
 * la conciliación no se pueda cerrar con diferencia. Un falso positivo no da
 * error: da una cuenta que parece conciliada y no lo está.
 */

const CUENTA: CuentaBancaria = {
  id: 'bco-001',
  codigo: 'BCO-001',
  banco: 'Banco Nacional de Costa Rica',
  nombre: 'BN, corriente colones',
  numeroCuenta: '100-01-000-123456-7',
  iban: null,
  tipo: 'cheques',
  moneda: 'CRC',
  cuentaContable: '1.1.01.010',
  cuentaContableNombre: 'Banco Nacional',
  saldoLibros: '0.00',
  saldoBanco: null,
  saldoBancoAl: null,
  movimientos: 0,
  movimientosSinConciliar: 0,
  activa: true,
}

let secuencia = 0

function propio(
  cambios: Partial<MovimientoBancario> = {},
): MovimientoBancario {
  secuencia += 1
  return {
    id: `mov-${String(secuencia).padStart(5, '0')}`,
    cuentaBancariaId: 'bco-001',
    fecha: '2026-08-05',
    tipo: 'deposito',
    concepto: 'Cobro de cliente',
    referencia: null,
    importe: '100000.00',
    origen: null,
    estado: 'registrado',
    asientoId: 'asi-2026-000001',
    conciliacionId: null,
    creadoEn: '2026-08-05T09:00:00Z',
    ...cambios,
  }
}

function delBanco(
  cambios: Partial<MovimientoEstadoCuenta> = {},
): MovimientoEstadoCuenta {
  secuencia += 1
  return {
    id: `ecu-${String(secuencia).padStart(6, '0')}`,
    cuentaBancariaId: 'bco-001',
    fechaOperacion: '2026-08-05',
    fechaValor: '2026-08-05',
    descripcion: 'DEPOSITO RECIBIDO',
    referencia: null,
    cargo: '0.00',
    abono: '100000.00',
    saldo: null,
    origenCarga: 'archivo',
    conciliacionId: null,
    huella: `h-${secuencia}`,
    importadoEn: '2026-08-06T09:00:00Z',
    ...cambios,
  }
}

describe('Regla 1: referencia e importe exactos', () => {
  it('casa lo que comparte referencia e importe', () => {
    const uno = propio({ referencia: 'TRF-4471209' })
    const linea = delBanco({ referencia: 'TRF-4471209' })

    const [sugerencia] = sugerirEmparejamientos([uno], [linea])
    expect(sugerencia.regla).toBe('referencia_importe')
    expect(sugerencia.requiereConfirmacion).toBe(false)
    expect(sugerencia.movimientosPropios).toEqual([uno.id])
  })

  it('gana a las reglas más flojas, aunque la fecha no coincida', () => {
    // La cascada existe para esto: sin ella, la regla del importe suelto
    // casaría por su cuenta un movimiento que la de la referencia casa bien.
    const conReferencia = propio({
      referencia: 'TRF-1',
      fecha: '2026-08-01',
      concepto: 'Cobro A',
    })
    const sinReferencia = propio({ fecha: '2026-08-05', concepto: 'Cobro B' })
    const linea = delBanco({ referencia: 'TRF-1', fechaOperacion: '2026-08-05' })

    const sugerencias = sugerirEmparejamientos(
      [sinReferencia, conReferencia],
      [linea],
    )
    expect(sugerencias).toHaveLength(1)
    expect(sugerencias[0].movimientosPropios).toEqual([conReferencia.id])
  })
})

describe('Regla 2: importe exacto dentro de la ventana', () => {
  it('casa el mismo importe con días de diferencia', () => {
    // El banco procesa con retraso, y el fin de semana no existe para él.
    const uno = propio({ fecha: '2026-08-04' })
    const linea = delBanco({ fechaOperacion: '2026-08-05' })

    const [sugerencia] = sugerirEmparejamientos([uno], [linea])
    expect(sugerencia.regla).toBe('importe_fecha')
    expect(sugerencia.diasDiferencia).toBe(1)
  })

  it('no casa fuera de la ventana', () => {
    const uno = propio({ fecha: '2026-07-01' })
    const linea = delBanco({ fechaOperacion: '2026-08-05' })
    expect(sugerirEmparejamientos([uno], [linea])).toHaveLength(0)
  })

  it('no casa importes distintos por muy cerca que estén', () => {
    const uno = propio({ importe: '100000.01' })
    const linea = delBanco({ abono: '100000.00' })
    expect(sugerirEmparejamientos([uno], [linea])).toHaveLength(0)
  })

  it('no casa un cargo con un abono del mismo importe', () => {
    // El signo es lo que distingue lo que entró de lo que salió: casarlos
    // dejaría dos movimientos reales dados por conciliados con nada.
    const salida = propio({ importe: '-100000.00' })
    const entrada = delBanco({ cargo: '0.00', abono: '100000.00' })
    expect(sugerirEmparejamientos([salida], [entrada])).toHaveLength(0)
  })
})

describe('Regla 3: importe y descripción', () => {
  it('casa cuando comparten una palabra significativa', () => {
    const uno = propio({
      fecha: '2026-07-01',
      concepto: 'Comisión por administración de cuenta',
    })
    const linea = delBanco({
      fechaOperacion: '2026-08-05',
      descripcion: 'COMISION ADMINISTRACION CUENTA',
    })

    const [sugerencia] = sugerirEmparejamientos([uno], [linea])
    expect(sugerencia.regla).toBe('importe_descripcion')
  })

  it('no casa por palabras vacías', () => {
    // "transferencia" y "de" aparecen en la mitad de los movimientos de
    // cualquier cuenta: casar por ellas es casar por nada.
    const uno = propio({
      fecha: '2026-07-01',
      concepto: 'Transferencia de la sucursal',
    })
    const linea = delBanco({
      fechaOperacion: '2026-08-05',
      descripcion: 'TRANSFERENCIA DE TERCEROS',
    })
    expect(sugerirEmparejamientos([uno], [linea])).toHaveLength(0)
  })
})

describe('Regla 4: varios propios contra uno del banco', () => {
  it('propone el grupo que suma, y pide confirmación', () => {
    // Es la que más falsos positivos produce: el diseño pide expresamente que
    // no se aplique en silencio.
    const uno = propio({ importe: '60000.00', concepto: 'Cheque A' })
    const otro = propio({ importe: '40000.00', concepto: 'Cheque B' })
    const linea = delBanco({ abono: '100000.00' })

    const [sugerencia] = sugerirEmparejamientos([uno, otro], [linea])
    expect(sugerencia.regla).toBe('agrupado')
    expect(sugerencia.requiereConfirmacion).toBe(true)
    expect(sugerencia.movimientosPropios).toHaveLength(2)
  })

  it('no agrupa movimientos de signos contrarios', () => {
    // Con signos mezclados siempre se encuentra alguna combinación que suma, y
    // casi ninguna significa nada.
    const entrada = propio({ importe: '150000.00' })
    const salida = propio({ importe: '-50000.00' })
    const linea = delBanco({ abono: '100000.00' })
    expect(sugerirEmparejamientos([entrada, salida], [linea])).toHaveLength(0)
  })

  it('no agrupa fuera de la ventana de días', () => {
    const uno = propio({ importe: '60000.00', fecha: '2026-06-01' })
    const otro = propio({ importe: '40000.00', fecha: '2026-06-02' })
    const linea = delBanco({ abono: '100000.00', fechaOperacion: '2026-08-05' })
    expect(sugerirEmparejamientos([uno, otro], [linea])).toHaveLength(0)
  })
})

describe('Consumo en cascada', () => {
  it('no propone dos veces el mismo movimiento', () => {
    // Un movimiento propio explica una sola línea del banco: proponerlo para
    // dos dejaría que aceptar las dos cuadrara una conciliación falsa.
    const uno = propio({ importe: '100000.00' })
    const primera = delBanco({ abono: '100000.00' })
    const segunda = delBanco({ abono: '100000.00' })

    const sugerencias = sugerirEmparejamientos([uno], [primera, segunda])
    expect(sugerencias).toHaveLength(1)
  })

  it('ignora lo ya conciliado de los dos lados', () => {
    const uno = propio({ estado: 'conciliado', conciliacionId: 'con-0001' })
    const linea = delBanco({ conciliacionId: 'con-0001' })
    expect(sugerirEmparejamientos([uno], [linea])).toHaveLength(0)
  })
})

describe('Resumen de la conciliación', () => {
  const resumen = (
    movimientos: MovimientoBancario[],
    lineasBanco: MovimientoEstadoCuenta[],
    saldoBanco: string | null,
  ) =>
    calcularConciliacion({
      cuenta: CUENTA,
      movimientos,
      lineasBanco,
      fechaCorte: '2026-08-31',
      saldoBanco,
    })

  it('cuadra cuando todo está conciliado', () => {
    const uno = propio({
      importe: '100000.00',
      estado: 'conciliado',
      conciliacionId: 'emp-1',
    })
    const linea = delBanco({ abono: '100000.00', conciliacionId: 'emp-1' })

    const r = resumen([uno], [linea], '100000.00')
    expect(r.saldoLibros).toBe('100000.00')
    expect(r.diferencia).toBe('0.00')
    expect(r.puedeCerrar).toBe(true)
    expect(r.partidas).toHaveLength(0)
  })

  it('ajusta el saldo del banco por lo que está en tránsito', () => {
    // La ecuación de docs/06 §2.3: un cheque emitido y no cobrado ya bajó los
    // libros y todavía no bajó el banco.
    const cobrado = propio({
      importe: '100000.00',
      estado: 'conciliado',
      conciliacionId: 'emp-1',
    })
    const chequeEnTransito = propio({ importe: '-30000.00' })
    const linea = delBanco({ abono: '100000.00', conciliacionId: 'emp-1' })

    const r = resumen([cobrado, chequeEnTransito], [linea], '100000.00')
    expect(r.saldoLibros).toBe('70000.00')
    expect(r.saldoBancoAjustado).toBe('70000.00')
    expect(r.diferencia).toBe('0.00')
    expect(r.puedeCerrar).toBe(true)
    expect(r.partidas[0]).toMatchObject({
      tipo: 'cheque_transito',
      exigeAccion: false,
    })
  })

  it('no deja cerrar con un cargo del banco sin registrar', () => {
    // Esto no se ajusta: se registra y se contabiliza. Un módulo que dejara
    // "ajustar" esta diferencia ofrecería cuadrar la conciliación sin arreglar
    // el mayor.
    const comisionDesconocida = delBanco({
      cargo: '5650.00',
      abono: '0.00',
      descripcion: 'SERVICIO DE BANCA EN LINEA',
    })

    const r = resumen([], [comisionDesconocida], '-5650.00')
    expect(r.partidas[0]).toMatchObject({
      tipo: 'cargo_no_registrado',
      exigeAccion: true,
    })
    expect(r.puedeCerrar).toBe(false)
    expect(r.impedimentos.join(' ')).toMatch(/sin registrar/)
  })

  it('no deja cerrar sin el saldo del banco', () => {
    const r = resumen([], [], null)
    expect(r.saldoBanco).toBeNull()
    expect(r.diferencia).toBeNull()
    expect(r.puedeCerrar).toBe(false)
    expect(r.impedimentos.join(' ')).toMatch(/saldo del estado de cuenta/)
  })

  it('no deja cerrar con diferencia', () => {
    const uno = propio({
      importe: '100000.00',
      estado: 'conciliado',
      conciliacionId: 'emp-1',
    })
    const linea = delBanco({ abono: '100000.00', conciliacionId: 'emp-1' })

    const r = resumen([uno], [linea], '99000.00')
    expect(r.diferencia).toBe('-1000.00')
    expect(r.puedeCerrar).toBe(false)
  })

  it('no mira más allá de la fecha de corte', () => {
    const dentro = propio({ fecha: '2026-08-05', importe: '100000.00' })
    const fuera = propio({ fecha: '2026-09-10', importe: '500000.00' })

    const r = resumen([dentro, fuera], [], '100000.00')
    expect(r.saldoLibros).toBe('100000.00')
  })
})

describe('Validación del emparejamiento', () => {
  it('exige que los dos lados sumen lo mismo', () => {
    // Un emparejamiento que no cuadra no concilia nada: esconde la diferencia
    // en un sitio donde ya nadie la busca.
    const uno = propio({ importe: '90000.00' })
    const linea = delBanco({ abono: '100000.00' })

    const resultado = validarEmparejamiento(
      'bco-001',
      [uno.id],
      linea.id,
      [uno],
      [linea],
    )
    expect(resultado.valido).toBe(false)
    expect(resultado.errores[0].codigo).toBe('IMPORTES_NO_CUADRAN')
  })

  it('acepta el grupo que suma exacto', () => {
    const uno = propio({ importe: '60000.00' })
    const otro = propio({ importe: '40000.00' })
    const linea = delBanco({ abono: '100000.00' })

    expect(
      validarEmparejamiento(
        'bco-001',
        [uno.id, otro.id],
        linea.id,
        [uno, otro],
        [linea],
      ).valido,
    ).toBe(true)
  })

  it('rechaza lo que ya está conciliado y lo de otra cuenta', () => {
    const conciliado = propio({ estado: 'conciliado' })
    const linea = delBanco()
    expect(
      validarEmparejamiento(
        'bco-001',
        [conciliado.id],
        linea.id,
        [conciliado],
        [linea],
      ).errores.map((e) => e.codigo),
    ).toContain('MOVIMIENTO_YA_CONCILIADO')

    const ajeno = propio({ cuentaBancariaId: 'bco-002' })
    expect(
      validarEmparejamiento(
        'bco-001',
        [ajeno.id],
        linea.id,
        [ajeno],
        [linea],
      ).errores.map((e) => e.codigo),
    ).toContain('CUENTA_DISTINTA')
  })
})

describe('Días entre fechas', () => {
  it('cuenta días de calendario y no importa el orden', () => {
    expect(diasEntre('2026-08-05', '2026-08-05')).toBe(0)
    expect(diasEntre('2026-08-04', '2026-08-05')).toBe(1)
    expect(diasEntre('2026-08-05', '2026-08-04')).toBe(1)
  })
})
