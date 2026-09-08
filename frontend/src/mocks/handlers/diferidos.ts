import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import { rutaApi } from '@/shared/api/entorno'
import { latencia } from '../latencia'
import type {
  CorridaDiferidosHistorial,
  Diferido,
  PrevisualizacionCorridaDiferidos,
  ResultadoCancelacion,
  ResultadoCorridaDiferidos,
} from '@/shared/api/contracts/diferidos'
import {
  SolicitudCancelacionDiferidoSchema,
  SolicitudCorridaDiferidosSchema,
  SolicitudDiferidoSchema,
} from '@/shared/api/contracts/diferidos'
import {
  armarAsientoCancelacion,
  armarAsientoCorrida,
  calcularCorrida,
  cuotaNominal,
  validarCancelacion,
  validarDiferido,
  validarEdicion,
  MODULO_ORIGEN,
  TIPO_ORIGEN_AMORTIZACION,
  type ContextoCorrida,
  type ResultadoDiferido,
} from '@/modules/diferidos/domain/diferido'
import { monedaFuncional } from '@/shared/money/money'
import { CUENTAS } from '../seed/cuentas'
import { PERIODOS } from '../seed/periodos'
import { ASIENTOS } from '../seed/asientos'
import {
  diferidosMock,
  persistirDiferidos,
  siguienteCodigoDiferido,
} from '../seed/diferidos'
import { emitirAsiento } from './conta'

/**
 * Mock de asientos diferidos (docs/15).
 *
 * Dos decisiones de diseño se ven aquí y no en el dominio, porque son sobre
 * cuándo se escribe en el mayor y no sobre cómo se calcula:
 *
 * - **El alta no contabiliza nada** (docs/15 §3.1). El diferido no crea el
 *   hecho económico, lo ordena en el tiempo: la factura de CxP que pagó la
 *   póliza o la de CxC que cobró el mantenimiento ya hizo su asiento y ya dejó
 *   el importe en la cuenta de balance. Un asiento de alta lo duplicaría, igual
 *   que duplicaría el activo un alta desde factura en activos fijos.
 * - **La cancelación sí contabiliza**, de golpe y por todo el remanente
 *   (docs/15 §3.4). Un seguro cancelado a mitad de año ya no protege nada: lo
 *   que descansaba en el activo dejó de ser un activo ese día. Dejarlo ahí sin
 *   amortizar sería un saldo que ninguna cobertura futura explica.
 */

const diferidos = diferidosMock

function errorApi(codigo: string, mensaje: string, detalles: string[] = []) {
  return HttpResponse.json({ codigo, mensaje, detalles }, { status: 422 })
}

function noEncontrado(codigo: string, mensaje: string) {
  return HttpResponse.json({ codigo, mensaje }, { status: 404 })
}

function rechazar(resultado: ResultadoDiferido) {
  const principal = resultado.errores[0]
  return errorApi(
    principal.codigo,
    principal.mensaje,
    resultado.errores.map((e) => e.mensaje),
  )
}

/**
 * Corridas que ya están en el mayor, leídas del libro y no de las fichas.
 *
 * El mayor es la fuente de verdad de la idempotencia (docs/02 §4): la terna de
 * origen vive en el asiento, y es ahí donde hay que mirar para saber si un
 * periodo ya se corrió, aunque una ficha se hubiera editado o perdido.
 */
function corridasContabilizadas(): Map<string, string> {
  const mapa = new Map<string, string>()
  for (const asiento of ASIENTOS) {
    if (asiento.origenModulo !== MODULO_ORIGEN) continue
    if (asiento.origenTipo !== TIPO_ORIGEN_AMORTIZACION) continue
    if (!asiento.origenId) continue
    mapa.set(asiento.origenId, asiento.id)
  }
  return mapa
}

function contextoCorrida(): ContextoCorrida {
  return {
    periodos: PERIODOS,
    corridasContabilizadas: corridasContabilizadas(),
    cuentas: CUENTAS,
  }
}

/** Calcula la corrida y el asiento que la contabilizaría, sin escribir nada. */
function previsualizarCorrida(
  periodoId: string,
): PrevisualizacionCorridaDiferidos | null {
  const periodo = PERIODOS.find((p) => p.id === periodoId)
  if (!periodo) return null

  const moneda = monedaFuncional()
  const corrida = calcularCorrida(diferidos, periodo, moneda, contextoCorrida())
  const asiento =
    corrida.lineas.length > 0
      ? armarAsientoCorrida(corrida, diferidos, periodo, moneda)
      : null

  return { corrida, asiento }
}

/**
 * Historial de corridas, reconstruido desde las fichas.
 *
 * Cada diferido lleva sus cuotas contabilizadas; agrupar por periodo devuelve
 * la corrida entera con su total y su asiento, sin una tabla aparte que pueda
 * discrepar de las fichas.
 */
export function historialCorridas(): CorridaDiferidosHistorial[] {
  const porPeriodo = new Map<string, CorridaDiferidosHistorial>()
  for (const diferido of diferidos) {
    for (const cuota of diferido.amortizaciones ?? []) {
      const previa = porPeriodo.get(cuota.periodoId)
      if (previa) {
        previa.total = new Decimal(previa.total).plus(cuota.cuota).toFixed(2)
        previa.diferidos += 1
      } else {
        porPeriodo.set(cuota.periodoId, {
          periodoId: cuota.periodoId,
          fecha: cuota.fecha,
          total: new Decimal(cuota.cuota).toFixed(2),
          asientoId: cuota.asientoId,
          diferidos: 1,
        })
      }
    }
  }
  return [...porPeriodo.values()].sort((a, b) => b.fecha.localeCompare(a.fecha))
}

const handlersAmortizacion = [
  /** Previsualización: calcula, verifica y no escribe nada. */
  http.get(rutaApi('/diferidos/amortizacion'), async ({ request }) => {
    await latencia(200)
    const periodoId = new URL(request.url).searchParams.get('periodoId') ?? ''
    const previa = previsualizarCorrida(periodoId)
    return previa
      ? HttpResponse.json(previa)
      : noEncontrado('PERIODO_NO_ENCONTRADO', 'El periodo no existe')
  }),

  http.get(rutaApi('/diferidos/amortizacion/historial'), async () => {
    await latencia(120)
    return HttpResponse.json(historialCorridas())
  }),

  /**
   * Contabiliza la corrida.
   *
   * Recalcula sobre el estado vigente en vez de recibir la corrida calculada
   * por el cliente: lo que entra al mayor es lo que el servidor ve ahora, no lo
   * que alguien vio hace diez minutos en otra pestaña.
   */
  http.post(rutaApi('/diferidos/amortizacion'), async ({ request }) => {
    await latencia(450)

    const parsed = SolicitudCorridaDiferidosSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const { periodoId, confirmarAvisos } = parsed.data
    const periodo = PERIODOS.find((p) => p.id === periodoId)
    if (!periodo) {
      return noEncontrado('PERIODO_NO_ENCONTRADO', 'El periodo no existe')
    }

    // Idempotencia por origen (docs/15 §3.2): la segunda corrida del mismo
    // periodo no duplica el gasto, y se contesta con el asiento que ya existe.
    const yaContabilizada = corridasContabilizadas().get(periodo.id)
    if (yaContabilizada) {
      return HttpResponse.json(
        {
          codigo: 'CORRIDA_YA_CONTABILIZADA',
          mensaje: `La amortización del periodo ya está contabilizada en el asiento ${yaContabilizada}`,
          detalles: [yaContabilizada],
        },
        { status: 409 },
      )
    }

    const { corrida, asiento } = previsualizarCorrida(periodo.id)!
    const errores = corrida.verificaciones.filter((v) => v.severidad === 'error')
    const avisos = corrida.verificaciones.filter((v) => v.severidad === 'aviso')

    if (errores.length > 0 || !asiento) {
      return errorApi(
        'CORRIDA_CON_ERRORES',
        errores[0]?.mensaje ??
          'La corrida no tiene ninguna línea que contabilizar',
        (errores.length > 0 ? errores : avisos).map((v) => v.mensaje),
      )
    }
    if (avisos.length > 0 && !confirmarAvisos) {
      return errorApi(
        'CORRIDA_CON_AVISOS',
        'La corrida tiene avisos que hay que revisar antes de contabilizar',
        avisos.map((v) => v.mensaje),
      )
    }

    const emision = emitirAsiento(asiento)
    if (!emision.ok) {
      return errorApi(
        emision.error.codigo,
        emision.error.mensaje,
        emision.error.detalles,
      )
    }

    // Las fichas solo cambian si el mayor aceptó el asiento: un saldo por
    // amortizar que baje sin su asiento deja de explicar la cuenta de balance.
    let actualizados = 0
    for (const linea of corrida.lineas) {
      const diferido = diferidos.find((d) => d.id === linea.diferidoId)
      if (!diferido) continue
      diferido.montoAmortizado = linea.montoAmortizadoResultante
      diferido.saldoPorAmortizar = linea.saldoResultante
      if (linea.ultimaCuota) diferido.estado = 'agotado'
      diferido.amortizaciones = [
        ...(diferido.amortizaciones ?? []),
        {
          periodoId: periodo.id,
          fecha: periodo.fechaFin,
          cuota: linea.cuota,
          asientoId: emision.asiento.id,
        },
      ]
      actualizados += 1
    }
    persistirDiferidos()

    const resultado: ResultadoCorridaDiferidos = {
      corrida,
      asientoId: emision.asiento.id,
      asientoNumero: emision.asiento.numero,
      diferidosActualizados: actualizados,
    }
    return HttpResponse.json(resultado, { status: 201 })
  }),
]

export const handlersDiferidos = [
  // Van antes de `/diferidos/:id`: `amortizacion` no es el id de un diferido.
  ...handlersAmortizacion,

  http.get(rutaApi('/diferidos'), async ({ request }) => {
    await latencia(140)
    const estado = new URL(request.url).searchParams.get('estado')
    const resultado = estado
      ? diferidos.filter((d) => d.estado === estado)
      : [...diferidos]
    return HttpResponse.json(
      resultado.sort((a, b) => a.codigo.localeCompare(b.codigo)),
    )
  }),

  http.get(rutaApi('/diferidos/:id'), async ({ params }) => {
    await latencia(100)
    const diferido = diferidos.find((d) => d.id === params.id)
    return diferido
      ? HttpResponse.json(diferido)
      : noEncontrado('DIFERIDO_NO_ENCONTRADO', 'El diferido no existe')
  }),

  /**
   * Alta. No genera asiento (docs/15 §3.1).
   *
   * El importe ya está en la cuenta de balance porque lo puso el documento que
   * originó el diferido. Lo que se registra aquí es el plan de reconocimiento,
   * y lo que contabiliza es la corrida mensual.
   */
  http.post(rutaApi('/diferidos'), async ({ request }) => {
    await latencia(350)

    const parsed = SolicitudDiferidoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = parsed.data
    const resultado = validarDiferido(solicitud, {
      cuentas: CUENTAS,
      periodos: PERIODOS,
    })
    if (!resultado.valido) return rechazar(resultado)

    const codigo = siguienteCodigoDiferido()
    const monto = new Decimal(solicitud.monto).toFixed(2)
    const diferido: Diferido = {
      id: `dif-${codigo.replace(/\D/g, '')}`,
      codigo,
      tipo: solicitud.tipo,
      descripcion: solicitud.descripcion.trim(),
      tercero: solicitud.tercero,
      monto,
      moneda: solicitud.moneda,
      cuentaDiferido: solicitud.cuentaDiferido,
      cuentaDestino: solicitud.cuentaDestino,
      fechaInicio: solicitud.fechaInicio,
      plazoMeses: solicitud.plazoMeses,
      cuotaMensual: cuotaNominal(
        monto,
        solicitud.plazoMeses,
        solicitud.moneda,
      ).toApi(),
      montoAmortizado: '0.00',
      saldoPorAmortizar: monto,
      estado: 'vigente',
      cancelacion: null,
      origen: solicitud.origen ?? null,
      amortizaciones: [],
      creadoEn: new Date().toISOString(),
    }

    diferidos.push(diferido)
    persistirDiferidos()
    return HttpResponse.json(diferido, { status: 201 })
  }),

  /**
   * Edición, solo mientras no tenga cuotas contabilizadas (docs/15 §3.3).
   *
   * Cambiar el monto o el plazo de un diferido ya amortizado dejaría el mayor
   * contando una cosa y la ficha otra: las cuotas que entraron salieron del
   * monto viejo. Para eso está la cancelación, que sí deja rastro contable.
   */
  http.put(rutaApi('/diferidos/:id'), async ({ params, request }) => {
    await latencia(300)

    const indice = diferidos.findIndex((d) => d.id === params.id)
    if (indice === -1) {
      return noEncontrado('DIFERIDO_NO_ENCONTRADO', 'El diferido no existe')
    }

    const edicion = validarEdicion(diferidos[indice])
    if (!edicion.valido) return rechazar(edicion)

    const parsed = SolicitudDiferidoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = parsed.data
    const resultado = validarDiferido(solicitud, {
      cuentas: CUENTAS,
      periodos: PERIODOS,
    })
    if (!resultado.valido) return rechazar(resultado)

    const monto = new Decimal(solicitud.monto).toFixed(2)
    const actualizado: Diferido = {
      ...diferidos[indice],
      tipo: solicitud.tipo,
      descripcion: solicitud.descripcion.trim(),
      tercero: solicitud.tercero,
      monto,
      moneda: solicitud.moneda,
      cuentaDiferido: solicitud.cuentaDiferido,
      cuentaDestino: solicitud.cuentaDestino,
      fechaInicio: solicitud.fechaInicio,
      plazoMeses: solicitud.plazoMeses,
      cuotaMensual: cuotaNominal(
        monto,
        solicitud.plazoMeses,
        solicitud.moneda,
      ).toApi(),
      // Sin cuotas contabilizadas, el saldo es el monto entero: no hay nada
      // amortizado que respetar.
      montoAmortizado: '0.00',
      saldoPorAmortizar: monto,
    }
    diferidos[indice] = actualizado
    persistirDiferidos()
    return HttpResponse.json(actualizado)
  }),

  /**
   * Cancelación anticipada (docs/15 §3.4).
   *
   * Reconoce el saldo remanente de golpe en la fecha indicada. Es idempotente
   * por su terna de origen, igual que la corrida: reintentar la misma
   * cancelación devuelve el asiento que ya existe en vez de duplicarlo.
   */
  http.post(rutaApi('/diferidos/:id/cancelacion'), async ({ params, request }) => {
    await latencia(400)

    const diferido = diferidos.find((d) => d.id === params.id)
    if (!diferido) {
      return noEncontrado('DIFERIDO_NO_ENCONTRADO', 'El diferido no existe')
    }

    const parsed = SolicitudCancelacionDiferidoSchema.safeParse(
      await request.json(),
    )
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const { fecha, motivo } = parsed.data
    const validacion = validarCancelacion(diferido, fecha, PERIODOS)
    if (!validacion.valido) return rechazar(validacion)

    const remanente = new Decimal(diferido.saldoPorAmortizar)
    let asientoId: string | null = null

    if (remanente.greaterThan(0)) {
      const emision = emitirAsiento(
        armarAsientoCancelacion(diferido, fecha, monedaFuncional()),
      )
      if (!emision.ok) {
        return errorApi(
          emision.error.codigo,
          emision.error.mensaje,
          emision.error.detalles,
        )
      }
      asientoId = emision.asiento.id
    }

    // Todo lo que quedaba pasó a resultados: el saldo por amortizar cierra en
    // cero y el monto amortizado cuenta también el reconocimiento de golpe,
    // porque lo que mide es lo que ya no descansa en la cuenta de balance.
    diferido.montoAmortizado = new Decimal(diferido.montoAmortizado)
      .plus(remanente)
      .toFixed(2)
    diferido.saldoPorAmortizar = '0.00'
    diferido.estado = 'cancelado'
    diferido.cancelacion = {
      fecha,
      motivo: motivo.trim(),
      importeReconocido: remanente.toFixed(2),
      asientoId,
    }
    persistirDiferidos()

    const resultado: ResultadoCancelacion = { diferido, asientoId }
    return HttpResponse.json(resultado, { status: 201 })
  }),
]
