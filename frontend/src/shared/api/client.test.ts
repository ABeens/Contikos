import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * El cliente contra un servidor HTTP de verdad.
 *
 * Las demás pruebas corren contra MSW, que es un mock cortés: siempre está,
 * siempre responde, siempre devuelve el JSON que le pidieron. Una API real
 * hace lo que aquí se comprueba: tarda, se cae, contesta un 502 con la página
 * de error de su proxy, o devuelve un campo con el tipo cambiado.
 *
 * Esta suite existe para que el día que se apunte a la API real no haya
 * sorpresas en la capa de transporte, y para fijar la única decisión que no se
 * puede tomar sin un servidor delante: qué se reintenta y qué no.
 */

/** Peticiones que el servidor deja colgadas a propósito, para cerrarlas al final. */
const colgadas: http.ServerResponse[] = []

let servidor: http.Server
let base: string

function json(res: http.ServerResponse, status: number, cuerpo: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(cuerpo))
}

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    switch (url.pathname) {
      case '/api/eco':
        return json(res, 200, {
          metodo: req.method,
          empresa: req.headers['x-empresa-id'] ?? null,
          acepta: req.headers.accept ?? null,
          consulta: url.searchParams.get('periodoId'),
        })

      case '/api/vacio':
        res.writeHead(204)
        return res.end()

      case '/api/negocio':
        return json(res, 422, {
          codigo: 'PERIODO_CERRADO',
          mensaje: 'El periodo está cerrado',
          detalles: ['Agosto 2026 se cerró el 31/08'],
        })

      case '/api/roto':
        // Lo que contesta un proxy cuando el backend no está: no es JSON.
        res.writeHead(502, { 'Content-Type': 'text/html' })
        return res.end('<html><body>502 Bad Gateway</body></html>')

      case '/api/mal-contrato':
        return json(res, 200, { numero: 'no soy un número' })

      case '/api/lento':
        // Nunca responde: es el caso que el tiempo límite tiene que cortar.
        colgadas.push(res)
        return

      default:
        return json(res, 404, {
          codigo: 'NO_ENCONTRADO',
          mensaje: 'Ruta desconocida',
        })
    }
  })

  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo))
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`
})

afterAll(async () => {
  for (const res of colgadas) res.destroy()
  await new Promise<void>((listo) => servidor.close(() => listo()))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/**
 * Carga el cliente con las variables de entorno dadas.
 *
 * El módulo lee la configuración al importarse, así que cambiarla obliga a
 * volver a importarlo. Es la contrapartida de que la raíz de la API sea una
 * constante y no una consulta en cada petición.
 */
async function cargarCliente(env: Record<string, string> = {}) {
  vi.resetModules()
  vi.stubEnv('VITE_API_URL', base)
  for (const [clave, valor] of Object.entries(env)) vi.stubEnv(clave, valor)
  return import('./client')
}

/**
 * Recoge el error de una petición que debe fallar.
 *
 * La clase `ApiError` llega del módulo recién importado y no de un import
 * estático: `vi.resetModules()` crea una copia nueva del módulo en cada carga,
 * así que las dos clases no serían la misma y `instanceof` fallaría contra la
 * importada arriba.
 */
async function fallo<E extends new (...args: never[]) => Error>(
  promesa: Promise<unknown>,
  ApiError: E,
): Promise<InstanceType<E>> {
  const error = await promesa.then(
    () => new Error('se esperaba un fallo y la petición salió bien'),
    (e: unknown) => e,
  )
  if (!(error instanceof ApiError)) {
    throw new Error(`se esperaba ApiError y llegó: ${String(error)}`)
  }
  return error as InstanceType<E>
}

const EcoSchema = z.object({
  metodo: z.string(),
  empresa: z.string().nullable(),
  acepta: z.string().nullable(),
  consulta: z.string().nullable(),
})

describe('request contra un servidor real', () => {
  it('usa la raíz declarada en el entorno y manda la empresa activa', async () => {
    const { request } = await cargarCliente()

    const eco = await request('/eco', EcoSchema, {
      empresaId: 'emp-001',
      params: { periodoId: 'per-2026-08' },
    })

    expect(eco).toEqual({
      metodo: 'GET',
      empresa: 'emp-001',
      acepta: 'application/json',
      consulta: 'per-2026-08',
    })
  })

  it('una respuesta 204 no intenta leerse como JSON', async () => {
    const { request } = await cargarCliente()

    await expect(request('/vacio', z.undefined(), { metodo: 'DELETE' }))
      .resolves.toBeUndefined()
  })

  it('convierte un error de negocio en ApiError con su código', async () => {
    const { request, ApiError, esReintentable } = await cargarCliente()

    const error = await fallo(request('/negocio', z.unknown()), ApiError)

    expect(error.codigo).toBe('PERIODO_CERRADO')
    expect(error.status).toBe(422)
    expect(error.detalles).toHaveLength(1)
    // Un periodo cerrado sigue cerrado por mucho que se insista.
    expect(esReintentable(error)).toBe(false)
  })

  it('sobrevive a un 502 que no viene en JSON y lo marca reintentable', async () => {
    const { request, ApiError, esReintentable } = await cargarCliente()

    const error = await fallo(request('/roto', z.unknown()), ApiError)

    expect(error.status).toBe(502)
    expect(esReintentable(error)).toBe(true)
  })

  it('rechaza una respuesta que no cumple el contrato', async () => {
    const { request, ApiError } = await cargarCliente()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const error = await fallo(
      request('/mal-contrato', z.object({ numero: z.number() })),
      ApiError,
    )

    expect(error.codigo).toBe('CONTRATO_INVALIDO')
  })

  it('corta la petición que no vuelve y la deja reintentable', async () => {
    const { request, ApiError, esReintentable, TIEMPO_AGOTADO } =
      await cargarCliente({ VITE_API_TIMEOUT_MS: '150' })

    const error = await fallo(request('/lento', z.unknown()), ApiError)

    expect(error.codigo).toBe(TIEMPO_AGOTADO)
    expect(error.status).toBe(0)
    expect(esReintentable(error)).toBe(true)
  })

  it('informa de que no hay servidor en vez de dejar escapar un TypeError', async () => {
    vi.resetModules()
    // Un puerto donde no escucha nadie: el backend caído, o mal configurado.
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:1/api')
    const { request, ApiError, esReintentable, SIN_CONEXION } = await import(
      './client'
    )

    const error = await fallo(request('/lo-que-sea', z.unknown()), ApiError)

    expect(error.codigo).toBe(SIN_CONEXION)
    expect(esReintentable(error)).toBe(true)
  })

  it('deja pasar la cancelación de quien llama sin disfrazarla de error', async () => {
    const { request, ApiError } = await cargarCliente()
    const control = new AbortController()

    const promesa = request('/lento', z.unknown(), { signal: control.signal })
    control.abort()

    // Cambiar de pantalla no es un fallo: TanStack Query tiene que verlo como
    // consulta cancelada, no como una petición que salió mal.
    const error = await promesa.catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(ApiError)
  })
})
