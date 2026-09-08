import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  servicioActivos,
  servicioConfig,
  servicioConta,
  servicioCxc,
  servicioCxp,
  servicioEmpresas,
  servicioImpuestos,
} from './servicios'
import type { AuxiliarTipo } from './contracts/comunes'
import type { Auxiliar } from '@/shared/auxiliares/auxiliar'
import { monedaFuncional } from '@/shared/money/money'

/**
 * Catálogos transversales: cuentas contables, periodos y auxiliares.
 *
 * Los administra `conta`, pero los consultan todos los módulos: CxC necesita la
 * cuenta de ingreso, CxP la de gasto, activos la contrapartida, y los tres
 * necesitan saber si el periodo está abierto antes de dejar capturar.
 *
 * Viven en `shared` y no en `modules/conta` por la regla de límites de docs/14
 * §3.1: un módulo no importa de otro. Las claves de caché son las mismas que
 * usa `conta`, así que el catálogo se descarga una vez para toda la aplicación.
 */

export const clavesCatalogo = {
  cuentas: ['conta', 'cuentas'] as const,
  periodos: ['conta', 'periodos'] as const,
  // Las tres siguientes son las claves de cxc, cxp y activos, escritas igual a
  // propósito: quien capture un asiento después de ver la lista de clientes no
  // vuelve a descargarla.
  clientes: ['cxc', 'clientes'] as const,
  proveedores: ['cxp', 'proveedores'] as const,
  activos: ['activos', 'lista', 'todas'] as const,
  directorio: ['empresas', 'directorio'] as const,
  // Misma raíz que usa `config` para invalidar al editar la tabla.
  impuestos: (fecha?: string) =>
    ['config', 'impuestos', fecha ?? 'todas'] as const,
  tipoCambioVigente: (moneda: string, fecha: string) =>
    ['config', 'tipos-cambio', 'vigente', moneda, fecha] as const,
}

/**
 * El tipo de cambio que rige en una fecha (docs/13 §7, docs/10 §2).
 *
 * El de ese día o el último anterior, que es lo que hace falta un domingo o un
 * feriado. Lo consultan los formularios que capturan un documento en moneda
 * extranjera (una factura, un asiento) para proponer el tipo de la FECHA DEL
 * DOCUMENTO y no el de hoy: lo que se contabiliza es el del día del hecho, y
 * una vez emitido queda congelado en el asiento.
 *
 * Vive aquí y no en `modules/config` por la regla de límites de docs/14 §3.1:
 * lo necesitan CxC, CxP y conta, y un módulo no importa de otro.
 *
 * No se pide para la moneda funcional: se cambia a sí misma a la par, y pedirlo
 * sería una llamada que solo puede contestar 1.
 *
 * TODO(robot): la consulta la dispara hoy quien la necesita. El robot de tipo
 * de cambio, en pausa, es el que un día la lanzará solo al cambiar la fecha del
 * documento, con la tabla poblada a diario desde la fuente oficial.
 */
export function useTipoCambioVigente(
  moneda: string | undefined,
  fecha: string | undefined,
) {
  const funcional = monedaFuncional()
  const habilitado = Boolean(moneda) && Boolean(fecha) && moneda !== funcional

  return useQuery({
    queryKey: clavesCatalogo.tipoCambioVigente(moneda ?? '', fecha ?? ''),
    queryFn: ({ signal }) =>
      servicioConfig.tipoCambioVigente(moneda!, fecha!, { signal }),
    enabled: habilitado,
    // El tipo de cambio de un día pasado ya no cambia, y el de hoy cambia una
    // vez al día: repreguntarlo dentro de la sesión no trae nada nuevo.
    staleTime: 60 * 60 * 1000,
  })
}

/**
 * Tabla de impuestos (docs/13 §3).
 *
 * Con fecha, solo las tarifas que rigen ese día: la captura de una factura
 * la llama con la FECHA DEL DOCUMENTO, para que una emisión de junio ofrezca
 * las tarifas de junio. Sin fecha, la tabla entera, que es lo que las listas
 * necesitan para nombrar la tarifa de un documento viejo.
 *
 * Vive aquí y no en `modules/config` por la regla de límites: la consultan
 * CxC y CxP, y un módulo no importa de otro.
 */
export function useTarifasImpuesto(fecha?: string) {
  return useQuery({
    queryKey: clavesCatalogo.impuestos(fecha),
    queryFn: ({ signal }) => servicioImpuestos.listar(fecha, { signal }),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Directorio de terceros del grupo (docs/12 D-12).
 *
 * Lo consultan los diálogos de cliente (cxc) y de proveedor (cxp) al dar de
 * alta, para tomar la identidad de un tercero que otra empresa del grupo ya
 * conoce. Vive aquí y no en `modules/empresas` por la regla de límites: un
 * módulo no importa de otro.
 *
 * Solo se pide cuando hay un alta en curso: es un catálogo del grupo entero y
 * no hace falta para nada más.
 */
export function useDirectorioTerceros(habilitado: boolean) {
  return useQuery({
    queryKey: clavesCatalogo.directorio,
    queryFn: ({ signal }) => servicioEmpresas.directorioTerceros({ signal }),
    enabled: habilitado,
    staleTime: 60 * 1000,
  })
}

export function useCuentas() {
  return useQuery({
    queryKey: clavesCatalogo.cuentas,
    queryFn: ({ signal }) => servicioConta.listarCuentas({ signal }),
    // El catálogo cambia poco y lo consultan casi todas las pantallas.
    staleTime: 5 * 60 * 1000,
  })
}

export function usePeriodos() {
  return useQuery({
    queryKey: clavesCatalogo.periodos,
    queryFn: ({ signal }) => servicioConta.listarPeriodos({ signal }),
    staleTime: 5 * 60 * 1000,
  })
}

export type AuxiliaresPorTipo = ReadonlyMap<AuxiliarTipo, Auxiliar[]>

/**
 * Catálogos de auxiliares, en la forma común de `shared/auxiliares`.
 *
 * Recibe qué tipos hacen falta y solo pide esos: un asiento contra bancos y
 * gastos no tiene por qué descargar la cartera de clientes. `empleado` y
 * `banco` no aparecen porque rh y bancos aún no tienen módulo (docs/11); quien
 * los necesite recibe un mapa sin esa entrada y captura el auxiliar a mano.
 */
export function useAuxiliares(
  tipos: readonly AuxiliarTipo[],
): AuxiliaresPorTipo {
  const clientes = useQuery({
    queryKey: clavesCatalogo.clientes,
    queryFn: ({ signal }) => servicioCxc.listarClientes({ signal }),
    staleTime: 60 * 1000,
    enabled: tipos.includes('cliente'),
  })

  const proveedores = useQuery({
    queryKey: clavesCatalogo.proveedores,
    queryFn: ({ signal }) => servicioCxp.listarProveedores({ signal }),
    staleTime: 60 * 1000,
    enabled: tipos.includes('proveedor'),
  })

  const activos = useQuery({
    queryKey: clavesCatalogo.activos,
    queryFn: ({ signal }) => servicioActivos.listar({}, { signal }),
    staleTime: 60 * 1000,
    enabled: tipos.includes('activo'),
  })

  return useMemo(() => {
    const mapa = new Map<AuxiliarTipo, Auxiliar[]>()
    mapa.set(
      'cliente',
      (clientes.data ?? []).map((c) => ({
        tipo: 'cliente' as const,
        id: c.id,
        codigo: c.codigo,
        nombre: c.razonSocial,
        // La cédula es lo que trae el documento que se está contabilizando:
        // se busca por ella tanto como por el nombre.
        identificacion: c.identificacion,
        activo: c.activo,
      })),
    )
    mapa.set(
      'proveedor',
      (proveedores.data ?? []).map((p) => ({
        tipo: 'proveedor' as const,
        id: p.id,
        codigo: p.codigo,
        nombre: p.razonSocial,
        identificacion: p.identificacion,
        activo: p.activo,
      })),
    )
    mapa.set(
      'activo',
      (activos.data ?? []).map((a) => ({
        tipo: 'activo' as const,
        id: a.id,
        codigo: a.codigo,
        nombre: a.nombre,
        // Un activo vendido o dado de baja ya no recibe movimientos, pero sigue
        // en el mayor: se resuelve si se teclea, no se ofrece si se busca.
        activo: a.estado === 'activo' || a.estado === 'totalmente_depreciado',
      })),
    )
    return mapa
  }, [clientes.data, proveedores.data, activos.data])
}
