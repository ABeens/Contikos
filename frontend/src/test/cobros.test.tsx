import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioConta, servicioCxc } from '@/shared/api/servicios'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * Cobro de cuentas por cobrar, de punta a punta (docs/04 §2.2).
 *
 * Recorre lo que hace quien cobra: elige el cliente, ve sus facturas
 * pendientes, reparte lo recibido y confirma. Y comprueba las cinco cosas que
 * tienen que ocurrir juntas: nace el documento, nace su asiento, baja el saldo
 * de cada factura aplicada, la antigüedad lo refleja, y la suma de la
 * antigüedad sigue siendo exactamente el saldo de la cuenta de control en el
 * mayor, que es la verificación de integridad del módulo (docs/04 §3).
 *
 * Va en su propio archivo porque muta el estado del mock: después de cobrar,
 * los saldos que esperan las otras pruebas ya no son los de la semilla.
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

/** Agosto de 2026 está abierto en la semilla; setiembre también. */
const FECHA_COBRO = '2026-08-20'
const FECHA_ANULACION = '2026-09-15'
const AGOSTO = 'per-2026-08'
const CUENTA_CLIENTES = '1.1.02.001'

/** Comercial La Sabana: ya debe FV-000113 por 1 356 000. */
const CLIENTE = 'cli-002'

async function seleccionar(
  usuario: ReturnType<typeof userEvent.setup>,
  etiqueta: RegExp,
  valor: string,
) {
  const selector = await screen.findByLabelText(etiqueta)
  await waitFor(() =>
    expect(selector.querySelector(`option[value="${valor}"]`)).not.toBeNull(),
  )
  await usuario.selectOptions(selector, valor)
}

async function escribir(
  usuario: ReturnType<typeof userEvent.setup>,
  etiqueta: RegExp,
  valor: string,
) {
  const campo = await screen.findByLabelText(etiqueta)
  await usuario.clear(campo)
  await usuario.type(campo, valor)
}

/** Saldo de la cuenta de control de clientes en el mayor, al cierre del mes. */
async function saldoEnElMayor(periodoId: string): Promise<string> {
  const balanza = await servicioConta.obtenerBalanza(periodoId, 'fiscal')
  return balanza.renglones.find((r) => r.codigo === CUENTA_CLIENTES)!.saldoFinal
}

/**
 * Segunda factura del mismo cliente, para que el cobro tenga dos a las que
 * aplicarse: una que salda y otra que deja parcial.
 *
 * Se emite por la API y no por la pantalla porque lo que esta prueba recorre es
 * el cobro; la emisión ya tiene la suya en `modulos.test.tsx`.
 */
async function emitirSegundaFactura() {
  return servicioCxc.emitirFactura({
    clienteId: CLIENTE,
    fechaEmision: '2026-08-20',
    // Vence después de FV-000113: es lo que hace comprobable que el reparto
    // por antigüedad paga primero la más vieja.
    fechaVencimiento: '2026-09-19',
    moneda: 'CRC',
    tipoCambio: '1',
    lineas: [
      {
        descripcion: 'Venta de mercancías, pedido 4482',
        cantidad: '1',
        precioUnitario: '1000000',
        tarifa: 'GENERAL',
        cuentaIngreso: '4.1.01.002',
      },
    ],
  })
}

describe('Cobro de cuentas por cobrar', () => {
  it('salda una factura, deja otra parcial y contabiliza el asiento', async () => {
    const usuario = userEvent.setup()
    const segunda = await emitirSegundaFactura()
    expect(segunda.total).toBe('1130000.00')

    montar('/cxc/cobros/nuevo')

    await seleccionar(usuario, /^Cliente/, CLIENTE)
    await escribir(usuario, /Fecha del cobro/, FECHA_COBRO)
    // La cuenta de depósito por defecto es la bancaria, que es de control de
    // `bancos` y exige auxiliar. Mientras ese módulo no exista se captura.
    await escribir(usuario, /Cuenta bancaria/, 'bco-001')
    await escribir(usuario, /Importe recibido/, '2000000')
    await usuario.tab()

    // Las dos facturas pendientes del cliente están a la vista con su saldo.
    const tabla = within(
      await screen.findByRole('table', {
        name: 'Facturas pendientes del cliente',
      }),
    )
    expect(await tabla.findByText('FV-000113')).toBeInTheDocument()
    expect(tabla.getByText(segunda.numeroInterno)).toBeInTheDocument()

    await usuario.click(
      screen.getByRole('button', { name: /Aplicar todo lo que quepa/ }),
    )

    // Reparto por antigüedad: primero la que vence antes, hasta agotarla.
    await waitFor(() =>
      expect(
        tabla.getByLabelText('Importe aplicado a FV-000113'),
      ).toHaveValue('1.356.000,00'),
    )
    expect(
      tabla.getByLabelText(`Importe aplicado a ${segunda.numeroInterno}`),
    ).toHaveValue('644.000,00')

    // El asiento se ve ANTES de registrar, con la cuenta de control abonada.
    const asiento = within(screen.getByRole('table', { name: 'Asiento del cobro' }))
    expect(asiento.getByText('Clientes')).toBeInTheDocument()
    expect(asiento.getAllByText('2.000.000,00')).toHaveLength(2)

    await usuario.click(screen.getByRole('button', { name: /Registrar cobro/ }))

    // Tras registrar navega al listado, con el cobro nuevo dentro.
    await screen.findByRole('heading', { name: 'Cobros' })
    const fila = (await screen.findByText('COB-000089')).closest('tr')!
    expect(within(fila).getByText('Comercial La Sabana S.A.')).toBeInTheDocument()
    expect(within(fila).getByText('Transferencia')).toBeInTheDocument()

    // El documento: dos aplicaciones, nada de anticipo.
    const cobro = await servicioCxc.obtenerCobro('cob-089')
    expect(cobro.importeRecibido).toBe('2000000.00')
    expect(cobro.importeSinAplicar).toBe('0.00')
    expect(cobro.aplicaciones).toEqual([
      expect.objectContaining({
        facturaId: 'fac-113',
        importeAplicado: '1356000.00',
        saldoResultante: '0.00',
      }),
      expect.objectContaining({
        facturaId: segunda.id,
        importeAplicado: '644000.00',
        saldoResultante: '486000.00',
      }),
    ])

    // El saldo: una saldada y pagada, la otra con lo que le queda por cobrar.
    const saldada = await servicioCxc.obtenerFactura('fac-113')
    expect(saldada.saldo).toBe('0.00')
    expect(saldada.estado).toBe('pagada')
    const parcial = await servicioCxc.obtenerFactura(segunda.id)
    expect(parcial.saldo).toBe('486000.00')
    expect(parcial.estado).toBe('contabilizada')

    // El asiento: cargo al banco con su auxiliar, abono a la cuenta de control
    // con el del cliente, y cuadre exacto.
    const generado = await servicioCxc.obtenerAsientoDeCobro(cobro.id)
    expect(generado.origenTipo).toBe('cobro')
    expect(generado.origenId).toBe('cob-089')
    expect(generado.totales[0].totalCargos).toBe('2000000.00')
    expect(generado.totales[0].totalAbonos).toBe('2000000.00')
    expect(generado.lineas).toEqual([
      expect.objectContaining({
        cuentaCodigo: '1.1.01.010',
        cargo: '2000000.00',
        auxiliarTipo: 'banco',
        auxiliarId: 'bco-001',
      }),
      expect.objectContaining({
        cuentaCodigo: CUENTA_CLIENTES,
        abono: '2000000.00',
        auxiliarTipo: 'cliente',
        auxiliarId: CLIENTE,
      }),
    ])

    // Y el saldo del cliente ya solo es lo que queda de la segunda factura.
    const clientes = await servicioCxc.listarClientes()
    expect(clientes.find((c) => c.id === CLIENTE)!.saldo).toBe('486000.00')
  })

  it('la antigüedad refleja el cobro y sigue cuadrando contra el mayor', async () => {
    montar('/cxc?corte=2026-08-31')

    const antiguedad = (await screen.findAllByRole('table'))[0]
    const sabana = within(antiguedad)
      .getByText('Comercial La Sabana S.A.')
      .closest('tr')!
    // FV-000113 quedó saldada; lo que queda es la segunda factura, que vence
    // el 19 de setiembre: sigue por vencer al corte.
    expect(within(sabana).getAllByRole('cell')[1]).toHaveTextContent(
      '486.000,00',
    )

    // La verificación de integridad del módulo: el auxiliar y la cuenta de
    // control cuentan lo mismo.
    const corte = await servicioCxc.obtenerAntiguedad('2026-08-31')
    expect(corte.totales.total).toBe('1318000.00')
    expect(corte.totales.total).toBe(await saldoEnElMayor(AGOSTO))
  })

  it('la anulación devuelve el saldo y reversa el asiento', async () => {
    const usuario = userEvent.setup()
    montar('/cxc/cobros/cob-089')

    await usuario.click(await screen.findByRole('button', { name: 'Anular' }))
    await escribir(usuario, /Fecha de la anulación/, FECHA_ANULACION)
    await escribir(usuario, /Motivo/, 'La transferencia fue rechazada')
    await usuario.click(
      screen.getByRole('button', { name: /Confirmar anulación/ }),
    )

    await waitFor(async () => {
      const cobro = await servicioCxc.obtenerCobro('cob-089')
      expect(cobro.estado).toBe('anulado')
    })

    const cobro = await servicioCxc.obtenerCobro('cob-089')
    expect(cobro.anuladoEn).toBe(FECHA_ANULACION)
    expect(cobro.motivoAnulacion).toBe('La transferencia fue rechazada')
    expect(cobro.asientoReversaId).not.toBeNull()

    // El saldo vuelve a las dos facturas, y con él su estado.
    const devuelta = await servicioCxc.obtenerFactura('fac-113')
    expect(devuelta.saldo).toBe('1356000.00')
    expect(devuelta.estado).toBe('contabilizada')

    // El asiento original queda reversado, no borrado (docs/02 §6).
    const original = await servicioCxc.obtenerAsientoDeCobro('cob-089')
    expect(original.estado).toBe('reversado')
    expect(original.reversadoPorId).toBe(cobro.asientoReversaId)

    // La reversa va en setiembre, así que el mayor de AGOSTO no la conoce: la
    // antigüedad al 31 de agosto tiene que seguir dando lo mismo que entonces.
    // Es lo que hace reproducible un aging de un cierre pasado (docs/04 §3).
    const enAgosto = await servicioCxc.obtenerAntiguedad('2026-08-31')
    expect(enAgosto.totales.total).toBe('1318000.00')
    expect(enAgosto.totales.total).toBe(await saldoEnElMayor(AGOSTO))

    // Y al 30 de setiembre el saldo ya volvió, en el auxiliar y en el mayor.
    const enSetiembre = await servicioCxc.obtenerAntiguedad('2026-09-30')
    expect(enSetiembre.totales.total).toBe('3318000.00')
    expect(enSetiembre.totales.total).toBe(await saldoEnElMayor('per-2026-09'))

    // Anularlo dos veces no reversa dos veces.
    await expect(
      servicioCxc.anularCobro('cob-089', {
        fecha: FECHA_ANULACION,
        motivo: 'Otra vez',
      }),
    ).rejects.toMatchObject({ codigo: 'COBRO_YA_ANULADO', status: 409 })
  })

  it('rechaza aplicar a una factura más de lo que debe', async () => {
    await expect(
      servicioCxc.registrarCobro({
        clienteId: CLIENTE,
        fecha: FECHA_COBRO,
        moneda: 'CRC',
        tipoCambio: '1',
        medio: '01',
        referencia: null,
        // Caja general: no exige auxiliar, así que lo único que se prueba es
        // el exceso sobre el saldo.
        cuentaDeposito: '1.1.01.001',
        auxiliarBanco: null,
        importeRecibido: '5000000.00',
        aplicaciones: [
          { facturaId: 'fac-113', importeAplicado: '5000000.00' },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'APLICACION_EXCEDE_SALDO' })

    // Y no dejó rastro: el saldo de la factura no se movió.
    const factura = await servicioCxc.obtenerFactura('fac-113')
    expect(factura.saldo).toBe('1356000.00')
  })
})
