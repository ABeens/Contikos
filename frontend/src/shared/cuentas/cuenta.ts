import type { Cuenta } from '@/shared/api/contracts/conta'

/**
 * Papel contable de una cuenta dentro del ciclo del activo fijo (docs/07 §6).
 *
 * Los tres predicados están aquí y no en `modules/activos` porque los usan los
 * dos lados de la misma relación: activos, para mapear su categoría, y CxP,
 * para saber que la línea que acaba de capturar reconoce un bien y no un gasto.
 * Una sola definición evita la peor variante del problema: que CxP considere de
 * activo una cuenta que activos no, y la compra quede fuera de la conciliación
 * de docs/07 §4 sin que nadie se entere.
 */

/**
 * Cuenta que reconoce el costo de un activo fijo.
 *
 * Deudora y con auxiliar de activo: eso deja fuera la depreciación acumulada,
 * que comparte módulo y auxiliar pero es acreedora y nunca recibe una compra.
 */
export function esCuentaDeActivoFijo(cuenta: Cuenta | undefined): boolean {
  return Boolean(
    cuenta &&
      cuenta.requiereAuxiliar === 'activo' &&
      cuenta.naturaleza === 'deudora',
  )
}

/** Contracuenta del activo: misma familia, pero acreedora. */
export function esCuentaDeDepreciacionAcumulada(
  cuenta: Cuenta | undefined,
): boolean {
  return Boolean(
    cuenta &&
      cuenta.requiereAuxiliar === 'activo' &&
      cuenta.naturaleza === 'acreedora',
  )
}

/** Cuenta de resultados donde cae la cuota del periodo. */
export function esCuentaDeResultados(cuenta: Cuenta | undefined): boolean {
  return Boolean(cuenta && (cuenta.tipo === 'gasto' || cuenta.tipo === 'costo'))
}

/** Busca por código en un catálogo. */
export function cuentaPorCodigo(
  cuentas: readonly Cuenta[],
  codigo: string,
): Cuenta | undefined {
  return cuentas.find((c) => c.codigo === codigo)
}

/**
 * Cuenta bancaria del mayor: la de control de una cuenta de `bancos`.
 *
 * Vive aquí por la misma razón que los tres predicados del activo fijo: la
 * usan los dos lados de la relación. Bancos la usa para validar el mapeo de su
 * catálogo, y CxC y CxP para saber que la cuenta de depósito o de salida que
 * acaba de elegir el usuario exige indicar CUÁL cuenta bancaria (docs/02 §3,
 * validación 8). Una sola definición evita que CxC considere bancaria una
 * cuenta que bancos no, y el cobro quede con un auxiliar que su catálogo no
 * reconoce.
 *
 * La caja no entra: `1.1.01.001 Caja general` es efectivo y no exige auxiliar,
 * que es justamente lo que permite cobrar contra caja sin cuenta bancaria.
 */
export function esCuentaDeBanco(cuenta: Cuenta | undefined): boolean {
  return Boolean(cuenta && cuenta.requiereAuxiliar === 'banco')
}
