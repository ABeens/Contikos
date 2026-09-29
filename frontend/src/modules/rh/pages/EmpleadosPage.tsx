import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha } from '@/shared/format/fecha'
import { formatIdentificacion } from '@/shared/fiscal/identificacion'
import type { Empleado } from '@/shared/api/contracts/rh'
import { useAcceso } from '@/app/acceso'
import { DialogoEmpleado } from '../components/DialogoEmpleado'
import { useEmpleados } from '../api/queries'

/**
 * Empleados (docs/08 §2).
 *
 * El salario que se ve aquí es el ordinario del contrato. Lo que se paga cada
 * mes sale de la planilla, con las incidencias del mes.
 */
export function EmpleadosPage() {
  const consulta = useEmpleados()
  const { puede } = useAcceso()
  const [editando, setEditando] = useState<Empleado | null>(null)
  const [creando, setCreando] = useState(false)
  const operar = puede('planilla.operar')

  const columnas = useMemo<ColumnDef<Empleado, unknown>[]>(
    () => [
      { accessorKey: 'codigo', header: 'Código', meta: { ancho: '90px' } },
      {
        accessorKey: 'nombre',
        header: 'Nombre',
        cell: ({ row }) => (
          <span>
            <span className="text-slate-900">{row.original.nombre}</span>
            <span className="block text-xs text-slate-500">{row.original.puesto}</span>
          </span>
        ),
      },
      {
        accessorKey: 'identificacion',
        header: 'Cédula',
        cell: ({ row }) =>
          formatIdentificacion(row.original.identificacion, row.original.tipoIdentificacion),
      },
      {
        accessorKey: 'fechaIngreso',
        header: 'Ingreso',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fechaIngreso),
      },
      {
        accessorKey: 'salarioBase',
        header: 'Salario base',
        meta: { numerico: true, ancho: '150px' },
        cell: ({ row }) => <MoneyCell valor={row.original.salarioBase} />,
      },
      {
        accessorKey: 'activo',
        header: 'Estado',
        meta: { ancho: '100px' },
        cell: ({ row }) => <EstadoBadge estado={row.original.activo ? 'activo' : 'inactivo'} />,
      },
    ],
    [],
  )

  return (
    <div>
      <PageHeader
        titulo="Empleados"
        descripcion="Contratos vigentes y su salario ordinario. Los datos salariales solo los ve quien lleva la planilla."
        acciones={
          operar && (
            <Button variante="primario" icono={<Plus className="size-4" />} onClick={() => setCreando(true)}>
              Nuevo empleado
            </Button>
          )
        }
      />
      <Card>
        <DataTable
          columns={columnas}
          data={consulta.data ?? []}
          cargando={consulta.isLoading}
          error={consulta.error}
          onReintentar={() => void consulta.refetch()}
          onRowClick={operar ? setEditando : undefined}
          vacio={{
            titulo: 'Todavía no hay empleados',
            descripcion: 'Dé de alta a quienes van en la planilla.',
          }}
        />
      </Card>
      {creando && <DialogoEmpleado abierto onCerrar={() => setCreando(false)} />}
      {editando && (
        <DialogoEmpleado
          key={editando.id}
          abierto
          empleado={editando}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  )
}
