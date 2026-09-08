import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import { rutaApi } from '@/shared/api/entorno'
import { latencia } from '../latencia'
import {
  SolicitudMonedaSchema,
  SolicitudTipoCambioSchema,
} from '@/shared/api/contracts/config'
import type {
  MonedaBase,
  MonedaConfig,
  TipoCambio,
} from '@/shared/api/contracts/config'
import { tipoCambioVigente } from '@/shared/fiscal/tipoCambio'
import {
  aplicarFuncional,
  validarEliminacion,
  validarFuncional,
  validarMoneda,
  type ResultadoMoneda,
} from '@/modules/config/domain/moneda'
import { consultarTipoCambio } from '../hacienda'
import { monedasMock, persistirMonedas } from '../seed/monedas'
import { tiposCambioMock, persistirTiposCambio } from '../seed/tiposCambio'
import { CUENTAS } from '../seed/cuentas'
import { asientosMock } from './conta'

/**
 * Mock de la configuración de la empresa.
 *
 * Aplica las mismas reglas que aplicará la API reutilizando el dominio del
 * módulo. Un mock permisivo produce una pantalla que solo funciona con datos
 * perfectos y que se rompe el día que se conecta el backend real.
 */

/**
 * ¿Hay algo contabilizado en esta moneda?
 *
 * Cuentas del catálogo denominadas en ella, o asientos ya registrados. Es lo
 * que separa "desactivar" de "eliminar".
 */
function enUso(codigo: string): boolean {
  if (CUENTAS.some((c) => c.moneda === codigo)) return true
  return asientosMock.some((a) => a.moneda === codigo)
}

/** Añade los campos derivados que el contrato promete. */
function serializar(moneda: MonedaBase): MonedaConfig {
  return { ...moneda, enUso: enUso(moneda.codigo) }
}

function catalogo(): MonedaConfig[] {
  return monedasMock.map(serializar)
}

function contexto(codigo: string) {
  return { monedas: monedasMock, enUso: enUso(codigo) }
}

function solicitudInvalida(detalles: string[]) {
  return HttpResponse.json(
    {
      codigo: 'SOLICITUD_INVALIDA',
      mensaje: 'La solicitud no cumple el contrato',
      detalles,
    },
    { status: 422 },
  )
}

function rechazar(resultado: ResultadoMoneda) {
  const principal = resultado.errores[0]
  return HttpResponse.json(
    {
      codigo: principal.codigo,
      mensaje: principal.mensaje,
      detalles: resultado.errores.map((e) => e.mensaje),
    },
    { status: 422 },
  )
}

function noEncontrada(codigo: string) {
  return HttpResponse.json(
    {
      codigo: 'MONEDA_NO_ENCONTRADA',
      mensaje: `La moneda ${codigo} no está en el catálogo`,
    },
    { status: 404 },
  )
}

/** Reemplaza el contenido sin cambiar la referencia que otros módulos importan. */
function reemplazarCatalogo(nuevo: MonedaBase[]): void {
  monedasMock.splice(0, monedasMock.length, ...nuevo)
  persistirMonedas()
}

/* ------------------------------------------ Tipo de cambio con fecha */

/**
 * La serie de una moneda, de la más reciente a la más antigua.
 *
 * El rango es opcional en los dos extremos: sin él se sirve la serie entera,
 * que es lo que la pantalla necesita para enseñar el histórico de una moneda.
 */
function serieTipoCambio(
  moneda: string,
  desde: string | null,
  hasta: string | null,
): TipoCambio[] {
  return tiposCambioMock
    .filter(
      (t) =>
        t.moneda === moneda &&
        (!desde || t.fecha >= desde) &&
        (!hasta || t.fecha <= hasta),
    )
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
}

export const handlersConfig = [
  /**
   * Serie de tipos de cambio de una moneda por rango de fechas (docs/13 §7).
   *
   * Es la tabla `TipoCambio` de docs/10 §2, la que sirve para contabilizar: el
   * campo `tipoCambio` del catálogo de monedas es solo la referencia vigente y
   * no tiene fecha.
   */
  http.get(rutaApi('/config/tipos-cambio'), async ({ request }) => {
    await latencia(120)
    const url = new URL(request.url)
    const moneda = (url.searchParams.get('moneda') ?? '').toUpperCase()
    if (!moneda) {
      return HttpResponse.json(
        {
          codigo: 'MONEDA_REQUERIDA',
          mensaje: 'Indique la moneda cuya serie se consulta',
        },
        { status: 422 },
      )
    }
    return HttpResponse.json(
      serieTipoCambio(
        moneda,
        url.searchParams.get('desde'),
        url.searchParams.get('hasta'),
      ),
    )
  }),

  /**
   * El tipo de cambio que rige en una fecha.
   *
   * El de ese día, o el último anterior: el Banco Central no publica los
   * domingos ni los feriados, y un documento fechado un domingo se contabiliza
   * igual. Hacia adelante no se extrapola, y sin ningún valor anterior se
   * contesta con un error claro en vez de con un tipo inventado.
   */
  http.get(rutaApi('/config/tipos-cambio/vigente'), async ({ request }) => {
    await latencia(80)
    const url = new URL(request.url)
    const moneda = (url.searchParams.get('moneda') ?? '').toUpperCase()
    const fecha = url.searchParams.get('fecha') ?? ''

    const vigente = tipoCambioVigente(tiposCambioMock, moneda, fecha)
    if (!vigente) {
      return HttpResponse.json(
        {
          codigo: 'TIPO_CAMBIO_NO_DISPONIBLE',
          mensaje: `No hay ningún tipo de cambio de ${moneda} en la tabla al ${fecha} ni antes`,
          detalles: [
            'Capture el tipo de cambio de esa fecha antes de contabilizar el documento',
          ],
        },
        { status: 404 },
      )
    }
    return HttpResponse.json(vigente)
  }),

  /**
   * Captura manual de un tipo de cambio para una fecha.
   *
   * Actualiza si ya existe uno de esa moneda y esa fecha: la llave de la tabla
   * es (moneda, fecha) y dos valores para el mismo día no son historia, son una
   * contradicción. Lo que ya se contabilizó no cambia: el tipo de cambio queda
   * congelado en el asiento (docs/13 §7).
   */
  http.post(rutaApi('/config/tipos-cambio'), async ({ request }) => {
    await latencia(250)

    const parsed = SolicitudTipoCambioSchema.safeParse(await request.json())
    if (!parsed.success) {
      return solicitudInvalida(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = { ...parsed.data, moneda: parsed.data.moneda.toUpperCase() }
    if (!monedasMock.some((m) => m.codigo === solicitud.moneda)) {
      return noEncontrada(solicitud.moneda)
    }
    if (
      new Decimal(solicitud.compra).lessThanOrEqualTo(0) ||
      new Decimal(solicitud.venta).lessThanOrEqualTo(0)
    ) {
      return solicitudInvalida([
        'La compra y la venta tienen que ser mayores que cero',
      ])
    }

    // Lo que alguien teclea es un valor publicado que transcribe: se marca
    // como publicado. Lo derivado lo produce el sistema, nunca el usuario.
    const fila: TipoCambio = {
      moneda: solicitud.moneda,
      fecha: solicitud.fecha,
      compra: new Decimal(solicitud.compra).toFixed(2),
      venta: new Decimal(solicitud.venta).toFixed(2),
      origen: 'publicado',
      fuente: solicitud.fuente.trim(),
    }

    const indice = tiposCambioMock.findIndex(
      (t) => t.moneda === fila.moneda && t.fecha === fila.fecha,
    )
    if (indice === -1) tiposCambioMock.push(fila)
    else tiposCambioMock[indice] = fila
    persistirTiposCambio()

    return HttpResponse.json(fila, { status: indice === -1 ? 201 : 200 })
  }),

  http.get(rutaApi('/config/monedas'), async () => {
    await latencia(60)
    return HttpResponse.json(catalogo())
  }),

  /**
   * Tipos de cambio del día.
   *
   * El servidor es quien sale a Hacienda; la aplicación solo consulta su propia
   * API (docs/13 §8). Aquí hace de servidor el mock.
   */
  http.get(rutaApi('/config/tipo-cambio'), async () => {
    await latencia(400)
    try {
      return HttpResponse.json(await consultarTipoCambio())
    } catch (error) {
      // La fuente puede estar caída o haber cambiado de forma. Es un error de
      // negocio como cualquier otro: la pantalla lo dice y no aplica nada.
      return HttpResponse.json(
        {
          codigo: 'TIPO_CAMBIO_NO_DISPONIBLE',
          mensaje:
            'No se pudo consultar el tipo de cambio del Ministerio de Hacienda',
          detalles: [error instanceof Error ? error.message : String(error)],
        },
        { status: 503 },
      )
    }
  }),

  http.post(rutaApi('/config/monedas'), async ({ request }) => {
    await latencia(250)

    const parsed = SolicitudMonedaSchema.safeParse(await request.json())
    if (!parsed.success) {
      return solicitudInvalida(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = {
      ...parsed.data,
      codigo: parsed.data.codigo.toUpperCase(),
    }
    const resultado = validarMoneda(solicitud, contexto(solicitud.codigo), true)
    if (!resultado.valido) return rechazar(resultado)

    // Una moneda nace siempre no funcional: la funcional se designa aparte.
    const nueva: MonedaBase = { ...solicitud, funcional: false }
    monedasMock.push(nueva)
    persistirMonedas()
    return HttpResponse.json(serializar(nueva), { status: 201 })
  }),

  http.put(rutaApi('/config/monedas/:codigo'), async ({ params, request }) => {
    await latencia(250)

    const codigo = String(params.codigo).toUpperCase()
    const indice = monedasMock.findIndex((m) => m.codigo === codigo)
    if (indice === -1) return noEncontrada(codigo)

    const parsed = SolicitudMonedaSchema.safeParse(await request.json())
    if (!parsed.success) {
      return solicitudInvalida(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    // El código es la llave del catálogo: la ruta manda sobre el cuerpo.
    const solicitud = { ...parsed.data, codigo }
    const resultado = validarMoneda(solicitud, contexto(codigo), false)
    if (!resultado.valido) return rechazar(resultado)

    const actualizada: MonedaBase = {
      ...solicitud,
      funcional: monedasMock[indice].funcional,
    }
    monedasMock[indice] = actualizada
    persistirMonedas()
    return HttpResponse.json(serializar(actualizada))
  }),

  http.put(rutaApi('/config/monedas/:codigo/funcional'), async ({ params }) => {
    await latencia(250)

    const codigo = String(params.codigo).toUpperCase()
    const resultado = validarFuncional(codigo, contexto(codigo))
    if (!resultado.valido) {
      return resultado.errores[0].codigo === 'MONEDA_NO_ENCONTRADA'
        ? noEncontrada(codigo)
        : rechazar(resultado)
    }

    reemplazarCatalogo(aplicarFuncional(codigo, monedasMock))
    return HttpResponse.json(catalogo())
  }),

  http.delete(rutaApi('/config/monedas/:codigo'), async ({ params }) => {
    await latencia(250)

    const codigo = String(params.codigo).toUpperCase()
    const resultado = validarEliminacion(codigo, contexto(codigo))
    if (!resultado.valido) {
      return resultado.errores[0].codigo === 'MONEDA_NO_ENCONTRADA'
        ? noEncontrada(codigo)
        : rechazar(resultado)
    }

    reemplazarCatalogo(monedasMock.filter((m) => m.codigo !== codigo))
    return new HttpResponse(null, { status: 204 })
  }),
]
