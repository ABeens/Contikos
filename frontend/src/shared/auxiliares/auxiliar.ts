import type { AuxiliarTipo } from '@/shared/api/contracts/comunes'

/**
 * Ficha de auxiliar, normalizada.
 *
 * Cada tipo de auxiliar vive en su propio catálogo y con sus propios campos: un
 * cliente tiene razón social, un activo tiene nombre, y el día que exista rh un
 * empleado tendrá otro. Quien captura un asiento no necesita esa diferencia:
 * busca por código o por nombre y elige uno. Esta forma común es lo que permite
 * que el buscador sea uno solo (docs/14 §3.1: la pantalla de conta no importa
 * nada de cxc ni de activos).
 *
 * `id` es lo que viaja en el asiento (`auxiliarId` de docs/02 §3); `codigo` es
 * lo que el usuario conoce. Nunca se piden al usuario el mismo: teclear
 * `cli-001` no es capturar contabilidad.
 */
export interface Auxiliar {
  tipo: AuxiliarTipo
  /** Identificador interno: es el que se contabiliza. */
  id: string
  /** Código visible del catálogo (C-001, P-014, ACT-008). */
  codigo: string
  nombre: string
  /**
   * Cédula del tercero, si el tipo la tiene (clientes y proveedores).
   *
   * Es lo que trae impreso el documento que se está contabilizando, y quien
   * captura muchas veces la tiene delante antes que el código o el nombre.
   * Un activo no tiene.
   */
  identificacion?: string
  /** Inactivo: se sigue resolviendo, pero ya no se ofrece. */
  activo: boolean
}

/**
 * Tipos con catálogo consultable hoy.
 *
 * `empleado` y `banco` los exigen cuentas de control de rh y bancos, módulos
 * que todavía no existen (docs/11). Mientras no haya a quién preguntarle, esos
 * dos se capturan a mano en vez de quedarse sin campo.
 */
export const TIPOS_CON_CATALOGO = ['cliente', 'proveedor', 'activo'] as const

export type TipoConCatalogo = (typeof TIPOS_CON_CATALOGO)[number]

export function tieneCatalogo(tipo: AuxiliarTipo): tipo is TipoConCatalogo {
  return (TIPOS_CON_CATALOGO as readonly AuxiliarTipo[]).includes(tipo)
}

/** Sin tildes, sin mayúsculas y sin espacios de más: se compara lo que se lee. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Separador entre código y nombre en el texto del buscador. */
const SEPARADOR = ' · '

/**
 * Texto que representa al auxiliar en el buscador.
 *
 * Lleva el código Y el nombre a propósito: el `datalist` del navegador filtra
 * por el valor de la opción, así que si el valor fuera solo el código, buscar
 * "Comercial La Sabana" no encontraría nada. Con los dos dentro, el mismo campo
 * responde a las dos formas de buscar que tiene quien captura: el código que se
 * sabe de memoria y el nombre que se lee en el documento.
 *
 * La cédula NO va en el valor: es lo que queda escrito en el campo al elegir,
 * y una cédula ahí es ruido. Va en la etiqueta de la opción (`etiquetaAuxiliar`),
 * por la que el navegador también filtra.
 */
export function textoAuxiliar(auxiliar: Auxiliar): string {
  return `${auxiliar.codigo}${SEPARADOR}${auxiliar.nombre}`
}

/** Lo que acompaña a la opción en la lista: la cédula, cuando la hay. */
export function etiquetaAuxiliar(auxiliar: Auxiliar): string | undefined {
  return auxiliar.identificacion || undefined
}

/**
 * Resultado de buscar lo tecleado en el catálogo.
 *
 * Tres estados y no un booleano porque la pantalla reacciona distinto a cada
 * uno: con `unico` se contabiliza (y se completa el campo), con `ninguno` se
 * avisa que no existe, y con `ambiguo` se pide precisar. Colapsar los dos
 * últimos daría el mensaje equivocado a quien escribió media razón social que
 * comparten tres clientes.
 */
export type ResultadoBusquedaAuxiliar =
  | { readonly estado: 'ninguno' }
  | { readonly estado: 'unico'; readonly auxiliar: Auxiliar }
  | { readonly estado: 'ambiguo'; readonly coincidencias: readonly Auxiliar[] }

/** Coincidencia exacta con alguna de las formas en que se identifica una ficha. */
function coincideExacto(auxiliar: Auxiliar, buscado: string): boolean {
  return (
    normalizar(textoAuxiliar(auxiliar)) === buscado ||
    normalizar(auxiliar.codigo) === buscado ||
    normalizar(auxiliar.nombre) === buscado ||
    normalizar(auxiliar.id) === buscado ||
    (auxiliar.identificacion !== undefined &&
      normalizar(auxiliar.identificacion) === buscado)
  )
}

/** Coincidencia parcial: por prefijo o subcadena del código, nombre o cédula. */
function coincideParcial(auxiliar: Auxiliar, buscado: string): boolean {
  return (
    normalizar(auxiliar.codigo).includes(buscado) ||
    normalizar(auxiliar.nombre).includes(buscado) ||
    (auxiliar.identificacion !== undefined &&
      normalizar(auxiliar.identificacion).includes(buscado))
  )
}

/**
 * Busca a qué ficha se refiere lo tecleado, tolerando texto incompleto.
 *
 * Primero lo exacto: lo que el buscador deja en el campo (código · nombre), el
 * código suelto, el nombre suelto, la cédula o el id identifican sin
 * ambigüedad, y una coincidencia exacta gana aunque además sea prefijo de
 * otra ficha (C-01 existe aunque también empiece C-010).
 *
 * Después lo parcial: si el texto es prefijo o subcadena de UNA sola ficha,
 * por código, nombre o cédula, es esa. "Sabana" identifica a Comercial La
 * Sabana igual de bien que su razón social completa, y obligar a terminarla
 * es hacer teclear lo que ya se sabía. Si son varias, no se adivina: se pide
 * precisar, porque contabilizar contra el cliente equivocado es peor que no
 * contabilizar.
 */
export function buscarAuxiliar(
  auxiliares: readonly Auxiliar[],
  texto: string,
): ResultadoBusquedaAuxiliar {
  const buscado = normalizar(texto)
  if (!buscado) return { estado: 'ninguno' }

  const exacto = auxiliares.find((a) => coincideExacto(a, buscado))
  if (exacto) return { estado: 'unico', auxiliar: exacto }

  const parciales = auxiliares.filter((a) => coincideParcial(a, buscado))
  if (parciales.length === 1) {
    return { estado: 'unico', auxiliar: parciales[0] }
  }
  if (parciales.length > 1) {
    return { estado: 'ambiguo', coincidencias: parciales }
  }
  return { estado: 'ninguno' }
}

/**
 * Resuelve a qué ficha se refiere lo tecleado, o `undefined` si a ninguna o
 * a varias. Es `buscarAuxiliar` para quien solo necesita el id que va al
 * asiento.
 */
export function resolverAuxiliar(
  auxiliares: readonly Auxiliar[],
  texto: string,
): Auxiliar | undefined {
  const resultado = buscarAuxiliar(auxiliares, texto)
  return resultado.estado === 'unico' ? resultado.auxiliar : undefined
}

/** Lo que se ofrece en la lista: solo fichas vigentes. */
export function auxiliaresVigentes(
  auxiliares: readonly Auxiliar[],
): Auxiliar[] {
  return auxiliares.filter((a) => a.activo)
}
