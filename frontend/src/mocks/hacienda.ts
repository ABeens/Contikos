import type { z } from 'zod'
import type { TablaTipoCambio } from '@/shared/api/contracts/config'
import {
  armarTabla,
  RespuestaDolarSchema,
  RespuestaEuroSchema,
  URL_TC_DOLAR,
  URL_TC_EURO,
} from '@/shared/fiscal/tipoCambio'

/**
 * Consulta al Ministerio de Hacienda, haciendo de backend.
 *
 * Esta llamada es del servidor, no de la aplicación (docs/13 §8): ningún módulo
 * llama a Hacienda. Mientras el backend no exista, el mock ocupa su lugar, y
 * por eso vive aquí y no en `src/modules`. Las reglas de conversión sí son del
 * dominio y están en `shared/fiscal/tipoCambio`, que es lo que el backend
 * heredará el día que se escriba.
 */

export class HaciendaNoDisponible extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'HaciendaNoDisponible'
  }
}

/**
 * Respuestas fijas para las pruebas.
 *
 * La suite no sale a la red: una prueba que depende de que Hacienda esté
 * publicando falla los sábados y no dice nada del código. Son las respuestas
 * reales del 27 de agosto de 2026, con la particularidad que importa: el valor
 * del euro en colones (527,74) es la venta del dólar (452,88) por la paridad
 * (1,1653).
 */
const DOLAR_FIJO = {
  compra: { fecha: '2026-08-27', valor: 448.38 },
  venta: { fecha: '2026-08-27', valor: 452.88 },
}

const EURO_FIJO = { fecha: '2026-08-27', dolares: 1.1653, colones: 527.74 }

async function traer<S extends z.ZodTypeAny>(
  url: string,
  schema: S,
): Promise<z.infer<S>> {
  let respuesta: Response
  try {
    respuesta = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch (error) {
    throw new HaciendaNoDisponible(
      `No se pudo alcanzar ${url}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!respuesta.ok) {
    throw new HaciendaNoDisponible(`${url} respondió ${respuesta.status}`)
  }

  const parsed = schema.safeParse(await respuesta.json())
  if (!parsed.success) {
    // La fuente cambió de forma. Mejor no publicar tipo de cambio que publicar
    // uno leído de un campo que ya no significa lo que significaba.
    throw new HaciendaNoDisponible(`${url} respondió algo que no es un tipo de cambio`)
  }
  return parsed.data
}

/** Tipos de cambio del día, ya convertidos al contrato de la API. */
export async function consultarTipoCambio(): Promise<TablaTipoCambio> {
  if (import.meta.env.MODE === 'test') {
    return armarTabla(DOLAR_FIJO, EURO_FIJO)
  }

  const [dolar, euro] = await Promise.all([
    traer(URL_TC_DOLAR, RespuestaDolarSchema),
    traer(URL_TC_EURO, RespuestaEuroSchema),
  ])
  return armarTabla(dolar, euro)
}
