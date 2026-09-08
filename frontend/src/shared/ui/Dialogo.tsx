import type { ReactNode } from 'react'
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
  className,
  children,
}: DialogoProps) {
  return (
    <Dialog.Root open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content
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
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>

          {acciones && (
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              {acciones}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
