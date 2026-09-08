import { PageHeader, Card } from '@/shared/ui/Layout'

export interface ModuloPendienteProps {
  titulo: string
  fase: string
  descripcion: string
  alcance: string[]
  /** Lo que este módulo envía al hub contable, según docs/02. */
  asientos: string[]
}

/**
 * Marcador para los módulos aún no construidos.
 *
 * No es un "próximamente": deja a la vista el alcance acordado y los asientos
 * que el módulo generará, para que la navegación completa del sistema sea
 * revisable desde el primer día.
 */
export function ModuloPendientePage({
  titulo,
  fase,
  descripcion,
  alcance,
  asientos,
}: ModuloPendienteProps) {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader titulo={titulo} descripcion={descripcion} />

      <div className="mb-4 inline-flex items-center gap-2 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
        Pendiente · {fase}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Alcance</h3>
          <ul className="space-y-1.5 text-sm text-slate-600">
            {alcance.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-slate-300" />
                {item}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">
            Asientos que genera
          </h3>
          <ul className="space-y-1.5 text-sm text-slate-600">
            {asientos.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand-400" />
                {item}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
