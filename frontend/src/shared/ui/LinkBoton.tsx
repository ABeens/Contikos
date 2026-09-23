import type { ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import { cn } from './cn'
import { clasesBoton, type Tamano, type Variante } from './estilos'

/**
 * Enlace con aspecto de botón. Sustituye a `<Link><Button/></Link>`, que anida
 * dos elementos interactivos: HTML inválido y dos paradas de Tab para una
 * sola acción.
 */
export function LinkBoton({
  variante = 'secundario',
  tamano = 'md',
  icono,
  className,
  children,
  ...props
}: LinkProps & { variante?: Variante; tamano?: Tamano; icono?: ReactNode }) {
  return (
    <Link className={cn(clasesBoton(variante, tamano), className)} {...props}>
      {icono}
      {children}
    </Link>
  )
}
