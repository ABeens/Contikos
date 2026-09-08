import type { TarifaImpuesto } from '@/shared/api/contracts/impuestos'
import { TARIFAS_IVA } from '@/shared/fiscal/iva'
import {
  resolutorDe,
  tarifaVigente,
  tarifasVigentesEn,
} from '@/shared/fiscal/impuestos'
import { tabla } from '@/shared/almacen/almacen'

/**
 * Tabla de impuestos de la empresa (docs/13 §3).
 *
 * Se siembra desde la tabla por defecto de `shared/fiscal/iva`, con la
 * vigencia de la Ley 9635: todas las tarifas rigen desde el 1 de julio de
 * 2019 y ninguna tiene fin. Es la misma para todas las empresas del grupo
 * porque la ley es la misma; lo que cada empresa puede hacer después es
 * cerrar una vigencia y abrir otra cuando cambie el reglamento.
 *
 * Se declara ANTES que las facturas: la semilla de facturas resuelve la
 * tarifa de cada línea por la fecha de emisión contra esta tabla.
 */

/** Entrada en vigor del IVA (Ley 9635). */
export const VIGENCIA_IVA_INICIAL = '2019-07-01'

export const TARIFAS_IMPUESTO_SEED: readonly TarifaImpuesto[] = TARIFAS_IVA.map(
  (t) => ({
    id: idDeTarifa(t.codigo, VIGENCIA_IVA_INICIAL),
    codigo: t.codigo,
    nombre: t.nombre,
    tipo: 'iva',
    porcentaje: t.porcentaje,
    vigenteDesde: VIGENCIA_IVA_INICIAL,
    vigenteHasta: null,
    activa: true,
    codigoHacienda: t.codigoHacienda,
    generaImpuesto: t.generaImpuesto,
  }),
)

const tablaImpuestos = tabla<TarifaImpuesto>('config.impuestos', () =>
  TARIFAS_IMPUESTO_SEED.map((t) => ({ ...t })),
)

export const tarifasImpuestoMock: TarifaImpuesto[] = tablaImpuestos.filas

export function persistirTarifasImpuesto(): void {
  tablaImpuestos.persistir()
}

/**
 * Id estable a partir del código y el inicio de vigencia.
 *
 * Una tarifa que cambia de tasa es otra fila con otra vigencia, y su id lo
 * dice: `imp-general-2019`, `imp-general-2027`.
 */
export function idDeTarifa(codigo: string, vigenteDesde: string): string {
  const raiz = codigo.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `imp-${raiz}-${vigenteDesde.slice(0, 4)}`
}

export function siguienteIdTarifa(codigo: string, vigenteDesde: string): string {
  let candidato = idDeTarifa(codigo, vigenteDesde)
  let sufijo = 2
  while (tarifasImpuestoMock.some((t) => t.id === candidato)) {
    candidato = `${idDeTarifa(codigo, vigenteDesde)}-${sufijo}`
    sufijo += 1
  }
  return candidato
}

/** Las que rigen a la fecha, activas o no. */
export function tarifasVigentes(fecha: string): TarifaImpuesto[] {
  return tarifasVigentesEn(tarifasImpuestoMock, fecha)
}

/** La fila de ese código que rige a la fecha. */
export function tarifaPorCodigo(
  codigo: string,
  fecha: string,
): TarifaImpuesto | undefined {
  return tarifaVigente(tarifasImpuestoMock, codigo, fecha)
}

/** Resolutor para calcular un documento emitido en esa fecha. */
export function resolutorImpuestos(fecha: string) {
  return resolutorDe(tarifasImpuestoMock, fecha)
}
