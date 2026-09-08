import { useState } from 'react'
import Decimal from 'decimal.js'
import {
  CircleAlert,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Dialogo } from '@/shared/ui/Dialogo'
import { formatConConfig } from '@/shared/money/format'
import { ApiError } from '@/shared/api/client'
import type { MonedaConfig } from '@/shared/api/contracts/config'
import { DialogoMoneda } from '../components/DialogoMoneda'
import { DialogoTipoCambio } from '../components/DialogoTipoCambio'
import { aSolicitud } from '../domain/moneda'
import {
  useEliminarMoneda,
  useEstablecerMonedaFuncional,
  useGuardarMoneda,
  useMonedas,
} from '../api/queries'

/** El mismo importe para todas las filas: así la columna es comparable. */
const EJEMPLO = new Decimal('1234567.89')

export function MonedasPage() {
  const { data: monedas = [], isLoading } = useMonedas()
  const guardar = useGuardarMoneda()
  const establecerFuncional = useEstablecerMonedaFuncional()
  const eliminar = useEliminarMoneda()

  const [editando, setEditando] = useState<MonedaConfig | null>(null)
  const [creando, setCreando] = useState(false)
  const [porEliminar, setPorEliminar] = useState<MonedaConfig | null>(null)
  const [porDesignar, setPorDesignar] = useState<MonedaConfig | null>(null)
  const [tipoCambioAbierto, setTipoCambioAbierto] = useState(false)

  const ocupado =
    guardar.isPending || establecerFuncional.isPending || eliminar.isPending

  const error = [guardar.error, establecerFuncional.error, eliminar.error].find(
    (e): e is ApiError => e instanceof ApiError,
  )

  const alternarActiva = (moneda: MonedaConfig) =>
    guardar.mutate({
      moneda: { ...aSolicitud(moneda), activa: !moneda.activa },
      creando: false,
    })

  const confirmarEliminacion = async () => {
    if (!porEliminar) return
    await eliminar.mutateAsync(porEliminar.codigo)
    setPorEliminar(null)
  }

  const confirmarFuncional = async () => {
    if (!porDesignar) return
    await establecerFuncional.mutateAsync(porDesignar.codigo)
    setPorDesignar(null)
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        titulo="Monedas"
        descripcion="Catálogo de la empresa. El libro mayor se lleva siempre en la moneda funcional; las demás se registran con su tipo de cambio."
        acciones={
          <>
            <Button
              icono={<RefreshCw className="size-4" />}
              onClick={() => setTipoCambioAbierto(true)}
            >
              Tipo de cambio del día
            </Button>
            <Button
              variante="primario"
              icono={<Plus className="size-4" />}
              onClick={() => setCreando(true)}
            >
              Nueva moneda
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4 shrink-0" />
            {error.codigo} — {error.message}
          </p>
        </div>
      )}

      <Card>
        <CardHeader
          titulo="Catálogo"
          descripcion="El código ISO 4217 es la llave: no cambia una vez que hay documentos grabados con él."
        />

        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Cargando monedas…
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="w-20 px-4 py-2 text-left">Código</th>
                  <th className="px-3 py-2 text-left">Nombre</th>
                  <th className="w-44 px-3 py-2 text-right">Ejemplo</th>
                  <th className="w-20 px-3 py-2 text-right">Decimales</th>
                  <th className="w-32 px-3 py-2 text-right">Tipo de cambio</th>
                  <th className="w-40 px-3 py-2 text-left">Estado</th>
                  <th className="w-32 px-4 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {monedas.map((moneda) => (
                  <tr
                    key={moneda.codigo}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-slate-700">
                      {moneda.codigo}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {moneda.nombre}
                      <span className="ml-2 text-xs text-slate-400">
                        {moneda.simbolo}
                      </span>
                    </td>
                    <td className="tabular px-3 py-2 text-right text-slate-700">
                      {formatConConfig(EJEMPLO, moneda)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-slate-500">
                      {moneda.decimales}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-slate-700">
                      {moneda.funcional ? (
                        <span className="text-slate-400">a la par</span>
                      ) : (
                        moneda.tipoCambio
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {moneda.funcional && (
                          <Marca
                            tono="brand"
                            titulo="El libro mayor se lleva en esta moneda"
                          >
                            Funcional
                          </Marca>
                        )}
                        {moneda.activa ? (
                          <Marca tono="verde">Activa</Marca>
                        ) : (
                          <Marca tono="gris">Inactiva</Marca>
                        )}
                        {moneda.enUso && (
                          <Marca
                            tono="ambar"
                            titulo="Tiene asientos o cuentas asociadas"
                          >
                            Con movimientos
                          </Marca>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-0.5">
                        {!moneda.funcional && (
                          <IconoAccion
                            titulo={
                              moneda.activa
                                ? 'Designar como moneda funcional'
                                : 'Una moneda inactiva no puede ser la funcional'
                            }
                            deshabilitado={ocupado || !moneda.activa}
                            onClick={() => setPorDesignar(moneda)}
                          >
                            <Star className="size-4" />
                          </IconoAccion>
                        )}
                        <IconoAccion
                          titulo="Editar"
                          deshabilitado={ocupado}
                          onClick={() => setEditando(moneda)}
                        >
                          <Pencil className="size-4" />
                        </IconoAccion>
                        {!moneda.funcional && (
                          <IconoAccion
                            titulo={
                              moneda.enUso
                                ? 'Tiene movimientos: desactívela en vez de eliminarla'
                                : 'Eliminar del catálogo'
                            }
                            deshabilitado={ocupado || moneda.enUso}
                            peligro
                            onClick={() => setPorEliminar(moneda)}
                          >
                            <Trash2 className="size-4" />
                          </IconoAccion>
                        )}
                      </div>
                      {!moneda.funcional && (
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => alternarActiva(moneda)}
                          className="mt-0.5 block w-full text-right text-[11px] text-slate-500 hover:text-brand-700 disabled:opacity-40"
                        >
                          {moneda.activa ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(creando || editando) && (
        <DialogoMoneda
          // La clave reinicia el formulario al cambiar de moneda editada.
          key={editando?.codigo ?? 'nueva'}
          abierto
          moneda={editando ?? undefined}
          monedas={monedas}
          onCerrar={() => {
            setCreando(false)
            setEditando(null)
          }}
        />
      )}

      {tipoCambioAbierto && (
        <DialogoTipoCambio
          abierto
          monedas={monedas}
          onCerrar={() => setTipoCambioAbierto(false)}
        />
      )}

      <Dialogo
        abierto={porDesignar !== null}
        onCerrar={() => setPorDesignar(null)}
        titulo="Cambiar la moneda funcional"
        descripcion={`El libro mayor pasaría a expresarse en ${porDesignar?.codigo ?? ''}.`}
        acciones={
          <>
            <Button onClick={() => setPorDesignar(null)}>Cancelar</Button>
            <Button
              variante="primario"
              onClick={() => void confirmarFuncional()}
              disabled={establecerFuncional.isPending}
            >
              {establecerFuncional.isPending ? 'Aplicando…' : 'Designar'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          La moneda funcional es en la que la empresa lleva su contabilidad. Su
          tipo de cambio pasa a ser 1; el de las demás queda como está, porque
          reexpresarlas es una decisión contable y no un efecto de esta
          pantalla.
        </p>
      </Dialogo>

      <Dialogo
        abierto={porEliminar !== null}
        onCerrar={() => setPorEliminar(null)}
        titulo={`Eliminar ${porEliminar?.codigo ?? ''}`}
        acciones={
          <>
            <Button onClick={() => setPorEliminar(null)}>Cancelar</Button>
            <Button
              variante="peligro"
              onClick={() => void confirmarEliminacion()}
              disabled={eliminar.isPending}
            >
              {eliminar.isPending ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Se retira {porEliminar?.nombre} del catálogo. Solo es posible porque no
          tiene movimientos ni cuentas asociadas; si más adelante los tuviera,
          habría que desactivarla en vez de eliminarla.
        </p>
      </Dialogo>
    </div>
  )
}

function IconoAccion({
  titulo,
  onClick,
  deshabilitado,
  peligro,
  children,
}: {
  titulo: string
  onClick: () => void
  deshabilitado?: boolean
  peligro?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      disabled={deshabilitado}
      onClick={onClick}
      className={`rounded p-1 text-slate-400 disabled:pointer-events-none disabled:opacity-30 ${
        peligro
          ? 'hover:bg-red-50 hover:text-red-600'
          : 'hover:bg-slate-100 hover:text-brand-700'
      }`}
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
  tono: 'brand' | 'verde' | 'gris' | 'ambar'
  titulo?: string
  children: React.ReactNode
}) {
  const tonos = {
    brand: 'bg-brand-50 text-brand-700',
    verde: 'bg-emerald-50 text-emerald-700',
    gris: 'bg-slate-100 text-slate-600',
    ambar: 'bg-amber-50 text-amber-700',
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
