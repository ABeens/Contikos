import type { ReactNode } from 'react'
import { CircleAlert, Inbox, RotateCw } from 'lucide-react'
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
        'rounded-xl border border-slate-200/80 bg-white shadow-suave',
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
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3.5">
      <div className="min-w-0">
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
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pb-5">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-slate-900">
          {titulo}
        </h1>
        {descripcion && (
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{descripcion}</p>
        )}
      </div>
      {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
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
    <div className="flex animate-aparecer flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div
        aria-hidden
        className="mb-1 grid size-11 place-items-center rounded-full bg-slate-100 text-slate-400"
      >
        <Inbox className="size-5" />
      </div>
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
      <div
        aria-hidden
        className="mb-1 grid size-11 place-items-center rounded-full bg-red-50 text-red-500"
      >
        <CircleAlert className="size-5" />
      </div>
      <p className="text-sm font-medium text-red-700">{titulo}</p>
      {mensaje && <p className="max-w-md text-xs text-slate-500">{mensaje}</p>}
      {onReintentar && (
        <button
          type="button"
          onClick={onReintentar}
          disabled={reintentando}
          className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-medium text-slate-700 shadow-suave ring-1 ring-slate-300/80 ring-inset transition-colors hover:bg-slate-50 disabled:text-slate-400"
        >
          <RotateCw
            className={reintentando ? 'size-3.5 animate-spin' : 'size-3.5'}
            aria-hidden
          />
          {reintentando ? 'Reintentando…' : 'Reintentar'}
        </button>
      )}
    </div>
  )
}
