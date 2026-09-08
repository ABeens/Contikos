import { useMemo, useState } from 'react'
import { CircleAlert, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Dialogo } from '@/shared/ui/Dialogo'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { vigenteEn } from '@/shared/fiscal/impuestos'
import { ApiError } from '@/shared/api/client'
import type { TarifaImpuesto } from '@/shared/api/contracts/impuestos'
import { DialogoImpuesto } from '../components/DialogoImpuesto'
import { useEliminarTarifaImpuesto, useTarifasImpuesto } from '../api/queries'

/**
 * Tabla de impuestos de la empresa (docs/13 §3 y su advertencia inicial).
 *
 * Ninguna tasa está escrita en el código: esta pantalla es la que la define.
 * Cada fila es una VIGENCIA, no una tarifa: el mismo código puede aparecer
 * varias veces con periodos distintos, y el cálculo de cada factura resuelve
 * el porcentaje por SU fecha de emisión. Por eso lo que se hace cuando la ley
 * cambia una tasa es cerrar la vigencia abierta y abrir otra, y no corregir
 * la fila existente: corrigiéndola, recalcular un periodo anterior daría un
 * número distinto del que se declaró en su momento.
 */

const TIPOS: Record<string, string> = {
  iva: 'IVA',
  retencion: 'Retención',
}

export function ImpuestosPage() {
  // La tabla entera, sin fecha: aquí se mantienen también las vigencias
  // cerradas y las futuras, que es justo lo que la captura no ve.
  const { data: tarifas = [], isLoading } = useTarifasImpuesto()
  const eliminar = useEliminarTarifaImpuesto()

  const [editando, setEditando] = useState<TarifaImpuesto | null>(null)
  const [creando, setCreando] = useState(false)
  const [porEliminar, setPorEliminar] = useState<TarifaImpuesto | null>(null)

  const hoy = hoyISO()

  const filas = useMemo(
    () =>
      [...tarifas].sort(
        (a, b) =>
          a.tipo.localeCompare(b.tipo) ||
          a.codigo.localeCompare(b.codigo) ||
          a.vigenteDesde.localeCompare(b.vigenteDesde),
      ),
    [tarifas],
  )

  const errorEliminar =
    eliminar.error instanceof ApiError ? eliminar.error : null
  const enUso = errorEliminar?.codigo === 'TARIFA_EN_USO'

  const cerrarEliminacion = () => {
    setPorEliminar(null)
    eliminar.reset()
  }

  // Con `mutate` y no `mutateAsync`: el rechazo por tarifa en uso es un
  // resultado esperado de esta pantalla, no una excepción que nadie atiende.
  const confirmarEliminacion = () => {
    if (!porEliminar) return
    eliminar.mutate(porEliminar.id, { onSuccess: () => setPorEliminar(null) })
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        titulo="Impuestos"
        descripcion="Las tarifas que gravan la venta y acreditan la compra. Cada fila rige entre dos fechas y las facturas resuelven la suya por la fecha de emisión."
        acciones={
          <Button
            variante="primario"
            icono={<Plus className="size-4" />}
            onClick={() => setCreando(true)}
          >
            Nueva tarifa
          </Button>
        }
      />

      <Card>
        <CardHeader
          titulo="Tabla vigente"
          descripcion="Las facturas guardan el código, no el porcentaje: cerrar una vigencia y abrir otra deja intacto lo ya emitido."
        />

        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Cargando impuestos…
          </p>
        ) : filas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Sin tarifas. Mientras la tabla esté vacía, la captura solo ofrece
            las tarifas por defecto.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="w-32 px-4 py-2 text-left">Código</th>
                  <th className="px-3 py-2 text-left">Nombre</th>
                  <th className="w-24 px-3 py-2 text-left">Tipo</th>
                  <th className="w-24 px-3 py-2 text-right">Porcentaje</th>
                  <th className="w-56 px-3 py-2 text-left">Vigencia</th>
                  <th className="w-44 px-3 py-2 text-left">Estado</th>
                  <th className="w-24 px-4 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((tarifa) => (
                  <tr
                    key={tarifa.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-slate-700">
                      {tarifa.codigo}
                      {tarifa.codigoHacienda && (
                        <span
                          title="Código del catálogo de Hacienda"
                          className="ml-1.5 font-sans text-[10px] font-normal text-slate-400"
                        >
                          H {tarifa.codigoHacienda}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {tarifa.nombre}
                      {!tarifa.generaImpuesto && (
                        <span
                          title="No genera impuesto: se declara aparte de una tarifa del 0%"
                          className="ml-2 text-[11px] text-slate-400"
                        >
                          sin impuesto
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {TIPOS[tarifa.tipo] ?? tarifa.tipo}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-slate-700">
                      {tarifa.porcentaje}%
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      Desde {formatFecha(tarifa.vigenteDesde)}
                      {tarifa.vigenteHasta
                        ? ` hasta ${formatFecha(tarifa.vigenteHasta)}`
                        : ' (sin fin)'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {vigenteEn(tarifa, hoy) ? (
                          <Marca tono="verde" titulo="Rige hoy">
                            Vigente
                          </Marca>
                        ) : tarifa.vigenteDesde > hoy ? (
                          <Marca tono="brand" titulo="Empieza a regir después">
                            Futura
                          </Marca>
                        ) : (
                          <Marca
                            tono="gris"
                            titulo="Ya no rige, pero nombra los documentos de su época"
                          >
                            Cerrada
                          </Marca>
                        )}
                        {!tarifa.activa && (
                          <Marca
                            tono="ambar"
                            titulo="No se ofrece al capturar una línea"
                          >
                            No se ofrece
                          </Marca>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-0.5">
                        <IconoAccion
                          titulo="Editar"
                          onClick={() => setEditando(tarifa)}
                        >
                          <Pencil className="size-4" />
                        </IconoAccion>
                        <IconoAccion
                          titulo="Eliminar la vigencia"
                          peligro
                          deshabilitado={eliminar.isPending}
                          onClick={() => {
                            eliminar.reset()
                            setPorEliminar(tarifa)
                          }}
                        >
                          <Trash2 className="size-4" />
                        </IconoAccion>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(creando || editando) && (
        <DialogoImpuesto
          // La clave reinicia el formulario al cambiar de fila editada.
          key={editando?.id ?? 'nueva'}
          abierto
          tarifa={editando ?? undefined}
          tarifas={tarifas}
          onCerrar={() => {
            setCreando(false)
            setEditando(null)
          }}
        />
      )}

      <Dialogo
        abierto={porEliminar !== null}
        onCerrar={cerrarEliminacion}
        titulo={`Eliminar ${porEliminar?.codigo ?? ''}`}
        descripcion={
          porEliminar
            ? `Vigencia desde ${formatFecha(porEliminar.vigenteDesde)}${
                porEliminar.vigenteHasta
                  ? ` hasta ${formatFecha(porEliminar.vigenteHasta)}`
                  : ' sin fin'
              }.`
            : undefined
        }
        acciones={
          <>
            <Button onClick={cerrarEliminacion}>
              {enUso ? 'Cerrar' : 'Cancelar'}
            </Button>
            {!enUso && (
              <Button
                variante="peligro"
                onClick={confirmarEliminacion}
                disabled={eliminar.isPending}
              >
                {eliminar.isPending ? 'Eliminando…' : 'Eliminar'}
              </Button>
            )}
          </>
        }
      >
        {enUso ? (
          // El servidor no deja borrar una vigencia con documentos calculados
          // contra ella. La pantalla explica por qué y qué hacer en su lugar,
          // porque "no se puede" a secas manda al usuario a insistir.
          <div className="rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
            <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
              <CircleAlert className="size-4 shrink-0" />
              No se puede eliminar: hay facturas calculadas con esta tarifa
            </p>
            <p className="mt-1.5 text-xs text-red-700">
              {errorEliminar?.message}
            </p>
            <p className="mt-2 text-xs text-red-700">
              Borrarla dejaría esas facturas citando un porcentaje que ya no
              existe, y recalcular su periodo daría un número distinto del
              declarado. Para dejar de usarla, edítela y ponga fin a su
              vigencia (o desmarque &quot;se ofrece al capturar&quot;): los
              documentos ya emitidos la siguen resolviendo y los nuevos no la
              ven.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-700">
            Se retira esta vigencia de la tabla. Solo es posible mientras
            ninguna factura se haya calculado con ella; si alguna la usa, la
            forma de retirarla es cerrar su vigencia, no borrarla.
          </p>
        )}

        {errorEliminar && !enUso && (
          <p className="mt-3 text-xs text-red-700">{errorEliminar.message}</p>
        )}
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
