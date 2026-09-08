import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Building2,
  ExternalLink,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Field'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { PanelAsiento } from '@/shared/asiento/PanelAsiento'
import { formatFecha } from '@/shared/format/fecha'
import { nombreTarifa } from '@/shared/fiscal/impuestos'
import { useCuentas, useTarifasImpuesto } from '@/shared/api/catalogos'
import { cuentaPorCodigo, esCuentaDeActivoFijo } from '@/shared/cuentas/cuenta'
import { useAsientosDeDocumento } from '@/shared/api/trazabilidad'
import { ApiError } from '@/shared/api/client'
import type { FacturaCompra } from '@/shared/api/contracts/cxp'
import {
  useAbrirAdjunto,
  useAgregarAdjuntos,
  useAsientoDeFacturaCompra,
  useEliminarAdjunto,
  useFacturasCompra,
} from '../api/queries'
import { tamanoLegible } from '../domain/adjunto'
import { SelectorAdjuntos } from '../components/SelectorAdjuntos'

/**
 * Facturas recibidas, su asiento y los activos que capitalizaron.
 *
 * Cuál está abierta vive en la ruta (`/cxp/facturas/:id`): el detalle de una
 * compra se envía por enlace y el botón de atrás vuelve al listado.
 */
export function FacturasCompraPage() {
  const { data: facturas = [], isLoading } = useFacturasCompra()
  const navegar = useNavigate()
  const { id } = useParams()
  const [parametros, setParametros] = useSearchParams()
  const [filtro, setFiltro] = useState('')

  // `?factura=` es la vuelta desde la ficha del activo: quien llega desde el
  // inventario quiere ver la compra que lo reconoció, no buscarla otra vez.
  // Se sigue admitiendo para no romper los enlaces que ya existen.
  const pedida = parametros.get('factura')
  const seleccionada = facturas.find((f) => f.id === (id ?? pedida)) ?? null

  const cerrarDetalle = () => {
    if (id) {
      navegar('/cxp/facturas')
      return
    }
    const nuevos = new URLSearchParams(parametros)
    nuevos.delete('factura')
    setParametros(nuevos, { replace: true })
  }

  const columnas = useMemo<ColumnDef<FacturaCompra, unknown>[]>(
    () => [
      {
        accessorKey: 'folioProveedor',
        header: 'Folio',
        meta: { ancho: '100px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs font-medium text-slate-700">
            {row.original.folioProveedor}
          </span>
        ),
      },
      {
        accessorKey: 'folioInterno',
        header: 'Interno',
        meta: { ancho: '120px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-500">
            {row.original.folioInterno}
          </span>
        ),
      },
      {
        accessorKey: 'fechaEmision',
        header: 'Emisión',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fechaEmision),
      },
      { accessorKey: 'proveedorNombre', header: 'Proveedor' },
      {
        accessorKey: 'fechaVencimiento',
        header: 'Vence',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fechaVencimiento),
      },
      {
        id: 'total',
        header: 'Total',
        meta: { numerico: true, ancho: '130px' },
        accessorFn: (f) => f.total,
        cell: ({ row }) => (
          <MoneyCell valor={row.original.total} moneda={row.original.moneda} />
        ),
      },
      {
        id: 'saldo',
        header: 'Por pagar',
        meta: { numerico: true, ancho: '130px' },
        accessorFn: (f) => f.saldo,
        cell: ({ row }) => (
          <MoneyCell valor={row.original.saldo} moneda={row.original.moneda} />
        ),
      },
      {
        accessorKey: 'estado',
        header: 'Estado',
        meta: { ancho: '130px' },
        cell: ({ row }) => <EstadoBadge estado={row.original.estado} />,
      },
    ],
    [],
  )

  return (
    <div>
      <PageHeader
        titulo="Facturas de gasto"
        descripcion="Cada factura registrada crea la cuenta por pagar del proveedor y su asiento."
        acciones={
          <Link to="/cxp/facturas/nueva">
            <Button variante="primario" icono={<Plus className="size-4" />}>
              Nueva factura
            </Button>
          </Link>
        }
      />

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search className="size-4 text-slate-400" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por folio o proveedor…"
            className="h-8 max-w-sm border-0 px-0 focus:ring-0"
          />
          <span className="ml-auto text-xs text-slate-500">
            {facturas.length} facturas
          </span>
        </div>

        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Cargando facturas…
          </p>
        ) : (
          <DataTable
            columns={columnas}
            data={facturas}
            filtro={filtro}
            onRowClick={(f) => navegar(`/cxp/facturas/${f.id}`)}
            vacio={{
              titulo: 'Sin facturas registradas',
              descripcion: 'Registre la primera para crear una cuenta por pagar.',
            }}
          />
        )}
      </Card>

      {seleccionada && (
        <DetalleFactura factura={seleccionada} onCerrar={cerrarDetalle} />
      )}
    </div>
  )
}

function DetalleFactura({
  factura,
  onCerrar,
}: {
  factura: FacturaCompra
  onCerrar: () => void
}) {
  const { data: asiento, isLoading } = useAsientoDeFacturaCompra(factura.id)
  const { data: cuentas = [] } = useCuentas()
  const agregar = useAgregarAdjuntos()
  const eliminar = useEliminarAdjunto()
  const abrir = useAbrirAdjunto()

  const errorAdjuntos = [agregar.error, eliminar.error, abrir.error].find(
    (e): e is ApiError => e instanceof ApiError,
  )
  // La tabla entera: la tarifa se nombra por la fecha de emisión de la
  // factura, que puede caer en una vigencia ya cerrada.
  const { data: tarifas = [] } = useTarifasImpuesto()
  const { data: relacionados = [] } = useAsientosDeDocumento(
    'cxp',
    'factura',
    factura.id,
  )

  // El asiento que la registró ya se enseña completo abajo: aquí van los
  // manuales que la mencionan, que son los que nadie ve si no se listan.
  const manuales = relacionados.filter((a) => a.id !== factura.asientoId)

  /**
   * Líneas que el mayor reconoce como activo fijo y el auxiliar todavía no.
   *
   * Es la misma lista que vigila activos (docs/07 §4), vista desde el documento
   * que la originó: aquí es donde el que capturó la compra se entera de que
   * falta la ficha, y desde donde la crea sin ir a buscarla.
   */
  const sinFicha = factura.lineas.filter(
    (l) =>
      l.activoId === null &&
      esCuentaDeActivoFijo(cuentaPorCodigo(cuentas, l.cuenta)),
  )

  return (
    <>
      <Card className="mt-4">
        <CardHeader
          titulo={`Factura ${factura.folioProveedor}`}
          descripcion={`${factura.proveedorNombre} · vence el ${formatFecha(factura.fechaVencimiento)}`}
          acciones={
            <Button tamano="sm" onClick={onCerrar}>
              Cerrar
            </Button>
          }
        />

        {sinFicha.length > 0 && (
          <Link
            to={`/activos/nuevo?modo=factura&factura=${factura.id}&linea=${sinFicha[0].id}`}
            className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 hover:bg-amber-100"
          >
            <TriangleAlert className="size-4 shrink-0" />
            {sinFicha.length === 1
              ? 'Una línea de esta factura cargó una cuenta de activo fijo y no tiene ficha.'
              : `${sinFicha.length} líneas de esta factura cargaron una cuenta de activo fijo y no tienen ficha.`}{' '}
            Mientras falte, el auxiliar de activos no cuadra contra el mayor.
          </Link>
        )}

        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Descripción</th>
              <th className="w-24 px-3 py-2 text-right">Cantidad</th>
              <th className="w-32 px-3 py-2 text-right">Precio</th>
              <th className="w-32 px-3 py-2 text-left">IVA</th>
              <th className="w-40 px-3 py-2 text-left">Cuenta</th>
              <th className="w-32 px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {factura.lineas.map((linea) => (
              <tr key={linea.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-1.5 text-slate-700">
                  {linea.descripcion}
                  {linea.activoId ? (
                    <Link
                      to={`/activos?activo=${linea.activoId}`}
                      className="ml-1.5 inline-flex items-center gap-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200"
                    >
                      <Building2 className="size-3" />
                      ver activo
                    </Link>
                  ) : (
                    sinFicha.includes(linea) && (
                      <Link
                        to={`/activos/nuevo?modo=factura&factura=${factura.id}&linea=${linea.id}`}
                        className="ml-1.5 inline-flex items-center gap-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200"
                      >
                        <Building2 className="size-3" />
                        registrar activo
                      </Link>
                    )
                  )}
                </td>
                <td className="tabular px-3 py-1.5 text-right text-slate-600">
                  {linea.cantidad}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <MoneyCell valor={linea.precioUnitario} moneda={factura.moneda} />
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-500">
                  {nombreTarifa(tarifas, linea.tarifa, factura.fechaEmision)}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500">
                  {linea.cuenta}
                </td>
                <td className="px-4 py-1.5 text-right">
                  <MoneyCell valor={linea.total} moneda={factura.moneda} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 text-slate-800">
            <tr>
              <td colSpan={5} className="px-4 py-1.5 text-right text-xs">
                Subtotal
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell valor={factura.subtotal} moneda={factura.moneda} />
              </td>
            </tr>
            <tr>
              <td colSpan={5} className="px-4 py-1.5 text-right text-xs">
                IVA acreditable
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell valor={factura.impuesto} moneda={factura.moneda} />
              </td>
            </tr>
            {factura.retencion !== '0.00' && (
              <tr>
                <td colSpan={5} className="px-4 py-1.5 text-right text-xs">
                  Retención de renta
                </td>
                <td className="px-4 py-1.5 text-right">
                  <MoneyCell valor={factura.retencion} moneda={factura.moneda} />
                </td>
              </tr>
            )}
            <tr className="font-semibold">
              <td colSpan={5} className="px-4 py-1.5 text-right text-xs">
                Por pagar
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell valor={factura.saldo} moneda={factura.moneda} />
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>

      <Card className="mt-4">
        <CardHeader
          titulo="Adjuntos"
          descripcion="El comprobante del proveedor y lo que sustente el gasto ante una revisión."
          acciones={
            <SelectorAdjuntos
              etiqueta="Agregar archivos"
              deshabilitado={agregar.isPending}
              onElegir={(adjuntos) =>
                agregar.mutate({ facturaId: factura.id, adjuntos })
              }
            />
          }
        />

        {errorAdjuntos && (
          <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {errorAdjuntos.message}
          </p>
        )}

        {factura.adjuntos.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">
            Sin adjuntos. Una factura de gasto sin su comprobante es un gasto
            que hay que volver a buscar el día de la revisión.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {factura.adjuntos.map((adjunto) => (
              <li
                key={adjunto.id}
                className="flex items-center gap-3 px-4 py-2 text-sm"
              >
                <button
                  type="button"
                  onClick={() =>
                    abrir.mutate({ facturaId: factura.id, adjuntoId: adjunto.id })
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-slate-700 hover:text-brand-700"
                >
                  <ExternalLink className="size-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{adjunto.nombre}</span>
                </button>
                <span className="shrink-0 text-xs text-slate-400">
                  {tamanoLegible(adjunto.tamano)}
                </span>
                <button
                  type="button"
                  title={`Eliminar ${adjunto.nombre}`}
                  aria-label={`Eliminar ${adjunto.nombre}`}
                  disabled={eliminar.isPending}
                  onClick={() =>
                    eliminar.mutate({
                      facturaId: factura.id,
                      adjuntoId: adjunto.id,
                    })
                  }
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-30"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader titulo="Asiento generado" />
        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Cargando asiento…
          </p>
        ) : asiento ? (
          <PanelAsiento asiento={asiento} />
        ) : (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            La factura no tiene asiento asociado.
          </p>
        )}
      </Card>

      {manuales.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            titulo="Otros asientos que la mencionan"
            descripcion="Ajustes capturados a mano contra esta factura. Sin ellos, el saldo del documento y el de la cuenta pueden diferir sin explicación."
          />
          <ul className="divide-y divide-slate-100">
            {manuales.map((a) => (
              <li key={a.id}>
                <Link
                  to={`/conta/asientos?q=${encodeURIComponent(a.codigo)}`}
                  className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-brand-50"
                >
                  <span className="font-mono text-xs font-medium text-slate-700">
                    {a.codigo}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatFecha(a.fecha)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-700">
                    {a.concepto}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
