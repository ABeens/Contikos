import Decimal from 'decimal.js'

/**
 * Configuración global de precisión.
 *
 * ROUND_HALF_UP es la convención contable habitual: 0,005 → 0,01.
 * La precisión interna es muy superior a la de presentación a propósito — el
 * redondeo ocurre SOLO al presentar o al enviar a la API, nunca en cálculos
 * intermedios.
 */
Decimal.set({
  precision: 34,
  rounding: Decimal.ROUND_HALF_UP,
  toExpPos: 40,
  toExpNeg: -40,
})

/**
 * Código ISO 4217 de la moneda.
 *
 * No es una unión cerrada a propósito: el catálogo de monedas es un dato
 * configurable por la empresa (docs/10 §2 — entidad `Moneda`), no una decisión
 * de compilación. Agregar el euro no debe requerir recompilar el frontend.
 *
 * La forma del código la valida el contrato (`MonedaSchema`); el catálogo
 * vigente vive en el registro de este módulo.
 */
export type Moneda = string

/** Separador de miles admitido. Cadena vacía = sin agrupación. */
export type SeparadorGrupo = '.' | ',' | ' ' | "'" | ''
export type SeparadorDecimal = '.' | ','
/** ₡1.234,56 (antes) frente a 1.234,56 € (después). */
export type PosicionSimbolo = 'antes' | 'despues'

export interface ConfigMoneda {
  readonly codigo: Moneda
  readonly nombre: string
  readonly simbolo: string
  readonly decimales: number
  /** Separador de miles */
  readonly grupo: SeparadorGrupo
  /** Separador decimal */
  readonly decimal: SeparadorDecimal
  readonly posicionSimbolo: PosicionSimbolo
  /** Una moneda inactiva no se ofrece al capturar, pero sigue formateando los
   *  documentos históricos que la usaron. */
  readonly activa: boolean
  /** Moneda en la que se lleva el libro mayor. Exactamente una (docs/01 §4.2). */
  readonly funcional: boolean
  /** Tipo de cambio de referencia contra la funcional. Siempre "1" en ella. */
  readonly tipoCambio: string
}

/**
 * Catálogo inicial.
 *
 * Rige mientras la configuración de la empresa no ha llegado, y es el que
 * siembra el mock. Costa Rica: el colón se escribe ₡1.234.567,89 en uso
 * contable; el euro, 1.234.567,89 € con el símbolo detrás.
 *
 * Nota: no se usa `Intl.NumberFormat` en ninguna parte, a propósito. Produce
 * espacio como separador de miles en es-CR siguiendo CLDR, y su salida cambia
 * entre versiones de ICU. Un reporte que se ve distinto según dónde se generó
 * es un reporte que nadie firma.
 */
export const MONEDAS_POR_DEFECTO: readonly ConfigMoneda[] = [
  {
    codigo: 'CRC',
    nombre: 'Colón costarricense',
    simbolo: '₡',
    decimales: 2,
    grupo: '.',
    decimal: ',',
    posicionSimbolo: 'antes',
    activa: true,
    funcional: true,
    tipoCambio: '1',
  },
  {
    codigo: 'USD',
    nombre: 'Dólar estadounidense',
    simbolo: '$',
    decimales: 2,
    grupo: ',',
    decimal: '.',
    posicionSimbolo: 'antes',
    activa: true,
    funcional: false,
    tipoCambio: '505.25',
  },
  {
    codigo: 'EUR',
    nombre: 'Euro',
    simbolo: '€',
    decimales: 2,
    grupo: '.',
    decimal: ',',
    posicionSimbolo: 'despues',
    activa: true,
    funcional: false,
    tipoCambio: '592.40',
  },
]

/**
 * Registro vigente de monedas.
 *
 * Es sincrónico a propósito: `formatMoney`, `Money.redondear` y `Money.toApi`
 * se llaman dentro del render y en bucles sobre miles de renglones. Un catálogo
 * asíncrono ahí obligaría a propagar promesas hasta la última celda.
 *
 * Lo hidrata `registrarMonedas` en cuanto responde `GET /config/monedas`.
 */
const REGISTRO = new Map<Moneda, ConfigMoneda>()

function sembrar(lista: readonly ConfigMoneda[]): void {
  REGISTRO.clear()
  for (const config of lista) REGISTRO.set(config.codigo, config)
}

sembrar(MONEDAS_POR_DEFECTO)

/** Sustituye el catálogo vigente por el que configuró la empresa. */
export function registrarMonedas(lista: readonly ConfigMoneda[]): void {
  // Un catálogo vacío dejaría a la aplicación sin poder formatear nada. Ante
  // una respuesta así se conserva el anterior: eso es un fallo del servidor, no
  // una instrucción del usuario.
  if (lista.length === 0) return
  sembrar(lista)
}

/** Vuelve al catálogo inicial. Para pruebas y para el cierre de sesión. */
export function restablecerMonedas(): void {
  sembrar(MONEDAS_POR_DEFECTO)
}

export function monedasRegistradas(): ConfigMoneda[] {
  return [...REGISTRO.values()]
}

/** Las que se pueden elegir al capturar un documento. */
export function monedasActivas(): ConfigMoneda[] {
  return monedasRegistradas().filter((m) => m.activa)
}

export function esMonedaRegistrada(codigo: Moneda): boolean {
  return REGISTRO.has(codigo)
}

/**
 * Configuración de una moneda.
 *
 * Una moneda desconocida NO lanza: un asiento histórico en una moneda que
 * después se retiró del catálogo debe seguir viéndose. Se formatea con
 * convención neutra y el código como símbolo.
 */
export function configuracionMoneda(codigo: Moneda): ConfigMoneda {
  return REGISTRO.get(codigo) ?? desconocida(codigo)
}

function desconocida(codigo: Moneda): ConfigMoneda {
  return {
    codigo,
    nombre: codigo,
    simbolo: codigo,
    decimales: 2,
    grupo: ',',
    decimal: '.',
    posicionSimbolo: 'despues',
    activa: false,
    funcional: false,
    tipoCambio: '1',
  }
}

/** Moneda del libro mayor. */
export function monedaFuncional(): Moneda {
  for (const config of REGISTRO.values()) {
    if (config.funcional) return config.codigo
  }
  return MONEDAS_POR_DEFECTO[0].codigo
}

/** Símbolos vigentes. Los usa el parser de importes para descartarlos. */
export function simbolosRegistrados(): string[] {
  const simbolos = new Set<string>(['₡', '$', '€', '£', '¥'])
  for (const config of REGISTRO.values()) simbolos.add(config.simbolo)
  return [...simbolos]
}

export function codigosRegistrados(): string[] {
  return [...REGISTRO.keys()]
}

export type ImporteCrudo = string | number | Decimal | Money

export class ErrorMoneda extends Error {}

function aDecimal(valor: ImporteCrudo): Decimal {
  if (valor instanceof Money) return valor.monto
  if (valor instanceof Decimal) return valor
  if (typeof valor === 'string') {
    const limpio = valor.trim()
    if (limpio === '') return new Decimal(0)
    return new Decimal(limpio)
  }
  return new Decimal(valor)
}

/**
 * Importe con moneda asociada.
 *
 * Regla del proyecto: ningún importe se representa como `number`. Las
 * operaciones aritméticas sobre dinero pasan siempre por esta clase; sumar
 * floats produce descuadres que el usuario ve y no puede explicar.
 */
export class Money {
  readonly monto: Decimal
  readonly moneda: Moneda

  constructor(monto: ImporteCrudo, moneda: Moneda) {
    this.monto = aDecimal(monto)
    this.moneda = moneda
  }

  static of(monto: ImporteCrudo, moneda: Moneda): Money {
    return new Money(monto, moneda)
  }

  static cero(moneda: Moneda): Money {
    return new Money(0, moneda)
  }

  /** Construye desde el string que transporta la API. Nunca desde un number. */
  static desdeApi(valor: string, moneda: Moneda): Money {
    return new Money(valor, moneda)
  }

  private mismaMoneda(otro: Money): void {
    if (otro.moneda !== this.moneda) {
      throw new ErrorMoneda(
        `No se pueden operar importes de distinta moneda: ${this.moneda} y ${otro.moneda}`,
      )
    }
  }

  plus(otro: Money): Money {
    this.mismaMoneda(otro)
    return new Money(this.monto.plus(otro.monto), this.moneda)
  }

  minus(otro: Money): Money {
    this.mismaMoneda(otro)
    return new Money(this.monto.minus(otro.monto), this.moneda)
  }

  times(factor: ImporteCrudo): Money {
    return new Money(this.monto.times(aDecimal(factor)), this.moneda)
  }

  dividedBy(divisor: ImporteCrudo): Money {
    const d = aDecimal(divisor)
    if (d.isZero()) throw new ErrorMoneda('División entre cero')
    return new Money(this.monto.dividedBy(d), this.moneda)
  }

  /** Convierte a otra moneda aplicando un tipo de cambio. */
  convertir(destino: Moneda, tipoCambio: ImporteCrudo): Money {
    const tc = aDecimal(tipoCambio)
    if (tc.lessThanOrEqualTo(0)) {
      throw new ErrorMoneda('El tipo de cambio debe ser mayor que cero')
    }
    if (destino === this.moneda) return this
    return new Money(this.monto.times(tc), destino)
  }

  negated(): Money {
    return new Money(this.monto.negated(), this.moneda)
  }

  abs(): Money {
    return new Money(this.monto.abs(), this.moneda)
  }

  /** Redondea a los decimales de la moneda. Solo al presentar o al enviar. */
  redondear(): Money {
    return new Money(
      this.monto.toDecimalPlaces(configuracionMoneda(this.moneda).decimales),
      this.moneda,
    )
  }

  esCero(): boolean {
    return this.monto.isZero()
  }

  esNegativo(): boolean {
    return this.monto.isNegative() && !this.monto.isZero()
  }

  esPositivo(): boolean {
    return this.monto.greaterThan(0)
  }

  comparadoCon(otro: Money): number {
    this.mismaMoneda(otro)
    return this.monto.comparedTo(otro.monto)
  }

  igualA(otro: Money): boolean {
    return this.moneda === otro.moneda && this.monto.equals(otro.monto)
  }

  /** Representación para la API: string con decimales fijos. Nunca un number. */
  toApi(): string {
    return this.monto.toFixed(configuracionMoneda(this.moneda).decimales)
  }

  toString(): string {
    return `${this.toApi()} ${this.moneda}`
  }

  toJSON(): string {
    return this.toApi()
  }
}

/** Suma segura de una colección. Lanza si hay monedas mezcladas. */
export function sum(importes: readonly Money[], moneda: Moneda): Money {
  return importes.reduce((acc, m) => acc.plus(m), Money.cero(moneda))
}

/** Atajo para construir colones. */
export function crc(monto: ImporteCrudo): Money {
  return new Money(monto, 'CRC')
}

/** Atajo para construir dólares. */
export function usd(monto: ImporteCrudo): Money {
  return new Money(monto, 'USD')
}

/** Atajo para construir euros. */
export function eur(monto: ImporteCrudo): Money {
  return new Money(monto, 'EUR')
}
