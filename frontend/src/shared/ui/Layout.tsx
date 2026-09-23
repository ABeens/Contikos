import type { ReactNode } from 'react'
import { cn } from './cn'

export function Card({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-slate-200 bg-white shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string
  descripcion?: string
  acciones?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
        {descripcion && (
          <p className="mt-0.5 text-xs text-slate-500">{descripcion}</p>
        )}
      </div>
      {acciones && <div className="flex shrink-0 gap-2">{acciones}</div>}
    </div>
  )
}

export function PageHeader({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string
  descripcion?: string
  acciones?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          {titulo}
        </h1>
        {descripcion && (
          <p className="mt-1 text-sm text-slate-500">{descripcion}</p>
        )}
      </div>
      {acciones && <div className="flex gap-2">{acciones}</div>}
    </div>
  )
}

export function EstadoVacio({
  titulo,
  descripcion,
  accion,
}: {
  titulo: string
  descripcion?: string
  accion?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium text-slate-700">{titulo}</p>
      {descripcion && (
        <p className="max-w-md text-xs text-slate-500">{descripcion}</p>
      )}
      {accion && <div className="mt-2">{accion}</div>}
    </div>
  )
}

/**
 * Una consulta que falló. Nunca se enseña como estado vacío: en una pantalla
 * contable "no hay saldos" y "no se pudieron leer los saldos" son cosas muy
 * distintas, y confundirlas se lee como datos perdidos.
 */
export function EstadoError({
  titulo = 'No se pudieron cargar los datos',
  error,
  onReintentar,
  reintentando,
}: {
  titulo?: string
  error?: unknown
  onReintentar?: () => void
  reintentando?: boolean
}) {
  const mensaje = error instanceof Error ? error.message : undefined
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center"
    >
      <p className="text-sm font-medium text-red-700">{titulo}</p>
      {mensaje && <p className="max-w-md text-xs text-slate-500">{mensaje}</p>}
      {onReintentar && (
        <button
          type="button"
          onClick={onReintentar}
          disabled={reintentando}
          className="mt-2 inline-flex h-7 items-center rounded-md bg-white px-2.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400"
        >
          {reintentando ? 'Reintentando…' : 'Reintentar'}
        </button>
      )}
    </div>
  )
}
