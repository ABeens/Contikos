import { format, parseISO, isValid } from 'date-fns'
import { es } from 'date-fns/locale'

/**
 * Fechas contables.
 *
 * Una fecha contable es un DÍA, no un instante. Se transporta y se almacena
 * como 'yyyy-MM-dd' sin zona horaria: convertirla a Date con hora produce
 * asientos que caen en el periodo equivocado cuando el navegador está en otra
 * zona.
 */
export type FechaISO = string // yyyy-MM-dd

export function formatFecha(fecha: FechaISO | Date | null | undefined): string {
  if (!fecha) return ''
  const d = typeof fecha === 'string' ? parseISO(fecha) : fecha
  return isValid(d) ? format(d, 'dd/MM/yyyy') : ''
}

export function formatFechaLarga(
  fecha: FechaISO | Date | null | undefined,
): string {
  if (!fecha) return ''
  const d = typeof fecha === 'string' ? parseISO(fecha) : fecha
  return isValid(d) ? format(d, "d 'de' MMMM 'de' yyyy", { locale: es }) : ''
}

export function hoyISO(): FechaISO {
  return format(new Date(), 'yyyy-MM-dd')
}

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Setiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

/** 'Setiembre' — la forma habitual en Costa Rica, no 'Septiembre'. */
export function nombreMes(numero: number): string {
  return MESES[numero - 1] ?? ''
}

export function formatPeriodo(ejercicio: number, mes: number): string {
  return `${nombreMes(mes)} ${ejercicio}`
}
