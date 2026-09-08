import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { servicioActivos, servicioCxp } from '@/shared/api/servicios'
import type {
  SolicitudAnulacionPago,
  SolicitudFacturaCompra,
  SolicitudPago,
  SolicitudProveedor,
} from '@/shared/api/contracts/cxp'
import type { SolicitudAdjunto } from '@/shared/api/contracts/comunes'

/**
 * Único punto del módulo que habla con el servidor (docs/14 §2).
 *
 * Incluye el catálogo de categorías de activo, que CxP necesita para
 * capitalizar una línea. Se pide por el servicio de activos, que vive en
 * `shared`: el módulo no importa nada de `modules/activos` (docs/14 §3.1).
 */

export const clavesCxp = {
  todo: ['cxp'] as const,
  proveedores: ['cxp', 'proveedores'] as const,
  mapeo: ['cxp', 'mapeo'] as const,
  categorias: ['activos', 'categorias'] as const,
  facturas: (proveedorId?: string) =>
    ['cxp', 'facturas', proveedorId ?? 'todas'] as const,
  factura: (id: string) => ['cxp', 'factura', id] as const,
  asiento: (id: string) => ['cxp', 'factura', id, 'asiento'] as const,
  antiguedad: (corte: string) => ['cxp', 'antiguedad', corte] as const,
  pagos: (filtro: { proveedorId?: string; facturaId?: string } = {}) =>
    [
      'cxp',
      'pagos',
      filtro.proveedorId ?? 'todos',
      filtro.facturaId ?? 'todas',
    ] as const,
  pago: (id: string) => ['cxp', 'pago', id] as const,
  asientoPago: (id: string) => ['cxp', 'pago', id, 'asiento'] as const,
  propuesta: (corte: string, disponible: string) =>
    ['cxp', 'propuesta', corte, disponible] as const,
}

export function useProveedores() {
  return useQuery({
    queryKey: clavesCxp.proveedores,
    queryFn: ({ signal }) => servicioCxp.listarProveedores({ signal }),
    staleTime: 60 * 1000,
  })
}

export function useMapeoCxp() {
  return useQuery({
    queryKey: clavesCxp.mapeo,
    queryFn: ({ signal }) => servicioCxp.obtenerMapeo({ signal }),
    staleTime: 5 * 60 * 1000,
  })
}

/** Categorías de activo, para capitalizar una línea de la factura. */
export function useCategoriasActivo() {
  return useQuery({
    queryKey: clavesCxp.categorias,
    queryFn: ({ signal }) => servicioActivos.listarCategorias({ signal }),
    staleTime: 5 * 60 * 1000,
  })
}

export function useFacturasCompra(proveedorId?: string) {
  return useQuery({
    queryKey: clavesCxp.facturas(proveedorId),
    queryFn: ({ signal }) =>
      servicioCxp.listarFacturas({ proveedorId }, { signal }),
  })
}

export function useFacturaCompra(id: string | undefined) {
  return useQuery({
    queryKey: clavesCxp.factura(id ?? ''),
    queryFn: ({ signal }) => servicioCxp.obtenerFactura(id!, { signal }),
    enabled: Boolean(id),
  })
}

export function useAsientoDeFacturaCompra(id: string | undefined) {
  return useQuery({
    queryKey: clavesCxp.asiento(id ?? ''),
    queryFn: ({ signal }) =>
      servicioCxp.obtenerAsientoDeFactura(id!, { signal }),
    enabled: Boolean(id),
  })
}

export function useAntiguedadCxp(corte: string) {
  return useQuery({
    queryKey: clavesCxp.antiguedad(corte),
    queryFn: ({ signal }) => servicioCxp.obtenerAntiguedad(corte, { signal }),
  })
}

export function useGuardarProveedor() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({ datos, id }: { datos: SolicitudProveedor; id?: string }) =>
      id
        ? servicioCxp.actualizarProveedor(id, datos)
        : servicioCxp.crearProveedor(datos),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesCxp.proveedores })
    },
  })
}

/**
 * Registra la factura de gasto y, con ella, la cuenta por pagar.
 *
 * Invalida activos además del mayor: si alguna línea se capitalizó, la ficha
 * del activo nació en esta misma operación (docs/07 §3.1).
 */
export function useRegistrarFacturaCompra() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (solicitud: SolicitudFacturaCompra) =>
      servicioCxp.registrarFactura(solicitud),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['cxp'] })
      void cliente.invalidateQueries({ queryKey: ['activos'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
    },
  })
}

/* ------------------------------------------------------------------ Pagos */

export function usePagos(
  filtro: { proveedorId?: string; facturaId?: string } = {},
) {
  return useQuery({
    queryKey: clavesCxp.pagos(filtro),
    queryFn: ({ signal }) => servicioCxp.listarPagos(filtro, { signal }),
  })
}

export function useAsientoDePago(id: string | undefined) {
  return useQuery({
    queryKey: clavesCxp.asientoPago(id ?? ''),
    queryFn: ({ signal }) => servicioCxp.obtenerAsientoDePago(id!, { signal }),
    enabled: Boolean(id),
  })
}

/**
 * Propuesta de pago a una fecha de corte y un tope de efectivo (docs/05 §2.3).
 *
 * Sin caché útil: la propuesta depende de los saldos vigentes y lo primero que
 * la invalida es emitir uno de los pagos que ella misma propuso.
 */
export function usePropuestaPago(
  corte: string,
  disponible: string,
  habilitado = true,
) {
  return useQuery({
    queryKey: clavesCxp.propuesta(corte, disponible),
    queryFn: ({ signal }) =>
      servicioCxp.obtenerPropuestaPago({ corte, disponible }, { signal }),
    enabled: habilitado,
    staleTime: 0,
  })
}

/**
 * Emite el pago: documento, asiento y saldos, en una sola operación.
 *
 * Invalida `cxp` entero porque el pago mueve todo lo que el módulo deriva del
 * saldo de las facturas (la cartera, la antigüedad, el saldo del proveedor) y
 * también el mayor, que es donde acabó el egreso.
 */
export function useRegistrarPago() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (solicitud: SolicitudPago) =>
      servicioCxp.registrarPago(solicitud),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['cxp'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
    },
  })
}

/** Anula el pago: reversa su asiento y devuelve el saldo a sus facturas. */
export function useAnularPago() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      solicitud,
    }: {
      id: string
      solicitud: SolicitudAnulacionPago
    }) => servicioCxp.anularPago(id, solicitud),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['cxp'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
    },
  })
}

/* -------------------------------------------------------------- Adjuntos */

/**
 * Sube adjuntos a una factura ya registrada.
 *
 * En serie y no en paralelo: son pocos archivos y el servidor asigna el id
 * de cada uno a partir de los que ya tiene la factura. Devuelve los que se
 * subieron y el error del primero que falló, para que la pantalla diga cuál.
 */
export function useAgregarAdjuntos() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: async ({
      facturaId,
      adjuntos,
    }: {
      facturaId: string
      adjuntos: readonly SolicitudAdjunto[]
    }) => {
      const subidos = []
      for (const adjunto of adjuntos) {
        subidos.push(await servicioCxp.agregarAdjunto(facturaId, adjunto))
      }
      return subidos
    },
    onSettled: () => {
      // La factura lleva los metadatos: hay que releerla aunque fallara uno,
      // porque los anteriores sí quedaron.
      void cliente.invalidateQueries({ queryKey: ['cxp', 'facturas'] })
      void cliente.invalidateQueries({ queryKey: ['cxp', 'factura'] })
    },
  })
}

export function useEliminarAdjunto() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      facturaId,
      adjuntoId,
    }: {
      facturaId: string
      adjuntoId: string
    }) => servicioCxp.eliminarAdjunto(facturaId, adjuntoId),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['cxp', 'facturas'] })
      void cliente.invalidateQueries({ queryKey: ['cxp', 'factura'] })
    },
  })
}

/**
 * Abre un adjunto en otra pestaña.
 *
 * Descarga el binario y lo enseña por una URL de blob: el servidor devuelve
 * el archivo con su tipo y el navegador hace el resto. La URL se libera al
 * rato; la pestaña ya lo tiene cargado.
 */
export function useAbrirAdjunto() {
  return useMutation({
    mutationFn: async ({
      facturaId,
      adjuntoId,
    }: {
      facturaId: string
      adjuntoId: string
    }) => {
      const blob = await servicioCxp.descargarAdjunto(facturaId, adjuntoId)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return url
    },
  })
}
