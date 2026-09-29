import Decimal from 'decimal.js'
import type { Balanza, Naturaleza } from '@/shared/api/contracts/conta'

/**
 * Saldos por cuenta en la convención con la que se suman los estados.
 *
 * La balanza entrega cada saldo con el signo de la naturaleza de su cuenta, que
 * es lo que un contador lee, pero no lo que se puede sumar: la depreciación
 * acumulada es un activo de saldo acreedor, y sumarla con su signo de
 * naturaleza la contaría a favor del activo. Aquí todo se pasa a "deudor
 * positivo" (cargos suman, abonos restan) y cada estado decide después con qué
 * signo presenta cada lado.
 *
 * Solo cuentas de detalle: las acumulativas ya suman a sus hijas, y contarlas
 * también duplicaría cada saldo tantas veces como niveles tenga el catálogo.
 */

export const CERO = new Decimal(0)

/** Importe por código de cuenta, deudor positivo. */
export type Importes = ReadonlyMap<string, Decimal>

export function aDeudorPositivo(valor: string, naturaleza: Naturaleza): Decimal {
  const importe = new Decimal(valor)
  return naturaleza === 'deudora' ? importe : importe.negated()
}

function mapear(
  balanza: Balanza,
  valor: (r: Balanza['renglones'][number]) => Decimal,
): Importes {
  const mapa = new Map<string, Decimal>()
  for (const renglon of balanza.renglones) {
    if (!renglon.esDetalle) continue
    mapa.set(renglon.codigo, valor(renglon))
  }
  return mapa
}

/** Saldo de cada cuenta al cierre del periodo de la balanza. */
export function saldosAlCierre(balanza: Balanza): Importes {
  return mapear(balanza, (r) => aDeudorPositivo(r.saldoFinal, r.naturaleza))
}

/** Saldo de cada cuenta al abrir el periodo de la balanza. */
export function saldosAlInicio(balanza: Balanza): Importes {
  return mapear(balanza, (r) => aDeudorPositivo(r.saldoInicial, r.naturaleza))
}

/** Lo que cada cuenta se movió dentro del periodo de la balanza. */
export function movimientosDelPeriodo(balanza: Balanza): Importes {
  return mapear(balanza, (r) => new Decimal(r.cargos).minus(r.abonos))
}

/**
 * Lo que cada cuenta se movió entre dos cortes.
 *
 * Se incluyen las cuentas de cualquiera de los dos lados: una que nació en el
 * intervalo se movió todo su saldo, y una que quedó en cero se movió todo lo
 * que tenía.
 */
export function variacion(fin: Importes, inicio: Importes): Importes {
  const codigos = new Set([...fin.keys(), ...inicio.keys()])
  const mapa = new Map<string, Decimal>()
  for (const codigo of codigos) {
    mapa.set(
      codigo,
      (fin.get(codigo) ?? CERO).minus(inicio.get(codigo) ?? CERO),
    )
  }
  return mapa
}

export function importeDe(importes: Importes | null, codigo: string): Decimal {
  return importes?.get(codigo) ?? CERO
}

/** Formato del contrato: dos decimales, como texto. */
export function aTexto(valor: Decimal): string {
  return valor.toFixed(2)
}
