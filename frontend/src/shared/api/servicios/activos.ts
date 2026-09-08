import { z } from 'zod'
import {
  ActivoSchema,
  AltaPendienteSchema,
  CategoriaActivoSchema,
  CorridaHistorialSchema,
  PrevisualizacionCorridaSchema,
  ResultadoCorridaSchema,
  type Activo,
  type AltaPendiente,
  type CategoriaActivo,
  type CorridaHistorial,
  type PrevisualizacionCorrida,
  type ResultadoCorrida,
  type SolicitudActivoDesdeFactura,
  type SolicitudActivoManual,
  type SolicitudCategoriaActivo,
  type SolicitudCorrida,
} from '../contracts/activos'
import { pedir, type OpcionesLectura } from './base'

/**
 * Activos fijos: categorías, inventario y las dos puertas de alta.
 *
 * Las dos puertas no son la misma operación con un parámetro distinto
 * (docs/07 §3.1): el alta manual genera asiento y el alta desde una compra no,
 * porque el asiento de esa compra ya reconoció el activo en el mayor.
 */

const ListaActivos = z.array(ActivoSchema)
const ListaCategorias = z.array(CategoriaActivoSchema)
const ListaPendientes = z.array(AltaPendienteSchema)
const ListaHistorial = z.array(CorridaHistorialSchema)

export const servicioActivos = {
  /** GET /activos/categorias */
  listarCategorias(opciones: OpcionesLectura = {}): Promise<CategoriaActivo[]> {
    return pedir('/activos/categorias', ListaCategorias, opciones)
  },

  /** POST /activos/categorias */
  crearCategoria(datos: SolicitudCategoriaActivo): Promise<CategoriaActivo> {
    return pedir('/activos/categorias', CategoriaActivoSchema, {
      metodo: 'POST',
      cuerpo: datos,
    })
  },

  /** PUT /activos/categorias/:id */
  actualizarCategoria(
    id: string,
    datos: SolicitudCategoriaActivo,
  ): Promise<CategoriaActivo> {
    return pedir(`/activos/categorias/${id}`, CategoriaActivoSchema, {
      metodo: 'PUT',
      cuerpo: datos,
    })
  },

  /** GET /activos */
  listar(
    filtro: { categoriaId?: string } = {},
    opciones: OpcionesLectura = {},
  ): Promise<Activo[]> {
    return pedir('/activos', ListaActivos, {
      params: { categoriaId: filtro.categoriaId },
      ...opciones,
    })
  },

  /** GET /activos/:id */
  obtener(id: string, opciones: OpcionesLectura = {}): Promise<Activo> {
    return pedir(`/activos/${id}`, ActivoSchema, opciones)
  },

  /**
   * GET /activos/altas-pendientes
   *
   * Compras que cargaron una cuenta de activo fijo y todavía no tienen ficha:
   * lo que el mayor ya reconoce y el auxiliar aún no. Mientras tenga
   * renglones, la conciliación de docs/07 §4 no cuadra.
   */
  listarAltasPendientes(
    opciones: OpcionesLectura = {},
  ): Promise<AltaPendiente[]> {
    return pedir('/activos/altas-pendientes', ListaPendientes, opciones)
  },

  /** POST /activos/manual — alta directa. Genera su asiento. */
  altaManual(solicitud: SolicitudActivoManual): Promise<Activo> {
    return pedir('/activos/manual', ActivoSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /**
   * POST /activos/desde-factura
   *
   * Alta a partir de una compra ya contabilizada. No toca el mayor: volver a
   * contabilizar el activo lo duplicaría.
   */
  altaDesdeFactura(solicitud: SolicitudActivoDesdeFactura): Promise<Activo> {
    return pedir('/activos/desde-factura', ActivoSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /**
   * GET /activos/depreciacion?periodoId=
   *
   * Verificación previa de la corrida (docs/07 §3.2): la calcula con sus
   * verificaciones y el asiento que generaría, sin escribir nada.
   */
  previsualizarDepreciacion(
    periodoId: string,
    opciones: OpcionesLectura = {},
  ): Promise<PrevisualizacionCorrida> {
    return pedir('/activos/depreciacion', PrevisualizacionCorridaSchema, {
      params: { periodoId },
      ...opciones,
    })
  },

  /**
   * POST /activos/depreciacion
   *
   * Contabiliza la corrida del periodo. Idempotente por periodo: la segunda
   * vez responde `CORRIDA_YA_CONTABILIZADA` con el asiento que ya existe.
   */
  contabilizarDepreciacion(
    solicitud: SolicitudCorrida,
  ): Promise<ResultadoCorrida> {
    return pedir('/activos/depreciacion', ResultadoCorridaSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /** GET /activos/depreciacion/historial */
  historialDepreciacion(
    opciones: OpcionesLectura = {},
  ): Promise<CorridaHistorial[]> {
    return pedir('/activos/depreciacion/historial', ListaHistorial, opciones)
  },
}
