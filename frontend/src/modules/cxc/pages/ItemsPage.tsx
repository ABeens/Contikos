import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Field'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { nombreTarifa } from '@/shared/fiscal/impuestos'
import { useCuentas, useTarifasImpuesto } from '@/shared/api/catalogos'
import type { ItemCatalogo } from '@/shared/api/contracts/cxc'
import { useItems } from '../api/queries'
import { DialogoItem } from '../components/DialogoItem'

/**
 * Catálogo de productos y servicios (docs/04 §1.1).
 *
 * Es el catálogo que precarga la factura: cada item trae ya decidida su cuenta
 * de ingreso y su tarifa de IVA, para que quien factura no tenga que
 * recordarlas. Lo que precarga es un punto de partida y la línea sigue siendo
 * editable.
 */
export function ItemsPage() {
  const { data: items = [], isLoading } = useItems()
  const { data: cuentas = [] } = useCuentas()
  // La tabla entera, sin fecha: el catálogo no es un documento y su tarifa se
  // nombra igual aunque la vigencia de esa fila ya esté cerrada.
  const { data: tarifas = [] } = useTarifasImpuesto()
  const [filtro, setFiltro] = useState('')
  const [editando, setEditando] = useState<ItemCatalogo | null>(null)
  const [creando, setCreando] = useState(false)

  const columnas = useMemo<ColumnDef<ItemCatalogo, unknown>[]>(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Código',
        meta: { ancho: '100px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-600">
            {row.original.codigo}
          </span>
        ),
      },
      {
        accessorKey: 'nombre',
        header: 'Producto o servicio',
        cell: ({ row }) => (
          <div>
            <p className="text-slate-800">{row.original.nombre}</p>
            {row.original.descripcion && (
              <p className="text-[11px] text-slate-500">
                {row.original.descripcion}
              </p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'tipo',
        header: 'Tipo',
        meta: { ancho: '100px' },
        cell: ({ row }) =>
          row.original.tipo === 'producto' ? 'Producto' : 'Servicio',
      },
      {
        id: 'precio',
        header: 'Precio de lista',
        meta: { numerico: true, ancho: '150px' },
        accessorFn: (i) => i.precioUnitario,
        cell: ({ row }) =>
          row.original.precioUnitario === '0' ||
          row.original.precioUnitario === '0.00' ? (
            <span className="text-xs text-slate-400">A convenir</span>
          ) : (
            <MoneyCell
              valor={row.original.precioUnitario}
              moneda={row.original.moneda}
              mostrarSimbolo
            />
          ),
      },
      {
        accessorKey: 'tarifa',
        header: 'IVA',
        meta: { ancho: '130px' },
        cell: ({ row }) => nombreTarifa(tarifas, row.original.tarifa),
      },
      {
        accessorKey: 'cuentaIngreso',
        header: 'Cuenta de ingreso',
        meta: { ancho: '230px' },
        cell: ({ row }) => (
          <div>
            <p className="text-slate-700">
              {cuentas.find((c) => c.codigo === row.original.cuentaIngreso)
                ?.nombre ?? ''}
            </p>
            <p className="font-mono text-[11px] text-slate-400">
              {row.original.cuentaIngreso}
            </p>
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
    // Depende del catálogo de cuentas y de la tabla de impuestos: mientras
    // cargan, las columnas enseñan solo el código y se rehacen cuando llegan.
    [cuentas, tarifas],
  )

  return (
    <div>
      <PageHeader
        titulo="Productos y servicios"
        descripcion="Lo que se vende, con su cuenta de ingreso y su tarifa de IVA ya decididas. La factura los precarga y quien factura los puede cambiar."
        acciones={
          <Button
            variante="primario"
            icono={<Plus className="size-4" />}
            onClick={() => setCreando(true)}
          >
            Nuevo item
          </Button>
        }
      />

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search className="size-4 text-slate-400" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por código, nombre o cuenta…"
            className="h-8 max-w-sm border-0 px-0 focus:ring-0"
          />
          <span className="ml-auto text-xs text-slate-500">
            {items.length} items
          </span>
        </div>

        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Cargando catálogo…
          </p>
        ) : (
          <DataTable
            columns={columnas}
            data={items}
            filtro={filtro}
            onRowClick={setEditando}
            vacio={{
              titulo: 'Sin productos ni servicios',
              descripcion:
                'Dé de alta el primero: la factura precargará su cuenta y su tarifa.',
            }}
          />
        )}
      </Card>

      {(creando || editando) && (
        <DialogoItem
          key={editando?.id ?? 'nuevo'}
          abierto
          item={editando ?? undefined}
          items={items}
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
