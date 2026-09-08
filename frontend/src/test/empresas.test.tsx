import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import {
  EMPRESA_INICIAL,
  empresaActiva,
  establecerEmpresaActiva,
} from '@/shared/almacen/almacen'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * Multiempresa de punta a punta (docs/01 §4.1, docs/12 D-03 y D-12).
 *
 * Lo que se comprueba es lo que no puede fallar en un sistema con varias
 * empresas: que ninguna petición llegue sin decir de qué empresa es, que al
 * cambiar de empresa cambien los catálogos, y que el directorio del grupo
 * comparta la identidad de un tercero sin arrastrar sus condiciones.
 */

const servidor = setupServer(...handlers)

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  servidor.resetHandlers()
  restablecerMonedas()
  // La empresa activa es estado de módulo: una prueba que cambia de empresa
  // se la dejaría cambiada a la siguiente.
  establecerEmpresaActiva(EMPRESA_INICIAL)
})
afterAll(() => servidor.close())

function montar(rutaInicial: string) {
  const router = createMemoryRouter(rutas, { initialEntries: [rutaInicial] })
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
}

const url = (ruta: string) => new URL(`/api${ruta}`, window.location.origin)

describe('Guardia de empresa', () => {
  it('rechaza toda petición que no diga de qué empresa es', async () => {
    const respuesta = await fetch(url('/conta/cuentas'))

    expect(respuesta.status).toBe(400)
    expect((await respuesta.json()).codigo).toBe('EMPRESA_REQUERIDA')
  })

  it('rechaza una petición de una empresa distinta de la abierta', async () => {
    const respuesta = await fetch(url('/conta/cuentas'), {
      headers: { 'X-Empresa-Id': 'emp-otra' },
    })

    expect(respuesta.status).toBe(409)
    expect((await respuesta.json()).codigo).toBe('EMPRESA_INCORRECTA')
  })

  it('con la empresa abierta en la cabecera, sirve', async () => {
    const respuesta = await fetch(url('/conta/cuentas'), {
      headers: { 'X-Empresa-Id': empresaActiva() },
    })

    expect(respuesta.ok).toBe(true)
  })
})

describe('Cambio de empresa', () => {
  it('la barra superior ofrece las empresas del grupo y abre la elegida', async () => {
    const usuario = userEvent.setup()
    montar('/cxc/clientes')

    // Clientes de la empresa principal.
    await screen.findByText('Inversiones Tecnológicas del Valle S.A.')

    const selector = await screen.findByLabelText('Empresa')
    expect(selector).toHaveDisplayValue('SCK · Soluciones Contikos S.A.')
    await usuario.selectOptions(selector, 'emp-002')

    // Se vuelve al inicio y la empresa abierta es la otra.
    await waitFor(() => expect(empresaActiva()).toBe('emp-002'))
    await waitFor(() =>
      expect(screen.getByLabelText('Empresa')).toHaveDisplayValue(
        'DCP · Distribuidora Contikos del Pacífico S.A.',
      ),
    )
    expect(await screen.findByText('Resumen')).toBeInTheDocument()
  })

  it('cada empresa tiene sus propios clientes, proveedores y mayor', async () => {
    establecerEmpresaActiva('emp-002')

    const clientes = montar('/cxc/clientes')
    await screen.findByText('Hotel Bahía Ballena S.A.')
    // El cliente compartido con la principal está, con SU código de aquí.
    expect(screen.getByText('Comercial La Sabana S.A.')).toBeInTheDocument()
    expect(
      screen.queryByText('Inversiones Tecnológicas del Valle S.A.'),
    ).toBeNull()
    clientes.unmount()

    const proveedores = montar('/cxp/proveedores')
    await screen.findByText('Transportes del Pacífico Sur S.A.')
    expect(screen.queryByText('Suministros de Oficina Delta S.A.')).toBeNull()
    proveedores.unmount()

    // El mayor de la segunda empresa arranca vacío: ningún asiento de la
    // principal se ve desde aquí.
    montar('/conta/asientos')
    expect(
      await screen.findByText(/no hay asientos|sin asientos/i),
    ).toBeInTheDocument()
  })

  it('el primer asiento de una empresa nueva se numera desde uno', async () => {
    establecerEmpresaActiva('emp-002')
    const respuesta = await fetch(url('/conta/asientos'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Empresa-Id': 'emp-002',
      },
      body: JSON.stringify({
        fecha: '2026-08-20',
        concepto: 'Aporte inicial de capital',
        moneda: 'CRC',
        tipoCambio: '1',
        lineas: [
          { cuenta: '1.1.01.001', cargo: '1000000', abono: '0' },
          { cuenta: '3.1.01.001', cargo: '0', abono: '1000000' },
        ],
      }),
    })

    expect(respuesta.status).toBe(201)
    expect((await respuesta.json()).numero).toBe(1)
  })
})

describe('Directorio de terceros del grupo', () => {
  it('reúne por identificación a los terceros de todas las empresas activas', async () => {
    const respuesta = await fetch(url('/empresas/directorio'), {
      headers: { 'X-Empresa-Id': empresaActiva() },
    })
    const directorio: {
      identificacion: string
      apariciones: { empresaCodigo: string; rol: string; codigo: string }[]
    }[] = await respuesta.json()

    // El despacho contable es proveedor de las dos, cada una con su código.
    const despacho = directorio.find((t) => t.identificacion === '3101334455')!
    expect(despacho.apariciones).toEqual([
      { empresaId: 'emp-001', empresaCodigo: 'SCK', empresaNombre: 'Soluciones Contikos S.A.', rol: 'proveedor', codigo: 'P-014' },
      { empresaId: 'emp-002', empresaCodigo: 'DCP', empresaNombre: 'Distribuidora Contikos del Pacífico S.A.', rol: 'proveedor', codigo: 'P-001' },
    ])
    // Y un tercero que solo la segunda conoce también aparece.
    expect(directorio.some((t) => t.identificacion === '3101556677')).toBe(true)
  })

  it('al dar de alta un proveedor, toma la identidad de otra empresa y fija aquí sus condiciones', async () => {
    const usuario = userEvent.setup()
    montar('/cxp/proveedores')
    await screen.findByText('Suministros de Oficina Delta S.A.')

    await usuario.click(screen.getByRole('button', { name: /nuevo proveedor/i }))
    const dialogo = await screen.findByRole('dialog')

    await usuario.type(
      within(dialogo).getByLabelText(/buscar en el directorio del grupo/i),
      'transportes',
    )
    const opcion = await within(dialogo).findByRole('button', {
      name: /tomar la identidad de transportes del pacífico sur/i,
    })
    // Se ve en qué empresa del grupo ya existe.
    expect(within(opcion).getByText('proveedor en DCP')).toBeInTheDocument()
    await usuario.click(opcion)

    // La identidad quedó precargada; las condiciones se capturan aquí.
    expect(within(dialogo).getByLabelText(/^identificación/i)).toHaveValue(
      '3101556677',
    )
    expect(within(dialogo).getByLabelText(/razón social/i)).toHaveValue(
      'Transportes del Pacífico Sur S.A.',
    )
    // Exacto y no por prefijo: el diálogo tiene ahora otro campo que empieza
    // igual, el código de país del teléfono.
    // El patrón cierra al final (el asterisco es la marca de obligatorio) para
    // no atrapar también el "Código de país del teléfono" del mismo diálogo.
    await usuario.type(within(dialogo).getByLabelText(/^código\s*\*?$/i), 'P-050')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      await screen.findByText('Transportes del Pacífico Sur S.A.'),
    ).toBeInTheDocument()
  })

  it('no ofrece un tercero que ya es cliente de la empresa abierta', async () => {
    const usuario = userEvent.setup()
    montar('/cxc/clientes')
    await screen.findByText('Comercial La Sabana S.A.')

    await usuario.click(screen.getByRole('button', { name: /nuevo cliente/i }))
    const dialogo = await screen.findByRole('dialog')
    await usuario.type(
      within(dialogo).getByLabelText(/buscar en el directorio del grupo/i),
      'sabana',
    )

    const opcion = await within(dialogo).findByRole('button', {
      name: /ya es cliente de esta empresa/i,
    })
    expect(opcion).toBeDisabled()
  })
})

describe('Catálogo de empresas', () => {
  it('da de alta una empresa y aparece en el selector, vacía', async () => {
    const usuario = userEvent.setup()
    montar('/configuracion/empresas')
    await screen.findByText('Distribuidora Contikos del Pacífico S.A.')

    await usuario.click(screen.getByRole('button', { name: /nueva empresa/i }))
    const dialogo = await screen.findByRole('dialog')
    await usuario.type(within(dialogo).getByLabelText(/siglas/i), 'nor')
    await usuario.type(
      within(dialogo).getByLabelText(/razón social/i),
      'Contikos Norte S.A.',
    )
    await usuario.type(
      within(dialogo).getByLabelText(/^identificación/i),
      '3101444555',
    )
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText('Contikos Norte S.A.')).toBeInTheDocument()

    const selector = screen.getByLabelText('Empresa')
    await waitFor(() =>
      expect(
        within(selector).getByRole('option', { name: 'NOR · Contikos Norte S.A.' }),
      ).toBeInTheDocument(),
    )

    // Se abre y arranca sin terceros: nada de las otras se filtró.
    await usuario.click(screen.getByRole('button', { name: 'Abrir NOR' }))
    await waitFor(() => expect(empresaActiva()).toBe('emp-003'))
    const respuesta = await fetch(url('/cxc/clientes'), {
      headers: { 'X-Empresa-Id': 'emp-003' },
    })
    expect(await respuesta.json()).toEqual([])
  })

  it('rechaza dos empresas con la misma cédula', async () => {
    const usuario = userEvent.setup()
    montar('/configuracion/empresas')
    await screen.findByText('Soluciones Contikos S.A.')

    await usuario.click(screen.getByRole('button', { name: /nueva empresa/i }))
    const dialogo = await screen.findByRole('dialog')
    await usuario.type(within(dialogo).getByLabelText(/siglas/i), 'DUP')
    await usuario.type(within(dialogo).getByLabelText(/razón social/i), 'Duplicada S.A.')
    await usuario.type(
      within(dialogo).getByLabelText(/^identificación/i),
      '3101987654',
    )
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    // Lo dice el campo y lo repite el resumen de errores.
    expect(
      await within(dialogo).findAllByText(/ya es de otra empresa del grupo/i),
    ).not.toHaveLength(0)
  })

  it('la empresa abierta no se puede desactivar', async () => {
    montar('/configuracion/empresas')
    await screen.findByText('Soluciones Contikos S.A.')

    // La fila de la abierta no tiene el conmutador; las demás sí.
    const abierta = screen.getByText('Soluciones Contikos S.A.').closest('tr')!
    const otra = screen
      .getByText('Distribuidora Contikos del Pacífico S.A.')
      .closest('tr')!
    expect(within(abierta).getByText('Abierta')).toBeInTheDocument()
    expect(within(abierta).queryByRole('button', { name: 'Desactivar' })).toBeNull()
    expect(within(otra).getByRole('button', { name: 'Desactivar' })).toBeInTheDocument()
  })
})
