import { z } from 'zod'
import { ApiError } from '../client'
import { rutaApi } from '../entorno'
import { empresaActiva } from '@/shared/almacen/almacen'
import { AsientoSchema, type Asiento } from '../contracts/conta'
import {
  AdjuntoSchema,
  type Adjunto,
  type SolicitudAdjunto,
} from '../contracts/comunes'
import {
  AntiguedadCxpSchema,
  FacturaCompraSchema,
  MapeoCxpSchema,
  PagoSchema,
  PropuestaPagoSchema,
  ProveedorSchema,
  type AntiguedadCxp,
  type FacturaCompra,
  type MapeoCxp,
  type Pago,
  type PropuestaPago,
  type Proveedor,
  type SolicitudAnulacionPago,
  type SolicitudFacturaCompra,
  type SolicitudPago,
  type SolicitudProveedor,
} from '../contracts/cxp'
import { pedir, type OpcionesLectura } from './base'

/**
 * Cuentas por pagar: proveedores, compras y cartera por pagar.
 *
 * La factura de compra puede capitalizar una línea, y entonces nace también la
 * ficha del activo (docs/07 §3.1). Eso ocurre dentro de la misma operación:
 * quien llama no encadena dos peticiones.
 */

const ListaProveedores = z.array(ProveedorSchema)
const ListaFacturas = z.array(FacturaCompraSchema)
const ListaPagos = z.array(PagoSchema)

export const servicioCxp = {
  /** GET /cxp/mapeo — cuentas que mueve el módulo (docs/02 §5). */
  obtenerMapeo(opciones: OpcionesLectura = {}): Promise<MapeoCxp> {
    return pedir('/cxp/mapeo', MapeoCxpSchema, opciones)
  },

  /** GET /cxp/proveedores */
  listarProveedores(opciones: OpcionesLectura = {}): Promise<Proveedor[]> {
    return pedir('/cxp/proveedores', ListaProveedores, opciones)
  },

  /** POST /cxp/proveedores */
  crearProveedor(datos: SolicitudProveedor): Promise<Proveedor> {
    return pedir('/cxp/proveedores', ProveedorSchema, {
      metodo: 'POST',
      cuerpo: datos,
    })
  },

  /** PUT /cxp/proveedores/:id */
  actualizarProveedor(
    id: string,
    datos: SolicitudProveedor,
  ): Promise<Proveedor> {
    return pedir(`/cxp/proveedores/${id}`, ProveedorSchema, {
      metodo: 'PUT',
      cuerpo: datos,
    })
  },

  /** GET /cxp/facturas */
  listarFacturas(
    filtro: { proveedorId?: string } = {},
    opciones: OpcionesLectura = {},
  ): Promise<FacturaCompra[]> {
    return pedir('/cxp/facturas', ListaFacturas, {
      params: { proveedorId: filtro.proveedorId },
      ...opciones,
    })
  },

  /** GET /cxp/facturas/:id */
  obtenerFactura(
    id: string,
    opciones: OpcionesLectura = {},
  ): Promise<FacturaCompra> {
    return pedir(`/cxp/facturas/${id}`, FacturaCompraSchema, opciones)
  },

  /** GET /cxp/facturas/:id/asiento — el asiento que la contabilizó. */
  obtenerAsientoDeFactura(
    id: string,
    opciones: OpcionesLectura = {},
  ): Promise<Asiento> {
    return pedir(`/cxp/facturas/${id}/asiento`, AsientoSchema, opciones)
  },

  /** GET /cxp/antiguedad — cartera por tramos a la fecha de corte. */
  obtenerAntiguedad(
    corte: string,
    opciones: OpcionesLectura = {},
  ): Promise<AntiguedadCxp> {
    return pedir('/cxp/antiguedad', AntiguedadCxpSchema, {
      params: { corte },
      ...opciones,
    })
  },

  /**
   * POST /cxp/facturas
   *
   * Registra la factura de gasto y su asiento. La cuenta por pagar nace por el
   * neto: la retención no se le paga al proveedor, se entera a Hacienda
   * (docs/13 §5).
   */
  registrarFactura(solicitud: SolicitudFacturaCompra): Promise<FacturaCompra> {
    return pedir('/cxp/facturas', FacturaCompraSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /* --------------------------------------------------------------- Pagos */

  /**
   * GET /cxp/pagos
   *
   * Por proveedor o por factura. El segundo filtro es la vuelta de la relación
   * N a N: desde una factura se llega a todos los pagos que la abonaron.
   */
  listarPagos(
    filtro: { proveedorId?: string; facturaId?: string } = {},
    opciones: OpcionesLectura = {},
  ): Promise<Pago[]> {
    return pedir('/cxp/pagos', ListaPagos, {
      params: {
        proveedorId: filtro.proveedorId,
        facturaId: filtro.facturaId,
      },
      ...opciones,
    })
  },

  /** GET /cxp/pagos/:id */
  obtenerPago(id: string, opciones: OpcionesLectura = {}): Promise<Pago> {
    return pedir(`/cxp/pagos/${id}`, PagoSchema, opciones)
  },

  /** GET /cxp/pagos/:id/asiento — el asiento del egreso. */
  obtenerAsientoDePago(
    id: string,
    opciones: OpcionesLectura = {},
  ): Promise<Asiento> {
    return pedir(`/cxp/pagos/${id}/asiento`, AsientoSchema, opciones)
  },

  /**
   * POST /cxp/pagos
   *
   * Emite el pago, lo contabiliza y baja el saldo de cada factura aplicada, en
   * una sola operación (docs/02 §8). Lo que sobra del importe queda como
   * anticipo al proveedor.
   */
  registrarPago(solicitud: SolicitudPago): Promise<Pago> {
    return pedir('/cxp/pagos', PagoSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /**
   * POST /cxp/pagos/:id/anulacion
   *
   * Reversa el asiento del pago y devuelve el saldo a sus facturas. La fecha
   * es la de la reversa, que puede no ser la del pago: si ese periodo ya cerró,
   * la reversa va en el abierto (docs/02 §6).
   */
  anularPago(id: string, solicitud: SolicitudAnulacionPago): Promise<Pago> {
    return pedir(`/cxp/pagos/${id}/anulacion`, PagoSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /**
   * GET /cxp/propuesta-pago
   *
   * Qué pagar a la fecha de corte con el efectivo disponible (docs/05 §2.3).
   * Se recalcula en cada consulta: no hay documento que guardar.
   */
  obtenerPropuestaPago(
    filtro: { corte: string; disponible: string },
    opciones: OpcionesLectura = {},
  ): Promise<PropuestaPago> {
    return pedir('/cxp/propuesta-pago', PropuestaPagoSchema, {
      params: { corte: filtro.corte, disponible: filtro.disponible },
      ...opciones,
    })
  },

  /* ------------------------------------------------------------ Adjuntos */

  /**
   * POST /cxp/facturas/:id/adjuntos
   *
   * Uno por llamada, con el contenido en base64. Devuelve los metadatos; el
   * contenido se vuelve a pedir por su propio endpoint cuando haga falta.
   */
  agregarAdjunto(
    facturaId: string,
    adjunto: SolicitudAdjunto,
  ): Promise<Adjunto> {
    return pedir(`/cxp/facturas/${facturaId}/adjuntos`, AdjuntoSchema, {
      metodo: 'POST',
      cuerpo: adjunto,
    })
  },

  /**
   * GET /cxp/facturas/:id/adjuntos/:adjuntoId
   *
   * Es la única operación que no devuelve JSON, así que no pasa por `pedir`:
   * el cliente tipado valida contra un esquema y aquí lo que llega es un PDF.
   * Se manda la misma cabecera de empresa que el resto, porque la guardia del
   * servidor no distingue.
   */
  async descargarAdjunto(facturaId: string, adjuntoId: string): Promise<Blob> {
    const respuesta = await fetch(
      rutaApi(`/cxp/facturas/${facturaId}/adjuntos/${adjuntoId}`),
      { headers: { 'X-Empresa-Id': empresaActiva() } },
    )
    if (!respuesta.ok) {
      throw new ApiError(
        'ADJUNTO_NO_ENCONTRADO',
        'No se pudo descargar el adjunto',
        respuesta.status,
      )
    }
    return respuesta.blob()
  },

  /** DELETE /cxp/facturas/:id/adjuntos/:adjuntoId */
  async eliminarAdjunto(facturaId: string, adjuntoId: string): Promise<void> {
    await pedir(
      `/cxp/facturas/${facturaId}/adjuntos/${adjuntoId}`,
      z.undefined(),
      { metodo: 'DELETE' },
    )
  },
}
