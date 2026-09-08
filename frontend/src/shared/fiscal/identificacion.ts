/**
 * Identificación tributaria — Costa Rica.
 *
 * Ver docs/13-localizacion-costa-rica.md §2.
 *
 * Nota importante: las cédulas costarricenses no tienen un dígito verificador
 * público y documentado, a diferencia de otros países de la región. La
 * validación aquí es de FORMATO y LONGITUD únicamente. La verificación real de
 * existencia del contribuyente se hace contra el padrón de Hacienda, del lado
 * del servidor.
 */

export type TipoIdentificacion = 'FISICA' | 'JURIDICA' | 'DIMEX' | 'NITE'

export interface ConfigIdentificacion {
  readonly tipo: TipoIdentificacion
  readonly nombre: string
  readonly descripcion: string
  readonly longitudes: readonly number[]
}

export const TIPOS_IDENTIFICACION: Record<
  TipoIdentificacion,
  ConfigIdentificacion
> = {
  FISICA: {
    tipo: 'FISICA',
    nombre: 'Cédula física',
    descripcion: 'Cédula de identidad nacional',
    longitudes: [9],
  },
  JURIDICA: {
    tipo: 'JURIDICA',
    nombre: 'Cédula jurídica',
    descripcion: 'Personas jurídicas',
    longitudes: [10],
  },
  DIMEX: {
    tipo: 'DIMEX',
    nombre: 'DIMEX',
    descripcion: 'Documento de identidad migratorio para extranjeros',
    longitudes: [11, 12],
  },
  NITE: {
    tipo: 'NITE',
    nombre: 'NITE',
    descripcion: 'Número de identificación tributaria especial',
    longitudes: [10],
  },
}

/** Deja solo dígitos. El número se almacena siempre sin separadores. */
export function normalizarIdentificacion(valor: string): string {
  return valor.replace(/\D/g, '')
}

export interface ResultadoValidacion {
  readonly valido: boolean
  readonly error?: string
}

export function validarIdentificacion(
  valor: string,
  tipo: TipoIdentificacion,
): ResultadoValidacion {
  const numero = normalizarIdentificacion(valor)
  const config = TIPOS_IDENTIFICACION[tipo]

  if (numero === '') {
    return { valido: false, error: 'La identificación es obligatoria' }
  }

  if (!config.longitudes.includes(numero.length)) {
    const esperado = config.longitudes.join(' o ')
    return {
      valido: false,
      error: `${config.nombre} debe tener ${esperado} dígitos (tiene ${numero.length})`,
    }
  }

  if (/^0+$/.test(numero)) {
    return { valido: false, error: 'Identificación inválida' }
  }

  if (tipo === 'FISICA' && numero.startsWith('0')) {
    return {
      valido: false,
      error: 'Una cédula física no puede empezar con cero',
    }
  }

  if (tipo === 'JURIDICA' && !/^[2-5]/.test(numero)) {
    return {
      valido: false,
      error: 'Una cédula jurídica debe empezar con 2, 3, 4 o 5',
    }
  }

  return { valido: true }
}

/**
 * Deduce el tipo a partir de la longitud. Es una ayuda de captura, no una
 * verdad: 10 dígitos pueden ser cédula jurídica o NITE, y se resuelve por el
 * primer dígito.
 */
export function detectarTipo(valor: string): TipoIdentificacion | null {
  const numero = normalizarIdentificacion(valor)
  switch (numero.length) {
    case 9:
      return 'FISICA'
    case 10:
      return /^[2-5]/.test(numero) ? 'JURIDICA' : 'NITE'
    case 11:
    case 12:
      return 'DIMEX'
    default:
      return null
  }
}

/**
 * Formato para pantalla. El almacenamiento y el XML van siempre sin guiones.
 *
 *   FISICA    1-1234-5678
 *   JURIDICA  3-101-123456
 *   DIMEX     sin separadores
 */
export function formatIdentificacion(
  valor: string,
  tipo?: TipoIdentificacion,
): string {
  const numero = normalizarIdentificacion(valor)
  const t = tipo ?? detectarTipo(numero)

  if (t === 'FISICA' && numero.length === 9) {
    return `${numero[0]}-${numero.slice(1, 5)}-${numero.slice(5)}`
  }
  if (t === 'JURIDICA' && numero.length === 10) {
    return `${numero[0]}-${numero.slice(1, 4)}-${numero.slice(4)}`
  }
  return numero
}
