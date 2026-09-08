import { useState, type ReactNode } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { cn } from './cn'
import { EstadoVacio } from './Layout'

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  /** Texto del filtro global. Se controla desde fuera para poder ir en la URL. */
  filtro?: string
  onRowClick?: (row: T) => void
  /** Fila de totales al pie. En un ERP casi siempre hace falta. */
  pie?: ReactNode
  vacio?: { titulo: string; descripcion?: string; accion?: ReactNode }
  className?: string
  /** Altura máxima con encabezado fijo. */
  maxAltura?: string
}

export function DataTable<T>({
  columns,
  data,
  filtro = '',
  onRowClick,
  pie,
  vacio,
  className,
  maxAltura,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: filtro },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const filas = table.getRowModel().rows

  if (filas.length === 0 && vacio) {
    return <EstadoVacio {...vacio} />
  }

  return (
    <div
      className={cn('overflow-auto', className)}
      style={maxAltura ? { maxHeight: maxAltura } : undefined}
    >
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50">
          {table.getHeaderGroups().map((grupo) => (
            <tr key={grupo.id}>
              {grupo.headers.map((header) => {
                const alineadoDerecha = header.column.columnDef.meta?.numerico
                const ordenable = header.column.getCanSort()
                const orden = header.column.getIsSorted()
                return (
                  <th
                    key={header.id}
                    className={cn(
                      'border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600',
                      alineadoDerecha ? 'text-right' : 'text-left',
                      ordenable && 'cursor-pointer select-none hover:bg-slate-100',
                    )}
                    style={{ width: header.column.columnDef.meta?.ancho }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        alineadoDerecha && 'flex-row-reverse',
                      )}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {ordenable &&
                        (orden === 'asc' ? (
                          <ChevronUp className="size-3" />
                        ) : orden === 'desc' ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronsUpDown className="size-3 text-slate-300" />
                        ))}
                    </span>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {filas.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={cn(
                'border-b border-slate-100 last:border-0',
                onRowClick && 'cursor-pointer hover:bg-brand-50',
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cn(
                    'px-3 py-1.5 text-slate-700',
                    cell.column.columnDef.meta?.numerico &&
                      'tabular text-right',
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {pie && (
          <tfoot className="sticky bottom-0 bg-slate-50 font-medium">
            {pie}
          </tfoot>
        )}
      </table>
    </div>
  )
}
