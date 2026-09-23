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

export type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro'
export type Tamano = 'sm' | 'md'

const VARIANTES: Record<Variante, string> = {
  primario:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300',
  secundario:
    'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:text-slate-400',
  fantasma:
    'bg-transparent text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:text-slate-400',
  peligro:
    'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-300',
}

const TAMANOS: Record<Tamano, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
}

/** Clases de un botón. Las usa también `LinkBoton`: un enlace con aspecto de
 *  botón, en vez de un botón metido dentro de un enlace. */
export function clasesBoton(variante: Variante = 'secundario', tamano: Tamano = 'md') {
  return cn(
    'inline-flex items-center justify-center rounded-md font-medium',
    'transition-colors disabled:cursor-not-allowed',
    VARIANTES[variante],
    TAMANOS[tamano],
  )
}
