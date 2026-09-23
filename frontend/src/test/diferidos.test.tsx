import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioConta, servicioDiferidos } from '@/shared/api/servicios'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * Asientos diferidos de punta a punta (docs/15).
 *
 * Recorre lo que hace el usuario: registra el plan, verifica la corrida del
 * periodo abierto y la contabiliza. Y comprueba lo que tiene que pasar junto:
 * el alta NO toca el mayor, la corrida sí, el saldo por amortizar baja
 * exactamente la cuota, y la segunda corrida del mismo periodo se rechaza en
 * vez de duplicar el reconocimiento.
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
  return within(await screen.findByRole('table', { name: 'Corrida de amortización' }))
}

describe('Alta de un diferido', () => {
  it('proyecta el plan, lo guarda y no toca el mayor', async () => {
    const usuario = userEvent.setup()
    montar('/diferidos/nuevo')

    const antes = await servicioConta.listarAsientos()

    await usuario.type(
      await screen.findByLabelText(/Descripción/),
      'Póliza de vehículos 2027',
    )
    await usuario.type(screen.getByLabelText(/^Monto/), '1000')
    await usuario.clear(screen.getByLabelText(/Plazo en meses/))
    await usuario.type(screen.getByLabelText(/Plazo en meses/), '3')
    await usuario.clear(screen.getByLabelText(/Fecha de inicio/))
    await usuario.type(screen.getByLabelText(/Fecha de inicio/), '2026-10-01')

    // La cuenta de anticipos exige auxiliar de proveedor: sin él, el asiento de
    // la corrida se rechazaría cada mes.
    await usuario.type(
      screen.getByLabelText('Cuenta de balance del diferido'),
      '1.1.05.001',
    )
    await usuario.type(
      screen.getByLabelText('Cuenta de resultados del diferido'),
      '6.1.02.003',
    )
    const auxiliar = screen.getByLabelText('Auxiliar')
    await waitFor(() => expect(auxiliar).toBeEnabled())
    await usuario.type(auxiliar, 'P-014')

    // El plan se ve antes de guardar, y la última cuota cierra el saldo exacto
    // en cero aunque 1.000 entre 3 no sea divisible.
    const plan = within(
      await screen.findByRole('table', { name: 'Tabla de amortización' }),
    )
    const ultima = within(plan.getAllByRole('row').at(-1)!)
    expect(ultima.getByText('333,34')).toBeInTheDocument()
    expect(ultima.getByText('1.000,00')).toBeInTheDocument()
    expect(ultima.getByText('0,00')).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: /Registrar diferido/ }))

    // Se llega a su ficha, con el plan íntegro por amortizar.
    await screen.findByRole('heading', { name: /Póliza de vehículos 2027/ })
    const diferidos = await servicioDiferidos.listar()
    const nuevo = diferidos.find((d) => d.descripcion === 'Póliza de vehículos 2027')!
    expect(nuevo).toMatchObject({
      monto: '1000.00',
      montoAmortizado: '0.00',
      saldoPorAmortizar: '1000.00',
      plazoMeses: 3,
      cuotaMensual: '333.33',
      estado: 'vigente',
      amortizaciones: [],
    })
    expect(nuevo.tercero).toMatchObject({ tipo: 'proveedor', id: 'pro-014' })

    // El alta no contabiliza nada (docs/15 §3.1): el importe ya lo puso en la
    // cuenta de balance el documento que originó el diferido.
    const despues = await servicioConta.listarAsientos()
    expect(despues).toHaveLength(antes.length)
  })
})

describe('Amortización de diferidos', () => {
  it('previsualiza agosto de 2026 con sus tres diferidos y sin escribir nada', async () => {
    const usuario = userEvent.setup()
    montar('/diferidos/amortizacion')

    const tabla = await verificarAgosto(usuario)
    expect(
      tabla.getByText('Póliza de seguro de responsabilidad civil 2026'),
    ).toBeInTheDocument()
    expect(
      tabla.getByText(/Alquiler de bodega pagado por adelantado/),
    ).toBeInTheDocument()
    expect(
      tabla.getByText(/Mantenimiento anual de plataforma cobrado por adelantado/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Sin observaciones/)).toBeInTheDocument()

    // El asiento propuesto se ve antes de contabilizar: el gasto carga
    // resultados y abona el balance, y el ingreso al revés.
    const asiento = within(screen.getByRole('table', { name: 'Asiento propuesto' }))
    expect(asiento.getAllByText('Servicios profesionales').length).toBeGreaterThan(0)
    expect(asiento.getAllByText('Anticipos de clientes').length).toBeGreaterThan(0)

    const previa = await servicioDiferidos.previsualizarAmortizacion(AGOSTO)
    expect(previa.corrida.lineas).toHaveLength(3)
    expect(previa.corrida.totalGasto).toBe('550000.00')
    expect(previa.corrida.totalIngreso).toBe('300000.00')
    expect(previa.corrida.puedeContabilizar).toBe(true)

    // Previsualizar no escribe nada.
    const diferidos = await servicioDiferidos.listar()
    expect(diferidos.map((d) => d.saldoPorAmortizar)).toEqual(
      expect.arrayContaining(['750000.00', '800000.00', '1500000.00']),
    )
  })

  it('contabiliza la corrida, baja el saldo y rechaza la segunda', async () => {
    const usuario = userEvent.setup()
    montar('/diferidos/amortizacion')

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

    // El saldo bajó exactamente la cuota, y la ficha lleva el rastro.
    const diferidos = await servicioDiferidos.listar()
    const poliza = diferidos.find((d) => d.id === 'dif-0001')!
    expect(poliza.montoAmortizado).toBe('1200000.00')
    expect(poliza.saldoPorAmortizar).toBe('600000.00')
    expect(poliza.estado).toBe('vigente')
    expect(poliza.amortizaciones.at(-1)).toMatchObject({
      periodoId: AGOSTO,
      fecha: '2026-08-31',
      cuota: '150000.00',
    })

    const ingreso = diferidos.find((d) => d.id === 'dif-0003')!
    expect(ingreso.saldoPorAmortizar).toBe('1200000.00')

    // El asiento existe, cuadra y carga cada lado donde le toca.
    const asientoId = poliza.amortizaciones.at(-1)!.asientoId
    const asientos = await servicioConta.listarAsientos({ periodoId: AGOSTO })
    const asiento = asientos.find((a) => a.id === asientoId)!
    expect(asiento.origenTipo).toBe('amortizacion_diferidos')
    // El asiento es uno solo y cuadra: 550.000 de gasto más 300.000 de ingreso.
    for (const total of asiento.totales) {
      expect(total.totalCargos).toBe('850000.00')
      expect(total.totalAbonos).toBe('850000.00')
    }

    // El historial ya enseña agosto junto a las cuotas anteriores.
    const historial = within(
      await screen.findByRole('table', { name: 'Historial de corridas' }),
    )
    await waitFor(() =>
      expect(historial.getByText('Agosto 2026')).toBeInTheDocument(),
    )
    expect(historial.getByText('Julio 2026')).toBeInTheDocument()

    // Idempotencia por origen: la segunda vez no duplica el reconocimiento.
    await expect(
      servicioDiferidos.contabilizarAmortizacion({
        periodoId: AGOSTO,
        confirmarAvisos: true,
      }),
    ).rejects.toMatchObject({ codigo: 'CORRIDA_YA_CONTABILIZADA', status: 409 })

    // Y la verificación previa de agosto ahora lo dice en rojo.
    const previa = await servicioDiferidos.previsualizarAmortizacion(AGOSTO)
    expect(previa.corrida.puedeContabilizar).toBe(false)
    expect(previa.corrida.verificaciones).toContainEqual(
      expect.objectContaining({
        codigo: 'CORRIDA_YA_CONTABILIZADA',
        severidad: 'error',
      }),
    )
  })
})

describe('Ficha del diferido', () => {
  it('cancela anticipadamente con confirmación y reconoce el saldo', async () => {
    const usuario = userEvent.setup()
    montar('/diferidos?diferido=dif-0001')

    await usuario.click(
      await screen.findByRole('button', { name: /Cancelar anticipadamente/ }),
    )

    // Se confirma con el importe delante: es irreversible y toca el mayor.
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent(/600\.000,00/)
    const fecha = within(dialogo).getByLabelText(/Fecha de la cancelación/)
    await usuario.clear(fecha)
    await usuario.type(fecha, '2026-08-31')
    await usuario.type(
      within(dialogo).getByLabelText(/Motivo/),
      'Se vendió el vehículo asegurado',
    )
    await usuario.click(
      within(dialogo).getByRole('button', { name: /Cancelar y reconocer/ }),
    )

    // La ficha sigue abierta y enseña la cancelación con su asiento.
    expect(await screen.findByText(/Cancelado el/)).toBeInTheDocument()
    const poliza = (await servicioDiferidos.listar()).find(
      (d) => d.id === 'dif-0001',
    )!
    expect(poliza.estado).toBe('cancelado')
    expect(poliza.saldoPorAmortizar).toBe('0.00')
    expect(poliza.cancelacion?.asientoId).toBeTruthy()
  })
})
