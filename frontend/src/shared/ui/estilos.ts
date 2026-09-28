import { cn } from './cn'

/** Estilo base de los campos de entrada. Vive aparte de los componentes para
 *  no romper el fast refresh (un módulo con componentes solo debe exportar
 *  componentes). */
export const inputClass = cn(
  'h-9 w-full rounded-lg border border-slate-300/90 bg-white px-2.5 text-sm text-slate-900 shadow-suave',
  'placeholder:text-slate-400 transition-[border-color,box-shadow] duration-150',
  'hover:border-slate-400/80',
  'focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none',
  'aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-400/20',
  'disabled:bg-slate-50 disabled:text-slate-500 disabled:shadow-none',
)

export type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro'
export type Tamano = 'sm' | 'md'

const VARIANTES: Record<Variante, string> = {
  primario:
    'bg-brand-600 text-white shadow-sm shadow-brand-900/20 hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 disabled:shadow-none',
  secundario:
    'bg-white text-slate-700 shadow-suave ring-1 ring-slate-300/80 ring-inset hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100 disabled:text-slate-400 disabled:shadow-none',
  fantasma:
    'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200 disabled:text-slate-400',
  peligro:
    'bg-red-600 text-white shadow-sm shadow-red-900/20 hover:bg-red-700 active:bg-red-800 disabled:bg-red-300 disabled:shadow-none',
}

const TAMANOS: Record<Tamano, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
}

/** Clases de un botón. Las usa también `LinkBoton`: un enlace con aspecto de
 *  botón, en vez de un botón metido dentro de un enlace. */
export function clasesBoton(variante: Variante = 'secundario', tamano: Tamano = 'md') {
  return cn(
    'inline-flex items-center justify-center font-medium whitespace-nowrap select-none',
    // Un leve hundimiento al pulsar: el botón responde antes que el servidor.
    'transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.98]',
    'disabled:cursor-not-allowed disabled:active:scale-100',
    VARIANTES[variante],
    TAMANOS[tamano],
  )
}
