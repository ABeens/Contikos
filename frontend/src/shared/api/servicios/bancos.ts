import { z } from 'zod'
import {
  ConciliacionSchema,
  CuentaBancariaSchema,
  FormatoImportacionSchema,
  MovimientoEstadoCuentaSchema,
  ResultadoImportacionSchema,
  ResumenConciliacionSchema,
  MapeoBancosSchema,
  PrevisualizacionRevaluacionSchema,
  ResultadoRevaluacionSchema,
  MovimientoBancarioSchema,
  PosicionTesoreriaSchema,
  ResultadoMovimientoSchema,
  type CuentaBancaria,
  type EstadoMovimiento,
  type MapeoBancos,
  type MovimientoBancario,
  type PosicionTesoreria,
  type ResultadoMovimiento,
  type SolicitudComision,
  type Conciliacion,
  type FormatoImportacion,
  type MovimientoEstadoCuenta,
  type ResultadoImportacion,
  type ResumenConciliacion,
  type SolicitudCierreConciliacion,
  type SolicitudCuentaBancaria,
  type SolicitudEmparejamiento,
  type SolicitudImportacion,
  type PrevisualizacionRevaluacion,
  type ResultadoRevaluacion,
  type SolicitudInteres,
  type SolicitudRevaluacion,
  type SolicitudTraspaso,
} from '../contracts/bancos'
import { pedir, type OpcionesLectura } from './base'

/**
 * Tesorería: cuentas bancarias, movimientos propios y posición (docs/06).
 *
 * Las tres altas de movimiento son endpoints distintos y no uno con un campo
 * `tipo`. No es una preferencia de estilo: una comisión, un interés y un
 * traspaso se capturan con datos distintos, se validan distinto y generan
 * asientos distintos. Un único endpoint obligaría a un cuerpo donde la mitad de
 * los campos sobran siempre, y a que el servidor descubriera qué le mandaron
 * antes de poder validarlo.
 */

const ListaCuentas = z.array(CuentaBancariaSchema)
const ListaMovimientos = z.array(MovimientoBancarioSchema)
const ListaEstadoCuenta = z.array(MovimientoEstadoCuentaSchema)
const ListaFormatos = z.array(FormatoImportacionSchema)
const ListaConciliaciones = z.array(ConciliacionSchema)

export const servicioBancos = {
  /** GET /bancos/cuentas */
  listarCuentas(
    filtro: { soloActivas?: boolean } = {},
    opciones: OpcionesLectura = {},
  ): Promise<CuentaBancaria[]> {
    return pedir('/bancos/cuentas', ListaCuentas, {
      params: { activas: filtro.soloActivas ? 'true' : undefined },
      ...opciones,
    })
  },

  /** POST /bancos/cuentas */
  crearCuenta(solicitud: SolicitudCuentaBancaria): Promise<CuentaBancaria> {
    return pedir('/bancos/cuentas', CuentaBancariaSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /**
   * PUT /bancos/cuentas/:id
   *
   * La cuenta de control y la moneda quedan congeladas en cuanto la cuenta
   * tiene movimientos: cambiarlas dejaría los movimientos viejos apuntando a
   * una cuenta del mayor y los nuevos a otra.
   */
  actualizarCuenta(
    id: string,
    solicitud: SolicitudCuentaBancaria,
  ): Promise<CuentaBancaria> {
    return pedir(`/bancos/cuentas/${id}`, CuentaBancariaSchema, {
      metodo: 'PUT',
      cuerpo: solicitud,
    })
  },

  /** GET /bancos/mapeo — las cuentas de los roles de docs/06 §5. */
  mapeo(opciones: OpcionesLectura = {}): Promise<MapeoBancos> {
    return pedir('/bancos/mapeo', MapeoBancosSchema, opciones)
  },

  /**
   * GET /bancos/movimientos
   *
   * Lo que registró la empresa. Es una de las dos tablas de movimientos del
   * módulo; la otra, la del estado de cuenta, tiene su propio endpoint porque
   * es otro universo (docs/06 §1).
   */
  listarMovimientos(
    filtro: { cuentaBancariaId?: string; estado?: EstadoMovimiento } = {},
    opciones: OpcionesLectura = {},
  ): Promise<MovimientoBancario[]> {
    return pedir('/bancos/movimientos', ListaMovimientos, {
      params: {
        cuentaBancariaId: filtro.cuentaBancariaId,
        estado: filtro.estado,
      },
      ...opciones,
    })
  },

  /** POST /bancos/movimientos/comision */
  registrarComision(solicitud: SolicitudComision): Promise<ResultadoMovimiento> {
    return pedir('/bancos/movimientos/comision', ResultadoMovimientoSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /** POST /bancos/movimientos/interes */
  registrarInteres(solicitud: SolicitudInteres): Promise<ResultadoMovimiento> {
    return pedir('/bancos/movimientos/interes', ResultadoMovimientoSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /** POST /bancos/movimientos/traspaso — devuelve los dos movimientos. */
  registrarTraspaso(solicitud: SolicitudTraspaso): Promise<ResultadoMovimiento> {
    return pedir('/bancos/movimientos/traspaso', ResultadoMovimientoSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /** GET /bancos/posicion — dónde está el dinero, ahora mismo. */
  posicion(opciones: OpcionesLectura = {}): Promise<PosicionTesoreria> {
    return pedir('/bancos/posicion', PosicionTesoreriaSchema, opciones)
  },

  /* ------------------------------------------------- Estado de cuenta */

  /** GET /bancos/formatos — los lectores de archivo disponibles. */
  formatos(opciones: OpcionesLectura = {}): Promise<FormatoImportacion[]> {
    return pedir('/bancos/formatos', ListaFormatos, opciones)
  },

  /**
   * GET /bancos/estado-cuenta
   *
   * Lo que dice el banco. Es la segunda tabla de movimientos y tiene su propio
   * endpoint porque es otro universo: nada de esto está en el mayor (docs/06 §1).
   */
  listarEstadoCuenta(
    filtro: { cuentaBancariaId?: string; sinConciliar?: boolean } = {},
    opciones: OpcionesLectura = {},
  ): Promise<MovimientoEstadoCuenta[]> {
    return pedir('/bancos/estado-cuenta', ListaEstadoCuenta, {
      params: {
        cuentaBancariaId: filtro.cuentaBancariaId,
        sinConciliar: filtro.sinConciliar ? 'true' : undefined,
      },
      ...opciones,
    })
  },

  /**
   * POST /bancos/estado-cuenta
   *
   * Importa un archivo. Es idempotente por la huella de cada línea: recargar
   * el mismo archivo o traslapar fechas no duplica movimientos (docs/06 §2.2).
   */
  importarEstadoCuenta(
    solicitud: SolicitudImportacion,
  ): Promise<ResultadoImportacion> {
    return pedir('/bancos/estado-cuenta', ResultadoImportacionSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /* ----------------------------------------------------- Conciliación */

  /**
   * GET /bancos/conciliacion
   *
   * La conciliación a una fecha de corte, calculada sobre el estado vigente:
   * saldos, partidas conciliatorias y las sugerencias del motor.
   */
  conciliacion(
    consulta: {
      cuentaBancariaId: string
      fechaCorte: string
      saldoBanco?: string
    },
    opciones: OpcionesLectura = {},
  ): Promise<ResumenConciliacion> {
    return pedir('/bancos/conciliacion', ResumenConciliacionSchema, {
      params: consulta,
      ...opciones,
    })
  },

  /** POST /bancos/conciliacion/emparejamientos — casa lo propio con lo del banco. */
  emparejar(solicitud: SolicitudEmparejamiento): Promise<ResumenConciliacion> {
    return pedir(
      '/bancos/conciliacion/emparejamientos',
      ResumenConciliacionSchema,
      { metodo: 'POST', cuerpo: solicitud },
    )
  },

  /**
   * DELETE /bancos/conciliacion/emparejamientos/:id
   *
   * Deshace un emparejamiento. Todo lo que casa el motor es reversible
   * mientras la conciliación no se cierre (docs/06 §2.3).
   */
  deshacerEmparejamiento(
    movimientoBancoId: string,
  ): Promise<ResumenConciliacion> {
    return pedir(
      `/bancos/conciliacion/emparejamientos/${movimientoBancoId}`,
      ResumenConciliacionSchema,
      { metodo: 'DELETE' },
    )
  },

  /** POST /bancos/conciliacion/cierre — solo con diferencia cero. */
  cerrarConciliacion(
    solicitud: SolicitudCierreConciliacion,
  ): Promise<Conciliacion> {
    return pedir('/bancos/conciliacion/cierre', ConciliacionSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /* ------------------------------------------------------ Revaluación */

  /**
   * GET /bancos/revaluacion?periodoId=
   *
   * Verificación previa: calcula la corrida y el asiento que emitiría, sin
   * escribir nada. Es el mismo patrón que la depreciación y la amortización de
   * diferidos, y por la misma razón: lo que se revisa es lo que se contabiliza.
   */
  previsualizarRevaluacion(
    periodoId: string,
    opciones: OpcionesLectura = {},
  ): Promise<PrevisualizacionRevaluacion> {
    return pedir('/bancos/revaluacion', PrevisualizacionRevaluacionSchema, {
      params: { periodoId },
      ...opciones,
    })
  },

  /**
   * POST /bancos/revaluacion
   *
   * Contabiliza la corrida. Idempotente por periodo: la segunda vez responde
   * con el asiento que ya existe en vez de duplicar el resultado cambiario.
   */
  contabilizarRevaluacion(
    solicitud: SolicitudRevaluacion,
  ): Promise<ResultadoRevaluacion> {
    return pedir('/bancos/revaluacion', ResultadoRevaluacionSchema, {
      metodo: 'POST',
      cuerpo: solicitud,
    })
  },

  /** GET /bancos/conciliaciones — las ya cerradas. */
  listarConciliaciones(
    filtro: { cuentaBancariaId?: string } = {},
    opciones: OpcionesLectura = {},
  ): Promise<Conciliacion[]> {
    return pedir('/bancos/conciliaciones', ListaConciliaciones, {
      params: { cuentaBancariaId: filtro.cuentaBancariaId },
      ...opciones,
    })
  },
}
