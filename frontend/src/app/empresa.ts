import { createContext, useContext } from 'react'
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
   * Abre otra empresa.
   *
   * Descarta la caché entera y vuelve a pedir lo que la pantalla necesite: un
   * saldo de la empresa anterior en pantalla de la nueva es un error contable,
   * no un parpadeo. Resuelve cuando la nueva ya contesta.
   */
  cambiarEmpresa: (id: string) => Promise<void>
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
