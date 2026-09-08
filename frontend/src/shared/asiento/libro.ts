import { LIBROS_TODOS, type Libro } from '@/shared/api/contracts/comunes'

/**
 * Los dos libros de la empresa (docs/02 §3.1, D-11 en docs/12).
 *
 * Fiscal y corporativo comparten catálogo de cuentas, periodos, consecutivo y
 * pantalla de captura. Lo único que los separa es qué líneas de asiento llegan
 * a cada mayor.
 *
 * La regla de la que cuelga todo lo demás: **por omisión, un movimiento afecta
 * a los dos.** Marcar un solo libro es la excepción y debe costar un clic
 * explícito, porque es lo que separa las dos contabilidades.
 */

export interface DefinicionLibro {
  readonly codigo: Libro
  readonly etiqueta: string
  /** Para las columnas estrechas de la captura. */
  readonly abreviatura: string
  readonly descripcion: string
}

export const LIBROS: readonly DefinicionLibro[] = [
  {
    codigo: 'fiscal',
    etiqueta: 'Fiscal',
    abreviatura: 'F',
    descripcion: 'Lo que se declara ante Hacienda. Reglas tributarias.',
  },
  {
    codigo: 'corporativo',
    etiqueta: 'Corporativa',
    abreviatura: 'C',
    descripcion: 'Lo que mide el negocio. NIIF para PYMES.',
  },
]

const POR_CODIGO = new Map(LIBROS.map((l) => [l.codigo, l]))

export function definicionLibro(libro: Libro): DefinicionLibro {
  return POR_CODIGO.get(libro) ?? LIBROS[0]
}

export function etiquetaLibro(libro: Libro): string {
  return definicionLibro(libro).etiqueta
}

export function esLibro(valor: string | null | undefined): valor is Libro {
  return valor === 'fiscal' || valor === 'corporativo'
}

/** Ordena una selección de libros en el orden canónico fiscal → corporativo. */
export function ordenarLibros(libros: readonly Libro[]): Libro[] {
  return LIBROS_TODOS.filter((l) => libros.includes(l))
}

/**
 * Libros que afecta una línea.
 *
 * `undefined` significa ambos; el array vacío significa ninguno y es un error
 * de captura, no un valor por omisión. La diferencia importa: si se colapsaran
 * los dos casos, desmarcar los dos libros contabilizaría en ambos: justo lo
 * contrario de lo que el usuario pidió.
 */
export function librosDe(linea: {
  libros?: readonly Libro[] | null
}): readonly Libro[] {
  return linea.libros === undefined || linea.libros === null
    ? LIBROS_TODOS
    : ordenarLibros(linea.libros)
}

export function lineaAfecta(
  linea: { libros?: readonly Libro[] | null },
  libro: Libro,
): boolean {
  return librosDe(linea).includes(libro)
}

/** Unión de los libros que mueven las líneas, en orden canónico. */
export function librosAfectados(
  lineas: readonly { libros?: readonly Libro[] | null }[],
): Libro[] {
  const union = LIBROS_TODOS.filter((libro) =>
    lineas.some((linea) => lineaAfecta(linea, libro)),
  )
  // Un asiento sin ninguna línea válida todavía se está capturando; se asume el
  // caso normal para que la UI no parpadee entre estados imposibles.
  return union.length > 0 ? union : [...LIBROS_TODOS]
}

/** true si todas las líneas afectan exactamente a los mismos libros. */
export function tratamientoUniforme(
  lineas: readonly { libros?: readonly Libro[] | null }[],
): boolean {
  if (lineas.length === 0) return true
  const primera = librosDe(lineas[0]).join()
  return lineas.every((l) => librosDe(l).join() === primera)
}
