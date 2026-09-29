import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { LogOut, UserRound } from 'lucide-react'
import { servicioAuth } from '@/shared/api/servicios'
import { cerrarSesionLocal } from '@/shared/auth/sesion'
import { ETIQUETA_ROL } from '@/shared/auth/permisos'
import { useAcceso } from '../acceso'

/**
 * Quién está dentro, con qué rol en esta empresa, y la salida.
 *
 * El rol se enseña junto al nombre porque cambia con la empresa: la misma
 * persona es contadora en una y solo consulta en otra, y tiene que poder ver
 * con cuál de los dos está trabajando.
 */
export function MenuUsuario() {
  const { usuario, rol } = useAcceso()
  if (!usuario) return null

  const salir = () => {
    // Se cierra aquí aunque el servidor no conteste: quien pulsa "salir" en
    // una computadora compartida no puede quedarse dentro por un corte de red.
    void servicioAuth.cerrarSesion().catch(() => undefined)
    cerrarSesionLocal()
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Usuario: ${usuario.nombre}`}
        className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-slate-700 hover:bg-slate-100"
      >
        <UserRound className="size-4 shrink-0 text-slate-500" />
        <span className="hidden max-w-36 truncate lg:inline">{usuario.nombre}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-flotante"
        >
          <div className="px-3 py-2">
            <p className="font-medium text-slate-900">{usuario.nombre}</p>
            <p className="text-xs text-slate-500">{usuario.correo}</p>
            <p className="mt-1 text-xs text-slate-600">
              {rol ? `${ETIQUETA_ROL[rol]} en esta empresa` : 'Sin rol en esta empresa'}
            </p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
          <DropdownMenu.Item
            onSelect={salir}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-slate-700 outline-none data-[highlighted]:bg-slate-100"
          >
            <LogOut className="size-4" />
            Cerrar sesión
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
