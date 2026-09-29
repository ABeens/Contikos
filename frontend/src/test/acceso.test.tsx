import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioAuth, servicioConta, servicioEmpresas } from '@/shared/api/servicios'
import { ApiError } from '@/shared/api/client'
import { cerrarSesionLocal, sesionActual } from '@/shared/auth/sesion'
import { permisoDeOperacion, puede } from '@/shared/auth/permisos'
import { establecerEmpresaActiva } from '@/shared/almacen/almacen'
import { restablecerMonedas } from '@/shared/money/money'
import { iniciarSesionDePrueba } from './sesion'

/**
 * Autenticación y roles por empresa (docs/17 §6), de punta a punta.
 *
 * El servidor decide con la tabla de `shared/auth/permisos.ts`; la interfaz
 * lee la misma para no ofrecer lo que se va a rechazar. Aquí se comprueba lo
 * primero con cada rol y lo segundo en las pantallas que dependen de ello.
 */

const servidor = setupServer(...handlers)

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  servidor.resetHandlers()
  restablecerMonedas()
  establecerEmpresaActiva('emp-001')
})
afterAll(() => servidor.close())

function montar(ruta: string) {
  const router = createMemoryRouter(rutas, { initialEntries: [ruta] })
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

const ASIENTO = {
  fecha: '2026-09-15',
  concepto: 'Prueba de permisos',
  moneda: 'CRC',
  tipoCambio: '1',
  lineas: [
    { cuenta: '6.1.02.004', cargo: '1000.00', abono: '0' },
    { cuenta: '1.1.01.001', cargo: '0', abono: '1000.00' },
  ],
}

async function codigoDe(promesa: Promise<unknown>): Promise<string | null> {
  try {
    await promesa
    return null
  } catch (e) {
    return e instanceof ApiError ? `${e.status} ${e.codigo}` : String(e)
  }
}

describe('Tabla de permisos', () => {
  it('pide el permiso que corresponde a cada operación', () => {
    expect(permisoDeOperacion('GET', '/conta/balanza')).toBeNull()
    expect(permisoDeOperacion('GET', '/rh/empleados')).toBe('planilla.ver')
    expect(permisoDeOperacion('POST', '/conta/asientos')).toBe('contabilidad.capturar')
    expect(permisoDeOperacion('POST', '/conta/periodos/per-2026-08/cerrar')).toBe(
      'contabilidad.cerrar',
    )
    expect(permisoDeOperacion('POST', '/conta/periodos/per-2026-08/reabrir')).toBe(
      'contabilidad.reabrir',
    )
    expect(permisoDeOperacion('POST', '/cxc/facturas')).toBe('operaciones')
    expect(permisoDeOperacion('GET', '/auth/usuarios')).toBe('usuarios')
  })

  it('el contador no ve la planilla; el administrador sí', () => {
    expect(puede('contador', 'planilla.ver')).toBe(false)
    expect(puede('administrador', 'planilla.ver')).toBe(true)
    expect(puede('consulta', 'operaciones')).toBe(false)
  })
})

describe('Autorización en el servidor', () => {
  it('sin sesión, todo contesta 401', async () => {
    cerrarSesionLocal()
    const r = await fetch(new URL('/api/conta/cuentas', window.location.origin), {
      headers: { 'X-Empresa-Id': 'emp-001' },
    })
    expect(r.status).toBe(401)
  })

  it('entra con la contraseña correcta y rechaza la incorrecta sin decir cuál falló', async () => {
    cerrarSesionLocal()
    expect(
      await codigoDe(servicioAuth.iniciarSesion({ correo: 'admin@contikos.cr', clave: 'otra' })),
    ).toBe('401 CREDENCIALES_INVALIDAS')
    const sesion = await servicioAuth.iniciarSesion({
      correo: 'ADMIN@contikos.cr',
      clave: 'contikos',
    })
    expect(sesion.usuario.id).toBe('usr-admin')
  })

  it('consulta ve la contabilidad pero no puede capturar', async () => {
    iniciarSesionDePrueba('usr-consulta')
    await expect(servicioConta.listarCuentas()).resolves.not.toHaveLength(0)
    expect(await codigoDe(servicioConta.contabilizarAsiento(ASIENTO))).toBe(
      '403 PERMISO_DENEGADO',
    )
  })

  it('el auxiliar opera documentos pero no cierra periodos', async () => {
    iniciarSesionDePrueba('usr-auxiliar')
    expect(
      await codigoDe(
        servicioConta.cerrarPeriodo('per-2026-08', { confirmarAvisos: true, motivo: 'x' }),
      ),
    ).toBe('403 PERMISO_DENEGADO')
  })

  it('el rol es por empresa: la contadora solo consulta en la segunda', async () => {
    iniciarSesionDePrueba('usr-contadora')
    establecerEmpresaActiva('emp-002')
    expect(await codigoDe(servicioConta.contabilizarAsiento(ASIENTO))).toBe(
      '403 PERMISO_DENEGADO',
    )
  })

  it('sin rol en una empresa, ni la ve ni puede pedirle nada', async () => {
    iniciarSesionDePrueba('usr-auxiliar')
    const empresas = await servicioEmpresas.listar()
    expect(empresas.map((e) => e.id)).toEqual(['emp-001'])
    establecerEmpresaActiva('emp-002')
    expect(await codigoDe(servicioConta.listarCuentas())).toBe('403 SIN_ACCESO_A_EMPRESA')
  })

  it('solo quien administra usuarios los lista', async () => {
    iniciarSesionDePrueba('usr-contadora')
    expect(await codigoDe(servicioAuth.listarUsuarios())).toBe('403 PERMISO_DENEGADO')
    iniciarSesionDePrueba('usr-admin')
    expect((await servicioAuth.listarUsuarios()).length).toBeGreaterThanOrEqual(5)
  })

  it('no deja al grupo sin administrador', async () => {
    const [admin] = (await servicioAuth.listarUsuarios()).filter((u) => u.id === 'usr-admin')
    expect(
      await codigoDe(
        servicioAuth.actualizarUsuario(admin.id, {
          nombre: admin.nombre,
          correo: admin.correo,
          activo: true,
          roles: admin.roles.map((r) => ({ ...r, rol: 'contador' as const })),
        }),
      ),
    ).toBe('422 SIN_ADMINISTRADOR')
  })

  it('un 401 con sesión abierta la cierra: el servidor ya no la reconoce', async () => {
    await servicioAuth.cerrarSesion()
    // La sesión local sigue, pero el servidor ya la olvidó.
    expect(sesionActual()).not.toBeNull()
    await codigoDe(servicioConta.listarCuentas())
    expect(sesionActual()).toBeNull()
  })
})

describe('Pantallas', () => {
  it('sin sesión se enseña la pantalla de inicio, y al entrar la aplicación', async () => {
    cerrarSesionLocal()
    const user = userEvent.setup()
    montar('/')
    await user.type(await screen.findByLabelText('Correo'), 'contadora@contikos.cr')
    await user.type(screen.getByLabelText('Contraseña'), 'contikos')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(
      await screen.findByRole('button', { name: 'Usuario: Laura Contadora' }),
    ).toBeInTheDocument()
  })

  it('el menú no ofrece la planilla a quien no la puede ver', async () => {
    iniciarSesionDePrueba('usr-contadora')
    montar('/')
    const menu = await screen.findByRole('navigation')
    await waitFor(() =>
      expect(within(menu).getByRole('link', { name: /Contabilidad/ })).toBeInTheDocument(),
    )
    expect(within(menu).queryByRole('link', { name: /Recursos humanos/ })).toBeNull()
  })

  it('la pantalla de usuarios explica por qué no se abre sin permiso', async () => {
    iniciarSesionDePrueba('usr-contadora')
    montar('/configuracion/usuarios')
    expect(
      await screen.findByText('Su rol no da acceso a esta pantalla'),
    ).toBeInTheDocument()
  })

  it('el administrador ve los usuarios con su rol en cada empresa', async () => {
    montar('/configuracion/usuarios')
    expect(await screen.findByText('contadora@contikos.cr')).toBeInTheDocument()
  })
})
