import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { servicioConfig, servicioImpuestos } from '@/shared/api/servicios'
import type {
  MonedaConfig,
  SolicitudMoneda,
} from '@/shared/api/contracts/config'
import type { SolicitudTarifaImpuesto } from '@/shared/api/contracts/impuestos'
import { registrarMonedas } from '@/shared/money/money'
import { useTarifasImpuesto } from '@/shared/api/catalogos'

/**
 * Único punto del módulo que habla con el servidor.
 *
 * Los componentes usan estos hooks y nunca `fetch`. Qué se pide lo describe
 * `shared/api/servicios`; aquí solo se decide cuándo pedirlo y qué invalidar
 * después (docs/14 §2).
 */

export const clavesConfig = {
  todo: ['config'] as const,
  monedas: ['config', 'monedas'] as const,
  tipoCambio: ['config', 'tipo-cambio'] as const,
  impuestos: ['config', 'impuestos'] as const,
}

/* ------------------------------------------------------------- Impuestos */

/**
 * La tabla de impuestos se lee con el hook compartido de `shared/api/catalogos`
 * (CxC y CxP la necesitan y no pueden importar de aquí). Se reexporta para
 * que dentro del módulo se lea como el resto de sus consultas.
 */
export { useTarifasImpuesto }

function invalidarImpuestos(cliente: ReturnType<typeof useQueryClient>) {
  // Cualquier fecha consultada puede haber cambiado: se invalida la raíz.
  void cliente.invalidateQueries({ queryKey: clavesConfig.impuestos })
}

export function useGuardarTarifaImpuesto() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      datos,
      id,
    }: {
      datos: SolicitudTarifaImpuesto
      /** Sin id se da de alta. */
      id?: string
    }) =>
      id ? servicioImpuestos.actualizar(id, datos) : servicioImpuestos.crear(datos),
    onSuccess: () => invalidarImpuestos(cliente),
  })
}

export function useEliminarTarifaImpuesto() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => servicioImpuestos.eliminar(id),
    onSuccess: () => invalidarImpuestos(cliente),
  })
}

/**
 * Catálogo de monedas.
 *
 * El registro sincrónico de `shared/money` se hidrata dentro de la queryFn, no
 * en un efecto: para cuando un componente ve estos datos, `formatMoney` ya
 * conoce el catálogo. Con un efecto habría un render intermedio donde los
 * importes se formatean con el catálogo anterior.
 */
export function useMonedas() {
  return useQuery({
    queryKey: clavesConfig.monedas,
    queryFn: async ({ signal }) => {
      const monedas = await servicioConfig.listarMonedas({ signal })
      registrarMonedas(monedas)
      return monedas
    },
    // El catálogo cambia poquísimo y lo necesita cada importe en pantalla.
    staleTime: 30 * 60 * 1000,
  })
}

function invalidarMonedas(cliente: ReturnType<typeof useQueryClient>) {
  // Cambiar una moneda cambia cómo se presenta todo lo que está expresado en
  // ella, así que se refresca el catálogo y se descarta lo ya formateado.
  void cliente.invalidateQueries({ queryKey: clavesConfig.monedas })
  void cliente.invalidateQueries({ queryKey: ['conta'] })
}

export function useGuardarMoneda() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: ({
      moneda,
      creando,
    }: {
      moneda: SolicitudMoneda
      creando: boolean
    }) =>
      creando
        ? servicioConfig.crearMoneda(moneda)
        : servicioConfig.actualizarMoneda(moneda.codigo, moneda),
    onSuccess: () => invalidarMonedas(cliente),
  })
}

export function useEstablecerMonedaFuncional() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (codigo: string) =>
      servicioConfig.establecerMonedaFuncional(codigo),
    onSuccess: (monedas: MonedaConfig[]) => {
      registrarMonedas(monedas)
      invalidarMonedas(cliente)
    },
  })
}

export function useEliminarMoneda() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (codigo: string) => servicioConfig.eliminarMoneda(codigo),
    onSuccess: () => invalidarMonedas(cliente),
  })
}

/**
 * Tipos de cambio del día publicados por la fuente oficial (docs/13 §7).
 *
 * No se consulta al entrar en la pantalla sino cuando el usuario lo pide:
 * traerlo solo tiene sentido si va a aplicarse, y hasta que lo aplique el
 * catálogo sigue siendo el que está guardado.
 */
export function useTipoCambioDelDia(habilitado: boolean) {
  return useQuery({
    queryKey: clavesConfig.tipoCambio,
    queryFn: ({ signal }) => servicioConfig.tipoCambioDelDia({ signal }),
    enabled: habilitado,
    // La fuente publica una vez al día: repreguntar dentro de la sesión no
    // trae nada nuevo.
    staleTime: 60 * 60 * 1000,
  })
}

/**
 * Lleva al catálogo el tipo de cambio de varias monedas.
 *
 * En serie y no en paralelo a propósito: cada alta se valida contra el catálogo
 * entero (moneda funcional incluida), y dos peticiones simultáneas lo leerían
 * en el mismo estado. Son dos o tres monedas; el orden importa más que el
 * milisegundo.
 */
export function useAplicarTipoCambio() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: async (monedas: readonly SolicitudMoneda[]) => {
      const guardadas: MonedaConfig[] = []
      for (const moneda of monedas) {
        guardadas.push(
          await servicioConfig.actualizarMoneda(moneda.codigo, moneda),
        )
      }
      return guardadas
    },
    onSuccess: () => invalidarMonedas(cliente),
  })
}
