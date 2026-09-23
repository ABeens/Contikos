import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioConfig, servicioConta } from '@/shared/api/servicios'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * Alta directa de un activo en moneda extranjera.
 *
 * Comprueba lo que la pantalla promete: el tipo de cambio es el del día de
 * adquisición, el asiento propuesto está en colones, se confirma antes de
 * contabilizar y, al terminar, se abre la ficha del activo recién creado.
 *
 * Va en su propio archivo porque muta el estado del mock.
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

const FECHA = '2026-08-20'

describe('Alta directa en dólares', () => {
  it('convierte al tipo del día, confirma y abre la ficha', async () => {
    const usuario = userEvent.setup()
    const router = montar('/activos/nuevo?modo=manual')

    await usuario.type(
      await screen.findByLabelText(/^Nombre/),
      'Servidor importado',
    )
    await waitFor(() =>
      expect(
        within(screen.getByLabelText(/Categoría/)).getByRole('option', {
          name: /Equipo de cómputo/,
        }),
      ).toBeInTheDocument(),
    )
    await usuario.selectOptions(screen.getByLabelText(/Categoría/), 'cat-computo')
    const fecha = screen.getByLabelText(/Fecha de adquisición/)
    await usuario.clear(fecha)
    await usuario.type(fecha, FECHA)
    await usuario.selectOptions(screen.getByLabelText(/^Moneda/), 'USD')
    await usuario.type(screen.getByLabelText(/Costo de adquisición/), '1000')
    await usuario.type(screen.getByLabelText('Cuenta'), '3.1.01.001')
    await usuario.tab()

    // El tipo de cambio llega solo, y es el de la fecha de adquisición.
    const vigente = await servicioConfig.tipoCambioVigente('USD', FECHA)
    await waitFor(() =>
      expect(screen.getByLabelText(/^Tipo de cambio/)).toHaveValue(
        vigente.compra,
      ),
    )

    await usuario.click(
      screen.getByRole('button', { name: /Dar de alta y contabilizar/ }),
    )
    const dialogo = await screen.findByRole('dialog')
    await usuario.click(
      within(dialogo).getByRole('button', { name: /Dar de alta y contabilizar/ }),
    )

    // Se abre la ficha del activo recién creado.
    await waitFor(() =>
      expect(router.state.location.search).toMatch(/activo=act-/),
    )
    const ficha = await screen.findByRole('heading', {
      name: /Servidor importado/,
    })
    expect(ficha).toBeInTheDocument()

    // El asiento entró en colones: 1.000 dólares al tipo del día.
    const id = new URLSearchParams(router.state.location.search).get('activo')!
    const asientos = await servicioConta.listarAsientos()
    const asiento = asientos.find(
      (a) => a.origenModulo === 'activos' && a.origenId === id,
    )!
    expect(asiento.moneda).toBe('CRC')
    const esperado = (Number(vigente.compra) * 1000).toFixed(2)
    for (const total of asiento.totales) {
      expect(total.totalCargos).toBe(esperado)
    }
  })
})
