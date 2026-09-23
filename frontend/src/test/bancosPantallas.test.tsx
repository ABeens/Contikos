import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioConfig } from '@/shared/api/servicios'
import { hoyISO } from '@/shared/format/fecha'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * Pantallas de tesorería: lo que el usuario teclea tiene que llegar al cálculo.
 *
 * Son dos fallos que no se ven en las pruebas de servicio: el saldo capturado
 * en la conciliación que no recalculaba la ecuación, y el tipo de cambio que no
 * se proponía al elegir una cuenta en dólares porque la tasa llegaba después.
 *
 * No muta el estado del mock: solo lee y rellena formularios sin enviarlos.
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

describe('Conciliación', () => {
  it('recalcula la ecuación con el saldo capturado y lo guarda en la URL', async () => {
    const usuario = userEvent.setup()
    const router = montar('/bancos/conciliacion?cuenta=bco-001&corte=2026-08-31')

    const ecuacion = await screen.findByLabelText('Ecuación de la conciliación')
    expect(within(ecuacion).queryByText('1.234.567,89')).not.toBeInTheDocument()

    await usuario.type(
      screen.getByLabelText(/Saldo del estado de cuenta/),
      '1234567,89',
    )
    await usuario.tab()

    // El servidor recalcula con el saldo tecleado: aparece en el término del
    // banco de la ecuación, no solo en el campo.
    await waitFor(() =>
      expect(
        within(
          screen.getByLabelText('Ecuación de la conciliación'),
        ).getAllByText('1.234.567,89').length,
      ).toBeGreaterThan(0),
    )
    // Y queda en la URL: ir a registrar un movimiento y volver no lo pierde.
    expect(router.state.location.search).toContain('saldo=1234567.89')
    expect(router.state.location.search).toContain('corte=2026-08-31')
  })
})

describe('Registrar movimiento', () => {
  it('propone el tipo de cambio del día al elegir una cuenta en dólares', async () => {
    const usuario = userEvent.setup()
    montar('/bancos/movimientos/nuevo')

    const selector = await screen.findByLabelText(/^Cuenta bancaria/)
    await waitFor(() =>
      expect(
        within(selector).getByRole('option', { name: /BCO-002/ }),
      ).toBeInTheDocument(),
    )
    await usuario.selectOptions(selector, 'bco-002')

    const vigente = await servicioConfig.tipoCambioVigente('USD', hoyISO())
    // La tasa llega del servidor después de elegir la cuenta: el campo tiene
    // que recogerla igualmente, sin que nadie la teclee.
    await waitFor(() =>
      expect(screen.getByLabelText(/Tipo de cambio USD/)).toHaveValue(
        vigente.compra,
      ),
    )
  })

  it('llega precargado desde la conciliación y ofrece volver a ella', async () => {
    const volver = '/bancos/conciliacion?cuenta=bco-001&corte=2026-08-31'
    const parametros = new URLSearchParams({
      cuenta: 'bco-001',
      clase: 'interes',
      importe: '-1500.50',
      fecha: '2026-08-20',
      referencia: 'INT-0820',
      concepto: 'Intereses del mes',
      volver,
    })
    const router = montar(`/bancos/movimientos/nuevo?${parametros}`)

    await waitFor(() =>
      expect(screen.getByLabelText(/^Cuenta bancaria/)).toHaveValue('bco-001'),
    )
    expect(
      screen.getByRole('button', { name: 'Interés ganado' }),
    ).toHaveClass('bg-brand-600')
    expect(screen.getByLabelText(/^Fecha/)).toHaveValue('2026-08-20')
    expect(screen.getByLabelText(/^Referencia/)).toHaveValue('INT-0820')
    expect(screen.getByLabelText(/^Concepto/)).toHaveValue('Intereses del mes')
    // El signo lo pone el módulo: el importe llega sin él.
    expect(screen.getByLabelText(/^Importe/)).toHaveValue('1.500,50')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Volver' }))
    await waitFor(() =>
      expect(
        `${router.state.location.pathname}${router.state.location.search}`,
      ).toBe(volver),
    )
  })
})
