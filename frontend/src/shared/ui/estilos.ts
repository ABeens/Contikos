import { cn } from './cn'

/** Estilo base de los campos de entrada. Vive aparte de los componentes para
 *  no romper el fast refresh (un módulo con componentes solo debe exportar
 *  componentes). */
export const inputClass = cn(
  'h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900',
  'placeholder:text-slate-400',
  'focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none',
  'aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-400',
  'disabled:bg-slate-50 disabled:text-slate-500',
)
