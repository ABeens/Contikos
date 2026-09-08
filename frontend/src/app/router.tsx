import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AppShell } from './layout/AppShell'
import { InicioPage } from './pages/InicioPage'
import { ModuloPendientePage } from './pages/ModuloPendientePage'
import { CatalogoCuentasPage } from '@/modules/conta/pages/CatalogoCuentasPage'
import { ClasificacionesPage } from '@/modules/conta/pages/ClasificacionesPage'
import { AsientosPage } from '@/modules/conta/pages/AsientosPage'
import { CapturaAsientoPage } from '@/modules/conta/pages/CapturaAsientoPage'
import { BalanzaPage } from '@/modules/conta/pages/BalanzaPage'
import { PeriodosPage } from '@/modules/conta/pages/PeriodosPage'
import { CuentasPorCobrarPage } from '@/modules/cxc/pages/CuentasPorCobrarPage'
import { ClientesPage } from '@/modules/cxc/pages/ClientesPage'
import { ItemsPage } from '@/modules/cxc/pages/ItemsPage'
import { FacturasVentaPage } from '@/modules/cxc/pages/FacturasVentaPage'
import { FacturaVentaPage } from '@/modules/cxc/pages/FacturaVentaPage'
import { CobrosPage } from '@/modules/cxc/pages/CobrosPage'
import { CobroPage } from '@/modules/cxc/pages/CobroPage'
import { CuentasPorPagarPage } from '@/modules/cxp/pages/CuentasPorPagarPage'
import { ProveedoresPage } from '@/modules/cxp/pages/ProveedoresPage'
import { FacturasCompraPage } from '@/modules/cxp/pages/FacturasCompraPage'
import { FacturaCompraPage } from '@/modules/cxp/pages/FacturaCompraPage'
import { PagosPage } from '@/modules/cxp/pages/PagosPage'
import { PagoPage } from '@/modules/cxp/pages/PagoPage'
import { PropuestaPagoPage } from '@/modules/cxp/pages/PropuestaPagoPage'
import { ActivosPage } from '@/modules/activos/pages/ActivosPage'
import { AltaActivoPage } from '@/modules/activos/pages/AltaActivoPage'
import { CategoriasPage } from '@/modules/activos/pages/CategoriasPage'
import { DepreciacionPage } from '@/modules/activos/pages/DepreciacionPage'
import { DiferidosPage } from '@/modules/diferidos/pages/DiferidosPage'
import { AltaDiferidoPage } from '@/modules/diferidos/pages/AltaDiferidoPage'
import { AmortizacionPage } from '@/modules/diferidos/pages/AmortizacionPage'
import { ConfiguracionPage } from '@/modules/config/pages/ConfiguracionPage'
import { MonedasPage } from '@/modules/config/pages/MonedasPage'
import { TiposCambioPage } from '@/modules/config/pages/TiposCambioPage'
import { ImpuestosPage } from '@/modules/config/pages/ImpuestosPage'
import { EmpresasPage } from '@/modules/empresas/pages/EmpresasPage'

/**
 * Rutas. Un módulo del frontend = un módulo del dominio (docs/14 §3).
 *
 * Los módulos aún no construidos montan un marcador que documenta su alcance,
 * para que la navegación completa sea revisable desde ahora.
 */
export const rutas: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <InicioPage /> },

      // ---------------------------------------------------------- conta
      { path: 'conta', element: <Navigate to="/conta/asientos" replace /> },
      { path: 'conta/cuentas', element: <CatalogoCuentasPage /> },
      { path: 'conta/clasificaciones', element: <ClasificacionesPage /> },
      { path: 'conta/asientos', element: <AsientosPage /> },
      { path: 'conta/asientos/nuevo', element: <CapturaAsientoPage /> },
      { path: 'conta/balanza', element: <BalanzaPage /> },
      { path: 'conta/periodos', element: <PeriodosPage /> },

      // --------------------------------------------------- configuración
      // Transversal: no es uno de los siete módulos del diagrama, sino los
      // datos de la empresa de los que todos dependen.
      { path: 'configuracion', element: <ConfiguracionPage /> },
      { path: 'configuracion/monedas', element: <MonedasPage /> },
      { path: 'configuracion/tipos-cambio', element: <TiposCambioPage /> },
      { path: 'configuracion/impuestos', element: <ImpuestosPage /> },
      { path: 'configuracion/empresas', element: <EmpresasPage /> },

      // ------------------------------------------------------------ cxc
      { path: 'cxc', element: <CuentasPorCobrarPage /> },
      { path: 'cxc/clientes', element: <ClientesPage /> },
      { path: 'cxc/items', element: <ItemsPage /> },
      { path: 'cxc/facturas', element: <FacturasVentaPage /> },
      { path: 'cxc/facturas/nueva', element: <FacturaVentaPage /> },
      // El detalle es el mismo listado con una factura abierta: cuál está
      // abierta vive en la URL, para que se pueda enviar por enlace y el
      // botón de atrás devuelva al listado (docs/14 §6).
      { path: 'cxc/facturas/:id', element: <FacturasVentaPage /> },
      { path: 'cxc/cobros', element: <CobrosPage /> },
      { path: 'cxc/cobros/nuevo', element: <CobroPage /> },
      // Mismo criterio que las facturas: el detalle es el listado con un cobro
      // abierto, y cuál está abierto vive en la URL.
      { path: 'cxc/cobros/:id', element: <CobrosPage /> },

      // ------------------------------------------------------------ cxp
      { path: 'cxp', element: <CuentasPorPagarPage /> },
      { path: 'cxp/proveedores', element: <ProveedoresPage /> },
      { path: 'cxp/facturas', element: <FacturasCompraPage /> },
      { path: 'cxp/facturas/nueva', element: <FacturaCompraPage /> },
      { path: 'cxp/facturas/:id', element: <FacturasCompraPage /> },
      { path: 'cxp/pagos', element: <PagosPage /> },
      { path: 'cxp/pagos/nuevo', element: <PagoPage /> },
      { path: 'cxp/pagos/:id', element: <PagosPage /> },
      { path: 'cxp/propuesta', element: <PropuestaPagoPage /> },

      // -------------------------------------------------------- activos
      { path: 'activos', element: <ActivosPage /> },
      { path: 'activos/nuevo', element: <AltaActivoPage /> },
      { path: 'activos/categorias', element: <CategoriasPage /> },
      { path: 'activos/depreciacion', element: <DepreciacionPage /> },

      // ------------------------------------------------------ diferidos
      // Proceso de cierre del propio mayor: no es uno de los siete módulos
      // del diagrama, sino el reconocimiento en el tiempo de lo que ya se
      // pagó o se cobró (docs/15).
      { path: 'diferidos', element: <DiferidosPage /> },
      { path: 'diferidos/nuevo', element: <AltaDiferidoPage /> },
      { path: 'diferidos/amortizacion', element: <AmortizacionPage /> },

      // ------------------------------------------------ módulos pendientes
      {
        path: 'bancos',
        element: (
          <ModuloPendientePage
            titulo="Bancos"
            fase="Fase 4 del roadmap"
            descripcion="Tesorería y conciliación bancaria."
            alcance={[
              'Cuentas en colones y dólares',
              'Importación de estados de cuenta con detección de duplicados',
              'Emparejamiento automático en cascada y conciliación manual',
              'Partidas conciliatorias y cierre con diferencia cero',
              'Revaluación de saldos en moneda extranjera',
            ]}
            asientos={[
              'Comisiones e intereses',
              'Traspasos entre cuentas propias',
              'Revaluación cambiaria al cierre',
            ]}
          />
        ),
      },
      {
        path: 'rh',
        element: (
          <ModuloPendientePage
            titulo="Recursos humanos"
            fase="Fase 7 del roadmap — decisión D-06 pendiente"
            descripcion="Planilla y cargas sociales. El módulo más dependiente de la legislación local."
            alcance={[
              'Empleados y catálogo de conceptos',
              'Cálculo con CCSS e impuesto sobre la renta del trabajo',
              'Reporte de planilla a SICERE',
              'Provisiones de aguinaldo, vacaciones y cesantía',
              'Control de acceso reforzado sobre datos salariales',
            ]}
            asientos={[
              'Planilla: cargo a Salarios y cargas patronales',
              'Abono a CCSS por pagar, retenciones y neto por pagar',
              'Provisiones mensuales de prestaciones legales',
            ]}
          />
        ),
      },
      {
        path: 'reportes',
        element: (
          <ModuloPendientePage
            titulo="Reportes"
            fase="Fase 5 del roadmap"
            descripcion="El único módulo que lee del mayor en lugar de alimentarlo."
            alcance={[
              'Balance General y Estado de Resultados bajo NIIF',
              'Estado de Flujo de Efectivo y Cambios en el Patrimonio',
              'Auxiliar de cuenta con drill-down hasta el documento origen',
              'Motor de plantillas configurables por la empresa',
              'Exportaciones fiscales: D-104, D-101',
            ]}
            asientos={['Ninguno. Reportes nunca escribe en el mayor.']}
          />
        ),
      },

      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]

export const router = createBrowserRouter(rutas)
