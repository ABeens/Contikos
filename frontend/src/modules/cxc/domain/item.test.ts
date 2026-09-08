import { describe, expect, it } from 'vitest'
import { CUENTAS } from '@/mocks/seed/cuentas'
import { itemsMock } from '@/mocks/seed/cxc'
import type {
  ItemCatalogo,
  SolicitudItemCatalogo,
} from '@/shared/api/contracts/cxc'
import { precargaDeItem, validarItem } from './item'

/**
 * El catálogo de venta existe para decidir una vez la cuenta y la tarifa
 * (docs/04 §1.1). Lo que se prueba aquí es esa pareja: que no se pueda guardar
 * un item que acredite una cuenta imposible, y que lo que lleva a la línea sea
 * una propuesta y no una imposición.
 */

const BASE: SolicitudItemCatalogo = {
  codigo: 'SRV-900',
  nombre: 'Servicio de prueba',
  descripcion: null,
  tipo: 'servicio',
  precioUnitario: '50000.00',
  moneda: 'CRC',
  tarifa: 'GENERAL',
  cuentaIngreso: '4.1.01.001',
  activo: true,
}

const SERVICIO: ItemCatalogo = { id: 'itm-prueba', ...BASE }

function solicitud(
  cambios: Partial<SolicitudItemCatalogo> = {},
): SolicitudItemCatalogo {
  return { ...BASE, ...cambios }
}

describe('Alta de un producto o servicio', () => {
  it('acepta el item cuyo ingreso va a una cuenta de detalle de tipo ingreso', () => {
    const resultado = validarItem(solicitud(), {
      cuentas: CUENTAS,
      items: itemsMock,
    })
    expect(resultado.valido).toBe(true)
  })

  it('rechaza el código que ya está en el catálogo', () => {
    const resultado = validarItem(solicitud({ codigo: 'srv-001' }), {
      cuentas: CUENTAS,
      items: itemsMock,
    })

    // El código es lo que se teclea al facturar: dos iguales precargarían
    // cuentas distintas según el orden del catálogo.
    expect(resultado.errores[0].codigo).toBe('CODIGO_DUPLICADO')
  })

  it('deja renombrar un item sin acusarse a sí mismo de duplicado', () => {
    const item = itemsMock.find((i) => i.codigo === 'SRV-001')!
    const resultado = validarItem(
      solicitud({ codigo: item.codigo, nombre: 'Otro nombre' }),
      { cuentas: CUENTAS, items: itemsMock, item },
    )
    expect(resultado.valido).toBe(true)
  })

  it('rechaza acreditar la venta a una cuenta que no es de ingreso', () => {
    // 1.1.01.001 es Caja general: cuadraría el asiento y dejaría el Estado de
    // Resultados sin la venta.
    const resultado = validarItem(solicitud({ cuentaIngreso: '1.1.01.001' }), {
      cuentas: CUENTAS,
      items: itemsMock,
    })
    expect(resultado.errores[0].codigo).toBe('CUENTA_INVALIDA')
  })

  it('rechaza la cuenta acumulativa, que no recibe movimientos', () => {
    const resultado = validarItem(solicitud({ cuentaIngreso: '4.1.01' }), {
      cuentas: CUENTAS,
      items: itemsMock,
    })
    expect(resultado.errores[0].codigo).toBe('CUENTA_INVALIDA')
  })

  it('rechaza el precio negativo y admite el cero como precio a convenir', () => {
    expect(
      validarItem(solicitud({ precioUnitario: '-1' }), {
        cuentas: CUENTAS,
        items: itemsMock,
      }).errores[0].codigo,
    ).toBe('PRECIO_INVALIDO')

    expect(
      validarItem(solicitud({ precioUnitario: '0' }), {
        cuentas: CUENTAS,
        items: itemsMock,
      }).valido,
    ).toBe(true)
  })
})

describe('Lo que el item lleva a la línea', () => {
  it('propone descripción, tarifa, cuenta y precio', () => {
    const precarga = precargaDeItem(SERVICIO, 'CRC')

    expect(precarga).toEqual({
      itemId: 'itm-prueba',
      descripcion: 'Servicio de prueba',
      tarifa: 'GENERAL',
      cuentaIngreso: '4.1.01.001',
      precioUnitario: '50000.00',
    })
  })

  it('prefiere la descripción de factura al nombre cuando la hay', () => {
    const precarga = precargaDeItem(
      { ...SERVICIO, descripcion: 'Servicios de salud, consulta general' },
      'CRC',
    )
    expect(precarga.descripcion).toBe('Servicios de salud, consulta general')
  })

  it('no propone precio cuando el item está cotizado en otra moneda', () => {
    const precarga = precargaDeItem({ ...SERVICIO, moneda: 'USD' }, 'CRC')

    // Convertirlo por el tipo de cambio del día daría un precio de lista que
    // nadie pactó. La cuenta y la tarifa sí siguen siendo válidas.
    expect(precarga.precioUnitario).toBeNull()
    expect(precarga.cuentaIngreso).toBe('4.1.01.001')
  })
})
