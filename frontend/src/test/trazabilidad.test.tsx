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
 * Trazabilidad de un asiento manual hacia un documento (documentoRelacionado)
 * y buscador de auxiliar tolerante y opcional.
 *
 * Archivo aparte del humo del núcleo: aquí se contabilizan asientos y el humo
 * cuenta con el libro de la semilla tal cual.
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

const FECHA_ABIERTA = '2026-08-20'

async function ponerFechaAbierta(usuario: ReturnType<typeof userEvent.setup>) {
  const campo = screen.getByLabelText(/^Fecha/)
  await usuario.clear(campo)
  await usuario.type(campo, FECHA_ABIERTA)
}

const FACTURA = { modulo: 'cxc' as const, tipo: 'factura', id: 'fac-114' }

/**
 * El consecutivo visible de esa factura, leído de la API en vez de escrito
 * aquí: el formato del comprobante electrónico lo decide cxc (docs/13 §4.2) y
 * esta prueba es de trazabilidad, no del formato del folio.
 */
let consecutivo = ''

/** Prefijo de casa matriz, terminal y tipo: lo comparten todas las facturas. */
let prefijoComun = ''

beforeAll(async () => {
  const facturas = await servicioCxc.listarFacturas()
  consecutivo = facturas.find((f) => f.id === FACTURA.id)!.consecutivo
  prefijoComun = consecutivo.slice(0, 10)
})

describe('Documento relacionado', () => {
  it('la consulta inversa devuelve el asiento de origen del documento', async () => {
    const asientos = await servicioConta.listarAsientos({ documento: FACTURA })
    expect(asientos).toHaveLength(1)
    expect(asientos[0].origenId).toBe('fac-114')
    expect(asientos[0].documentoRelacionado).toBeNull()
  })

  it('captura un ajuste referido a una factura y la consulta inversa lo encuentra', async () => {
    const usuario = userEvent.setup()
    montar('/conta/asientos/nuevo')

    const cuentas = await screen.findAllByRole('combobox', { name: 'Cuenta' })
    await ponerFechaAbierta(usuario)
    await usuario.type(cuentas[0], '6.1.02.004')
    await usuario.type(cuentas[1], '1.1.01.002')
    await usuario.type(
      screen.getByPlaceholderText('Descripción del asiento'),
      'Ajuste por redondeo de la FE-00000114',
    )

    // La sección arranca vacía: la mayoría de los ajustes no se refieren a
    // ningún documento. Al elegir módulo aparece el buscador.
    expect(screen.queryByLabelText(/^Factura/)).toBeNull()
    await usuario.selectOptions(screen.getByLabelText(/^Módulo/), 'cxc')
    const buscador = await screen.findByLabelText(/^Factura/)

    // Se busca por consecutivo parcial: "114" solo lo lleva esa factura
    await usuario.type(buscador, '114')
    expect(
      await screen.findByText(
        `${consecutivo} · Servicios Médicos Escazú S.A. · 20/06/2026`,
      ),
    ).toBeInTheDocument()
    // Al salir del campo queda escrita la referencia completa
    await usuario.tab()
    await waitFor(() =>
      expect(buscador).toHaveValue(
        `${consecutivo} · Servicios Médicos Escazú S.A.`,
      ),
    )

    const filas = screen.getAllByRole('row')
    await usuario.type(
      within(filas[1]).getByRole('textbox', { name: 'Cargo' }),
      '1',
    )
    await usuario.type(
      within(filas[2]).getByRole('textbox', { name: 'Abono' }),
      '1',
    )
    await usuario.tab()
    await usuario.click(screen.getByRole('button', { name: /Contabilizar/ }))

    // En la lista, el asiento es manual (sin origen) y el panel enseña el
    // documento al que se refiere.
    // Se llega con el asiento abierto: el concepto está en su fila y en el
    // detalle. Lo que se mira primero es la fila.
    let fila: HTMLElement | null = null
    await waitFor(() => {
      fila =
        screen
          .getAllByText('Ajuste por redondeo de la FE-00000114')
          .map((nodo) => nodo.closest('tr'))
          .find((tr) => tr !== null) ?? null
      expect(fila).not.toBeNull()
    })
    expect(within(fila!).getByText('Manual')).toBeInTheDocument()
    // Acotado al bloque del panel: el módulo aparece también en el origen de
    // los demás asientos de la lista, y la búsqueda suelta encuentra varios.
    const etiqueta = await screen.findByText('Documento relacionado')
    const bloque = etiqueta.closest('div')!
    expect(within(bloque).getByText(/cxc ·/)).toBeInTheDocument()
    // Y ahora es un enlace: las rutas de detalle de factura ya existen.
    expect(within(bloque).getByRole('link', { name: consecutivo })).toHaveAttribute(
      'href',
      '/cxc/facturas/fac-114',
    )

    // Y la consulta inversa ahora trae los dos: el de origen y el manual
    const asientos = await servicioConta.listarAsientos({ documento: FACTURA })
    expect(asientos.map((a) => a.origenId ?? 'manual').sort()).toEqual([
      'fac-114',
      'manual',
    ])
    const manual = asientos.find((a) => a.origenId === null)!
    expect(manual.documentoRelacionado).toEqual({
      ...FACTURA,
      referencia: consecutivo,
    })
  })

  it('no contabiliza con una referencia que no resuelve', async () => {
    const usuario = userEvent.setup()
    montar('/conta/asientos/nuevo')

    const cuentas = await screen.findAllByRole('combobox', { name: 'Cuenta' })
    await ponerFechaAbierta(usuario)
    await usuario.type(cuentas[0], '6.1.02.004')
    await usuario.type(cuentas[1], '1.1.01.002')
    await usuario.type(
      screen.getByPlaceholderText('Descripción del asiento'),
      'Ajuste sin documento claro',
    )
    await usuario.selectOptions(screen.getByLabelText(/^Módulo/), 'cxc')
    // El prefijo de sucursal, terminal y tipo lo llevan todas: no identifica
    await usuario.type(await screen.findByLabelText(/^Factura/), prefijoComun)

    const filas = screen.getAllByRole('row')
    await usuario.type(
      within(filas[1]).getByRole('textbox', { name: 'Cargo' }),
      '1',
    )
    await usuario.type(
      within(filas[2]).getByRole('textbox', { name: 'Abono' }),
      '1',
    )
    await usuario.click(screen.getByRole('button', { name: /Contabilizar/ }))

    expect(
      await screen.findByText(/El asiento no se puede contabilizar/),
    ).toBeInTheDocument()
    expect(
      screen.getAllByText('Varios documentos coinciden, precisa la búsqueda')
        .length,
    ).toBeGreaterThan(0)
  })
})

describe('Auxiliar opcional y coincidencia tolerante', () => {
  it('permite un auxiliar en una cuenta que no lo exige y completa lo tecleado al salir', async () => {
    const usuario = userEvent.setup()
    montar('/conta/asientos/nuevo')

    const cuentas = await screen.findAllByRole('combobox', { name: 'Cuenta' })
    await ponerFechaAbierta(usuario)
    // Papelería no exige auxiliar: se ofrece elegir el tipo, vacío por omisión
    await usuario.type(cuentas[0], '6.1.02.004')
    const tipos = await screen.findAllByLabelText('Tipo de auxiliar')
    expect(tipos[0]).toHaveValue('')
    await usuario.selectOptions(tipos[0], 'proveedor')

    const auxiliar = await screen.findByRole('combobox', { name: 'Auxiliar' })
    // Media razón social basta si es única
    await usuario.type(auxiliar, 'delta')
    expect(
      await screen.findByText('Suministros de Oficina Delta S.A.'),
    ).toBeInTheDocument()
    await usuario.tab()
    await waitFor(() =>
      expect(auxiliar).toHaveValue('P-021 · Suministros de Oficina Delta S.A.'),
    )

    // Con varias coincidencias no se adivina
    await usuario.clear(auxiliar)
    await usuario.type(auxiliar, 'S.A.')
    expect(
      await screen.findByText('Varios auxiliares coinciden, precisa la búsqueda'),
    ).toBeInTheDocument()
    await usuario.tab()
    expect(auxiliar).toHaveValue('S.A.')
  })

  it('el buscador de un auxiliar exigido resuelve por cédula', async () => {
    const usuario = userEvent.setup()
    montar('/conta/asientos/nuevo')

    const cuentas = await screen.findAllByRole('combobox', { name: 'Cuenta' })
    await ponerFechaAbierta(usuario)
    // Anticipos de clientes exige cliente: el tipo lo fija la cuenta
    await usuario.type(cuentas[0], '2.1.04.001')
    const auxiliar = await screen.findByRole('combobox', { name: 'Auxiliar' })
    expect(screen.queryAllByLabelText('Tipo de auxiliar')).toHaveLength(0)

    // La cédula acompaña a la opción sin entrar en el valor
    await waitFor(() => {
      const opcion = document.querySelector(
        'datalist option[value="C-002 · Comercial La Sabana S.A."]',
      )
      expect(opcion).not.toBeNull()
      expect(opcion).toHaveAttribute('label', '3101223344')
    })

    await usuario.type(auxiliar, '3101223344')
    expect(
      await screen.findByText('Comercial La Sabana S.A.'),
    ).toBeInTheDocument()
  })
})
