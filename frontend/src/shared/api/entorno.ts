/**
 * Dónde vive la API y cómo se habla con ella.
 *
 * Una sola definición para toda la aplicación. Antes había dos: el cliente
 * leía `VITE_API_URL` y los handlers del mock traían la ruta `/api/...`
 * escrita a mano cuarenta y nueve veces. Mientras las dos coincidieran no se
 * notaba; el día que alguien cambiara la variable, el mock habría dejado de
 * interceptar sin decir nada y la aplicación habría salido a buscar un
 * servidor que no existe.
 *
 * Conectar la API real es cambiar estas variables. Nada más: ni una firma de
 * `servicios/`, ni un hook, ni una pantalla (docs/14 §2.3).
 */

/** Quita la barra final para que `${API_URL}${ruta}` nunca produzca `//`. */
function normalizar(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Raíz de la API.
 *
 * Relativa (`/api`) o absoluta (`https://api.contikos.cr/v1`): el cliente
 * resuelve las dos. Con el mock encendido es la ruta que se intercepta.
 */
export const API_URL = normalizar(import.meta.env.VITE_API_URL ?? '/api')

/**
 * ¿Contesta el mock o contesta la API?
 *
 * Sin decir nada, manda `VITE_API_URL`: si se ha declarado dónde está la API,
 * es que se quiere hablar con ella. `VITE_USAR_MOCKS` gana siempre que esté
 * puesta, para poder trabajar contra el mock con la variable de la API
 * configurada, o al revés.
 */
export const USAR_MOCKS =
  import.meta.env.VITE_USAR_MOCKS !== undefined
    ? import.meta.env.VITE_USAR_MOCKS === 'true'
    : import.meta.env.VITE_API_URL === undefined

/**
 * Tiempo máximo de una petición, en milisegundos.
 *
 * El mock responde siempre y al instante; una red de verdad, no. Sin límite,
 * una petición que nunca vuelve deja la pantalla cargando para siempre y el
 * usuario sin saber si guardó o no. Un número mal escrito en la variable no
 * debe desactivar el límite: se cae al valor por defecto.
 */
const TIEMPO_POR_DEFECTO = 15_000

export const TIEMPO_LIMITE_MS = (() => {
  const declarado = Number(import.meta.env.VITE_API_TIMEOUT_MS)
  return Number.isFinite(declarado) && declarado > 0
    ? declarado
    : TIEMPO_POR_DEFECTO
})()

/**
 * Ruta absoluta de un endpoint.
 *
 * La usan los handlers del mock para registrarse exactamente donde el cliente
 * va a llamar.
 */
export function rutaApi(ruta: string): string {
  return `${API_URL}${ruta}`
}
