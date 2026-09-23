import { useState } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { LogIn, Pencil, Plus } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { DialogoConfirmacion } from '@/shared/ui/DialogoConfirmacion'
import { MensajeError } from '@/shared/ui/MensajeError'
import { formatIdentificacion } from '@/shared/fiscal/identificacion'
import type { Empresa } from '@/shared/api/contracts/empresas'
import { useAbrirEmpresa, useEmpresa } from '@/app/empresa'
import { DialogoEmpresa } from '../components/DialogoEmpresa'
import { aSolicitud, MESES } from '../domain/empresa'
import { useEmpresas, useGuardarEmpresa } from '../api/queries'

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
  const { empresa: abierta, empresas, cambiandoEmpresa } = useEmpresa()
  // El catálogo llega por el contexto, que no se monta sin él. Lo que puede
  // fallar es una relectura posterior: se dice, en vez de enseñar en silencio
  // una lista que quizá ya no es la del servidor.
  const lectura = useEmpresas()
  const abrirEmpresa = useAbrirEmpresa()
  const guardar = useGuardarEmpresa()
  const escribiendo = useIsMutating() > 0

  const [editando, setEditando] = useState<Empresa | null>(null)
  const [creando, setCreando] = useState(false)
  const [porDesactivar, setPorDesactivar] = useState<Empresa | null>(null)

  const ocupado = guardar.isPending || cambiandoEmpresa

  const alternarActiva = (empresa: Empresa, alTerminar?: () => void) => {
    guardar.reset()
    guardar.mutate(
      {
        datos: { ...aSolicitud(empresa), activa: !empresa.activa },
        id: empresa.id,
      },
      { onSuccess: alTerminar },
    )
  }

  // Desactivar se confirma: saca la empresa del selector de todo el grupo.
  // Activar no hace daño y va directo.
  const pedirAlternar = (empresa: Empresa) => {
    if (!empresa.activa) {
      alternarActiva(empresa)
      return
    }
    guardar.reset()
    setPorDesactivar(empresa)
  }

  const cerrarDesactivacion = () => {
    if (guardar.isPending) return
    setPorDesactivar(null)
    guardar.reset()
  }

  // Abrir otra empresa navega primero al inicio: si hay algo que impida salir
  // de aquí, ahí se pregunta. Con una escritura en curso no se ofrece (ver el
  // selector de la barra superior).
  const motivoNoAbrir = (empresa: Empresa): string | null =>
    !empresa.activa
      ? 'Una empresa inactiva no se puede abrir'
      : escribiendo || cambiandoEmpresa
        ? 'Espere a que termine la operación en curso'
        : null

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

      {/* El error de activar se ve aquí; el de desactivar, dentro de su
          confirmación, que es donde está mirando el usuario. */}
      {!porDesactivar && (
        <MensajeError error={guardar.error} className="mb-4" />
      )}
      <MensajeError error={lectura.error} className="mb-4" />

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
                              motivoNoAbrir(empresa) ?? `Abrir ${empresa.codigo}`
                            }
                            deshabilitado={motivoNoAbrir(empresa) !== null}
                            onClick={() => abrirEmpresa(empresa.id)}
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
                          onClick={() => pedirAlternar(empresa)}
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

      <DialogoConfirmacion
        abierto={porDesactivar !== null}
        titulo={`Desactivar ${porDesactivar?.codigo ?? ''}`}
        textoConfirmar="Desactivar"
        textoConfirmando="Desactivando…"
        pendiente={guardar.isPending}
        error={guardar.error}
        onConfirmar={() =>
          porDesactivar &&
          alternarActiva(porDesactivar, () => setPorDesactivar(null))
        }
        onCancelar={cerrarDesactivacion}
      >
        <p>
          {porDesactivar?.nombre} deja de ofrecerse en el selector de empresa.
          Sus datos siguen guardados y se puede volver a activar cuando haga
          falta.
        </p>
      </DialogoConfirmacion>
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
    // `aria-disabled` y no `disabled`: un botón deshabilitado no recibe foco
    // ni eventos del puntero, así que su `title` (que es justo el motivo por
    // el que no se puede) no lo veía nadie.
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-disabled={deshabilitado || undefined}
      onClick={() => {
        if (!deshabilitado) onClick()
      }}
      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-700 aria-disabled:cursor-not-allowed aria-disabled:opacity-30 aria-disabled:hover:bg-transparent aria-disabled:hover:text-slate-400"
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
