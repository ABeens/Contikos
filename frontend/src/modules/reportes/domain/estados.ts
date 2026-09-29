import Decimal from 'decimal.js'
import type { GrupoPresentacion, TipoCuenta } from '@/shared/api/contracts/conta'
import { GRUPOS_POR_ESTADO } from '@/shared/api/contracts/conta'
import {
  agrupar,
  grupoDe,
  sumar,
  totalDe,
  type Catalogos,
  type GrupoPresentado,
  type RenglonPresentado,
} from './presentacion'
import { CERO, aTexto, importeDe, variacion, type Importes } from './saldos'

/**
 * Estado de Situación Financiera y Estado de Resultados (docs/09 §3.2 y §3.3).
 *
 * Las dos funciones reciben importes ya calculados por la balanza de `conta` y
 * solo los presentan: agrupan, suman y verifican. Ningún cálculo de negocio
 * vive aquí (docs/09 §1): si un número necesitara lógica, esa lógica sería del
 * módulo dueño.
 *
 * Todo en `decimal.js`: un subtotal en coma flotante que no cuadra por un
 * céntimo es indistinguible de un error de clasificación.
 */

const TIPOS_RESULTADO: readonly TipoCuenta[] = ['ingreso', 'costo', 'gasto']

/**
 * Resultado acumulado en las cuentas de resultados, en positivo si es utilidad.
 *
 * Las cuentas de ingreso tienen saldo acreedor y las de gasto deudor: en
 * convención deudor positivo, la utilidad es el negativo de la suma.
 */
export function resultadoDe(importes: Importes, catalogos: Catalogos): Decimal {
  let total = CERO
  for (const cuenta of catalogos.cuentas) {
    if (!cuenta.esDetalle || !TIPOS_RESULTADO.includes(cuenta.tipo)) continue
    total = total.plus(importeDe(importes, cuenta.codigo))
  }
  return total.negated()
}

/* ------------------------------------------- Estado de Situación Financiera */

/** Un corte del balance: los saldos a la fecha y al abrir su ejercicio. */
export interface CorteSituacion {
  /** Saldo de cada cuenta al cierre del periodo. */
  readonly alCierre: Importes
  /**
   * Saldo de cada cuenta al abrir el ejercicio del periodo.
   *
   * Hace falta para partir el resultado en dos: lo ganado en este ejercicio y
   * lo que quedó de ejercicios anteriores sin trasladar a resultados
   * acumulados porque su cierre no se hizo.
   */
  readonly alAbrirEjercicio: Importes
}

export interface LadoSituacion {
  readonly grupos: readonly GrupoPresentado[]
  readonly total: string
  readonly comparado: string | null
}

export interface EstadoSituacion {
  readonly activo: LadoSituacion
  readonly pasivo: LadoSituacion
  readonly patrimonio: LadoSituacion
  readonly totalPasivoPatrimonio: string
  readonly totalPasivoPatrimonioComparado: string | null
  /** Activo menos pasivo y patrimonio. Distinto de cero es un error. */
  readonly diferencia: string
  readonly cuadra: boolean
  /** Hay saldos que no llegaron a ningún renglón válido. */
  readonly haySinClasificar: boolean
}

const GRUPOS_ACTIVO: readonly GrupoPresentacion[] = [
  'activo_corriente',
  'activo_no_corriente',
]
const GRUPOS_PASIVO: readonly GrupoPresentacion[] = [
  'pasivo_corriente',
  'pasivo_no_corriente',
]

/** Los grupos de un lado, en el orden de la norma, y al final lo sin clasificar. */
function ordenarLado(
  grupos: readonly GrupoPresentado[],
  orden: readonly GrupoPresentacion[],
): GrupoPresentado[] {
  const ordenados = orden
    .map((g) => grupoDe(grupos, g))
    .filter((g): g is GrupoPresentado => g !== undefined)
  // Un renglón de patrimonio con grupo de activo (no debería pasar: la
  // validación lo impide) no se pierde: cae al final con los sin clasificar.
  const resto = grupos.filter(
    (g) => g.grupo === null || !orden.includes(g.grupo),
  )
  return [...ordenados, ...resto]
}

function lado(
  grupos: readonly GrupoPresentado[],
  comparando: boolean,
): LadoSituacion {
  return {
    grupos,
    total: aTexto(totalDe(grupos, 'total')),
    comparado: comparando ? aTexto(totalDe(grupos, 'comparado')) : null,
  }
}

/**
 * Renglones calculados del patrimonio: el resultado que todavía vive en las
 * cuentas de ingresos y gastos.
 *
 * Mientras el ejercicio no se cierra, la utilidad no está en ninguna cuenta de
 * patrimonio: está repartida entre ingresos y gastos. El balance la presenta
 * igual, como renglón del patrimonio, porque sin ella el activo no es igual al
 * pasivo más el patrimonio.
 */
function renglonesDeResultado(
  actual: CorteSituacion,
  comparado: CorteSituacion | null,
  catalogos: Catalogos,
): RenglonPresentado[] {
  const partes = (corte: CorteSituacion) => {
    const anteriores = resultadoDe(corte.alAbrirEjercicio, catalogos)
    const total = resultadoDe(corte.alCierre, catalogos)
    return { anteriores, ejercicio: total.minus(anteriores) }
  }
  const a = partes(actual)
  const b = comparado ? partes(comparado) : null

  const renglon = (
    clave: string,
    nombre: string,
    importe: Decimal,
    otro: Decimal | null,
  ): RenglonPresentado => ({
    clave,
    codigo: null,
    nombre,
    notas: [],
    importe: aTexto(importe),
    comparado: otro === null ? null : aTexto(otro),
    cuentas: [],
    sinClasificar: false,
  })

  const renglones: RenglonPresentado[] = []
  // Solo aparece cuando existe: con los cierres al día siempre es cero, y un
  // renglón en cero que dice "pendientes de cierre" alarma sin motivo.
  if (!a.anteriores.isZero() || (b && !b.anteriores.isZero())) {
    renglones.push(
      renglon(
        'resultado-anteriores',
        'Resultados de ejercicios anteriores pendientes de cierre',
        a.anteriores,
        b?.anteriores ?? null,
      ),
    )
  }
  renglones.push(
    renglon(
      'resultado-ejercicio',
      'Resultado del ejercicio',
      a.ejercicio,
      b?.ejercicio ?? null,
    ),
  )
  return renglones
}

/**
 * Estado de Situación Financiera a la fecha de un corte.
 *
 * La verificación es la ecuación contable, y no se da por supuesta: si la
 * balanza cuadra y todas las cuentas tienen renglón, cuadra siempre, así que
 * una diferencia aquí señala un saldo en una cuenta de orden o un error del
 * núcleo, y se enseña en vez de esconderla.
 */
export function construirEstadoSituacion(
  actual: CorteSituacion,
  comparado: CorteSituacion | null,
  catalogos: Catalogos,
): EstadoSituacion {
  const comparando = comparado !== null
  const agruparLado = (tipos: readonly TipoCuenta[], signo: 1 | -1) =>
    agrupar(actual.alCierre, comparado?.alCierre ?? null, catalogos, {
      estado: 'situacion',
      tipos,
      signo,
    })

  const activo = lado(ordenarLado(agruparLado(['activo'], 1), GRUPOS_ACTIVO), comparando)
  const pasivo = lado(ordenarLado(agruparLado(['pasivo'], -1), GRUPOS_PASIVO), comparando)

  const gruposPatrimonio = ordenarLado(agruparLado(['capital'], -1), ['patrimonio'])
  const resultado = renglonesDeResultado(actual, comparado, catalogos)
  const principal = grupoDe(gruposPatrimonio, 'patrimonio')
  // El resultado se presenta dentro del grupo de patrimonio, detrás de sus
  // renglones: es patrimonio ganado aunque todavía no viva en una cuenta de él.
  const conTotales = (
    grupo: GrupoPresentacion | null,
    renglones: readonly RenglonPresentado[],
  ): GrupoPresentado => ({
    grupo,
    renglones,
    total: aTexto(sumar(renglones.map((r) => r.importe))),
    comparado: comparando
      ? aTexto(sumar(renglones.map((r) => r.comparado ?? '0')))
      : null,
  })
  const conResultado: GrupoPresentado[] = [
    conTotales('patrimonio', [...(principal?.renglones ?? []), ...resultado]),
    ...gruposPatrimonio.filter((g) => g.grupo !== 'patrimonio'),
  ]
  const patrimonio = lado(conResultado, comparando)

  const totalPasivoPatrimonio = new Decimal(pasivo.total).plus(patrimonio.total)
  const diferencia = new Decimal(activo.total).minus(totalPasivoPatrimonio)

  return {
    activo,
    pasivo,
    patrimonio,
    totalPasivoPatrimonio: aTexto(totalPasivoPatrimonio),
    totalPasivoPatrimonioComparado: comparando
      ? aTexto(new Decimal(pasivo.comparado!).plus(patrimonio.comparado!))
      : null,
    diferencia: aTexto(diferencia),
    cuadra: diferencia.isZero(),
    haySinClasificar: [activo, pasivo, patrimonio].some((l) =>
      l.grupos.some((g) => g.renglones.some((r) => r.sinClasificar)),
    ),
  }
}

/* ----------------------------------------------------- Estado de Resultados */

/**
 * Un bloque del Estado de Resultados, en el orden en que se lee.
 *
 * Los subtotales van intercalados entre las secciones y no al final porque ese
 * es el estado: "utilidad bruta" solo significa algo leída justo debajo del
 * costo de ventas.
 */
export type BloqueResultados =
  | { readonly tipo: 'grupo'; readonly grupo: GrupoPresentado }
  | {
      readonly tipo: 'subtotal'
      readonly clave: string
      readonly etiqueta: string
      readonly importe: string
      readonly comparado: string | null
      /** La utilidad neta: la última línea, la que se subraya dos veces. */
      readonly final: boolean
    }

export interface EstadoResultados {
  readonly bloques: readonly BloqueResultados[]
  readonly utilidadNeta: string
  readonly utilidadNetaComparada: string | null
  readonly haySinClasificar: boolean
}

/**
 * Dónde se corta cada subtotal: después del último grupo que lo compone.
 *
 * Las cuentas sin clasificar suman antes de impuestos y no después: su
 * naturaleza es desconocida, y ponerlas en la utilidad bruta la falsearía más
 * que dejarlas junto a los otros resultados.
 */
const SUBTOTALES: readonly {
  clave: string
  etiqueta: string
  despues: GrupoPresentacion | 'sin-clasificar'
}[] = [
  { clave: 'utilidad-bruta', etiqueta: 'Utilidad bruta', despues: 'costo_ventas' },
  {
    clave: 'utilidad-operacion',
    etiqueta: 'Utilidad de operación',
    despues: 'gastos_operacion',
  },
  {
    clave: 'utilidad-antes-impuestos',
    etiqueta: 'Utilidad antes de impuestos',
    despues: 'sin-clasificar',
  },
  { clave: 'utilidad-neta', etiqueta: 'Utilidad neta', despues: 'impuesto_renta' },
]

/**
 * Estado de Resultados de un intervalo.
 *
 * `movimientos` es lo que cada cuenta se movió en el intervalo, en convención
 * deudor positivo, sin el asiento de cierre del ejercicio (que lo llevaría todo
 * a cero). Cada renglón se presenta por su efecto en la utilidad: los ingresos
 * en positivo y los costos y gastos en negativo, de modo que un renglón que
 * reúne ganancias y pérdidas cambiarias se presenta neto y con su signo real.
 */
export function construirEstadoResultados(
  movimientos: Importes,
  comparado: Importes | null,
  catalogos: Catalogos,
): EstadoResultados {
  const comparando = comparado !== null
  const grupos = agrupar(movimientos, comparado, catalogos, {
    estado: 'resultados',
    tipos: TIPOS_RESULTADO,
    signo: -1,
  })

  const bloques: BloqueResultados[] = []
  let acumulado = CERO
  let acumuladoComparado = CERO

  const secuencia: (GrupoPresentacion | 'sin-clasificar')[] = [
    ...GRUPOS_POR_ESTADO.resultados.filter((g) => g !== 'impuesto_renta'),
    'sin-clasificar',
    'impuesto_renta',
  ]

  for (const paso of secuencia) {
    const grupo = grupoDe(grupos, paso === 'sin-clasificar' ? null : paso)
    if (grupo) {
      bloques.push({ tipo: 'grupo', grupo })
      acumulado = acumulado.plus(grupo.total)
      acumuladoComparado = acumuladoComparado.plus(grupo.comparado ?? '0')
    }
    for (const subtotal of SUBTOTALES.filter((s) => s.despues === paso)) {
      bloques.push({
        tipo: 'subtotal',
        clave: subtotal.clave,
        etiqueta: subtotal.etiqueta,
        importe: aTexto(acumulado),
        comparado: comparando ? aTexto(acumuladoComparado) : null,
        final: subtotal.clave === 'utilidad-neta',
      })
    }
  }

  return {
    bloques,
    utilidadNeta: aTexto(acumulado),
    utilidadNetaComparada: comparando ? aTexto(acumuladoComparado) : null,
    haySinClasificar: grupos.some((g) => g.grupo === null),
  }
}

/**
 * Movimientos de un intervalo a partir de dos cortes.
 *
 * Se exporta para que la pantalla arme el "acumulado del ejercicio" con los
 * mismos saldos que usa el balance, sin sumar mes a mes.
 */
export function movimientosEntre(fin: Importes, inicio: Importes): Importes {
  return variacion(fin, inicio)
}
