import Decimal from 'decimal.js'
import type {
  ClasificacionNiifBase,
  Cuenta,
  EstadoFinanciero,
  GrupoPresentacion,
  NotaEeffBase,
  TipoCuenta,
} from '@/shared/api/contracts/conta'
import { CERO, aTexto, importeDe, type Importes } from './saldos'

/**
 * Cómo se agrupan las cuentas en renglones y los renglones en grupos.
 *
 * Es la parte común a todos los estados que se arman sobre la clasificación
 * NIIF (docs/03 §2 bis): el catálogo de cuentas dice dónde se registra, la
 * clasificación dice dónde se presenta, y este archivo solo junta las dos
 * cosas. No decide nada contable: el importe de cada cuenta llega calculado y
 * el signo con que se presenta lo pone quien llama.
 */

export interface Catalogos {
  readonly cuentas: readonly Cuenta[]
  readonly clasificaciones: readonly ClasificacionNiifBase[]
  readonly notas: readonly NotaEeffBase[]
}

/** Una cuenta dentro de un renglón: el último escalón antes del mayor. */
export interface CuentaPresentada {
  readonly codigo: string
  readonly nombre: string
  readonly importe: string
  /** Importe del periodo con el que se compara. Nulo si no se compara. */
  readonly comparado: string | null
}

/** Un renglón del estado: una clasificación NIIF, o un renglón calculado. */
export interface RenglonPresentado {
  /** Estable entre renders y entre los dos periodos que se comparan. */
  readonly clave: string
  /** Código de la clasificación. Nulo en los renglones calculados. */
  readonly codigo: string | null
  readonly nombre: string
  /** Referencias de las notas que lo desglosan, en orden: `1a`, `1b`. */
  readonly notas: readonly string[]
  readonly importe: string
  readonly comparado: string | null
  readonly cuentas: readonly CuentaPresentada[]
  /**
   * Cuentas con saldo que no tienen un renglón válido en este estado.
   *
   * No se esconden: un saldo que desaparece del reporte deja la balanza
   * cuadrando y el estado equivocado, que es la peor forma de fallar. Se
   * presentan aparte y marcadas, para que se vean y se clasifiquen.
   */
  readonly sinClasificar: boolean
}

export interface GrupoPresentado {
  /** Nulo en el grupo de cuentas sin clasificar. */
  readonly grupo: GrupoPresentacion | null
  readonly renglones: readonly RenglonPresentado[]
  readonly total: string
  readonly comparado: string | null
}

/** Qué cuentas entran y con qué signo se presentan. */
export interface OpcionesAgrupar {
  readonly estado: EstadoFinanciero
  readonly tipos: readonly TipoCuenta[]
  /**
   * 1 presenta el saldo deudor en positivo (activo, gastos); -1 el acreedor
   * (pasivo, patrimonio, ingresos). Se aplica igual a todas las cuentas del
   * lado: una cuenta de naturaleza contraria resta, que es lo que tiene que
   * hacer la depreciación acumulada dentro del activo.
   */
  readonly signo: 1 | -1
}

export function referenciaNota(nota: Pick<NotaEeffBase, 'numero' | 'literal'>) {
  return `${nota.numero}${nota.literal}`
}

const CLAVE_SIN_CLASIFICAR = 'sin-clasificar'

/**
 * Reparte las cuentas de detalle en renglones y los renglones en grupos.
 *
 * Una cuenta cae en su clasificación solo si esa clasificación es del estado
 * que se arma y tiene grupo. Si no, cae en "sin clasificar": una cuenta de
 * activo clasificada por error en un renglón del Estado de Resultados no puede
 * sumar en el Balance como si nada, pero tampoco puede desaparecer de él.
 *
 * Una cuenta sin importe en ninguno de los dos periodos no se enseña. Un
 * renglón sin cuentas tampoco: el estado financiero presenta saldos, no el
 * catálogo entero.
 */
export function agrupar(
  actual: Importes,
  comparado: Importes | null,
  catalogos: Catalogos,
  opciones: OpcionesAgrupar,
): GrupoPresentado[] {
  const { estado, tipos, signo } = opciones
  const clasificacionPorId = new Map(
    catalogos.clasificaciones.map((c) => [c.id, c]),
  )

  const porRenglon = new Map<
    string,
    { clasificacion: ClasificacionNiifBase | null; cuentas: CuentaPresentada[] }
  >()

  for (const cuenta of catalogos.cuentas) {
    if (!cuenta.esDetalle || !tipos.includes(cuenta.tipo)) continue
    const importe = importeDe(actual, cuenta.codigo).times(signo)
    const otro = comparado
      ? importeDe(comparado, cuenta.codigo).times(signo)
      : null
    if (importe.isZero() && (otro === null || otro.isZero())) continue

    const clasificacion = cuenta.clasificacionNiifId
      ? clasificacionPorId.get(cuenta.clasificacionNiifId)
      : undefined
    const valida =
      clasificacion &&
      clasificacion.estadoFinanciero === estado &&
      clasificacion.grupo !== null
        ? clasificacion
        : null

    const clave = valida?.id ?? CLAVE_SIN_CLASIFICAR
    let renglon = porRenglon.get(clave)
    if (!renglon) {
      renglon = { clasificacion: valida, cuentas: [] }
      porRenglon.set(clave, renglon)
    }
    renglon.cuentas.push({
      codigo: cuenta.codigo,
      nombre: cuenta.nombre,
      importe: aTexto(importe),
      comparado: otro === null ? null : aTexto(otro),
    })
  }

  const ordenados = [...porRenglon.entries()].sort(([, a], [, b]) => {
    // Lo que no tiene renglón va al final: es lo que hay que ir a arreglar.
    const ordenA = a.clasificacion?.orden ?? Number.MAX_SAFE_INTEGER
    const ordenB = b.clasificacion?.orden ?? Number.MAX_SAFE_INTEGER
    return ordenA - ordenB
  })

  const grupos = new Map<GrupoPresentacion | null, RenglonPresentado[]>()
  for (const [clave, { clasificacion, cuentas }] of ordenados) {
    const grupo = clasificacion?.grupo ?? null
    const lista = grupos.get(grupo) ?? []
    lista.push({
      clave,
      codigo: clasificacion?.codigo ?? null,
      nombre: clasificacion?.nombre ?? 'Cuentas sin clasificar en este estado',
      notas: clasificacion ? notasDe(clasificacion.id, cuentas, catalogos) : [],
      importe: aTexto(sumar(cuentas.map((c) => c.importe))),
      comparado: comparado
        ? aTexto(sumar(cuentas.map((c) => c.comparado ?? '0')))
        : null,
      cuentas,
      sinClasificar: clasificacion === null,
    })
    grupos.set(grupo, lista)
  }

  return [...grupos.entries()].map(([grupo, lista]) => ({
    grupo,
    renglones: lista,
    total: aTexto(sumar(lista.map((r) => r.importe))),
    comparado: comparado
      ? aTexto(sumar(lista.map((r) => r.comparado ?? '0')))
      : null,
  }))
}

/**
 * Notas que citan el renglón: las de las cuentas que de verdad suman en él.
 *
 * Un renglón con dos notas (1a caja, 1b bancos) que este mes solo tiene saldo
 * en bancos cita solo la 1b: "véase nota 1a" apuntaría a un desglose vacío.
 */
export function notasDe(
  clasificacionId: string,
  cuentas: readonly CuentaPresentada[],
  catalogos: Catalogos,
): string[] {
  const codigos = new Set(cuentas.map((c) => c.codigo))
  const idsNota = new Set(
    catalogos.cuentas
      .filter((c) => codigos.has(c.codigo) && c.notaEeffId)
      .map((c) => c.notaEeffId!),
  )
  return catalogos.notas
    .filter((n) => n.clasificacionNiifId === clasificacionId && idsNota.has(n.id))
    .sort((a, b) => a.numero - b.numero || a.literal.localeCompare(b.literal))
    .map(referenciaNota)
}

export function sumar(valores: readonly string[]): Decimal {
  return valores.reduce((acc, v) => acc.plus(new Decimal(v)), CERO)
}

/** Busca un grupo por su clave; vacío si el estado no trae ninguno. */
export function grupoDe(
  grupos: readonly GrupoPresentado[],
  grupo: GrupoPresentacion | null,
): GrupoPresentado | undefined {
  return grupos.find((g) => g.grupo === grupo)
}

export function totalDe(
  grupos: readonly GrupoPresentado[],
  campo: 'total' | 'comparado',
): Decimal {
  return sumar(grupos.map((g) => g[campo] ?? '0'))
}
