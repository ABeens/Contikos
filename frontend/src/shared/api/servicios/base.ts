import type { z } from 'zod'
import { request } from '../client'
import { empresaActiva } from '@/shared/almacen/almacen'

/**
 * Base común de los servicios.
 *
 * Un servicio describe UNA operación de la API: su ruta, su método, su
 * contrato de entrada y su contrato de salida. Nada más. No conoce React, ni
 * la caché, ni la pantalla que lo llama, y por eso se puede llamar desde un
 * hook, desde una prueba o desde otro servicio sin arrastrar nada.
 *
 * Reparto de responsabilidades:
 *
 * - `client.ts` sabe hablar HTTP: serializa, valida contra el contrato y
 *   convierte un error de negocio en `ApiError`.
 * - Los servicios de esta carpeta saben QUÉ pedir: la ruta, el verbo y el
 *   esquema de cada operación.
 * - Los hooks de `modules/<módulo>/api/queries.ts` saben CUÁNDO pedirlo y qué
 *   invalidar después.
 *
 * Mientras no exista el backend, quien responde es el mock, que guarda en el
 * almacenamiento local del navegador (`shared/almacen`). El día que la API
 * exista no cambia ni una firma de esta carpeta: cambia quién contesta.
 */

/** Lo que toda lectura acepta, aunque hoy casi nadie lo use. */
export interface OpcionesLectura {
  /**
   * Cancelación.
   *
   * React Query entrega uno a cada `queryFn`. Se acepta desde ahora para que
   * el día que una pantalla pida un listado grande, abandonar la pantalla
   * aborte la petición en vez de dejarla llegar a una caché que ya nadie mira.
   */
  signal?: AbortSignal
}

/** Parámetros de consulta. `undefined` no viaja. */
export type Params = Record<string, string | number | undefined>

/**
 * Petición al servidor con el contexto de empresa siempre puesto.
 *
 * La empresa no es opcional: el rol se asigna por empresa y los datos no se
 * cruzan nunca (docs/01 §4.1). Va aquí y no en cada llamada para que no exista
 * la posibilidad de olvidarla en una operación nueva.
 */
export function pedir<S extends z.ZodTypeAny>(
  ruta: string,
  schema: S,
  opciones: {
    metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    cuerpo?: unknown
    params?: Params
    signal?: AbortSignal
  } = {},
): Promise<z.infer<S>> {
  return request(ruta, schema, { ...opciones, empresaId: empresaActiva() })
}
