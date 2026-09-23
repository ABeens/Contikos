import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Field'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatIdentificacion } from '@/shared/fiscal/identificacion'
import { useCuentas } from '@/shared/api/catalogos'
import type { Proveedor } from '@/shared/api/contracts/cxp'
import { useProveedores } from '../api/queries'
import { DialogoProveedor } from '../components/DialogoProveedor'

/** Catálogo de proveedores (docs/05 §1). */
export function ProveedoresPage() {
  const {
    data: proveedores = [],
    isLoading,
    error,
    refetch,
  } = useProveedores()
  const { data: cuentas = [] } = useCuentas()
  const [filtro, setFiltro] = useState('')
  // Las filas que deja ver el filtro: el contador cuenta lo que se ve.
  const [visibles, setVisibles] = useState<number | null>(null)
  const [editando, setEditando] = useState<Proveedor | null>(null)
  const [creando, setCreando] = useState(false)

  const columnas = useMemo<ColumnDef<Proveedor, unknown>[]>(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Código',
        meta: { ancho: '90px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-600">
            {row.original.codigo}
          </span>
        ),
      },
      { accessorKey: 'razonSocial', header: 'Razón social' },
      {
        accessorKey: 'identificacion',
        header: 'Identificación',
        meta: { ancho: '150px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-600">
            {formatIdentificacion(
              row.original.identificacion,
              row.original.tipoIdentificacion,
            )}
          </span>
        ),
      },
      {
        accessorKey: 'diasCredito',
        header: 'Crédito',
        meta: { ancho: '90px' },
        cell: ({ row }) =>
          row.original.diasCredito === 0
            ? 'Contado'
            : `${row.original.diasCredito} días`,
      },
      {
        id: 'retencion',
        header: 'Retención',
        meta: { numerico: true, ancho: '100px' },
        accessorFn: (p) => p.retencionRenta,
        cell: ({ row }) =>
          Number(row.original.retencionRenta) > 0 ? (
            <span className="tabular">{row.original.retencionRenta}%</span>
          ) : (
            <span className="text-xs text-slate-400">No aplica</span>
          ),
      },
      {
        id: 'saldo',
        header: 'Saldo',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (p) => p.saldo,
        cell: ({ row }) => (
          <div className="flex flex-col items-end">
            <MoneyCell valor={row.original.saldo} />
            {row.original.facturasPendientes > 0 && (
              <span className="text-[11px] text-slate-400">
                {row.original.facturasPendientes} factura
                {row.original.facturasPendientes === 1 ? '' : 's'}
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'activo',
        header: 'Estado',
        meta: { ancho: '90px' },
        cell: ({ row }) => (
          <EstadoBadge estado={row.original.activo ? 'activo' : 'inactivo'} />
        ),
      },
    ],
    [],
  )

  return (
    <div>
      <PageHeader
        titulo="Proveedores"
        descripcion="Condiciones de pago, cuenta de gasto habitual y retenciones aplicables."
        acciones={
          <Button
            variante="primario"
            icono={<Plus className="size-4" />}
            onClick={() => setCreando(true)}
          >
            Nuevo proveedor
          </Button>
        }
      />

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search className="size-4 text-slate-400" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por nombre, código o identificación…"
            aria-label="Buscar proveedores"
            className="h-8 max-w-sm border-0 px-0 focus:ring-0"
          />
          <span className="ml-auto text-xs text-slate-500">
            {filtro.trim() && visibles !== null
              ? `${visibles} de ${proveedores.length} proveedores`
              : `${proveedores.length} proveedores`}
          </span>
        </div>

        <DataTable
          columns={columnas}
          data={proveedores}
          filtro={filtro}
          cargando={isLoading}
          error={error}
          onReintentar={() => void refetch()}
          alFiltrar={setVisibles}
          onRowClick={setEditando}
          vacio={{
            titulo: 'Sin proveedores',
            descripcion: 'Dé de alta el primero para registrar facturas de gasto.',
          }}
        />
      </Card>

      {(creando || editando) && (
        <DialogoProveedor
          key={editando?.id ?? 'nuevo'}
          abierto
          proveedor={editando ?? undefined}
          proveedores={proveedores}
          cuentas={cuentas}
          onCerrar={() => {
            setCreando(false)
            setEditando(null)
          }}
        />
      )}
    </div>
  )
}
