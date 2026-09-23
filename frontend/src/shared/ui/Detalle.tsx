import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Layout'

/**
 * Contenedor del detalle de un documento abierto desde la URL.
 *
 * El detalle se pinta debajo del listado: sin llevarlo a la vista, quien hace
 * clic en una fila (o llega por un enlace) no ve que se abrió nada. Recibe el
 * foco para que el teclado y el lector de pantalla sigan al documento. Se
 * monta con `key={id}`, así que cada documento nuevo vuelve a llevarse a la
 * vista.
 */
export function SeccionDetalle({
  etiqueta,
  children,
}: {
  etiqueta: string
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    ref.current?.focus({ preventScroll: true })
  }, [])

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label={etiqueta}
      className="scroll-mt-4 focus:outline-none"
    >
      {children}
    </section>
  )
}

/**
 * El id de la URL no está en el listado ya cargado: un enlace viejo, un
 * documento de otra empresa o un id mal copiado. Callar dejaría al usuario
 * mirando un listado sin saber por qué no se abrió lo que pidió.
 */
export function DocumentoNoEncontrado({
  id,
  onCerrar,
}: {
  id: string
  onCerrar: () => void
}) {
  return (
    <Card className="mt-4">
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"
      >
        <div>
          <p className="text-sm font-medium text-slate-800">
            Documento no encontrado
          </p>
          <p className="text-xs text-slate-500">
            No hay ningún documento con el identificador «{id}» en esta
            empresa.
          </p>
        </div>
        <Button tamano="sm" onClick={onCerrar}>
          Volver al listado
        </Button>
      </div>
    </Card>
  )
}
