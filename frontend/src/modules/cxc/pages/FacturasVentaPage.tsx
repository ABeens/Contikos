import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Field'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { PanelAsiento } from '@/shared/asiento/PanelAsiento'
import { formatFecha } from '@/shared/format/fecha'
import { formatConsecutivo } from '@/shared/fiscal/comprobante'
import { nombreTarifa } from '@/shared/fiscal/impuestos'
import { useTarifasImpuesto } from '@/shared/api/catalogos'
import { useAsientosDeDocumento } from '@/shared/api/trazabilidad'
import type { FacturaVenta } from '@/shared/api/contracts/cxc'
import { useAsientoDeFactura, useCobros, useFacturasVenta } from '../api/queries'

/**
 * Facturas emitidas y su asiento.
 *
 * El detalle enseña el documento y el asiento juntos: es la forma de comprobar,
 * sin salir del módulo, que lo que se facturó es lo que llegó al mayor.
 *
 * Cuál está abierta vive en la URL (`/cxc/facturas/:id`) y no en un estado
 * local: así el detalle de una factura se puede enviar por enlace y el botón
 * de atrás del navegador devuelve al listado (docs/14 §6).
 */
export function FacturasVentaPage() {
  const { data: facturas = [], isLoading } = useFacturasVenta()
  const navegar = useNavigate()
  const { id } = useParams()
  const [filtro, setFiltro] = useState('')

  // La seleccionada sale de la ruta, no de un clic: entrar con el enlace y
  // hacer clic en la fila tienen que dejar la pantalla en el mismo estado.
  const seleccionada = facturas.find((f) => f.id === id) ?? null

  const columnas = useMemo<ColumnDef<FacturaVenta, unknown>[]>(
    () => [
      {
        accessorKey: 'numeroInterno',
        header: 'Interno',
        meta: { ancho: '110px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs font-medium text-slate-700">
            {row.original.numeroInterno}
          </span>
        ),
      },
      {
        // El consecutivo de Hacienda es el otro número de la misma factura
        // (docs/13 §4.2): el interno es el que se busca, este es el que viaja
        // al comprobante. Van en columnas separadas porque no son el mismo
        // dato y confundirlos al conciliar cuesta caro.
        accessorKey: 'consecutivo',
        header: 'Comprobante',
        meta: { ancho: '190px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-500">
            {formatConsecutivo(row.original.consecutivo)}
          </span>
        ),
      },
      {
        accessorKey: 'fechaEmision',
        header: 'Emisión',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fechaEmision),
      },
      { accessorKey: 'clienteNombre', header: 'Cliente' },
      {
        accessorKey: 'fechaVencimiento',
        header: 'Vence',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fechaVencimiento),
      },
      {
        id: 'total',
        header: 'Total',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (f) => f.total,
        cell: ({ row }) => (
          <MoneyCell valor={row.original.total} moneda={row.original.moneda} />
        ),
      },
      {
        id: 'saldo',
        header: 'Por cobrar',
        meta: { numerico: true, ancho: '140px' },
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
        titulo="Facturas de venta"
        descripcion="Cada factura emitida crea la cuenta por cobrar del cliente y su asiento."
        acciones={
          <Link to="/cxc/facturas/nueva">
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
            placeholder="Buscar por número, comprobante o cliente…"
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
            onRowClick={(f) => navegar(`/cxc/facturas/${f.id}`)}
            vacio={{
              titulo: 'Sin facturas emitidas',
              descripcion: 'Emita la primera para crear una cuenta por cobrar.',
            }}
          />
        )}
      </Card>

      {seleccionada && (
        <DetalleFactura
          factura={seleccionada}
          onCerrar={() => navegar('/cxc/facturas')}
        />
      )}
    </div>
  )
}

function DetalleFactura({
  factura,
  onCerrar,
}: {
  factura: FacturaVenta
  onCerrar: () => void
}) {
  const { data: asiento, isLoading } = useAsientoDeFactura(factura.id)
  // La tabla entera: la tarifa se nombra por la fecha de emisión, que puede
  // caer en una vigencia ya cerrada.
  const { data: tarifas = [] } = useTarifasImpuesto()
  const { data: relacionados = [] } = useAsientosDeDocumento(
    'cxc',
    'factura',
    factura.id,
  )
  // Quién bajó este saldo. La relación es N a N (docs/04 §1), así que el dato
  // no está en la factura: se le pregunta a los cobros por esta factura.
  const { data: cobros = [] } = useCobros({ facturaId: factura.id })

  // El asiento que la generó ya se enseña completo arriba: aquí van los
  // manuales que la mencionan, que son los que nadie ve si no se listan.
  const manuales = relacionados.filter((a) => a.id !== factura.asientoId)

  return (
    <>
      <Card className="mt-4">
        <CardHeader
          titulo={`Factura ${factura.numeroInterno}`}
          descripcion={`${factura.clienteNombre} · vence el ${formatFecha(factura.fechaVencimiento)}`}
          acciones={
            <Button tamano="sm" onClick={onCerrar}>
              Cerrar
            </Button>
          }
        />

        <dl className="grid grid-cols-1 gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-3 sm:grid-cols-3">
          <Dato titulo="Número interno" ayuda="Lo asigna el sistema">
            {factura.numeroInterno}
          </Dato>
          <Dato
            titulo="Comprobante electrónico"
            ayuda="20 dígitos según Hacienda"
          >
            {formatConsecutivo(factura.consecutivo)}
          </Dato>
          <Dato
            titulo="Clave numérica"
            ayuda={
              factura.claveNumerica
                ? undefined
                : 'Se generará al emitir el comprobante'
            }
          >
            {factura.claveNumerica ?? 'Pendiente'}
          </Dato>
        </dl>

        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Descripción</th>
              <th className="w-24 px-3 py-2 text-right">Cantidad</th>
              <th className="w-32 px-3 py-2 text-right">Precio</th>
              <th className="w-32 px-3 py-2 text-left">IVA</th>
              <th className="w-36 px-3 py-2 text-left">Cuenta</th>
              <th className="w-32 px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {factura.lineas.map((linea) => (
              <tr key={linea.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-1.5 text-slate-700">
                  {linea.descripcion}
                  {/* El código con el que se vendió, tal como estaba al emitir:
                      renombrar el catálogo después no cambia el comprobante. */}
                  {linea.itemCodigo && (
                    <span className="ml-1.5 font-mono text-[11px] text-slate-400">
                      {linea.itemCodigo}
                    </span>
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
                  {linea.cuentaIngreso}
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
                IVA
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell valor={factura.impuesto} moneda={factura.moneda} />
              </td>
            </tr>
            <tr className="font-semibold">
              <td colSpan={5} className="px-4 py-1.5 text-right text-xs">
                Total
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell valor={factura.total} moneda={factura.moneda} />
              </td>
            </tr>
          </tfoot>
        </table>
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

      {cobros.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            titulo="Cobros aplicados"
            descripcion="Lo que ha bajado el saldo de esta factura, cobro a cobro."
          />
          <table className="w-full text-sm" aria-label="Cobros de la factura">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left">Cobro</th>
                <th className="w-28 px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-right">Aplicado</th>
                <th className="w-32 px-4 py-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody>
              {cobros.map((cobro) => {
                const aplicacion = cobro.aplicaciones.find(
                  (a) => a.facturaId === factura.id,
                )
                return (
                  <tr
                    key={cobro.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-1.5">
                      <Link
                        to={`/cxc/cobros/${cobro.id}`}
                        className="font-mono text-xs font-medium text-brand-700 hover:underline"
                      >
                        {cobro.numero}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">
                      {formatFecha(cobro.fecha)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <MoneyCell
                        valor={aplicacion?.importeAplicado ?? '0'}
                        moneda={factura.moneda}
                      />
                    </td>
                    <td className="px-4 py-1.5">
                      <EstadoBadge estado={cobro.estado} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

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

/** Celda de la cabecera del documento: rótulo, valor y por qué está ahí. */
function Dato({
  titulo,
  ayuda,
  children,
}: {
  titulo: string
  ayuda?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-slate-500">{titulo}</dt>
      <dd className="font-mono text-xs text-slate-800">{children}</dd>
      {ayuda && <p className="text-[11px] text-slate-400">{ayuda}</p>}
    </div>
  )
}
