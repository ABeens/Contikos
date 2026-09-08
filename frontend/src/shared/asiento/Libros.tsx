import type { Libro } from '@/shared/api/contracts/comunes'
import { cn } from '@/shared/ui/cn'
import { LIBROS, definicionLibro, etiquetaLibro } from './libro'

/**
 * Piezas de UI de los dos libros (docs/02 §3.1).
 *
 * El color es el mismo en toda la aplicación: azul el fiscal, violeta el
 * corporativo. Quien captura ocho horas al día reconoce el libro por el color
 * antes de leer la etiqueta, y por eso no se elige tono pantalla por pantalla.
 */

const TONO: Record<Libro, string> = {
  fiscal: 'bg-sky-50 text-sky-700 ring-sky-200',
  corporativo: 'bg-violet-50 text-violet-700 ring-violet-200',
}

const TONO_ACTIVO: Record<Libro, string> = {
  fiscal: 'bg-sky-600 text-white',
  corporativo: 'bg-violet-600 text-white',
}

/**
 * Qué libros mueve un asiento, en una sola marca.
 *
 * Cuando afecta a los dos, que es el caso normal, no se pinta de color: lo
 * que hay que detectar de un vistazo en una lista es la excepción.
 */
export function EtiquetaLibros({
  libros,
  className,
}: {
  libros: readonly Libro[]
  className?: string
}) {
  const ambos = libros.length >= LIBROS.length
  const unico = libros[0]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap',
        ambos || !unico
          ? 'bg-slate-100 text-slate-600 ring-slate-200'
          : TONO[unico],
        className,
      )}
    >
      {ambos || !unico ? 'Ambas' : `Solo ${etiquetaLibro(unico).toLowerCase()}`}
    </span>
  )
}

/** Marca compacta por línea: F y C, apagada la que no se mueve. */
export function MarcaLibros({ libros }: { libros: readonly Libro[] }) {
  return (
    <span className="inline-flex gap-0.5">
      {LIBROS.map((definicion) => {
        const activo = libros.includes(definicion.codigo)
        return (
          <span
            key={definicion.codigo}
            title={`${definicion.etiqueta}${activo ? '' : ': no la mueve'}`}
            className={cn(
              'inline-flex size-4 items-center justify-center rounded text-[10px] font-semibold',
              activo
                ? TONO_ACTIVO[definicion.codigo]
                : 'bg-slate-100 text-slate-300',
            )}
          >
            {definicion.abreviatura}
          </span>
        )
      })}
    </span>
  )
}

/** Casilla de un libro para la captura. */
export function CasillaLibro({
  libro,
  marcado,
  onChange,
  etiqueta,
  disabled,
}: {
  libro: Libro
  marcado: boolean
  onChange: (marcado: boolean) => void
  /** Texto accesible. Sin él, la tabla sería una rejilla de casillas sin nombre. */
  etiqueta: string
  disabled?: boolean
}) {
  const definicion = definicionLibro(libro)
  return (
    <input
      type="checkbox"
      role="checkbox"
      checked={marcado}
      disabled={disabled}
      aria-label={etiqueta}
      title={definicion.descripcion}
      onChange={(e) => onChange(e.target.checked)}
      className={cn(
        'size-3.5 rounded border-slate-300',
        libro === 'fiscal' ? 'accent-sky-600' : 'accent-violet-600',
      )}
    />
  )
}

/**
 * Selector de un libro para los reportes.
 *
 * Es de selección única a propósito: una balanza de los dos libros a la vez
 * sumaría dos contabilidades distintas y daría un estado que no existe.
 */
export function SelectorLibro({
  valor,
  onChange,
}: {
  valor: Libro
  onChange: (libro: Libro) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Libro"
      className="inline-flex rounded-md bg-slate-100 p-0.5"
    >
      {LIBROS.map((definicion) => {
        const activo = definicion.codigo === valor
        return (
          <button
            key={definicion.codigo}
            type="button"
            role="radio"
            aria-checked={activo}
            title={definicion.descripcion}
            onClick={() => onChange(definicion.codigo)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              activo
                ? TONO_ACTIVO[definicion.codigo]
                : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {definicion.etiqueta}
          </button>
        )
      })}
    </div>
  )
}
