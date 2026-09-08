import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { servicioConta, servicioCxc, servicioCxp } from './servicios'
import type { Modulo } from './contracts/comunes'
import type { Asiento, DocumentoRelacionado } from './contracts/conta'
import { normalizar } from '@/shared/auxiliares/auxiliar'

/**
 * Trazabilidad entre documentos y asientos, en los dos sentidos.
 *
 * Vive en `shared` por la regla de límites de docs/14 §3.1: la pantalla de una
 * factura de cxc quiere ver qué asientos la mencionan, y la captura manual de
 * conta quiere elegir a qué factura se refiere. Ninguno de los dos módulos
 * puede importar del otro, así que los dos vienen aquí.
 */

/** Módulos cuyos documentos se pueden referenciar desde un asiento manual. */
export const MODULOS_CON_DOCUMENTOS = ['cxc', 'cxp'] as const

export type ModuloConDocumentos = (typeof MODULOS_CON_DOCUMENTOS)[number]

export function esModuloConDocumentos(
  valor: string | null | undefined,
): valor is ModuloConDocumentos {
  return valor === 'cxc' || valor === 'cxp'
}

/**
 * Un documento de un módulo, en la forma mínima que la trazabilidad necesita.
 *
 * Una factura de venta y una de compra tienen campos distintos; quien busca a
 * qué documento se refiere un ajuste solo necesita el folio que reconoce, el
 * tercero y algo con que confirmar que es esa (fecha, total).
 */
export interface DocumentoTrazable {
  modulo: ModuloConDocumentos
  tipo: 'factura'
  id: string
  /** El folio visible: consecutivo FE-... en cxc, folio interno CXP-... en cxp. */
  referencia: string
  /** Otros identificadores por los que también se busca (folio del proveedor). */
  alias: string[]
  tercero: string
  fecha: string
  total: string
  moneda: string
}

/** Texto con el que se ofrece y se deja escrito un documento en el buscador. */
export function textoDocumento(documento: DocumentoTrazable): string {
  return `${documento.referencia} · ${documento.tercero}`
}

export type ResultadoBusquedaDocumento =
  | { readonly estado: 'ninguno' }
  | { readonly estado: 'unico'; readonly documento: DocumentoTrazable }
  | { readonly estado: 'ambiguo'; readonly coincidencias: readonly DocumentoTrazable[] }

/**
 * A qué documento se refiere lo tecleado: por referencia, por folio del
 * proveedor o por tercero, exacto primero y parcial si es único. Misma regla
 * que el buscador de auxiliares y por la misma razón: teclear "114" tiene que
 * bastar cuando solo hay una FE-00000114, y no se adivina cuando hay varias.
 */
export function buscarDocumento(
  documentos: readonly DocumentoTrazable[],
  texto: string,
): ResultadoBusquedaDocumento {
  const buscado = normalizar(texto)
  if (!buscado) return { estado: 'ninguno' }

  const exacto = documentos.find(
    (d) =>
      normalizar(textoDocumento(d)) === buscado ||
      normalizar(d.referencia) === buscado ||
      d.alias.some((a) => normalizar(a) === buscado),
  )
  if (exacto) return { estado: 'unico', documento: exacto }

  const parciales = documentos.filter(
    (d) =>
      normalizar(d.referencia).includes(buscado) ||
      normalizar(d.tercero).includes(buscado) ||
      d.alias.some((a) => normalizar(a).includes(buscado)),
  )
  if (parciales.length === 1) return { estado: 'unico', documento: parciales[0] }
  if (parciales.length > 1) return { estado: 'ambiguo', coincidencias: parciales }
  return { estado: 'ninguno' }
}

/** La terna más la referencia visible, que es lo que viaja en el asiento. */
export function aDocumentoRelacionado(
  documento: DocumentoTrazable,
): DocumentoRelacionado {
  return {
    modulo: documento.modulo,
    tipo: documento.tipo,
    id: documento.id,
    referencia: documento.referencia,
  }
}

export const clavesTrazabilidad = {
  /**
   * La misma clave con la que `conta` guarda un asiento suelto: quien lo
   * consultó desde la lista de asientos no lo vuelve a descargar aquí.
   */
  asiento: (id: string) => ['conta', 'asiento', id] as const,
  asientosDeDocumento: (modulo: Modulo, tipo: string, id: string) =>
    ['conta', 'asientos', 'documento', modulo, tipo, id] as const,
  // Las claves de cxc y cxp, escritas igual a propósito: son sus listados
  // completos, y quien los vio en el módulo no los vuelve a pedir.
  facturasCxc: ['cxc', 'facturas', 'todas'] as const,
  facturasCxp: ['cxp', 'facturas', 'todas'] as const,
}

/**
 * Todos los asientos de un documento: el que lo generó (por `origen`) y los
 * manuales que lo mencionan (por `documentoRelacionado`).
 *
 * Es lo que la pantalla de una factura enseña bajo "Contabilidad". Sin id no
 * pide nada: un documento que aún no se guardó no tiene asientos.
 */
export function useAsientosDeDocumento(
  modulo: Modulo,
  tipo: string,
  id: string | undefined,
) {
  return useQuery({
    queryKey: clavesTrazabilidad.asientosDeDocumento(modulo, tipo, id ?? ''),
    queryFn: ({ signal }) =>
      servicioConta.listarAsientos(
        { documento: { modulo, tipo, id: id! } },
        { signal },
      ),
    enabled: Boolean(id),
  })
}

/**
 * Un asiento por id, desde cualquier módulo.
 *
 * Lo usa el panel compartido para resolver el código del asiento al que un
 * original reversado apunta (y viceversa): el contrato guarda ids, y en
 * pantalla lo que se lee es el código.
 */
export function useAsientoPorId(id: string | null | undefined) {
  return useQuery<Asiento>({
    queryKey: clavesTrazabilidad.asiento(id ?? ''),
    queryFn: ({ signal }) => servicioConta.obtenerAsiento(id!, { signal }),
    enabled: Boolean(id),
    staleTime: 60 * 1000,
  })
}

/**
 * Documentos de un módulo, listos para elegir uno desde la captura manual.
 *
 * Solo se pide el módulo elegido: quien captura un ajuste de cxc no descarga
 * las compras. `null` no pide nada, que es el estado de la sección mientras
 * el asiento no se refiere a ningún documento.
 */
export function useDocumentosTrazables(
  modulo: ModuloConDocumentos | null,
): { documentos: DocumentoTrazable[]; cargando: boolean } {
  const cxc = useQuery({
    queryKey: clavesTrazabilidad.facturasCxc,
    queryFn: ({ signal }) => servicioCxc.listarFacturas({}, { signal }),
    staleTime: 60 * 1000,
    enabled: modulo === 'cxc',
  })

  const cxp = useQuery({
    queryKey: clavesTrazabilidad.facturasCxp,
    queryFn: ({ signal }) => servicioCxp.listarFacturas({}, { signal }),
    staleTime: 60 * 1000,
    enabled: modulo === 'cxp',
  })

  const documentos = useMemo<DocumentoTrazable[]>(() => {
    if (modulo === 'cxc') {
      return (cxc.data ?? []).map((f) => ({
        modulo: 'cxc',
        tipo: 'factura',
        id: f.id,
        referencia: f.consecutivo,
        alias: [],
        tercero: f.clienteNombre,
        fecha: f.fechaEmision,
        total: f.total,
        moneda: f.moneda,
      }))
    }
    if (modulo === 'cxp') {
      return (cxp.data ?? []).map((f) => ({
        modulo: 'cxp',
        tipo: 'factura',
        id: f.id,
        referencia: f.folioInterno,
        // El folio del proveedor es el que está impreso en el papel que el
        // usuario tiene delante: se busca por él aunque no sea la referencia.
        alias: [f.folioProveedor],
        tercero: f.proveedorNombre,
        fecha: f.fechaEmision,
        total: f.total,
        moneda: f.moneda,
      }))
    }
    return []
  }, [modulo, cxc.data, cxp.data])

  return {
    documentos,
    cargando: modulo === 'cxc' ? cxc.isLoading : modulo === 'cxp' ? cxp.isLoading : false,
  }
}
