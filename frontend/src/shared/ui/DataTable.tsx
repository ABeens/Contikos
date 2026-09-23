import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Decimal from 'decimal.js'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from '@tanstack/react-table'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { cn } from './cn'
import { EstadoError, EstadoVacio } from './Layout'

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
  /** Mientras carga no se enseña el estado vacío: sería mentira. */
  cargando?: boolean
  /** Si la consulta falló, se enseña el error y no el estado vacío. */
  error?: unknown
  onReintentar?: () => void
  /**
   * `false` en tablas jerárquicas (catálogo, balanza): ordenar rompería la
   * sangría y la relación entre cuenta madre e hijas.
   */
  ordenable?: boolean
  /** Resalta la fila abierta en el detalle. */
  esSeleccionada?: (row: T) => boolean
  /** Filas visibles tras el filtro, para que un contador de fuera cuadre. */
  alFiltrar?: (visibles: number) => void
}

/**
 * Los importes llegan como texto (`"-1500.00"`). Ordenarlos como texto pone
 * los negativos y las cifras de distinta longitud en cualquier sitio.
 */
function ordenNumerico<T>(a: Row<T>, b: Row<T>, columna: string) {
  const va = a.getValue(columna)
  const vb = b.getValue(columna)
  const na = aDecimal(va)
  const nb = aDecimal(vb)
  if (na && nb) return na.comparedTo(nb)
  if (na) return 1
  if (nb) return -1
  return String(va ?? '').localeCompare(String(vb ?? ''))
}

function aDecimal(v: unknown): Decimal | null {
  if (v === null || v === undefined || v === '') return null
  try {
    return new Decimal(v as Decimal.Value)
  } catch {
    return null
  }
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
  cargando = false,
  error,
  onReintentar,
  ordenable = true,
  esSeleccionada,
  alFiltrar,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])

  const columnas = useMemo(
    () =>
      columns.map((c) =>
        c.meta?.numerico && !c.sortingFn
          ? ({ ...c, sortingFn: ordenNumerico } as ColumnDef<T, unknown>)
          : c,
      ),
    [columns],
  )

  const table = useReactTable({
    data,
    columns: columnas,
    enableSorting: ordenable,
    state: { sorting, globalFilter: filtro },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const filas = table.getRowModel().rows
  const visibles = filas.length

  useEffect(() => {
    alFiltrar?.(visibles)
  }, [alFiltrar, visibles])

  if (error && data.length === 0) {
    return <EstadoError error={error} onReintentar={onReintentar} />
  }

  if (cargando && data.length === 0) {
    return (
      <p className="px-6 py-14 text-center text-sm text-slate-400" aria-busy>
        Cargando…
      </p>
    )
  }

  if (filas.length === 0 && data.length > 0 && filtro.trim()) {
    return (
      <EstadoVacio
        titulo="Sin coincidencias"
        descripcion={`Nada coincide con «${filtro.trim()}».`}
      />
    )
  }

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
                const esOrdenable = header.column.getCanSort()
                const orden = header.column.getIsSorted()
                return (
                  <th
                    key={header.id}
                    aria-sort={
                      orden === 'asc'
                        ? 'ascending'
                        : orden === 'desc'
                          ? 'descending'
                          : undefined
                    }
                    className={cn(
                      'border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600',
                      alineadoDerecha ? 'text-right' : 'text-left',
                    )}
                    style={{ width: header.column.columnDef.meta?.ancho }}
                  >
                    <Encabezado
                      ordenable={esOrdenable}
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'inline-flex items-center gap-1',
                        alineadoDerecha && 'flex-row-reverse',
                      )}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {esOrdenable &&
                        (orden === 'asc' ? (
                          <ChevronUp className="size-3" />
                        ) : orden === 'desc' ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronsUpDown className="size-3 text-slate-300" />
                        ))}
                    </Encabezado>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {filas.map((row) => {
            const seleccionada = esSeleccionada?.(row.original) ?? false
            return (
              <tr
                key={row.id}
                onClick={
                  onRowClick ? () => onRowClick(row.original) : undefined
                }
                // Filas clicables también con teclado: Tab llega a ellas y
                // Enter o Espacio las abren, como un botón.
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onRowClick(row.original)
                        }
                      }
                    : undefined
                }
                aria-selected={onRowClick ? seleccionada : undefined}
                className={cn(
                  'border-b border-slate-100 last:border-0',
                  onRowClick &&
                    'cursor-pointer hover:bg-brand-50 focus-visible:bg-brand-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500',
                  seleccionada && 'bg-brand-50',
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
            )
          })}
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

/** El encabezado ordenable es un botón: se alcanza con Tab y se activa con Enter. */
function Encabezado({
  ordenable,
  onClick,
  className,
  children,
}: {
  ordenable: boolean
  onClick?: (e: unknown) => void
  className?: string
  children: ReactNode
}) {
  if (!ordenable) return <span className={className}>{children}</span>
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(className, 'cursor-pointer rounded select-none hover:text-slate-900')}
    >
      {children}
    </button>
  )
}
