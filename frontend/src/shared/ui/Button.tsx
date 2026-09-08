import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro'
type Tamano = 'sm' | 'md'

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

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  tamano?: Tamano
  icono?: ReactNode
}

export function Button({
  variante = 'secundario',
  tamano = 'md',
  icono,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium',
        'transition-colors disabled:cursor-not-allowed',
        VARIANTES[variante],
        TAMANOS[tamano],
        className,
      )}
      {...props}
    >
      {icono}
      {children}
    </button>
  )
}
