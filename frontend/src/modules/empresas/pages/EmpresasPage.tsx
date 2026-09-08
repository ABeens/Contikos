import { useState } from 'react'
import { useNavigate } from 'react-router'
import { CircleAlert, LogIn, Pencil, Plus } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { ApiError } from '@/shared/api/client'
import { formatIdentificacion } from '@/shared/fiscal/identificacion'
import type { Empresa } from '@/shared/api/contracts/empresas'
import { useEmpresa } from '@/app/empresa'
import { DialogoEmpresa } from '../components/DialogoEmpresa'
import { aSolicitud, MESES } from '../domain/empresa'
import { useGuardarEmpresa } from '../api/queries'

/**
 * Catálogo de empresas del grupo (docs/01 §4.1).
 *
 * Desde aquí se da de alta una empresa, se edita lo que la identifica y se
 * entra en ella. Lo que NO se hace aquí es tocar sus datos: el catálogo de
 * cuentas, las monedas o los clientes de una empresa se administran desde
 * dentro, con esa empresa abierta. Es la misma regla que impide que una
 * pantalla de una empresa vea datos de otra.
 */
export function EmpresasPage() {
  const { empresa: abierta, empresas, cambiarEmpresa } = useEmpresa()
  const navigate = useNavigate()
  const guardar = useGuardarEmpresa()

  const [editando, setEditando] = useState<Empresa | null>(null)
  const [creando, setCreando] = useState(false)
  const [abriendo, setAbriendo] = useState<string | null>(null)

  const error = guardar.error instanceof ApiError ? guardar.error : null
  const ocupado = guardar.isPending || abriendo !== null

  const alternarActiva = (empresa: Empresa) =>
    guardar.mutate({
      datos: { ...aSolicitud(empresa), activa: !empresa.activa },
      id: empresa.id,
    })

  const abrir = async (id: string) => {
    setAbriendo(id)
    try {
      await cambiarEmpresa(id)
      void navigate('/')
    } finally {
      setAbriendo(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        titulo="Empresas"
        descripcion="Las empresas del grupo. Cada una lleva su catálogo de cuentas, sus monedas, sus terceros y su mayor; nada se cruza entre ellas."
        acciones={
          <Button
            variante="primario"
            icono={<Plus className="size-4" />}
            onClick={() => setCreando(true)}
          >
            Nueva empresa
          </Button>
        }
      />

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4 shrink-0" />
            {error.codigo}: {error.message}
          </p>
        </div>
      )}

      <Card>
        <CardHeader
          titulo="Catálogo"
          descripcion="La empresa abierta es la que se ve en la barra superior. Los clientes y proveedores de cada una son suyos; el directorio del grupo solo comparte la identidad."
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="w-20 px-4 py-2 text-left">Siglas</th>
                <th className="px-3 py-2 text-left">Razón social</th>
                <th className="w-40 px-3 py-2 text-left">Identificación</th>
                <th className="w-32 px-3 py-2 text-left">Ejercicio</th>
                <th className="w-36 px-3 py-2 text-left">Estado</th>
                <th className="w-40 px-4 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {empresas.map((empresa) => {
                const esAbierta = empresa.id === abierta.id
                return (
                  <tr
                    key={empresa.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-slate-700">
                      {empresa.codigo}
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-slate-800">{empresa.nombre}</p>
                      {empresa.nombreComercial && (
                        <p className="text-[11px] text-slate-500">
                          {empresa.nombreComercial}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {formatIdentificacion(
                        empresa.identificacion,
                        empresa.tipoIdentificacion,
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      Desde {MESES[empresa.ejercicioInicioMes - 1]}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {esAbierta && (
                          <Marca tono="brand" titulo="Es la empresa en la que se está trabajando">
                            Abierta
                          </Marca>
                        )}
                        {empresa.activa ? (
                          <Marca tono="verde">Activa</Marca>
                        ) : (
                          <Marca tono="gris">Inactiva</Marca>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-0.5">
                        {!esAbierta && (
                          <IconoAccion
                            titulo={
                              empresa.activa
                                ? `Abrir ${empresa.codigo}`
                                : 'Una empresa inactiva no se puede abrir'
                            }
                            deshabilitado={ocupado || !empresa.activa}
                            onClick={() => void abrir(empresa.id)}
                          >
                            <LogIn className="size-4" />
                          </IconoAccion>
                        )}
                        <IconoAccion
                          titulo={`Editar ${empresa.codigo}`}
                          deshabilitado={ocupado}
                          onClick={() => setEditando(empresa)}
                        >
                          <Pencil className="size-4" />
                        </IconoAccion>
                      </div>
                      {!esAbierta && (
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => alternarActiva(empresa)}
                          className="mt-0.5 block w-full text-right text-[11px] text-slate-500 hover:text-brand-700 disabled:opacity-40"
                        >
                          {empresa.activa ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {(creando || editando) && (
        <DialogoEmpresa
          // La clave reinicia el formulario al cambiar de empresa editada.
          key={editando?.id ?? 'nueva'}
          abierto
          empresa={editando ?? undefined}
          empresas={empresas}
          empresaAbierta={abierta.id}
          onCerrar={() => {
            setCreando(false)
            setEditando(null)
          }}
        />
      )}
    </div>
  )
}

function IconoAccion({
  titulo,
  onClick,
  deshabilitado,
  children,
}: {
  titulo: string
  onClick: () => void
  deshabilitado?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      disabled={deshabilitado}
      onClick={onClick}
      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-700 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function Marca({
  tono,
  titulo,
  children,
}: {
  tono: 'brand' | 'verde' | 'gris'
  titulo?: string
  children: React.ReactNode
}) {
  const tonos = {
    brand: 'bg-brand-50 text-brand-700',
    verde: 'bg-emerald-50 text-emerald-700',
    gris: 'bg-slate-100 text-slate-600',
  }
  return (
    <span
      title={titulo}
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tonos[tono]}`}
    >
      {children}
    </span>
  )
}
