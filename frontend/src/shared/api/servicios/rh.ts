import { z } from 'zod'
import {
  EmpleadoSchema,
  MapeoRhSchema,
  ParametrosPlanillaSchema,
  PlanillaSchema,
  type Empleado,
  type MapeoRh,
  type ParametrosPlanilla,
  type Planilla,
  type SolicitudCalculoPlanilla,
  type SolicitudEmpleado,
  type SolicitudPagoPlanilla,
  type SolicitudParametrosPlanilla,
} from '../contracts/rh'
import { pedir, type OpcionesLectura } from './base'

/**
 * Recursos humanos y planilla (docs/08).
 *
 * Todo pide el permiso de planilla, incluso leer: los salarios no los ve quien
 * no lleva la planilla (docs/08 §7).
 */

const ListaParametros = z.array(ParametrosPlanillaSchema)
const ListaEmpleados = z.array(EmpleadoSchema)
const ListaPlanillas = z.array(PlanillaSchema)

export const servicioRh = {
  /** GET /rh/mapeo */
  obtenerMapeo(opciones: OpcionesLectura = {}): Promise<MapeoRh> {
    return pedir('/rh/mapeo', MapeoRhSchema, opciones)
  },

  /** GET /rh/parametros: todas las vigencias, de la más reciente a la más vieja. */
  listarParametros(opciones: OpcionesLectura = {}): Promise<ParametrosPlanilla[]> {
    return pedir('/rh/parametros', ListaParametros, opciones)
  },

  /** POST /rh/parametros: una vigencia nueva. Las anteriores no cambian. */
  registrarParametros(datos: SolicitudParametrosPlanilla): Promise<ParametrosPlanilla> {
    return pedir('/rh/parametros', ParametrosPlanillaSchema, { metodo: 'POST', cuerpo: datos })
  },

  /** GET /rh/empleados */
  listarEmpleados(opciones: OpcionesLectura = {}): Promise<Empleado[]> {
    return pedir('/rh/empleados', ListaEmpleados, opciones)
  },

  /** POST /rh/empleados */
  crearEmpleado(datos: SolicitudEmpleado): Promise<Empleado> {
    return pedir('/rh/empleados', EmpleadoSchema, { metodo: 'POST', cuerpo: datos })
  },

  /** PUT /rh/empleados/:id */
  actualizarEmpleado(id: string, datos: SolicitudEmpleado): Promise<Empleado> {
    return pedir(`/rh/empleados/${id}`, EmpleadoSchema, { metodo: 'PUT', cuerpo: datos })
  },

  /** GET /rh/planillas */
  listarPlanillas(opciones: OpcionesLectura = {}): Promise<Planilla[]> {
    return pedir('/rh/planillas', ListaPlanillas, opciones)
  },

  /** GET /rh/planillas/:id */
  obtenerPlanilla(id: string, opciones: OpcionesLectura = {}): Promise<Planilla> {
    return pedir(`/rh/planillas/${id}`, PlanillaSchema, opciones)
  },

  /** POST /rh/planillas: calcula, o recalcula mientras no esté contabilizada. */
  calcularPlanilla(solicitud: SolicitudCalculoPlanilla): Promise<Planilla> {
    return pedir('/rh/planillas', PlanillaSchema, { metodo: 'POST', cuerpo: solicitud })
  },

  /** POST /rh/planillas/:id/contabilizar */
  contabilizarPlanilla(id: string): Promise<Planilla> {
    return pedir(`/rh/planillas/${id}/contabilizar`, PlanillaSchema, { metodo: 'POST' })
  },

  /** POST /rh/planillas/:id/pagar */
  pagarPlanilla(id: string, solicitud: SolicitudPagoPlanilla): Promise<Planilla> {
    return pedir(`/rh/planillas/${id}/pagar`, PlanillaSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },
}
