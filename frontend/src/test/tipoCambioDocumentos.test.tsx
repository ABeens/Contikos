import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioConfig } from '@/shared/api/servicios'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * El tipo de cambio de un documento es el del día del documento (docs/13 §7).
 *
 * Las capturas de CxC y CxP lo proponen desde la tabla de tipos de cambio y
 * lo vuelven a proponer al cambiar la moneda o la fecha, salvo que quien
 * captura lo haya tecleado a mano: desde ese momento, manda lo tecleado.
 *
 * No emite nada: solo mira el campo, así que no toca el estado del mock.
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
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
}

async function escribir(
  usuario: ReturnType<typeof userEvent.setup>,
  etiqueta: RegExp,
  valor: string,
) {
  const campo = screen.getByLabelText(etiqueta)
  await usuario.clear(campo)
  await usuario.type(campo, valor)
}

/** Venta del dólar que rige en esa fecha, según la misma tabla del mock. */
async function ventaDolar(fecha: string): Promise<string> {
  return (await servicioConfig.tipoCambioVigente('USD', fecha)).venta
}

describe('Tipo de cambio vigente en las capturas', () => {
  it('la factura de venta propone el del día de emisión y lo sigue', async () => {
    const usuario = userEvent.setup()
    montar('/cxc/facturas/nueva')

    await usuario.selectOptions(await screen.findByLabelText(/^Moneda/), 'USD')
    await escribir(usuario, /Fecha de emisión/, '2026-03-16')

    const campo = screen.getByLabelText(/^Tipo de cambio/)
    const marzo = await ventaDolar('2026-03-16')
    await waitFor(() => expect(campo).toHaveValue(marzo))

    // Otra fecha, otro tipo: el de junio no es el de marzo.
    await escribir(usuario, /Fecha de emisión/, '2026-06-15')
    const junio = await ventaDolar('2026-06-15')
    expect(junio).not.toBe(marzo)
    await waitFor(() => expect(campo).toHaveValue(junio))

    // Tecleado a mano, cambiar la fecha ya no lo pisa.
    await usuario.clear(campo)
    await usuario.type(campo, '600.00')
    await escribir(usuario, /Fecha de emisión/, '2026-03-16')
    expect(campo).toHaveValue('600.00')

    // Volver a la moneda funcional lo deja en 1.
    await usuario.selectOptions(screen.getByLabelText(/^Moneda/), 'CRC')
    expect(campo).toHaveValue('1')
  })

  it('el pago propone el del día del pago', async () => {
    const usuario = userEvent.setup()
    montar('/cxp/pagos/nuevo')

    await usuario.selectOptions(await screen.findByLabelText(/^Moneda/), 'USD')
    await escribir(usuario, /Fecha del pago/, '2026-05-04')

    const campo = screen.getByLabelText(/^Tipo de cambio/)
    const esperado = await ventaDolar('2026-05-04')
    await waitFor(() => expect(campo).toHaveValue(esperado))
  })
})
