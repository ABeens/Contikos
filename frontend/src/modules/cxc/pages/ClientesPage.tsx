import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { CircleCheck, CircleDashed, Plus, Search } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Field'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatIdentificacion } from '@/shared/fiscal/identificacion'
import { useCuentas } from '@/shared/api/catalogos'
import type { Cliente } from '@/shared/api/contracts/cxc'
import { useClientes } from '../api/queries'
import { DialogoCliente } from '../components/DialogoCliente'

/** Catálogo de clientes (docs/04 §1). */
export function ClientesPage() {
  const { data: clientes = [], isLoading } = useClientes()
  const { data: cuentas = [] } = useCuentas()
  const [filtro, setFiltro] = useState('')
  const [editando, setEditando] = useState<Cliente | null>(null)
  const [creando, setCreando] = useState(false)

  const columnas = useMemo<ColumnDef<Cliente, unknown>[]>(
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
      {
        accessorKey: 'razonSocial',
        header: 'Razón social',
        cell: ({ row }) => (
          <div>
            <p className="text-slate-800">{row.original.razonSocial}</p>
            {row.original.nombreComercial && (
              <p className="text-[11px] text-slate-500">
                {row.original.nombreComercial}
              </p>
            )}
          </div>
        ),
      },
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
        id: 'limite',
        header: 'Límite',
        meta: { numerico: true, ancho: '130px' },
        accessorFn: (c) => c.limiteCredito,
        cell: ({ row }) =>
          row.original.limiteCredito === '0.00' ||
          row.original.limiteCredito === '0' ? (
            <span className="text-xs text-slate-400">Sin límite</span>
          ) : (
            <MoneyCell valor={row.original.limiteCredito} />
          ),
      },
      {
        id: 'saldo',
        header: 'Saldo',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (c) => c.saldo,
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
        // El derivado que calcula el servidor con la misma regla que aplicará
        // al emitir (docs/13 §4): marca a quién hay que completar ANTES de que
        // la emisión falle, no después.
        accessorKey: 'listoParaFe',
        header: 'Facturación electrónica',
        meta: { ancho: '190px' },
        cell: ({ row }) =>
          row.original.listoParaFe ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
              <CircleCheck className="size-3.5" />
              Listo
            </span>
          ) : (
            <span
              title="Falta correo, teléfono, ubicación o actividad económica"
              className="inline-flex items-center gap-1.5 text-xs text-amber-700"
            >
              <CircleDashed className="size-3.5" />
              Datos incompletos
            </span>
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
        titulo="Clientes"
        descripcion="Condiciones de pago, límite de crédito y cuenta de ingreso propia."
        acciones={
          <Button
            variante="primario"
            icono={<Plus className="size-4" />}
            onClick={() => setCreando(true)}
          >
            Nuevo cliente
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
            className="h-8 max-w-sm border-0 px-0 focus:ring-0"
          />
          <span className="ml-auto text-xs text-slate-500">
            {clientes.length} clientes
          </span>
        </div>

        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Cargando clientes…
          </p>
        ) : (
          <DataTable
            columns={columnas}
            data={clientes}
            filtro={filtro}
            onRowClick={setEditando}
            vacio={{
              titulo: 'Sin clientes',
              descripcion: 'Dé de alta el primero para poder facturar.',
            }}
          />
        )}
      </Card>

      {(creando || editando) && (
        <DialogoCliente
          key={editando?.id ?? 'nuevo'}
          abierto
          cliente={editando ?? undefined}
          clientes={clientes}
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
