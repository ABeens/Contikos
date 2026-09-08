import { z } from 'zod'
import type { Libro, Modulo } from '../contracts/comunes'
import {
  AsientoSchema,
  BalanzaComparativaSchema,
  BalanzaSchema,
  ChecklistCierreSchema,
  ClasificacionNiifSchema,
  CuentaSchema,
  NotaEeffSchema,
  PeriodoSchema,
  type Asiento,
  type Balanza,
  type BalanzaComparativa,
  type ChecklistCierre,
  type ClasificacionNiif,
  type Cuenta,
  type NotaEeff,
  type Periodo,
  type SolicitudAsiento,
  type SolicitudCierre,
  type SolicitudClasificacionCuenta,
  type SolicitudClasificacionNiif,
  type SolicitudCuenta,
  type SolicitudNotaEeff,
  type SolicitudReversa,
} from '../contracts/conta'
import { pedir, type OpcionesLectura } from './base'

/**
 * Contabilidad general: el núcleo.
 *
 * `conta` no conoce a los demás módulos; son ellos los que le mandan asientos
 * por el contrato de docs/02. Por eso `contabilizarAsiento` es la única puerta
 * al mayor, y la usan igual la captura manual y los cinco subsidiarios.
 */

const ListaCuentas = z.array(CuentaSchema)
const ListaPeriodos = z.array(PeriodoSchema)
const ListaAsientos = z.array(AsientoSchema)
const ListaClasificaciones = z.array(ClasificacionNiifSchema)
const ListaNotas = z.array(NotaEeffSchema)

export const servicioConta = {
  /* ------------------------------------------------ Catálogo de cuentas */

  /** GET /conta/cuentas */
  listarCuentas(opciones: OpcionesLectura = {}): Promise<Cuenta[]> {
    return pedir('/conta/cuentas', ListaCuentas, opciones)
  },

  /** POST /conta/cuentas */
  crearCuenta(datos: SolicitudCuenta): Promise<Cuenta> {
    return pedir('/conta/cuentas', CuentaSchema, {
      metodo: 'POST',
      cuerpo: datos,
    })
  },

  /** PUT /conta/cuentas/:id */
  actualizarCuenta(id: string, datos: SolicitudCuenta): Promise<Cuenta> {
    return pedir(`/conta/cuentas/${id}`, CuentaSchema, {
      metodo: 'PUT',
      cuerpo: datos,
    })
  },

  /**
   * PUT /conta/cuentas/:id/clasificacion
   *
   * Endpoint propio y no un PUT de la cuenta entera: asignar el renglón del
   * estado financiero y la nota es otra decisión, con otro permiso y otras
   * reglas (docs/03 §2 bis).
   */
  clasificarCuenta(
    cuentaId: string,
    asignacion: SolicitudClasificacionCuenta,
  ): Promise<Cuenta> {
    return pedir(`/conta/cuentas/${cuentaId}/clasificacion`, CuentaSchema, {
      metodo: 'PUT',
      cuerpo: asignacion,
    })
  },

  /* ---------------------------------------------------------- Periodos */

  /** GET /conta/periodos */
  listarPeriodos(opciones: OpcionesLectura = {}): Promise<Periodo[]> {
    return pedir('/conta/periodos', ListaPeriodos, opciones)
  },

  /**
   * GET /conta/periodos/:id/verificacion
   *
   * El checklist de cierre (docs/03 §5). Solo calcula: consultarlo no cambia
   * nada, y por eso se puede pedir tantas veces como haga falta mientras se
   * corrigen los puntos que fallan.
   */
  obtenerVerificacionCierre(
    periodoId: string,
    opciones: OpcionesLectura = {},
  ): Promise<ChecklistCierre> {
    return pedir(
      `/conta/periodos/${periodoId}/verificacion`,
      ChecklistCierreSchema,
      opciones,
    )
  },

  /**
   * POST /conta/periodos/:id/cerrar
   *
   * Devuelve el periodo ya cerrado, con su bitácora. El servidor recalcula el
   * checklist: los errores rechazan con `CIERRE_CON_ERRORES` y los avisos sin
   * confirmar con `CIERRE_CON_AVISOS`.
   */
  cerrarPeriodo(
    periodoId: string,
    solicitud: SolicitudCierre,
  ): Promise<Periodo> {
    return pedir(`/conta/periodos/${periodoId}/cerrar`, PeriodoSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /**
   * POST /conta/periodos/:id/reabrir
   *
   * Solo un periodo cerrado se reabre. El bloqueado se rechaza con
   * `PERIODO_NO_REABRIBLE` y no hay forma de forzarlo (docs/03 §5).
   */
  reabrirPeriodo(periodoId: string): Promise<Periodo> {
    return pedir(`/conta/periodos/${periodoId}/reabrir`, PeriodoSchema, {
      metodo: 'POST',
      cuerpo: {},
    })
  },

  /* ---------------------------------------------------------- Asientos */

  /**
   * GET /conta/asientos
   *
   * Sin `libro` devuelve los de las dos contabilidades: la pantalla de asientos
   * es donde se ven juntas.
   */
  listarAsientos(
    filtro: {
      periodoId?: string
      libro?: Libro
      /**
       * Consulta inversa desde un documento: devuelve el asiento que lo generó
       * (por `origen`) y los manuales que lo mencionan (por
       * `documentoRelacionado`).
       */
      documento?: { modulo: Modulo; tipo: string; id: string }
    } = {},
    opciones: OpcionesLectura = {},
  ): Promise<Asiento[]> {
    return pedir('/conta/asientos', ListaAsientos, {
      params: {
        periodoId: filtro.periodoId,
        libro: filtro.libro,
        documentoModulo: filtro.documento?.modulo,
        documentoTipo: filtro.documento?.tipo,
        documentoId: filtro.documento?.id,
      },
      ...opciones,
    })
  },

  /** GET /conta/asientos/:id */
  obtenerAsiento(id: string, opciones: OpcionesLectura = {}): Promise<Asiento> {
    return pedir(`/conta/asientos/${id}`, AsientoSchema, opciones)
  },

  /**
   * POST /conta/asientos
   *
   * La única puerta al mayor. Es idempotente por la terna de origen: reenviar
   * la misma solicitud de un módulo devuelve el asiento que ya existe en lugar
   * de duplicarlo (docs/02 §4).
   */
  contabilizarAsiento(solicitud: SolicitudAsiento): Promise<Asiento> {
    return pedir('/conta/asientos', AsientoSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /**
   * POST /conta/asientos/:id/reversar
   *
   * Devuelve el asiento de reversa. El original queda `reversado` y apunta a
   * él; quien lo tenga en pantalla lo vuelve a pedir. Repetir la misma
   * solicitud devuelve la misma reversa (docs/02 §4 y §6).
   */
  reversarAsiento(id: string, solicitud: SolicitudReversa): Promise<Asiento> {
    return pedir(`/conta/asientos/${id}/reversar`, AsientoSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /**
   * GET /conta/balanza
   *
   * Siempre de un libro. No existe "los dos a la vez": sumar fiscal y
   * corporativo daría un estado financiero que no corresponde a ninguna
   * contabilidad.
   */
  obtenerBalanza(
    periodoId: string,
    libro: Libro,
    opciones: OpcionesLectura = {},
  ): Promise<Balanza> {
    return pedir('/conta/balanza', BalanzaSchema, {
      params: { periodoId, libro },
      ...opciones,
    })
  },

  /**
   * GET /conta/balanza/comparativa
   *
   * Los dos periodos, el mismo libro. Que el libro sea uno solo no es un
   * detalle de la firma: comparar el agosto fiscal contra el julio corporativo
   * daría una variación que no explica nada (docs/09 §3).
   */
  obtenerBalanzaComparativa(
    periodoA: string,
    periodoB: string,
    libro: Libro,
    opciones: OpcionesLectura = {},
  ): Promise<BalanzaComparativa> {
    return pedir('/conta/balanza/comparativa', BalanzaComparativaSchema, {
      params: { periodoA, periodoB, libro },
      ...opciones,
    })
  },

  /* ------------------------------------- Catálogos de presentación NIIF */

  /** GET /conta/clasificaciones-niif */
  listarClasificaciones(
    opciones: OpcionesLectura = {},
  ): Promise<ClasificacionNiif[]> {
    return pedir('/conta/clasificaciones-niif', ListaClasificaciones, opciones)
  },

  /** POST /conta/clasificaciones-niif */
  crearClasificacion(
    datos: SolicitudClasificacionNiif,
  ): Promise<ClasificacionNiif> {
    return pedir('/conta/clasificaciones-niif', ClasificacionNiifSchema, {
      metodo: 'POST',
      cuerpo: datos,
    })
  },

  /** PUT /conta/clasificaciones-niif/:id */
  actualizarClasificacion(
    id: string,
    datos: SolicitudClasificacionNiif,
  ): Promise<ClasificacionNiif> {
    return pedir(`/conta/clasificaciones-niif/${id}`, ClasificacionNiifSchema, {
      metodo: 'PUT',
      cuerpo: datos,
    })
  },

  /** DELETE /conta/clasificaciones-niif/:id */
  async eliminarClasificacion(id: string): Promise<void> {
    await pedir(`/conta/clasificaciones-niif/${id}`, z.undefined(), {
      metodo: 'DELETE',
    })
  },

  /** GET /conta/notas-eeff */
  listarNotas(opciones: OpcionesLectura = {}): Promise<NotaEeff[]> {
    return pedir('/conta/notas-eeff', ListaNotas, opciones)
  },

  /** POST /conta/notas-eeff */
  crearNota(datos: SolicitudNotaEeff): Promise<NotaEeff> {
    return pedir('/conta/notas-eeff', NotaEeffSchema, {
      metodo: 'POST',
      cuerpo: datos,
    })
  },

  /** PUT /conta/notas-eeff/:id */
  actualizarNota(id: string, datos: SolicitudNotaEeff): Promise<NotaEeff> {
    return pedir(`/conta/notas-eeff/${id}`, NotaEeffSchema, {
      metodo: 'PUT',
      cuerpo: datos,
    })
  },

  /** DELETE /conta/notas-eeff/:id */
  async eliminarNota(id: string): Promise<void> {
    await pedir(`/conta/notas-eeff/${id}`, z.undefined(), { metodo: 'DELETE' })
  },
}
