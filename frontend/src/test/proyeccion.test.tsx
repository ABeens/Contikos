import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { restablecerMonedas } from '@/shared/money/money'
import { iniciarSesionDePrueba } from './sesion'

/** Flujo de efectivo proyectado (docs/17 §3, etapa 7 de bancos). */

const servidor = setupServer(...handlers)

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  servidor.resetHandlers()
  restablecerMonedas()
})
afterAll(() => servidor.close())

function montar() {
  const router = createMemoryRouter(rutas, { initialEntries: ['/bancos/proyeccion'] })
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('Flujo de efectivo proyectado', () => {
  it('proyecta trece semanas desde el saldo en libros', async () => {
    montar()
    expect(await screen.findByText('Saldo en libros hoy')).toBeInTheDocument()
    expect(await screen.findByText('punto más bajo')).toBeInTheDocument()
  })

  it('avisa cuando el rol no ve la planilla y por eso no la incluye', async () => {
    iniciarSesionDePrueba('usr-contadora')
    montar()
    expect(await screen.findByText(/Su rol no ve la planilla/)).toBeInTheDocument()
  })
})
