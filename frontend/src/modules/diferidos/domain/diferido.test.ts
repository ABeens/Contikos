import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { PERIODOS } from '@/mocks/seed/periodos'
import { CUENTAS } from '@/mocks/seed/cuentas'
import type {
  Diferido,
  SolicitudDiferido,
} from '@/shared/api/contracts/diferidos'
import type { Cuenta, SolicitudAsiento } from '@/shared/api/contracts/conta'
import {
  armarAsientoCancelacion,
  armarAsientoCorrida,
  calcularCorrida,
  conceptoCorrida,
  cuotaDe,
  cuotaNominal,
  mesDeAmortizacion,
  tablaAmortizacion,
  validarCancelacion,
  validarDiferido,
  validarEdicion,
  MODULO_ORIGEN,
  TIPO_ORIGEN_AMORTIZACION,
  TIPO_ORIGEN_CANCELACION,
  type ContextoCorrida,
} from './diferido'

/**
 * Reglas de los asientos diferidos (docs/15).
 *
 * El caso que manda es el del requerimiento: una póliza anual que se amortiza
 * mes a mes hasta agotar el monto. De ahí salen las dos comprobaciones que más
 * se repiten aquí: que la última cuota cierre el saldo exacto en cero, y que el
 * asiento cargue resultados contra balance en el sentido que le toca según sea
 * un gasto o un ingreso.
 */

const AGOSTO = PERIODOS.find((p) => p.id === 'per-2026-08')!
const SETIEMBRE = PERIODOS.find((p) => p.id === 'per-2026-09')!
const DICIEMBRE = PERIODOS.find((p) => p.id === 'per-2026-12')!
const JULIO = PERIODOS.find((p) => p.id === 'per-2026-07')!

const CONTEXTO: ContextoCorrida = {
  periodos: PERIODOS,
  corridasContabilizadas: new Map(),
  cuentas: CUENTAS,
}

/** Una póliza anual de 1.800.000 con siete cuotas ya corridas. */
function diferido(cambios: Partial<Diferido> = {}): Diferido {
  return {
    id: 'dif-0900',
    codigo: 'DIF-0900',
    tipo: 'gasto',
    descripcion: 'Póliza de prueba',
    tercero: {
      tipo: 'proveedor',
      id: 'pro-014',
      nombre: 'Despacho Contable Arias & Asociados',
    },
    monto: '1800000.00',
    moneda: 'CRC',
    cuentaDiferido: '1.1.05.001',
    cuentaDestino: '6.1.02.003',
    fechaInicio: '2026-01-01',
    plazoMeses: 12,
    cuotaMensual: '150000.00',
    montoAmortizado: '1050000.00',
    saldoPorAmortizar: '750000.00',
    estado: 'vigente',
    cancelacion: null,
    origen: null,
    amortizaciones: [],
    creadoEn: '2026-01-05T09:00:00Z',
    ...cambios,
  }
}

function solicitud(cambios: Partial<SolicitudDiferido> = {}): SolicitudDiferido {
  return {
    tipo: 'gasto',
    descripcion: 'Póliza de seguro anual',
    tercero: {
      tipo: 'proveedor',
      id: 'pro-014',
      nombre: 'Despacho Contable Arias & Asociados',
    },
    monto: '1800000.00',
    moneda: 'CRC',
    cuentaDiferido: '1.1.05.001',
    cuentaDestino: '6.1.02.003',
    fechaInicio: '2026-01-01',
    plazoMeses: 12,
    ...cambios,
  }
}

const CONTEXTO_ALTA = { cuentas: CUENTAS, periodos: PERIODOS }

const codigosDe = (resultado: { errores: readonly { codigo: string }[] }) =>
  resultado.errores.map((e) => e.codigo)

function totales(asiento: SolicitudAsiento) {
  const sumar = (campo: 'cargo' | 'abono') =>
    asiento.lineas
      .reduce((acc, l) => acc.plus(new Decimal(l[campo] || '0')), new Decimal(0))
      .toFixed(2)
  return { cargos: sumar('cargo'), abonos: sumar('abono') }
}

/* --------------------------------------------------------------- Cuotas */

describe('Cuota mensual', () => {
  it('reparte el monto a partes iguales entre los meses del plazo', () => {
    expect(cuotaNominal('1800000.00', 12, 'CRC').toApi()).toBe('150000.00')
  })

  it('devuelve cero con un plazo que no tiene meses', () => {
    expect(cuotaNominal('1800000.00', 0, 'CRC').toApi()).toBe('0.00')
  })

  it('no amortiza más de lo que queda', () => {
    const ficha = diferido({ saldoPorAmortizar: '100000.00' })
    expect(cuotaDe(ficha, 5).toApi()).toBe('100000.00')
  })

  it('devuelve cero cuando ya no queda saldo', () => {
    expect(cuotaDe(diferido({ saldoPorAmortizar: '0.00' }), 5).toApi()).toBe(
      '0.00',
    )
  })

  it('la última cuota se lleva el remanente y cierra el saldo en cero', () => {
    // 1.000 entre 3 son 333,33 y el reparto deja un céntimo suelto: sin la
    // regla de la última cuota, ese céntimo se queda por amortizar para siempre.
    const ficha = diferido({
      monto: '1000.00',
      plazoMeses: 3,
      montoAmortizado: '666.66',
      saldoPorAmortizar: '333.34',
    })
    expect(cuotaDe(ficha, 3).toApi()).toBe('333.34')
  })

  it('cierra el remanente aunque se hubiera saltado un mes', () => {
    // Solo se corrieron dos de las once cuotas anteriores. En el último mes del
    // plazo el diferido se agota igual: nunca sobrevive a su propio plazo.
    const ficha = diferido({
      montoAmortizado: '300000.00',
      saldoPorAmortizar: '1500000.00',
    })
    expect(cuotaDe(ficha, 12).toApi()).toBe('1500000.00')
  })

  it('cuenta el mes de amortización desde la fecha de inicio', () => {
    expect(mesDeAmortizacion('2026-01-01', AGOSTO)).toBe(8)
    expect(mesDeAmortizacion('2026-04-15', AGOSTO)).toBe(5)
    expect(mesDeAmortizacion('2025-12-01', AGOSTO)).toBe(9)
    // El mes de inicio cuenta entero: es la cuota número uno.
    expect(mesDeAmortizacion('2026-08-31', AGOSTO)).toBe(1)
  })
})

describe('Tabla de amortización proyectada', () => {
  it('tiene una fila por mes del plazo y cierra en cero', () => {
    const filas = tablaAmortizacion({
      monto: '1800000.00',
      plazoMeses: 12,
      fechaInicio: '2026-01-01',
      moneda: 'CRC',
    })
    expect(filas).toHaveLength(12)
    expect(filas[0]).toMatchObject({ numero: 1, fecha: '2026-01-31' })
    expect(filas[11]).toMatchObject({ numero: 12, fecha: '2026-12-31' })
    expect(filas.at(-1)!.saldo).toBe('0.00')
    expect(filas.at(-1)!.acumulado).toBe('1800000.00')
  })

  it('la última cuota absorbe el redondeo del reparto', () => {
    const filas = tablaAmortizacion({
      monto: '1000.00',
      plazoMeses: 3,
      fechaInicio: '2026-01-01',
      moneda: 'CRC',
    })
    expect(filas.map((f) => f.cuota)).toEqual(['333.33', '333.33', '333.34'])
    expect(filas.at(-1)!.saldo).toBe('0.00')
  })

  it('las fechas caen al último día de cada mes, incluso en febrero', () => {
    const filas = tablaAmortizacion({
      monto: '300.00',
      plazoMeses: 3,
      fechaInicio: '2026-01-15',
      moneda: 'CRC',
    })
    expect(filas.map((f) => f.fecha)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ])
  })

  it('no proyecta nada con un monto o un plazo imposibles', () => {
    const base = { fechaInicio: '2026-01-01', moneda: 'CRC' }
    expect(tablaAmortizacion({ ...base, monto: '0', plazoMeses: 12 })).toEqual([])
    expect(
      tablaAmortizacion({ ...base, monto: '1000.00', plazoMeses: 0 }),
    ).toEqual([])
  })
})

/* ----------------------------------------------------------- Validación */

describe('Alta de un diferido', () => {
  it('acepta la póliza anual del requerimiento', () => {
    expect(validarDiferido(solicitud(), CONTEXTO_ALTA).valido).toBe(true)
  })

  it('exige descripción, monto positivo y plazo de al menos un mes', () => {
    const resultado = validarDiferido(
      solicitud({ descripcion: '  ', monto: '0', plazoMeses: 0 }),
      CONTEXTO_ALTA,
    )
    expect(codigosDe(resultado)).toEqual(
      expect.arrayContaining([
        'DESCRIPCION_REQUERIDA',
        'MONTO_INVALIDO',
        'PLAZO_INVALIDO',
      ]),
    )
  })

  it('rechaza un monto que no es un número', () => {
    const resultado = validarDiferido(
      solicitud({ monto: 'mil colones' }),
      CONTEXTO_ALTA,
    )
    expect(codigosDe(resultado)).toContain('MONTO_INVALIDO')
  })

  it('rechaza una cuenta que no existe en el catálogo', () => {
    const resultado = validarDiferido(
      solicitud({ cuentaDiferido: '9.9.99.999' }),
      CONTEXTO_ALTA,
    )
    expect(codigosDe(resultado)).toContain('CUENTA_DIFERIDO_INVALIDA')
  })

  it('rechaza una cuenta acumulativa: no admite movimientos', () => {
    const resultado = validarDiferido(
      solicitud({ cuentaDiferido: '1.1.05' }),
      CONTEXTO_ALTA,
    )
    expect(codigosDe(resultado)).toContain('CUENTA_DIFERIDO_INVALIDA')
  })

  it('rechaza una cuenta desactivada', () => {
    const desactivada: Cuenta[] = CUENTAS.map((c) =>
      c.codigo === '6.1.02.003' ? { ...c, activa: false } : c,
    )
    const resultado = validarDiferido(solicitud(), {
      ...CONTEXTO_ALTA,
      cuentas: desactivada,
    })
    expect(codigosDe(resultado)).toContain('CUENTA_DESTINO_INVALIDA')
  })

  it('exige que el gasto diferido descanse en una cuenta de activo', () => {
    const resultado = validarDiferido(
      solicitud({ cuentaDiferido: '2.1.04.001' }),
      CONTEXTO_ALTA,
    )
    expect(codigosDe(resultado)).toContain('CUENTA_DIFERIDO_INVALIDA')
  })

  it('exige que el ingreso diferido descanse en una cuenta de pasivo', () => {
    const bueno = validarDiferido(
      solicitud({
        tipo: 'ingreso',
        cuentaDiferido: '2.1.04.001',
        cuentaDestino: '4.1.01.001',
        tercero: {
          tipo: 'cliente',
          id: 'cli-003',
          nombre: 'Servicios Médicos Escazú S.A.',
        },
      }),
      CONTEXTO_ALTA,
    )
    expect(bueno.valido).toBe(true)

    const malo = validarDiferido(
      solicitud({
        tipo: 'ingreso',
        cuentaDiferido: '1.1.05.001',
        cuentaDestino: '4.1.01.001',
      }),
      CONTEXTO_ALTA,
    )
    expect(codigosDe(malo)).toContain('CUENTA_DIFERIDO_INVALIDA')
  })

  it('un gasto no se reconoce en una cuenta de ingreso, ni al revés', () => {
    expect(
      codigosDe(
        validarDiferido(solicitud({ cuentaDestino: '4.1.01.001' }), CONTEXTO_ALTA),
      ),
    ).toContain('CUENTA_DESTINO_INVALIDA')

    expect(
      codigosDe(
        validarDiferido(
          solicitud({
            tipo: 'ingreso',
            cuentaDiferido: '2.1.04.001',
            cuentaDestino: '6.1.02.003',
            tercero: {
              tipo: 'cliente',
              id: 'cli-003',
              nombre: 'Servicios Médicos Escazú S.A.',
            },
          }),
          CONTEXTO_ALTA,
        ),
      ),
    ).toContain('CUENTA_DESTINO_INVALIDA')
  })

  it('exige el tercero que la cuenta de balance pide como auxiliar', () => {
    const sinTercero = validarDiferido(
      solicitud({ tercero: null }),
      CONTEXTO_ALTA,
    )
    expect(codigosDe(sinTercero)).toContain('AUXILIAR_REQUERIDO')

    const equivocado = validarDiferido(
      solicitud({
        tercero: {
          tipo: 'cliente',
          id: 'cli-003',
          nombre: 'Servicios Médicos Escazú S.A.',
        },
      }),
      CONTEXTO_ALTA,
    )
    expect(codigosDe(equivocado)).toContain('AUXILIAR_REQUERIDO')
  })

  it('exige que la fecha de inicio caiga dentro del calendario contable', () => {
    const resultado = validarDiferido(
      solicitud({ fechaInicio: '2019-01-01' }),
      CONTEXTO_ALTA,
    )
    expect(codigosDe(resultado)).toContain('FECHA_INICIO_INVALIDA')
  })

  it('admite una fecha de inicio en un periodo cerrado: el alta no contabiliza', () => {
    // Julio está cerrado y el alta no genera asiento (docs/15 §3.1): lo que
    // pasó en julio se puede registrar hoy, y lo que se contabiliza es la
    // corrida del periodo abierto.
    expect(
      validarDiferido(solicitud({ fechaInicio: '2026-07-10' }), CONTEXTO_ALTA)
        .valido,
    ).toBe(true)
  })
})

describe('Edición y cancelación', () => {
  it('un diferido sin cuotas contabilizadas se edita', () => {
    expect(validarEdicion(diferido()).valido).toBe(true)
  })

  it('un diferido con cuotas contabilizadas ya no se edita', () => {
    const conCuotas = diferido({
      amortizaciones: [
        {
          periodoId: 'per-2026-07',
          fecha: '2026-07-31',
          cuota: '150000.00',
          asientoId: 'asi-0100',
        },
      ],
    })
    expect(codigosDe(validarEdicion(conCuotas))).toContain(
      'DIFERIDO_CON_AMORTIZACIONES',
    )
  })

  it('un diferido agotado o cancelado tampoco se edita', () => {
    expect(codigosDe(validarEdicion(diferido({ estado: 'agotado' })))).toContain(
      'DIFERIDO_NO_VIGENTE',
    )
  })

  it('solo se cancela lo que sigue vigente y en un periodo que admite asientos', () => {
    expect(validarCancelacion(diferido(), '2026-08-15', PERIODOS).valido).toBe(
      true,
    )
    expect(
      codigosDe(
        validarCancelacion(
          diferido({ estado: 'cancelado' }),
          '2026-08-15',
          PERIODOS,
        ),
      ),
    ).toContain('DIFERIDO_NO_VIGENTE')
    expect(
      codigosDe(validarCancelacion(diferido(), '2026-07-15', PERIODOS)),
    ).toContain('PERIODO_CERRADO')
    expect(
      codigosDe(validarCancelacion(diferido(), '2019-07-15', PERIODOS)),
    ).toContain('PERIODO_CERRADO')
  })

  it('sin saldo remanente no hay asiento, así que el periodo cerrado no estorba', () => {
    const agotado = diferido({
      montoAmortizado: '1800000.00',
      saldoPorAmortizar: '0.00',
    })
    expect(validarCancelacion(agotado, '2026-07-15', PERIODOS).valido).toBe(true)
  })
})

/* ------------------------------------------------------------- Corrida */

describe('Corrida de amortización', () => {
  it('produce una línea por diferido vigente con saldo pendiente', () => {
    const corrida = calcularCorrida([diferido()], AGOSTO, 'CRC', CONTEXTO)
    expect(corrida.lineas).toHaveLength(1)
    expect(corrida.lineas[0]).toMatchObject({
      diferidoId: 'dif-0900',
      cuota: '150000.00',
      saldoInicial: '750000.00',
      montoAmortizadoResultante: '1200000.00',
      saldoResultante: '600000.00',
      ultimaCuota: false,
    })
    expect(corrida.totalGasto).toBe('150000.00')
    expect(corrida.totalIngreso).toBe('0.00')
    expect(corrida.puedeContabilizar).toBe(true)
  })

  it('separa el total de gasto del de ingreso', () => {
    const corrida = calcularCorrida(
      [
        diferido(),
        diferido({
          id: 'dif-0901',
          codigo: 'DIF-0901',
          tipo: 'ingreso',
          cuentaDiferido: '2.1.04.001',
          cuentaDestino: '4.1.01.001',
          tercero: {
            tipo: 'cliente',
            id: 'cli-003',
            nombre: 'Servicios Médicos Escazú S.A.',
          },
          monto: '3600000.00',
          cuotaMensual: '300000.00',
          montoAmortizado: '2100000.00',
          saldoPorAmortizar: '1500000.00',
        }),
      ],
      AGOSTO,
      'CRC',
      CONTEXTO,
    )
    expect(corrida.totalGasto).toBe('150000.00')
    expect(corrida.totalIngreso).toBe('300000.00')
  })

  it('deja fuera el diferido cuya fecha de inicio todavía no llegó', () => {
    const futuro = diferido({ fechaInicio: '2026-11-01' })
    const corrida = calcularCorrida([futuro], AGOSTO, 'CRC', CONTEXTO)
    expect(corrida.lineas).toHaveLength(0)
    expect(codigos(corrida)).toContain('CORRIDA_VACIA')
  })

  it('deja fuera el que no está vigente', () => {
    const corrida = calcularCorrida(
      [diferido({ estado: 'cancelado' })],
      AGOSTO,
      'CRC',
      CONTEXTO,
    )
    expect(corrida.lineas).toHaveLength(0)
  })

  it('avisa y omite el que ya no tiene nada por amortizar', () => {
    const corrida = calcularCorrida(
      [diferido({ saldoPorAmortizar: '0.00', montoAmortizado: '1800000.00' })],
      AGOSTO,
      'CRC',
      CONTEXTO,
    )
    expect(corrida.lineas).toHaveLength(0)
    expect(codigos(corrida)).toContain('CUOTA_CERO')
  })

  it('avisa y omite el que está en otra moneda', () => {
    const corrida = calcularCorrida(
      [diferido({ moneda: 'USD' })],
      AGOSTO,
      'CRC',
      CONTEXTO,
    )
    expect(corrida.lineas).toHaveLength(0)
    expect(codigos(corrida)).toContain('MONEDA_DISTINTA')
  })

  it('avisa cuando el diferido se agota con la cuota del mes', () => {
    // Diciembre es el mes doce del plazo: la cuota cierra el saldo en cero.
    const corrida = calcularCorrida(
      [diferido({ saldoPorAmortizar: '150000.00', montoAmortizado: '1650000.00' })],
      DICIEMBRE,
      'CRC',
      CONTEXTO,
    )
    expect(corrida.lineas[0]).toMatchObject({
      cuota: '150000.00',
      saldoResultante: '0.00',
      ultimaCuota: true,
    })
    expect(codigos(corrida)).toContain('DIFERIDO_SE_AGOTA')
    // Es un aviso: no impide contabilizar.
    expect(corrida.puedeContabilizar).toBe(true)
  })

  it('es un error correr un periodo que no está abierto', () => {
    const corrida = calcularCorrida([diferido()], JULIO, 'CRC', CONTEXTO)
    expect(codigos(corrida)).toContain('PERIODO_NO_ABIERTO')
    expect(corrida.puedeContabilizar).toBe(false)
  })

  it('es un error volver a correr un periodo ya contabilizado, y dice el asiento', () => {
    const corrida = calcularCorrida([diferido()], AGOSTO, 'CRC', {
      ...CONTEXTO,
      corridasContabilizadas: new Map([['per-2026-08', 'asi-0123']]),
    })
    const verificacion = corrida.verificaciones.find(
      (v) => v.codigo === 'CORRIDA_YA_CONTABILIZADA',
    )
    expect(verificacion?.severidad).toBe('error')
    expect(verificacion?.mensaje).toContain('asi-0123')
    expect(corrida.puedeContabilizar).toBe(false)
  })

  it('es un error que la cuenta haya dejado de servir entre el alta y la corrida', () => {
    const desactivada: Cuenta[] = CUENTAS.map((c) =>
      c.codigo === '1.1.05.001' ? { ...c, activa: false } : c,
    )
    const corrida = calcularCorrida([diferido()], AGOSTO, 'CRC', {
      ...CONTEXTO,
      cuentas: desactivada,
    })
    expect(codigos(corrida)).toContain('CUENTA_INVALIDA')
    expect(corrida.puedeContabilizar).toBe(false)
  })

  it('avisa cuando el mes anterior no tiene corrida contabilizada', () => {
    const corrida = calcularCorrida([diferido()], SETIEMBRE, 'CRC', {
      ...CONTEXTO,
      corridasContabilizadas: new Map([['per-2026-06', 'asi-0050']]),
    })
    const verificacion = corrida.verificaciones.find(
      (v) => v.codigo === 'PERIODO_ANTERIOR_SIN_CORRIDA',
    )
    expect(verificacion?.severidad).toBe('aviso')
    expect(verificacion?.mensaje).toContain('Agosto 2026')
  })

  it('se calla sobre el mes anterior cuando no hay ninguna corrida todavía', () => {
    const corrida = calcularCorrida([diferido()], AGOSTO, 'CRC', CONTEXTO)
    expect(codigos(corrida)).not.toContain('PERIODO_ANTERIOR_SIN_CORRIDA')
  })

  it('avisa cuando no hay nada que amortizar en el periodo', () => {
    const corrida = calcularCorrida([], AGOSTO, 'CRC', CONTEXTO)
    expect(codigos(corrida)).toContain('CORRIDA_VACIA')
    expect(corrida.puedeContabilizar).toBe(false)
  })

  it('nombra la corrida por su periodo', () => {
    expect(conceptoCorrida(AGOSTO)).toBe('Amortización de diferidos agosto 2026')
  })
})

/* ------------------------------------------------------------- Asiento */

describe('Asiento de la corrida', () => {
  it('carga resultados y abona el balance cuando es un gasto', () => {
    const fichas = [diferido()]
    const corrida = calcularCorrida(fichas, AGOSTO, 'CRC', CONTEXTO)
    const asiento = armarAsientoCorrida(corrida, fichas, AGOSTO, 'CRC')

    expect(asiento.lineas).toHaveLength(2)
    expect(asiento.lineas[0]).toMatchObject({
      cuenta: '6.1.02.003',
      cargo: '150000.00',
      abono: '0',
    })
    expect(asiento.lineas[1]).toMatchObject({
      cuenta: '1.1.05.001',
      cargo: '0',
      abono: '150000.00',
      auxiliarTipo: 'proveedor',
      auxiliarId: 'pro-014',
    })
    expect(totales(asiento)).toEqual({
      cargos: '150000.00',
      abonos: '150000.00',
    })
  })

  it('carga el balance y abona resultados cuando es un ingreso', () => {
    const fichas = [
      diferido({
        tipo: 'ingreso',
        cuentaDiferido: '2.1.04.001',
        cuentaDestino: '4.1.01.001',
        tercero: {
          tipo: 'cliente',
          id: 'cli-003',
          nombre: 'Servicios Médicos Escazú S.A.',
        },
      }),
    ]
    const corrida = calcularCorrida(fichas, AGOSTO, 'CRC', CONTEXTO)
    const asiento = armarAsientoCorrida(corrida, fichas, AGOSTO, 'CRC')

    expect(asiento.lineas[0]).toMatchObject({
      cuenta: '2.1.04.001',
      cargo: '150000.00',
      auxiliarTipo: 'cliente',
    })
    expect(asiento.lineas[1]).toMatchObject({
      cuenta: '4.1.01.001',
      abono: '150000.00',
    })
    expect(totales(asiento)).toEqual({
      cargos: '150000.00',
      abonos: '150000.00',
    })
  })

  it('agrupa el renglón de resultados cuando dos diferidos comparten el par de cuentas', () => {
    const fichas = [
      diferido(),
      diferido({ id: 'dif-0901', codigo: 'DIF-0901', descripcion: 'Otra póliza' }),
    ]
    const corrida = calcularCorrida(fichas, AGOSTO, 'CRC', CONTEXTO)
    const asiento = armarAsientoCorrida(corrida, fichas, AGOSTO, 'CRC')

    // Un cargo agrupado y dos abonos: el auxiliar vive en el lado de balance,
    // que por eso nunca se agrupa.
    expect(asiento.lineas).toHaveLength(3)
    expect(asiento.lineas[0]).toMatchObject({
      cuenta: '6.1.02.003',
      cargo: '300000.00',
    })
    expect(asiento.lineas.filter((l) => l.cuenta === '1.1.05.001')).toHaveLength(2)
    expect(totales(asiento)).toEqual({
      cargos: '300000.00',
      abonos: '300000.00',
    })
  })

  it('se fecha al cierre del periodo y firma su terna de origen', () => {
    const fichas = [diferido()]
    const corrida = calcularCorrida(fichas, AGOSTO, 'CRC', CONTEXTO)
    const asiento = armarAsientoCorrida(corrida, fichas, AGOSTO, 'CRC')

    expect(asiento.fecha).toBe('2026-08-31')
    expect(asiento.origen).toEqual({
      modulo: MODULO_ORIGEN,
      tipo: TIPO_ORIGEN_AMORTIZACION,
      id: 'per-2026-08',
    })
  })

  it('toma la descripción de la ficha vigente, no la que copió la corrida', () => {
    const fichas = [diferido()]
    const corrida = calcularCorrida(fichas, AGOSTO, 'CRC', CONTEXTO)
    const renombrada = [diferido({ descripcion: 'Póliza renegociada' })]
    const asiento = armarAsientoCorrida(corrida, renombrada, AGOSTO, 'CRC')

    expect(asiento.lineas[1].concepto).toBe('DIF-0900 Póliza renegociada')
  })
})

describe('Asiento de la cancelación', () => {
  it('reconoce de golpe el saldo remanente de un gasto diferido', () => {
    const asiento = armarAsientoCancelacion(diferido(), '2026-08-20', 'CRC')

    expect(asiento.fecha).toBe('2026-08-20')
    expect(asiento.lineas[0]).toMatchObject({
      cuenta: '6.1.02.003',
      cargo: '750000.00',
    })
    expect(asiento.lineas[1]).toMatchObject({
      cuenta: '1.1.05.001',
      abono: '750000.00',
      auxiliarTipo: 'proveedor',
    })
    expect(asiento.origen).toEqual({
      modulo: MODULO_ORIGEN,
      tipo: TIPO_ORIGEN_CANCELACION,
      id: 'dif-0900',
    })
  })

  it('extingue el pasivo contra el ingreso cuando el diferido era un cobro', () => {
    const asiento = armarAsientoCancelacion(
      diferido({
        tipo: 'ingreso',
        cuentaDiferido: '2.1.04.001',
        cuentaDestino: '4.1.01.001',
      }),
      '2026-08-20',
      'CRC',
    )
    expect(asiento.lineas[0]).toMatchObject({
      cuenta: '2.1.04.001',
      cargo: '750000.00',
    })
    expect(asiento.lineas[1]).toMatchObject({
      cuenta: '4.1.01.001',
      abono: '750000.00',
    })
  })
})

function codigos(corrida: { verificaciones: { codigo: string }[] }) {
  return corrida.verificaciones.map((v) => v.codigo)
}
