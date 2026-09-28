/**
 * Avisos breves de la aplicación ("Factura emitida", "Cliente guardado").
 *
 * Es un almacén de módulo y no un contexto de React: quien más avisa es la
 * caché de mutaciones (`providers.tsx`), que vive fuera del árbol de
 * componentes. Así cualquier código puede avisar sin tener que pasar un hook.
 *
 * Solo confirma lo que salió bien. Los errores se siguen enseñando junto al
 * formulario que los provocó: un aviso que se va solo es mal sitio para algo
 * que hay que corregir.
 */

export type TonoAviso = 'exito' | 'info'

export interface Aviso {
  id: number
  titulo: string
  descripcion?: string
  tono: TonoAviso
}

type Oyente = (avisos: Aviso[]) => void

/** Lo que dura un aviso en pantalla. Suficiente para leer una línea. */
export const DURACION_AVISO_MS = 4_000
/** Más de tres a la vez ya no se leen: se descartan los más viejos. */
const MAXIMO = 3

let avisos: Aviso[] = []
let siguienteId = 1
const oyentes = new Set<Oyente>()

function emitir() {
  for (const oyente of oyentes) oyente(avisos)
}

export function notificar(
  titulo: string,
  opciones: { descripcion?: string; tono?: TonoAviso } = {},
): number {
  const id = siguienteId++
  avisos = [
    ...avisos,
    { id, titulo, descripcion: opciones.descripcion, tono: opciones.tono ?? 'exito' },
  ].slice(-MAXIMO)
  emitir()
  return id
}

export function descartarAviso(id: number) {
  const antes = avisos.length
  avisos = avisos.filter((a) => a.id !== id)
  if (avisos.length !== antes) emitir()
}

export function suscribirAvisos(oyente: Oyente): () => void {
  oyentes.add(oyente)
  return () => oyentes.delete(oyente)
}

export function avisosActuales(): Aviso[] {
  return avisos
}

/*
 * Las mutaciones declaran su confirmación en `meta.exito`, junto a la
 * operación que describen, y la caché la enseña al terminar bien. Ninguna
 * pantalla tiene que acordarse de avisar.
 */
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** Texto del aviso cuando la operación termina bien. */
      exito?: string
    }
  }
}
