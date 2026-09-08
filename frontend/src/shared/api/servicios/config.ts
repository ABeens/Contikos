import { z } from 'zod'
import {
  MonedaConfigSchema,
  TablaTipoCambioSchema,
  TipoCambioSchema,
  type MonedaConfig,
  type SolicitudMoneda,
  type SolicitudTipoCambio,
  type TablaTipoCambio,
  type TipoCambio,
} from '../contracts/config'
import { pedir, type OpcionesLectura } from './base'

/**
 * Configuración de la empresa: catálogo de monedas y tipo de cambio.
 *
 * No es uno de los siete módulos del dominio, sino los datos de los que todos
 * dependen: qué monedas existen, cuál es la funcional y a cuánto está cada una
 * (docs/01 §4.2, docs/13 §7).
 */

const ListaMonedas = z.array(MonedaConfigSchema)
const SerieTipoCambio = z.array(TipoCambioSchema)

export const servicioConfig = {
  /** GET /config/monedas */
  listarMonedas(opciones: OpcionesLectura = {}): Promise<MonedaConfig[]> {
    return pedir('/config/monedas', ListaMonedas, opciones)
  },

  /** POST /config/monedas */
  crearMoneda(moneda: SolicitudMoneda): Promise<MonedaConfig> {
    return pedir('/config/monedas', MonedaConfigSchema, {
      metodo: 'POST',
      cuerpo: moneda,
    })
  },

  /**
   * PUT /config/monedas/:codigo
   *
   * El código es la llave del catálogo, así que va en la ruta: el cuerpo puede
   * traerlo, pero manda la ruta.
   */
  actualizarMoneda(
    codigo: string,
    moneda: SolicitudMoneda,
  ): Promise<MonedaConfig> {
    return pedir(`/config/monedas/${codigo}`, MonedaConfigSchema, {
      metodo: 'PUT',
      cuerpo: moneda,
    })
  },

  /**
   * PUT /config/monedas/:codigo/funcional
   *
   * Operación propia y no un campo de la moneda: designar la funcional mueve
   * la marca de una moneda a otra, así que afecta al catálogo entero y por eso
   * devuelve el catálogo entero.
   */
  establecerMonedaFuncional(codigo: string): Promise<MonedaConfig[]> {
    return pedir(`/config/monedas/${codigo}/funcional`, ListaMonedas, {
      metodo: 'PUT',
    })
  },

  /** DELETE /config/monedas/:codigo */
  async eliminarMoneda(codigo: string): Promise<void> {
    await pedir(`/config/monedas/${codigo}`, z.undefined(), {
      metodo: 'DELETE',
    })
  },

  /**
   * GET /config/tipo-cambio
   *
   * Los indicadores del día de la fuente oficial. La aplicación consulta a su
   * propia API y nunca a Hacienda directamente (docs/13 §8): quien sale a la
   * fuente externa es el servidor.
   */
  tipoCambioDelDia(opciones: OpcionesLectura = {}): Promise<TablaTipoCambio> {
    return pedir('/config/tipo-cambio', TablaTipoCambioSchema, opciones)
  },

  /**
   * GET /config/tipos-cambio?moneda=&desde=&hasta=
   *
   * La serie con fecha de una moneda (docs/13 §7, docs/10 §2). Es la tabla que
   * sirve para contabilizar: el campo `tipoCambio` del catálogo de monedas es
   * solo la referencia vigente y no tiene fecha.
   */
  serieTipoCambio(
    moneda: string,
    rango: { desde?: string; hasta?: string } = {},
    opciones: OpcionesLectura = {},
  ): Promise<TipoCambio[]> {
    return pedir('/config/tipos-cambio', SerieTipoCambio, {
      params: { moneda, desde: rango.desde, hasta: rango.hasta },
      ...opciones,
    })
  },

  /**
   * GET /config/tipos-cambio/vigente?moneda=&fecha=
   *
   * El que rige en una fecha: el de ese día o el último anterior. Es lo que un
   * formulario de factura o de asiento necesita para proponer el tipo de cambio
   * de la fecha del documento.
   *
   * TODO(robot): hoy hay que pedirlo a mano. Cuando se retome el robot de tipo
   * de cambio (en pausa), quedan dos cosas por hacer: poblar la tabla día a día
   * desde los indicadores del Ministerio de Hacienda, y consultar este endpoint
   * automáticamente cada vez que cambie la fecha de un documento para proponer
   * el tipo de ese día sin que nadie lo pida.
   */
  tipoCambioVigente(
    moneda: string,
    fecha: string,
    opciones: OpcionesLectura = {},
  ): Promise<TipoCambio> {
    return pedir('/config/tipos-cambio/vigente', TipoCambioSchema, {
      params: { moneda, fecha },
      ...opciones,
    })
  },

  /**
   * POST /config/tipos-cambio
   *
   * Captura manual para una fecha. Actualiza si ya existe uno de esa moneda y
   * esa fecha: la llave de la tabla es (moneda, fecha).
   */
  registrarTipoCambio(solicitud: SolicitudTipoCambio): Promise<TipoCambio> {
    return pedir('/config/tipos-cambio', TipoCambioSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },
}
