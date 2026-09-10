import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import { rutaApi } from '@/shared/api/entorno'
import { latencia } from '../latencia'
import type {
  CuentaBancaria,
  CuentaBancariaBase,
  MovimientoBancario,
  PosicionCuenta,
  PosicionTesoreria,
  ResultadoMovimiento,
} from '@/shared/api/contracts/bancos'
import {
  SolicitudComisionSchema,
  SolicitudCuentaBancariaSchema,
  SolicitudInteresSchema,
  SolicitudTraspasoSchema,
} from '@/shared/api/contracts/bancos'
import type { SolicitudAsiento } from '@/shared/api/contracts/conta'
import {
  codigoDeId,
  normalizarSolicitud,
  serializarCuentaBancaria,
  siguienteIdCuentaBancaria,
  validarCuentaBancaria,
  type ErrorCuentaBancaria,
} from '@/modules/bancos/domain/cuentaBancaria'
import {
  armarAsientoComision,
  armarAsientoInteres,
  armarAsientoTraspaso,
  crearMovimiento,
  movimientoDeOrigen,
  siguienteIdMovimiento,
  validarComision,
  validarInteres,
  validarTraspaso,
  type ContextoMovimiento,
  type ErrorMovimiento,
} from '@/modules/bancos/domain/movimiento'
import { configuracionMoneda, monedaFuncional } from '@/shared/money/money'
import { CUENTAS } from '../seed/cuentas'
import { PERIODOS } from '../seed/periodos'
import {
  MAPEO_BANCOS,
  cuentasBancariasMock,
  movimientosBancariosMock,
  persistirCuentasBancarias,
  persistirMovimientosBancarios,
} from '../seed/bancos'
import { emitirAsiento } from './conta'

/**
 * Mock de tesorería (docs/06).
 *
 * Lo que este archivo decide, y que no es del dominio, es **quién escribe en el
 * mayor**. La regla del módulo es corta y explica todo lo demás:
 *
 * - Un movimiento que **nace aquí** (comisión, interés, traspaso) genera su
 *   asiento. Es el hecho económico y nadie más lo ha contabilizado.
 * - Un movimiento que **llega de otro módulo** (el cobro de CxC, el pago de
 *   CxP) NO genera asiento: el documento que lo originó ya lo escribió. Aquí
 *   solo se registra para poder conciliarlo, y por eso lleva encima el id del
 *   asiento ajeno en vez de uno propio.
 *
 * Confundir las dos cosas duplicaría el efectivo, que es el error más caro que
 * se puede cometer en un módulo de bancos.
 */

const cuentas = cuentasBancariasMock
const movimientos = movimientosBancariosMock

function errorApi(codigo: string, mensaje: string, detalles: string[] = []) {
  return HttpResponse.json({ codigo, mensaje, detalles }, { status: 422 })
}

function noEncontrado(codigo: string, mensaje: string) {
  return HttpResponse.json({ codigo, mensaje }, { status: 404 })
}

function rechazar(errores: readonly (ErrorCuentaBancaria | ErrorMovimiento)[]) {
  return errorApi(
    errores[0].codigo,
    errores[0].mensaje,
    errores.map((e) => e.mensaje),
  )
}

/**
 * Las fichas con sus derivados.
 *
 * Se exporta porque la necesitan otros módulos del mock: CxC y CxP ofrecen el
 * catálogo al capturar la cuenta de depósito o de salida, y la conciliación lo
 * consulta para saber contra qué cuenta está cruzando.
 */
export function cuentasBancariasServidas(): CuentaBancaria[] {
  return cuentas
    .map((c) => serializarCuentaBancaria(c, { cuentas: CUENTAS, movimientos }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
}

function contextoMovimiento(): ContextoMovimiento {
  return {
    cuentasBancarias: cuentasBancariasServidas(),
    cuentas: CUENTAS,
    periodos: PERIODOS,
    mapeo: MAPEO_BANCOS,
    monedaFuncional: monedaFuncional(),
  }
}

/* --------------------------------- Recepción de eventos de otros módulos */

export interface EventoMovimientoExterno {
  cuentaBancariaId: string
  fecha: string
  /** Con signo y en la moneda de la cuenta bancaria: + entra, − sale. */
  importe: string
  concepto: string
  referencia?: string | null
  origen: { modulo: 'cxc' | 'cxp'; tipo: string; id: string }
  /** El asiento que YA escribió el módulo de origen. */
  asientoId: string
}

/**
 * Registra en el auxiliar un movimiento que otro módulo ya contabilizó.
 *
 * La llaman los handlers de CxC y de CxP cuando contabilizan un cobro o un
 * pago contra una cuenta bancaria (docs/06 §2.1). No emite asiento y no puede
 * fallar la operación de quien la llama: si la cuenta bancaria no está en el
 * catálogo, se devuelve `null` y el cobro sigue su curso. Un cobro que ya está
 * en el mayor no se puede deshacer porque su auxiliar no cuadre, y dejarlo sin
 * registrar lo deja visible justo donde se ve: en la conciliación.
 *
 * Es idempotente por la terna de origen (docs/02 §4): recibir dos veces el
 * mismo cobro devuelve el movimiento que ya existe en vez de duplicar el
 * depósito.
 */
export function registrarMovimientoExterno(
  evento: EventoMovimientoExterno,
): MovimientoBancario | null {
  const existente = movimientoDeOrigen(
    movimientos,
    evento.origen.modulo,
    evento.origen.tipo,
    evento.origen.id,
  )
  if (existente) return existente

  const cuenta = cuentas.find((c) => c.id === evento.cuentaBancariaId)
  if (!cuenta) return null

  const importe = new Decimal(evento.importe)
  const movimiento = crearMovimiento({
    id: siguienteIdMovimiento(movimientos),
    cuentaBancariaId: cuenta.id,
    fecha: evento.fecha,
    tipo: importe.isNegative() ? 'retiro' : 'deposito',
    concepto: evento.concepto,
    referencia: evento.referencia ?? null,
    importe: importe.toFixed(2),
    origen: evento.origen,
    asientoId: evento.asientoId,
  })

  movimientos.push(movimiento)
  persistirMovimientosBancarios()
  return movimiento
}

/**
 * Deshace el registro de un evento externo.
 *
 * La usan la anulación de un cobro y la de un pago: si el asiento se reversa,
 * el movimiento que lo acompañaba deja de tener sentido. Un movimiento ya
 * conciliado no se borra, porque el estado de cuenta del banco sí lo registró:
 * lo que hay ahí es una devolución, y eso es otro movimiento.
 */
export function eliminarMovimientoExterno(
  modulo: string,
  tipo: string,
  id: string,
): boolean {
  const movimiento = movimientoDeOrigen(movimientos, modulo, tipo, id)
  if (!movimiento || movimiento.estado === 'conciliado') return false

  movimientos.splice(movimientos.indexOf(movimiento), 1)
  persistirMovimientosBancarios()
  return true
}

/* ------------------------------------------- Movimientos que nacen aquí */

interface EmisionMovimiento {
  asiento: SolicitudAsiento
  /** Uno por cuenta afectada: el traspaso mueve dos. */
  fichas: {
    cuentaBancariaId: string
    tipo: MovimientoBancario['tipo']
    importe: string
    concepto: string
  }[]
  referencia: string | null
  fecha: string
  origenId: string
}

/**
 * Contabiliza y registra en un solo paso.
 *
 * El orden importa: primero el asiento y solo después las fichas. Un
 * movimiento cuyo asiento fue rechazado sería un saldo en el auxiliar que el
 * mayor no explica, que es exactamente lo que la conciliación de docs/06 §4
 * existe para detectar y lo que no se debe crear a propósito.
 */
function emitir(emision: EmisionMovimiento) {
  const resultado = emitirAsiento(emision.asiento)
  if (!resultado.ok) {
    return {
      ok: false as const,
      respuesta: errorApi(
        resultado.error.codigo,
        resultado.error.mensaje,
        resultado.error.detalles,
      ),
    }
  }

  const nuevos: MovimientoBancario[] = []
  for (const ficha of emision.fichas) {
    const movimiento = crearMovimiento({
      id: siguienteIdMovimiento([...movimientos, ...nuevos]),
      cuentaBancariaId: ficha.cuentaBancariaId,
      fecha: emision.fecha,
      tipo: ficha.tipo,
      concepto: ficha.concepto,
      referencia: emision.referencia,
      importe: ficha.importe,
      origen: {
        modulo: 'bancos',
        tipo: emision.asiento.origen!.tipo,
        id: emision.origenId,
      },
      asientoId: resultado.asiento.id,
    })
    nuevos.push(movimiento)
  }

  movimientos.push(...nuevos)
  persistirMovimientosBancarios()

  const respuesta: ResultadoMovimiento = {
    movimientos: nuevos,
    asientoId: resultado.asiento.id,
    asientoNumero: resultado.asiento.numero,
  }
  return { ok: true as const, respuesta: HttpResponse.json(respuesta, { status: 201 }) }
}

/* ------------------------------------------------- Posición de tesorería */

function posicion(): PosicionTesoreria {
  const funcional = monedaFuncional()
  const servidas = cuentasBancariasServidas().filter((c) => c.activa)

  const filas: PosicionCuenta[] = servidas.map((cuenta) => {
    // El tipo de cambio de referencia del catálogo, no el de un documento: la
    // posición es una foto de hoy y no contabiliza nada. Lo que se convierte
    // para un asiento lleva el tipo del día del hecho (docs/13 §7).
    const tipoCambio =
      cuenta.moneda === funcional
        ? new Decimal(1)
        : new Decimal(configuracionMoneda(cuenta.moneda).tipoCambio)
    return {
      cuentaBancariaId: cuenta.id,
      codigo: cuenta.codigo,
      nombre: cuenta.nombre,
      banco: cuenta.banco,
      moneda: cuenta.moneda,
      saldoLibros: cuenta.saldoLibros,
      saldoFuncional: new Decimal(cuenta.saldoLibros)
        .times(tipoCambio)
        .toFixed(2),
      tipoCambio: tipoCambio.toFixed(2),
      saldoBanco: cuenta.saldoBanco,
      movimientosSinConciliar: cuenta.movimientosSinConciliar,
    }
  })

  return {
    moneda: funcional,
    cuentas: filas,
    total: filas
      .reduce((acc, f) => acc.plus(f.saldoFuncional), new Decimal(0))
      .toFixed(2),
    totalSinConciliar: filas.reduce(
      (acc, f) => acc + f.movimientosSinConciliar,
      0,
    ),
  }
}

/* ------------------------------------------------------------ Handlers */

const handlersMovimientos = [
  /**
   * Comisión bancaria.
   *
   * El identificador del movimiento se calcula antes de armar el asiento
   * porque es la llave de origen con la que ese asiento queda firmado: es lo
   * que permite llegar del asiento al movimiento y al revés.
   */
  http.post(rutaApi('/bancos/movimientos/comision'), async ({ request }) => {
    await latencia(350)

    const parsed = SolicitudComisionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = parsed.data
    const contexto = contextoMovimiento()
    const validacion = validarComision(solicitud, contexto)
    if (!validacion.valido) return rechazar(validacion.errores)

    const cuenta = contexto.cuentasBancarias.find(
      (c) => c.id === solicitud.cuentaBancariaId,
    )!
    const movimientoId = siguienteIdMovimiento(movimientos)
    const total = new Decimal(solicitud.importe).plus(solicitud.impuesto)

    const emision = emitir({
      asiento: armarAsientoComision(movimientoId, solicitud, cuenta, contexto),
      fichas: [
        {
          cuentaBancariaId: cuenta.id,
          tipo: 'comision',
          // La comisión sale de la cuenta: el signo lo pone el módulo y no el
          // usuario, que captura el importe que le cobraron.
          importe: total.negated().toFixed(2),
          concepto: solicitud.concepto,
        },
      ],
      referencia: solicitud.referencia ?? null,
      fecha: solicitud.fecha,
      origenId: movimientoId,
    })
    return emision.respuesta
  }),

  http.post(rutaApi('/bancos/movimientos/interes'), async ({ request }) => {
    await latencia(350)

    const parsed = SolicitudInteresSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = parsed.data
    const contexto = contextoMovimiento()
    const validacion = validarInteres(solicitud, contexto)
    if (!validacion.valido) return rechazar(validacion.errores)

    const cuenta = contexto.cuentasBancarias.find(
      (c) => c.id === solicitud.cuentaBancariaId,
    )!
    const movimientoId = siguienteIdMovimiento(movimientos)

    const emision = emitir({
      asiento: armarAsientoInteres(movimientoId, solicitud, cuenta, contexto),
      fichas: [
        {
          cuentaBancariaId: cuenta.id,
          tipo: 'interes',
          importe: new Decimal(solicitud.importe).toFixed(2),
          concepto: solicitud.concepto,
        },
      ],
      referencia: solicitud.referencia ?? null,
      fecha: solicitud.fecha,
      origenId: movimientoId,
    })
    return emision.respuesta
  }),

  /**
   * Traspaso entre cuentas propias.
   *
   * Genera DOS movimientos y UN asiento: el dinero no entra ni sale de la
   * empresa, cambia de sitio (docs/06 §2.1). Los dos movimientos comparten la
   * terna de origen, que es lo que permite reconocerlos como las dos caras del
   * mismo traspaso al conciliar cada cuenta por separado.
   */
  http.post(rutaApi('/bancos/movimientos/traspaso'), async ({ request }) => {
    await latencia(400)

    const parsed = SolicitudTraspasoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = parsed.data
    const contexto = contextoMovimiento()
    const validacion = validarTraspaso(solicitud, contexto)
    if (!validacion.valido) return rechazar(validacion.errores)

    const origen = contexto.cuentasBancarias.find(
      (c) => c.id === solicitud.cuentaOrigenId,
    )!
    const destino = contexto.cuentasBancarias.find(
      (c) => c.id === solicitud.cuentaDestinoId,
    )!
    const traspasoId = `tra-${siguienteIdMovimiento(movimientos).replace('mov-', '')}`

    const emision = emitir({
      asiento: armarAsientoTraspaso(
        traspasoId,
        solicitud,
        origen,
        destino,
        contexto,
      ),
      fichas: [
        {
          cuentaBancariaId: origen.id,
          tipo: 'transferencia',
          importe: new Decimal(solicitud.importeOrigen).negated().toFixed(2),
          concepto: `${solicitud.concepto} · hacia ${destino.codigo}`,
        },
        {
          cuentaBancariaId: destino.id,
          tipo: 'transferencia',
          importe: new Decimal(solicitud.importeDestino).toFixed(2),
          concepto: `${solicitud.concepto} · desde ${origen.codigo}`,
        },
      ],
      referencia: solicitud.referencia ?? null,
      fecha: solicitud.fecha,
      origenId: traspasoId,
    })
    return emision.respuesta
  }),

  http.get(rutaApi('/bancos/movimientos'), async ({ request }) => {
    await latencia(140)
    const params = new URL(request.url).searchParams
    const cuentaBancariaId = params.get('cuentaBancariaId')
    const estado = params.get('estado')

    const resultado = movimientos
      .filter((m) => !cuentaBancariaId || m.cuentaBancariaId === cuentaBancariaId)
      .filter((m) => !estado || m.estado === estado)
      // De la más reciente a la más antigua, que es como se lee una cuenta
      // bancaria: lo último que pasó arriba.
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id.localeCompare(a.id))

    return HttpResponse.json(resultado)
  }),
]

export const handlersBancos = [
  http.get(rutaApi('/bancos/mapeo'), async () => {
    await latencia(60)
    return HttpResponse.json(MAPEO_BANCOS)
  }),

  http.get(rutaApi('/bancos/posicion'), async () => {
    await latencia(160)
    return HttpResponse.json(posicion())
  }),

  // Van antes de `/bancos/cuentas/:id`: ninguna de estas rutas es el id de una
  // cuenta bancaria.
  ...handlersMovimientos,

  http.get(rutaApi('/bancos/cuentas'), async ({ request }) => {
    await latencia(120)
    const soloActivas =
      new URL(request.url).searchParams.get('activas') === 'true'
    const servidas = cuentasBancariasServidas()
    return HttpResponse.json(
      soloActivas ? servidas.filter((c) => c.activa) : servidas,
    )
  }),

  http.post(rutaApi('/bancos/cuentas'), async ({ request }) => {
    await latencia(300)

    const parsed = SolicitudCuentaBancariaSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = normalizarSolicitud(parsed.data)
    const validacion = validarCuentaBancaria(solicitud, {
      cuentas: CUENTAS,
      cuentasBancarias: cuentas,
      movimientos,
    })
    if (!validacion.valido) return rechazar(validacion.errores)

    const id = siguienteIdCuentaBancaria(cuentas)
    const nueva: CuentaBancariaBase = {
      id,
      codigo: codigoDeId(id),
      banco: solicitud.banco,
      nombre: solicitud.nombre,
      numeroCuenta: solicitud.numeroCuenta,
      iban: solicitud.iban ?? null,
      tipo: solicitud.tipo,
      moneda: solicitud.moneda,
      cuentaContable: solicitud.cuentaContable,
      saldoBanco: null,
      saldoBancoAl: null,
      activa: solicitud.activa,
    }

    cuentas.push(nueva)
    persistirCuentasBancarias()
    return HttpResponse.json(
      serializarCuentaBancaria(nueva, { cuentas: CUENTAS, movimientos }),
      { status: 201 },
    )
  }),

  http.put(rutaApi('/bancos/cuentas/:id'), async ({ params, request }) => {
    await latencia(280)

    const indice = cuentas.findIndex((c) => c.id === params.id)
    if (indice === -1) {
      return noEncontrado(
        'CUENTA_BANCARIA_NO_ENCONTRADA',
        'La cuenta bancaria no existe',
      )
    }

    const parsed = SolicitudCuentaBancariaSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = normalizarSolicitud(parsed.data)
    const validacion = validarCuentaBancaria(
      solicitud,
      { cuentas: CUENTAS, cuentasBancarias: cuentas, movimientos },
      cuentas[indice].id,
    )
    if (!validacion.valido) return rechazar(validacion.errores)

    const actualizada: CuentaBancariaBase = {
      ...cuentas[indice],
      banco: solicitud.banco,
      nombre: solicitud.nombre,
      numeroCuenta: solicitud.numeroCuenta,
      iban: solicitud.iban ?? null,
      tipo: solicitud.tipo,
      moneda: solicitud.moneda,
      cuentaContable: solicitud.cuentaContable,
      activa: solicitud.activa,
    }
    cuentas[indice] = actualizada
    persistirCuentasBancarias()

    return HttpResponse.json(
      serializarCuentaBancaria(actualizada, { cuentas: CUENTAS, movimientos }),
    )
  }),
]
