import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioConta } from '@/shared/api/servicios'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * El asiento abierto vive en la URL, y la captura no contabiliza dos veces.
 *
 * Va en un archivo aparte porque contabiliza en el libro del mock: el humo del
 * núcleo cuenta con la semilla tal cual.
 */

const servidor = setupServer(...handlers)

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  servidor.resetHandlers()
  restablecerMonedas()
})
afterAll(() => servidor.close())

function montar(rutaInicial: string) {
  const router = createMemoryRouter(rutas, { initialEntries: [rutaInicial] })
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

/** Agosto 2026: el primer periodo abierto de la semilla, el activo. */
const AGOSTO = 'per-2026-08'
const JULIO = 'per-2026-07'

describe('Asiento abierto en la URL', () => {
  it('?asiento= abre el detalle aunque el asiento sea de otro periodo', async () => {
    const julio = await servicioConta.listarAsientos({ periodoId: JULIO })
    const planilla = julio.find((a) => a.concepto === 'Planilla julio 2026')!

    const usuario = userEvent.setup()
    const router = montar(`/conta/asientos?asiento=${planilla.id}`)

    // La lista es la de agosto (el periodo activo) y la planilla es de julio:
    // no está en ella, pero el detalle se abre igual y dice de qué mes es.
    expect(await screen.findByText('Detalle del asiento')).toBeInTheDocument()
    expect(await screen.findByText(planilla.codigo)).toBeInTheDocument()
    expect(
      screen.getByText(/Es de Julio 2026: no aparece en la lista/),
    ).toBeInTheDocument()
    // El periodo también queda escrito en la URL: el enlace es fiel.
    await waitFor(() =>
      expect(router.state.location.search).toContain(`periodo=${AGOSTO}`),
    )

    // Cerrar quita el asiento de la URL, y el detalle desaparece.
    await usuario.click(screen.getByRole('button', { name: 'Cerrar' }))
    await waitFor(() =>
      expect(screen.queryByText('Detalle del asiento')).toBeNull(),
    )
    expect(router.state.location.search).not.toContain('asiento=')
  })

  it('abrir una fila apila una entrada: atrás cierra el detalle', async () => {
    const usuario = userEvent.setup()
    const router = montar('/conta/asientos')

    const fila = (await screen.findByText('Comisiones bancarias agosto')).closest(
      'tr',
    )!
    await usuario.click(fila)

    expect(await screen.findByText('Detalle del asiento')).toBeInTheDocument()
    expect(router.state.location.search).toContain('asiento=')
    // La fila abierta se distingue en la lista.
    expect(fila).toHaveAttribute('aria-selected', 'true')

    await router.navigate(-1)
    await waitFor(() =>
      expect(screen.queryByText('Detalle del asiento')).toBeNull(),
    )
    expect(router.state.location.pathname).toBe('/conta/asientos')
  })

  it('?periodo= en el enlace manda sobre el periodo activo', async () => {
    montar(`/conta/asientos?periodo=${JULIO}`)

    expect(
      await screen.findByText('Planilla julio 2026'),
    ).toBeInTheDocument()
    // Y el selector de la cabecera se mueve al mes del enlace.
    await waitFor(() =>
      expect(screen.getByLabelText('Periodo')).toHaveDisplayValue(/Julio 2026/),
    )
  })
})

describe('Captura: un solo asiento por envío', () => {
  it('dos Ctrl+Enter seguidos no contabilizan dos asientos', async () => {
    const antes = await servicioConta.listarAsientos({ periodoId: AGOSTO })

    const usuario = userEvent.setup()
    const router = montar('/conta/asientos/nuevo')

    const cuentas = await screen.findAllByRole('combobox', { name: 'Cuenta' })
    const fecha = screen.getByLabelText(/^fecha/i)
    await usuario.clear(fecha)
    await usuario.type(fecha, '2026-08-21')
    await usuario.type(cuentas[0], '6.1.02.004')
    await usuario.type(cuentas[1], '1.1.01.002')

    const filas = screen.getAllByRole('row')
    await usuario.type(
      within(filas[1]).getByRole('textbox', { name: 'Cargo' }),
      '7000',
    )
    await usuario.type(
      within(filas[2]).getByRole('textbox', { name: 'Abono' }),
      '7000',
    )

    // Ctrl+Enter desde el concepto del encabezado, dos veces sin soltar Ctrl.
    const concepto = screen.getByPlaceholderText('Descripción del asiento')
    await usuario.type(concepto, 'Papelería por duplicado')
    await usuario.keyboard('{Control>}{Enter}{Enter}{/Control}')

    // Tras contabilizar se llega a la lista con el asiento abierto.
    expect(await screen.findByText('Detalle del asiento')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/conta/asientos')
    expect(router.state.location.search).toContain('asiento=')
    // La lista ya se volvió a pedir: un segundo envío, si lo hubiera habido,
    // salió a la vez que el primero y ya estaría en el libro.
    await waitFor(() =>
      expect(
        screen
          .getAllByText('Papelería por duplicado')
          .some((nodo) => nodo.closest('tr')),
      ).toBe(true),
    )

    const despues = await servicioConta.listarAsientos({ periodoId: AGOSTO })
    const nuevos = despues.filter(
      (a) => a.concepto === 'Papelería por duplicado',
    )
    expect(nuevos).toHaveLength(1)
    expect(despues).toHaveLength(antes.length + 1)
  })

  it('avisa antes de salir con un asiento a medio capturar', async () => {
    const usuario = userEvent.setup()
    const router = montar('/conta/asientos/nuevo')

    await usuario.type(
      await screen.findByPlaceholderText('Descripción del asiento'),
      'A medias',
    )
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))

    const dialogo = await screen.findByRole('dialog')
    expect(
      within(dialogo).getByText('¿Descartar los cambios?'),
    ).toBeInTheDocument()
    await usuario.click(
      within(dialogo).getByRole('button', { name: 'Cancelar' }),
    )
    expect(router.state.location.pathname).toBe('/conta/asientos/nuevo')
  })
})
