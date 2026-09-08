import type { EstadoPeriodo, Periodo } from '@/shared/api/contracts/conta'
import { tabla } from '@/shared/almacen/almacen'

const EJERCICIO = 2026

/**
 * Periodos del ejercicio. En Costa Rica el periodo fiscal es el año calendario
 * (docs/13 §1).
 *
 * Estado de arranque de la demo: el primer semestre ya está bloqueado tras la
 * presentación de declaraciones, julio cerrado, y agosto en curso.
 */
const ESTADOS: Record<number, EstadoPeriodo> = {
  1: 'bloqueado',
  2: 'bloqueado',
  3: 'bloqueado',
  4: 'bloqueado',
  5: 'bloqueado',
  6: 'bloqueado',
  7: 'cerrado',
}

function ultimoDia(mes: number): number {
  return new Date(Date.UTC(EJERCICIO, mes, 0)).getUTCDate()
}

const dosDigitos = (n: number) => String(n).padStart(2, '0')

function construirPeriodos(): Periodo[] {
  return Array.from({ length: 12 }, (_, i) => {
    const numero = i + 1
    return {
      id: `per-${EJERCICIO}-${dosDigitos(numero)}`,
      ejercicio: EJERCICIO,
      numero,
      fechaInicio: `${EJERCICIO}-${dosDigitos(numero)}-01`,
      fechaFin: `${EJERCICIO}-${dosDigitos(numero)}-${dosDigitos(ultimoDia(numero))}`,
      estado: ESTADOS[numero] ?? 'abierto',
      // La bitácora nace vacía incluso en los periodos que la semilla entrega
      // ya cerrados: de esos cierres no hay constancia, y decir que los cerró
      // alguien a una hora concreta sería inventar el registro que el cierre
      // existe para dejar.
      cerradoEn: null,
      cerradoPor: null,
      motivoCierre: null,
    }
  })
}

/**
 * Los periodos vivos, persistidos.
 *
 * El estado del periodo es un dato que cambia: cerrar y reabrir (docs/03 §5)
 * lo mutan en su sitio y llaman a `persistirPeriodos()`. Se muta el array vivo
 * y no una copia porque media aplicación lo tiene importado por referencia, y
 * un periodo cerrado en una copia seguiría admitiendo asientos en la otra.
 */
const tablaPeriodos = tabla<Periodo>('conta.periodos', construirPeriodos)

export const PERIODOS: Periodo[] = tablaPeriodos.filas

export function persistirPeriodos(): void {
  tablaPeriodos.persistir()
}

export const PERIODO_ACTUAL = PERIODOS.find((p) => p.numero === 8)!
