import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'
import { clasesBoton, type Tamano, type Variante } from './estilos'

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
      className={cn(clasesBoton(variante, tamano), className)}
      {...props}
    >
      {icono}
      {children}
    </button>
  )
}
