import Decimal from 'decimal.js'
import type {
  Balanza,
  BalanzaComparativa,
  RenglonComparativo,
} from '@/shared/api/contracts/conta'

/**
 * Balanza comparativa entre dos periodos (docs/09 §3.2 y §4).
 *
 * El motor de saldos no está aquí: la comparativa se arma sobre DOS balanzas
 * ya construidas, cada una por el mismo camino que la sencilla. Duplicar el
 * cálculo de saldos para poder compararlos sería la forma segura de que un día
 * la balanza de agosto y la columna "agosto" de la comparativa dijeran cosas
 * distintas, que es justo lo que un comparativo existe para descartar.
 *
 * Todo en `decimal.js`: la variación es dinero (docs/01 §4.2), y el porcentaje
 * sale de una división que en coma flotante daría 33.33333333333333.
 */

const CERO = new Decimal(0)

/**
 * Variación porcentual de A a B, o null si no existe.
 *
 * Sobre el VALOR ABSOLUTO del saldo base, para que el signo del porcentaje
 * sea siempre el de la variación que tiene al lado. Con el saldo con signo en
 * el denominador, una cuenta que va de -100 a -150 enseñaría "-50.00" en la
 * columna de variación y "+50%" en la de al lado.
 *
 * Null cuando el saldo base es cero. No hay porcentaje de crecimiento sobre la
 * nada, y devolver 0, 100 o infinito sería inventar una cifra que después
 * alguien suma. Se presenta como "n/a".
 */
export function variacionPorcentual(
  saldoA: string,
  saldoB: string,
): string | null {
  const base = new Decimal(saldoA)
  if (base.isZero()) return null
  return new Decimal(saldoB)
    .minus(base)
    .dividedBy(base.abs())
    .times(100)
    .toFixed(2)
}

/** Variación absoluta: lo que el saldo se movió de un periodo al otro. */
export function variacionAbsoluta(saldoA: string, saldoB: string): string {
  return new Decimal(saldoB).minus(new Decimal(saldoA)).toFixed(2)
}

/**
 * Cruza las dos balanzas por cuenta.
 *
 * Se incluyen las cuentas que aparecen en cualquiera de los dos periodos, no
 * solo en los dos: una cuenta que nació en el periodo B tiene variación (todo
 * su saldo) y una que dejó de moverse también (la pérdida entera). Quedarse
 * con la intersección escondería precisamente los movimientos que un
 * comparativo busca.
 */
export function compararBalanzas(
  balanzaA: Balanza,
  balanzaB: Balanza,
): BalanzaComparativa {
  const porCodigoA = new Map(balanzaA.renglones.map((r) => [r.codigo, r]))
  const porCodigoB = new Map(balanzaB.renglones.map((r) => [r.codigo, r]))

  // El orden lo manda B, que es el periodo que se está mirando, y las cuentas
  // que solo existen en A se añaden después: el catálogo va ordenado por
  // código, así que reordenar la unión entera por código deja el mismo árbol.
  const codigos = [
    ...balanzaB.renglones.map((r) => r.codigo),
    ...balanzaA.renglones
      .map((r) => r.codigo)
      .filter((codigo) => !porCodigoB.has(codigo)),
  ].sort((a, b) => a.localeCompare(b))

  const renglones: RenglonComparativo[] = codigos.map((codigo) => {
    const a = porCodigoA.get(codigo)
    const b = porCodigoB.get(codigo)
    // Uno de los dos existe por construcción: el código sale de sus renglones.
    const cuenta = (b ?? a)!
    const saldoA = a?.saldoFinal ?? CERO.toFixed(2)
    const saldoB = b?.saldoFinal ?? CERO.toFixed(2)
    return {
      cuentaId: cuenta.cuentaId,
      codigo: cuenta.codigo,
      nombre: cuenta.nombre,
      nivel: cuenta.nivel,
      esDetalle: cuenta.esDetalle,
      naturaleza: cuenta.naturaleza,
      saldoA,
      saldoB,
      variacion: variacionAbsoluta(saldoA, saldoB),
      variacionPorcentual: variacionPorcentual(saldoA, saldoB),
    }
  })

  return {
    periodoA: balanzaA.periodo,
    periodoB: balanzaB.periodo,
    // Las dos balanzas son del mismo libro y de la misma moneda funcional: lo
    // garantiza quien las construye, que las pide con el mismo parámetro.
    libro: balanzaB.libro,
    moneda: balanzaB.moneda,
    renglones,
  }
}
