import { useSearchParams } from 'react-router'
import type { Libro } from '@/shared/api/contracts/comunes'
import type { Periodo } from '@/shared/api/contracts/conta'
import { esLibro } from '@/shared/asiento/libro'
import { useEmpresa } from '@/app/empresa'
import { usePeriodoEnUrl } from '@/shared/hooks/usePeriodoEnUrl'

/** Qué intervalo mide un estado de flujo: el mes o lo que va del ejercicio. */
export type Alcance = 'mes' | 'ejercicio'

export interface FiltrosReporte {
  periodo: Periodo | undefined
  periodos: Periodo[]
  libro: Libro
  setLibro: (libro: Libro) => void
  alcance: Alcance
  setAlcance: (alcance: Alcance) => void
  /** Periodo con el que se compara, o undefined si no se compara. */
  comparado: Periodo | undefined
  setComparado: (id: string | null) => void
}

/**
 * Los filtros de un reporte, todos en la URL.
 *
 * Un reporte que se envía por enlace tiene que abrir exactamente lo que veía
 * quien lo envió: el mes, el libro, el alcance y contra qué se compara
 * (docs/14 §6). Ninguno de los cuatro puede quedar implícito en el estado de
 * una pantalla.
 *
 * El libro se exige siempre, y sin él se abre el fiscal: es el que se declara,
 * y equivocarse de libro en un estado financiero es caro (docs/09 §3).
 */
export function useFiltrosReporte(): FiltrosReporte {
  const periodo = usePeriodoEnUrl()
  const { periodos } = useEmpresa()
  const [parametros, setParametros] = useSearchParams()

  const escribir = (clave: string, valor: string | null) =>
    setParametros(
      (previos) => {
        const nuevos = new URLSearchParams(previos)
        if (valor === null) nuevos.delete(clave)
        else nuevos.set(clave, valor)
        return nuevos
      },
      { replace: true },
    )

  const parametroLibro = parametros.get('libro')
  const libro: Libro = esLibro(parametroLibro) ? parametroLibro : 'fiscal'

  const alcance: Alcance =
    parametros.get('alcance') === 'mes' ? 'mes' : 'ejercicio'

  // Compararse consigo mismo no es un reporte: todas las variaciones darían
  // cero. Un enlace así se trata como si no pidiera comparar.
  const parametroComparar = parametros.get('comparar')
  const comparado =
    parametroComparar && parametroComparar !== periodo?.id
      ? periodos.find((p) => p.id === parametroComparar)
      : undefined

  return {
    periodo,
    periodos,
    libro,
    setLibro: (nuevo) => escribir('libro', nuevo),
    alcance,
    setAlcance: (nuevo) => escribir('alcance', nuevo),
    comparado,
    setComparado: (id) => escribir('comparar', id),
  }
}
