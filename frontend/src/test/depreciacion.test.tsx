import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Decimal from 'decimal.js'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioActivos } from '@/shared/api/servicios'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * Depreciación mensual de punta a punta (docs/07 §3.2).
 *
 * Recorre lo que hace el usuario: elige el periodo, verifica, contabiliza. Y
 * comprueba lo que tiene que pasar junto: nace el asiento, sube la acumulada
 * de cada ficha, y la segunda corrida del mismo periodo se rechaza en vez de
 * duplicar el gasto.
 *
 * Va en su propio archivo porque muta el estado del mock: después de
 * contabilizar agosto, los saldos que esperan las otras pruebas ya no son los
 * de la semilla.
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

const AGOSTO = 'per-2026-08'

async function verificarAgosto(usuario: ReturnType<typeof userEvent.setup>) {
  const selector = await screen.findByLabelText(/Periodo de la corrida/)
  // Por defecto, el periodo activo del contexto: agosto, el primero abierto.
  await waitFor(() => expect(selector).toHaveValue(AGOSTO))
  await usuario.click(screen.getByRole('button', { name: /^Verificar/ }))
  return within(await screen.findByRole('table', { name: 'Corrida de depreciación' }))
}

describe('Depreciación de activos', () => {
  it('previsualiza agosto de 2026 con sus líneas y sin bajar del residual', async () => {
    const usuario = userEvent.setup()
    montar('/activos/depreciacion')

    const tabla = await verificarAgosto(usuario)
    expect(tabla.getByText('Mobiliario oficina central')).toBeInTheDocument()
    expect(tabla.getByText('Lote equipo de cómputo 2024')).toBeInTheDocument()
    expect(
      tabla.getByText('Servidor de aplicaciones Dell PowerEdge'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Sin observaciones/)).toBeInTheDocument()

    // El asiento propuesto se ve antes de contabilizar, con sus dos libros.
    const asiento = within(screen.getByRole('table', { name: 'Asiento propuesto' }))
    expect(asiento.getAllByText('Gasto por depreciación').length).toBeGreaterThan(0)

    // Ninguna cuota deja el valor en libros por debajo del residual.
    const previa = await servicioActivos.previsualizarDepreciacion(AGOSTO)
    const activos = await servicioActivos.listar()
    expect(previa.corrida.lineas).toHaveLength(3)
    for (const linea of previa.corrida.lineas) {
      const ficha = activos.find((a) => a.id === linea.activoId)!
      expect(
        new Decimal(linea.valorEnLibrosResultante).greaterThanOrEqualTo(
          ficha.valorResidual,
        ),
      ).toBe(true)
      expect(new Decimal(linea.cuota).greaterThan(0)).toBe(true)
    }
    expect(previa.corrida.total).toBe('315000.00')
    expect(previa.corrida.puedeContabilizar).toBe(true)

    // Previsualizar no escribe nada.
    const despues = await servicioActivos.listar()
    expect(despues.map((a) => a.depreciacionAcumulada)).toEqual(
      activos.map((a) => a.depreciacionAcumulada),
    )
  })

  it('contabiliza la corrida, actualiza las fichas y rechaza la segunda', async () => {
    const usuario = userEvent.setup()
    montar('/activos/depreciacion')

    await verificarAgosto(usuario)
    const boton = screen.getByRole('button', { name: /Contabilizar/ })
    await waitFor(() => expect(boton).toBeEnabled())
    await usuario.click(boton)

    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent(/Corrida contabilizada/)
    expect(aviso).toHaveTextContent(/3 fichas actualizadas/)
    // El enlace abre el asiento de la corrida, no el libro en blanco.
    expect(
      within(aviso).getByRole('link', { name: /libro de asientos/ }),
    ).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/conta\/asientos\?asiento=/),
    )

    // La acumulada subió exactamente la cuota, y la ficha lleva el rastro.
    const activos = await servicioActivos.listar()
    const mobiliario = activos.find((a) => a.id === 'act-008')!
    expect(mobiliario.depreciacionAcumulada).toBe('3875000.00')
    expect(mobiliario.valorEnLibros).toBe('11125000.00')
    expect(mobiliario.depreciaciones.at(-1)).toMatchObject({
      periodoId: AGOSTO,
      fecha: '2026-08-31',
      cuota: '125000.00',
    })
    const servidor = activos.find((a) => a.id === 'act-030')!
    expect(servidor.depreciacionAcumulada).toBe('40000.00')
    expect(servidor.estado).toBe('activo')

    // El historial ya enseña agosto junto a julio.
    const historial = within(
      await screen.findByRole('table', { name: 'Historial de corridas' }),
    )
    await waitFor(() =>
      expect(historial.getByText('Agosto 2026')).toBeInTheDocument(),
    )
    expect(historial.getByText('Julio 2026')).toBeInTheDocument()

    // Idempotencia por origen: la segunda vez no duplica el gasto.
    await expect(
      servicioActivos.contabilizarDepreciacion({
        periodoId: AGOSTO,
        confirmarAvisos: true,
      }),
    ).rejects.toMatchObject({ codigo: 'CORRIDA_YA_CONTABILIZADA', status: 409 })

    // Y la verificación previa de agosto ahora lo dice en rojo.
    const previa = await servicioActivos.previsualizarDepreciacion(AGOSTO)
    expect(previa.corrida.puedeContabilizar).toBe(false)
    expect(previa.corrida.verificaciones).toContainEqual(
      expect.objectContaining({
        codigo: 'CORRIDA_YA_CONTABILIZADA',
        severidad: 'error',
      }),
    )
  })

  it('setiembre avisa de lo que falta y exige confirmar los avisos', async () => {
    const usuario = userEvent.setup()
    montar('/activos/depreciacion')

    const selector = await screen.findByLabelText(/Periodo de la corrida/)
    await waitFor(() => expect(selector).toHaveValue(AGOSTO))
    // Octubre, para que el mes anterior (setiembre) no tenga corrida.
    await usuario.selectOptions(selector, 'per-2026-10')
    await usuario.click(screen.getByRole('button', { name: /^Verificar/ }))

    const lista = within(await screen.findByRole('list', { name: 'Verificaciones' }))
    expect(
      lista.getByText(/Setiembre 2026 no tiene corrida/),
    ).toBeInTheDocument()

    // Sin confirmar los avisos, el botón sigue apagado.
    const boton = await screen.findByRole('button', { name: /Contabilizar/ })
    expect(boton).toBeDisabled()
    await usuario.click(screen.getByLabelText(/He revisado los avisos/))
    expect(boton).toBeEnabled()

    // Y el servidor exige la misma confirmación aunque se salte la pantalla.
    await expect(
      servicioActivos.contabilizarDepreciacion({
        periodoId: 'per-2026-10',
        confirmarAvisos: false,
      }),
    ).rejects.toMatchObject({ codigo: 'CORRIDA_CON_AVISOS' })
  })
})
