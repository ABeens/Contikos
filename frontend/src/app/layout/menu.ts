import {
  BookOpen,
  Building2,
  CalendarClock,
  ChartColumn,
  Landmark,
  LayoutDashboard,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface ItemMenu {
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

export const INICIO: ItemMenu = {
  ruta: '/',
  etiqueta: 'Inicio',
  icono: LayoutDashboard,
  descripcion: 'Resumen',
}

/** Los siete módulos del diagrama. `conta` es el hub; el resto lo alimenta. */
export const MODULOS: ItemMenu[] = [
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
    descripcion: 'Cuentas, movimientos y conciliación',
    hijos: [
      { ruta: '/bancos', etiqueta: 'Cuentas y posición' },
      { ruta: '/bancos/movimientos', etiqueta: 'Movimientos' },
      { ruta: '/bancos/movimientos/nuevo', etiqueta: 'Registrar movimiento' },
      { ruta: '/bancos/estado-cuenta', etiqueta: 'Importar estado de cuenta' },
      { ruta: '/bancos/conciliacion', etiqueta: 'Conciliación' },
      { ruta: '/bancos/revaluacion', etiqueta: 'Revaluación' },
    ],
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

export const CONFIGURACION: ItemMenu = {
  ruta: '/configuracion',
  etiqueta: 'Configuración',
  icono: Settings,
  descripcion: 'Empresas, monedas, periodos, usuarios',
  hijos: [
    { ruta: '/configuracion', etiqueta: 'Resumen de la empresa' },
    { ruta: '/configuracion/empresas', etiqueta: 'Empresas' },
    { ruta: '/configuracion/monedas', etiqueta: 'Monedas' },
    { ruta: '/configuracion/tipos-cambio', etiqueta: 'Tipos de cambio' },
    { ruta: '/configuracion/impuestos', etiqueta: 'Impuestos' },
  ],
}

/**
 * Lo que más se hace en el día. Aparece en la portada y encabeza el buscador:
 * quien abre la aplicación casi siempre viene a registrar algo.
 */
export const ACCIONES_FRECUENTES: {
  ruta: string
  etiqueta: string
  descripcion: string
  icono: LucideIcon
}[] = [
  {
    ruta: '/conta/asientos/nuevo',
    etiqueta: 'Capturar asiento',
    descripcion: 'Partida doble manual en el mayor',
    icono: BookOpen,
  },
  {
    ruta: '/cxc/facturas/nueva',
    etiqueta: 'Facturar a un cliente',
    descripcion: 'Emite la factura y su cuenta por cobrar',
    icono: Receipt,
  },
  {
    ruta: '/cxp/facturas/nueva',
    etiqueta: 'Registrar factura de gasto',
    descripcion: 'Compra o gasto de un proveedor',
    icono: ShoppingCart,
  },
  {
    ruta: '/cxc/cobros/nuevo',
    etiqueta: 'Registrar cobro',
    descripcion: 'Dinero recibido de un cliente',
    icono: Receipt,
  },
  {
    ruta: '/cxp/pagos/nuevo',
    etiqueta: 'Registrar pago',
    descripcion: 'Dinero pagado a un proveedor',
    icono: ShoppingCart,
  },
  {
    ruta: '/conta/balanza',
    etiqueta: 'Ver balanza',
    descripcion: 'Saldos del periodo por cuenta',
    icono: ChartColumn,
  },
]
