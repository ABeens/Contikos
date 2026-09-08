import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Building2 } from 'lucide-react'
import { useEmpresa } from '@/app/empresa'
import { empresasAbribles } from '../domain/empresa'

/**
 * Selector de empresa de la barra superior.
 *
 * Cambiar de empresa cambia TODO lo que hay en pantalla: catálogos, mayor,
 * documentos, moneda funcional. Por eso al cambiar se vuelve al inicio: la
 * pantalla en la que se estaba (el detalle de una factura, por ejemplo) no
 * tiene por qué existir en la otra empresa.
 *
 * Con una sola empresa abrible no hay nada que elegir y se enseña el nombre
 * a secas.
 */
export function SelectorEmpresa() {
  const { empresa, empresas, cambiarEmpresa } = useEmpresa()
  const navigate = useNavigate()
  const [cambiando, setCambiando] = useState(false)

  const abribles = empresasAbribles(empresas, empresa.id)

  const cambiar = async (id: string) => {
    if (id === empresa.id) return
    setCambiando(true)
    try {
      await cambiarEmpresa(id)
      void navigate('/')
    } finally {
      setCambiando(false)
    }
  }

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
      <label htmlFor="empresa-activa" className="sr-only">
        Empresa
      </label>
      <Building2 className="size-4 shrink-0 text-slate-400" />
      <select
        id="empresa-activa"
        value={empresa.id}
        disabled={cambiando}
        onChange={(e) => void cambiar(e.target.value)}
        className="h-8 max-w-72 truncate rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800 disabled:opacity-60"
      >
        {abribles.map((e) => (
          <option key={e.id} value={e.id}>
            {e.codigo} · {e.nombre}
          </option>
        ))}
      </select>
      {cambiando && (
        <span className="text-xs text-slate-500">Abriendo…</span>
      )}
    </div>
  )
}
