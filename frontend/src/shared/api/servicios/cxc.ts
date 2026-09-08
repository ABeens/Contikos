import { z } from 'zod'
import { AsientoSchema, type Asiento } from '../contracts/conta'
import {
  AntiguedadSchema,
  ClienteSchema,
  CobroSchema,
  FacturaVentaSchema,
  ItemCatalogoSchema,
  MapeoCxcSchema,
  type Antiguedad,
  type Cliente,
  type Cobro,
  type FacturaVenta,
  type ItemCatalogo,
  type MapeoCxc,
  type SolicitudAnulacionCobro,
  type SolicitudCliente,
  type SolicitudCobro,
  type SolicitudFacturaVenta,
  type SolicitudItemCatalogo,
} from '../contracts/cxc'
import { pedir, type OpcionesLectura } from './base'

/**
 * Cuentas por cobrar: clientes, facturación y cartera.
 *
 * El asiento de una factura se pide a CxC y no a `conta`: el módulo expone la
 * trazabilidad de sus propios documentos, y la pantalla no tiene que conocer ni
 * el mayor ni la terna de origen.
 */

const ListaClientes = z.array(ClienteSchema)
const ListaFacturas = z.array(FacturaVentaSchema)
const ListaItems = z.array(ItemCatalogoSchema)
const ListaCobros = z.array(CobroSchema)

export const servicioCxc = {
  /** GET /cxc/mapeo — cuentas que mueve el módulo (docs/02 §5). */
  obtenerMapeo(opciones: OpcionesLectura = {}): Promise<MapeoCxc> {
    return pedir('/cxc/mapeo', MapeoCxcSchema, opciones)
  },

  /** GET /cxc/clientes */
  listarClientes(opciones: OpcionesLectura = {}): Promise<Cliente[]> {
    return pedir('/cxc/clientes', ListaClientes, opciones)
  },

  /** POST /cxc/clientes */
  crearCliente(datos: SolicitudCliente): Promise<Cliente> {
    return pedir('/cxc/clientes', ClienteSchema, {
      metodo: 'POST',
      cuerpo: datos,
    })
  },

  /** PUT /cxc/clientes/:id */
  actualizarCliente(id: string, datos: SolicitudCliente): Promise<Cliente> {
    return pedir(`/cxc/clientes/${id}`, ClienteSchema, {
      metodo: 'PUT',
      cuerpo: datos,
    })
  },

  /**
   * GET /cxc/items — catálogo de productos y servicios (docs/04 §1.1).
   *
   * Lo consulta la pantalla de captura para precargar la línea, así que se
   * sirve entero y ordenado por código: es una lista de decenas, no de miles.
   */
  listarItems(opciones: OpcionesLectura = {}): Promise<ItemCatalogo[]> {
    return pedir('/cxc/items', ListaItems, opciones)
  },

  /** POST /cxc/items */
  crearItem(datos: SolicitudItemCatalogo): Promise<ItemCatalogo> {
    return pedir('/cxc/items', ItemCatalogoSchema, {
      metodo: 'POST',
      cuerpo: datos,
    })
  },

  /**
   * PUT /cxc/items/:id
   *
   * Cambia lo que se precargará de aquí en adelante. Las facturas ya emitidas
   * conservan la cuenta y el precio con los que se declararon.
   */
  actualizarItem(
    id: string,
    datos: SolicitudItemCatalogo,
  ): Promise<ItemCatalogo> {
    return pedir(`/cxc/items/${id}`, ItemCatalogoSchema, {
      metodo: 'PUT',
      cuerpo: datos,
    })
  },

  /** GET /cxc/facturas */
  listarFacturas(
    filtro: { clienteId?: string; pendientes?: boolean } = {},
    opciones: OpcionesLectura = {},
  ): Promise<FacturaVenta[]> {
    return pedir('/cxc/facturas', ListaFacturas, {
      params: {
        clienteId: filtro.clienteId,
        pendientes: filtro.pendientes ? 'true' : undefined,
      },
      ...opciones,
    })
  },

  /** GET /cxc/facturas/:id */
  obtenerFactura(
    id: string,
    opciones: OpcionesLectura = {},
  ): Promise<FacturaVenta> {
    return pedir(`/cxc/facturas/${id}`, FacturaVentaSchema, opciones)
  },

  /** GET /cxc/facturas/:id/asiento — el asiento que la contabilizó. */
  obtenerAsientoDeFactura(
    id: string,
    opciones: OpcionesLectura = {},
  ): Promise<Asiento> {
    return pedir(`/cxc/facturas/${id}/asiento`, AsientoSchema, opciones)
  },

  /** GET /cxc/antiguedad — cartera por tramos a la fecha de corte. */
  obtenerAntiguedad(
    corte: string,
    opciones: OpcionesLectura = {},
  ): Promise<Antiguedad> {
    return pedir('/cxc/antiguedad', AntiguedadSchema, {
      params: { corte },
      ...opciones,
    })
  },

  /**
   * POST /cxc/facturas
   *
   * Emite la factura y, con ella, su asiento: son la misma transacción
   * (docs/02 §8). Si el mayor rechaza el asiento, no queda una factura
   * huérfana.
   */
  emitirFactura(solicitud: SolicitudFacturaVenta): Promise<FacturaVenta> {
    return pedir('/cxc/facturas', FacturaVentaSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /**
   * GET /cxc/cobros
   *
   * Por cliente o por factura. El filtro por factura es el que responde "quién
   * y cuándo bajó este saldo": la relación es N a N y no hay un `cobroId` en la
   * factura al que preguntarle (docs/04 §1).
   */
  listarCobros(
    filtro: { clienteId?: string; facturaId?: string } = {},
    opciones: OpcionesLectura = {},
  ): Promise<Cobro[]> {
    return pedir('/cxc/cobros', ListaCobros, {
      params: { clienteId: filtro.clienteId, facturaId: filtro.facturaId },
      ...opciones,
    })
  },

  /** GET /cxc/cobros/:id */
  obtenerCobro(id: string, opciones: OpcionesLectura = {}): Promise<Cobro> {
    return pedir(`/cxc/cobros/${id}`, CobroSchema, opciones)
  },

  /** GET /cxc/cobros/:id/asiento: el asiento que lo contabilizó. */
  obtenerAsientoDeCobro(
    id: string,
    opciones: OpcionesLectura = {},
  ): Promise<Asiento> {
    return pedir(`/cxc/cobros/${id}/asiento`, AsientoSchema, opciones)
  },

  /**
   * POST /cxc/cobros
   *
   * Registra el cobro, emite su asiento y baja el saldo de cada factura
   * aplicada: son la misma transacción (docs/02 §8). Si el mayor rechaza el
   * asiento, ningún saldo se mueve.
   */
  registrarCobro(solicitud: SolicitudCobro): Promise<Cobro> {
    return pedir('/cxc/cobros', CobroSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /**
   * POST /cxc/cobros/:id/anulacion
   *
   * Reversa el asiento del cobro y devuelve el saldo a las facturas. El
   * documento queda en el histórico como anulado; no se borra (docs/02 §7).
   */
  anularCobro(id: string, solicitud: SolicitudAnulacionCobro): Promise<Cobro> {
    return pedir(`/cxc/cobros/${id}/anulacion`, CobroSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },
}
