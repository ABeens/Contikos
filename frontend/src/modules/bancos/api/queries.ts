import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { servicioBancos } from '@/shared/api/servicios'
import { useCuentasBancarias } from '@/shared/api/catalogos'
import type {
  EstadoMovimiento,
  SolicitudCierreConciliacion,
  SolicitudEmparejamiento,
  SolicitudImportacion,
  SolicitudRevaluacion,
  SolicitudComision,
  SolicitudCuentaBancaria,
  SolicitudInteres,
  SolicitudTraspaso,
} from '@/shared/api/contracts/bancos'

/**
 * Único punto del módulo que habla con el servidor (docs/14 §2).
 *
 * Qué se pide lo describe `shared/api/servicios/bancos`; aquí se decide cuándo
 * pedirlo y qué invalidar después.
 */

export const clavesBancos = {
  todo: ['bancos'] as const,
  cuentas: (soloActivas?: boolean) =>
    ['bancos', 'cuentas', soloActivas ? 'activas' : 'todas'] as const,
  mapeo: ['bancos', 'mapeo'] as const,
  movimientos: (cuentaBancariaId?: string, estado?: EstadoMovimiento) =>
    [
      'bancos',
      'movimientos',
      cuentaBancariaId ?? 'todas',
      estado ?? 'todos',
    ] as const,
  posicion: ['bancos', 'posicion'] as const,
  formatos: ['bancos', 'formatos'] as const,
  estadoCuenta: (cuentaBancariaId?: string, sinConciliar?: boolean) =>
    [
      'bancos',
      'estado-cuenta',
      cuentaBancariaId ?? 'todas',
      sinConciliar ? 'sin-conciliar' : 'todos',
    ] as const,
  conciliacion: (cuentaBancariaId: string, fechaCorte: string) =>
    ['bancos', 'conciliacion', cuentaBancariaId, fechaCorte] as const,
  conciliaciones: (cuentaBancariaId?: string) =>
    ['bancos', 'conciliaciones', cuentaBancariaId ?? 'todas'] as const,
  revaluacion: (periodoId: string) =>
    ['bancos', 'revaluacion', periodoId] as const,
}

/**
 * El catálogo de cuentas bancarias lo consultan también CxC y CxP, así que su
 * hook vive en `shared/api/catalogos` (docs/14 §3.1: un módulo no importa de
 * otro). Se reexporta para que dentro del módulo se lea como el resto.
 */
export { useCuentasBancarias }

export function useMapeoBancos() {
  return useQuery({
    queryKey: clavesBancos.mapeo,
    queryFn: ({ signal }) => servicioBancos.mapeo({ signal }),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Alta y edición de una cuenta bancaria.
 *
 * Invalida el módulo entero y no solo el catálogo: la posición de tesorería
 * lista las cuentas activas, y desactivar una la saca de ahí.
 */
export function useGuardarCuentaBancaria() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      datos,
      id,
    }: {
      datos: SolicitudCuentaBancaria
      /** Sin id se da de alta. */
      id?: string
    }) =>
      id
        ? servicioBancos.actualizarCuenta(id, datos)
        : servicioBancos.crearCuenta(datos),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesBancos.todo })
    },
  })
}

export function useMovimientosBancarios(
  cuentaBancariaId?: string,
  estado?: EstadoMovimiento,
) {
  return useQuery({
    queryKey: clavesBancos.movimientos(cuentaBancariaId, estado),
    queryFn: ({ signal }) =>
      servicioBancos.listarMovimientos({ cuentaBancariaId, estado }, { signal }),
  })
}

export function usePosicionTesoreria() {
  return useQuery({
    queryKey: clavesBancos.posicion,
    queryFn: ({ signal }) => servicioBancos.posicion({ signal }),
  })
}

/**
 * Captura de un movimiento propio: comisión, interés o traspaso.
 *
 * Los tres tocan el mayor, así que invalidan también los asientos y la balanza:
 * el auxiliar de bancos y el libro tienen que contar lo mismo (docs/06 §4).
 */
export function useRegistrarMovimiento() {
  const cliente = useQueryClient()

  const invalidar = () => {
    void cliente.invalidateQueries({ queryKey: clavesBancos.todo })
    void cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
    void cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
  }

  const comision = useMutation({
    mutationFn: (solicitud: SolicitudComision) =>
      servicioBancos.registrarComision(solicitud),
    onSuccess: invalidar,
  })

  const interes = useMutation({
    mutationFn: (solicitud: SolicitudInteres) =>
      servicioBancos.registrarInteres(solicitud),
    onSuccess: invalidar,
  })

  const traspaso = useMutation({
    mutationFn: (solicitud: SolicitudTraspaso) =>
      servicioBancos.registrarTraspaso(solicitud),
    onSuccess: invalidar,
  })

  return { comision, interes, traspaso }
}

/* ------------------------------------------------- Estado de cuenta */

export function useFormatosImportacion() {
  return useQuery({
    queryKey: clavesBancos.formatos,
    queryFn: ({ signal }) => servicioBancos.formatos({ signal }),
    // La lista de lectores solo cambia cuando se despliega uno nuevo.
    staleTime: Infinity,
  })
}

export function useEstadoCuenta(
  cuentaBancariaId?: string,
  sinConciliar?: boolean,
) {
  return useQuery({
    queryKey: clavesBancos.estadoCuenta(cuentaBancariaId, sinConciliar),
    queryFn: ({ signal }) =>
      servicioBancos.listarEstadoCuenta(
        { cuentaBancariaId, sinConciliar },
        { signal },
      ),
  })
}

/**
 * Importa un archivo del banco.
 *
 * No invalida el mayor: importar no contabiliza nada (docs/06 §2.2). Sí
 * invalida el módulo entero, porque el saldo del banco queda en la ficha de la
 * cuenta y la conciliación cambia de arriba abajo.
 */
export function useImportarEstadoCuenta() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (solicitud: SolicitudImportacion) =>
      servicioBancos.importarEstadoCuenta(solicitud),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesBancos.todo })
    },
  })
}

/* ----------------------------------------------------- Conciliación */

/**
 * La conciliación a una fecha de corte.
 *
 * No se cachea entre visitas: depende del estado vigente de las dos tablas de
 * movimientos, y una conciliación vieja es justo lo que la verificación
 * previa existe para evitar.
 */
export function useConciliacion(
  cuentaBancariaId: string | undefined,
  fechaCorte: string,
  saldoBanco?: string,
) {
  return useQuery({
    queryKey: clavesBancos.conciliacion(cuentaBancariaId ?? '', fechaCorte),
    queryFn: ({ signal }) =>
      servicioBancos.conciliacion(
        { cuentaBancariaId: cuentaBancariaId!, fechaCorte, saldoBanco },
        { signal },
      ),
    enabled: Boolean(cuentaBancariaId) && Boolean(fechaCorte),
    staleTime: 0,
    gcTime: 0,
  })
}

export function useConciliaciones(cuentaBancariaId?: string) {
  return useQuery({
    queryKey: clavesBancos.conciliaciones(cuentaBancariaId),
    queryFn: ({ signal }) =>
      servicioBancos.listarConciliaciones({ cuentaBancariaId }, { signal }),
  })
}

/**
 * Emparejar, deshacer y cerrar.
 *
 * Ninguna de las tres toca el mayor: casar dos registros no es un hecho
 * económico y cerrar tampoco. Lo que cambian es el estado de los movimientos,
 * así que invalidan el módulo y nada más.
 */
export function useConciliar() {
  const cliente = useQueryClient()
  const invalidar = () => {
    void cliente.invalidateQueries({ queryKey: clavesBancos.todo })
  }

  const emparejar = useMutation({
    mutationFn: (solicitud: SolicitudEmparejamiento) =>
      servicioBancos.emparejar(solicitud),
    onSuccess: invalidar,
  })

  const deshacer = useMutation({
    mutationFn: (movimientoBancoId: string) =>
      servicioBancos.deshacerEmparejamiento(movimientoBancoId),
    onSuccess: invalidar,
  })

  const cerrar = useMutation({
    mutationFn: (solicitud: SolicitudCierreConciliacion) =>
      servicioBancos.cerrarConciliacion(solicitud),
    onSuccess: invalidar,
  })

  return { emparejar, deshacer, cerrar }
}

/* ------------------------------------------------------ Revaluación */

/**
 * Verificación previa de la revaluación (docs/06 §6).
 *
 * Mismo criterio que la depreciación y la amortización: se pide cuando alguien
 * la manda verificar, y no se cachea entre visitas porque depende del saldo
 * vigente de cada cuenta y del tipo de cambio de cierre.
 */
export function usePrevisualizacionRevaluacion(
  periodoId: string | undefined,
  habilitado: boolean,
) {
  return useQuery({
    queryKey: clavesBancos.revaluacion(periodoId ?? ''),
    queryFn: ({ signal }) =>
      servicioBancos.previsualizarRevaluacion(periodoId!, { signal }),
    enabled: habilitado && Boolean(periodoId),
    staleTime: 0,
    gcTime: 0,
  })
}

/**
 * Contabiliza la revaluación del periodo.
 *
 * Toca el mayor, así que invalida los asientos y la balanza además del módulo:
 * el saldo de la cuenta de control cambia y el auxiliar tiene que seguir
 * cuadrando contra él (docs/06 §4).
 */
export function useContabilizarRevaluacion() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (solicitud: SolicitudRevaluacion) =>
      servicioBancos.contabilizarRevaluacion(solicitud),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesBancos.todo })
      void cliente.invalidateQueries({ queryKey: ['conta', 'asientos'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'balanza'] })
      void cliente.invalidateQueries({ queryKey: ['conta', 'periodos'] })
    },
  })
}
