import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
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
 *
 * Las opciones se exportan aparte porque el cambio de empresa trae el catálogo
 * de la nueva ANTES de soltar la caché (`fetchQuery`), con la misma clave y la
 * misma función que usa el hook: dos definiciones acabarían discrepando.
 */
export const consultaMonedas = queryOptions({
  queryKey: clavesConfig.monedas,
  queryFn: async ({ signal }) => {
    const monedas = await servicioConfig.listarMonedas({ signal })
    registrarMonedas(monedas)
    return monedas
  },
  // El catálogo cambia poquísimo y lo necesita cada importe en pantalla.
  staleTime: 30 * 60 * 1000,
})

export function useMonedas() {
  return useQuery(consultaMonedas)
}

/**
 * Tras tocar el catálogo de monedas se invalida la caché ENTERA.
 *
 * Una moneda cambia cómo se presenta todo lo expresado en ella (decimales,
 * separadores), y la funcional cambia en qué se expresa el mayor, los saldos de
 * CxC y CxP, las series de tipo de cambio (que van en unidades de la funcional)
 * y la balanza. Enumerar raíces es la forma de olvidarse de una: antes solo se
 * invalidaba `conta` y la serie de tipos de cambio seguía en la moneda vieja.
 * El catálogo cambia una vez al año; el coste de refrescar todo es asumible.
 */
function invalidarMonedas(cliente: ReturnType<typeof useQueryClient>) {
  return cliente.invalidateQueries()
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
    onSuccess: () => void invalidarMonedas(cliente),
  })
}

export function useEstablecerMonedaFuncional() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (codigo: string) =>
      servicioConfig.establecerMonedaFuncional(codigo),
    onSuccess: (monedas: MonedaConfig[]) => {
      registrarMonedas(monedas)
      void invalidarMonedas(cliente)
    },
  })
}

export function useEliminarMoneda() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (codigo: string) => servicioConfig.eliminarMoneda(codigo),
    onSuccess: () => void invalidarMonedas(cliente),
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

/** Qué pasó con cada moneda al aplicar el tipo de cambio del día. */
export interface ResultadoTipoCambio {
  codigo: string
  /** La moneda como quedó guardada; ausente si falló. */
  guardada?: MonedaConfig
  error?: unknown
}

/**
 * Lleva al catálogo el tipo de cambio de varias monedas.
 *
 * En serie y no en paralelo a propósito: cada alta se valida contra el catálogo
 * entero (moneda funcional incluida), y dos peticiones simultáneas lo leerían
 * en el mismo estado. Son dos o tres monedas; el orden importa más que el
 * milisegundo.
 *
 * Un fallo en una moneda no detiene las demás ni se traga las que ya se
 * guardaron: el resultado dice moneda por moneda qué quedó y qué no. Antes, un
 * error a mitad de lista rechazaba la mutación entera y la pantalla no sabía
 * que la primera sí se había escrito.
 *
 * Se invalida en `onSettled` y no en `onSuccess`: haya ido como haya ido, el
 * catálogo del servidor pudo cambiar, y la caché no puede quedarse con el de
 * antes.
 */
export function useAplicarTipoCambio() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: async (
      monedas: readonly SolicitudMoneda[],
    ): Promise<ResultadoTipoCambio[]> => {
      const resultados: ResultadoTipoCambio[] = []
      for (const moneda of monedas) {
        try {
          resultados.push({
            codigo: moneda.codigo,
            guardada: await servicioConfig.actualizarMoneda(
              moneda.codigo,
              moneda,
            ),
          })
        } catch (error) {
          resultados.push({ codigo: moneda.codigo, error })
        }
      }
      return resultados
    },
    onSettled: () => invalidarMonedas(cliente),
  })
}
