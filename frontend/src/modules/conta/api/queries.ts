import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { servicioConta } from '@/shared/api/servicios'
import type { Libro } from '@/shared/api/contracts/comunes'
import type {
  SolicitudAsiento,
  SolicitudCierre,
  SolicitudClasificacionCuenta,
  SolicitudClasificacionNiif,
  SolicitudCuenta,
  SolicitudNotaEeff,
  SolicitudReversa,
} from '@/shared/api/contracts/conta'

/**
 * Único punto del módulo que habla con el servidor.
 *
 * Los componentes usan estos hooks y nunca `fetch`. Qué se pide lo describe
 * `shared/api/servicios`; aquí solo se decide cuándo pedirlo y qué invalidar
 * después (docs/14 §2).
 */

export const clavesConta = {
  todo: ['conta'] as const,
  cuentas: ['conta', 'cuentas'] as const,
  clasificaciones: ['conta', 'clasificaciones-niif'] as const,
  notas: ['conta', 'notas-eeff'] as const,
  periodos: ['conta', 'periodos'] as const,
  verificacionCierre: (periodoId: string) =>
    ['conta', 'periodos', 'verificacion', periodoId] as const,
  asientos: (periodoId?: string, libro?: Libro) =>
    ['conta', 'asientos', periodoId, libro ?? 'ambos'] as const,
  asiento: (id: string) => ['conta', 'asiento', id] as const,
  balanza: (periodoId: string, libro: Libro) =>
    ['conta', 'balanza', periodoId, libro] as const,
  balanzaComparativa: (periodoA: string, periodoB: string, libro: Libro) =>
    ['conta', 'balanza', 'comparativa', periodoA, periodoB, libro] as const,
}

/**
 * El catálogo de cuentas, los periodos y los auxiliares viven en
 * `shared/api/catalogos`.
 *
 * Los dos primeros los administra este módulo, pero los consultan los cinco
 * subsidiarios; los auxiliares son al revés, los administra cada subsidiario y
 * los consulta la captura manual. En los dos sentidos vale lo mismo: un módulo
 * no importa de otro (docs/14 §3.1). Se re-exportan desde aquí para que las
 * pantallas de `conta` sigan pidiéndoselos a su propio módulo.
 */
export { useAuxiliares, useCuentas, usePeriodos } from '@/shared/api/catalogos'

/**
 * La trazabilidad documento <-> asiento también es compartida, y por la misma
 * razón: la consultan las pantallas de factura de cxc y cxp además de las de
 * aquí. Se re-exporta para que las pantallas de `conta` sigan pidiéndoselo a
 * su propio módulo.
 */
export {
  useAsientosDeDocumento,
  useDocumentosTrazables,
} from '@/shared/api/trazabilidad'

/**
 * Sin `libro` devuelve los asientos de las dos contabilidades.
 *
 * `habilitado` existe para no pedir el mayor entero mientras la aplicación
 * todavía no sabe qué periodo está activo: esa primera consulta sin filtro
 * llega, pinta la lista completa y la sustituye un instante después por la del
 * periodo. Quien alcanzó a hacer clic en ese instante hizo clic en una fila que
 * ya no existe.
 */
export function useAsientos(
  periodoId?: string,
  libro?: Libro,
  habilitado = true,
) {
  return useQuery({
    queryKey: clavesConta.asientos(periodoId, libro),
    queryFn: ({ signal }) =>
      servicioConta.listarAsientos({ periodoId, libro }, { signal }),
    enabled: habilitado,
  })
}

export function useAsiento(id: string | undefined) {
  return useQuery({
    queryKey: clavesConta.asiento(id ?? ''),
    queryFn: ({ signal }) => servicioConta.obtenerAsiento(id!, { signal }),
    enabled: Boolean(id),
  })
}

/**
 * La balanza es de un libro. No se ofrece "las dos a la vez" porque sumar
 * fiscal y corporativo daría un estado financiero que no existe.
 */
export function useBalanza(periodoId: string | undefined, libro: Libro) {
  return useQuery({
    queryKey: clavesConta.balanza(periodoId ?? '', libro),
    queryFn: ({ signal }) =>
      servicioConta.obtenerBalanza(periodoId!, libro, { signal }),
    enabled: Boolean(periodoId),
  })
}

/**
 * Balanza comparativa entre dos periodos (docs/09 §3.2).
 *
 * Consulta aparte de `useBalanza` y no un parámetro suyo: son dos reportes con
 * dos formas distintas, y quien apaga el comparativo vuelve a ver la balanza
 * que ya tenía en caché en lugar de esperar a que se recalcule.
 */
export function useBalanzaComparativa(
  periodoA: string | undefined,
  periodoB: string | undefined,
  libro: Libro,
  habilitado = true,
) {
  return useQuery({
    queryKey: clavesConta.balanzaComparativa(periodoA ?? '', periodoB ?? '', libro),
    queryFn: ({ signal }) =>
      servicioConta.obtenerBalanzaComparativa(periodoA!, periodoB!, libro, {
        signal,
      }),
    enabled: habilitado && Boolean(periodoA) && Boolean(periodoB),
  })
}

/* -------------------------------------- Cierre de periodo (docs/03 §5) */

/**
 * El checklist de cierre de un periodo.
 *
 * `staleTime` cero a propósito: el checklist mira el mayor entero, y un asiento
 * contabilizado en otra pestaña cambia lo que dice. Un checklist en caché es un
 * checklist que enseña un mes que ya no existe.
 */
export function useVerificacionCierre(
  periodoId: string | undefined,
  habilitado = true,
) {
  return useQuery({
    queryKey: clavesConta.verificacionCierre(periodoId ?? ''),
    queryFn: ({ signal }) =>
      servicioConta.obtenerVerificacionCierre(periodoId!, { signal }),
    enabled: habilitado && Boolean(periodoId),
    staleTime: 0,
  })
}

/**
 * Invalida todo lo que depende del estado de un periodo.
 *
 * Son tres cosas y las tres importan: los periodos (el selector de la cabecera
 * enseña el estado), los asientos (un periodo cerrado ya no admite captura) y
 * la balanza, que es el reporte del periodo que acaba de cambiar.
 *
 * La clave del checklist cuelga de la de periodos, así que cae con ella y no
 * hace falta nombrarla. Cae la de TODOS los periodos y no solo la del que
 * cambió, a propósito: cerrar un mes cambia el checklist del siguiente, donde
 * el punto "el periodo anterior sigue abierto" acaba de resolverse.
 */
function invalidarPeriodos(cliente: ReturnType<typeof useQueryClient>) {
  void cliente.invalidateQueries({ queryKey: clavesConta.periodos })
  void cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
  void cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
}

export function useCerrarPeriodo() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      periodoId,
      solicitud,
    }: {
      periodoId: string
      solicitud: SolicitudCierre
    }) => servicioConta.cerrarPeriodo(periodoId, solicitud),
    onSuccess: () => invalidarPeriodos(cliente),
  })
}

export function useReabrirPeriodo() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (periodoId: string) => servicioConta.reabrirPeriodo(periodoId),
    onSuccess: () => invalidarPeriodos(cliente),
  })
}

export function useContabilizarAsiento() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (solicitud: SolicitudAsiento) =>
      servicioConta.contabilizarAsiento(solicitud),
    onSuccess: () => {
      // Un asiento nuevo invalida asientos y balanza. El catálogo no cambia.
      cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
      cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
    },
  })
}

/**
 * Reversa de un asiento (docs/02 §6).
 *
 * Invalida también los asientos sueltos: el original cambia de estado sin que
 * nadie lo haya vuelto a pedir, y la pantalla que lo tiene abierto debe verlo
 * ya como reversado.
 */
export function useReversarAsiento() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({ id, solicitud }: { id: string; solicitud: SolicitudReversa }) =>
      servicioConta.reversarAsiento(id, solicitud),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
      cliente.invalidateQueries({ queryKey: ['conta', 'asiento'] })
      cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
    },
  })
}

/* --------------------------------------- Catálogos de presentación */

/**
 * Invalida todo lo que depende de los catálogos de presentación.
 *
 * Incluye las cuentas: sus contadores derivados (`cuentas`, `notas`) y su
 * clasificación se calculan contra estos catálogos, así que dejarlas en caché
 * mostraría una cuenta clasificada en un renglón que acaba de cambiar.
 */
function invalidarPresentacion(cliente: ReturnType<typeof useQueryClient>) {
  void cliente.invalidateQueries({ queryKey: clavesConta.clasificaciones })
  void cliente.invalidateQueries({ queryKey: clavesConta.notas })
  void cliente.invalidateQueries({ queryKey: clavesConta.cuentas })
}

export function useClasificacionesNiif() {
  return useQuery({
    queryKey: clavesConta.clasificaciones,
    queryFn: ({ signal }) => servicioConta.listarClasificaciones({ signal }),
    staleTime: 5 * 60 * 1000,
  })
}

export function useNotasEeff() {
  return useQuery({
    queryKey: clavesConta.notas,
    queryFn: ({ signal }) => servicioConta.listarNotas({ signal }),
    staleTime: 5 * 60 * 1000,
  })
}

export function useGuardarClasificacion() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      clasificacion,
      id,
    }: {
      clasificacion: SolicitudClasificacionNiif
      /** Sin id se da de alta. */
      id?: string
    }) =>
      id
        ? servicioConta.actualizarClasificacion(id, clasificacion)
        : servicioConta.crearClasificacion(clasificacion),
    onSuccess: () => invalidarPresentacion(cliente),
  })
}

export function useEliminarClasificacion() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => servicioConta.eliminarClasificacion(id),
    onSuccess: () => invalidarPresentacion(cliente),
  })
}

export function useGuardarNota() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({ nota, id }: { nota: SolicitudNotaEeff; id?: string }) =>
      id ? servicioConta.actualizarNota(id, nota) : servicioConta.crearNota(nota),
    onSuccess: () => invalidarPresentacion(cliente),
  })
}

export function useEliminarNota() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => servicioConta.eliminarNota(id),
    onSuccess: () => invalidarPresentacion(cliente),
  })
}

/**
 * Alta y edición de una cuenta del catálogo.
 *
 * Invalida el catálogo entero, no solo la lista: media aplicación lo lee por la
 * misma clave (`shared/api/catalogos`), y una cuenta nueva que no llegue al
 * selector de la captura de asientos es una cuenta que no existe para nadie.
 */
export function useGuardarCuenta() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      datos,
      id,
    }: {
      datos: SolicitudCuenta
      /** Sin id se da de alta. */
      id?: string
    }) =>
      id
        ? servicioConta.actualizarCuenta(id, datos)
        : servicioConta.crearCuenta(datos),
    onSuccess: () => invalidarPresentacion(cliente),
  })
}

/** Asigna a una cuenta su renglón del estado financiero y su nota. */
export function useClasificarCuenta() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      cuentaId,
      asignacion,
    }: {
      cuentaId: string
      asignacion: SolicitudClasificacionCuenta
    }) => servicioConta.clasificarCuenta(cuentaId, asignacion),
    onSuccess: () => invalidarPresentacion(cliente),
  })
}
