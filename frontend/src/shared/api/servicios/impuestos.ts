import { z } from 'zod'
import {
  TarifaImpuestoSchema,
  type SolicitudTarifaImpuesto,
  type TarifaImpuesto,
} from '../contracts/impuestos'
import { pedir, type OpcionesLectura } from './base'

/**
 * Tabla de impuestos de la empresa (docs/13 §3).
 *
 * Vive en configuración y no en CxC o CxP porque la usan los dos: la misma
 * tarifa grava la venta y acredita la compra. La captura de un documento pide
 * las vigentes a SU fecha, nunca a la de hoy.
 */

const ListaTarifas = z.array(TarifaImpuestoSchema)

export const servicioImpuestos = {
  /**
   * GET /config/impuestos?fecha=
   *
   * Con fecha, las que rigen ese día. Sin fecha, la tabla entera.
   */
  listar(
    fecha?: string,
    opciones: OpcionesLectura = {},
  ): Promise<TarifaImpuesto[]> {
    return pedir('/config/impuestos', ListaTarifas, {
      params: { fecha },
      ...opciones,
    })
  },

  /** POST /config/impuestos */
  crear(datos: SolicitudTarifaImpuesto): Promise<TarifaImpuesto> {
    return pedir('/config/impuestos', TarifaImpuestoSchema, {
      metodo: 'POST',
      cuerpo: datos,
    })
  },

  /** PUT /config/impuestos/:id */
  actualizar(
    id: string,
    datos: SolicitudTarifaImpuesto,
  ): Promise<TarifaImpuesto> {
    return pedir(`/config/impuestos/${id}`, TarifaImpuestoSchema, {
      metodo: 'PUT',
      cuerpo: datos,
    })
  },

  /** DELETE /config/impuestos/:id. Rechaza con TARIFA_EN_USO si hay facturas. */
  async eliminar(id: string): Promise<void> {
    await pedir(`/config/impuestos/${id}`, z.undefined(), { metodo: 'DELETE' })
  },
}
