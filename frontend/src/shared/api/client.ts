import type { z } from 'zod'
import { ErrorApiSchema } from './contracts/comunes'
import { API_URL, TIEMPO_LIMITE_MS } from './entorno'

/**
 * Error de negocio de la API. Trae el código del contrato (docs/02 §3), que es
 * lo que permite a la UI reaccionar de forma específica — por ejemplo mostrar
 * "el periodo está cerrado" en vez de "algo salió mal".
 *
 * También transporta los fallos que no vienen del servidor sino del camino
 * hasta él (sin conexión, tiempo agotado). Van con `status: 0` y su propio
 * código: para la pantalla siguen siendo "no se pudo", y quien quiera
 * distinguirlos tiene `esReintentable`.
 */
export class ApiError extends Error {
  readonly codigo: string
  readonly status: number
  readonly detalles: string[]

  constructor(
    codigo: string,
    mensaje: string,
    status: number,
    detalles: string[] = [],
  ) {
    super(mensaje)
    this.name = 'ApiError'
    this.codigo = codigo
    this.status = status
    this.detalles = detalles
  }
}

/** Fallos del transporte, no del negocio. `status` es 0: no hubo respuesta. */
export const SIN_CONEXION = 'SIN_CONEXION'
export const TIEMPO_AGOTADO = 'TIEMPO_AGOTADO'

/**
 * ¿Tiene sentido reintentar este error?
 *
 * Un periodo cerrado o un asiento descuadrado no mejoran por insistir: son la
 * respuesta correcta a una solicitud incorrecta. Un corte de red, un tiempo
 * agotado o un 502 sí, y contra una API real son lo que de verdad ocurre. Con
 * el mock no pasaba ninguno de los dos, que es exactamente por lo que hay que
 * decidirlo antes de conectar el backend y no después.
 */
export function esReintentable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true
  if (error.codigo === SIN_CONEXION || error.codigo === TIEMPO_AGOTADO) {
    return true
  }
  return error.status >= 500
}

interface OpcionesPeticion {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  cuerpo?: unknown
  params?: Record<string, string | number | undefined>
  /** Empresa activa. Multiempresa: nunca se omite (docs/01 §4.1). */
  empresaId?: string
  signal?: AbortSignal
}

/**
 * Une la cancelación de quien llama con el tiempo límite.
 *
 * A mano y no con `AbortSignal.any`, que no está en todos los entornos donde
 * corre esto (jsdom incluido). Son diez líneas y funcionan en todos.
 */
function conTiempoLimite(externa: AbortSignal | undefined, ms: number) {
  const control = new AbortController()
  const porTiempo = () => control.abort(new Error('tiempo agotado'))
  const temporizador = setTimeout(porTiempo, ms)
  const porQuienLlama = () => control.abort(externa?.reason)

  if (externa?.aborted) porQuienLlama()
  else externa?.addEventListener('abort', porQuienLlama, { once: true })

  return {
    signal: control.signal,
    limpiar() {
      clearTimeout(temporizador)
      externa?.removeEventListener('abort', porQuienLlama)
    },
  }
}

/**
 * Cliente HTTP tipado.
 *
 * Los componentes nunca lo llaman directamente, ni siquiera los hooks: quien lo
 * usa es la capa de servicios (`shared/api/servicios/`), que es la que sabe qué
 * rutas existen. Eso es lo que permite cambiar el origen de los datos (hoy el
 * mock, mañana la API real) sin tocar una sola pantalla.
 */
export async function request<S extends z.ZodTypeAny>(
  ruta: string,
  schema: S,
  opciones: OpcionesPeticion = {},
): Promise<z.infer<S>> {
  const { metodo = 'GET', cuerpo, params, empresaId, signal } = opciones

  const url = new URL(`${API_URL}${ruta}`, window.location.origin)
  if (params) {
    for (const [clave, valor] of Object.entries(params)) {
      if (valor !== undefined) url.searchParams.set(clave, String(valor))
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json'
  if (empresaId) headers['X-Empresa-Id'] = empresaId

  const limite = conTiempoLimite(signal, TIEMPO_LIMITE_MS)

  let respuesta: Response
  try {
    respuesta = await fetch(url, {
      method: metodo,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: limite.signal,
    })
  } catch (error) {
    // Cancelación de quien llama (cambió de pantalla, cambió el filtro): no es
    // un fallo. Se propaga tal cual para que TanStack Query la reconozca como
    // consulta cancelada y no la pinte como error.
    if (signal?.aborted) throw error

    throw limite.signal.aborted
      ? new ApiError(
          TIEMPO_AGOTADO,
          'El servidor tardó demasiado en responder',
          0,
          [`Se esperó ${TIEMPO_LIMITE_MS} ms por ${metodo} ${ruta}`],
        )
      : new ApiError(
          SIN_CONEXION,
          'No se pudo contactar con el servidor',
          0,
          [error instanceof Error ? error.message : String(error)],
        )
  } finally {
    limite.limpiar()
  }

  if (!respuesta.ok) {
    let codigo = 'ERROR_DESCONOCIDO'
    let mensaje = `Error ${respuesta.status}`
    let detalles: string[] = []
    try {
      const parsed = ErrorApiSchema.safeParse(await respuesta.json())
      if (parsed.success) {
        codigo = parsed.data.codigo
        mensaje = parsed.data.mensaje
        detalles = parsed.data.detalles ?? []
      }
    } catch {
      // Un servidor real puede contestar un 502 con una página HTML de su
      // proxy. Se conserva el mensaje genérico y, sobre todo, el status: es lo
      // que distingue un fallo pasajero de un rechazo del negocio.
    }
    throw new ApiError(codigo, mensaje, respuesta.status, detalles)
  }

  if (respuesta.status === 204) return undefined as z.infer<S>

  let json: unknown
  try {
    json = await respuesta.json()
  } catch (error) {
    throw new ApiError(
      'CONTRATO_INVALIDO',
      'La respuesta del servidor no es JSON',
      respuesta.status,
      [error instanceof Error ? error.message : String(error)],
    )
  }

  const parsed = schema.safeParse(json)

  if (!parsed.success) {
    // Un fallo aquí es un desajuste entre frontend y backend, no un error del
    // usuario. Se hace ruidoso a propósito: en un sistema contable, un campo
    // mal tipado que pasa desapercibido es un descuadre más adelante.
    console.error('Respuesta no conforme al contrato:', ruta, parsed.error)
    throw new ApiError(
      'CONTRATO_INVALIDO',
      'La respuesta del servidor no coincide con el contrato esperado',
      respuesta.status,
    )
  }

  return parsed.data
}
