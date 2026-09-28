import { useEffect, useSyncExternalStore } from 'react'
import { CircleCheck, Info, X } from 'lucide-react'
import { cn } from './cn'
import {
  DURACION_AVISO_MS,
  avisosActuales,
  descartarAviso,
  suscribirAvisos,
  type Aviso,
} from './avisos'

/**
 * Pila de avisos, abajo a la derecha: lejos de los botones de guardar y de la
 * barra superior, donde no tapa lo que se está mirando.
 */
export function Notificaciones() {
  const avisos = useSyncExternalStore(suscribirAvisos, avisosActuales)

  return (
    <div
      // Región viva educada: confirma algo hecho, no interrumpe la lectura.
      // Sin `role="status"`, que queda para los paneles de confirmación de
      // cada pantalla: el aviso es un eco breve, no el resultado.
      aria-live="polite"
      aria-label="Avisos"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2"
    >
      {avisos.map((aviso) => (
        <Tarjeta key={aviso.id} aviso={aviso} />
      ))}
    </div>
  )
}

function Tarjeta({ aviso }: { aviso: Aviso }) {
  useEffect(() => {
    const t = setTimeout(() => descartarAviso(aviso.id), DURACION_AVISO_MS)
    return () => clearTimeout(t)
  }, [aviso.id])

  const Icono = aviso.tono === 'exito' ? CircleCheck : Info

  return (
    <div className="pointer-events-auto flex animate-subir items-start gap-3 rounded-xl bg-slate-900 px-3.5 py-3 text-sm text-white shadow-flotante ring-1 ring-white/10">
      <Icono
        className={cn(
          'mt-0.5 size-4 shrink-0',
          aviso.tono === 'exito' ? 'text-emerald-400' : 'text-sky-400',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{aviso.titulo}</p>
        {aviso.descripcion && (
          <p className="mt-0.5 text-xs text-slate-300">{aviso.descripcion}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => descartarAviso(aviso.id)}
        aria-label="Cerrar aviso"
        className="-m-1 rounded-md p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
