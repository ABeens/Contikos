import type { FormEvent, ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from './cn'

export interface DialogoProps {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  descripcion?: string
  /** Botonera del pie. El contenido queda con scroll propio. */
  acciones?: ReactNode
  /**
   * Mientras hay una operación en curso el diálogo no se deja cerrar (ni con
   * Escape, ni con la X, ni con un clic fuera). Si se cerrara, el usuario
   * creería haber cancelado algo que el servidor sí está haciendo, y un error
   * posterior no lo vería nadie.
   */
  bloqueado?: boolean
  /**
   * Si se indica, contenido y botonera van dentro de un `<form>`: Enter en un
   * campo envía, y el botón primario debe ser `type="submit"`.
   */
  alEnviar?: () => void
  className?: string
  children: ReactNode
}

/**
 * Diálogo modal del sistema.
 *
 * Vive en `shared/ui` y no en un módulo: un ERP donde cada módulo inventa su
 * modal termina con seis comportamientos distintos de foco y de Escape
 * (docs/14 §10).
 */
export function Dialogo({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  acciones,
  bloqueado = false,
  alEnviar,
  className,
  children,
}: DialogoProps) {
  const cuerpo = (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>

      {acciones && (
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          {acciones}
        </div>
      )}
    </>
  )

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    if (!bloqueado) alEnviar?.()
  }

  return (
    <Dialog.Root
      open={abierto}
      onOpenChange={(v) => !v && !bloqueado && onCerrar()}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content
          aria-busy={bloqueado || undefined}
          onEscapeKeyDown={(e) => bloqueado && e.preventDefault()}
          onInteractOutside={(e) => bloqueado && e.preventDefault()}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(94vw,32rem)]',
            '-translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-lg border border-slate-200 bg-white shadow-xl focus:outline-none',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3">
            <div>
              <Dialog.Title className="text-sm font-semibold text-slate-800">
                {titulo}
              </Dialog.Title>
              {descripcion && (
                <Dialog.Description className="mt-0.5 text-xs text-slate-500">
                  {descripcion}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Cerrar"
              disabled={bloqueado}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {alEnviar ? (
            <form
              onSubmit={enviar}
              noValidate
              className="flex min-h-0 flex-1 flex-col"
            >
              {cuerpo}
            </form>
          ) : (
            cuerpo
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
