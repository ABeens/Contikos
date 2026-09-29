import { Link, useSearchParams } from 'react-router'
import {
  ArrowLeftRight,
  BookOpenText,
  ChartColumn,
  Landmark,
  Library,
  Scale,
  Waves,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, PageHeader } from '@/shared/ui/Layout'

interface EntradaReporte {
  ruta: string
  titulo: string
  descripcion: string
  icono: LucideIcon
}

/**
 * Los reportes, agrupados como se piden: los estados financieros que se
 * entregan, y los libros con los que se revisan.
 */
const ESTADOS: readonly EntradaReporte[] = [
  {
    ruta: '/reportes/situacion',
    titulo: 'Estado de Situación Financiera',
    descripcion: 'Activo, pasivo y patrimonio al cierre del mes, con sus notas.',
    icono: Scale,
  },
  {
    ruta: '/reportes/resultados',
    titulo: 'Estado de Resultados',
    descripcion: 'Del mes o acumulado del ejercicio, hasta la utilidad neta.',
    icono: ChartColumn,
  },
  {
    ruta: '/reportes/flujos',
    titulo: 'Estado de Flujos de Efectivo',
    descripcion: 'Método indirecto, verificado contra los saldos de caja y bancos.',
    icono: Waves,
  },
  {
    ruta: '/reportes/patrimonio',
    titulo: 'Estado de Cambios en el Patrimonio',
    descripcion: 'Qué movió el patrimonio en el ejercicio, columna por renglón.',
    icono: Landmark,
  },
]

const LIBROS: readonly EntradaReporte[] = [
  {
    ruta: '/reportes/diario',
    titulo: 'Libro diario',
    descripcion: 'Los asientos del mes en orden cronológico.',
    icono: BookOpenText,
  },
  {
    ruta: '/reportes/mayor',
    titulo: 'Libro mayor y auxiliares',
    descripcion: 'Movimientos por cuenta con saldo corrido, hasta el asiento.',
    icono: Library,
  },
  {
    ruta: '/reportes/fiscal-corporativo',
    titulo: 'Comparativo fiscal contra corporativo',
    descripcion: 'Las dos contabilidades lado a lado y sus diferencias.',
    icono: ArrowLeftRight,
  },
]

/**
 * Portada del módulo.
 *
 * Reportes solo lee (docs/09): ninguna de estas pantallas puede escribir en el
 * mayor, y todas toman el periodo de la cabecera.
 */
export function ReportesPage() {
  // Se conserva el periodo y el libro al entrar a un reporte desde aquí.
  const [parametros] = useSearchParams()
  const sufijo = parametros.toString() ? `?${parametros.toString()}` : ''

  const bloque = (titulo: string, entradas: readonly EntradaReporte[]) => (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {titulo}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {entradas.map((e) => (
          <Link key={e.ruta} to={`${e.ruta}${sufijo}`} className="group">
            <Card className="flex h-full items-start gap-3 px-4 py-3.5 transition-colors group-hover:border-brand-300">
              <e.icono className="mt-0.5 size-5 shrink-0 text-brand-600" />
              <div>
                <p className="text-sm font-medium text-slate-900">{e.titulo}</p>
                <p className="mt-0.5 text-xs text-slate-500">{e.descripcion}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  )

  return (
    <div>
      <PageHeader
        titulo="Reportes"
        descripcion="Estados financieros bajo NIIF para PYMES y libros contables. Todos son de un libro, fiscal o corporativo, y ninguno escribe en el mayor."
      />
      {bloque('Estados financieros', ESTADOS)}
      {bloque('Libros y análisis', LIBROS)}
    </div>
  )
}
