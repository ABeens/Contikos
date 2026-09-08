import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { CUENTAS } from '@/mocks/seed/cuentas'
import { PERIODOS } from '@/mocks/seed/periodos'
import { itemsMock, MAPEO_CXC } from '@/mocks/seed/cxc'
import type { Cliente, SolicitudFacturaVenta } from '@/shared/api/contracts/cxc'
import {
  calcularLineas,
  lineasAsientoFactura,
  totalesDe,
  validarFacturaVenta,
  vencimientoDe,
  type ContextoFacturaVenta,
} from './factura'

/**
 * La factura de venta traduce un hecho comercial a partida doble (docs/04
 * §2.1). Lo que se prueba aquí es esa traducción: que el asiento cuadre, que el
 * impuesto salga por línea y que las reglas de negocio rechacen antes de
 * contabilizar.
 */

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
  // Sin datos de facturación electrónica: son opcionales y lo que se prueba
  // aquí es el asiento, no la emisión del comprobante.
  telefono: null,
  ubicacion: null,
  actividadEconomica: null,
  condicionVenta: null,
  medioPago: null,
  saldo: '0.00',
  facturasPendientes: 0,
  listoParaFe: false,
}

function contexto(cliente: Cliente = CLIENTE): ContextoFacturaVenta {
  return {
    cliente,
    cuentas: CUENTAS,
    periodos: PERIODOS,
    mapeo: MAPEO_CXC,
    items: itemsMock,
  }
}

function solicitud(
  cambios: Partial<SolicitudFacturaVenta> = {},
): SolicitudFacturaVenta {
  return {
    clienteId: CLIENTE.id,
    // Agosto de 2026 es el periodo abierto de la semilla.
    fechaEmision: '2026-08-20',
    fechaVencimiento: '2026-09-19',
    moneda: 'CRC',
    tipoCambio: '1',
    lineas: [
      {
        descripcion: 'Consultoría',
        cantidad: '1',
        precioUnitario: '1000000',
        tarifa: 'GENERAL',
      },
    ],
    ...cambios,
  }
}

describe('Totales de la factura', () => {
  it('calcula el IVA por línea y no sobre el total', () => {
    const peticion = solicitud({
      lineas: [
        {
          descripcion: 'Consultoría',
          cantidad: '2',
          precioUnitario: '500000',
          tarifa: 'GENERAL',
        },
        {
          descripcion: 'Consulta médica',
          cantidad: '1',
          precioUnitario: '200000',
          // Tarifa reducida: calcular sobre el total daría un impuesto que no
          // cuadra contra el comprobante electrónico.
          tarifa: 'REDUCIDA_4',
        },
      ],
    })
    const calculadas = calcularLineas(
      peticion.lineas,
      'CRC',
      CLIENTE,
      MAPEO_CXC,
    )
    const totales = totalesDe(peticion.lineas, calculadas, 'CRC')

    expect(totales.subtotal.toApi()).toBe('1200000.00')
    expect(totales.impuesto.toApi()).toBe('138000.00') // 130 000 + 8 000
    expect(totales.total.toApi()).toBe('1338000.00')
  })

  it('resta el descuento antes de calcular el impuesto', () => {
    const peticion = solicitud({
      lineas: [
        {
          descripcion: 'Mercancía',
          cantidad: '10',
          precioUnitario: '10000',
          descuento: '20000',
          tarifa: 'GENERAL',
        },
      ],
    })
    const calculadas = calcularLineas(peticion.lineas, 'CRC', CLIENTE, MAPEO_CXC)
    const totales = totalesDe(peticion.lineas, calculadas, 'CRC')

    expect(totales.subtotal.toApi()).toBe('80000.00')
    expect(totales.impuesto.toApi()).toBe('10400.00')
  })

  it('un servicio exento no genera impuesto', () => {
    const calculadas = calcularLineas(
      [
        {
          descripcion: 'Servicio exento',
          cantidad: '1',
          precioUnitario: '100000',
          tarifa: 'EXENTO',
        },
      ],
      'CRC',
      CLIENTE,
      MAPEO_CXC,
    )
    expect(calculadas[0].impuesto.esCero()).toBe(true)
  })
})

describe('Asiento de la factura', () => {
  it('carga a Clientes por el total y abona ingreso e impuesto', () => {
    const peticion = solicitud()
    const calculadas = calcularLineas(peticion.lineas, 'CRC', CLIENTE, MAPEO_CXC)
    const lineas = lineasAsientoFactura(peticion, contexto(), calculadas)

    expect(lineas).toHaveLength(3)
    expect(lineas[0]).toMatchObject({
      cuenta: MAPEO_CXC.cliente,
      cargo: '1130000.00',
      // La cuenta de clientes es de control: sin auxiliar el mayor deja de
      // poder conciliarse contra la antigüedad de saldos.
      auxiliarTipo: 'cliente',
      auxiliarId: 'cli-900',
    })
    expect(lineas[1]).toMatchObject({
      cuenta: MAPEO_CXC.ingreso,
      abono: '1000000.00',
    })
    expect(lineas[2]).toMatchObject({
      cuenta: MAPEO_CXC.impuestoTrasladado,
      abono: '130000.00',
    })
  })

  it('cuadra: el cargo al cliente iguala la suma de los abonos', () => {
    const peticion = solicitud({
      lineas: [
        {
          descripcion: 'Servicio',
          cantidad: '3',
          precioUnitario: '333333.33',
          tarifa: 'GENERAL',
        },
      ],
    })
    const calculadas = calcularLineas(peticion.lineas, 'CRC', CLIENTE, MAPEO_CXC)
    const lineas = lineasAsientoFactura(peticion, contexto(), calculadas)

    const cargos = lineas.reduce(
      (acc, l) => acc.plus(new Decimal(l.cargo)),
      new Decimal(0),
    )
    const abonos = lineas.reduce(
      (acc, l) => acc.plus(new Decimal(l.abono)),
      new Decimal(0),
    )
    expect(cargos.toFixed(2)).toBe(abonos.toFixed(2))
  })

  it('agrupa los ingresos por cuenta en vez de repetir renglones', () => {
    const peticion = solicitud({
      lineas: [
        {
          descripcion: 'Servicio A',
          cantidad: '1',
          precioUnitario: '100000',
          tarifa: 'GENERAL',
        },
        {
          descripcion: 'Servicio B',
          cantidad: '1',
          precioUnitario: '200000',
          tarifa: 'GENERAL',
        },
        {
          descripcion: 'Mercancía',
          cantidad: '1',
          precioUnitario: '50000',
          tarifa: 'GENERAL',
          cuentaIngreso: '4.1.01.002',
        },
      ],
    })
    const calculadas = calcularLineas(peticion.lineas, 'CRC', CLIENTE, MAPEO_CXC)
    const lineas = lineasAsientoFactura(peticion, contexto(), calculadas)

    // Cliente + dos cuentas de ingreso + impuesto
    expect(lineas).toHaveLength(4)
    expect(lineas[1]).toMatchObject({
      cuenta: '4.1.01.001',
      abono: '300000.00',
    })
    expect(lineas[2]).toMatchObject({ cuenta: '4.1.01.002', abono: '50000.00' })
  })

  it('usa la cuenta de ingreso propia del cliente cuando la tiene', () => {
    const cliente: Cliente = { ...CLIENTE, cuentaIngreso: '4.1.01.002' }
    const peticion = solicitud()
    const calculadas = calcularLineas(peticion.lineas, 'CRC', cliente, MAPEO_CXC)

    expect(calculadas[0].cuentaIngreso).toBe('4.1.01.002')
  })
})

describe('Validación de la factura', () => {
  it('acepta una factura correcta', () => {
    expect(validarFacturaVenta(solicitud(), contexto()).valido).toBe(true)
  })

  it('exige cliente', () => {
    const resultado = validarFacturaVenta(solicitud(), {
      ...contexto(),
      cliente: undefined,
    })
    expect(resultado.errores.map((e) => e.codigo)).toContain('CLIENTE_INVALIDO')
  })

  it('rechaza al cliente inactivo', () => {
    const resultado = validarFacturaVenta(
      solicitud(),
      contexto({ ...CLIENTE, activo: false }),
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('CLIENTE_INACTIVO')
  })

  it('rechaza cuando la venta supera el límite de crédito disponible', () => {
    const cliente: Cliente = {
      ...CLIENTE,
      limiteCredito: '1000000',
      saldo: '500000.00',
    }
    const resultado = validarFacturaVenta(solicitud(), contexto(cliente))
    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'LIMITE_CREDITO_EXCEDIDO',
    )
  })

  it('no bloquea al cliente sin límite declarado', () => {
    const cliente: Cliente = { ...CLIENTE, limiteCredito: '0', saldo: '9000000' }
    expect(validarFacturaVenta(solicitud(), contexto(cliente)).valido).toBe(true)
  })

  it('rechaza la emisión en un periodo que no está abierto', () => {
    const resultado = validarFacturaVenta(
      // Junio de 2026 está bloqueado en la semilla.
      solicitud({ fechaEmision: '2026-06-10', fechaVencimiento: '2026-07-10' }),
      contexto(),
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('PERIODO_CERRADO')
  })

  it('rechaza un vencimiento anterior a la emisión', () => {
    const resultado = validarFacturaVenta(
      solicitud({ fechaVencimiento: '2026-08-01' }),
      contexto(),
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'VENCIMIENTO_INVALIDO',
    )
  })

  it('rechaza una cuenta de ingreso que no admite movimientos', () => {
    const resultado = validarFacturaVenta(
      solicitud({
        lineas: [
          {
            descripcion: 'Servicio',
            cantidad: '1',
            precioUnitario: '1000',
            tarifa: 'GENERAL',
            // Cuenta acumulativa: solo las de detalle reciben movimientos.
            cuentaIngreso: '4.1.01',
          },
        ],
      }),
      contexto(),
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('CUENTA_INVALIDA')
  })

  it('rechaza cantidad cero y total cero', () => {
    const resultado = validarFacturaVenta(
      solicitud({
        lineas: [
          {
            descripcion: 'Servicio',
            cantidad: '0',
            precioUnitario: '1000',
            tarifa: 'GENERAL',
          },
        ],
      }),
      contexto(),
    )
    const codigos = resultado.errores.map((e) => e.codigo)
    expect(codigos).toContain('LINEA_INVALIDA')
    expect(codigos).toContain('TOTAL_INVALIDO')
  })
})

describe('Condiciones de pago', () => {
  it('propone el vencimiento según los días de crédito', () => {
    expect(vencimientoDe('2026-08-20', 30)).toBe('2026-09-19')
  })

  it('con contado vence el mismo día de la emisión', () => {
    expect(vencimientoDe('2026-08-20', 0)).toBe('2026-08-20')
  })
})
