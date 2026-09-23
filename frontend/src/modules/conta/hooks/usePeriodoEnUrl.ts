import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import type { Periodo } from '@/shared/api/contracts/conta'
import { useEmpresa } from '@/app/empresa'

/**
 * Periodo de la pantalla, sincronizado con `?periodo=` en la URL.
 *
 * El periodo activo vive en el contexto (el selector de la cabecera), pero un
 * enlace enviado por correo tiene que abrir el mismo mes que veía quien lo
 * envió, no el que el destinatario tenga activo (docs/14 §6). Por eso las dos
 * fuentes se sincronizan en los dos sentidos:
 *
 * - si cambia la URL (se abrió un enlace), manda la URL y el selector de la
 *   cabecera se mueve a ese periodo;
 * - si cambia el selector de la cabecera, manda el selector y la URL se
 *   reescribe, sin apilar una entrada de historial por cada cambio.
 *
 * Mientras las dos no coinciden (un render), se devuelve el de la URL: así no
 * se pide ni un instante la balanza de un mes que no es el del enlace.
 */
export function usePeriodoEnUrl(): Periodo | undefined {
  const { periodos, periodoActivo, setPeriodoActivo } = useEmpresa()
  const [parametros, setParametros] = useSearchParams()
  const pedido = parametros.get('periodo')
  const delEnlace = periodos.find((p) => p.id === pedido)

  // Lo que había en la vuelta anterior, para saber cuál de los dos cambió.
  // `undefined` en `pedidoPrevio` marca que todavía no hubo ninguna vuelta.
  const activoPrevio = useRef<string | undefined>(undefined)
  const pedidoPrevio = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!periodoActivo) return
    const primeraVuelta = pedidoPrevio.current === undefined
    const cambioElSelector =
      !primeraVuelta && activoPrevio.current !== periodoActivo.id
    activoPrevio.current = periodoActivo.id
    pedidoPrevio.current = pedido

    const escribirEnUrl = (id: string) =>
      setParametros(
        (previos) => {
          const nuevos = new URLSearchParams(previos)
          nuevos.set('periodo', id)
          return nuevos
        },
        { replace: true },
      )

    if (delEnlace && delEnlace.id !== periodoActivo.id) {
      if (cambioElSelector) escribirEnUrl(periodoActivo.id)
      else setPeriodoActivo(delEnlace.id)
    } else if (!delEnlace) {
      // Sin periodo en la URL (o con uno que no existe en esta empresa): se
      // escribe el activo, para que copiar la dirección ya sea un enlace fiel.
      escribirEnUrl(periodoActivo.id)
    }
  }, [periodoActivo, pedido, delEnlace, setPeriodoActivo, setParametros])

  return delEnlace ?? periodoActivo
}
