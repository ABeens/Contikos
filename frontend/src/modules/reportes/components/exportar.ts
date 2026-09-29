import type { Celda } from '../domain/csv'
import { importeCsv } from '../domain/csv'
import type { GrupoPresentado } from '../domain/presentacion'

/**
 * Filas de CSV de un grupo: título, renglones con sus cuentas, y subtotal.
 *
 * Las cuentas van debajo de su renglón con el código delante, de modo que en la
 * hoja se pueda filtrar por la columna "Cuenta" y quedarse solo con los
 * renglones, o solo con el detalle.
 */
export function filasGrupo(
  titulo: string,
  grupo: GrupoPresentado,
  comparando: boolean,
): Celda[][] {
  const importes = (actual: string, comparado: string | null): Celda[] =>
    comparando
      ? [importeCsv(actual), importeCsv(comparado ?? '0')]
      : [importeCsv(actual)]

  const filas: Celda[][] = [[titulo]]
  for (const renglon of grupo.renglones) {
    filas.push([
      renglon.nombre,
      '',
      renglon.notas.join(' '),
      ...importes(renglon.importe, renglon.comparado),
    ])
    for (const cuenta of renglon.cuentas) {
      filas.push([
        `  ${cuenta.nombre}`,
        cuenta.codigo,
        '',
        ...importes(cuenta.importe, cuenta.comparado),
      ])
    }
  }
  filas.push([
    `Total ${titulo.toLowerCase()}`,
    '',
    '',
    ...importes(grupo.total, grupo.comparado),
  ])
  return filas
}

export function encabezadoCsv(
  etiquetaActual: string,
  etiquetaComparado: string | null,
): Celda[] {
  return [
    'Concepto',
    'Cuenta',
    'Nota',
    etiquetaActual,
    ...(etiquetaComparado ? [etiquetaComparado] : []),
  ]
}
