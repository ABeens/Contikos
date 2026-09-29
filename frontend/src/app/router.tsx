import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AppShell } from './layout/AppShell'
import { InicioPage } from './pages/InicioPage'
import { CatalogoCuentasPage } from '@/modules/conta/pages/CatalogoCuentasPage'
import { ClasificacionesPage } from '@/modules/conta/pages/ClasificacionesPage'
import { AsientosPage } from '@/modules/conta/pages/AsientosPage'
import { CapturaAsientoPage } from '@/modules/conta/pages/CapturaAsientoPage'
import { BalanzaPage } from '@/modules/conta/pages/BalanzaPage'
import { PeriodosPage } from '@/modules/conta/pages/PeriodosPage'
import { CierreEjercicioPage } from '@/modules/conta/pages/CierreEjercicioPage'
import { CuentasPorCobrarPage } from '@/modules/cxc/pages/CuentasPorCobrarPage'
import { ClientesPage } from '@/modules/cxc/pages/ClientesPage'
import { ItemsPage } from '@/modules/cxc/pages/ItemsPage'
import { FacturasVentaPage } from '@/modules/cxc/pages/FacturasVentaPage'
import { FacturaVentaPage } from '@/modules/cxc/pages/FacturaVentaPage'
import { CobrosPage } from '@/modules/cxc/pages/CobrosPage'
import { CobroPage } from '@/modules/cxc/pages/CobroPage'
import { NotasCreditoPage } from '@/modules/cxc/pages/NotasCreditoPage'
import { NotaCreditoPage } from '@/modules/cxc/pages/NotaCreditoPage'
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
import { CuentasBancariasPage } from '@/modules/bancos/pages/CuentasBancariasPage'
import { MovimientosPage } from '@/modules/bancos/pages/MovimientosPage'
import { MovimientoPage } from '@/modules/bancos/pages/MovimientoPage'
import { ImportacionPage } from '@/modules/bancos/pages/ImportacionPage'
import { ConciliacionPage } from '@/modules/bancos/pages/ConciliacionPage'
import { RevaluacionPage } from '@/modules/bancos/pages/RevaluacionPage'
import { ProyeccionPage } from '@/modules/bancos/pages/ProyeccionPage'
import { DiferidosPage } from '@/modules/diferidos/pages/DiferidosPage'
import { AltaDiferidoPage } from '@/modules/diferidos/pages/AltaDiferidoPage'
import { AmortizacionPage } from '@/modules/diferidos/pages/AmortizacionPage'
import { ConfiguracionPage } from '@/modules/config/pages/ConfiguracionPage'
import { MonedasPage } from '@/modules/config/pages/MonedasPage'
import { TiposCambioPage } from '@/modules/config/pages/TiposCambioPage'
import { ImpuestosPage } from '@/modules/config/pages/ImpuestosPage'
import { EmpresasPage } from '@/modules/empresas/pages/EmpresasPage'
import { UsuariosPage } from '@/modules/usuarios/pages/UsuariosPage'
import { PlanillaPage } from '@/modules/rh/pages/PlanillaPage'
import { EmpleadosPage } from '@/modules/rh/pages/EmpleadosPage'
import { ParametrosPlanillaPage } from '@/modules/rh/pages/ParametrosPlanillaPage'
import { RequierePermiso } from './RequierePermiso'
import { ReportesPage } from '@/modules/reportes/pages/ReportesPage'
import { EstadoSituacionPage } from '@/modules/reportes/pages/EstadoSituacionPage'
import { EstadoResultadosPage } from '@/modules/reportes/pages/EstadoResultadosPage'
import { FlujoEfectivoPage } from '@/modules/reportes/pages/FlujoEfectivoPage'
import { CambiosPatrimonioPage } from '@/modules/reportes/pages/CambiosPatrimonioPage'
import { LibroDiarioPage } from '@/modules/reportes/pages/LibroDiarioPage'
import { LibroMayorPage } from '@/modules/reportes/pages/LibroMayorPage'
import { ComparativoLibrosPage } from '@/modules/reportes/pages/ComparativoLibrosPage'

/**
 * Rutas. Un módulo del frontend = un módulo del dominio (docs/14 §3).
 *
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
      { path: 'conta/cierre-ejercicio', element: <CierreEjercicioPage /> },

      // --------------------------------------------------- configuración
      // Transversal: no es uno de los siete módulos del diagrama, sino los
      // datos de la empresa de los que todos dependen.
      { path: 'configuracion', element: <ConfiguracionPage /> },
      { path: 'configuracion/monedas', element: <MonedasPage /> },
      { path: 'configuracion/tipos-cambio', element: <TiposCambioPage /> },
      { path: 'configuracion/impuestos', element: <ImpuestosPage /> },
      { path: 'configuracion/empresas', element: <EmpresasPage /> },
      {
        path: 'configuracion/usuarios',
        element: (
          <RequierePermiso permiso="usuarios">
            <UsuariosPage />
          </RequierePermiso>
        ),
      },

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
      { path: 'cxc/notas-credito', element: <NotasCreditoPage /> },
      { path: 'cxc/notas-credito/nueva', element: <NotaCreditoPage /> },
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
      // ----------------------------------------------------------- bancos
      { path: 'bancos', element: <CuentasBancariasPage /> },
      { path: 'bancos/movimientos', element: <MovimientosPage /> },
      { path: 'bancos/movimientos/nuevo', element: <MovimientoPage /> },
      { path: 'bancos/estado-cuenta', element: <ImportacionPage /> },
      { path: 'bancos/conciliacion', element: <ConciliacionPage /> },
      { path: 'bancos/revaluacion', element: <RevaluacionPage /> },
      { path: 'bancos/proyeccion', element: <ProyeccionPage /> },

      // Recursos humanos: todo detrás del permiso de planilla, que no viene
      // con ningún "ver todo" (docs/08 §7).
      { path: 'rh', element: <Navigate to="/rh/planilla" replace /> },
      {
        path: 'rh/planilla',
        element: (
          <RequierePermiso permiso="planilla.ver">
            <PlanillaPage />
          </RequierePermiso>
        ),
      },
      {
        path: 'rh/empleados',
        element: (
          <RequierePermiso permiso="planilla.ver">
            <EmpleadosPage />
          </RequierePermiso>
        ),
      },
      {
        path: 'rh/parametros',
        element: (
          <RequierePermiso permiso="planilla.ver">
            <ParametrosPlanillaPage />
          </RequierePermiso>
        ),
      },

      // Reportes: solo leen del mayor (docs/09). Todos toman el periodo de la
      // cabecera y el libro de la URL.
      { path: 'reportes', element: <ReportesPage /> },
      { path: 'reportes/situacion', element: <EstadoSituacionPage /> },
      { path: 'reportes/resultados', element: <EstadoResultadosPage /> },
      { path: 'reportes/flujos', element: <FlujoEfectivoPage /> },
      { path: 'reportes/patrimonio', element: <CambiosPatrimonioPage /> },
      { path: 'reportes/diario', element: <LibroDiarioPage /> },
      { path: 'reportes/mayor', element: <LibroMayorPage /> },
      { path: 'reportes/fiscal-corporativo', element: <ComparativoLibrosPage /> },

      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]

/**
 * El `basename` sale de la base de compilación (`vite.config.ts`). Publicada en
 * GitHub Pages la aplicación no vive en la raíz del dominio sino bajo el nombre
 * del repositorio, y sin esto el router buscaría `/asientos` donde el servidor
 * tiene `/Contikos/asientos`. En desarrollo `BASE_URL` es `/` y no cambia nada.
 */
export const router = createBrowserRouter(rutas, {
  basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/',
})
