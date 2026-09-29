import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Card, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha } from '@/shared/format/fecha'
import { formatConsecutivo } from '@/shared/fiscal/comprobante'
import type { MotivoNotaCredito, NotaCredito } from '@/shared/api/contracts/cxc'
import { useNotasCredito } from '../api/queries'

const MOTIVO: Record<MotivoNotaCredito, string> = {
  devolucion: 'Devolución',
  descuento: 'Descuento',
  correccion: 'Corrección',
}

/**
 * Notas de crédito emitidas (docs/04 §2.3).
 *
 * Solo lista: la nota se emite desde la factura que acredita, que es donde se
 * sabe qué queda por acreditar. Hacer clic en una lleva a esa factura.
 */
export function NotasCreditoPage() {
  const navegar = useNavigate()
  const consulta = useNotasCredito()

  const columnas = useMemo<ColumnDef<NotaCredito, unknown>[]>(
    () => [
      { accessorKey: 'numeroInterno', header: 'Número', meta: { ancho: '120px' } },
      {
        accessorKey: 'consecutivo',
        header: 'Comprobante',
        cell: ({ row }) => (
          <span className="font-mono text-xs">{formatConsecutivo(row.original.consecutivo)}</span>
        ),
      },
      {
        accessorKey: 'fecha',
        header: 'Fecha',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fecha),
      },
      { accessorKey: 'facturaNumero', header: 'Factura', meta: { ancho: '120px' } },
      { accessorKey: 'clienteNombre', header: 'Cliente' },
      {
        accessorKey: 'motivo',
        header: 'Motivo',
        cell: ({ row }) => MOTIVO[row.original.motivo],
      },
      {
        accessorKey: 'total',
        header: 'Total',
        meta: { numerico: true, ancho: '140px' },
        cell: ({ row }) => <MoneyCell valor={row.original.total} moneda={row.original.moneda} />,
      },
    ],
    [],
  )

  return (
    <div>
      <PageHeader
        titulo="Notas de crédito"
        descripcion="Devoluciones, descuentos y correcciones sobre facturas ya emitidas. Se emiten desde el detalle de la factura."
      />
      <Card>
        <DataTable
          columns={columnas}
          data={consulta.data ?? []}
          cargando={consulta.isLoading}
          error={consulta.error}
          onReintentar={() => void consulta.refetch()}
          onRowClick={(n) => navegar(`/cxc/facturas/${encodeURIComponent(n.facturaId)}`)}
          vacio={{
            titulo: 'Todavía no hay notas de crédito',
            descripcion: 'Para emitir una, abra la factura y use «Nota de crédito».',
          }}
        />
      </Card>
    </div>
  )
}
