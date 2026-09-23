import { useState } from 'react'
import Decimal from 'decimal.js'
import { Pencil, Plus, RefreshCw, Star, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { DialogoConfirmacion } from '@/shared/ui/DialogoConfirmacion'
import { MensajeError } from '@/shared/ui/MensajeError'
import { formatConConfig } from '@/shared/money/format'
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
  const consulta = useMonedas()
  const { data: monedas = [], isLoading } = consulta
  const guardar = useGuardarMoneda()
  const establecerFuncional = useEstablecerMonedaFuncional()
  const eliminar = useEliminarMoneda()

  const [editando, setEditando] = useState<MonedaConfig | null>(null)
  const [creando, setCreando] = useState(false)
  const [porEliminar, setPorEliminar] = useState<MonedaConfig | null>(null)
  const [porDesignar, setPorDesignar] = useState<MonedaConfig | null>(null)
  const [porDesactivar, setPorDesactivar] = useState<MonedaConfig | null>(null)
  const [tipoCambioAbierto, setTipoCambioAbierto] = useState(false)

  const ocupado =
    guardar.isPending || establecerFuncional.isPending || eliminar.isPending

  const alternarActiva = (moneda: MonedaConfig, alTerminar?: () => void) => {
    guardar.reset()
    guardar.mutate(
      {
        moneda: { ...aSolicitud(moneda), activa: !moneda.activa },
        creando: false,
      },
      { onSuccess: alTerminar },
    )
  }

  // Desactivar se confirma: la moneda deja de ofrecerse en toda la captura.
  // Activar no hace daño y va directo.
  const pedirAlternar = (moneda: MonedaConfig) => {
    if (!moneda.activa) {
      alternarActiva(moneda)
      return
    }
    guardar.reset()
    setPorDesactivar(moneda)
  }

  // Las confirmaciones usan `mutate` y enseñan el error dentro del diálogo.
  // Antes el error se pintaba en la página, tapado por el overlay, y el
  // `mutateAsync` sin `catch` dejaba una promesa rechazada sin atender.
  const confirmarEliminacion = () => {
    if (!porEliminar) return
    eliminar.mutate(porEliminar.codigo, {
      onSuccess: () => setPorEliminar(null),
    })
  }

  const confirmarFuncional = () => {
    if (!porDesignar) return
    establecerFuncional.mutate(porDesignar.codigo, {
      onSuccess: () => setPorDesignar(null),
    })
  }

  const confirmarDesactivacion = () => {
    if (!porDesactivar) return
    alternarActiva(porDesactivar, () => setPorDesactivar(null))
  }

  // Al cerrar, el error se olvida: si no, reabrir la confirmación de otra
  // moneda enseñaría el fallo de la anterior.
  const cerrarEliminacion = () => {
    setPorEliminar(null)
    eliminar.reset()
  }

  const cerrarDesignacion = () => {
    setPorDesignar(null)
    establecerFuncional.reset()
  }

  const cerrarDesactivacion = () => {
    setPorDesactivar(null)
    guardar.reset()
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

      {/* El error de activar una moneda se ve aquí; los de las acciones con
          confirmación, dentro de su diálogo. */}
      {!porDesactivar && (
        <MensajeError error={guardar.error} className="mb-4" />
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
        ) : consulta.isError && monedas.length === 0 ? (
          <EstadoError
            titulo="No se pudo cargar el catálogo de monedas"
            error={consulta.error}
            onReintentar={() => void consulta.refetch()}
            reintentando={consulta.isFetching}
          />
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
                          onClick={() => pedirAlternar(moneda)}
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

      <DialogoConfirmacion
        abierto={porDesignar !== null}
        titulo="Cambiar la moneda funcional"
        descripcion={`El libro mayor pasaría a expresarse en ${porDesignar?.codigo ?? ''}.`}
        textoConfirmar="Designar"
        textoConfirmando="Aplicando…"
        pendiente={establecerFuncional.isPending}
        error={establecerFuncional.error}
        onConfirmar={confirmarFuncional}
        onCancelar={cerrarDesignacion}
      >
        <p>
          La moneda funcional es en la que la empresa lleva su contabilidad. Su
          tipo de cambio pasa a ser 1; el de las demás queda como está, porque
          reexpresarlas es una decisión contable y no un efecto de esta
          pantalla.
        </p>
      </DialogoConfirmacion>

      <DialogoConfirmacion
        abierto={porEliminar !== null}
        titulo={`Eliminar ${porEliminar?.codigo ?? ''}`}
        textoConfirmar="Eliminar"
        textoConfirmando="Eliminando…"
        peligro
        pendiente={eliminar.isPending}
        error={eliminar.error}
        onConfirmar={confirmarEliminacion}
        onCancelar={cerrarEliminacion}
      >
        <p>
          Se retira {porEliminar?.nombre} del catálogo. Solo es posible porque no
          tiene movimientos ni cuentas asociadas; si más adelante los tuviera,
          habría que desactivarla en vez de eliminarla.
        </p>
      </DialogoConfirmacion>

      <DialogoConfirmacion
        abierto={porDesactivar !== null}
        titulo={`Desactivar ${porDesactivar?.codigo ?? ''}`}
        textoConfirmar="Desactivar"
        textoConfirmando="Desactivando…"
        pendiente={guardar.isPending}
        error={guardar.error}
        onConfirmar={confirmarDesactivacion}
        onCancelar={cerrarDesactivacion}
      >
        <p>
          {porDesactivar?.nombre} deja de ofrecerse al capturar. Los documentos
          que ya la usan se siguen viendo, y se puede volver a activar cuando
          haga falta.
        </p>
      </DialogoConfirmacion>
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
      className={`rounded p-1 text-slate-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-30 ${
        deshabilitado
          ? ''
          : peligro
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
