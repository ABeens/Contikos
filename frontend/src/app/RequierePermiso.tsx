import type { ReactNode } from 'react'
import { ShieldOff } from 'lucide-react'
import type { Permiso } from '@/shared/api/contracts/auth'
import { Card } from '@/shared/ui/Layout'
import { useAcceso } from './acceso'

/**
 * Pantalla que no se enseña sin un permiso.
 *
 * Para lo que un rol no puede ni leer: la planilla y los usuarios. El menú ya
 * no lo ofrece, pero un enlace guardado o escrito a mano llega igual, y tiene
 * que encontrarse con una explicación y no con una pantalla rota por un 403.
 */
export function RequierePermiso({
  permiso,
  children,
}: {
  permiso: Permiso
  children: ReactNode
}) {
  const { puede } = useAcceso()
  if (puede(permiso)) return <>{children}</>
  return (
    <Card className="mx-auto mt-10 max-w-md">
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <ShieldOff className="size-6 text-slate-400" />
        <p className="text-sm font-medium text-slate-800">Su rol no da acceso a esta pantalla</p>
        <p className="text-xs text-slate-500">
          Si necesita entrar, pídale a quien administra los usuarios que le asigne el rol
          que corresponde en esta empresa.
        </p>
      </div>
    </Card>
  )
}
