import * as Menu from '@radix-ui/react-dropdown-menu'
import { useIsMutating } from '@tanstack/react-query'
import { Building2, Check, ChevronDown } from 'lucide-react'
import {
  useAbrirEmpresa,
  useAplicarCambioEmpresa,
  useEmpresa,
} from '@/app/empresa'
import { empresasAbribles } from '../domain/empresa'

/**
 * Selector de empresa de la barra superior.
 *
 * Cambiar de empresa cambia TODO lo que hay en pantalla: catálogos, mayor,
 * documentos, moneda funcional. Por eso al cambiar se vuelve al inicio: la
 * pantalla en la que se estaba (el detalle de una factura, por ejemplo) no
 * tiene por qué existir en la otra empresa. Y se vuelve ANTES de cambiar
 * (`useAbrirEmpresa`): si hay un formulario con cambios, el usuario puede
 * quedarse, y entonces no se cambia nada.
 *
 * Es un menú y no un `<select>`: en un select cerrado, las flechas del teclado
 * cambian la opción elegida y disparan `onChange` a cada pulsación, así que
 * recorrer la lista con el teclado abría una empresa detrás de otra. En el
 * menú las flechas solo mueven el foco; se abre con Enter o con un clic.
 *
 * Con una sola empresa abrible no hay nada que elegir y se enseña el nombre
 * a secas.
 *
 * Además es el sitio donde se monta `useAplicarCambioEmpresa`: la barra
 * superior está en todas las pantallas y bajo el router, que es lo que ese
 * hook necesita.
 */
export function SelectorEmpresa() {
  useAplicarCambioEmpresa()

  const { empresa, empresas, cambiandoEmpresa } = useEmpresa()
  const abrirEmpresa = useAbrirEmpresa()
  // Con una escritura en curso no se cambia de empresa: la respuesta llegaría
  // cuando la activa ya es otra, y en el mock (que escribe en las colecciones
  // de la empresa activa al contestar) acabaría guardada en la equivocada.
  const escribiendo = useIsMutating() > 0

  const abribles = empresasAbribles(empresas, empresa.id)
  const bloqueado = cambiandoEmpresa || escribiendo

  if (abribles.length <= 1) {
    return (
      <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-800">
        <Building2 className="size-4 shrink-0 text-slate-400" />
        <span className="truncate">{empresa.nombre}</span>
      </p>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Building2 className="size-4 shrink-0 text-slate-400" />
      <Menu.Root modal={false}>
        <Menu.Trigger
          aria-label={`Empresa: ${empresa.codigo} · ${empresa.nombre}`}
          disabled={bloqueado}
          className="flex h-8 max-w-72 min-w-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="truncate">
            {empresa.codigo} · {empresa.nombre}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            align="start"
            sideOffset={4}
            className="z-50 min-w-64 rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg"
          >
            <Menu.Label className="px-2 py-1 text-[11px] font-medium text-slate-500">
              Abrir otra empresa
            </Menu.Label>
            <Menu.RadioGroup
              value={empresa.id}
              onValueChange={(id) => {
                if (id !== empresa.id) abrirEmpresa(id)
              }}
            >
              {abribles.map((e) => (
                <Menu.RadioItem
                  key={e.id}
                  value={e.id}
                  className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-slate-700 outline-none data-[highlighted]:bg-brand-50 data-[highlighted]:text-brand-800"
                >
                  <span className="grid size-4 place-items-center">
                    <Menu.ItemIndicator>
                      <Check className="size-3.5" />
                    </Menu.ItemIndicator>
                  </span>
                  {e.codigo} · {e.nombre}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {/* El motivo se dice en texto: el `title` de un botón deshabilitado no
          lo ve quien usa teclado ni pantalla táctil. */}
      {cambiandoEmpresa ? (
        <span role="status" className="text-xs text-slate-500">
          Abriendo…
        </span>
      ) : escribiendo ? (
        <span role="status" className="text-xs text-slate-500">
          Guardando; espere para cambiar de empresa
        </span>
      ) : null}
    </div>
  )
}
