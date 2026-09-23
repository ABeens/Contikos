import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { servicioActivos } from '@/shared/api/servicios'
import type {
  SolicitudActivoDesdeFactura,
  SolicitudActivoManual,
  SolicitudCategoriaActivo,
  SolicitudCorrida,
} from '@/shared/api/contracts/activos'

/**
 * Único punto del módulo que habla con el servidor (docs/14 §2).
 *
 * Qué se pide lo describe `shared/api/servicios/activos`; aquí se decide cuándo
 * pedirlo y qué invalidar después.
 */

export const clavesActivos = {
  todo: ['activos'] as const,
  lista: (categoriaId?: string) =>
    ['activos', 'lista', categoriaId ?? 'todas'] as const,
  activo: (id: string) => ['activos', 'activo', id] as const,
  categorias: ['activos', 'categorias'] as const,
  pendientes: ['activos', 'altas-pendientes'] as const,
  depreciacion: (periodoId: string) =>
    ['activos', 'depreciacion', 'previsualizacion', periodoId] as const,
  historialDepreciacion: ['activos', 'depreciacion', 'historial'] as const,
}

export function useActivos(categoriaId?: string) {
  return useQuery({
    queryKey: clavesActivos.lista(categoriaId),
    queryFn: ({ signal }) => servicioActivos.listar({ categoriaId }, { signal }),
  })
}

export function useActivo(id: string | undefined) {
  return useQuery({
    queryKey: clavesActivos.activo(id ?? ''),
    queryFn: ({ signal }) => servicioActivos.obtener(id!, { signal }),
    enabled: Boolean(id),
  })
}

export function useCategorias() {
  return useQuery({
    queryKey: clavesActivos.categorias,
    queryFn: ({ signal }) => servicioActivos.listarCategorias({ signal }),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Alta y edición de categoría.
 *
 * Invalida todo el módulo y no solo el catálogo: el nombre de la categoría
 * viaja copiado en cada ficha, y la sugerencia de categoría de las altas
 * pendientes se resuelve por la cuenta de activo que acaba de cambiar.
 */
export function useGuardarCategoria() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      datos,
      id,
    }: {
      datos: SolicitudCategoriaActivo
      /** Sin id se da de alta. */
      id?: string
    }) =>
      id
        ? servicioActivos.actualizarCategoria(id, datos)
        : servicioActivos.crearCategoria(datos),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesActivos.todo })
    },
  })
}

/**
 * Compras que cargaron una cuenta de activo fijo y no tienen ficha.
 *
 * Es la lista de lo que el mayor ya reconoce y el auxiliar todavía no: mientras
 * tenga renglones, la conciliación de docs/07 §4 no cuadra.
 */
export function useAltasPendientes() {
  return useQuery({
    queryKey: clavesActivos.pendientes,
    queryFn: ({ signal }) => servicioActivos.listarAltasPendientes({ signal }),
  })
}

/** Alta directa. Genera asiento, así que invalida también el mayor. */
export function useAltaManual() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (solicitud: SolicitudActivoManual) =>
      servicioActivos.altaManual(solicitud),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesActivos.todo })
      void cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
    },
  })
}

/**
 * Alta desde una factura de compra ya contabilizada.
 *
 * No toca el mayor: el asiento de la compra ya reconoció el activo, y volver a
 * contabilizarlo lo duplicaría (docs/07 §3.1). Por eso aquí no se invalida ni
 * la balanza ni los asientos, pero sí las facturas de CxP: la línea deja de
 * estar pendiente de activo.
 */
export function useAltaDesdeFactura() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (solicitud: SolicitudActivoDesdeFactura) =>
      servicioActivos.altaDesdeFactura(solicitud),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesActivos.todo })
      void cliente.invalidateQueries({ queryKey: ['cxp'] })
    },
  })
}

/* ------------------------------------------------------ Depreciación */

/**
 * Verificación previa de la corrida (docs/07 §3.2).
 *
 * Solo se pide cuando el usuario la manda verificar: calcularla al abrir la
 * pantalla mostraría una corrida que nadie pidió revisar. No se cachea entre
 * visitas: la corrida depende del estado vigente de las fichas y del mayor,
 * y una previsualización vieja es justo lo que la verificación previa evita.
 */
export function usePrevisualizacionDepreciacion(
  periodoId: string | undefined,
  habilitado: boolean,
) {
  return useQuery({
    queryKey: clavesActivos.depreciacion(periodoId ?? ''),
    queryFn: ({ signal }) =>
      servicioActivos.previsualizarDepreciacion(periodoId!, { signal }),
    enabled: habilitado && Boolean(periodoId),
    staleTime: 0,
    gcTime: 0,
  })
}

/**
 * Contabiliza la corrida.
 *
 * Toca las fichas (acumulada, valor en libros, estado) y el mayor, así que
 * invalida los dos: el inventario y la balanza tienen que contar lo mismo.
 */
export function useContabilizarDepreciacion() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (solicitud: SolicitudCorrida) =>
      servicioActivos.contabilizarDepreciacion(solicitud),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesActivos.todo })
      void cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
      // Mismo motivo que la revaluación: el cierre de periodo comprueba que la
      // corrida del mes esté contabilizada, y la lista de periodos lo refleja.
      void cliente.invalidateQueries({ queryKey: ['conta', 'periodos'] })
    },
  })
}

export function useHistorialDepreciacion() {
  return useQuery({
    queryKey: clavesActivos.historialDepreciacion,
    queryFn: ({ signal }) => servicioActivos.historialDepreciacion({ signal }),
  })
}
