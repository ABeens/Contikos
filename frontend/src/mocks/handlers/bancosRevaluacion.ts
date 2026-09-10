import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import { rutaApi } from '@/shared/api/entorno'
import { latencia } from '../latencia'
import type {
  CuentaBancaria,
  PrevisualizacionRevaluacion,
  ResultadoRevaluacion,
} from '@/shared/api/contracts/bancos'
import { SolicitudRevaluacionSchema } from '@/shared/api/contracts/bancos'
import type { Asiento, Periodo } from '@/shared/api/contracts/conta'
import {
  armarAsientoRevaluacion,
  calcularRevaluacion,
  origenRevaluacion,
  TIPO_ORIGEN_REVALUACION,
} from '@/modules/bancos/domain/revaluacion'
import { MODULO_ORIGEN } from '@/modules/bancos/domain/movimiento'
import { tipoCambioVigente } from '@/shared/fiscal/tipoCambio'
import { monedaFuncional } from '@/shared/money/money'
import { PERIODOS } from '../seed/periodos'
import { ASIENTOS } from '../seed/asientos'
import { tiposCambioMock } from '../seed/tiposCambio'
import { MAPEO_BANCOS } from '../seed/bancos'
import { cuentasBancariasServidas } from './bancos'
import { emitirAsiento } from './conta'

/**
 * Mock de la revaluación de saldos en moneda extranjera (docs/06 §6).
 *
 * Se engancha en el cierre de periodo, que es donde el diseño la pone, y sigue
 * el mismo patrón que la depreciación y la amortización de diferidos: se
 * previsualiza, se revisa y se contabiliza, y la corrida es idempotente por
 * periodo.
 *
 * Lo que este archivo aporta, y que el dominio no puede saber, es **el saldo
 * que el mayor lleva de cada cuenta bancaria**. Es lo que se revalúa. Calcular
 * la diferencia contra el saldo del auxiliar y no contra el del libro
 * produciría un asiento que deja la cuenta de control en un valor que su
 * auxiliar no explica.
 */

/**
 * Saldo en moneda funcional que el mayor lleva de cada cuenta bancaria.
 *
 * Se lee del libro y no del auxiliar, agrupando por el auxiliar de las líneas
 * que tocan cuentas de bancos. Es la mitad funcional del par que la
 * revaluación cuadra.
 */
function saldoFuncionalPorCuenta(
  hasta: string,
  asientos: readonly Asiento[],
): Map<string, string> {
  const saldos = new Map<string, Decimal>()

  for (const asiento of asientos) {
    if (asiento.fecha > hasta) continue
    for (const linea of asiento.lineas) {
      if (linea.auxiliarTipo !== 'banco' || linea.auxiliarId === null) continue
      const previo = saldos.get(linea.auxiliarId) ?? new Decimal(0)
      saldos.set(
        linea.auxiliarId,
        previo.plus(linea.cargo).minus(linea.abono),
      )
    }
  }

  return new Map(
    [...saldos.entries()].map(([id, saldo]) => [id, saldo.toFixed(2)]),
  )
}

/**
 * Tipo de cambio de cierre por moneda.
 *
 * El del último día del periodo o el último anterior, que es la regla de la
 * tabla con fecha (docs/13 §7). Se toma el de compra porque un saldo bancario
 * es un activo, que es como se valúan los activos en moneda extranjera.
 */
function tiposDeCierre(
  cuentas: readonly CuentaBancaria[],
  fecha: string,
): Map<string, string> {
  const funcional = monedaFuncional()
  const tipos = new Map<string, string>()

  for (const cuenta of cuentas) {
    if (cuenta.moneda === funcional || tipos.has(cuenta.moneda)) continue
    const vigente = tipoCambioVigente(tiposCambioMock, cuenta.moneda, fecha)
    if (vigente) tipos.set(cuenta.moneda, vigente.compra)
  }

  return tipos
}

function previsualizar(periodo: Periodo): PrevisualizacionRevaluacion {
  const cuentas = cuentasBancariasServidas()
  const corrida = calcularRevaluacion(periodo, {
    cuentasBancarias: cuentas,
    saldoFuncionalPorCuenta: saldoFuncionalPorCuenta(periodo.fechaFin, ASIENTOS),
    tipoCambioPorMoneda: tiposDeCierre(cuentas, periodo.fechaFin),
    monedaFuncional: monedaFuncional(),
    mapeo: MAPEO_BANCOS,
  })

  return { corrida, asiento: armarAsientoRevaluacion(corrida, MAPEO_BANCOS) }
}

/** Corridas ya en el mayor, leídas del libro y no de ninguna ficha. */
export function revaluacionContabilizada(periodoId: string): string | null {
  const origen = origenRevaluacion(periodoId)
  return (
    ASIENTOS.find(
      (a) =>
        a.origenModulo === MODULO_ORIGEN &&
        a.origenTipo === TIPO_ORIGEN_REVALUACION &&
        a.origenId === origen,
    )?.id ?? null
  )
}

/** Cuántas cuentas activas se revaluarían: cero es que no hay nada que correr. */
export function cuentasEnMonedaExtranjera(): number {
  const funcional = monedaFuncional()
  return cuentasBancariasServidas().filter(
    (c) => c.activa && c.moneda !== funcional,
  ).length
}

export const handlersBancosRevaluacion = [
  http.get(rutaApi('/bancos/revaluacion'), async ({ request }) => {
    await latencia(220)
    const periodoId = new URL(request.url).searchParams.get('periodoId') ?? ''
    const periodo = PERIODOS.find((p) => p.id === periodoId)
    if (!periodo) {
      return HttpResponse.json(
        { codigo: 'PERIODO_NO_ENCONTRADO', mensaje: 'El periodo no existe' },
        { status: 404 },
      )
    }
    return HttpResponse.json(previsualizar(periodo))
  }),

  http.post(rutaApi('/bancos/revaluacion'), async ({ request }) => {
    await latencia(420)

    const parsed = SolicitudRevaluacionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return HttpResponse.json(
        {
          codigo: 'SOLICITUD_INVALIDA',
          mensaje: 'La solicitud no cumple el contrato',
          detalles: parsed.error.issues.map(
            (i) => `${i.path.join('.')}: ${i.message}`,
          ),
        },
        { status: 422 },
      )
    }

    const periodo = PERIODOS.find((p) => p.id === parsed.data.periodoId)
    if (!periodo) {
      return HttpResponse.json(
        { codigo: 'PERIODO_NO_ENCONTRADO', mensaje: 'El periodo no existe' },
        { status: 404 },
      )
    }

    // Idempotencia por periodo (docs/02 §4): la segunda corrida del mismo mes
    // no duplica el resultado cambiario.
    const yaContabilizada = revaluacionContabilizada(periodo.id)
    if (yaContabilizada) {
      return HttpResponse.json(
        {
          codigo: 'REVALUACION_YA_CONTABILIZADA',
          mensaje: `La revaluación del periodo ya está contabilizada en el asiento ${yaContabilizada}`,
          detalles: [yaContabilizada],
        },
        { status: 409 },
      )
    }

    const { corrida, asiento } = previsualizar(periodo)
    if (!asiento) {
      return HttpResponse.json(
        {
          codigo: 'REVALUACION_SIN_DIFERENCIA',
          mensaje:
            'No hay ninguna diferencia que reconocer: no se emite un asiento vacío',
          detalles: [],
        },
        { status: 422 },
      )
    }

    const emision = emitirAsiento(asiento)
    if (!emision.ok) {
      return HttpResponse.json(
        {
          codigo: emision.error.codigo,
          mensaje: emision.error.mensaje,
          detalles: emision.error.detalles,
        },
        { status: 422 },
      )
    }

    const resultado: ResultadoRevaluacion = {
      corrida,
      asientoId: emision.asiento.id,
      asientoNumero: emision.asiento.numero,
    }
    return HttpResponse.json(resultado, { status: 201 })
  }),
]
