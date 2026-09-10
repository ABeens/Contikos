import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioConta, servicioCxp } from '@/shared/api/servicios'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * El pago de cuentas por pagar, de punta a punta (docs/05 §2.2).
 *
 * Lo que se comprueba no es que la pantalla funcione, sino que las cuatro
 * cuentas que llevan lo mismo sigan diciendo lo mismo después de pagar: el
 * saldo de la factura, el saldo del proveedor, la antigüedad y la cuenta de
 * control en el mayor. Una prueba que solo mirara el documento dejaría pasar
 * justo el error que importa.
 *
 * Va en su propio archivo porque muta el estado del mock: pagar aquí cambiaría
 * los saldos que esperan las pruebas de facturación.
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

/** Agosto de 2026 es el periodo abierto de la semilla. */
const FECHA_PAGO = '2026-08-20'
const CORTE = '2026-08-31'
const PERIODO = 'per-2026-08'
/** Suministros de Oficina Delta: dos facturas con saldo, 7788 y 8010. */
const PROVEEDOR = 'pro-021'
const BANCO = '1.1.01.010'
/**
 * La ficha del catálogo de bancos con la que esa cuenta vive en el mayor.
 *
 * La captura por pantalla la resuelve sola al elegir la cuenta de salida; las
 * llamadas directas al servicio la mandan, igual que la mandará el backend.
 */
const CUENTA_BANCARIA = 'bco-001'

/**
 * Valor de la opción en el selector de cuenta de salida.
 *
 * Lleva las dos partes porque elegir de dónde sale el dinero es una sola
 * decisión que resuelve dos datos: la cuenta del mayor y la ficha bancaria con
 * la que vive en él (docs/06 §1).
 */
const OPCION_BANCO = `${BANCO}::${CUENTA_BANCARIA}`
const CONTROL_PROVEEDORES = '2.1.01.001'

async function escribir(
  usuario: ReturnType<typeof userEvent.setup>,
  etiqueta: RegExp | string,
  valor: string,
) {
  const campo = screen.getByLabelText(etiqueta)
  await usuario.clear(campo)
  await usuario.type(campo, valor)
}

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

/** Saldo acreedor de la cuenta de control en el libro fiscal. */
async function saldoControl(): Promise<string> {
  const balanza = await servicioConta.obtenerBalanza(PERIODO, 'fiscal')
  const renglon = balanza.renglones.find(
    (r) => r.codigo === CONTROL_PROVEEDORES,
  )!
  return renglon.saldoFinal
}

async function totalAntiguedad(): Promise<string> {
  const antiguedad = await servicioCxp.obtenerAntiguedad(CORTE)
  return antiguedad.totales.total
}

async function saldoDeFactura(id: string): Promise<string> {
  return (await servicioCxp.obtenerFactura(id)).saldo
}

describe('La semilla arranca cuadrada', () => {
  it('la antigüedad coincide con la cuenta de control del mayor', async () => {
    // El pago de la demo dejó saldada la 4521, y por eso no está en la cartera
    expect(await saldoDeFactura('fpr-4521')).toBe('0.00')

    expect(await totalAntiguedad()).toBe('9647400.00')
    expect(await saldoControl()).toBe('9647400.00')
  })

  it('el pago de la semilla enlaza con su asiento y con su factura', async () => {
    const pagos = await servicioCxp.listarPagos({ facturaId: 'fpr-4521' })
    expect(pagos.map((p) => p.folio)).toEqual(['PAG-000231'])

    const asiento = await servicioCxp.obtenerAsientoDePago(pagos[0].id)
    expect(asiento.origenTipo).toBe('pago')
    expect(asiento.origenId).toBe('pag-231')
  })
})

describe('Emitir un pago', () => {
  it('salda una factura, deja otra parcial y cuadra contra el mayor', async () => {
    const usuario = userEvent.setup()
    montar('/cxp/pagos/nuevo')

    await seleccionar(usuario, /Proveedor/, PROVEEDOR)
    await escribir(usuario, /Fecha del pago/, FECHA_PAGO)
    await seleccionar(usuario, /Cuenta de salida/, OPCION_BANCO)
    await escribir(usuario, /Referencia/, 'TRF-70001')

    // Las dos facturas del proveedor aparecen ordenadas por vencimiento
    const tabla = await screen.findByRole('table', {
      name: 'Facturas pendientes',
    })
    expect(within(tabla).getByText('7788')).toBeInTheDocument()
    expect(within(tabla).getByText('8010')).toBeInTheDocument()

    // 203 400 saldan la 7788 y el resto abona la 8010
    await escribir(usuario, /Importe del pago/, '1203400')
    await usuario.click(
      screen.getByRole('button', { name: /Repartir por antigüedad/ }),
    )

    await waitFor(() =>
      expect(
        screen.getByLabelText('Importe aplicado a la factura 7788'),
      ).toHaveValue('203.400,00'),
    )
    expect(
      screen.getByLabelText('Importe aplicado a la factura 8010'),
    ).toHaveValue('1.000.000,00')

    // El asiento se ve ANTES de emitir, con el auxiliar de cada cuenta de
    // control: sin eso, quien paga no puede comprobar contra qué se aplica.
    expect(screen.getByText('Asiento que se generará')).toBeInTheDocument()
    expect(screen.getAllByText(/proveedor: pro-021/)).toHaveLength(2)
    expect(screen.getByText(/banco: bco-001/)).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: /Emitir pago/ }))

    // Nace el documento, con sus dos aplicaciones y sin anticipo
    await screen.findByRole('heading', { name: /^Pago PAG-/ })
    const aplicaciones = await screen.findByRole('table', {
      name: 'Aplicaciones del pago',
    })
    const filaSaldada = within(aplicaciones).getByText('7788').closest('tr')!
    expect(within(filaSaldada).getByText('0,00')).toBeInTheDocument()

    // Y nace el asiento, con el origen que lo hace idempotente
    expect(await screen.findByText(/cxp · pago · pag-/)).toBeInTheDocument()

    // Los saldos: una saldada, la otra parcial
    expect(await saldoDeFactura('fpr-7788')).toBe('0.00')
    expect(await saldoDeFactura('fpr-8010')).toBe('5780000.00')
    const facturas = await servicioCxp.listarFacturas()
    expect(facturas.find((f) => f.id === 'fpr-7788')!.estado).toBe('pagada')
    expect(facturas.find((f) => f.id === 'fpr-8010')!.estado).toBe(
      'contabilizada',
    )

    // El saldo del proveedor baja por lo mismo que se pagó
    const proveedores = await servicioCxp.listarProveedores()
    expect(proveedores.find((p) => p.id === PROVEEDOR)!.saldo).toBe(
      '5780000.00',
    )

    // Y las tres cuentas siguen diciendo lo mismo
    expect(await totalAntiguedad()).toBe('8444000.00')
    expect(await saldoControl()).toBe('8444000.00')
  })

  it('la antigüedad ya no cuenta la factura saldada y sí la parcial', async () => {
    const antiguedad = await servicioCxp.obtenerAntiguedad(CORTE)
    const fila = antiguedad.filas.find((f) => f.proveedorId === PROVEEDOR)!

    // 8010 venció el 29 de agosto: al corte lleva dos días en la primera cubeta
    expect(fila.total).toBe('5780000.00')
    expect(fila.d1a30).toBe('5780000.00')
    expect(fila.porVencer).toBe('0.00')
  })

  it('un pago salda varias facturas y una factura admite varios pagos', async () => {
    // Un pago, dos facturas: es la mitad de la relación N a N
    const [pago] = await servicioCxp.listarPagos({ facturaId: 'fpr-8010' })
    expect(pago.aplicaciones).toHaveLength(2)

    // Y la otra mitad: a la 8010, que quedó parcial, se le abona otra vez
    const segundo = await servicioCxp.registrarPago({
      proveedorId: PROVEEDOR,
      fecha: FECHA_PAGO,
      moneda: 'CRC',
      tipoCambio: '1',
      cuentaSalida: BANCO,
      auxiliarBanco: CUENTA_BANCARIA,
      medioPago: 'cheque',
      referencia: '004512',
      importe: '780000.00',
      aplicaciones: [{ facturaId: 'fpr-8010', importe: '780000.00' }],
    })
    expect(await saldoDeFactura('fpr-8010')).toBe('5000000.00')
    expect(await servicioCxp.listarPagos({ facturaId: 'fpr-8010' })).toHaveLength(
      2,
    )

    // Se deshace para no arrastrar el saldo al resto de las pruebas, que es
    // además la anulación de un abono parcial: la factura sigue sin saldar
    await servicioCxp.anularPago(segundo.id, {
      fecha: CORTE,
      motivo: 'Cheque anulado antes de entregarse',
    })
    expect(await saldoDeFactura('fpr-8010')).toBe('5780000.00')
    expect(await saldoControl()).toBe('8444000.00')
  })
})

describe('Anular un pago', () => {
  it('reversa el asiento, devuelve el saldo y deja el mayor cuadrado', async () => {
    const usuario = userEvent.setup()

    const pagos = await servicioCxp.listarPagos({ proveedorId: PROVEEDOR })
    const reciente = pagos.find((p) => p.importe === '1203400.00')!

    montar(`/cxp/pagos/${reciente.id}`)

    await screen.findByRole('heading', { name: `Pago ${reciente.folio}` })
    await usuario.click(screen.getByRole('button', { name: 'Anular' }))

    await escribir(usuario, /Fecha de la reversa/, CORTE)
    await escribir(usuario, /Motivo/, 'Transferencia rechazada por el banco')
    await usuario.click(screen.getByRole('button', { name: 'Anular pago' }))

    await screen.findByText(/Pago anulado/)

    // El saldo vuelve a las dos facturas y la saldada deja de estarlo
    expect(await saldoDeFactura('fpr-7788')).toBe('203400.00')
    expect(await saldoDeFactura('fpr-8010')).toBe('6780000.00')
    const facturas = await servicioCxp.listarFacturas()
    expect(facturas.find((f) => f.id === 'fpr-7788')!.estado).toBe(
      'contabilizada',
    )

    // Y el auxiliar vuelve a coincidir con la cuenta de control
    expect(await totalAntiguedad()).toBe('9647400.00')
    expect(await saldoControl()).toBe('9647400.00')

    // El asiento no se borra: se neutraliza con su reversa (docs/02 §6)
    const anulado = await servicioCxp.obtenerPago(reciente.id)
    expect(anulado.estado).toBe('anulado')
    expect(anulado.asientoAnulacionId).not.toBeNull()

    const original = await servicioCxp.obtenerAsientoDePago(reciente.id)
    expect(original.estado).toBe('reversado')
    const balanza = await servicioConta.obtenerBalanza(PERIODO, 'fiscal')
    expect(balanza.cuadra).toBe(true)
  })

  it('no se anula dos veces el mismo pago', async () => {
    const pagos = await servicioCxp.listarPagos({ proveedorId: PROVEEDOR })
    const anulado = pagos.find((p) => p.importe === '1203400.00')!
    expect(anulado.estado).toBe('anulado')

    await expect(
      servicioCxp.anularPago(anulado.id, {
        fecha: CORTE,
        motivo: 'Otra vez',
      }),
    ).rejects.toThrow(/ya está anulado/)
  })
})

describe('Validaciones del servidor', () => {
  it('rechaza aplicar más de lo que la factura debe', async () => {
    const saldo = new Decimal(await saldoDeFactura('fpr-9001'))

    await expect(
      servicioCxp.registrarPago({
        proveedorId: 'pro-033',
        fecha: FECHA_PAGO,
        moneda: 'CRC',
        tipoCambio: '1',
        cuentaSalida: BANCO,
        auxiliarBanco: CUENTA_BANCARIA,
        medioPago: 'transferencia',
        referencia: null,
        importe: saldo.plus(1000).toFixed(2),
        aplicaciones: [
          { facturaId: 'fpr-9001', importe: saldo.plus(1000).toFixed(2) },
        ],
      }),
    ).rejects.toThrow(/se le aplican/)

    // Y no deja rastro: ni saldo movido ni asiento emitido
    expect(await saldoDeFactura('fpr-9001')).toBe(saldo.toFixed(2))
  })

  it('rechaza pagar la factura de otro proveedor', async () => {
    await expect(
      servicioCxp.registrarPago({
        proveedorId: PROVEEDOR,
        fecha: FECHA_PAGO,
        moneda: 'CRC',
        tipoCambio: '1',
        cuentaSalida: BANCO,
        auxiliarBanco: CUENTA_BANCARIA,
        medioPago: 'transferencia',
        referencia: null,
        importe: '1000.00',
        // fpr-9001 es de pro-033
        aplicaciones: [{ facturaId: 'fpr-9001', importe: '1000.00' }],
      }),
    ).rejects.toThrow(/su propio proveedor/)
  })

  it('el importe sin aplicar queda como anticipo al proveedor', async () => {
    const pago = await servicioCxp.registrarPago({
      proveedorId: 'pro-014',
      fecha: FECHA_PAGO,
      moneda: 'CRC',
      tipoCambio: '1',
      cuentaSalida: BANCO,
      auxiliarBanco: CUENTA_BANCARIA,
      medioPago: 'transferencia',
      referencia: 'ANTICIPO-1',
      importe: '250000.00',
      aplicaciones: [],
    })

    expect(pago.anticipo).toBe('250000.00')

    const asiento = await servicioCxp.obtenerAsientoDePago(pago.id)
    const anticipo = asiento.lineas.find((l) => l.cuentaCodigo === '1.1.05.001')!
    expect(anticipo.cargo).toBe('250000.00')
    expect(anticipo.auxiliarId).toBe('pro-014')
    // El anticipo no es cuenta por pagar: la antigüedad no lo recoge
    expect(await totalAntiguedad()).toBe('9647400.00')
  })
})

describe('Propuesta de pago', () => {
  it('propone lo que vence antes hasta agotar el efectivo disponible', async () => {
    const propuesta = await servicioCxp.obtenerPropuestaPago({
      corte: CORTE,
      disponible: '200000',
    })

    // 7788 vence el 25 de agosto, antes que 8010 y que 9001
    expect(propuesta.lineas[0].folioProveedor).toBe('7788')
    expect(propuesta.lineas[0].propuesto).toBe('200000.00')
    // No alcanza ni para la primera: queda propuesta en parte
    expect(propuesta.lineas[0].salda).toBe(false)
    expect(propuesta.lineas[1].propuesto).toBe('0.00')
    expect(propuesta.totalPropuesto).toBe('200000.00')
    expect(propuesta.remanente).toBe('0.00')
    // Lo que no cabe se enseña igual: es el dato con el que se pide efectivo
    expect(propuesta.sinCubrir).toBe('9447400.00')
  })

  it('convertir la propuesta en pagos salda lo propuesto', async () => {
    const usuario = userEvent.setup()
    montar('/cxp/propuesta')

    // La configuración de la empresa llega antes que la pantalla
    await screen.findByLabelText(/Fecha de corte/)
    await escribir(usuario, /Fecha de corte/, CORTE)
    await escribir(usuario, /Efectivo disponible/, '203400')
    await seleccionar(usuario, /Cuenta de salida/, OPCION_BANCO)
    await usuario.click(
      screen.getByRole('button', { name: /Calcular propuesta/ }),
    )

    const tabla = await screen.findByRole('table', { name: 'Propuesta de pago' })
    expect(within(tabla).getByText('7788')).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: /Emitir 1 pago/ }))

    expect(await screen.findByText(/Emitidos 1 pago/)).toBeInTheDocument()
    expect(await saldoDeFactura('fpr-7788')).toBe('0.00')
  })
})
