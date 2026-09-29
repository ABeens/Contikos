import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import type { VerificacionCierre } from '@/shared/api/contracts/conta'
import { cn } from '@/shared/ui/cn'

const TONO: Record<
  VerificacionCierre['severidad'],
  { icono: typeof CircleAlert; clase: string }
> = {
  error: { icono: CircleAlert, clase: 'text-red-700' },
  aviso: { icono: TriangleAlert, clase: 'text-amber-700' },
  ok: { icono: CircleCheck, clase: 'text-emerald-700' },
}

/**
 * El checklist entero, punto por punto. Lo usan el cierre mensual y el anual.
 *
 * También los que están bien: el semáforo verde es la mitad de la información
 * que pide docs/03 §5. Una lista que solo enseña los problemas deja al que
 * cierra sin saber si la depreciación se comprobó o si nadie la miró.
 */
export function Verificaciones({
  verificaciones,
  etiqueta = 'Checklist de cierre',
}: {
  etiqueta?: string
  verificaciones: readonly VerificacionCierre[]
}) {
  if (verificaciones.length === 0) return null

  return (
    <ul
      aria-label={etiqueta}
      className="divide-y divide-slate-100 text-sm"
    >
      {verificaciones.map((v, i) => {
        const tono = TONO[v.severidad]
        const Icono = tono.icono
        return (
          <li
            key={`${v.codigo}-${i}`}
            className="flex items-start gap-2 px-4 py-2"
          >
            <Icono className={cn('mt-0.5 size-4 shrink-0', tono.clase)} />
            <span>
              <span
                className={cn(
                  'mr-1 text-[10px] font-semibold tracking-wider uppercase',
                  tono.clase,
                )}
              >
                {v.severidad}
              </span>
              <span className="text-slate-700">{v.mensaje}</span>
              {v.detalle && (
                <span className="block text-xs text-slate-500">{v.detalle}</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
