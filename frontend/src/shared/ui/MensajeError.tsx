import { ApiError } from '@/shared/api/client'

/**
 * Error de una operación, con los detalles que mande el servidor.
 * No pinta nada si no hay error.
 */
export function MensajeError({
  error,
  className,
}: {
  error: unknown
  className?: string
}) {
  if (!error) return null
  const detalles = error instanceof ApiError ? error.detalles : []
  const mensaje =
    error instanceof Error ? error.message : 'No se pudo completar la operación.'
  return (
    <div
      role="alert"
      className={
        'rounded-md bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200 ring-inset ' +
        (className ?? '')
      }
    >
      <p>{mensaje}</p>
      {detalles.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {detalles.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
