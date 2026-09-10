import Decimal from 'decimal.js'
import type { Cuenta } from '@/shared/api/contracts/conta'
import type {
  CuentaBancaria,
  CuentaBancariaBase,
  MovimientoBancario,
  SolicitudCuentaBancaria,
  TipoCuentaBancaria,
} from '@/shared/api/contracts/bancos'
import { cuentaPorCodigo, esCuentaDeBanco } from '@/shared/cuentas/cuenta'

/**
 * Reglas del catálogo de cuentas bancarias (docs/06 §1).
 *
 * Todo lo de aquí es puro: recibe la solicitud, el catálogo de cuentas y las
 * cuentas bancarias que ya existen, y devuelve si vale y por qué no. Quien
 * escribe (el mock hoy, el backend mañana) llama a esto antes de guardar.
 *
 * La regla que sostiene el resto del módulo es la correspondencia **uno a uno**
 * entre cuenta bancaria y cuenta de control del mayor. Es lo que permite:
 *
 * - que el saldo del auxiliar se pueda conciliar contra el mayor cuenta por
 *   cuenta (docs/06 §4), en vez de contra un saldo repartido entre fichas;
 * - que el id de la cuenta bancaria sea directamente el `auxiliarId` con el
 *   que vive en el mayor, sin tabla de traducción;
 * - que sustituir la solución provisional de cobros y pagos no cambie ningún
 *   asiento ya emitido, porque el auxiliar que aquellos derivaban de la cuenta
 *   contable es el mismo que ahora sale del catálogo.
 */

export type CodigoErrorCuentaBancaria =
  | 'BANCO_REQUERIDO'
  | 'NOMBRE_REQUERIDO'
  | 'NUMERO_REQUERIDO'
  | 'IBAN_INVALIDO'
  | 'CUENTA_CONTABLE_INVALIDA'
  | 'CUENTA_CONTABLE_NO_BANCARIA'
  | 'CUENTA_CONTABLE_DUPLICADA'
  | 'CUENTA_CONTABLE_CONGELADA'
  | 'MONEDA_DISCREPANTE'
  | 'CUENTA_CON_SALDO'

export interface ErrorCuentaBancaria {
  readonly codigo: CodigoErrorCuentaBancaria
  readonly mensaje: string
}

export interface ResultadoCuentaBancaria {
  readonly valido: boolean
  readonly errores: readonly ErrorCuentaBancaria[]
}

export interface ContextoCuentaBancaria {
  readonly cuentas: readonly Cuenta[]
  /** Las que ya existen. Al editar, incluye la que se está editando. */
  readonly cuentasBancarias: readonly CuentaBancariaBase[]
  /** Movimientos propios de todas las cuentas: lo que congela el mapeo. */
  readonly movimientos: readonly MovimientoBancario[]
}

export const TIPOS_CUENTA_BANCARIA: readonly {
  valor: TipoCuentaBancaria
  etiqueta: string
}[] = [
  { valor: 'cheques', etiqueta: 'Cuenta corriente' },
  { valor: 'ahorro', etiqueta: 'Cuenta de ahorro' },
  { valor: 'inversion', etiqueta: 'Inversión' },
  { valor: 'caja_chica', etiqueta: 'Caja chica' },
]

export function etiquetaTipoCuenta(tipo: TipoCuentaBancaria): string {
  return TIPOS_CUENTA_BANCARIA.find((t) => t.valor === tipo)?.etiqueta ?? tipo
}

/**
 * IBAN de Costa Rica: `CR` y veinte dígitos (docs/13).
 *
 * Se valida la forma y no el dígito de control. La forma atrapa el error real
 * (un número de cuenta local pegado en el campo del IBAN); el dígito de control
 * atraparía una errata que el banco rechaza de todos modos, y a cambio pediría
 * mantener aquí el algoritmo ISO 13616 para un campo que solo es informativo.
 */
const IBAN_CR = /^CR\d{20}$/

export function normalizarIban(iban: string | null | undefined): string | null {
  const limpio = (iban ?? '').replace(/[\s-]/g, '').toUpperCase()
  return limpio === '' ? null : limpio
}

export function ibanValido(iban: string): boolean {
  return IBAN_CR.test(iban)
}

/**
 * Movimientos de una cuenta bancaria.
 *
 * Se filtra por el id de la cuenta y no por la cuenta contable: son lo mismo
 * por la regla uno a uno, pero el id es lo que el movimiento lleva encima.
 */
export function movimientosDe(
  movimientos: readonly MovimientoBancario[],
  cuentaBancariaId: string,
): MovimientoBancario[] {
  return movimientos.filter((m) => m.cuentaBancariaId === cuentaBancariaId)
}

/**
 * Saldo en libros: la suma de los movimientos propios, con su signo.
 *
 * Es la mitad del par que la conciliación cruza. La otra mitad, `saldoBanco`,
 * no se calcula: viene del estado de cuenta y por definición no tiene por qué
 * coincidir hasta que la conciliación explique la diferencia.
 */
export function saldoEnLibros(
  movimientos: readonly MovimientoBancario[],
  cuentaBancariaId: string,
): Decimal {
  return movimientosDe(movimientos, cuentaBancariaId).reduce(
    (acc, m) => acc.plus(m.importe),
    new Decimal(0),
  )
}

export function sinConciliar(
  movimientos: readonly MovimientoBancario[],
  cuentaBancariaId: string,
): MovimientoBancario[] {
  return movimientosDe(movimientos, cuentaBancariaId).filter(
    (m) => m.estado === 'registrado',
  )
}

/**
 * Completa la ficha con sus derivados para servirla por la API.
 *
 * El saldo en libros y los movimientos sin conciliar se calculan aquí en vez de
 * guardarse en la ficha: un saldo almacenado que se actualiza a mano es un
 * saldo que un día deja de coincidir con los movimientos que lo explican.
 */
export function serializarCuentaBancaria(
  base: CuentaBancariaBase,
  contexto: {
    cuentas: readonly Cuenta[]
    movimientos: readonly MovimientoBancario[]
  },
): CuentaBancaria {
  return {
    ...base,
    cuentaContableNombre:
      cuentaPorCodigo(contexto.cuentas, base.cuentaContable)?.nombre ??
      base.cuentaContable,
    saldoLibros: saldoEnLibros(contexto.movimientos, base.id).toFixed(2),
    movimientos: movimientosDe(contexto.movimientos, base.id).length,
    saldoBanco: base.saldoBanco,
    saldoBancoAl: base.saldoBancoAl,
    movimientosSinConciliar: sinConciliar(contexto.movimientos, base.id).length,
  }
}

/* ------------------------------------------------------- Validación */

/**
 * Alta y edición de una cuenta bancaria.
 *
 * `id` viene cuando se edita, y sirve para dos cosas: excluir la propia ficha
 * de la comprobación de cuenta contable duplicada, y comprobar si su mapeo ya
 * está congelado por tener movimientos.
 */
export function validarCuentaBancaria(
  solicitud: SolicitudCuentaBancaria,
  contexto: ContextoCuentaBancaria,
  id?: string,
): ResultadoCuentaBancaria {
  const errores: ErrorCuentaBancaria[] = []

  if (solicitud.banco.trim() === '') {
    errores.push({ codigo: 'BANCO_REQUERIDO', mensaje: 'Indique el banco' })
  }
  if (solicitud.nombre.trim() === '') {
    errores.push({
      codigo: 'NOMBRE_REQUERIDO',
      mensaje: 'La cuenta requiere un nombre',
    })
  }
  if (solicitud.numeroCuenta.trim() === '') {
    errores.push({
      codigo: 'NUMERO_REQUERIDO',
      mensaje: 'Indique el número de cuenta',
    })
  }

  const iban = normalizarIban(solicitud.iban)
  if (iban !== null && !ibanValido(iban)) {
    errores.push({
      codigo: 'IBAN_INVALIDO',
      mensaje: 'El IBAN de Costa Rica son las letras CR y veinte dígitos',
    })
  }

  const cuenta = cuentaPorCodigo(contexto.cuentas, solicitud.cuentaContable)

  if (!cuenta || !cuenta.esDetalle || !cuenta.activa) {
    errores.push({
      codigo: 'CUENTA_CONTABLE_INVALIDA',
      mensaje: `La cuenta ${solicitud.cuentaContable} no existe, no es de detalle o está inactiva`,
    })
  } else if (!esCuentaDeBanco(cuenta)) {
    // El catálogo de cuentas es quien decide qué cuentas son bancarias, no este
    // módulo: son las que exigen auxiliar `banco` (docs/03 §2). Enlazar aquí una
    // cuenta de gasto crearía un auxiliar que el mayor nunca podría conciliar.
    errores.push({
      codigo: 'CUENTA_CONTABLE_NO_BANCARIA',
      mensaje: `La cuenta ${cuenta.codigo} ${cuenta.nombre} no es una cuenta de control de bancos: elija una que exija auxiliar bancario`,
    })
  } else {
    const ocupada = contexto.cuentasBancarias.find(
      (c) => c.cuentaContable === cuenta.codigo && c.id !== id,
    )
    if (ocupada) {
      errores.push({
        codigo: 'CUENTA_CONTABLE_DUPLICADA',
        mensaje: `La cuenta ${cuenta.codigo} ya es la cuenta de control de ${ocupada.codigo} ${ocupada.nombre}`,
      })
    }

    // La moneda de la cuenta contable, cuando el catálogo la fija, manda: es la
    // que decide en qué moneda se lleva ese saldo en el mayor, y una ficha que
    // dijera otra cosa produciría movimientos que no cuadran contra su control.
    if (cuenta.moneda !== null && cuenta.moneda !== solicitud.moneda) {
      errores.push({
        codigo: 'MONEDA_DISCREPANTE',
        mensaje: `La cuenta ${cuenta.codigo} lleva su saldo en ${cuenta.moneda} y la cuenta bancaria se está declarando en ${solicitud.moneda}`,
      })
    }
  }

  if (id) {
    const previa = contexto.cuentasBancarias.find((c) => c.id === id)
    const conMovimientos = movimientosDe(contexto.movimientos, id).length > 0

    // Mismo criterio que el mapeo de una categoría de activo (docs/07 §6):
    // cambiar la cuenta de control de una ficha que ya movió el mayor dejaría
    // los movimientos viejos apuntando a una cuenta y los nuevos a otra, y el
    // auxiliar dejaría de cuadrar contra las dos.
    if (previa && conMovimientos && previa.cuentaContable !== solicitud.cuentaContable) {
      errores.push({
        codigo: 'CUENTA_CONTABLE_CONGELADA',
        mensaje: `La cuenta ${previa.codigo} ya tiene movimientos: su cuenta de control y su moneda no se pueden cambiar`,
      })
    }
    if (previa && conMovimientos && previa.moneda !== solicitud.moneda) {
      errores.push({
        codigo: 'MONEDA_DISCREPANTE',
        mensaje: `La cuenta ${previa.codigo} ya tiene movimientos en ${previa.moneda}: su moneda no se puede cambiar`,
      })
    }

    // Desactivar una cuenta con saldo la esconde del catálogo sin que el dinero
    // deje de estar ahí: el mayor seguiría enseñando un saldo que ninguna ficha
    // visible explica. Primero se traspasa o se cierra, después se desactiva.
    if (previa && !solicitud.activa) {
      const saldo = saldoEnLibros(contexto.movimientos, id)
      if (!saldo.isZero()) {
        errores.push({
          codigo: 'CUENTA_CON_SALDO',
          mensaje: `La cuenta ${previa.codigo} tiene un saldo de ${saldo.toFixed(2)} ${previa.moneda} y no se puede desactivar`,
        })
      }
    }
  }

  return { valido: errores.length === 0, errores }
}

/**
 * Normaliza lo capturado antes de guardar.
 *
 * Los espacios de más en el nombre de un banco no son un error que merezca
 * rechazar una captura, pero sí ensucian las listas y rompen las búsquedas por
 * texto. Se limpian aquí, en un solo sitio.
 */
export function normalizarSolicitud(
  solicitud: SolicitudCuentaBancaria,
): SolicitudCuentaBancaria {
  return {
    ...solicitud,
    banco: solicitud.banco.trim(),
    nombre: solicitud.nombre.trim(),
    numeroCuenta: solicitud.numeroCuenta.trim(),
    iban: normalizarIban(solicitud.iban),
  }
}

/**
 * Identificador de una cuenta bancaria nueva.
 *
 * `bco-001` es la convención con la que el mayor de la demostración ya está
 * sembrado y con la que cobros y pagos derivaban su auxiliar antes de que este
 * catálogo existiera. Se conserva a propósito: es lo que hace que sustituir
 * aquella solución provisional no cambie ni un asiento ya emitido.
 */
export function siguienteIdCuentaBancaria(
  existentes: readonly CuentaBancariaBase[],
): string {
  const mayor = existentes.reduce((acc, c) => {
    const numero = Number(c.id.replace(/\D/g, ''))
    return Number.isNaN(numero) ? acc : Math.max(acc, numero)
  }, 0)
  return `bco-${String(mayor + 1).padStart(3, '0')}`
}

/** Llave visible de la ficha. Es el mismo dato que el id, en mayúsculas. */
export function codigoDeId(id: string): string {
  return id.toUpperCase()
}
