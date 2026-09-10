import type { Cuenta } from '@/shared/api/contracts/conta'
import type { CuentaBancaria } from '@/shared/api/contracts/bancos'
import { esCuentaDeBanco } from './cuenta'

/**
 * Por dónde entra y sale el dinero: caja y cuentas bancarias.
 *
 * Lo consultan los dos módulos que mueven efectivo, CxC al cobrar y CxP al
 * pagar, y por eso vive en `shared` y no en ninguno de ellos (docs/14 §3.1).
 *
 * Antes de que existiera el catálogo de bancos esto se resolvía adivinando: se
 * filtraban del plan de cuentas las que empezaban por `1.1.01.` y el auxiliar
 * bancario se derivaba de la POSICIÓN de la cuenta entre las bancarias, o se
 * tecleaba a mano. Funcionaba mientras nadie reordenara el catálogo. Ahora la
 * cuenta bancaria se elige de su catálogo y de ella salen las dos cosas que el
 * asiento necesita: el código contable y el auxiliar (docs/06 §1).
 */

export interface OpcionEfectivo {
  /** Cuenta del mayor que se mueve. */
  readonly codigo: string
  readonly nombre: string
  /**
   * Cuenta bancaria del catálogo, cuando la cuenta la exige. Nulo en caja,
   * que no lleva auxiliar y es lo que permite cobrar sin banco de por medio.
   */
  readonly auxiliarBanco: string | null
  /** Moneda de la cuenta bancaria. Nula en caja, que no la declara. */
  readonly moneda: string | null
}

/**
 * Cuentas de efectivo del plan que NO son bancarias.
 *
 * Es la caja: `1.1.01.001` general y `1.1.01.002` chica en el catálogo de
 * plantilla. El prefijo es el del rubro de efectivo y equivalentes, que es el
 * único sitio del plan donde una cuenta puede recibir un cobro directo.
 */
const PREFIJO_EFECTIVO = '1.1.01.'

export function cuentasDeCaja(cuentas: readonly Cuenta[]): Cuenta[] {
  return cuentas.filter(
    (c) =>
      c.esDetalle &&
      c.activa &&
      c.tipo === 'activo' &&
      c.codigo.startsWith(PREFIJO_EFECTIVO) &&
      !esCuentaDeBanco(c),
  )
}

/**
 * Todo lo que puede recibir un cobro o pagar un egreso.
 *
 * Las cuentas bancarias entran por su catálogo y no por el plan: la ficha es la
 * que sabe a qué cuenta de control corresponde y con qué auxiliar vive en el
 * mayor. Una cuenta bancaria inactiva no se ofrece, y una cuenta de control sin
 * ficha tampoco: sin ficha no hay auxiliar que poner, y el asiento se
 * rechazaría con `AUXILIAR_REQUERIDO` después de haber capturado el documento
 * entero.
 */
export function opcionesDeEfectivo(
  cuentas: readonly Cuenta[],
  cuentasBancarias: readonly CuentaBancaria[],
): OpcionEfectivo[] {
  const caja: OpcionEfectivo[] = cuentasDeCaja(cuentas).map((c) => ({
    codigo: c.codigo,
    nombre: c.nombre,
    auxiliarBanco: null,
    moneda: c.moneda,
  }))

  const bancos: OpcionEfectivo[] = cuentasBancarias
    .filter((b) => b.activa)
    .map((b) => ({
      codigo: b.cuentaContable,
      nombre: `${b.nombre} · ${b.banco}`,
      auxiliarBanco: b.id,
      moneda: b.moneda,
    }))

  return [...caja, ...bancos]
}

/**
 * Llave de una opción para un `select`.
 *
 * Lleva las dos partes porque el código contable no basta: caja y banco son
 * cuentas distintas, pero dos fichas bancarias no pueden compartir cuenta de
 * control, así que el par siempre es único.
 */
export function claveEfectivo(opcion: OpcionEfectivo): string {
  return `${opcion.codigo}::${opcion.auxiliarBanco ?? ''}`
}

/**
 * La cuenta bancaria que corresponde a una cuenta del mayor.
 *
 * Devuelve una sola porque la correspondencia es uno a uno y el catálogo la
 * garantiza (docs/06 §1). Es lo que permite resolver el auxiliar de un
 * documento viejo, capturado cuando solo se guardaba el código contable.
 */
export function cuentaBancariaDe(
  cuentasBancarias: readonly CuentaBancaria[],
  codigoContable: string,
): CuentaBancaria | undefined {
  return cuentasBancarias.find((b) => b.cuentaContable === codigoContable)
}
