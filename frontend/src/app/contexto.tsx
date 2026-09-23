import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient, type Query } from '@tanstack/react-query'
import { usePeriodos } from '@/modules/conta/api/queries'
import { consultaMonedas, useMonedas } from '@/modules/config/api/queries'
import { clavesEmpresas, useEmpresas } from '@/modules/empresas/api/queries'
import { restablecerMonedas } from '@/shared/money/money'
import { empresaActiva, establecerEmpresaActiva } from '@/shared/almacen/almacen'
import { ContextoEmpresaReact, type ContextoEmpresa } from './empresa'

function esClaveMonedas(clave: readonly unknown[]): boolean {
  return clave.length === consultaMonedas.queryKey.length &&
    consultaMonedas.queryKey.every((parte, i) => clave[i] === parte)
}

function Cargando({ mensaje }: { mensaje: string }) {
  return (
    <div className="grid h-screen place-items-center bg-slate-50 text-sm text-slate-500">
      {mensaje}
    </div>
  )
}

/**
 * Espera al catálogo de monedas antes de montar la aplicación.
 *
 * `formatMoney` lee el catálogo de forma sincrónica. Si la aplicación se
 * montara antes, el primer render usaría el catálogo por defecto y los importes
 * cambiarían de aspecto a mitad de carga; en una pantalla contable eso se lee
 * como un error de datos.
 *
 * Si la petición falla, se monta igual: el catálogo por defecto es un respaldo
 * razonable y es preferible a una pantalla en blanco.
 *
 * Al cambiar de empresa normalmente NO vuelve a esperar: `cambiarEmpresa`
 * trae el catálogo de la nueva antes de soltar la caché, así que la consulta
 * nunca queda sin datos. Solo si esa lectura falla se reinicia con el resto, y
 * entonces sí se espera: el catálogo es de cada empresa, y mientras llega el
 * nuevo no hay nada correcto que enseñar.
 */
export function ProveedorMonedas({ children }: { children: ReactNode }) {
  const { isLoading } = useMonedas()

  if (isLoading) return <Cargando mensaje="Cargando configuración…" />

  return <>{children}</>
}

export function ProveedorEmpresa({ children }: { children: ReactNode }) {
  const cliente = useQueryClient()
  const { data: empresas, isLoading: cargandoEmpresas } = useEmpresas()
  const { data: periodos, isLoading } = usePeriodos()
  const [empresaId, setEmpresaId] = useState(() => empresaActiva())
  const [periodoId, setPeriodoId] = useState<string | null>(null)

  useEffect(() => {
    if (periodoId || !periodos?.length) return
    // Por defecto, el primer periodo abierto: es donde se va a capturar.
    const abierto = periodos.find((p) => p.estado === 'abierto')
    setPeriodoId((abierto ?? periodos[periodos.length - 1]).id)
  }, [periodos, periodoId])

  const [cambiandoEmpresa, setCambiandoEmpresa] = useState(false)

  /**
   * Cambia de empresa YA, sin preguntar a la pantalla abierta.
   *
   * No se llama desde las pantallas: se llega aquí a través de
   * `useAbrirEmpresa`, que primero navega al inicio (y deja que un formulario
   * con cambios lo impida) y solo si la navegación se completa pide el cambio.
   * Hacerlo al revés dejaba la pantalla vieja montada, pidiendo sus datos a la
   * empresa nueva mientras se reiniciaba la caché.
   */
  const cambiarEmpresa = useCallback(
    async (id: string) => {
      if (id === empresaActiva()) return
      setCambiandoEmpresa(true)
      try {
        // Primero el almacén: a partir de aquí los servicios mandan la nueva
        // cabecera y el mock sirve la nueva empresa.
        establecerEmpresaActiva(id)

        // El catálogo de monedas de la nueva se trae ANTES de soltar la caché.
        // Si se reiniciara con el resto, `ProveedorMonedas` volvería a su
        // pantalla de carga y desmontaría la aplicación entera (router
        // incluido) durante el cambio: un parpadeo completo que además
        // perdería el foco y el scroll de la barra lateral.
        let monedasListas = true
        try {
          await cliente.fetchQuery({ ...consultaMonedas, staleTime: 0 })
        } catch {
          // Sin catálogo nuevo, el de fábrica: mejor que el de la otra empresa.
          restablecerMonedas()
          monedasListas = false
        }

        setPeriodoId(null)
        setEmpresaId(id)

        // Todo lo demás es de la otra empresa. Reiniciar en vez de invalidar:
        // invalidar seguiría enseñando lo viejo mientras llega lo nuevo. El
        // catálogo de empresas es del grupo y sobrevive: reiniciarlo haría que
        // este mismo proveedor volviera a "Cargando empresas…".
        await cliente.resetQueries({
          predicate: (q: Query) =>
            q.queryKey[0] !== clavesEmpresas.todo[0] &&
            (!monedasListas || !esClaveMonedas(q.queryKey)),
        })
      } finally {
        setCambiandoEmpresa(false)
      }
    },
    [cliente],
  )

  /**
   * La empresa recordada puede haber dejado de existir (otro navegador la
   * borró, o el almacén se restableció). Sin ella no hay nada montado que
   * proteger, así que se entra directamente en la primera activa.
   *
   * La que existe pero quedó inactiva no se resuelve aquí sino bajo el router
   * (`useAplicarCambioEmpresa`): hay una pantalla abierta, y salir de ella
   * pasa por navegar al inicio como cualquier otro cambio.
   */
  useEffect(() => {
    if (!empresas?.length) return
    if (empresas.some((e) => e.id === empresaId)) return
    const activa = empresas.find((e) => e.activa)
    if (activa) void cambiarEmpresa(activa.id)
  }, [empresas, empresaId, cambiarEmpresa])

  const empresa = empresas?.find((e) => e.id === empresaId)

  const valor = useMemo<ContextoEmpresa | null>(
    () =>
      empresa
        ? {
            empresa,
            empresas: empresas ?? [],
            cambiarEmpresa,
            cambiandoEmpresa,
            periodos: periodos ?? [],
            periodoActivo: periodos?.find((p) => p.id === periodoId),
            setPeriodoActivo: setPeriodoId,
            cargando: isLoading,
          }
        : null,
    [
      empresa,
      empresas,
      cambiarEmpresa,
      cambiandoEmpresa,
      periodos,
      periodoId,
      isLoading,
    ],
  )

  if (!valor) {
    return (
      <Cargando
        mensaje={
          cargandoEmpresas || !empresas
            ? 'Cargando empresas…'
            : empresas.some((e) => e.activa)
              ? 'Abriendo empresa…'
              : 'No hay ninguna empresa activa a la que entrar.'
        }
      />
    )
  }

  return (
    <ContextoEmpresaReact.Provider value={valor}>
      {children}
    </ContextoEmpresaReact.Provider>
  )
}
