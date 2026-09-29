import Decimal from 'decimal.js'
import type { Catalogos } from './presentacion'
import { resultadoDe } from './estados'
import { CERO, aTexto, importeDe, variacion, type Importes } from './saldos'

/**
 * Estado de Cambios en el Patrimonio (docs/09 §3.5).
 *
 * Una columna por renglón de patrimonio del Balance, más la del resultado del
 * ejercicio, y una fila por cada cosa que movió el patrimonio en el ejercicio.
 * El saldo final de cada columna es el que enseña el Balance a la misma fecha:
 * es la misma cifra por dos caminos, y la prueba lo comprueba.
 *
 * El asiento de cierre del ejercicio va en su propia fila, y es la razón de que
 * se pidan dos cortes al final (con y sin él): es el movimiento que traslada la
 * utilidad del año de la columna del resultado a la de resultados acumulados,
 * y confundido con "otros movimientos" haría parecer que alguien capitalizó a
 * mano lo que en realidad cerró el ejercicio.
 */

export interface ColumnaPatrimonio {
  readonly clave: string
  readonly nombre: string
  /** Código de la clasificación. Nulo en las columnas calculadas. */
  readonly codigo: string | null
}

export type FilaClave =
  | 'saldo-inicial'
  | 'resultado'
  | 'movimientos'
  | 'cierre'
  | 'saldo-final'

export interface FilaPatrimonio {
  readonly clave: FilaClave
  readonly concepto: string
  /** Importe por clave de columna. */
  readonly importes: Readonly<Record<string, string>>
  readonly total: string
}

export interface EstadoPatrimonio {
  readonly columnas: readonly ColumnaPatrimonio[]
  readonly filas: readonly FilaPatrimonio[]
  readonly totalFinal: string
}

export interface CortesPatrimonio {
  /** Saldos al abrir el ejercicio. */
  readonly inicio: Importes
  /** Saldos al corte, sin el asiento de cierre del ejercicio. */
  readonly finSinCierre: Importes
  /** Saldos al corte, con todo. Es lo que presenta el Balance. */
  readonly finConCierre: Importes
}

const COLUMNA_RESULTADO = 'resultado-ejercicio'
const COLUMNA_SIN_CLASIFICAR = 'sin-clasificar'

export function construirEstadoPatrimonio(
  cortes: CortesPatrimonio,
  catalogos: Catalogos,
): EstadoPatrimonio {
  const clasificacionPorId = new Map(
    catalogos.clasificaciones.map((c) => [c.id, c]),
  )

  // Columna de cada cuenta de patrimonio: su renglón del Balance si lo tiene.
  const columnaDe = new Map<string, string>()
  const columnas = new Map<string, ColumnaPatrimonio & { orden: number }>()
  for (const cuenta of catalogos.cuentas) {
    if (!cuenta.esDetalle || cuenta.tipo !== 'capital') continue
    const c = cuenta.clasificacionNiifId
      ? clasificacionPorId.get(cuenta.clasificacionNiifId)
      : undefined
    const valida = c && c.estadoFinanciero === 'situacion' && c.grupo === 'patrimonio'
    const clave = valida ? c.id : COLUMNA_SIN_CLASIFICAR
    columnaDe.set(cuenta.codigo, clave)
    if (!columnas.has(clave)) {
      columnas.set(clave, {
        clave,
        nombre: valida ? c.nombre : 'Sin clasificar',
        codigo: valida ? c.codigo : null,
        orden: valida ? c.orden : Number.MAX_SAFE_INTEGER,
      })
    }
  }

  const porColumna = (importes: Importes): Map<string, Decimal> => {
    const mapa = new Map<string, Decimal>()
    for (const [codigo, clave] of columnaDe) {
      // Patrimonio se presenta acreedor positivo.
      const valor = importeDe(importes, codigo).negated()
      mapa.set(clave, (mapa.get(clave) ?? CERO).plus(valor))
    }
    return mapa
  }

  const movimientos = variacion(cortes.finSinCierre, cortes.inicio)
  const cierre = variacion(cortes.finConCierre, cortes.finSinCierre)

  const saldoInicial = porColumna(cortes.inicio)
  saldoInicial.set(COLUMNA_RESULTADO, resultadoDe(cortes.inicio, catalogos))

  const resultado = new Map([[COLUMNA_RESULTADO, resultadoDe(movimientos, catalogos)]])

  const otros = porColumna(movimientos)

  const traspaso = porColumna(cierre)
  traspaso.set(COLUMNA_RESULTADO, resultadoDe(cierre, catalogos))

  const saldoFinal = porColumna(cortes.finConCierre)
  saldoFinal.set(COLUMNA_RESULTADO, resultadoDe(cortes.finConCierre, catalogos))

  const listaColumnas: ColumnaPatrimonio[] = [
    ...[...columnas.values()]
      .sort((a, b) => a.orden - b.orden)
      .map(({ clave, nombre, codigo }) => ({ clave, nombre, codigo })),
    { clave: COLUMNA_RESULTADO, nombre: 'Resultado del ejercicio', codigo: null },
  ]

  const fila = (
    clave: FilaClave,
    concepto: string,
    valores: Map<string, Decimal>,
  ): FilaPatrimonio => {
    const importes: Record<string, string> = {}
    let total = CERO
    for (const columna of listaColumnas) {
      const valor = valores.get(columna.clave) ?? CERO
      importes[columna.clave] = aTexto(valor)
      total = total.plus(valor)
    }
    return { clave, concepto, importes, total: aTexto(total) }
  }

  const filas: FilaPatrimonio[] = [
    fila('saldo-inicial', 'Saldo al inicio del ejercicio', saldoInicial),
    fila('resultado', 'Resultado del ejercicio', resultado),
    fila(
      'movimientos',
      'Aportes, distribuciones y otros movimientos',
      otros,
    ),
  ]
  // Solo si hubo cierre en el intervalo: una fila entera de ceros el resto
  // del año no informa de nada.
  if ([...traspaso.values()].some((v) => !v.isZero())) {
    filas.push(fila('cierre', 'Cierre del ejercicio', traspaso))
  }
  filas.push(fila('saldo-final', 'Saldo al final', saldoFinal))

  return {
    columnas: listaColumnas,
    filas,
    totalFinal: filas[filas.length - 1].total,
  }
}
