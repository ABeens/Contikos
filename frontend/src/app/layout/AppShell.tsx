import { NavLink, Outlet, useLocation } from 'react-router'
import {
  BookOpen,
  Building2,
  CalendarClock,
  ChartColumn,
  Landmark,
  LayoutDashboard,
  Lock,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { formatPeriodo } from '@/shared/format/fecha'
import { useEmpresa } from '../empresa'
import { SelectorEmpresa } from '@/modules/empresas/components/SelectorEmpresa'

interface ItemMenu {
  ruta: string
  etiqueta: string
  icono: LucideIcon
  descripcion: string
  /**
   * Pantallas del módulo. Se despliegan solo dentro del módulo activo.
   *
   * Enseñar las veintitantas pantallas del sistema a la vez no ayuda a
   * navegar: convierte el menú en un índice que hay que leer entero. Dentro de
   * un módulo, en cambio, sus pantallas son pocas y sí orientan.
   */
  hijos?: { ruta: string; etiqueta: string }[]
}

/** Los siete módulos del diagrama. `conta` es el hub; el resto lo alimenta. */
const MODULOS: ItemMenu[] = [
  {
    ruta: '/conta',
    etiqueta: 'Contabilidad',
    icono: BookOpen,
    descripcion: 'Catálogo, clasificación NIIF, asientos, periodos',
    hijos: [
      { ruta: '/conta/cuentas', etiqueta: 'Catálogo de cuentas' },
      { ruta: '/conta/clasificaciones', etiqueta: 'Clasificación NIIF' },
      { ruta: '/conta/asientos', etiqueta: 'Asientos' },
      { ruta: '/conta/balanza', etiqueta: 'Balanza de comprobación' },
      { ruta: '/conta/periodos', etiqueta: 'Periodos' },
    ],
  },
  {
    ruta: '/cxc',
    etiqueta: 'Cuentas por cobrar',
    icono: Receipt,
    descripcion: 'Clientes, facturas, cobros',
    hijos: [
      { ruta: '/cxc', etiqueta: 'Saldos por cobrar' },
      { ruta: '/cxc/facturas', etiqueta: 'Facturas de venta' },
      { ruta: '/cxc/cobros', etiqueta: 'Cobros' },
      { ruta: '/cxc/clientes', etiqueta: 'Clientes' },
      { ruta: '/cxc/items', etiqueta: 'Productos y servicios' },
    ],
  },
  {
    ruta: '/cxp',
    etiqueta: 'Cuentas por pagar',
    icono: ShoppingCart,
    descripcion: 'Proveedores, compras, pagos',
    hijos: [
      { ruta: '/cxp', etiqueta: 'Saldos por pagar' },
      { ruta: '/cxp/facturas', etiqueta: 'Facturas de gasto' },
      { ruta: '/cxp/pagos', etiqueta: 'Pagos' },
      { ruta: '/cxp/propuesta', etiqueta: 'Propuesta de pago' },
      { ruta: '/cxp/proveedores', etiqueta: 'Proveedores' },
    ],
  },
  {
    ruta: '/bancos',
    etiqueta: 'Bancos',
    icono: Landmark,
    descripcion: 'Movimientos y conciliación',
  },
  {
    ruta: '/activos',
    etiqueta: 'Activos fijos',
    icono: Building2,
    descripcion: 'Altas, depreciación, bajas',
    hijos: [
      { ruta: '/activos', etiqueta: 'Inventario de activos' },
      { ruta: '/activos/nuevo', etiqueta: 'Registrar activo' },
      { ruta: '/activos/depreciacion', etiqueta: 'Depreciación' },
      { ruta: '/activos/categorias', etiqueta: 'Categorías' },
    ],
  },
  {
    // No es uno de los siete del diagrama: es un proceso de cierre del propio
    // mayor (docs/15). Va con los módulos porque desde aquí se navega, y su
    // asiento se firma como `conta`, que es donde vive el proceso.
    ruta: '/diferidos',
    etiqueta: 'Asientos diferidos',
    icono: CalendarClock,
    descripcion: 'Gastos e ingresos reconocidos a lo largo de varios periodos',
    hijos: [
      { ruta: '/diferidos', etiqueta: 'Auxiliar de diferidos' },
      { ruta: '/diferidos/nuevo', etiqueta: 'Registrar diferido' },
      { ruta: '/diferidos/amortizacion', etiqueta: 'Amortización' },
    ],
  },
  {
    ruta: '/rh',
    etiqueta: 'Recursos humanos',
    icono: Users,
    descripcion: 'Empleados y planilla',
  },
  {
    ruta: '/reportes',
    etiqueta: 'Reportes',
    icono: ChartColumn,
    descripcion: 'Estados financieros',
  },
]

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-auto px-6 py-5">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function Sidebar() {
  const { pathname } = useLocation()
  // Un módulo está abierto cuando se está dentro de él. No hay estado que
  // recordar: la ruta ya dice dónde está el usuario.
  const enModulo = (ruta: string) =>
    pathname === ruta || pathname.startsWith(`${ruta}/`)

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-300">
      <div className="flex h-14 items-center gap-2 border-b border-slate-800 px-4">
        <div className="grid size-7 place-items-center rounded bg-brand-500 text-sm font-bold text-white">
          C
        </div>
        <span className="text-sm font-semibold tracking-tight text-white">
          Contikos
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <ItemNav
          ruta="/"
          etiqueta="Inicio"
          icono={LayoutDashboard}
          descripcion="Resumen"
          exacto
        />
        <p className="mt-4 mb-1 px-3 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          Módulos
        </p>
        {MODULOS.map((m) => (
          <div key={m.ruta}>
            <ItemNav {...m} />
            {m.hijos && enModulo(m.ruta) && (
              <div className="mt-0.5 mb-1 ml-6 flex flex-col border-l border-slate-800 pl-2">
                {m.hijos.map((h) => (
                  <SubItemNav key={h.ruta} {...h} />
                ))}
              </div>
            )}
          </div>
        ))}

        <p className="mt-4 mb-1 px-3 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          Empresa
        </p>
        <ItemNav
          ruta="/configuracion"
          etiqueta="Configuración"
          icono={Settings}
          descripcion="Empresas, monedas, periodos, usuarios"
        />
      </nav>
    </aside>
  )
}

function ItemNav({
  ruta,
  etiqueta,
  icono: Icono,
  descripcion,
  exacto,
}: ItemMenu & { exacto?: boolean }) {
  return (
    <NavLink
      to={ruta}
      end={exacto}
      title={descripcion}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-brand-600 font-medium text-white'
            : 'text-slate-300 hover:bg-slate-800 hover:text-white',
        )
      }
    >
      <Icono className="size-4 shrink-0" />
      <span className="truncate">{etiqueta}</span>
    </NavLink>
  )
}

function SubItemNav({ ruta, etiqueta }: { ruta: string; etiqueta: string }) {
  return (
    <NavLink
      to={ruta}
      className={({ isActive }) =>
        cn(
          'rounded px-2 py-1 text-xs transition-colors',
          isActive
            ? 'font-medium text-white'
            : 'text-slate-400 hover:text-white',
        )
      }
    >
      {etiqueta}
    </NavLink>
  )
}

function Topbar() {
  const { periodos, periodoActivo, setPeriodoActivo } = useEmpresa()

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6">
      {/* La cédula jurídica y la moneda funcional viven en Configuración: son
          dato de la empresa, no algo que haya que releer en cada pantalla. */}
      <SelectorEmpresa />

      <div className="flex items-center gap-2">
        <label
          htmlFor="periodo-activo"
          className="text-xs font-medium text-slate-500"
        >
          Periodo
        </label>
        <select
          id="periodo-activo"
          value={periodoActivo?.id ?? ''}
          onChange={(e) => setPeriodoActivo(e.target.value)}
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm"
        >
          {periodos.map((p) => (
            <option key={p.id} value={p.id}>
              {formatPeriodo(p.ejercicio, p.numero)}
              {p.estado !== 'abierto' ? ` — ${p.estado}` : ''}
            </option>
          ))}
        </select>
        {periodoActivo && periodoActivo.estado !== 'abierto' && (
          <span
            className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 ring-inset"
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
