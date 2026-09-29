/**
 * Exportación de un reporte a CSV (docs/09 §7).
 *
 * Pensado para abrirse en una hoja de cálculo en español: punto y coma entre
 * columnas y coma decimal, que es lo que Excel espera con la configuración
 * regional de Costa Rica. Con coma entre columnas y punto decimal, cada importe
 * se abriría como texto y ninguna fórmula lo sumaría.
 *
 * El BOM al principio no es decoración: sin él, Excel lee el archivo como
 * Latin-1 y "Depreciación" llega como "DepreciaciÃ³n".
 */

export type Celda = string | number | null | undefined

const SEPARADOR = ';'
const BOM = '﻿'

/** Un importe del contrato ("-1250.50") en el formato de la hoja: "-1250,50". */
export function importeCsv(importe: string | null | undefined): string {
  if (importe === null || importe === undefined || importe === '') return ''
  return importe.replace('.', ',')
}

function celda(valor: Celda): string {
  if (valor === null || valor === undefined) return ''
  const texto = String(valor)
  // Se entrecomilla solo lo que lo necesita, duplicando las comillas internas.
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function aCsv(filas: readonly (readonly Celda[])[]): string {
  return BOM + filas.map((fila) => fila.map(celda).join(SEPARADOR)).join('\r\n')
}

/** Nombre de archivo sin caracteres que un sistema de archivos rechace. */
export function nombreArchivo(partes: readonly string[]): string {
  return `${partes
    .join('-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')}.csv`
}
