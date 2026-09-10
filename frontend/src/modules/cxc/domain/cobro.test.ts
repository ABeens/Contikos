import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { CUENTAS } from '@/mocks/seed/cuentas'
import { PERIODOS } from '@/mocks/seed/periodos'
import { MAPEO_CXC } from '@/mocks/seed/cxc'
import { cuentasBancariasMock } from '@/mocks/seed/bancos'
import type {
  Cliente,
  FacturaVenta,
  SolicitudCobro,
} from '@/shared/api/contracts/cxc'
import {
  armarAsientoCobro,
  facturasCobrables,
  repartirPorAntiguedad,
  validarCobro,
  type ContextoCobro,
} from './cobro'

/**
 * El cobro traduce una entrada de efectivo a partida doble (docs/04 §2.2). Lo
 * que se prueba aquí es esa traducción: que el reparto no exceda ningún saldo,
 * que la diferencia cambiaria aparezca cuando el tipo de cambio del cobro no es
 * el de la factura, y que el asiento cuadre siempre.
 */

/** Agosto de 2026 está abierto en la semilla de periodos. */
const FECHA_ABIERTA = '2026-08-20'
/** Julio está cerrado: es la fecha con la que se prueba PERIODO_CERRADO. */
const FECHA_CERRADA = '2026-07-20'

const CLIENTE: Cliente = {
  id: 'cli-900',
  codigo: 'C-900',
  razonSocial: 'Cliente de prueba S.A.',
  nombreComercial: null,
  tipoIdentificacion: 'JURIDICA',
  identificacion: '3101000001',
  correo: null,
  diasCredito: 30,
  limiteCredito: '0',
  moneda: 'CRC',
  cuentaIngreso: null,
  activo: true,
  telefono: null,
  ubicacion: null,
  actividadEconomica: null,
  condicionVenta: null,
  medioPago: null,
  saldo: '0.00',
  facturasPendientes: 0,
  listoParaFe: false,
}

function factura(cambios: Partial<FacturaVenta> = {}): FacturaVenta {
  const total = cambios.total ?? '100000.00'
  return {
    id: 'fac-900',
    numeroInterno: 'FV-000900',
    consecutivo: '00100001010000000900',
    claveNumerica: null,
    clienteId: CLIENTE.id,
    clienteNombre: CLIENTE.razonSocial,
    fechaEmision: '2026-07-01',
    fechaVencimiento: '2026-07-31',
    moneda: 'CRC',
    tipoCambio: '1.00',
    lineas: [
      {
        id: 'fac-900-l1',
        itemId: null,
        itemCodigo: null,
        descripcion: 'Servicio',
        cantidad: '1',
        precioUnitario: total,
        descuento: '0.00',
        tarifa: 'CERO',
        cuentaIngreso: '4.1.01.001',
        base: total,
        impuesto: '0.00',
        total,
      },
    ],
    subtotal: total,
    descuentos: '0.00',
    impuesto: '0.00',
    total,
    saldo: total,
    estado: 'contabilizada',
    asientoId: 'asi-2026-000001',
    creadoEn: '2026-07-01T10:00:00Z',
    ...cambios,
  }
}

/** Las fichas con sus derivados en cero: la validación solo mira el mapeo. */
const CUENTAS_BANCARIAS = cuentasBancariasMock.map((c) => ({
  ...c,
  cuentaContableNombre: c.cuentaContable,
  saldoLibros: '0.00',
  movimientos: 0,
  movimientosSinConciliar: 0,
}))

function contexto(
  facturas: readonly FacturaVenta[],
  cliente: Cliente | undefined = CLIENTE,
): ContextoCobro {
  return {
    cliente,
    facturas,
    cuentas: CUENTAS,
    // El catálogo de bancos de la demo: de él sale el auxiliar de la cuenta de
    // depósito, que antes se tecleaba a mano (docs/06 §1).
    cuentasBancarias: CUENTAS_BANCARIAS,
    periodos: PERIODOS,
    mapeo: MAPEO_CXC,
    funcional: 'CRC',
  }
}

function solicitud(cambios: Partial<SolicitudCobro> = {}): SolicitudCobro {
  return {
    clienteId: CLIENTE.id,
    fecha: FECHA_ABIERTA,
    moneda: 'CRC',
    tipoCambio: '1',
    medio: '04',
    referencia: 'TRF-1',
    // Caja general: no es cuenta de control y no exige auxiliar, así que
    // mantiene las pruebas centradas en el reparto y no en el auxiliar.
    cuentaDeposito: '1.1.01.001',
    auxiliarBanco: null,
    importeRecibido: '100000.00',
    aplicaciones: [{ facturaId: 'fac-900', importeAplicado: '100000.00' }],
    ...cambios,
  }
}

/** Cargos menos abonos de la solicitud de asiento. Cero = cuadra. */
function descuadre(lineas: readonly { cargo: string; abono: string }[]): string {
  return lineas
    .reduce(
      (acc, l) => acc.plus(new Decimal(l.cargo)).minus(new Decimal(l.abono)),
      new Decimal(0),
    )
    .toFixed(2)
}

describe('Cobro: validación', () => {
  it('acepta el cobro que salda una factura entera', () => {
    const resultado = validarCobro(solicitud(), contexto([factura()]))

    expect(resultado.valido).toBe(true)
    expect(resultado.errores).toEqual([])
    expect(resultado.importeAplicado.toApi()).toBe('100000.00')
    expect(resultado.importeSinAplicar.toApi()).toBe('0.00')
    expect(resultado.aplicaciones[0].saldoResultante.toApi()).toBe('0.00')
    expect(resultado.diferenciaCambiaria.esCero()).toBe(true)
  })

  it('deja parcial la factura cuando se aplica menos que su saldo', () => {
    const resultado = validarCobro(
      solicitud({
        importeRecibido: '40000.00',
        aplicaciones: [{ facturaId: 'fac-900', importeAplicado: '40000.00' }],
      }),
      contexto([factura()]),
    )

    expect(resultado.valido).toBe(true)
    expect(resultado.aplicaciones[0].saldoResultante.toApi()).toBe('60000.00')
  })

  it('lo recibido de más queda como anticipo, no se rechaza', () => {
    const resultado = validarCobro(
      solicitud({ importeRecibido: '150000.00' }),
      contexto([factura()]),
    )

    expect(resultado.valido).toBe(true)
    expect(resultado.importeSinAplicar.toApi()).toBe('50000.00')
    expect(resultado.anticipo.toApi()).toBe('50000.00')
  })

  it('admite el cobro sin ninguna aplicación: es un anticipo entero', () => {
    const resultado = validarCobro(
      solicitud({ aplicaciones: [] }),
      contexto([factura()]),
    )

    expect(resultado.valido).toBe(true)
    expect(resultado.abonoClientes.esCero()).toBe(true)
    expect(resultado.importeSinAplicar.toApi()).toBe('100000.00')
  })

  it('rechaza aplicar a una factura más de lo que debe', () => {
    const resultado = validarCobro(
      solicitud({
        importeRecibido: '150000.00',
        aplicaciones: [{ facturaId: 'fac-900', importeAplicado: '150000.00' }],
      }),
      contexto([factura()]),
    )

    expect(resultado.valido).toBe(false)
    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'APLICACION_EXCEDE_SALDO',
    )
  })

  it('rechaza aplicar más de lo que se recibió', () => {
    const resultado = validarCobro(
      solicitud({
        importeRecibido: '50000.00',
        aplicaciones: [{ facturaId: 'fac-900', importeAplicado: '100000.00' }],
      }),
      contexto([factura()]),
    )

    expect(resultado.valido).toBe(false)
    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'APLICACIONES_EXCEDEN_RECIBIDO',
    )
  })

  it('rechaza el importe recibido en cero', () => {
    const resultado = validarCobro(
      solicitud({ importeRecibido: '0', aplicaciones: [] }),
      contexto([factura()]),
    )

    expect(resultado.errores.map((e) => e.codigo)).toContain('IMPORTE_INVALIDO')
  })

  it('rechaza la factura de otro cliente', () => {
    const ajena = factura({ clienteId: 'cli-999', clienteNombre: 'Otro S.A.' })
    const resultado = validarCobro(solicitud(), contexto([ajena]))

    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'FACTURA_DE_OTRO_CLIENTE',
    )
  })

  it('rechaza la factura ya pagada y la que no tiene saldo', () => {
    const saldada = factura({ estado: 'pagada', saldo: '0.00' })
    const resultado = validarCobro(solicitud(), contexto([saldada]))

    const codigos = resultado.errores.map((e) => e.codigo)
    expect(codigos).toContain('FACTURA_NO_COBRABLE')
  })

  it('rechaza la misma factura dos veces en el mismo cobro', () => {
    const resultado = validarCobro(
      solicitud({
        aplicaciones: [
          { facturaId: 'fac-900', importeAplicado: '50000.00' },
          { facturaId: 'fac-900', importeAplicado: '50000.00' },
        ],
      }),
      contexto([factura()]),
    )

    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'FACTURA_DUPLICADA',
    )
  })

  it('rechaza aplicar un cobro en colones a una factura en dólares', () => {
    // La regla que se toma: un cobro se aplica a facturas de SU misma moneda.
    // Convertir el abono exigiría elegir un tipo de cambio de aplicación, y
    // esa decisión no la puede tomar el sistema.
    const enDolares = factura({
      moneda: 'USD',
      tipoCambio: '505.25',
      total: '1000.00',
      saldo: '1000.00',
    })
    const resultado = validarCobro(
      solicitud({
        aplicaciones: [{ facturaId: 'fac-900', importeAplicado: '1000.00' }],
      }),
      contexto([enDolares]),
    )

    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'MONEDA_INCOMPATIBLE',
    )
  })

  it('rechaza el periodo cerrado y el cliente inactivo', () => {
    const inactivo = { ...CLIENTE, activo: false }
    const resultado = validarCobro(
      solicitud({ fecha: FECHA_CERRADA }),
      contexto([factura()], inactivo),
    )

    const codigos = resultado.errores.map((e) => e.codigo)
    expect(codigos).toContain('PERIODO_CERRADO')
    expect(codigos).toContain('CLIENTE_INACTIVO')
  })

  it('exige el auxiliar de la cuenta bancaria mientras no exista bancos', () => {
    const resultado = validarCobro(
      solicitud({ cuentaDeposito: '1.1.01.010', auxiliarBanco: null }),
      contexto([factura()]),
    )

    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'AUXILIAR_BANCO_REQUERIDO',
    )
  })

  it('rechaza la cuenta de depósito que no admite movimientos', () => {
    // 1.1.01 es acumulativa: agrupa las de efectivo y no recibe asientos.
    const resultado = validarCobro(
      solicitud({ cuentaDeposito: '1.1.01' }),
      contexto([factura()]),
    )

    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'CUENTA_DEPOSITO_INVALIDA',
    )
  })
})

describe('Cobro: diferencia cambiaria', () => {
  const enDolares = () =>
    factura({
      moneda: 'USD',
      tipoCambio: '500.00',
      total: '1000.00',
      saldo: '1000.00',
    })

  const cobroEnDolares = (tipoCambio: string) =>
    solicitud({
      moneda: 'USD',
      tipoCambio,
      importeRecibido: '1000.00',
      aplicaciones: [{ facturaId: 'fac-900', importeAplicado: '1000.00' }],
    })

  it('reconoce ganancia cuando se cobra por encima del tipo de la factura', () => {
    const resultado = validarCobro(
      cobroEnDolares('520.00'),
      contexto([enDolares()]),
    )

    expect(resultado.valido).toBe(true)
    // Al banco entran 520 000; a Clientes se abonan los 500 000 con los que la
    // factura entró al mayor. Los 20 000 de más son la ganancia cambiaria.
    expect(resultado.deposito.toApi()).toBe('520000.00')
    expect(resultado.abonoClientes.toApi()).toBe('500000.00')
    expect(resultado.diferenciaCambiaria.toApi()).toBe('20000.00')
    expect(resultado.aplicaciones[0].diferenciaCambiaria.toApi()).toBe(
      '20000.00',
    )
  })

  it('reconoce pérdida cuando se cobra por debajo, y el asiento cuadra', () => {
    const resultado = validarCobro(
      cobroEnDolares('480.00'),
      contexto([enDolares()]),
    )

    expect(resultado.diferenciaCambiaria.toApi()).toBe('-20000.00')

    const asiento = armarAsientoCobro(
      'cob-900',
      'COB-000900',
      cobroEnDolares('480.00'),
      contexto([enDolares()]),
      resultado,
    )
    // La pérdida va por CARGO: es un gasto, no un abono negativo.
    const perdida = asiento.lineas.find(
      (l) => l.cuenta === MAPEO_CXC.diferenciaCambiariaPerdida,
    )
    expect(perdida?.cargo).toBe('20000.00')
    expect(descuadre(asiento.lineas)).toBe('0.00')
  })
})

describe('Cobro: asiento', () => {
  it('carga el depósito y abona clientes con el auxiliar del cliente', () => {
    const ctx = contexto([factura()])
    const sol = solicitud()
    const asiento = armarAsientoCobro(
      'cob-900',
      'COB-000900',
      sol,
      ctx,
      validarCobro(sol, ctx),
    )

    expect(asiento.origen).toEqual({
      modulo: 'cxc',
      tipo: 'cobro',
      id: 'cob-900',
    })
    expect(asiento.lineas).toHaveLength(2)
    expect(asiento.lineas[0]).toMatchObject({
      cuenta: '1.1.01.001',
      cargo: '100000.00',
    })
    expect(asiento.lineas[1]).toMatchObject({
      cuenta: MAPEO_CXC.cliente,
      abono: '100000.00',
      auxiliarTipo: 'cliente',
      auxiliarId: CLIENTE.id,
    })
    expect(descuadre(asiento.lineas)).toBe('0.00')
  })

  it('lleva el auxiliar de banco cuando la cuenta de depósito lo exige', () => {
    const ctx = contexto([factura()])
    const sol = solicitud({
      cuentaDeposito: '1.1.01.010',
      auxiliarBanco: 'bco-001',
    })
    const asiento = armarAsientoCobro(
      'cob-900',
      'COB-000900',
      sol,
      ctx,
      validarCobro(sol, ctx),
    )

    expect(asiento.lineas[0]).toMatchObject({
      cuenta: '1.1.01.010',
      auxiliarTipo: 'banco',
      auxiliarId: 'bco-001',
    })
  })

  it('abre línea de anticipo por lo que no se aplicó, con su auxiliar', () => {
    const ctx = contexto([factura()])
    const sol = solicitud({ importeRecibido: '150000.00' })
    const asiento = armarAsientoCobro(
      'cob-900',
      'COB-000900',
      sol,
      ctx,
      validarCobro(sol, ctx),
    )

    const anticipo = asiento.lineas.find(
      (l) => l.cuenta === MAPEO_CXC.anticipo,
    )
    expect(anticipo).toMatchObject({
      abono: '50000.00',
      auxiliarTipo: 'cliente',
      auxiliarId: CLIENTE.id,
    })
    expect(descuadre(asiento.lineas)).toBe('0.00')
  })

  it('se contabiliza en moneda funcional aunque el cobro sea en otra', () => {
    // Es la única moneda en la que la diferencia cambiaria puede cuadrar: en
    // dólares, banco y clientes serían el mismo número.
    const enDolares = factura({
      moneda: 'USD',
      tipoCambio: '500.00',
      total: '1000.00',
      saldo: '1000.00',
    })
    const ctx = contexto([enDolares])
    const sol = solicitud({
      moneda: 'USD',
      tipoCambio: '520.00',
      importeRecibido: '1000.00',
      aplicaciones: [{ facturaId: 'fac-900', importeAplicado: '1000.00' }],
    })
    const asiento = armarAsientoCobro(
      'cob-900',
      'COB-000900',
      sol,
      ctx,
      validarCobro(sol, ctx),
    )

    expect(asiento.moneda).toBe('CRC')
    expect(asiento.tipoCambio).toBe('1')
    expect(descuadre(asiento.lineas)).toBe('0.00')
  })
})

describe('Cobro: reparto por antigüedad', () => {
  const vieja = factura({
    id: 'fac-901',
    numeroInterno: 'FV-000901',
    fechaVencimiento: '2026-06-30',
    total: '60000.00',
    saldo: '60000.00',
  })
  const nueva = factura({
    id: 'fac-902',
    numeroInterno: 'FV-000902',
    fechaVencimiento: '2026-08-31',
    total: '80000.00',
    saldo: '80000.00',
  })

  it('paga primero lo más vencido y deja el resto en la siguiente', () => {
    const reparto = repartirPorAntiguedad('100000', [nueva, vieja], 'CRC')

    expect(reparto).toEqual([
      { facturaId: 'fac-901', importeAplicado: '60000.00' },
      { facturaId: 'fac-902', importeAplicado: '40000.00' },
    ])
  })

  it('no reparte más de lo que hay ni toca facturas de otra moneda', () => {
    const enDolares = factura({
      id: 'fac-903',
      moneda: 'USD',
      tipoCambio: '505.25',
      fechaVencimiento: '2026-05-31',
      total: '100.00',
      saldo: '100.00',
    })
    const reparto = repartirPorAntiguedad(
      '50000',
      [enDolares, vieja, nueva],
      'CRC',
    )

    expect(reparto).toEqual([
      { facturaId: 'fac-901', importeAplicado: '50000.00' },
    ])
  })

  it('lo repartido nunca excede el saldo de ninguna factura', () => {
    const reparto = repartirPorAntiguedad('999999', [vieja, nueva], 'CRC')
    const sol = solicitud({
      importeRecibido: '999999',
      aplicaciones: reparto,
    })
    const resultado = validarCobro(sol, contexto([vieja, nueva]))

    expect(resultado.valido).toBe(true)
    expect(resultado.importeAplicado.toApi()).toBe('140000.00')
    expect(resultado.importeSinAplicar.toApi()).toBe('859999.00')
  })
})

describe('Cobro: facturas cobrables', () => {
  it('solo las contabilizadas con saldo, de la más vieja a la más nueva', () => {
    const pagada = factura({ id: 'fac-910', estado: 'pagada', saldo: '0.00' })
    const cancelada = factura({ id: 'fac-911', estado: 'cancelada' })
    const vieja = factura({
      id: 'fac-912',
      fechaVencimiento: '2026-05-31',
    })
    const nueva = factura({
      id: 'fac-913',
      fechaVencimiento: '2026-09-30',
    })

    const cobrables = facturasCobrables(
      [pagada, nueva, cancelada, vieja],
      CLIENTE.id,
    )

    expect(cobrables.map((f) => f.id)).toEqual(['fac-912', 'fac-913'])
  })
})
