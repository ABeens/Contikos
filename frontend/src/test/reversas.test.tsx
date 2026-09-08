import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { ApiError } from '@/shared/api/client'
import { servicioConta } from '@/shared/api/servicios'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * Reversa de asientos (docs/02 §6), de punta a punta.
 *
 * Va en un archivo aparte porque reversar muta el libro del mock: el humo del
 * núcleo espera los saldos de la semilla tal cual, y aquí se neutraliza uno.
 *
 * Lo que se comprueba es la semántica que se eligió para la balanza: el
 * original NO sale del mayor. Se acumulan él y su reversa, y el par se anula
 * solo en el saldo. Por eso tras reversar la cuenta muestra los dos
 * movimientos y saldo cero, y no "como si nunca hubiera pasado".
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

/** Dentro de agosto 2026, el periodo activo de la semilla. */
const FECHA_REVERSA = '2026-08-25'

/** El asiento manual de la semilla: papelería contra caja chica, 38.000. */
const CONCEPTO_ORIGINAL = 'Reclasificación de gastos de papelería'
const CODIGO_ORIGINAL = 'AS-2026-000010'

describe('Reversa de un asiento', () => {
  it('reversa desde el detalle y enlaza el par en los dos sentidos', async () => {
    const usuario = userEvent.setup()
    montar('/conta/asientos')

    // La lista muestra el código con ejercicio, no el número suelto
    const fila = (await screen.findByText(CONCEPTO_ORIGINAL)).closest('tr')!
    expect(within(fila).getByText(CODIGO_ORIGINAL)).toBeInTheDocument()
    expect(within(fila).getByText('Contabilizado')).toBeInTheDocument()

    await usuario.click(within(fila).getByText(CONCEPTO_ORIGINAL))
    expect(await screen.findByText('Detalle del asiento')).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: /Reversar/ }))

    // El diálogo previsualiza las líneas invertidas antes de confirmar: la
    // papelería (cargo original) ahora va al abono.
    const dialogo = await screen.findByRole('dialog')
    expect(
      within(dialogo).getByText(`Reversar el asiento ${CODIGO_ORIGINAL}`),
    ).toBeInTheDocument()
    const filaPapeleria = within(dialogo)
      .getByText('6.1.02.004')
      .closest('tr')!
    const celdas = within(filaPapeleria).getAllByRole('cell')
    // Cuenta, concepto, cargo, abono: el cargo va vacío y el abono lleva el importe
    expect(celdas[2]).toHaveTextContent('')
    expect(celdas[3]).toHaveTextContent('38.000,00')

    // Sin motivo no se reversa
    await usuario.click(
      within(dialogo).getByRole('button', { name: 'Confirmar reversa' }),
    )
    expect(
      await within(dialogo).findByText('El motivo de la reversa es obligatorio'),
    ).toBeInTheDocument()

    const fecha = within(dialogo).getByLabelText(/Fecha de la reversa/)
    await usuario.clear(fecha)
    await usuario.type(fecha, FECHA_REVERSA)
    await usuario.type(
      within(dialogo).getByLabelText(/^Motivo/),
      'Se reclasificó contra la cuenta equivocada',
    )
    await usuario.click(
      within(dialogo).getByRole('button', { name: 'Confirmar reversa' }),
    )

    // El diálogo se cierra y el original aparece reversado, con el enlace a
    // la reversa recién emitida y el motivo en la bitácora.
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    const enlace = await screen.findByRole('button', {
      name: 'AS-2026-000015',
    })
    expect(screen.getByText(/Reversado por el asiento/)).toBeInTheDocument()
    expect(
      screen.getByText(/Motivo: Se reclasificó contra la cuenta equivocada/),
    ).toBeInTheDocument()
    // Y ya no se ofrece reversar otra vez
    expect(screen.queryByRole('button', { name: /Reversar/ })).toBeNull()

    // En la lista, el original lleva el badge y la reversa es una fila más.
    // El concepto está dos veces en pantalla (la fila y el panel abierto), así
    // que se busca el que está dentro de una fila.
    const filaOriginal = screen
      .getAllByText(CONCEPTO_ORIGINAL)
      .find((nodo) => nodo.closest('tr'))!
      .closest('tr')!
    expect(within(filaOriginal).getByText('Reversado')).toBeInTheDocument()
    const filaReversa = screen
      .getByText(
        `Reversa del asiento ${CODIGO_ORIGINAL}: Se reclasificó contra la cuenta equivocada`,
      )
      .closest('tr')!
    expect(within(filaReversa).getByText('AS-2026-000015')).toBeInTheDocument()
    expect(within(filaReversa).getByText('Contabilizado')).toBeInTheDocument()
    expect(within(filaReversa).getByText('conta · reversa')).toBeInTheDocument()

    // El enlace abre la reversa en el mismo panel, que apunta de vuelta. El
    // concepto de la reversa también está en su fila de la lista: el del panel
    // es el que no cuelga de ninguna.
    await usuario.click(enlace)
    const enPanel = (await screen.findAllByText(/Reversa del asiento/)).find(
      (nodo) => !nodo.closest('tr'),
    )
    expect(enPanel).toBeDefined()
    expect(
      screen.getByRole('button', { name: CODIGO_ORIGINAL }),
    ).toBeInTheDocument()
    // Una reversa no se reversa
    expect(screen.queryByRole('button', { name: /Reversar/ })).toBeNull()
  })

  it('la balanza del periodo sigue cuadrando y el par se neutraliza en el saldo', async () => {
    const balanza = await servicioConta.obtenerBalanza('per-2026-08', 'fiscal')
    expect(balanza.cuadra).toBe(true)

    // Caja chica solo la movía el asiento reversado: ahora tiene el abono
    // original y el cargo de la reversa, y el saldo vuelve al inicial.
    const cajaChica = balanza.renglones.find((r) => r.codigo === '1.1.01.002')!
    expect(cajaChica.cargos).toBe('38000.00')
    expect(cajaChica.abonos).toBe('38000.00')
    expect(cajaChica.saldoFinal).toBe(cajaChica.saldoInicial)

    // Y papelería conserva la factura de proveedor de agosto (180.000) más el
    // par neutralizado: los movimientos no desaparecen, se compensan.
    const papeleria = balanza.renglones.find((r) => r.codigo === '6.1.02.004')!
    expect(papeleria.cargos).toBe('218000.00')
    expect(papeleria.abonos).toBe('38000.00')
    expect(papeleria.saldoFinal).toBe('180000.00')
  })

  it('es idempotente: la misma solicitud devuelve la misma reversa, otra se rechaza', async () => {
    const asientos = await servicioConta.listarAsientos({
      periodoId: 'per-2026-08',
    })
    const original = asientos.find((a) => a.concepto === CONCEPTO_ORIGINAL)!
    expect(original.estado).toBe('reversado')
    expect(original.reversadoPorId).toBe('asi-2026-000015')

    const repetida = await servicioConta.reversarAsiento(original.id, {
      fecha: FECHA_REVERSA,
      motivo: 'Se reclasificó contra la cuenta equivocada',
    })
    expect(repetida.id).toBe('asi-2026-000015')
    expect(repetida.reversaDeId).toBe(original.id)

    await expect(
      servicioConta.reversarAsiento(original.id, {
        fecha: FECHA_REVERSA,
        motivo: 'Otro motivo',
      }),
    ).rejects.toMatchObject({ codigo: 'ASIENTO_YA_REVERSADO' })

    // La reversa tampoco se reversa
    await expect(
      servicioConta.reversarAsiento(repetida.id, {
        fecha: FECHA_REVERSA,
        motivo: 'Deshacer',
      }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ApiError && e.codigo === 'REVERSA_NO_REVERSABLE',
    )
  })

  it('rechaza una reversa en periodo cerrado', async () => {
    const asientos = await servicioConta.listarAsientos({
      periodoId: 'per-2026-08',
    })
    const comisiones = asientos.find((a) => a.origenId === 'com-0805')!
    await expect(
      servicioConta.reversarAsiento(comisiones.id, {
        fecha: '2026-07-15',
        motivo: 'Fuera de tiempo',
      }),
    ).rejects.toMatchObject({ codigo: 'PERIODO_CERRADO' })
  })
})
