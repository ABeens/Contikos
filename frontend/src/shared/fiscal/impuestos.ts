import type { TarifaImpuesto } from '@/shared/api/contracts/impuestos'
import {
  TARIFAS_IVA,
  TARIFA_POR_CODIGO,
  type IdTarifaIva,
  type ResolverTarifa,
  type TarifaResuelta,
} from './iva'

/**
 * Vigencia de la tabla de impuestos (docs/13, advertencia inicial).
 *
 * Funciones puras sobre la tabla que sirve la API. Las usan el seed y el
 * handler del mock (que hacen de servidor), los hooks (que filtran lo que se
 * ofrece al capturar) y el dominio de las facturas (que valida y calcula por
 * la fecha del documento). Una sola definición de "vigente a una fecha" para
 * que el mock, la pantalla y el backend no discrepen en un día de diferencia.
 */

/** ¿Rige la tarifa en esa fecha? Los extremos son inclusivos. */
export function vigenteEn(tarifa: TarifaImpuesto, fecha: string): boolean {
  if (fecha < tarifa.vigenteDesde) return false
  if (tarifa.vigenteHasta !== null && fecha > tarifa.vigenteHasta) return false
  return true
}

/** Las que rigen a una fecha, activas o no. */
export function tarifasVigentesEn(
  tarifas: readonly TarifaImpuesto[],
  fecha: string,
): TarifaImpuesto[] {
  return tarifas.filter((t) => vigenteEn(t, fecha))
}

/** La fila del código que rige a esa fecha. */
export function tarifaVigente(
  tarifas: readonly TarifaImpuesto[],
  codigo: IdTarifaIva,
  fecha: string,
): TarifaImpuesto | undefined {
  return tarifas.find((t) => t.codigo === codigo && vigenteEn(t, fecha))
}

/** Proyecta la fila de la tabla a lo que el cálculo necesita. */
export function aTarifaResuelta(tarifa: TarifaImpuesto): TarifaResuelta {
  return {
    codigo: tarifa.codigo,
    nombre: tarifa.nombre,
    porcentaje: tarifa.porcentaje,
    generaImpuesto: tarifa.generaImpuesto,
  }
}

/**
 * Resolutor por código para una fecha dada.
 *
 * Es lo que se le pasa a `calcularImpuestoLinea`: la fecha se fija una vez,
 * al construirlo, y todas las líneas del documento se resuelven contra la
 * misma tabla.
 */
export function resolutorDe(
  tarifas: readonly TarifaImpuesto[],
  fecha: string,
): ResolverTarifa {
  return (codigo) => {
    const fila = tarifaVigente(tarifas, codigo, fecha)
    return fila ? aTarifaResuelta(fila) : undefined
  }
}

/** Lo mínimo que un selector de tarifa necesita pintar. */
export interface OpcionTarifa {
  readonly codigo: string
  readonly nombre: string
}

/**
 * Tarifas que se ofrecen al capturar una línea.
 *
 * Recibe las que ya rigen a la fecha del documento (el hook las pide por esa
 * fecha) y descarta las inactivas: una tarifa que existe pero ya no se usa
 * sigue nombrando documentos viejos, pero no se puede elegir en uno nuevo.
 *
 * Mientras la tabla de la empresa no ha llegado se cae a la tabla por
 * defecto, para que el selector se pueda pintar desde el primer render. Lo
 * que se guarda es el código, que es el mismo en las dos tablas.
 */
export function opcionesTarifa(
  tarifas: readonly TarifaImpuesto[],
): readonly OpcionTarifa[] {
  const activas = tarifas.filter((t) => t.activa)
  return activas.length > 0 ? activas : TARIFAS_IVA
}

/**
 * Nombre para pantalla de un código de tarifa.
 *
 * Busca en la tabla (cualquier vigencia), cae a la tabla por defecto y, si
 * nada lo conoce, enseña el código: una factura vieja con una tarifa que ya
 * no existe se tiene que seguir leyendo.
 */
export function nombreTarifa(
  tarifas: readonly TarifaImpuesto[],
  codigo: IdTarifaIva,
  fecha?: string,
): string {
  const fila =
    (fecha ? tarifaVigente(tarifas, codigo, fecha) : undefined) ??
    tarifas.find((t) => t.codigo === codigo)
  return fila?.nombre ?? TARIFA_POR_CODIGO[codigo]?.nombre ?? codigo
}
