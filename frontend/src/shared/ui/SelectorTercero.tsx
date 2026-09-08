import { useMemo, useState } from 'react'
import { Search, Users } from 'lucide-react'
import { empresaActiva } from '@/shared/almacen/almacen'
import { useDirectorioTerceros } from '@/shared/api/catalogos'
import type { RolTercero, TerceroGrupo } from '@/shared/api/contracts/empresas'
import {
  formatIdentificacion,
  normalizarIdentificacion,
} from '@/shared/fiscal/identificacion'
import { Input } from './Field'

export interface SelectorTerceroProps {
  /** Con qué papel se va a dar de alta el tercero en la empresa abierta. */
  rol: RolTercero
  onElegir: (tercero: TerceroGrupo) => void
}

const ROL_NOMBRE: Record<RolTercero, string> = {
  cliente: 'cliente',
  proveedor: 'proveedor',
}

/**
 * Buscador en el directorio de terceros del grupo (docs/12 D-12).
 *
 * Aparece solo al dar de alta. Elegir una entrada precarga la identidad
 * (tipo y número de identificación, razón social, contacto) y nada más: las
 * condiciones comerciales las decide la empresa que lo da de alta, no la que
 * ya lo conocía. Los campos siguen editables después.
 *
 * El tercero que ya existe en la empresa abierta con este mismo papel se
 * enseña pero no se puede elegir: el alta fallaría por identificación
 * duplicada, y es mejor decirlo antes.
 */
export function SelectorTercero({ rol, onElegir }: SelectorTerceroProps) {
  const empresaId = empresaActiva()
  const [busqueda, setBusqueda] = useState('')
  const { data: directorio = [], isLoading } = useDirectorioTerceros(true)

  const resultados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    if (texto.length < 2) return []
    const numero = normalizarIdentificacion(texto)
    return directorio
      .filter(
        (t) =>
          t.razonSocial.toLowerCase().includes(texto) ||
          (t.nombreComercial?.toLowerCase().includes(texto) ?? false) ||
          (numero.length >= 2 && t.identificacion.includes(numero)),
      )
      .slice(0, 8)
  }, [busqueda, directorio])

  const yaEnEstaEmpresa = (t: TerceroGrupo) =>
    t.apariciones.some((a) => a.empresaId === empresaId && a.rol === rol)

  return (
    <div className="mb-4 rounded-md bg-slate-50 p-3 ring-1 ring-slate-200 ring-inset">
      <label
        htmlFor="buscar-tercero"
        className="flex items-center gap-1.5 text-xs font-medium text-slate-600"
      >
        <Users className="size-3.5" />
        Buscar en el directorio del grupo
      </label>
      <p className="mt-0.5 mb-2 text-[11px] text-slate-500">
        Si otra empresa del grupo ya lo conoce, se toma su identificación y
        razón social. Las condiciones comerciales se fijan aquí.
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          id="buscar-tercero"
          value={busqueda}
          placeholder="Razón social o identificación"
          className="pl-8"
          autoComplete="off"
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {busqueda.trim().length >= 2 && (
        <ul className="mt-2 divide-y divide-slate-200 rounded-md bg-white ring-1 ring-slate-200 ring-inset">
          {isLoading ? (
            <li className="px-3 py-2 text-xs text-slate-500">Buscando…</li>
          ) : resultados.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">
              Ninguna empresa del grupo conoce ese tercero. Se captura desde
              cero.
            </li>
          ) : (
            resultados.map((t) => {
              const repetido = yaEnEstaEmpresa(t)
              return (
                <li key={`${t.tipoIdentificacion}:${t.identificacion}`}>
                  <button
                    type="button"
                    disabled={repetido}
                    aria-label={
                      repetido
                        ? `Ya es ${ROL_NOMBRE[rol]} de esta empresa`
                        : `Tomar la identidad de ${t.razonSocial}`
                    }
                    onClick={() => {
                      onElegir(t)
                      setBusqueda('')
                    }}
                    className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-brand-50/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-800">
                        {t.razonSocial}
                      </span>
                      <span className="block font-mono text-[11px] text-slate-500">
                        {formatIdentificacion(
                          t.identificacion,
                          t.tipoIdentificacion,
                        )}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      {t.apariciones.map((a) => (
                        <span
                          key={`${a.empresaId}:${a.rol}`}
                          title={`${ROL_NOMBRE[a.rol]} ${a.codigo} en ${a.empresaNombre}`}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            a.empresaId === empresaId
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {ROL_NOMBRE[a.rol]} en {a.empresaCodigo}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
