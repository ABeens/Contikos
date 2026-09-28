import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import {
  Lock,
  Menu as IconoMenu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { formatPeriodo } from '@/shared/format/fecha'
import { useEmpresa } from '../empresa'
import { SelectorEmpresa } from '@/modules/empresas/components/SelectorEmpresa'
import { CONFIGURACION, INICIO, MODULOS, type ItemMenu } from './menu'
import { PaletaComandos } from './PaletaComandos'

const CLAVE_PLEGADO = 'contikos:menu-plegado'

/** Preferencia de este navegador. Si el almacenamiento no está, se despliega. */
function leerPlegado(): boolean {
  try {
    return localStorage.getItem(CLAVE_PLEGADO) === '1'
  } catch {
    return false
  }
}

function guardarPlegado(plegado: boolean) {
  try {
    localStorage.setItem(CLAVE_PLEGADO, plegado ? '1' : '0')
  } catch {
    // Sin almacenamiento la preferencia dura lo que dure la pestaña.
  }
}

export function AppShell() {
  const { pathname } = useLocation()
  const [plegado, setPlegado] = useState(leerPlegado)
  const [menuMovil, setMenuMovil] = useState(false)
  const [paleta, setPaleta] = useState(false)
  const principal = useRef<HTMLElement>(null)

  // Cada pantalla empieza arriba, y el menú del móvil se retira al llegar.
  useEffect(() => {
    if (principal.current) principal.current.scrollTop = 0
    setMenuMovil(false)
  }, [pathname])

  // Ctrl+K (o Cmd+K) abre el buscador desde cualquier pantalla.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaleta((v) => !v)
      }
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [])

  const alternarPlegado = () => {
    setPlegado((v) => {
      guardarPlegado(!v)
      return !v
    })
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-slate-50">
      {/* Fondo del menú en móvil: un toque fuera lo cierra. */}
      {menuMovil && (
        <div
          aria-hidden
          onClick={() => setMenuMovil(false)}
          className="fixed inset-0 z-30 animate-aparecer bg-slate-900/40 backdrop-blur-[2px] lg:hidden"
        />
      )}
      <Sidebar
        plegado={plegado}
        abiertoMovil={menuMovil}
        onAlternarPlegado={alternarPlegado}
        onCerrarMovil={() => setMenuMovil(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onAbrirMenu={() => setMenuMovil(true)}
          onBuscar={() => setPaleta(true)}
        />
        <main
          ref={principal}
          className="flex-1 overflow-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-6"
        >
          {/* La clave reinicia la animación de entrada en cada pantalla. */}
          <div key={pathname} className="animate-subir">
            <Outlet />
          </div>
        </main>
      </div>
      <PaletaComandos abierta={paleta} onCambiar={setPaleta} />
    </div>
  )
}

function Sidebar({
  plegado,
  abiertoMovil,
  onAlternarPlegado,
  onCerrarMovil,
}: {
  plegado: boolean
  abiertoMovil: boolean
  onAlternarPlegado: () => void
  onCerrarMovil: () => void
}) {
  const { pathname } = useLocation()
  // Un módulo está abierto cuando se está dentro de él. No hay estado que
  // recordar: la ruta ya dice dónde está el usuario.
  const enModulo = (ruta: string) =>
    pathname === ruta || pathname.startsWith(`${ruta}/`)
  // En el móvil el menú siempre va desplegado: es un cajón con sitio de sobra.
  const compacto = plegado && !abiertoMovil

  return (
    <aside
      aria-label="Menú principal"
      className={cn(
        'flex shrink-0 flex-col bg-slate-900 text-slate-300 transition-[width,transform,visibility] duration-200 ease-out',
        // Móvil: cajón que entra desde la izquierda.
        'fixed inset-y-0 left-0 z-40 w-64 lg:static lg:z-auto lg:translate-x-0',
        // Cerrado en el móvil tampoco recibe el foco: invisible, no solo fuera.
        abiertoMovil
          ? 'translate-x-0 shadow-flotante'
          : '-translate-x-full max-lg:invisible',
        compacto ? 'lg:w-[4.25rem]' : 'lg:w-60',
      )}
    >
      <div
        className={cn(
          'flex h-14 shrink-0 items-center gap-2.5 border-b border-white/5',
          compacto ? 'justify-center px-2' : 'px-4',
        )}
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white shadow-sm shadow-brand-900/40">
          C
        </div>
        {!compacto && (
          <span className="flex-1 truncate text-[15px] font-semibold tracking-tight text-white">
            Contikos
          </span>
        )}
        <button
          type="button"
          onClick={onCerrarMovil}
          aria-label="Cerrar menú"
          className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
        >
          <X className="size-4" />
        </button>
      </div>

      <nav
        className={cn(
          'flex-1 overflow-x-hidden overflow-y-auto py-3',
          compacto ? 'px-2' : 'px-3',
        )}
      >
        <ItemNav {...INICIO} exacto compacto={compacto} />
        <Seccion compacto={compacto}>Módulos</Seccion>
        <div className="flex flex-col gap-0.5">
          {MODULOS.map((m) => (
            <Modulo
              key={m.ruta}
              modulo={m}
              abierto={enModulo(m.ruta)}
              compacto={compacto}
            />
          ))}
        </div>
        <Seccion compacto={compacto}>Empresa</Seccion>
        <ItemNav {...CONFIGURACION} compacto={compacto} />
      </nav>

      <div
        className={cn(
          'hidden shrink-0 border-t border-white/5 p-2 lg:block',
          compacto && 'flex justify-center',
        )}
      >
        <button
          type="button"
          onClick={onAlternarPlegado}
          aria-label={plegado ? 'Desplegar menú' : 'Plegar menú'}
          title={plegado ? 'Desplegar menú' : 'Plegar menú'}
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-white',
            !compacto && 'w-full',
          )}
        >
          {plegado ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
          {!compacto && 'Plegar menú'}
        </button>
      </div>
    </aside>
  )
}

function Seccion({
  compacto,
  children,
}: {
  compacto: boolean
  children: string
}) {
  if (compacto) return <div className="mx-2 my-3 border-t border-white/5" />
  return (
    <p className="mt-5 mb-1.5 px-3 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
      {children}
    </p>
  )
}

function Modulo({
  modulo,
  abierto,
  compacto,
}: {
  modulo: ItemMenu
  abierto: boolean
  compacto: boolean
}) {
  const hijos = modulo.hijos
  return (
    <div>
      <ItemNav {...modulo} compacto={compacto} />
      {/* El submenú se despliega con una transición de altura (grid 0fr a
          1fr): se ve abrirse, en vez de empujar el resto de golpe. */}
      {hijos && !compacto && (
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-200 ease-out',
            abierto ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
        >
          <div className="overflow-hidden">
            {abierto && (
              <div className="mt-1 mb-2 ml-[1.35rem] flex flex-col gap-px border-l border-white/10 pl-3">
                {hijos.map((h) => (
                  <SubItemNav
                    key={h.ruta}
                    {...h}
                    exacto={requiereCoincidenciaExacta(h.ruta, modulo)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ItemNav({
  ruta,
  etiqueta,
  icono: Icono,
  descripcion,
  exacto,
  compacto,
}: ItemMenu & { exacto?: boolean; compacto?: boolean }) {
  return (
    <NavLink
      to={ruta}
      end={exacto}
      title={compacto ? etiqueta : descripcion}
      aria-label={compacto ? etiqueta : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-lg py-2 text-sm transition-colors',
          compacto ? 'justify-center px-0' : 'px-3',
          isActive
            ? 'bg-white/10 font-medium text-white'
            : 'text-slate-400 hover:bg-white/5 hover:text-white',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Marca de la pantalla actual: una barra, no un bloque de color. */}
          <span
            aria-hidden
            className={cn(
              'absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-brand-400 transition-opacity',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
          />
          <Icono
            className={cn(
              'size-[18px] shrink-0 transition-colors',
              isActive ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300',
            )}
          />
          {!compacto && <span className="truncate">{etiqueta}</span>}
        </>
      )}
    </NavLink>
  )
}

/**
 * Un subítem se marca solo con su ruta exacta cuando otra pantalla del mismo
 * menú cuelga de ella.
 *
 * `/cxc` (Saldos por cobrar) es prefijo de `/cxc/facturas`, y
 * `/bancos/movimientos` lo es de `/bancos/movimientos/nuevo`: sin esto el menú
 * marcaba dos pantallas a la vez. Donde el prefijo no es otro subítem se deja
 * sin `end` a propósito: `/cxc/facturas/123` es el listado de facturas con una
 * abierta, y debe seguir marcando "Facturas de venta".
 */
function requiereCoincidenciaExacta(ruta: string, modulo: ItemMenu): boolean {
  return (
    ruta === modulo.ruta ||
    (modulo.hijos ?? []).some(
      (otro) => otro.ruta !== ruta && otro.ruta.startsWith(`${ruta}/`),
    )
  )
}

function SubItemNav({
  ruta,
  etiqueta,
  exacto,
}: {
  ruta: string
  etiqueta: string
  exacto?: boolean
}) {
  return (
    <NavLink
      to={ruta}
      end={exacto}
      className={({ isActive }) =>
        cn(
          'rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
          isActive
            ? 'bg-white/5 font-medium text-white'
            : 'text-slate-400 hover:bg-white/5 hover:text-white',
        )
      }
    >
      {etiqueta}
    </NavLink>
  )
}

function Topbar({
  onAbrirMenu,
  onBuscar,
}: {
  onAbrirMenu: () => void
  onBuscar: () => void
}) {
  const { periodos, periodoActivo, setPeriodoActivo } = useEmpresa()
  const esMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200/80 bg-white/80 px-3 backdrop-blur sm:gap-3 sm:px-6">
      <button
        type="button"
        onClick={onAbrirMenu}
        aria-label="Abrir menú"
        className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
      >
        <IconoMenu className="size-5" />
      </button>

      {/* La cédula jurídica y la moneda funcional viven en Configuración: son
          dato de la empresa, no algo que haya que releer en cada pantalla. */}
      <div className="min-w-0 flex-1 sm:flex-none">
        <SelectorEmpresa />
      </div>

      <button
        type="button"
        onClick={onBuscar}
        aria-label="Buscar pantalla o acción"
        aria-keyshortcuts="Control+K"
        className="ml-auto flex h-9 items-center gap-2 rounded-lg bg-slate-100/80 px-2.5 text-sm text-slate-500 ring-1 ring-slate-200/80 transition-colors ring-inset hover:bg-slate-100 hover:text-slate-700 sm:w-64 md:w-72"
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden flex-1 truncate text-left sm:inline">
          Buscar pantalla o acción…
        </span>
        <kbd className="hidden rounded-md bg-white px-1.5 py-0.5 font-sans text-[11px] font-medium text-slate-400 ring-1 ring-slate-200 sm:inline">
          {esMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>

      <div className="flex items-center gap-2">
        <label
          htmlFor="periodo-activo"
          className="sr-only text-xs font-medium text-slate-500 md:not-sr-only"
        >
          Periodo
        </label>
        <select
          id="periodo-activo"
          value={periodoActivo?.id ?? ''}
          onChange={(e) => setPeriodoActivo(e.target.value)}
          className="h-9 max-w-40 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 shadow-suave transition-colors hover:border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none sm:max-w-none"
        >
          {periodos.map((p) => (
            <option key={p.id} value={p.id}>
              {formatPeriodo(p.ejercicio, p.numero)}
              {p.estado !== 'abierto' ? ` (${p.estado})` : ''}
            </option>
          ))}
        </select>
        {periodoActivo && periodoActivo.estado !== 'abierto' && (
          <span
            className="hidden items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 ring-inset sm:inline-flex"
            title="No se pueden contabilizar asientos en este periodo"
          >
            <Lock className="size-3" />
            Solo lectura
          </span>
        )}
      </div>
    </header>
  )
}
