import type { SolicitudAdjunto } from '@/shared/api/contracts/comunes'

/**
 * Reglas de los adjuntos de una factura de gasto (docs/05 §1).
 *
 * El adjunto típico es el PDF que manda el proveedor, y a veces la foto del
 * tiquete. Se limita a esos formatos y a un tamaño razonable: el adjunto
 * sustenta el gasto ante una revisión, no es un repositorio documental.
 *
 * Es la misma función que usa el mock, para que la pantalla rechace lo mismo
 * que rechazará la API, antes de subir cinco megabytes para nada.
 */

export const TIPOS_ADJUNTO_PERMITIDOS: readonly string[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]

/** 5 MB. Por encima, el problema es otro. */
export const TAMANO_MAXIMO_ADJUNTO = 5 * 1024 * 1024

export interface ErrorAdjunto {
  readonly codigo: 'ADJUNTO_INVALIDO'
  readonly mensaje: string
}

export interface ResultadoAdjunto {
  readonly valido: boolean
  readonly errores: readonly ErrorAdjunto[]
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** Bytes que ocupa el contenido una vez decodificado. */
export function tamanoDecodificado(contenidoBase64: string): number {
  const limpio = contenidoBase64.replace(/\s/g, '')
  if (limpio.length === 0) return 0
  const relleno = limpio.endsWith('==') ? 2 : limpio.endsWith('=') ? 1 : 0
  return Math.floor((limpio.length * 3) / 4) - relleno
}

/** "1,2 MB" para pantalla. */
export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/**
 * Valida los metadatos y, si viene, el contenido.
 *
 * La pantalla lo llama con el archivo elegido antes de leerlo (sin
 * contenido) para avisar en el acto; el servidor lo llama con todo.
 */
export function validarAdjunto(
  adjunto: Omit<SolicitudAdjunto, 'contenidoBase64'> & {
    contenidoBase64?: string
  },
): ResultadoAdjunto {
  const errores: ErrorAdjunto[] = []

  if (adjunto.nombre.trim() === '') {
    errores.push({
      codigo: 'ADJUNTO_INVALIDO',
      mensaje: 'El archivo requiere un nombre',
    })
  }

  if (!TIPOS_ADJUNTO_PERMITIDOS.includes(adjunto.tipoMime)) {
    errores.push({
      codigo: 'ADJUNTO_INVALIDO',
      mensaje: `${adjunto.nombre || 'El archivo'}: solo se admiten PDF e imágenes (PNG, JPEG, WebP)`,
    })
  }

  if (adjunto.tamano <= 0) {
    errores.push({
      codigo: 'ADJUNTO_INVALIDO',
      mensaje: `${adjunto.nombre || 'El archivo'} está vacío`,
    })
  } else if (adjunto.tamano > TAMANO_MAXIMO_ADJUNTO) {
    errores.push({
      codigo: 'ADJUNTO_INVALIDO',
      mensaje: `${adjunto.nombre || 'El archivo'} pesa ${tamanoLegible(adjunto.tamano)} y el máximo es ${tamanoLegible(TAMANO_MAXIMO_ADJUNTO)}`,
    })
  }

  if (adjunto.contenidoBase64 !== undefined) {
    const limpio = adjunto.contenidoBase64.replace(/\s/g, '')
    if (limpio.length === 0 || !BASE64.test(limpio) || limpio.length % 4 !== 0) {
      errores.push({
        codigo: 'ADJUNTO_INVALIDO',
        mensaje: 'El contenido del archivo no es base64 válido',
      })
    } else if (tamanoDecodificado(limpio) > TAMANO_MAXIMO_ADJUNTO) {
      // El tamaño declarado se puede mentir; el contenido no.
      errores.push({
        codigo: 'ADJUNTO_INVALIDO',
        mensaje: `El contenido supera el máximo de ${tamanoLegible(TAMANO_MAXIMO_ADJUNTO)}`,
      })
    }
  }

  return { valido: errores.length === 0, errores }
}
