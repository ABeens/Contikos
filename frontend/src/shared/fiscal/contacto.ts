import type { Telefono } from '@/shared/api/contracts/terceros'

/**
 * Validación de los datos de contacto que pide el comprobante electrónico.
 *
 * Compartida por cliente y proveedor: el XML pide lo mismo del emisor y del
 * receptor (docs/13 §4). Cada función devuelve el mensaje del error o nulo,
 * para que cada dominio lo envuelva con su propio código.
 */

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validarCorreo(correo: string | null): string | null {
  if (correo === null || correo.trim() === '') return null
  return CORREO.test(correo.trim()) ? null : `El correo ${correo} no tiene forma de correo`
}

/**
 * Teléfono: código de país de 1 a 3 dígitos y número de 7 a 20 dígitos.
 *
 * Es lo que admite el esquema del comprobante. Se guardan solo dígitos; los
 * separadores son cosa de la pantalla.
 */
export function validarTelefono(telefono: Telefono | null): string | null {
  if (telefono === null) return null
  const pais = telefono.codigoPais.replace(/\D/g, '')
  const numero = telefono.numero.replace(/\D/g, '')
  if (pais.length < 1 || pais.length > 3) {
    return 'El código de país del teléfono debe tener entre 1 y 3 dígitos'
  }
  if (numero.length < 7 || numero.length > 20) {
    return 'El número de teléfono debe tener entre 7 y 20 dígitos'
  }
  return null
}

/** Deja el teléfono como se almacena: solo dígitos. */
export function normalizarTelefono(telefono: Telefono | null): Telefono | null {
  if (telefono === null) return null
  const numero = telefono.numero.replace(/\D/g, '')
  if (numero === '') return null
  return {
    codigoPais: telefono.codigoPais.replace(/\D/g, '') || '506',
    numero,
  }
}

/** Código CIIU de 6 dígitos. La existencia real la confirma Hacienda. */
export function validarActividadEconomica(
  actividad: string | null,
): string | null {
  if (actividad === null || actividad.trim() === '') return null
  return /^\d{6}$/.test(actividad.trim())
    ? null
    : 'La actividad económica es un código CIIU de 6 dígitos'
}

/** "+506 2222-3333" para pantalla. */
export function formatTelefono(telefono: Telefono | null): string {
  if (!telefono) return ''
  const n = telefono.numero
  const cuerpo = n.length === 8 ? `${n.slice(0, 4)}-${n.slice(4)}` : n
  return `+${telefono.codigoPais} ${cuerpo}`
}
