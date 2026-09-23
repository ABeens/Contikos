import type { ReactNode } from 'react'
import { Button } from './Button'
import { Dialogo } from './Dialogo'
import { MensajeError } from './MensajeError'

export interface DialogoConfirmacionProps {
  abierto: boolean
  titulo: string
  descripcion?: string
  /** Qué va a pasar exactamente: importes, periodo, número de documentos. */
  children?: ReactNode
  textoConfirmar: string
  textoConfirmando?: string
  peligro?: boolean
  pendiente?: boolean
  /** Error de la operación: se enseña aquí dentro, no detrás del modal. */
  error?: unknown
  onConfirmar: () => void
  onCancelar: () => void
}

/**
 * Confirmación de una acción irreversible o que escribe en el mayor.
 *
 * El error se muestra dentro del diálogo: si se enseñara en la página, quedaría
 * tapado por el overlay y el usuario solo vería el botón volver a su estado.
 */
export function DialogoConfirmacion({
  abierto,
  titulo,
  descripcion,
  children,
  textoConfirmar,
  textoConfirmando,
  peligro = false,
  pendiente = false,
  error,
  onConfirmar,
  onCancelar,
}: DialogoConfirmacionProps) {
  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCancelar}
      titulo={titulo}
      descripcion={descripcion}
      bloqueado={pendiente}
      alEnviar={onConfirmar}
      acciones={
        <>
          <Button onClick={onCancelar} disabled={pendiente}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variante={peligro ? 'peligro' : 'primario'}
            disabled={pendiente}
            autoFocus
          >
            {pendiente ? (textoConfirmando ?? textoConfirmar) : textoConfirmar}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        {children}
        <MensajeError error={error} />
      </div>
    </Dialogo>
  )
}
