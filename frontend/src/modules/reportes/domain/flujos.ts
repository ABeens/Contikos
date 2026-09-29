import Decimal from 'decimal.js'
import type {
  ClasificacionNiifBase,
  Cuenta,
} from '@/shared/api/contracts/conta'
import { esCuentaDeEfectivo } from '@/shared/cuentas/efectivo'
import type { Catalogos, CuentaPresentada, RenglonPresentado } from './presentacion'
import { notasDe, sumar } from './presentacion'
import { resultadoDe } from './estados'
import { CERO, aTexto, importeDe, variacion, type Importes } from './saldos'

/**
 * Estado de Flujos de Efectivo por el método indirecto (docs/09 §3.4).
 *
 * Parte de la utilidad neta y explica la variación del efectivo con la
 * variación de todas las demás cuentas del balance. No hay que adivinar nada:
 * por partida doble, todo lo que movió el efectivo movió también otra cuenta,
 * así que la variación de caja y bancos es exactamente la utilidad más el
 * efecto de las demás variaciones. Por eso la verificación es dura y se hace
 * aquí, no se supone (docs/17 §4).
 *
 * Cómo se clasifica cada cuenta sale del grupo de su renglón en el balance:
 *
 * | Grupo del renglón                | Actividad                                |
 * |---|---|
 * | Activo corriente (sin efectivo)  | Operación: capital de trabajo            |
 * | Pasivo corriente                 | Operación: capital de trabajo            |
 * | Activo no corriente, saldo deudor | Inversión                               |
 * | Activo no corriente, saldo acreedor | Operación: partida que no es efectivo (depreciación acumulada) |
 * | Pasivo no corriente, patrimonio  | Financiamiento                           |
 *
 * La depreciación acumulada es la excepción que merece regla: es una cuenta de
 * activo no corriente, pero su aumento no es una venta de activos sino el gasto
 * que no salió de caja, que es justo lo que el método indirecto devuelve a la
 * utilidad.
 */

export type Actividad = 'operacion' | 'inversion' | 'financiamiento'

export interface SeccionFlujo {
  readonly actividad: Actividad
  readonly titulo: string
  readonly renglones: readonly RenglonPresentado[]
  readonly total: string
}

export interface EstadoFlujos {
  readonly utilidadNeta: string
  /** Partidas que no movieron efectivo y cambios en el capital de trabajo. */
  readonly operacion: SeccionFlujo
  readonly inversion: SeccionFlujo
  readonly financiamiento: SeccionFlujo
  /** Operación, con la utilidad incluida. */
  readonly totalOperacion: string
  /** Lo que el estado dice que se movió el efectivo. */
  readonly variacionCalculada: string
  readonly efectivoInicial: string
  readonly efectivoFinal: string
  /** Lo que de verdad se movió el efectivo según sus saldos. */
  readonly variacionReal: string
  readonly diferencia: string
  readonly cuadra: boolean
  readonly haySinClasificar: boolean
}

interface Destino {
  readonly actividad: Actividad
  /** Clave del renglón dentro de su actividad. */
  readonly clave: string
  readonly nombre: string
  readonly clasificacion: ClasificacionNiifBase | null
  readonly sinClasificar: boolean
}

const TIPOS_BALANCE = ['activo', 'pasivo', 'capital'] as const

function destinoDe(
  cuenta: Cuenta,
  clasificacion: ClasificacionNiifBase | undefined,
): Destino {
  const valida =
    clasificacion?.estadoFinanciero === 'situacion' && clasificacion.grupo
      ? clasificacion
      : null

  if (!valida) {
    // Sin renglón no se sabe a qué actividad pertenece. Se presenta en
    // operación, marcada: es donde el efecto se nota menos mal, y la marca
    // dice que hay que ir a clasificarla.
    return {
      actividad: 'operacion',
      clave: 'sin-clasificar',
      nombre: 'Variación de cuentas sin clasificar',
      clasificacion: null,
      sinClasificar: true,
    }
  }

  switch (valida.grupo) {
    case 'activo_no_corriente':
      return cuenta.naturaleza === 'acreedora'
        ? {
            actividad: 'operacion',
            clave: `no-efectivo:${valida.id}`,
            nombre: `Depreciación y amortización: ${valida.nombre.toLowerCase()}`,
            clasificacion: valida,
            sinClasificar: false,
          }
        : {
            actividad: 'inversion',
            clave: valida.id,
            nombre: `Adquisición y venta: ${valida.nombre.toLowerCase()}`,
            clasificacion: valida,
            sinClasificar: false,
          }
    case 'pasivo_no_corriente':
    case 'patrimonio':
      return {
        actividad: 'financiamiento',
        clave: valida.id,
        nombre: valida.nombre,
        clasificacion: valida,
        sinClasificar: false,
      }
    default:
      return {
        actividad: 'operacion',
        clave: valida.id,
        nombre: `Variación en ${valida.nombre.toLowerCase()}`,
        clasificacion: valida,
        sinClasificar: false,
      }
  }
}

const TITULOS: Record<Actividad, string> = {
  operacion: 'Actividades de operación',
  inversion: 'Actividades de inversión',
  financiamiento: 'Actividades de financiamiento',
}

/**
 * Construye el estado para un intervalo.
 *
 * `inicio` y `fin` son los saldos de todas las cuentas de detalle al abrir y al
 * cerrar el intervalo, deudor positivo, los dos sin el asiento de cierre del
 * ejercicio: ese asiento no mueve efectivo y, contado, convertiría la utilidad
 * del año en un "aumento de patrimonio" de financiamiento.
 */
export function construirEstadoFlujos(
  inicio: Importes,
  fin: Importes,
  catalogos: Catalogos,
): EstadoFlujos {
  const delta = variacion(fin, inicio)
  const clasificacionPorId = new Map(
    catalogos.clasificaciones.map((c) => [c.id, c]),
  )

  const renglones = new Map<string, { destino: Destino; cuentas: CuentaPresentada[] }>()
  let efectivoInicial = CERO
  let efectivoFinal = CERO

  for (const cuenta of catalogos.cuentas) {
    if (!cuenta.esDetalle) continue
    if (!(TIPOS_BALANCE as readonly string[]).includes(cuenta.tipo)) continue

    if (esCuentaDeEfectivo(cuenta)) {
      efectivoInicial = efectivoInicial.plus(importeDe(inicio, cuenta.codigo))
      efectivoFinal = efectivoFinal.plus(importeDe(fin, cuenta.codigo))
      continue
    }

    const cambio = importeDe(delta, cuenta.codigo)
    if (cambio.isZero()) continue

    const destino = destinoDe(
      cuenta,
      cuenta.clasificacionNiifId
        ? clasificacionPorId.get(cuenta.clasificacionNiifId)
        : undefined,
    )
    const clave = `${destino.actividad}:${destino.clave}`
    let renglon = renglones.get(clave)
    if (!renglon) {
      renglon = { destino, cuentas: [] }
      renglones.set(clave, renglon)
    }
    // Efecto en caja: que un activo crezca consume efectivo, que un pasivo
    // crezca (más acreedor, más negativo en deudor positivo) lo aporta.
    renglon.cuentas.push({
      codigo: cuenta.codigo,
      nombre: cuenta.nombre,
      importe: aTexto(cambio.negated()),
      comparado: null,
    })
  }

  const seccion = (actividad: Actividad): SeccionFlujo => {
    const lista: RenglonPresentado[] = [...renglones.values()]
      .filter((r) => r.destino.actividad === actividad)
      .sort((a, b) => ordenDe(a.destino) - ordenDe(b.destino))
      .map(({ destino, cuentas }) => ({
        clave: destino.clave,
        codigo: destino.clasificacion?.codigo ?? null,
        nombre: destino.nombre,
        notas: destino.clasificacion
          ? notasDe(destino.clasificacion.id, cuentas, catalogos)
          : [],
        importe: aTexto(sumar(cuentas.map((c) => c.importe))),
        comparado: null,
        cuentas,
        sinClasificar: destino.sinClasificar,
      }))
    return {
      actividad,
      titulo: TITULOS[actividad],
      renglones: lista,
      total: aTexto(sumar(lista.map((r) => r.importe))),
    }
  }

  const utilidadNeta = resultadoDe(delta, catalogos)
  const operacion = seccion('operacion')
  const inversion = seccion('inversion')
  const financiamiento = seccion('financiamiento')
  const totalOperacion = utilidadNeta.plus(operacion.total)
  const variacionCalculada = totalOperacion
    .plus(inversion.total)
    .plus(financiamiento.total)
  const variacionReal = efectivoFinal.minus(efectivoInicial)
  const diferencia = variacionReal.minus(variacionCalculada)

  return {
    utilidadNeta: aTexto(utilidadNeta),
    operacion,
    inversion,
    financiamiento,
    totalOperacion: aTexto(totalOperacion),
    variacionCalculada: aTexto(variacionCalculada),
    efectivoInicial: aTexto(efectivoInicial),
    efectivoFinal: aTexto(efectivoFinal),
    variacionReal: aTexto(variacionReal),
    diferencia: aTexto(diferencia),
    cuadra: diferencia.isZero(),
    haySinClasificar: [operacion, inversion, financiamiento].some((s) =>
      s.renglones.some((r) => r.sinClasificar),
    ),
  }
}

/**
 * Dentro de operación, primero lo que no es efectivo y después el capital de
 * trabajo, que es como se lee el método indirecto. Lo sin clasificar al final.
 */
function ordenDe(destino: Destino): number {
  if (destino.sinClasificar) return Number.MAX_SAFE_INTEGER
  const base = destino.clasificacion?.orden ?? 0
  return destino.clave.startsWith('no-efectivo:') ? base - 1_000_000 : base
}

/** Útil para la prueba de invariante: el efectivo no depende de la clasificación. */
export function variacionDeEfectivo(
  inicio: Importes,
  fin: Importes,
  cuentas: readonly Cuenta[],
): Decimal {
  return cuentas
    .filter(esCuentaDeEfectivo)
    .reduce(
      (acc, c) => acc.plus(importeDe(fin, c.codigo)).minus(importeDe(inicio, c.codigo)),
      CERO,
    )
}
