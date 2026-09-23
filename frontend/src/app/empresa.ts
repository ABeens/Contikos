import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { Periodo } from '@/shared/api/contracts/conta'
import type { Empresa } from '@/shared/api/contracts/empresas'

/**
 * Empresa y periodo activos.
 *
 * Multiempresa: el rol se asigna por empresa y los datos jamás se cruzan
 * (docs/01 §4.1). Ninguna pantalla asume que hay una sola: la empresa abierta
 * sale de aquí, cambiarla pasa por aquí, y todo lo que se tenía cargado de la
 * anterior se descarta al cambiar.
 *
 * El contexto y el hook viven aquí, separados del componente proveedor, para
 * no romper el fast refresh.
 */

/**
 * La moneda funcional NO vive aquí: es la marcada como tal en el catálogo de
 * monedas de cada empresa, que es configurable (`/configuracion/monedas`).
 * Guardarla también en la empresa daría dos representaciones del mismo hecho,
 * y tarde o temprano discreparían.
 */
export interface ContextoEmpresa {
  /** La abierta. Siempre hay una: sin empresa no hay aplicación. */
  empresa: Empresa
  /** Todas las del grupo, activas o no. Quien las lista decide qué enseña. */
  empresas: Empresa[]
  /**
   * Cambia de empresa en el acto.
   *
   * Descarta la caché (salvo el catálogo de empresas) y vuelve a pedir lo que
   * la pantalla necesite: un saldo de la empresa anterior en pantalla de la
   * nueva es un error contable, no un parpadeo. Resuelve cuando la nueva ya
   * contesta.
   *
   * Las pantallas NO la llaman: usan `useAbrirEmpresa`, que pasa antes por la
   * navegación al inicio para que un formulario con cambios pueda impedirlo.
   */
  cambiarEmpresa: (id: string) => Promise<void>
  /** Hay un cambio de empresa en curso. */
  cambiandoEmpresa: boolean
  periodos: Periodo[]
  periodoActivo: Periodo | undefined
  setPeriodoActivo: (id: string) => void
  cargando: boolean
}

export const ContextoEmpresaReact = createContext<ContextoEmpresa | null>(null)

export function useEmpresa(): ContextoEmpresa {
  const valor = useContext(ContextoEmpresaReact)
  if (!valor) {
    throw new Error('useEmpresa debe usarse dentro de <ProveedorEmpresa>')
  }
  return valor
}

/**
 * Estado de navegación con el que se pide abrir otra empresa.
 *
 * Viaja en `location.state` y no en la URL: no es un sitio al que se pueda
 * volver con el botón de atrás ni un enlace que se pueda compartir, es una
 * orden de un solo uso.
 */
export interface EstadoCambioEmpresa {
  cambiarEmpresa?: string
}

/**
 * Abre otra empresa desde cualquier pantalla.
 *
 * Navega al inicio PRIMERO y deja el cambio pedido en el estado de la
 * navegación. Si la pantalla abierta tiene un formulario con cambios
 * (`useAvisoSalida`), la navegación se bloquea y se pregunta; si el usuario
 * cancela, no se navega y por tanto no se cambia de empresa. Si se completa, la
 * pantalla vieja ya se desmontó cuando `useAplicarCambioEmpresa` hace el
 * cambio, y nadie pide datos de una empresa con la cabecera de otra.
 */
export function useAbrirEmpresa(): (id: string) => void {
  const navigate = useNavigate()
  return useCallback(
    (id: string) => {
      const estado: EstadoCambioEmpresa = { cambiarEmpresa: id }
      void navigate('/', { state: estado })
    },
    [navigate],
  )
}

/**
 * Ejecuta el cambio de empresa que `useAbrirEmpresa` dejó pedido.
 *
 * Tiene que vivir bajo el router (lee la ubicación) y montado en todas las
 * pantallas: lo llama el selector de empresa de la barra superior, que está
 * siempre. `ProveedorEmpresa` no sirve: envuelve al `RouterProvider`, no está
 * dentro de él.
 *
 * También saca de una empresa que quedó inactiva mientras se estaba en ella:
 * se pide abrir la primera activa por el mismo camino, así que un formulario
 * con cambios también puede detener esa salida.
 */
export function useAplicarCambioEmpresa(): void {
  const { empresa, empresas, cambiarEmpresa } = useEmpresa()
  const location = useLocation()
  const navigate = useNavigate()
  const abrirEmpresa = useAbrirEmpresa()
  const atendida = useRef<string | null>(null)

  const pedida = (location.state as EstadoCambioEmpresa | null)?.cambiarEmpresa

  useEffect(() => {
    if (!pedida) return
    // En modo estricto el efecto corre dos veces con la misma ubicación: la
    // clave de la entrada del historial evita cambiar de empresa dos veces.
    if (atendida.current === location.key) return
    atendida.current = location.key
    // La orden se borra antes de cumplirla. Si se quedara en la entrada del
    // historial, volver a ella con atrás y adelante repetiría el cambio.
    void navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    )
    void cambiarEmpresa(pedida)
  }, [pedida, location.key, location.pathname, location.search, navigate, cambiarEmpresa])

  // La primera ACTIVA, no la primera de la lista: si la inactiva era la
  // primera, la salida la volvía a elegir a ella misma y no se salía nunca.
  const salida = empresa.activa
    ? undefined
    : empresas.find((e) => e.activa && e.id !== empresa.id)?.id

  useEffect(() => {
    if (salida) abrirEmpresa(salida)
  }, [salida, abrirEmpresa])
}
