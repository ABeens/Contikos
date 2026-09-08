import Decimal from 'decimal.js'
import { Money, type Moneda } from '@/shared/money/money'

/**
 * IVA, Costa Rica (Ley 9635).
 *
 * Ver docs/13-localizacion-costa-rica.md §3.
 *
 * ADVERTENCIA DE MANTENIMIENTO
 *
 * Las tarifas y sobre todo la asignación de bienes y servicios a cada tarifa
 * reducida son materia de reglamento y CAMBIAN. Por eso la tabla que rige es
 * la de la empresa, con vigencia por fecha (`contracts/impuestos`, pantalla
 * Configuración > Impuestos). Lo que hay aquí es la tabla POR DEFECTO: la que
 * siembra el mock y la que sirve de respaldo cuando quien calcula no aporta
 * una tabla resuelta.
 *
 * El cálculo recibe la tarifa ya resuelta (o una función que la resuelva por
 * código) precisamente para que ningún importe dependa de la constante: la
 * factura de junio se calcula con la tarifa vigente en junio.
 */

/**
 * Código de tarifa. Alias de string a propósito: la tabla es dato y añadir
 * una tarifa no debe requerir recompilar.
 */
export type IdTarifaIva = string

/** Lo mínimo que hace falta para calcular el impuesto de una línea. */
export interface TarifaResuelta {
  readonly codigo: string
  readonly nombre: string
  /** Porcentaje como string para no perder precisión. */
  readonly porcentaje: string
  /** Distingue exento y no sujeto de tarifa 0%: se declaran distinto. */
  readonly generaImpuesto: boolean
}

/** Fila de la tabla por defecto. */
export interface TarifaIva extends TarifaResuelta {
  readonly descripcion: string
  /**
   * Código de tarifa del XML de Hacienda (catálogo de comprobantes v4.3).
   * Confirmar contra el catálogo vigente antes de construir el XML.
   */
  readonly codigoHacienda: string | null
}

export const TARIFAS_IVA: readonly TarifaIva[] = [
  {
    codigo: 'GENERAL',
    nombre: 'General 13%',
    porcentaje: '13',
    descripcion: 'Tarifa general',
    generaImpuesto: true,
    codigoHacienda: '08',
  },
  {
    codigo: 'REDUCIDA_4',
    nombre: 'Reducida 4%',
    porcentaje: '4',
    descripcion: 'Servicios de salud privados, pasajes aéreos',
    generaImpuesto: true,
    codigoHacienda: '04',
  },
  {
    codigo: 'REDUCIDA_2',
    nombre: 'Reducida 2%',
    porcentaje: '2',
    descripcion: 'Medicamentos, primas de seguros, educación privada',
    generaImpuesto: true,
    codigoHacienda: '03',
  },
  {
    codigo: 'REDUCIDA_1',
    nombre: 'Reducida 1%',
    porcentaje: '1',
    descripcion: 'Canasta básica tributaria, insumos agropecuarios',
    generaImpuesto: true,
    codigoHacienda: '02',
  },
  {
    codigo: 'CERO',
    nombre: 'Tarifa 0%',
    porcentaje: '0',
    descripcion: 'Exportaciones',
    generaImpuesto: true,
    codigoHacienda: '01',
  },
  {
    codigo: 'EXENTO',
    nombre: 'Exento',
    porcentaje: '0',
    descripcion: 'Operación exenta por ley',
    generaImpuesto: false,
    codigoHacienda: '10',
  },
  {
    codigo: 'NO_SUJETO',
    nombre: 'No sujeto',
    porcentaje: '0',
    descripcion: 'Operación no sujeta al impuesto',
    generaImpuesto: false,
    codigoHacienda: null,
  },
]

export const TARIFA_POR_CODIGO: Readonly<Record<string, TarifaIva>> =
  Object.fromEntries(TARIFAS_IVA.map((t) => [t.codigo, t]))

/** Tarifa con la que arranca una línea nueva. */
export const TARIFA_GENERAL: IdTarifaIva = 'GENERAL'

/**
 * Resuelve un código de tarifa a su porcentaje.
 *
 * Devuelve `undefined` cuando el código no rige: es quien llama el que decide
 * si eso es un error de validación o si se cae al respaldo.
 */
export type ResolverTarifa = (codigo: IdTarifaIva) => TarifaResuelta | undefined

/** Resuelve contra la tabla por defecto. Es el respaldo. */
export const resolverPorDefecto: ResolverTarifa = (codigo) =>
  TARIFA_POR_CODIGO[codigo]

/**
 * Tarifa que se usa cuando ningún resolutor conoce el código.
 *
 * Cero y sin impuesto, con el código como nombre: un documento histórico con
 * una tarifa que ya no existe se tiene que poder seguir viendo, y el cálculo
 * de captura tiene que poder correr mientras la validación lo rechaza.
 */
export function tarifaDesconocida(codigo: IdTarifaIva): TarifaResuelta {
  return { codigo, nombre: codigo, porcentaje: '0', generaImpuesto: false }
}

export interface LineaGravable {
  readonly cantidad: string
  readonly precioUnitario: string
  readonly descuento?: string
  readonly tarifa: IdTarifaIva
}

export interface ImpuestoLinea {
  readonly base: Money
  readonly tarifa: TarifaResuelta
  readonly impuesto: Money
  readonly total: Money
}

/**
 * Calcula el impuesto de UNA línea.
 *
 * El impuesto se calcula por línea y nunca sobre el total del documento: una
 * factura puede combinar tarifas distintas, y calcular sobre el total daría un
 * resultado incorrecto que además no cuadraría contra el XML.
 *
 * `resolver` es la tabla vigente a la fecha del documento. Si no conoce el
 * código se prueba la tabla por defecto, y si tampoco, la línea se calcula a
 * cero con la tarifa marcada como desconocida.
 */
export function calcularImpuestoLinea(
  linea: LineaGravable,
  moneda: Moneda,
  resolver: ResolverTarifa = resolverPorDefecto,
): ImpuestoLinea {
  const cantidad = new Decimal(linea.cantidad || '0')
  const precio = new Decimal(linea.precioUnitario || '0')
  const descuento = new Decimal(linea.descuento || '0')

  const base = new Money(cantidad.times(precio).minus(descuento), moneda)
  const tarifa =
    resolver(linea.tarifa) ??
    resolverPorDefecto(linea.tarifa) ??
    tarifaDesconocida(linea.tarifa)

  const impuesto = tarifa.generaImpuesto
    ? base.times(new Decimal(tarifa.porcentaje).dividedBy(100)).redondear()
    : Money.cero(moneda)

  return {
    base: base.redondear(),
    tarifa,
    impuesto,
    total: base.redondear().plus(impuesto),
  }
}

export interface DesgloseImpuestos {
  readonly subtotal: Money
  readonly descuentos: Money
  readonly porTarifa: readonly {
    tarifa: TarifaResuelta
    base: Money
    impuesto: Money
  }[]
  readonly totalImpuesto: Money
  readonly total: Money
}

/** Agrega las líneas de un documento y desglosa el impuesto por tarifa. */
export function calcularDesglose(
  lineas: readonly LineaGravable[],
  moneda: Moneda,
  resolver: ResolverTarifa = resolverPorDefecto,
): DesgloseImpuestos {
  const calculadas = lineas.map((l) => calcularImpuestoLinea(l, moneda, resolver))

  // Se conserva el orden de primera aparición: es el orden en que el usuario
  // capturó y el que espera ver en el desglose.
  const acumulado = new Map<
    string,
    { tarifa: TarifaResuelta; base: Money; impuesto: Money }
  >()
  for (const c of calculadas) {
    const previo = acumulado.get(c.tarifa.codigo)
    acumulado.set(c.tarifa.codigo, {
      tarifa: c.tarifa,
      base: previo ? previo.base.plus(c.base) : c.base,
      impuesto: previo ? previo.impuesto.plus(c.impuesto) : c.impuesto,
    })
  }

  const subtotal = calculadas.reduce(
    (acc, c) => acc.plus(c.base),
    Money.cero(moneda),
  )
  const descuentos = lineas.reduce(
    (acc, l) => acc.plus(new Money(l.descuento || '0', moneda)),
    Money.cero(moneda),
  )
  const totalImpuesto = calculadas.reduce(
    (acc, c) => acc.plus(c.impuesto),
    Money.cero(moneda),
  )

  return {
    subtotal,
    descuentos,
    porTarifa: [...acumulado.values()],
    totalImpuesto,
    total: subtotal.plus(totalImpuesto),
  }
}
