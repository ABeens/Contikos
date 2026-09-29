import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Decimal from 'decimal.js'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioConta, servicioCxc } from '@/shared/api/servicios'
import { ApiError } from '@/shared/api/client'
import { hoyISO } from '@/shared/format/fecha'
import { restablecerMonedas } from '@/shared/money/money'
import type { FacturaVenta } from '@/shared/api/contracts/cxc'

/**
 * Notas de crédito de punta a punta (docs/04 §2.3).
 *
 * Archivo aparte porque emitir notas cambia el saldo de facturas de la semilla.
 */

const servidor = setupServer(...handlers)

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  servidor.resetHandlers()
  restablecerMonedas()
})
afterAll(() => servidor.close())

/**
 * Una factura en colones sin cobros y con al menos `unidades` en su primera
 * línea. Sin cobros, porque así acreditar una unidad nunca pasa del saldo.
 */
async function facturaAcreditable(
  excluir: string[] = [],
  unidades = 2,
): Promise<FacturaVenta> {
  const facturas = await servicioCxc.listarFacturas()
  const factura = facturas.find(
    (f) =>
      !excluir.includes(f.id) &&
      f.estado === 'contabilizada' &&
      f.moneda === 'CRC' &&
      new Decimal(f.saldo).equals(f.total) &&
      new Decimal(f.lineas[0].cantidad).greaterThanOrEqualTo(unidades),
  )
  if (!factura) throw new Error('La semilla no tiene una factura acreditable')
  return factura
}

describe('Nota de crédito', () => {
  it('rechaza acreditar más de lo facturado', async () => {
    const factura = await facturaAcreditable()
    const linea = factura.lineas[0]
    await expect(
      servicioCxc.emitirNotaCredito({
        facturaId: factura.id,
        fecha: hoyISO(),
        motivo: 'devolucion',
        detalle: 'Prueba',
        lineas: [
          {
            lineaFacturaId: linea.id,
            cantidad: new Decimal(linea.cantidad).plus(1).toString(),
          },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'CANTIDAD_EXCEDE_FACTURADA' })
  })

  it('baja el saldo de la factura y reversa ingreso e IVA por la parte acreditada', async () => {
    const factura = await facturaAcreditable()
    const linea = factura.lineas[0]

    const nota = await servicioCxc.emitirNotaCredito({
      facturaId: factura.id,
      fecha: hoyISO(),
      motivo: 'devolucion',
      detalle: 'Devolvieron una unidad',
      lineas: [{ lineaFacturaId: linea.id, cantidad: '1' }],
    })

    // Una unidad, al precio neto de la línea original.
    const proporcion = new Decimal(1).dividedBy(linea.cantidad)
    expect(nota.subtotal).toBe(new Decimal(linea.base).times(proporcion).toFixed(2))
    expect(nota.numeroInterno).toMatch(/^NC-\d{6}$/)
    expect(nota.consecutivo.slice(8, 10)).toBe('03')
    // La clave lleva el consecutivo de la nota en las posiciones 21 a 40.
    expect(nota.claveNumerica).toHaveLength(50)
    expect(nota.claveNumerica?.slice(21, 41)).toBe(nota.consecutivo)

    const despues = await servicioCxc.obtenerFactura(factura.id)
    expect(despues.saldo).toBe(new Decimal(factura.saldo).minus(nota.total).toFixed(2))

    const asiento = await servicioConta.obtenerAsiento(nota.asientoId)
    expect(asiento.origenTipo).toBe('nota_credito')
    const clientes = asiento.lineas.find((l) => l.auxiliarTipo === 'cliente')
    expect(clientes?.abono).toBe(nota.total)
    expect(clientes?.auxiliarId).toBe(factura.clienteId)
  })

  it('la antigüedad de saldos sigue siendo la suma de los saldos de las facturas', async () => {
    const [facturas, antiguedad] = await Promise.all([
      servicioCxc.listarFacturas(),
      servicioCxc.obtenerAntiguedad(hoyISO()),
    ])
    const saldos = facturas
      .filter((f) => f.estado !== 'cancelada')
      .reduce(
        (acc, f) => acc.plus(new Decimal(f.saldo).times(f.tipoCambio)),
        new Decimal(0),
      )
    expect(new Decimal(antiguedad.totales.total).minus(saldos).abs().lessThan(0.01)).toBe(true)
  })

  it('no acredita más que el saldo por cobrar', async () => {
    // La de la prueba anterior: ya tiene una unidad acreditada, así que
    // acreditar todas sus líneas enteras pasa del saldo.
    const [previa] = await servicioCxc.listarNotasCredito()
    const factura = await servicioCxc.obtenerFactura(previa.facturaId)
    const lineas = factura.lineas.map((l) => ({ lineaFacturaId: l.id, cantidad: l.cantidad }))
    const error = await servicioCxc
      .emitirNotaCredito({
        facturaId: factura.id,
        fecha: hoyISO(),
        motivo: 'correccion',
        detalle: 'Prueba',
        lineas,
      })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
  })

  it('se emite desde la pantalla y vuelve al detalle de la factura', async () => {
    const usada = (await servicioCxc.listarNotasCredito()).map((n) => n.facturaId)
    const factura = await facturaAcreditable(usada, 1)
    const user = userEvent.setup()
    const router = createMemoryRouter(rutas, {
      initialEntries: [`/cxc/notas-credito/nueva?factura=${factura.id}`],
    })
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    )

    await screen.findByRole('heading', { name: `Nota de crédito sobre ${factura.numeroInterno}` })
    await user.type(screen.getByLabelText(/^Detalle/), 'Descuento por pronto pago')
    await user.type(
      screen.getByRole('textbox', {
        name: `Cantidad a acreditar de ${factura.lineas[0].descripcion}`,
      }),
      '1',
    )
    await user.click(screen.getByRole('button', { name: 'Emitir nota de crédito' }))

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/cxc/facturas/${factura.id}`),
    )
    expect(await screen.findByText('Notas de crédito')).toBeInTheDocument()
  })
})
