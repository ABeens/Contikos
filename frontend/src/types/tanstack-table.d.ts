import '@tanstack/react-table'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Alinea a la derecha y usa cifras tabulares. Para columnas de importes. */
    numerico?: boolean
    /** Ancho fijo de la columna, p. ej. '120px'. */
    ancho?: string
  }
}
