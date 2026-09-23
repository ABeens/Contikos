import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { servicioCxc } from '@/shared/api/servicios'
import type {
  SolicitudAnulacionCobro,
  SolicitudCliente,
  SolicitudCobro,
  SolicitudFacturaVenta,
  SolicitudItemCatalogo,
} from '@/shared/api/contracts/cxc'

/**
 * Único punto del módulo que habla con el servidor (docs/14 §2).
 *
 * Qué se pide lo describe `shared/api/servicios/cxc`, incluido por qué el
 * asiento de una factura se le pide a CxC y no a `conta`. Aquí se decide cuándo
 * pedirlo y qué invalidar después.
 */

export const clavesCxc = {
  todo: ['cxc'] as const,
  clientes: ['cxc', 'clientes'] as const,
  items: ['cxc', 'items'] as const,
  mapeo: ['cxc', 'mapeo'] as const,
  facturas: (clienteId?: string) => ['cxc', 'facturas', clienteId ?? 'todas'] as const,
  factura: (id: string) => ['cxc', 'factura', id] as const,
  asiento: (id: string) => ['cxc', 'factura', id, 'asiento'] as const,
  antiguedad: (corte: string) => ['cxc', 'antiguedad', corte] as const,
  cobros: (filtro?: { clienteId?: string; facturaId?: string }) =>
    [
      'cxc',
      'cobros',
      filtro?.clienteId ?? 'todos',
      filtro?.facturaId ?? 'todas',
    ] as const,
  cobro: (id: string) => ['cxc', 'cobro', id] as const,
  asientoCobro: (id: string) => ['cxc', 'cobro', id, 'asiento'] as const,
}

export function useClientes() {
  return useQuery({
    queryKey: clavesCxc.clientes,
    queryFn: ({ signal }) => servicioCxc.listarClientes({ signal }),
    staleTime: 60 * 1000,
  })
}

/**
 * Catálogo de productos y servicios (docs/04 §1.1).
 *
 * Cambia poco y lo necesitan las dos pantallas del ciclo: el catálogo para
 * mantenerlo y la captura de factura para precargar la línea.
 */
export function useItems() {
  return useQuery({
    queryKey: clavesCxc.items,
    queryFn: ({ signal }) => servicioCxc.listarItems({ signal }),
    staleTime: 5 * 60 * 1000,
  })
}

/** Mapeo de cuentas del módulo. Cambia poco: es configuración (docs/02 §5). */
export function useMapeoCxc() {
  return useQuery({
    queryKey: clavesCxc.mapeo,
    queryFn: ({ signal }) => servicioCxc.obtenerMapeo({ signal }),
    staleTime: 5 * 60 * 1000,
  })
}

export function useFacturasVenta(clienteId?: string) {
  return useQuery({
    queryKey: clavesCxc.facturas(clienteId),
    queryFn: ({ signal }) =>
      servicioCxc.listarFacturas({ clienteId }, { signal }),
  })
}

export function useFacturaVenta(id: string | undefined) {
  return useQuery({
    queryKey: clavesCxc.factura(id ?? ''),
    queryFn: ({ signal }) => servicioCxc.obtenerFactura(id!, { signal }),
    enabled: Boolean(id),
  })
}

/** Asiento que generó la factura. Es lo que hace visible el contrato docs/02. */
export function useAsientoDeFactura(id: string | undefined) {
  return useQuery({
    queryKey: clavesCxc.asiento(id ?? ''),
    queryFn: ({ signal }) =>
      servicioCxc.obtenerAsientoDeFactura(id!, { signal }),
    enabled: Boolean(id),
  })
}

export function useAntiguedadCxc(corte: string) {
  return useQuery({
    queryKey: clavesCxc.antiguedad(corte),
    queryFn: ({ signal }) => servicioCxc.obtenerAntiguedad(corte, { signal }),
  })
}

export function useGuardarCliente() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      datos,
      id,
    }: {
      datos: SolicitudCliente
      /** Sin id se da de alta. */
      id?: string
    }) =>
      id
        ? servicioCxc.actualizarCliente(id, datos)
        : servicioCxc.crearCliente(datos),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesCxc.clientes })
    },
  })
}

export function useGuardarItem() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      datos,
      id,
    }: {
      datos: SolicitudItemCatalogo
      /** Sin id se da de alta. */
      id?: string
    }) =>
      id ? servicioCxc.actualizarItem(id, datos) : servicioCxc.crearItem(datos),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesCxc.items })
    },
  })
}

/**
 * Emite la factura y, con ella, la cuenta por cobrar.
 *
 * Invalida también asientos y balanza: la factura acaba de mover el mayor, y
 * dejar esas vistas en caché mostraría una contabilidad que ya no es la vigente.
 */
export function useEmitirFactura() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (solicitud: SolicitudFacturaVenta) =>
      servicioCxc.emitirFactura(solicitud),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['cxc'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
    },
  })
}

/**
 * Cobros recibidos. Con filtro por cliente o por factura.
 *
 * Por factura es como se responde "quién bajó este saldo": la relación entre
 * cobro y factura es N a N (docs/04 §1), así que el dato no está en la factura.
 */
export function useCobros(filtro?: {
  clienteId?: string
  facturaId?: string
}) {
  return useQuery({
    queryKey: clavesCxc.cobros(filtro),
    queryFn: ({ signal }) => servicioCxc.listarCobros(filtro ?? {}, { signal }),
  })
}

export function useCobro(id: string | undefined) {
  return useQuery({
    queryKey: clavesCxc.cobro(id ?? ''),
    queryFn: ({ signal }) => servicioCxc.obtenerCobro(id!, { signal }),
    enabled: Boolean(id),
  })
}

/** Asiento que contabilizó el cobro. */
export function useAsientoDeCobro(id: string | undefined) {
  return useQuery({
    queryKey: clavesCxc.asientoCobro(id ?? ''),
    queryFn: ({ signal }) => servicioCxc.obtenerAsientoDeCobro(id!, { signal }),
    enabled: Boolean(id),
  })
}

/**
 * Lo que hay que refrescar cuando un cobro entra o sale del mayor.
 *
 * Todo `cxc` (cobros, facturas, clientes y antigüedad: las cuatro vistas
 * cambian a la vez) y, en `conta`, los asientos y la balanza. Dejar la balanza
 * en caché después de mover la cuenta de clientes enseñaría una contabilidad
 * que ya no es la vigente, y el descuadre aparente sería del todo real.
 *
 * También `bancos`: el cobro entra (y su anulación sale) como movimiento de la
 * cuenta bancaria, y el saldo y la conciliación de tesorería lo enseñan.
 */
function invalidarPorCobro(cliente: ReturnType<typeof useQueryClient>): void {
  void cliente.invalidateQueries({ queryKey: ['cxc'] })
  void cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
  void cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
  void cliente.invalidateQueries({ queryKey: ['bancos'] })
}

/** Registra el cobro y, con él, su asiento y el nuevo saldo de las facturas. */
export function useRegistrarCobro() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (solicitud: SolicitudCobro) =>
      servicioCxc.registrarCobro(solicitud),
    onSuccess: () => invalidarPorCobro(cliente),
  })
}

/** Anula el cobro: reversa su asiento y devuelve el saldo a las facturas. */
export function useAnularCobro() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      solicitud,
    }: {
      id: string
      solicitud: SolicitudAnulacionCobro
    }) => servicioCxc.anularCobro(id, solicitud),
    onSuccess: () => invalidarPorCobro(cliente),
  })
}
