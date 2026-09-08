import { z } from 'zod'
import {
  CorridaDiferidosHistorialSchema,
  DiferidoSchema,
  PrevisualizacionCorridaDiferidosSchema,
  ResultadoCancelacionSchema,
  ResultadoCorridaDiferidosSchema,
  type CorridaDiferidosHistorial,
  type Diferido,
  type EstadoDiferido,
  type PrevisualizacionCorridaDiferidos,
  type ResultadoCancelacion,
  type ResultadoCorridaDiferidos,
  type SolicitudCancelacionDiferido,
  type SolicitudCorridaDiferidos,
  type SolicitudDiferido,
} from '../contracts/diferidos'
import { pedir, type OpcionesLectura } from './base'

/**
 * Asientos diferidos: fichas, plan de amortización y corrida mensual.
 *
 * El alta y la corrida no son la misma operación con un parámetro distinto
 * (docs/15 §3): el alta registra el plan y no toca el mayor, porque el
 * documento que originó el diferido ya dejó el importe en la cuenta de balance.
 * Lo que contabiliza es la corrida del periodo, y la cancelación anticipada,
 * que reconoce el remanente de golpe.
 */

const ListaDiferidos = z.array(DiferidoSchema)
const ListaHistorial = z.array(CorridaDiferidosHistorialSchema)

export const servicioDiferidos = {
  /** GET /diferidos */
  listar(
    filtro: { estado?: EstadoDiferido } = {},
    opciones: OpcionesLectura = {},
  ): Promise<Diferido[]> {
    return pedir('/diferidos', ListaDiferidos, {
      params: { estado: filtro.estado },
      ...opciones,
    })
  },

  /** GET /diferidos/:id */
  obtener(id: string, opciones: OpcionesLectura = {}): Promise<Diferido> {
    return pedir(`/diferidos/${id}`, DiferidoSchema, opciones)
  },

  /** POST /diferidos — registra el plan. No genera asiento. */
  crear(solicitud: SolicitudDiferido): Promise<Diferido> {
    return pedir('/diferidos', DiferidoSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /**
   * PUT /diferidos/:id
   *
   * Solo mientras no tenga cuotas contabilizadas: después, el monto y el plazo
   * ya explican asientos que están en el mayor.
   */
  actualizar(id: string, solicitud: SolicitudDiferido): Promise<Diferido> {
    return pedir(`/diferidos/${id}`, DiferidoSchema, {
      metodo: 'PUT',
      cuerpo: solicitud,
    })
  },

  /**
   * POST /diferidos/:id/cancelacion
   *
   * Baja anticipada. Reconoce el saldo remanente de golpe en la fecha indicada
   * (docs/15 §3.4), así que sí toca el mayor.
   */
  cancelar(
    id: string,
    solicitud: SolicitudCancelacionDiferido,
  ): Promise<ResultadoCancelacion> {
    return pedir(`/diferidos/${id}/cancelacion`, ResultadoCancelacionSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /**
   * GET /diferidos/amortizacion?periodoId=
   *
   * Verificación previa de la corrida (docs/15 §3.2): la calcula con sus
   * verificaciones y el asiento que generaría, sin escribir nada.
   */
  previsualizarAmortizacion(
    periodoId: string,
    opciones: OpcionesLectura = {},
  ): Promise<PrevisualizacionCorridaDiferidos> {
    return pedir(
      '/diferidos/amortizacion',
      PrevisualizacionCorridaDiferidosSchema,
      { params: { periodoId }, ...opciones },
    )
  },

  /**
   * POST /diferidos/amortizacion
   *
   * Contabiliza la corrida del periodo. Idempotente por periodo: la segunda vez
   * responde `CORRIDA_YA_CONTABILIZADA` con el asiento que ya existe.
   */
  contabilizarAmortizacion(
    solicitud: SolicitudCorridaDiferidos,
  ): Promise<ResultadoCorridaDiferidos> {
    return pedir('/diferidos/amortizacion', ResultadoCorridaDiferidosSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /** GET /diferidos/amortizacion/historial */
  historialAmortizacion(
    opciones: OpcionesLectura = {},
  ): Promise<CorridaDiferidosHistorial[]> {
    return pedir('/diferidos/amortizacion/historial', ListaHistorial, opciones)
  },
}
