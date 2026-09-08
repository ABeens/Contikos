import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePeriodos } from '@/modules/conta/api/queries'
import { useMonedas } from '@/modules/config/api/queries'
import { useEmpresas } from '@/modules/empresas/api/queries'
import { empresasAbribles } from '@/modules/empresas/domain/empresa'
import { restablecerMonedas } from '@/shared/money/money'
import { empresaActiva, establecerEmpresaActiva } from '@/shared/almacen/almacen'
import { ContextoEmpresaReact, type ContextoEmpresa } from './empresa'

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
 * Al cambiar de empresa vuelve a esperar: el catálogo de monedas es de cada
 * empresa, y mientras llega el nuevo no hay nada correcto que enseñar.
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

  const cambiarEmpresa = useCallback(
    async (id: string) => {
      if (id === empresaId) return
      // Primero el almacén: a partir de aquí los servicios mandan la nueva
      // cabecera y el mock sirve la nueva empresa.
      establecerEmpresaActiva(id)
      // El registro de monedas es de la empresa anterior hasta que llegue el
      // catálogo de la nueva; entre tanto, el de fábrica.
      restablecerMonedas()
      setPeriodoId(null)
      setEmpresaId(id)
      // Toda la caché es de la otra empresa. Reiniciar en vez de invalidar:
      // invalidar seguiría enseñando lo viejo mientras llega lo nuevo.
      await cliente.resetQueries()
    },
    [cliente, empresaId],
  )

  /**
   * La empresa recordada puede haber dejado de existir o de estar activa
   * (otra sesión la desactivó). Se entra en la primera que se pueda abrir en
   * vez de quedarse en una que ya no se ofrece.
   */
  useEffect(() => {
    if (!empresas?.length) return
    if (empresas.some((e) => e.id === empresaId && e.activa)) return
    const abrible = empresasAbribles(empresas, empresaId)[0]
    if (abrible && abrible.id !== empresaId) void cambiarEmpresa(abrible.id)
  }, [empresas, empresaId, cambiarEmpresa])

  const empresa = empresas?.find((e) => e.id === empresaId)

  const valor = useMemo<ContextoEmpresa | null>(
    () =>
      empresa
        ? {
            empresa,
            empresas: empresas ?? [],
            cambiarEmpresa,
            periodos: periodos ?? [],
            periodoActivo: periodos?.find((p) => p.id === periodoId),
            setPeriodoActivo: setPeriodoId,
            cargando: isLoading,
          }
        : null,
    [empresa, empresas, cambiarEmpresa, periodos, periodoId, isLoading],
  )

  if (!valor) {
    return (
      <Cargando
        mensaje={
          cargandoEmpresas || !empresas
            ? 'Cargando empresas…'
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
