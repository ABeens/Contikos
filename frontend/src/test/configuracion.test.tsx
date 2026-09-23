import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import {
  persistirTiposCambio,
  tiposCambioMock,
} from '@/mocks/seed/tiposCambio'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * Captura de la tabla de tipos de cambio.
 *
 * Lo que se comprueba es lo que antes pasaba en silencio: que capturar un día
 * que ya tiene valor lo sustituía sin decir cuál había.
 */

const servidor = setupServer(...handlers)
const original = tiposCambioMock.map((t) => ({ ...t }))

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  servidor.resetHandlers()
  restablecerMonedas()
  // La tabla del mock es estado de módulo: lo capturado aquí no puede
  // quedarse para las pruebas siguientes.
  tiposCambioMock.splice(0, tiposCambioMock.length, ...original)
  persistirTiposCambio()
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

describe('Tipos de cambio', () => {
  it('pide confirmación y enseña el valor anterior al capturar un día que ya existe', async () => {
    const usuario = userEvent.setup()
    montar('/configuracion/tipos-cambio')

    const alta = (
      await screen.findByRole('heading', { name: 'Capturar un tipo de cambio' })
    ).closest('div.rounded-lg') as HTMLElement

    const fecha = within(alta).getByLabelText(/^Fecha/)
    await usuario.clear(fecha)
    await usuario.type(fecha, '2031-03-03')

    const capturar = async (compra: string, venta: string) => {
      await usuario.clear(within(alta).getByLabelText(/^Compra/))
      await usuario.type(within(alta).getByLabelText(/^Compra/), compra)
      await usuario.clear(within(alta).getByLabelText(/^Venta/))
      await usuario.type(within(alta).getByLabelText(/^Venta/), venta)
      const boton = within(alta).getByRole('button', {
        name: /Guardar tipo de cambio/,
      })
      await waitFor(() => expect(boton).toBeEnabled())
      await usuario.click(boton)
    }

    // Un día sin valor se guarda sin preguntar, con todos sus decimales.
    await capturar('500,1234', '505,5')
    expect(await within(alta).findByRole('status')).toHaveTextContent(
      /Tipo de cambio de USD del .* guardado/,
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    // El mismo día otra vez: se pregunta, con el valor que se va a perder.
    await capturar('501', '506')
    const dialogo = await screen.findByRole('dialog')
    expect(
      within(dialogo).getByText(/Reemplazar el tipo de cambio de USD/),
    ).toBeInTheDocument()
    expect(within(dialogo).getByText('500,1234')).toBeInTheDocument()
    expect(within(dialogo).getByText('505,50')).toBeInTheDocument()

    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const guardado = tiposCambioMock.find(
      (t) => t.moneda === 'USD' && t.fecha === '2031-03-03',
    )
    expect(guardado?.compra).toBe('500.1234')
  })
})
