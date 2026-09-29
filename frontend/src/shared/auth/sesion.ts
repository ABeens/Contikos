import { useSyncExternalStore } from 'react'
import { SesionSchema, type Sesion } from '@/shared/api/contracts/auth'

/**
 * La sesión abierta en este navegador.
 *
 * Un solo sitio la guarda y todos la leen: `servicios/base.ts` pone el token en
 * cada petición, el cliente HTTP la cierra si el servidor contesta 401, y la
 * interfaz decide con ella qué ofrecer. Nada más en la aplicación toca el
 * token.
 *
 * Se guarda en `sessionStorage` y no en `localStorage`: cerrar la pestaña cierra
 * la sesión. Es un sistema contable; una sesión que sobrevive a cerrar el
 * navegador en una computadora compartida es una puerta abierta.
 */

const CLAVE = 'contikos.sesion'

type Oyente = () => void

let actual: Sesion | null = leer()
const oyentes = new Set<Oyente>()

function almacen(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function leer(): Sesion | null {
  try {
    const texto = almacen()?.getItem(CLAVE)
    if (!texto) return null
    const parsed = SesionSchema.safeParse(JSON.parse(texto))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function avisar(): void {
  for (const oyente of oyentes) oyente()
}

export function sesionActual(): Sesion | null {
  return actual
}

export function establecerSesion(sesion: Sesion): void {
  actual = sesion
  try {
    almacen()?.setItem(CLAVE, JSON.stringify(sesion))
  } catch {
    // Sin almacenamiento la sesión dura lo que la pestaña en memoria.
  }
  avisar()
}

/**
 * Cierra la sesión en este navegador.
 *
 * `motivo` es lo que se le dirá a quien vuelva a la pantalla de inicio: no es
 * lo mismo "cerró sesión" que "su sesión venció".
 */
export function cerrarSesionLocal(motivo: string | null = null): void {
  actual = null
  ultimoMotivo = motivo
  try {
    almacen()?.removeItem(CLAVE)
  } catch {
    // Nada que borrar.
  }
  avisar()
}

let ultimoMotivo: string | null = null

/** Por qué se cerró la última sesión, si no fue a pedido del usuario. */
export function motivoDeCierre(): string | null {
  return ultimoMotivo
}

export function suscribirSesion(oyente: Oyente): () => void {
  oyentes.add(oyente)
  return () => oyentes.delete(oyente)
}

/** La sesión como estado de React: se re-renderiza al abrirla o cerrarla. */
export function useSesionActual(): Sesion | null {
  return useSyncExternalStore(suscribirSesion, sesionActual, () => null)
}
