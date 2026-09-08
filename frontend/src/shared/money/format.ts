import Decimal from 'decimal.js'
import {
  codigosRegistrados,
  configuracionMoneda,
  monedaFuncional,
  simbolosRegistrados,
  Money,
  type ConfigMoneda,
  type Moneda,
} from './money'

export interface OpcionesFormato {
  /** Muestra el símbolo de moneda. Por defecto true. */
  simbolo?: boolean
  /** Negativos entre paréntesis en vez de con signo. Convención de reportes. */
  parentesisNegativos?: boolean
  /** Oculta el valor cuando es cero (columnas de cargo/abono). */
  ocultarCero?: boolean
  /** Sobrescribe los decimales de la moneda. */
  decimales?: number
}

/**
 * Formatea un importe según la configuración de su moneda.
 *
 * ₡1.234.567,89   $1,234,567.89   1.234.567,89 €
 *
 * Implementado a mano y no con Intl: el resultado debe ser idéntico en el
 * navegador, en Node y entre versiones de ICU. Un reporte que se ve distinto
 * según dónde se generó es un reporte que nadie firma.
 */
export function formatMoney(
  valor: Money | { monto: Decimal; moneda: Moneda },
  opciones: OpcionesFormato = {},
): string {
  return formatConConfig(
    valor.monto,
    configuracionMoneda(valor.moneda),
    opciones,
  )
}

/**
 * Formatea contra una configuración concreta, sin pasar por el registro.
 *
 * Lo necesita la pantalla de configuración de monedas: hay que mostrar el
 * ejemplo de la moneda que se está editando, que todavía no se ha guardado.
 */
export function formatConConfig(
  monto: Decimal,
  config: ConfigMoneda,
  opciones: OpcionesFormato = {},
): string {
  const {
    simbolo = true,
    parentesisNegativos = false,
    ocultarCero = false,
    decimales,
  } = opciones

  const dec = decimales ?? config.decimales

  if (ocultarCero && monto.isZero()) return ''

  const negativo = monto.isNegative() && !monto.toDecimalPlaces(dec).isZero()
  const fijo = monto.abs().toFixed(dec)
  const [entera, fraccion] = fijo.split('.')

  const enteraAgrupada = agruparMiles(entera, config.grupo)
  const cuerpo =
    fraccion === undefined
      ? enteraAgrupada
      : `${enteraAgrupada}${config.decimal}${fraccion}`

  // El símbolo pospuesto lleva espacio (1.234,56 €); el antepuesto no (₡1.234,56).
  const conSimbolo = !simbolo
    ? cuerpo
    : config.posicionSimbolo === 'despues'
      ? `${cuerpo} ${config.simbolo}`
      : `${config.simbolo}${cuerpo}`

  if (!negativo) return conSimbolo
  return parentesisNegativos ? `(${conSimbolo})` : `-${conSimbolo}`
}

function agruparMiles(entera: string, separador: string): string {
  if (separador === '') return entera
  return entera.replace(/\B(?=(\d{3})+(?!\d))/g, separador)
}

/**
 * Quita símbolos y códigos de moneda del texto capturado.
 *
 * Se consultan los registrados en vez de una lista fija: si la empresa da de
 * alta una moneda con un símbolo propio, pegar un importe copiado de otro
 * sistema debe seguir funcionando.
 */
function quitarMoneda(texto: string): string {
  let limpio = texto
  for (const simbolo of simbolosRegistrados()) {
    limpio = limpio.split(simbolo).join('')
  }
  const codigos = codigosRegistrados()
  // Solo se descartan las letras que forman un código vigente: "abc" debe
  // seguir siendo un importe inválido, no el número vacío.
  limpio = limpio.replace(/[A-Za-z]{3}/g, (coincidencia) =>
    codigos.includes(coincidencia.toUpperCase()) ? '' : coincidencia,
  )
  return limpio.replace(/\s/g, '') // \s cubre también NBSP y NNBSP
}

/**
 * Interpreta lo que el usuario escribe en un campo de importe.
 *
 * Acepta indistintamente coma o punto como separador decimal — quien captura
 * ocho horas al día usa el teclado numérico y no debe pelear con el formato.
 *
 * Heurística cuando hay ambigüedad:
 *   "1.234,56" / "1,234.56"  → el ÚLTIMO separador es el decimal
 *   "1234,56"  / "1234.56"   → decimal (≤ 2 dígitos después)
 *   "1.234"    / "1,234"     → miles (exactamente 3 dígitos después)
 *
 * Devuelve null si el texto no es un importe válido.
 */
export function parseMonto(texto: string): Decimal | null {
  const limpio = quitarMoneda(texto)
    .replace(/^\((.*)\)$/, '-$1')
    .trim()

  if (limpio === '' || limpio === '-') return null
  if (!/^-?[\d.,]+$/.test(limpio)) return null

  const negativo = limpio.startsWith('-')
  const cuerpo = negativo ? limpio.slice(1) : limpio

  const ultimoPunto = cuerpo.lastIndexOf('.')
  const ultimaComa = cuerpo.lastIndexOf(',')
  let normalizado: string

  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    // Ambos presentes: el último es el decimal, el otro es agrupador.
    const posDecimal = Math.max(ultimoPunto, ultimaComa)
    const sepDecimal = cuerpo[posDecimal]
    const sepGrupo = sepDecimal === '.' ? ',' : '.'
    normalizado =
      cuerpo.slice(0, posDecimal).split(sepGrupo).join('') +
      '.' +
      cuerpo.slice(posDecimal + 1)
  } else if (ultimoPunto >= 0 || ultimaComa >= 0) {
    const pos = Math.max(ultimoPunto, ultimaComa)
    const sep = cuerpo[pos]
    const ocurrencias = cuerpo.split(sep).length - 1
    const digitosDespues = cuerpo.length - pos - 1

    if (ocurrencias > 1 || digitosDespues === 3) {
      // Separador de miles: "1.234.567" o "1.234"
      normalizado = cuerpo.split(sep).join('')
    } else {
      normalizado = cuerpo.slice(0, pos) + '.' + cuerpo.slice(pos + 1)
    }
  } else {
    normalizado = cuerpo
  }

  if (normalizado === '' || !/^\d*\.?\d*$/.test(normalizado)) return null
  if (normalizado === '.') return null

  try {
    const d = new Decimal(normalizado || '0')
    return negativo ? d.negated() : d
  } catch {
    return null
  }
}

/** Parsea texto del usuario directamente a Money. */
export function parseMoney(texto: string, moneda: Moneda): Money | null {
  const d = parseMonto(texto)
  return d === null ? null : new Money(d, moneda)
}

/** Formatea una cantidad sin moneda (unidades, tipos de cambio, porcentajes). */
export function formatNumero(
  valor: Decimal | string | number,
  decimales = 2,
  moneda: Moneda = monedaFuncional(),
): string {
  const config = configuracionMoneda(moneda)
  const d = valor instanceof Decimal ? valor : new Decimal(valor)
  const negativo = d.isNegative() && !d.toDecimalPlaces(decimales).isZero()
  const [entera, fraccion] = d.abs().toFixed(decimales).split('.')
  const cuerpo =
    fraccion === undefined
      ? agruparMiles(entera, config.grupo)
      : `${agruparMiles(entera, config.grupo)}${config.decimal}${fraccion}`
  return negativo ? `-${cuerpo}` : cuerpo
}
