import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { CUENTAS } from '@/mocks/seed/cuentas'
import { PERIODOS } from '@/mocks/seed/periodos'
import { MAPEO_CXP } from '@/mocks/seed/cxp'
import { Money } from '@/shared/money/money'
import type {
  FacturaCompra,
  Proveedor,
  SolicitudPago,
} from '@/shared/api/contracts/cxp'
import type { SolicitudAsiento } from '@/shared/api/contracts/conta'
import {
  armarAsientoPago,
  auxiliarBancoDe,
  calcularPago,
  calcularPropuestaPago,
  cuentasDePago,
  diferenciaCambiariaDe,
  repartirPorAntiguedad,
  type ContextoPago,
} from './pago'

/**
 * El pago es donde el módulo deja de crecer y empieza a saldarse. Lo que estas
 * pruebas vigilan es lo mismo que vigilaría un contador: que lo aplicado no
 * exceda al saldo ni al importe, que la factura de otro proveedor no se pueda
 * tocar, que el sobrante se reconozca como anticipo y que el asiento cuadre
 * incluso cuando el tipo de cambio del pago no es el de la factura.
 */

const FECHA_ABIERTA = '2026-08-20'
/** Julio está cerrado en la semilla de periodos. */
const FECHA_CERRADA = '2026-07-20'
const FUNCIONAL = 'CRC'
const BANCO = '1.1.01.010'
const CAJA = '1.1.01.001'

const PROVEEDOR: Proveedor = {
  id: 'pro-900',
  codigo: 'P-900',
  razonSocial: 'Proveedor de prueba S.A.',
  nombreComercial: null,
  tipoIdentificacion: 'JURIDICA',
  identificacion: '3101000002',
  correo: null,
  telefono: null,
  actividadEconomica: null,
  diasCredito: 30,
  moneda: 'CRC',
  cuentaGasto: null,
  retencionRenta: '0',
  activo: true,
  saldo: '0.00',
  facturasPendientes: 0,
}

function factura(cambios: Partial<FacturaCompra> = {}): FacturaCompra {
  const base: FacturaCompra = {
    id: 'fpr-001',
    folioProveedor: '001',
    folioInterno: 'CXP-000001',
    proveedorId: PROVEEDOR.id,
    proveedorNombre: PROVEEDOR.razonSocial,
    fechaEmision: '2026-08-01',
    fechaVencimiento: '2026-08-31',
    moneda: 'CRC',
    tipoCambio: '1',
    lineas: [],
    subtotal: '100000.00',
    descuentos: '0.00',
    impuesto: '13000.00',
    retencion: '0.00',
    total: '113000.00',
    saldo: '113000.00',
    estado: 'contabilizada',
    asientoId: 'as-1',
    creadoEn: '2026-08-01T10:00:00Z',
    adjuntos: [],
  }
  return { ...base, ...cambios }
}

function contexto(cambios: Partial<ContextoPago> = {}): ContextoPago {
  return {
    proveedor: PROVEEDOR,
    facturas: [factura()],
    cuentas: CUENTAS,
    periodos: PERIODOS,
    mapeo: MAPEO_CXP,
    monedaFuncional: FUNCIONAL,
    ...cambios,
  }
}

function solicitud(cambios: Partial<SolicitudPago> = {}): SolicitudPago {
  return {
    proveedorId: PROVEEDOR.id,
    fecha: FECHA_ABIERTA,
    moneda: 'CRC',
    tipoCambio: '1',
    cuentaSalida: BANCO,
    medioPago: 'transferencia',
    referencia: 'TRF-1',
    importe: '113000.00',
    aplicaciones: [{ facturaId: 'fpr-001', importe: '113000.00' }],
    ...cambios,
  }
}

const codigos = (resultado: { errores: readonly { codigo: string }[] }) =>
  resultado.errores.map((e) => e.codigo)

/** Cargos menos abonos del asiento. Cero es que cuadra. */
function descuadre(asiento: SolicitudAsiento): string {
  return asiento.lineas
    .reduce(
      (acc, l) => acc.plus(new Decimal(l.cargo)).minus(new Decimal(l.abono)),
      new Decimal(0),
    )
    .toFixed(2)
}

describe('validación del pago', () => {
  it('acepta el pago que salda la factura entera', () => {
    const resultado = calcularPago(solicitud(), contexto())

    expect(resultado.valido).toBe(true)
    expect(resultado.aplicado.toApi()).toBe('113000.00')
    expect(resultado.anticipo.toApi()).toBe('0.00')
    expect(resultado.aplicaciones[0].saldoResultante.toApi()).toBe('0.00')
  })

  it('exige un proveedor del catálogo', () => {
    const resultado = calcularPago(
      solicitud(),
      contexto({ proveedor: undefined }),
    )
    expect(codigos(resultado)).toContain('PROVEEDOR_INVALIDO')
  })

  it('rechaza al proveedor inactivo', () => {
    const resultado = calcularPago(
      solicitud(),
      contexto({ proveedor: { ...PROVEEDOR, activo: false } }),
    )
    expect(codigos(resultado)).toContain('PROVEEDOR_INACTIVO')
  })

  it('rechaza el importe cero y el negativo', () => {
    for (const importe of ['0', '-5000']) {
      const resultado = calcularPago(
        solicitud({ importe, aplicaciones: [] }),
        contexto(),
      )
      expect(codigos(resultado)).toContain('IMPORTE_INVALIDO')
    }
  })

  it('rechaza el tipo de cambio que no es mayor que cero', () => {
    const resultado = calcularPago(solicitud({ tipoCambio: '0' }), contexto())
    expect(codigos(resultado)).toContain('TIPO_CAMBIO_INVALIDO')
  })

  it('rechaza la fecha que cae en un periodo que no está abierto', () => {
    const resultado = calcularPago(
      solicitud({ fecha: FECHA_CERRADA }),
      contexto(),
    )
    expect(codigos(resultado)).toContain('PERIODO_CERRADO')
  })

  it('rechaza una cuenta de salida acumulativa o inexistente', () => {
    expect(
      codigos(calcularPago(solicitud({ cuentaSalida: '1.1.01' }), contexto())),
    ).toContain('CUENTA_INVALIDA')
    expect(
      codigos(calcularPago(solicitud({ cuentaSalida: '9.9.99.999' }), contexto())),
    ).toContain('CUENTA_INVALIDA')
  })

  it('no deja saldar la factura de otro proveedor', () => {
    const ajena = factura({ id: 'fpr-002', proveedorId: 'pro-999' })
    const resultado = calcularPago(
      solicitud({ aplicaciones: [{ facturaId: 'fpr-002', importe: '1000' }] }),
      contexto({ facturas: [ajena] }),
    )
    expect(codigos(resultado)).toContain('FACTURA_DE_OTRO_PROVEEDOR')
  })

  it('no deja aplicar a una factura que no existe', () => {
    const resultado = calcularPago(
      solicitud({ aplicaciones: [{ facturaId: 'fpr-x', importe: '1000' }] }),
      contexto(),
    )
    expect(codigos(resultado)).toContain('FACTURA_NO_ENCONTRADA')
  })

  it('no deja aplicar a una factura ya pagada ni a una cancelada', () => {
    const pagada = factura({ estado: 'pagada', saldo: '0.00' })
    expect(
      codigos(
        calcularPago(
          solicitud({
            importe: '1000',
            aplicaciones: [{ facturaId: 'fpr-001', importe: '1000' }],
          }),
          contexto({ facturas: [pagada] }),
        ),
      ),
    ).toContain('FACTURA_SIN_SALDO')

    const cancelada = factura({ estado: 'cancelada' })
    expect(
      codigos(
        calcularPago(
          solicitud({
            importe: '1000',
            aplicaciones: [{ facturaId: 'fpr-001', importe: '1000' }],
          }),
          contexto({ facturas: [cancelada] }),
        ),
      ),
    ).toContain('FACTURA_NO_CONTABILIZADA')
  })

  it('no admite la misma factura dos veces en el mismo pago', () => {
    const resultado = calcularPago(
      solicitud({
        aplicaciones: [
          { facturaId: 'fpr-001', importe: '50000' },
          { facturaId: 'fpr-001', importe: '50000' },
        ],
      }),
      contexto(),
    )
    expect(codigos(resultado)).toContain('FACTURA_REPETIDA')
  })

  it('no deja aplicar más de lo que la factura debe', () => {
    const resultado = calcularPago(
      solicitud({
        importe: '200000.00',
        aplicaciones: [{ facturaId: 'fpr-001', importe: '120000.00' }],
      }),
      contexto(),
    )
    expect(codigos(resultado)).toContain('APLICACION_EXCEDE_SALDO')
  })

  it('no deja que la suma de aplicaciones supere el importe del pago', () => {
    const otra = factura({ id: 'fpr-002', folioProveedor: '002' })
    const resultado = calcularPago(
      solicitud({
        importe: '150000.00',
        aplicaciones: [
          { facturaId: 'fpr-001', importe: '113000.00' },
          { facturaId: 'fpr-002', importe: '113000.00' },
        ],
      }),
      contexto({ facturas: [factura(), otra] }),
    )
    expect(codigos(resultado)).toContain('APLICACION_EXCEDE_IMPORTE')
  })

  it('rechaza aplicar un importe que no es positivo', () => {
    const resultado = calcularPago(
      solicitud({ aplicaciones: [{ facturaId: 'fpr-001', importe: '0' }] }),
      contexto(),
    )
    expect(codigos(resultado)).toContain('APLICACION_INVALIDA')
  })

  /**
   * El criterio de moneda: una factura solo se salda con un pago en su misma
   * moneda. Cruzar monedas exigiría una paridad que nadie capturó, y en la
   * práctica es una compra de divisas, que es otra operación.
   */
  it('rechaza aplicar un pago en otra moneda que la de la factura', () => {
    const enDolares = factura({ moneda: 'USD', tipoCambio: '505.25', saldo: '1000.00' })
    const resultado = calcularPago(
      solicitud({
        importe: '113000.00',
        aplicaciones: [{ facturaId: 'fpr-001', importe: '1000.00' }],
      }),
      contexto({ facturas: [enDolares] }),
    )
    expect(codigos(resultado)).toContain('MONEDA_DISTINTA')
  })
})

describe('anticipo', () => {
  it('lo que sobra del importe queda sin aplicar', () => {
    const resultado = calcularPago(
      solicitud({
        importe: '150000.00',
        aplicaciones: [{ facturaId: 'fpr-001', importe: '113000.00' }],
      }),
      contexto(),
    )

    expect(resultado.valido).toBe(true)
    expect(resultado.anticipo.toApi()).toBe('37000.00')
  })

  it('un pago sin aplicaciones es un anticipo entero, y es válido', () => {
    const resultado = calcularPago(
      solicitud({ importe: '80000.00', aplicaciones: [] }),
      contexto(),
    )

    expect(resultado.valido).toBe(true)
    expect(resultado.aplicado.toApi()).toBe('0.00')
    expect(resultado.anticipo.toApi()).toBe('80000.00')
  })

  it('avisa si sobra dinero y la cuenta de anticipos no admite movimientos', () => {
    const resultado = calcularPago(
      solicitud({ importe: '150000.00' }),
      contexto({ mapeo: { ...MAPEO_CXP, anticipo: '1.1.05' } }),
    )
    expect(codigos(resultado)).toContain('CUENTA_ANTICIPO_INVALIDA')
  })
})

describe('reparto por antigüedad', () => {
  const vieja = factura({
    id: 'fpr-vieja',
    folioInterno: 'CXP-000001',
    fechaVencimiento: '2026-07-10',
    saldo: '50000.00',
  })
  const media = factura({
    id: 'fpr-media',
    folioInterno: 'CXP-000002',
    fechaVencimiento: '2026-08-10',
    saldo: '60000.00',
  })
  const nueva = factura({
    id: 'fpr-nueva',
    folioInterno: 'CXP-000003',
    fechaVencimiento: '2026-09-10',
    saldo: '70000.00',
  })

  it('salda de la más vieja a la más nueva y deja parcial la última', () => {
    const reparto = repartirPorAntiguedad(
      [nueva, vieja, media],
      new Money('90000', 'CRC'),
    )

    expect([...reparto.keys()]).toEqual(['fpr-vieja', 'fpr-media'])
    expect(reparto.get('fpr-vieja')!.toApi()).toBe('50000.00')
    expect(reparto.get('fpr-media')!.toApi()).toBe('40000.00')
  })

  it('no reparte sobre facturas saldadas ni de otra moneda', () => {
    const saldada = factura({ id: 'fpr-s', estado: 'pagada', saldo: '0.00' })
    const dolares = factura({ id: 'fpr-d', moneda: 'USD', saldo: '100.00' })
    const reparto = repartirPorAntiguedad(
      [saldada, dolares, vieja],
      new Money('1000000', 'CRC'),
    )

    expect([...reparto.keys()]).toEqual(['fpr-vieja'])
  })
})

describe('diferencia cambiaria', () => {
  const enDolares = factura({
    moneda: 'USD',
    tipoCambio: '500',
    subtotal: '1000.00',
    impuesto: '0.00',
    total: '1000.00',
    saldo: '1000.00',
  })

  it('pagar más caro que el reconocimiento produce pérdida', () => {
    expect(
      diferenciaCambiariaDe(new Money('1000', 'USD'), '500', '520', FUNCIONAL).toApi(),
    ).toBe('-20000.00')
  })

  it('pagar más barato produce ganancia', () => {
    expect(
      diferenciaCambiariaDe(new Money('1000', 'USD'), '520', '500', FUNCIONAL).toApi(),
    ).toBe('20000.00')
  })

  it('el asiento cuadra con la pérdida cambiaria y la lleva al gasto', () => {
    const pedido = solicitud({
      moneda: 'USD',
      tipoCambio: '520',
      cuentaSalida: '1.1.01.011',
      importe: '1000.00',
      aplicaciones: [{ facturaId: 'fpr-001', importe: '1000.00' }],
    })
    const ctx = contexto({ facturas: [enDolares] })
    const calculo = calcularPago(pedido, ctx)

    expect(calculo.valido).toBe(true)
    expect(calculo.diferenciaCambiaria.toApi()).toBe('-20000.00')

    const asiento = armarAsientoPago('pag-1', 'PAG-000001', pedido, ctx, calculo)

    expect(descuadre(asiento)).toBe('0.00')
    // El pasivo se cancela al tipo de cambio de la factura, el banco sale al
    // del pago, y la diferencia es el gasto por diferencial cambiario.
    expect(asiento.lineas[0]).toMatchObject({
      cuenta: MAPEO_CXP.proveedor,
      cargo: '500000.00',
      auxiliarTipo: 'proveedor',
      auxiliarId: PROVEEDOR.id,
    })
    const perdida = asiento.lineas.find(
      (l) => l.cuenta === MAPEO_CXP.diferencialPerdido,
    )
    expect(perdida?.cargo).toBe('20000.00')
    const salida = asiento.lineas.find((l) => l.cuenta === '1.1.01.011')
    expect(salida?.abono).toBe('520000.00')
  })

  it('el asiento cuadra con la ganancia cambiaria y la lleva al ingreso', () => {
    const pedido = solicitud({
      moneda: 'USD',
      tipoCambio: '480',
      cuentaSalida: '1.1.01.011',
      importe: '1000.00',
      aplicaciones: [{ facturaId: 'fpr-001', importe: '1000.00' }],
    })
    const ctx = contexto({ facturas: [enDolares] })
    const calculo = calcularPago(pedido, ctx)
    const asiento = armarAsientoPago('pag-1', 'PAG-000001', pedido, ctx, calculo)

    expect(descuadre(asiento)).toBe('0.00')
    const ganancia = asiento.lineas.find(
      (l) => l.cuenta === MAPEO_CXP.diferencialGanado,
    )
    expect(ganancia?.abono).toBe('20000.00')
  })
})

describe('asiento del pago', () => {
  it('carga proveedores, abona el banco y no lleva más líneas', () => {
    const pedido = solicitud()
    const ctx = contexto()
    const asiento = armarAsientoPago(
      'pag-1',
      'PAG-000001',
      pedido,
      ctx,
      calcularPago(pedido, ctx),
    )

    expect(asiento.origen).toEqual({
      modulo: 'cxp',
      tipo: 'pago',
      id: 'pag-1',
    })
    expect(asiento.moneda).toBe(FUNCIONAL)
    expect(descuadre(asiento)).toBe('0.00')
    expect(asiento.lineas).toHaveLength(2)
    expect(asiento.lineas[1]).toMatchObject({
      cuenta: BANCO,
      abono: '113000.00',
      auxiliarTipo: 'banco',
      auxiliarId: 'bco-001',
    })
  })

  it('el anticipo entra con el auxiliar del proveedor', () => {
    const pedido = solicitud({ importe: '150000.00' })
    const ctx = contexto()
    const asiento = armarAsientoPago(
      'pag-1',
      'PAG-000001',
      pedido,
      ctx,
      calcularPago(pedido, ctx),
    )

    const anticipo = asiento.lineas.find((l) => l.cuenta === MAPEO_CXP.anticipo)
    expect(anticipo).toMatchObject({
      cargo: '37000.00',
      auxiliarTipo: 'proveedor',
      auxiliarId: PROVEEDOR.id,
    })
    expect(descuadre(asiento)).toBe('0.00')
  })

  it('una línea de proveedores por factura, para poder auditar el auxiliar', () => {
    const otra = factura({
      id: 'fpr-002',
      folioProveedor: '002',
      folioInterno: 'CXP-000002',
      saldo: '50000.00',
    })
    const pedido = solicitud({
      importe: '163000.00',
      aplicaciones: [
        { facturaId: 'fpr-001', importe: '113000.00' },
        { facturaId: 'fpr-002', importe: '50000.00' },
      ],
    })
    const ctx = contexto({ facturas: [factura(), otra] })
    const asiento = armarAsientoPago(
      'pag-1',
      'PAG-000001',
      pedido,
      ctx,
      calcularPago(pedido, ctx),
    )

    const proveedores = asiento.lineas.filter(
      (l) => l.cuenta === MAPEO_CXP.proveedor,
    )
    expect(proveedores).toHaveLength(2)
    expect(proveedores[1].concepto).toContain('002')
    expect(descuadre(asiento)).toBe('0.00')
  })

  it('la caja no lleva auxiliar y las cuentas bancarias sí', () => {
    const pedido = solicitud({ cuentaSalida: CAJA })
    const ctx = contexto()
    const asiento = armarAsientoPago(
      'pag-1',
      'PAG-000001',
      pedido,
      ctx,
      calcularPago(pedido, ctx),
    )

    const salida = asiento.lineas.find((l) => l.cuenta === CAJA)
    expect(salida?.auxiliarTipo).toBeNull()
    expect(auxiliarBancoDe(CAJA, CUENTAS)).toBeNull()
    expect(auxiliarBancoDe('1.1.01.010', CUENTAS)).toBe('bco-001')
    expect(auxiliarBancoDe('1.1.01.011', CUENTAS)).toBe('bco-002')
  })

  it('la referencia del egreso queda en el concepto de la línea de salida', () => {
    const pedido = solicitud({ medioPago: 'cheque', referencia: '004512' })
    const ctx = contexto()
    const asiento = armarAsientoPago(
      'pag-1',
      'PAG-000001',
      pedido,
      ctx,
      calcularPago(pedido, ctx),
    )

    expect(asiento.lineas.at(-1)?.concepto).toBe('Cheque emitido 004512')
  })
})

describe('cuentas de salida', () => {
  it('ofrece caja y las cuentas bancarias, no el resto del activo', () => {
    const codigosCuenta = cuentasDePago(CUENTAS).map((c) => c.codigo)

    expect(codigosCuenta).toContain('1.1.01.001')
    expect(codigosCuenta).toContain('1.1.01.010')
    expect(codigosCuenta).not.toContain('1.1.02.001')
    // Solo cuentas de detalle: la acumulativa no recibe movimientos.
    expect(codigosCuenta).not.toContain('1.1.01')
  })
})

describe('propuesta de pago', () => {
  const facturas = [
    factura({
      id: 'fpr-a',
      folioInterno: 'CXP-000001',
      fechaVencimiento: '2026-08-05',
      saldo: '100000.00',
    }),
    factura({
      id: 'fpr-b',
      folioInterno: 'CXP-000002',
      fechaVencimiento: '2026-08-15',
      saldo: '200000.00',
    }),
    factura({
      id: 'fpr-c',
      folioInterno: 'CXP-000003',
      fechaVencimiento: '2026-09-15',
      saldo: '300000.00',
    }),
  ]

  it('propone de lo más viejo a lo más nuevo hasta agotar el disponible', () => {
    const propuesta = calcularPropuestaPago(
      facturas,
      '2026-08-20',
      '250000',
      FUNCIONAL,
    )

    expect(propuesta.lineas.map((l) => l.facturaId)).toEqual([
      'fpr-a',
      'fpr-b',
      'fpr-c',
    ])
    expect(propuesta.lineas[0].propuesto).toBe('100000.00')
    expect(propuesta.lineas[0].salda).toBe(true)
    // La segunda solo alcanza en parte, y la tercera no entra
    expect(propuesta.lineas[1].propuesto).toBe('150000.00')
    expect(propuesta.lineas[1].salda).toBe(false)
    expect(propuesta.lineas[2].propuesto).toBe('0.00')

    expect(propuesta.totalPendiente).toBe('600000.00')
    expect(propuesta.totalPropuesto).toBe('250000.00')
    expect(propuesta.remanente).toBe('0.00')
    expect(propuesta.sinCubrir).toBe('350000.00')
  })

  it('enseña las facturas que no caben, no solo las que sí', () => {
    const propuesta = calcularPropuestaPago(facturas, '2026-08-20', '0', FUNCIONAL)

    expect(propuesta.lineas).toHaveLength(3)
    expect(propuesta.totalPropuesto).toBe('0.00')
    expect(propuesta.sinCubrir).toBe('600000.00')
  })

  it('cuenta los días vencidos a la fecha de corte', () => {
    const propuesta = calcularPropuestaPago(
      facturas,
      '2026-08-20',
      '1000000',
      FUNCIONAL,
    )

    expect(propuesta.lineas[0].diasVencidos).toBe(15)
    expect(propuesta.lineas[2].diasVencidos).toBeLessThan(0)
    expect(propuesta.remanente).toBe('400000.00')
  })

  it('excluye lo saldado y lo emitido después del corte', () => {
    const posterior = factura({
      id: 'fpr-post',
      fechaEmision: '2026-08-25',
      fechaVencimiento: '2026-09-25',
      saldo: '10000.00',
    })
    const saldada = factura({ id: 'fpr-ok', estado: 'pagada', saldo: '0.00' })

    const propuesta = calcularPropuestaPago(
      [...facturas, posterior, saldada],
      '2026-08-20',
      '1000000',
      FUNCIONAL,
    )

    expect(propuesta.lineas.map((l) => l.facturaId)).toEqual([
      'fpr-a',
      'fpr-b',
      'fpr-c',
    ])
  })

  it('mide el disponible en moneda funcional y propone en la del documento', () => {
    const enDolares = factura({
      id: 'fpr-usd',
      moneda: 'USD',
      tipoCambio: '500',
      saldo: '1000.00',
      fechaVencimiento: '2026-08-01',
    })

    const completa = calcularPropuestaPago(
      [enDolares],
      '2026-08-20',
      '500000',
      FUNCIONAL,
    )
    expect(completa.lineas[0].propuesto).toBe('1000.00')
    expect(completa.lineas[0].propuestoFuncional).toBe('500000.00')
    expect(completa.lineas[0].salda).toBe(true)

    const parcial = calcularPropuestaPago(
      [enDolares],
      '2026-08-20',
      '250000',
      FUNCIONAL,
    )
    expect(parcial.lineas[0].propuesto).toBe('500.00')
    expect(parcial.lineas[0].propuestoFuncional).toBe('250000.00')
    expect(parcial.lineas[0].salda).toBe(false)
  })
})
