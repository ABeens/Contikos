import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { useCuentas } from '@/shared/api/catalogos'
import type { CategoriaActivo } from '@/shared/api/contracts/activos'
import { useCategorias } from '../api/queries'
import { DialogoCategoria } from '../components/DialogoCategoria'

/**
 * Categorías de activo (docs/07 §1 y §6).
 *
 * El mapeo contable se resuelve por categoría y nunca por activo individual: es
 * lo que evita que dos equipos iguales terminen en cuentas distintas.
 */
export function CategoriasPage() {
  const { data: categorias = [], isLoading } = useCategorias()
  const { data: cuentas = [] } = useCuentas()
  const [editando, setEditando] = useState<CategoriaActivo | null>(null)
  const [creando, setCreando] = useState(false)

  const columnas = useMemo<ColumnDef<CategoriaActivo, unknown>[]>(
    () => [
      { accessorKey: 'nombre', header: 'Categoría' },
      {
        accessorKey: 'vidaUtilMeses',
        header: 'Vida útil',
        meta: { ancho: '120px' },
        cell: ({ row }) => `${row.original.vidaUtilMeses} meses`,
      },
      {
        accessorKey: 'metodo',
        header: 'Método',
        meta: { ancho: '160px' },
        cell: ({ row }) =>
          row.original.metodo === 'linea_recta'
            ? 'Línea recta'
            : 'Saldos decrecientes',
      },
      {
        id: 'residual',
        header: 'Residual',
        meta: { numerico: true, ancho: '100px' },
        accessorFn: (c) => c.porcentajeResidual,
        cell: ({ row }) => `${row.original.porcentajeResidual}%`,
      },
      {
        id: 'tasaFiscal',
        header: 'Tasa fiscal',
        meta: { numerico: true, ancho: '110px' },
        accessorFn: (c) => c.tasaFiscalAnual ?? '',
        cell: ({ row }) =>
          row.original.tasaFiscalAnual ? (
            <span className="tabular">{row.original.tasaFiscalAnual}% anual</span>
          ) : (
            <span className="text-xs text-slate-400">Igual a la contable</span>
          ),
      },
      {
        id: 'cuentas',
        header: 'Cuentas',
        cell: ({ row }) => (
          <div className="font-mono text-[11px] text-slate-500">
            <p>Activo {row.original.cuentaActivo}</p>
            <p>Depreciación {row.original.cuentaDepreciacionAcumulada}</p>
            <p>Gasto {row.original.cuentaGastoDepreciacion}</p>
          </div>
        ),
      },
      {
        accessorKey: 'activos',
        header: 'Activos',
        meta: { numerico: true, ancho: '90px' },
      },
      {
        accessorKey: 'activa',
        header: 'Estado',
        meta: { ancho: '90px' },
        cell: ({ row }) => (
          <EstadoBadge estado={row.original.activa ? 'activo' : 'inactivo'} />
        ),
      },
    ],
    [],
  )

  return (
    <div>
      <PageHeader
        titulo="Categorías de activo"
        descripcion="Vida útil, método de depreciación y las tres cuentas que mueve el ciclo de vida del activo."
        acciones={
          <Button
            variante="primario"
            icono={<Plus className="size-4" />}
            onClick={() => setCreando(true)}
          >
            Nueva categoría
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Cargando categorías…
          </p>
        ) : (
          <DataTable
            columns={columnas}
            data={categorias}
            onRowClick={setEditando}
            vacio={{
              titulo: 'Sin categorías configuradas',
              descripcion:
                'Dé de alta la primera: sin categoría no se puede registrar un activo.',
            }}
          />
        )}
      </Card>

      {(creando || editando) && (
        <DialogoCategoria
          key={editando?.id ?? 'nueva'}
          abierto
          categoria={editando ?? undefined}
          categorias={categorias}
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
