import { useCallback, useEffect, useRef } from 'react'
import { useBlocker } from 'react-router'
import { DialogoConfirmacion } from './DialogoConfirmacion'

/**
 * Pregunta antes de abandonar un formulario con cambios sin guardar.
 *
 * Cubre la navegación interna (menú, Cancelar, botón atrás, cambio de empresa)
 * con `useBlocker`, y el cierre o recarga de la pestaña con `beforeunload`.
 * Solo se bloquea si cambia la ruta: tocar los parámetros de la propia
 * pantalla no es salir de ella.
 *
 * Tras guardar, la pantalla suele navegar sola; antes de hacerlo debe llamar a
 * `permitirSalida()`, porque el formulario sigue "sucio" en ese instante.
 */
export function useAvisoSalida(sucio: boolean) {
  const permitido = useRef(false)
  const sucioRef = useRef(sucio)
  sucioRef.current = sucio

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !permitido.current &&
      sucioRef.current &&
      currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (!sucio) return
    const antesDeSalir = (e: BeforeUnloadEvent) => {
      if (permitido.current) return
      e.preventDefault()
    }
    window.addEventListener('beforeunload', antesDeSalir)
    return () => window.removeEventListener('beforeunload', antesDeSalir)
  }, [sucio])

  const permitirSalida = useCallback(() => {
    permitido.current = true
  }, [])

  const aviso = (
    <DialogoConfirmacion
      abierto={blocker.state === 'blocked'}
      titulo="¿Descartar los cambios?"
      textoConfirmar="Descartar y salir"
      peligro
      onConfirmar={() => blocker.proceed?.()}
      onCancelar={() => blocker.reset?.()}
    >
      <p>Hay datos capturados que no se han guardado. Si sale, se pierden.</p>
    </DialogoConfirmacion>
  )

  return { aviso, permitirSalida }
}
