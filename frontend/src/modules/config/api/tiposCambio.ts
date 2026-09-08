import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { servicioConfig } from '@/shared/api/servicios'
import type { SolicitudTipoCambio } from '@/shared/api/contracts/config'
import { useTipoCambioVigente } from '@/shared/api/catalogos'

/**
 * Consultas de la tabla de tipos de cambio con fecha (docs/13 §7, docs/10 §2).
 *
 * Van en su propio archivo y no en `queries.ts` porque son otra entidad: el
 * catálogo de monedas es un dato de configuración que cambia una vez al año, y
 * la serie de tipos de cambio es un histórico que crece todos los días. Mezclar
 * sus claves de caché haría que capturar una tasa invalidara el catálogo entero.
 */

export const clavesTiposCambio = {
  todo: ['config', 'tipos-cambio'] as const,
  serie: (moneda: string, desde?: string, hasta?: string) =>
    ['config', 'tipos-cambio', 'serie', moneda, desde ?? '', hasta ?? ''] as const,
}

/**
 * El hook compartido que resuelve el tipo de cambio de una fecha vive en
 * `shared/api/catalogos` (lo necesitan CxC, CxP y conta, y un módulo no importa
 * de otro). Se reexporta para que dentro del módulo se lea como el resto.
 */
export { useTipoCambioVigente }

/** La serie de una moneda, opcionalmente acotada por fechas. */
export function useSerieTipoCambio(
  moneda: string,
  rango: { desde?: string; hasta?: string } = {},
) {
  return useQuery({
    queryKey: clavesTiposCambio.serie(moneda, rango.desde, rango.hasta),
    queryFn: ({ signal }) =>
      servicioConfig.serieTipoCambio(moneda, rango, { signal }),
    enabled: Boolean(moneda),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Captura manual de un tipo de cambio.
 *
 * Invalida la raíz entera y no solo la serie de esa moneda: el valor capturado
 * también cambia cuál es el vigente de cualquier fecha posterior que no tenga
 * el suyo, por la regla del último valor anterior.
 */
export function useRegistrarTipoCambio() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (solicitud: SolicitudTipoCambio) =>
      servicioConfig.registrarTipoCambio(solicitud),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesTiposCambio.todo })
    },
  })
}
