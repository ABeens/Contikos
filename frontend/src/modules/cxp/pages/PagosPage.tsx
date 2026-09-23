import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Ban, Plus, Search } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { LinkBoton } from '@/shared/ui/LinkBoton'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Field'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { PanelAsiento } from '@/shared/asiento/PanelAsiento'
import { formatFecha } from '@/shared/format/fecha'
import { useCuentas } from '@/shared/api/catalogos'
import type { Pago } from '@/shared/api/contracts/cxp'
import { useAsientoDePago, usePagos } from '../api/queries'
import { DialogoAnularPago } from '../components/DialogoAnularPago'
import { DocumentoNoEncontrado, SeccionDetalle } from '@/shared/ui/Detalle'

/**
 * Pagos emitidos, su asiento y su anulación.
 *
 * Cuál está abierto vive en la ruta (`/cxp/pagos/:id`), igual que en las
 * facturas: el detalle de un egreso se envía por enlace y el botón de atrás
 * vuelve al listado.
 *
 * Un pago contabilizado no se edita ni se borra (docs/02 §7). Lo único que se
 * puede hacer con uno equivocado es anularlo, que reversa su asiento y devuelve
 * el saldo a las facturas que había abonado.
 */

const ETIQUETA_MEDIO: Record<Pago['medioPago'], string> = {
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
}

export function PagosPage() {
  const {
    data: pagos = [],
    isLoading,
    isSuccess,
    error,
    refetch,
  } = usePagos()
  const navegar = useNavigate()
  const { id } = useParams()
  const [filtro, setFiltro] = useState('')
  // Las filas que deja ver el filtro: el contador cuenta lo que se ve.
  const [visibles, setVisibles] = useState<number | null>(null)

  const seleccionado = pagos.find((p) => p.id === id) ?? null

  const columnas = useMemo<ColumnDef<Pago, unknown>[]>(
    () => [
      {
        accessorKey: 'folio',
        header: 'Folio',
        meta: { ancho: '130px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs font-medium text-slate-700">
            {row.original.folio}
          </span>
        ),
      },
      {
        accessorKey: 'fecha',
        header: 'Fecha',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fecha),
      },
      { accessorKey: 'proveedorNombre', header: 'Proveedor' },
      {
        id: 'medio',
        header: 'Medio',
        meta: { ancho: '150px' },
        accessorFn: (p) => `${ETIQUETA_MEDIO[p.medioPago]} ${p.referencia ?? ''}`,
        cell: ({ row }) => (
          <span className="text-xs text-slate-600">
            {ETIQUETA_MEDIO[row.original.medioPago]}
            {row.original.referencia && (
              <span className="ml-1 font-mono text-[11px] text-slate-400">
                {row.original.referencia}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'importe',
        header: 'Importe',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (p) => p.importe,
        cell: ({ row }) => (
          <MoneyCell valor={row.original.importe} moneda={row.original.moneda} />
        ),
      },
      {
        id: 'anticipo',
        header: 'Anticipo',
        meta: { numerico: true, ancho: '130px' },
        accessorFn: (p) => p.anticipo,
        cell: ({ row }) => (
          <MoneyCell
            valor={row.original.anticipo}
            moneda={row.original.moneda}
            ocultarCero
          />
        ),
      },
      {
        accessorKey: 'estado',
        header: 'Estado',
        meta: { ancho: '120px' },
        cell: ({ row }) => (
          <EstadoBadge
            estado={
              row.original.estado === 'anulado' ? 'cancelado' : 'contabilizado'
            }
          />
        ),
      },
    ],
    [],
  )

  return (
    <div>
      <PageHeader
        titulo="Pagos a proveedores"
        descripcion="Cada pago contabiliza su egreso y salda las facturas a las que se aplicó."
        acciones={
          <>
            <LinkBoton to="/cxp/propuesta">Propuesta de pago</LinkBoton>
            <LinkBoton
              to="/cxp/pagos/nuevo"
              variante="primario"
              icono={<Plus className="size-4" />}
            >
              Nuevo pago
            </LinkBoton>
          </>
        }
      />

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search className="size-4 text-slate-400" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por folio, proveedor o referencia…"
            aria-label="Buscar pagos"
            className="h-8 max-w-sm border-0 px-0 focus:ring-0"
          />
          <span className="ml-auto text-xs text-slate-500">
            {filtro.trim() && visibles !== null
              ? `${visibles} de ${pagos.length} pagos`
              : `${pagos.length} pagos`}
          </span>
        </div>

        <DataTable
          columns={columnas}
          data={pagos}
          filtro={filtro}
          cargando={isLoading}
          error={error}
          onReintentar={() => void refetch()}
          alFiltrar={setVisibles}
          esSeleccionada={(p) => p.id === id}
          onRowClick={(p) => navegar(`/cxp/pagos/${p.id}`)}
          vacio={{
            titulo: 'Sin pagos emitidos',
            descripcion:
              'Ningún proveedor ha recibido pago todavía. Emita el primero desde una factura pendiente.',
          }}
        />
      </Card>

      {/* `key`: cada pago abre su propio detalle. Sin ella, pasar de un pago a
          otro conservaría el diálogo y el motivo a medio escribir del anterior. */}
      {seleccionado ? (
        <DetallePago
          key={seleccionado.id}
          pago={seleccionado}
          onCerrar={() => navegar('/cxp/pagos')}
        />
      ) : id && isSuccess ? (
        <DocumentoNoEncontrado id={id} onCerrar={() => navegar('/cxp/pagos')} />
      ) : null}
    </div>
  )
}

function DetallePago({
  pago,
  onCerrar,
}: {
  pago: Pago
  onCerrar: () => void
}) {
  const { data: asiento, isLoading } = useAsientoDePago(pago.id)
  const { data: cuentas = [] } = useCuentas()
  const [abierto, setAbierto] = useState(false)

  const nombreCuenta =
    cuentas.find((c) => c.codigo === pago.cuentaSalida)?.nombre ??
    pago.cuentaSalida

  return (
    <SeccionDetalle etiqueta={`Detalle del pago ${pago.folio}`}>
      <Card className="mt-4">
        <CardHeader
          titulo={`Pago ${pago.folio}`}
          descripcion={`${pago.proveedorNombre} · ${formatFecha(pago.fecha)} · ${nombreCuenta}`}
          acciones={
            <>
              {pago.estado === 'emitido' && (
                <Button
                  variante="peligro"
                  tamano="sm"
                  icono={<Ban className="size-3.5" />}
                  onClick={() => setAbierto(true)}
                >
                  Anular
                </Button>
              )}
              <Button tamano="sm" onClick={onCerrar}>
                Cerrar
              </Button>
            </>
          }
        />

        {pago.estado === 'anulado' && (
          <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
            Pago anulado{pago.anuladoEn ? ` el ${formatFecha(pago.anuladoEn.slice(0, 10))}` : ''}
            : {pago.motivoAnulacion}. Su asiento quedó reversado y el saldo
            volvió a las facturas.
          </p>
        )}

        <table className="w-full text-sm" aria-label="Aplicaciones del pago">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Factura</th>
              <th className="w-28 px-3 py-2 text-left">Vence</th>
              <th className="w-36 px-3 py-2 text-right">Saldo antes</th>
              <th className="w-36 px-3 py-2 text-right">Aplicado</th>
              <th className="w-36 px-4 py-2 text-right">Saldo después</th>
            </tr>
          </thead>
          <tbody>
            {pago.aplicaciones.map((a) => (
              <tr
                key={a.facturaId}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="px-4 py-1.5">
                  <Link
                    to={`/cxp/facturas/${a.facturaId}`}
                    className="font-mono text-xs font-medium text-brand-700 hover:underline"
                  >
                    {a.folioProveedor}
                  </Link>
                  <span className="ml-2 font-mono text-[11px] text-slate-400">
                    {a.folioInterno}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-600">
                  {formatFecha(a.fechaVencimiento)}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <MoneyCell valor={a.saldoAnterior} moneda={pago.moneda} />
                </td>
                <td className="px-3 py-1.5 text-right font-medium">
                  <MoneyCell valor={a.importe} moneda={pago.moneda} />
                </td>
                <td className="px-4 py-1.5 text-right">
                  <MoneyCell valor={a.saldoResultante} moneda={pago.moneda} />
                </td>
              </tr>
            ))}
            {pago.aplicaciones.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  El pago no se aplicó a ninguna factura: quedó entero como
                  anticipo al proveedor.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-slate-50 text-slate-800">
            <tr>
              <td colSpan={4} className="px-4 py-1.5 text-right text-xs">
                Aplicado a facturas
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell valor={pago.aplicado} moneda={pago.moneda} />
              </td>
            </tr>
            <tr>
              <td colSpan={4} className="px-4 py-1.5 text-right text-xs">
                Anticipo al proveedor
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell valor={pago.anticipo} moneda={pago.moneda} />
              </td>
            </tr>
            {pago.diferenciaCambiaria !== '0.00' && (
              <tr>
                <td colSpan={4} className="px-4 py-1.5 text-right text-xs">
                  Diferencia cambiaria
                </td>
                <td className="px-4 py-1.5 text-right">
                  <MoneyCell valor={pago.diferenciaCambiaria} />
                </td>
              </tr>
            )}
            <tr className="font-semibold">
              <td colSpan={4} className="px-4 py-1.5 text-right text-xs">
                Importe del pago
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell valor={pago.importe} moneda={pago.moneda} />
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
            El pago no tiene asiento asociado.
          </p>
        )}
      </Card>

      {abierto && (
        <DialogoAnularPago pago={pago} onCerrar={() => setAbierto(false)} />
      )}
    </SeccionDetalle>
  )
}
