import { useEffect, useRef } from 'react'
import { CircleAlert } from 'lucide-react'
import { ApiError } from '@/shared/api/client'

/**
 * Resumen de errores al pie de una captura.
 *
 * Primero los errores locales: si lo capturado ya no pasa la validación, eso es
 * lo que hay que corregir, y un rechazo viejo del servidor encima solo tapa el
 * dato. El del servidor se enseña cuando lo local está bien.
 *
 * El botón que envía está arriba y este panel abajo: cuando el envío falla, el
 * panel se lleva a la vista y recibe el foco (`senal` cambia en cada intento
 * fallido). Sin eso, quien pulsa "Emitir" solo ve que no pasó nada.
 */
export function ResumenErrores({
  titulo,
  errores,
  errorServidor,
  senal,
}: {
  /** Encabezado cuando fallan las validaciones locales. */
  titulo: string
  /** Mensajes de la validación local. Vacío = lo local está bien. */
  errores: readonly string[]
  errorServidor: unknown
  /** Contador de intentos fallidos: al cambiar, el panel toma el foco. */
  senal: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const enfocada = useRef(0)

  const hayLocales = errores.length > 0
  const servidor = !hayLocales && errorServidor ? errorServidor : null
  const visible = hayLocales || Boolean(servidor)

  useEffect(() => {
    // El error del servidor llega un render después que la señal: se espera a
    // que el panel exista para no enfocar a nadie.
    if (!visible || senal === 0 || enfocada.current === senal) return
    enfocada.current = senal
    ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    ref.current?.focus({ preventScroll: true })
  }, [senal, visible])

  if (!visible) return null

  const encabezado =
    servidor instanceof ApiError
      ? `${servidor.codigo}: ${servidor.message}`
      : servidor instanceof Error
        ? servidor.message
        : servidor
          ? 'No se pudo completar la operación.'
          : titulo
  const lista = servidor
    ? servidor instanceof ApiError
      ? servidor.detalles
      : []
    : errores

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset focus:outline-2 focus:outline-red-400"
    >
      <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
        <CircleAlert className="size-4" />
        {encabezado}
      </p>
      {lista.length > 0 && (
        <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
          {lista.map((mensaje, i) => (
            <li key={i}>{mensaje}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
