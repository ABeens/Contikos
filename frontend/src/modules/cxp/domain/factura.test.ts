import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { CUENTAS } from '@/mocks/seed/cuentas'
import { PERIODOS } from '@/mocks/seed/periodos'
import { MAPEO_CXP } from '@/mocks/seed/cxp'
import { categoriasMock } from '@/mocks/seed/activos'
import type { CategoriaActivo } from '@/shared/api/contracts/activos'
import type {
  Proveedor,
  SolicitudFacturaCompra,
} from '@/shared/api/contracts/cxp'
import {
  calcularLineasCompra,
  claveFolio,
  lineasAsientoFacturaCompra,
  totalesCompraDe,
  validarFacturaCompra,
  type ContextoFacturaCompra,
} from './factura'

/**
 * La factura de proveedor es el espejo de la de venta, con dos diferencias que
 * cambian el asiento: el impuesto es acreditable y la retención se le descuenta
 * al proveedor. La tercera diferencia, capitalizar una línea, es la que enlaza
 * este módulo con activos fijos.
 */

const CATEGORIAS: CategoriaActivo[] = categoriasMock.map((c) => ({
  ...c,
  activos: 0,
}))

const PROVEEDOR: Proveedor = {
  id: 'pro-900',
  codigo: 'P-900',
  razonSocial: 'Proveedor de prueba S.A.',
  nombreComercial: null,
  tipoIdentificacion: 'JURIDICA',
  identificacion: '3101000002',
  correo: null,
  // Opcionales: el buzón de comprobantes recibidos los pide, el asiento no.
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

function contexto(
  cambios: Partial<ContextoFacturaCompra> = {},
): ContextoFacturaCompra {
  return {
    proveedor: PROVEEDOR,
    cuentas: CUENTAS,
    periodos: PERIODOS,
    categorias: CATEGORIAS,
    mapeo: MAPEO_CXP,
    foliosRegistrados: [],
    ...cambios,
  }
}

function solicitud(
  cambios: Partial<SolicitudFacturaCompra> = {},
): SolicitudFacturaCompra {
  return {
    proveedorId: PROVEEDOR.id,
    folioProveedor: '12345',
    fechaEmision: '2026-08-20',
    fechaVencimiento: '2026-09-19',
    moneda: 'CRC',
    tipoCambio: '1',
    lineas: [
      {
        descripcion: 'Servicios profesionales',
        cantidad: '1',
        precioUnitario: '1000000',
        tarifa: 'GENERAL',
        cuenta: '6.1.02.003',
      },
    ],
    ...cambios,
  }
}

describe('Totales de la compra', () => {
  it('sin retención, lo facturado es lo que se debe', () => {
    const peticion = solicitud()
    const calculadas = calcularLineasCompra(
      peticion.lineas,
      'CRC',
      PROVEEDOR,
      MAPEO_CXP,
    )
    const totales = totalesCompraDe(
      peticion.lineas,
      calculadas,
      'CRC',
      PROVEEDOR,
    )

    expect(totales.impuesto.toApi()).toBe('130000.00')
    expect(totales.total.toApi()).toBe('1130000.00')
    expect(totales.porPagar.toApi()).toBe('1130000.00')
  })

  it('la retención se calcula sobre el subtotal, no sobre el total', () => {
    const proveedor: Proveedor = { ...PROVEEDOR, retencionRenta: '2' }
    const peticion = solicitud()
    const calculadas = calcularLineasCompra(
      peticion.lineas,
      'CRC',
      proveedor,
      MAPEO_CXP,
    )
    const totales = totalesCompraDe(peticion.lineas, calculadas, 'CRC', proveedor)

    // 2% de 1 000 000, no de 1 130 000: el IVA no forma parte de la base.
    expect(totales.retencion.toApi()).toBe('20000.00')
    expect(totales.total.toApi()).toBe('1130000.00')
    expect(totales.porPagar.toApi()).toBe('1110000.00')
  })
})

describe('Asiento de la compra', () => {
  it('carga gasto e IVA acreditable y abona al proveedor', () => {
    const peticion = solicitud()
    const calculadas = calcularLineasCompra(
      peticion.lineas,
      'CRC',
      PROVEEDOR,
      MAPEO_CXP,
    )
    const lineas = lineasAsientoFacturaCompra(peticion, contexto(), calculadas)

    expect(lineas[0]).toMatchObject({ cuenta: '6.1.02.003', cargo: '1000000.00' })
    expect(lineas[1]).toMatchObject({
      cuenta: MAPEO_CXP.impuestoAcreditable,
      cargo: '130000.00',
    })
    expect(lineas.at(-1)).toMatchObject({
      cuenta: MAPEO_CXP.proveedor,
      abono: '1130000.00',
      auxiliarTipo: 'proveedor',
      auxiliarId: 'pro-900',
    })
  })

  it('con retención, el proveedor recibe menos y el resto queda por enterar', () => {
    const proveedor: Proveedor = { ...PROVEEDOR, retencionRenta: '2' }
    const peticion = solicitud()
    const calculadas = calcularLineasCompra(
      peticion.lineas,
      'CRC',
      proveedor,
      MAPEO_CXP,
    )
    const lineas = lineasAsientoFacturaCompra(
      peticion,
      contexto({ proveedor }),
      calculadas,
    )

    const retencion = lineas.find((l) => l.cuenta === MAPEO_CXP.retencion)
    expect(retencion?.abono).toBe('20000.00')
    expect(lineas.at(-1)?.abono).toBe('1110000.00')

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

  it('la línea capitalizada lleva el auxiliar del activo y no se agrupa', () => {
    const peticion = solicitud({
      lineas: [
        {
          descripcion: 'Servidor',
          cantidad: '1',
          precioUnitario: '2000000',
          tarifa: 'GENERAL',
          cuenta: '1.2.01.002',
          activo: {
            categoriaId: 'cat-computo',
            nombre: 'Servidor de aplicaciones',
            fechaInicioDepreciacion: '2026-08-25',
          },
        },
        {
          descripcion: 'Instalación',
          cantidad: '1',
          precioUnitario: '100000',
          tarifa: 'GENERAL',
          cuenta: '6.1.02.003',
        },
      ],
    })
    const calculadas = calcularLineasCompra(
      peticion.lineas,
      'CRC',
      PROVEEDOR,
      MAPEO_CXP,
    )
    const lineas = lineasAsientoFacturaCompra(
      peticion,
      contexto(),
      calculadas,
      new Map([[0, { id: 'act-777', nombre: 'Servidor de aplicaciones' }]]),
    )

    expect(lineas[0]).toMatchObject({
      cuenta: '1.2.01.002',
      cargo: '2000000.00',
      auxiliarTipo: 'activo',
      auxiliarId: 'act-777',
    })
    expect(lineas[1]).toMatchObject({ cuenta: '6.1.02.003', cargo: '100000.00' })
  })
})

describe('Validación de la compra', () => {
  it('acepta una factura correcta', () => {
    expect(validarFacturaCompra(solicitud(), contexto()).valido).toBe(true)
  })

  it('rechaza el folio repetido del mismo proveedor', () => {
    const resultado = validarFacturaCompra(
      solicitud(),
      contexto({
        foliosRegistrados: [claveFolio(PROVEEDOR.id, '12345')],
      }),
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('FACTURA_DUPLICADA')
  })

  it('exige el folio del comprobante del proveedor', () => {
    const resultado = validarFacturaCompra(
      solicitud({ folioProveedor: '  ' }),
      contexto(),
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('FOLIO_REQUERIDO')
  })

  it('una compra a cuenta de activo fijo exige la ficha del activo', () => {
    const resultado = validarFacturaCompra(
      solicitud({
        lineas: [
          {
            descripcion: 'Servidor',
            cantidad: '1',
            precioUnitario: '2000000',
            tarifa: 'GENERAL',
            cuenta: '1.2.01.002',
          },
        ],
      }),
      contexto(),
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('ACTIVO_REQUERIDO')
  })

  it('no deja capitalizar una línea cargada a gasto', () => {
    const resultado = validarFacturaCompra(
      solicitud({
        lineas: [
          {
            descripcion: 'Papelería',
            cantidad: '1',
            precioUnitario: '50000',
            tarifa: 'GENERAL',
            cuenta: '6.1.02.004',
            activo: {
              categoriaId: 'cat-computo',
              nombre: 'Resma',
              fechaInicioDepreciacion: '2026-08-20',
            },
          },
        ],
      }),
      contexto(),
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('CUENTA_INVALIDA')
  })

  it('exige categoría válida al capitalizar', () => {
    const resultado = validarFacturaCompra(
      solicitud({
        lineas: [
          {
            descripcion: 'Servidor',
            cantidad: '1',
            precioUnitario: '2000000',
            tarifa: 'GENERAL',
            cuenta: '1.2.01.002',
            activo: {
              categoriaId: 'cat-inexistente',
              nombre: 'Servidor',
              fechaInicioDepreciacion: '2026-08-25',
            },
          },
        ],
      }),
      contexto(),
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('CATEGORIA_INVALIDA')
  })

  it('no deja depreciar desde antes de la compra', () => {
    const resultado = validarFacturaCompra(
      solicitud({
        lineas: [
          {
            descripcion: 'Servidor',
            cantidad: '1',
            precioUnitario: '2000000',
            tarifa: 'GENERAL',
            cuenta: '1.2.01.002',
            activo: {
              categoriaId: 'cat-computo',
              nombre: 'Servidor',
              fechaInicioDepreciacion: '2026-01-01',
            },
          },
        ],
      }),
      contexto(),
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('ACTIVO_REQUERIDO')
  })

  it('rechaza el registro en un periodo que no está abierto', () => {
    const resultado = validarFacturaCompra(
      solicitud({ fechaEmision: '2026-07-15', fechaVencimiento: '2026-08-14' }),
      contexto(),
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('PERIODO_CERRADO')
  })
})
