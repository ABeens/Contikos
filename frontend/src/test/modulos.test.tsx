import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { MONEDAS_SEED, monedasMock } from '@/mocks/seed/monedas'
import {
  TARIFAS_IMPUESTO_SEED,
  tarifasImpuestoMock,
} from '@/mocks/seed/impuestos'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * Flujos de CxC, CxP y activos fijos, de punta a punta.
 *
 * Cada prueba recorre lo que hace el usuario y comprueba las tres cosas que
 * tienen que ocurrir juntas: nace el documento, nace el saldo y nace el
 * asiento. Que compile no es que cuadre.
 *
 * Van en un archivo aparte del humo del núcleo contable porque mutan el estado
 * del mock: facturar aquí cambiaría los saldos que esperan aquellas pruebas.
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

/** Fecha dentro del periodo abierto de la semilla (agosto de 2026). */
const FECHA_ABIERTA = '2026-08-20'

async function ponerFecha(
  usuario: ReturnType<typeof userEvent.setup>,
  etiqueta: RegExp,
  valor: string,
) {
  const campo = screen.getByLabelText(etiqueta)
  await usuario.clear(campo)
  await usuario.type(campo, valor)
}

async function ponerNumero(
  usuario: ReturnType<typeof userEvent.setup>,
  etiqueta: RegExp,
  valor: string,
) {
  const campo = screen.getByLabelText(etiqueta)
  await usuario.clear(campo)
  await usuario.type(campo, valor)
}

/**
 * Elige una opción de un selector alimentado por la API.
 *
 * Espera a que la opción exista: el selector se pinta antes de que llegue su
 * catálogo, y sin esta espera la prueba elegiría sobre una lista vacía.
 */
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

describe('Cuentas por cobrar', () => {
  it('emite una factura, crea la cuenta por cobrar y contabiliza el asiento', async () => {
    const usuario = userEvent.setup()
    montar('/cxc/facturas/nueva')

    await seleccionar(usuario, /Cliente/, 'cli-004')
    await ponerFecha(usuario, /Fecha de emisión/, FECHA_ABIERTA)

    await usuario.type(
      screen.getByLabelText('Descripción de la línea 1'),
      'Mantenimiento de equipo',
    )
    await usuario.type(
      screen.getByLabelText('Precio unitario de la línea 1'),
      '400000',
    )
    await usuario.tab()

    // El asiento se ve ANTES de emitir: es lo que hace visible el contrato.
    await waitFor(() =>
      expect(screen.getByText('IVA trasladado')).toBeInTheDocument(),
    )
    expect(screen.getAllByText('₡452.000,00').length).toBeGreaterThan(0)

    await usuario.click(screen.getByRole('button', { name: /Emitir factura/ }))

    // Tras emitir navega a la lista, con la factura y su saldo por cobrar.
    // Se espera al encabezado de la lista y no a la fila: el nombre del cliente
    // también aparece en el asiento de la pantalla anterior.
    await screen.findByRole('heading', { name: 'Facturas de venta' })
    const fila = (await screen.findByText('Mauricio Vargas Rojas')).closest('tr')!
    // Total y saldo por cobrar: la factura nace entera por cobrar
    expect(within(fila).getAllByText('452.000,00')).toHaveLength(2)
    expect(within(fila).getByText('Contabilizado')).toBeInTheDocument()
  })

  it('precarga la línea desde el catálogo y deja cambiar la cuenta', async () => {
    const usuario = userEvent.setup()
    montar('/cxc/facturas/nueva')

    await seleccionar(usuario, /Cliente/, 'cli-004')
    await ponerFecha(usuario, /Fecha de emisión/, FECHA_ABIERTA)

    // SRV-010 es la consulta médica: 4% y no 13%, que es justo lo que quien
    // factura no tiene por qué recordar.
    await usuario.type(
      await screen.findByLabelText('Producto o servicio de la línea 1'),
      'SRV-010',
    )

    await waitFor(() =>
      expect(screen.getByLabelText('Descripción de la línea 1')).toHaveValue(
        'Servicios de salud, consulta general',
      ),
    )
    expect(screen.getByLabelText('Tarifa de IVA de la línea 1')).toHaveValue(
      'REDUCIDA_4',
    )
    const cuenta = screen.getByLabelText('Cuenta de ingreso de la línea 1')
    expect(cuenta).toHaveValue('4.1.01.001')

    // Precargada, no impuesta: la cuenta se cambia y es la nueva la que llega
    // al asiento.
    await usuario.clear(cuenta)
    await usuario.type(cuenta, '4.1.01.002')
    await usuario.tab()

    await waitFor(() =>
      expect(screen.getByText('Venta de mercancías')).toBeInTheDocument(),
    )

    // 25 000 al 4%: el impuesto sale de la tarifa del catálogo
    expect(screen.getAllByText('₡26.000,00').length).toBeGreaterThan(0)

    await usuario.click(screen.getByRole('button', { name: /Emitir factura/ }))

    await screen.findByRole('heading', { name: 'Facturas de venta' })
    await usuario.click(
      // Por el número interno, que es el de la serie del sistema. El otro
      // número de la fila es el consecutivo del comprobante (docs/13 §4.2).
      (await screen.findAllByText(/^FV-/))[0].closest('td')!,
    )

    // La línea conserva el código con el que se vendió y la cuenta editada,
    // no la que el catálogo propuso.
    const linea = (await screen.findByText('SRV-010')).closest('tr')!
    expect(within(linea).getByText('4.1.01.002')).toBeInTheDocument()
  })

  it('el detalle de la factura muestra el asiento que generó', async () => {
    const usuario = userEvent.setup()
    montar('/cxc/facturas')

    await usuario.click(await screen.findByText('FV-000113'))

    expect(await screen.findByText('Asiento generado')).toBeInTheDocument()
    // El asiento conserva la trazabilidad al documento que lo originó
    expect(screen.getByText(/cxc · factura · fac-113/)).toBeInTheDocument()
    // Y mueve la cuenta de control de clientes con su auxiliar
    expect(screen.getAllByText('1.1.02.001').length).toBeGreaterThan(0)
    expect(screen.getByText(/cliente: Comercial La Sabana/)).toBeInTheDocument()
  })

  it('la antigüedad reparte los saldos en cubetas a la fecha de corte', async () => {
    montar('/cxc?corte=2026-08-20')

    // La primera tabla es la antigüedad; la segunda, las facturas pendientes.
    const tablas = await screen.findAllByRole('table')
    const antiguedad = tablas[0]

    // FV-000114 venció el 20 de julio: al corte cae en la cubeta de 31 a 60
    const escazu = within(antiguedad)
      .getByText('Servicios Médicos Escazú S.A.')
      .closest('tr')!
    const celdasEscazu = within(escazu).getAllByRole('cell')
    expect(celdasEscazu[3]).toHaveTextContent('832.000,00')

    // FV-000113 vence el 4 de setiembre: todavía por vencer
    const sabana = within(antiguedad)
      .getByText('Comercial La Sabana S.A.')
      .closest('tr')!
    const celdasSabana = within(sabana).getAllByRole('cell')
    expect(celdasSabana[1]).toHaveTextContent('1.356.000,00')
  })

  it('bloquea la factura que deja al cliente sobre su límite de crédito', async () => {
    const usuario = userEvent.setup()
    montar('/cxc/facturas/nueva')

    // El límite de Servicios Médicos Escazú es de 5 000 000 y ya debe 832 000
    await seleccionar(usuario, /Cliente/, 'cli-003')
    await ponerFecha(usuario, /Fecha de emisión/, FECHA_ABIERTA)
    await usuario.type(
      screen.getByLabelText('Descripción de la línea 1'),
      'Servicio grande',
    )
    await usuario.type(
      screen.getByLabelText('Precio unitario de la línea 1'),
      '5000000',
    )
    await usuario.tab()

    await usuario.click(screen.getByRole('button', { name: /Emitir factura/ }))

    expect(
      await screen.findByText(/su límite de crédito es/),
    ).toBeInTheDocument()
  })
})

describe('Cuentas por pagar', () => {
  it('registra la factura de gasto y crea la cuenta por pagar con su retención', async () => {
    const usuario = userEvent.setup()
    montar('/cxp/facturas/nueva')

    // pro-033 tiene retención de renta del 2%
    await seleccionar(usuario, /Proveedor/, 'pro-033')
    await usuario.type(screen.getByLabelText(/Folio del proveedor/), '9500')
    await ponerFecha(usuario, /Fecha de emisión/, FECHA_ABIERTA)

    await usuario.type(
      screen.getByLabelText('Descripción de la línea 1'),
      'Soporte de sistemas',
    )
    await usuario.type(
      screen.getByLabelText('Precio unitario de la línea 1'),
      '1000000',
    )
    await usuario.type(screen.getByLabelText('Cuenta'), '6.1.02.003')
    await usuario.tab()

    // Lo facturado y lo que se le paga no son el mismo importe
    await waitFor(() =>
      expect(screen.getAllByText(/Retención de renta 2%/).length).toBeGreaterThan(0),
    )
    expect(screen.getByText('₡1.110.000,00')).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: /Registrar factura/ }))

    const fila = (await screen.findByText('9500')).closest('tr')!
    expect(within(fila).getByText('1.130.000,00')).toBeInTheDocument()
    expect(within(fila).getByText('1.110.000,00')).toBeInTheDocument()
  })

  it('rechaza el mismo folio dos veces del mismo proveedor', async () => {
    const usuario = userEvent.setup()
    montar('/cxp/facturas/nueva')

    await seleccionar(usuario, /Proveedor/, 'pro-014')
    // 4521 ya está registrada para ese proveedor
    await usuario.type(screen.getByLabelText(/Folio del proveedor/), '4521')
    await ponerFecha(usuario, /Fecha de emisión/, FECHA_ABIERTA)
    await usuario.type(
      screen.getByLabelText('Descripción de la línea 1'),
      'Servicios contables',
    )
    await usuario.type(
      screen.getByLabelText('Precio unitario de la línea 1'),
      '100000',
    )
    await usuario.tab()

    await usuario.click(screen.getByRole('button', { name: /Registrar factura/ }))

    expect(
      (await screen.findAllByText(/ya está registrado/)).length,
    ).toBeGreaterThan(0)
  })

  it('capitalizar una línea da de alta el activo desde la misma captura', async () => {
    const usuario = userEvent.setup()
    const vista = montar('/cxp/facturas/nueva')

    await seleccionar(usuario, /Proveedor/, 'pro-021')
    await usuario.type(screen.getByLabelText(/Folio del proveedor/), '7900')
    await ponerFecha(usuario, /Fecha de emisión/, FECHA_ABIERTA)

    await usuario.type(
      screen.getByLabelText('Descripción de la línea 1'),
      'Impresora industrial',
    )
    await usuario.type(
      screen.getByLabelText('Precio unitario de la línea 1'),
      '1200000',
    )
    // Cargar la compra a una cuenta de activo fijo enciende la capitalización
    await usuario.type(screen.getByLabelText('Cuenta'), '1.2.01.001')

    const capitalizar = await screen.findByLabelText(
      'Capitalizar la línea 1 como activo fijo',
    )
    expect(capitalizar).toBeChecked()
    expect(capitalizar).toBeDisabled()

    await usuario.selectOptions(
      screen.getByLabelText('Categoría del activo de la línea 1'),
      'cat-mobiliario',
    )
    await usuario.clear(
      screen.getByLabelText('Inicio de depreciación de la línea 1'),
    )
    await usuario.type(
      screen.getByLabelText('Inicio de depreciación de la línea 1'),
      '2026-08-25',
    )
    await usuario.tab()

    await usuario.click(screen.getByRole('button', { name: /Registrar factura/ }))

    // La factura queda registrada y el activo existe, sin asiento propio
    await screen.findByText('7900')
    vista.unmount()

    montar('/activos')
    const filaActivo = (
      await screen.findByText('Impresora industrial')
    ).closest('tr')!
    expect(within(filaActivo).getByText('Factura 7900')).toBeInTheDocument()
    expect(within(filaActivo).getAllByText('1.200.000,00')).toHaveLength(2)
  })
})

describe('Activos fijos', () => {
  it('avisa de las compras cargadas a activo fijo que no tienen ficha', async () => {
    montar('/activos')

    expect(
      await screen.findByText(/no cuadra contra el mayor/),
    ).toBeInTheDocument()
  })

  it('desde la factura de compra se llega al alta con la línea ya elegida', async () => {
    const usuario = userEvent.setup()
    montar('/cxp/facturas')

    const fila = (await screen.findByText('8010')).closest('tr')!
    await usuario.click(fila)

    // La factura avisa de su propia línea sin ficha y lleva a registrarla.
    await screen.findByRole('heading', { name: 'Factura 8010' })
    await usuario.click(
      await screen.findByRole('link', { name: /registrar activo/i }),
    )

    // Llega con la compra elegida: no hay que buscarla otra vez en la lista.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Ficha del activo' }),
      ).toBeInTheDocument(),
    )
    expect(screen.getByLabelText('Registrar Vehículo de reparto')).toBeChecked()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Vehículo de reparto')
  })

  it('registra el activo de una compra pendiente sin generar otro asiento', async () => {
    const usuario = userEvent.setup()
    montar('/activos/nuevo?modo=factura')

    await usuario.click(
      await screen.findByLabelText('Registrar Vehículo de reparto'),
    )

    await seleccionar(usuario, /Categoría/, 'cat-vehiculos')
    await usuario.click(screen.getByRole('button', { name: /Registrar activo/ }))

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Activos fijos' }),
      ).toBeInTheDocument(),
    )
    const fila = (await screen.findByText('Vehículo de reparto')).closest('tr')!
    expect(within(fila).getByText('Factura 8010')).toBeInTheDocument()
    // Costo y valor en libros: todavía no se ha depreciado nada
    expect(within(fila).getAllByText('6.000.000,00')).toHaveLength(2)
  })

  it('el alta directa sí contabiliza su propio asiento', async () => {
    const usuario = userEvent.setup()
    montar('/activos/nuevo?modo=manual')

    await usuario.type(
      await screen.findByLabelText(/^Nombre/),
      'Servidor aportado por socios',
    )
    await usuario.selectOptions(screen.getByLabelText(/Categoría/), 'cat-computo')
    await ponerFecha(usuario, /Fecha de adquisición/, FECHA_ABIERTA)
    await usuario.type(
      screen.getByLabelText(/Costo de adquisición/),
      '3000000',
    )
    await usuario.type(screen.getByLabelText('Cuenta'), '3.1.01.001')
    await usuario.tab()

    // El asiento se ve antes de contabilizar
    await waitFor(() =>
      expect(
        screen.getByText(/Alta de activo Servidor aportado por socios/),
      ).toBeInTheDocument(),
    )

    await usuario.click(
      screen.getByRole('button', { name: /Dar de alta y contabilizar/ }),
    )

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Activos fijos' }),
      ).toBeInTheDocument(),
    )
    const fila = (
      await screen.findByText('Servidor aportado por socios')
    ).closest('tr')!
    expect(within(fila).getByText('Alta directa')).toBeInTheDocument()
  })

  it('el activo comprado lleva de vuelta a la factura que lo reconoció', async () => {
    const usuario = userEvent.setup()
    montar('/activos')

    const fila = (
      await screen.findByText('Servidor de aplicaciones Dell PowerEdge')
    ).closest('tr')!
    await usuario.click(within(fila).getByRole('link', { name: /Factura 9001/ }))

    expect(
      await screen.findByRole('heading', { name: 'Factura 9001' }),
    ).toBeInTheDocument()
  })

  it('da de alta una categoría con su mapeo contable', async () => {
    const usuario = userEvent.setup()
    montar('/activos/categorias')

    await usuario.click(
      await screen.findByRole('button', { name: /Nueva categoría/ }),
    )

    await usuario.type(screen.getByLabelText(/^Nombre/), 'Maquinaria de planta')
    await ponerNumero(usuario, /Vida útil/, '180')
    await usuario.type(screen.getByLabelText('Cuenta de activo'), '1.2.01.001')
    await usuario.type(
      screen.getByLabelText('Cuenta de depreciación acumulada'),
      '1.2.02.001',
    )
    await usuario.type(
      screen.getByLabelText('Cuenta de gasto por depreciación'),
      '6.1.02.010',
    )
    await usuario.click(screen.getByRole('button', { name: /^Guardar/ }))

    const fila = (
      await screen.findByText('Maquinaria de planta')
    ).closest('tr')!
    expect(within(fila).getByText('180 meses')).toBeInTheDocument()
    expect(within(fila).getByText(/1\.2\.01\.001/)).toBeInTheDocument()

    // Y queda disponible para dar de alta un activo con ella.
    montar('/activos/nuevo?modo=manual')
    await seleccionar(usuario, /Categoría/, 'cat-maquinaria-de-planta')
  })

  it('no deja mover el mapeo de una categoría que ya tiene activos', async () => {
    const usuario = userEvent.setup()
    montar('/activos/categorias')

    const fila = (await screen.findByText('Equipo de cómputo')).closest('tr')!
    await usuario.click(fila)

    // El mapeo está escrito en el mayor por los asientos de esos activos.
    expect(
      await screen.findByText(/Cambiar ahora las cuentas/),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Cuenta de activo')).toBeDisabled()
  })
})

describe('Catálogo de cuentas', () => {
  /** Da de alta una cuenta desde el catálogo y espera a verla en la tabla. */
  async function crearCuenta(
    usuario: ReturnType<typeof userEvent.setup>,
    cuenta: {
      codigo: string
      nombre: string
      naturaleza?: string
      /** Por defecto, Propiedades, planta y equipo y su nota. */
      renglon?: string
      nota?: string
    },
  ) {
    await usuario.click(
      await screen.findByRole('button', { name: /Nueva cuenta/ }),
    )
    await usuario.type(screen.getByLabelText(/^Código/), cuenta.codigo)
    await usuario.type(screen.getByLabelText(/^Nombre/), cuenta.nombre)
    if (cuenta.naturaleza) {
      await usuario.selectOptions(
        screen.getByLabelText(/^Naturaleza/),
        cuenta.naturaleza,
      )
    }
    // La presentación es parte del alta: sin renglón y sin nota no se guarda.
    await usuario.selectOptions(
      screen.getByLabelText(/^Clasificación NIIF/),
      cuenta.renglon ?? 'niif-a-06',
    )
    await usuario.selectOptions(
      screen.getByLabelText(/^Nota a los estados financieros/),
      cuenta.nota ?? 'nota-06',
    )
    await usuario.selectOptions(screen.getByLabelText(/Módulo dueño/), 'activos')
    await usuario.selectOptions(screen.getByLabelText(/Auxiliar que exige/), 'activo')
    await usuario.click(screen.getByRole('button', { name: /^Guardar/ }))
    await screen.findByText(cuenta.nombre)
  }

  it('no da de alta una cuenta de detalle sin renglón ni nota', async () => {
    const usuario = userEvent.setup()
    montar('/conta/cuentas')

    await usuario.click(
      await screen.findByRole('button', { name: /Nueva cuenta/ }),
    )
    await usuario.type(screen.getByLabelText(/^Código/), '1.2.01.004')
    await usuario.type(
      screen.getByLabelText(/^Nombre/),
      'Maquinaria y equipo de planta',
    )
    await usuario.click(screen.getByRole('button', { name: /^Guardar/ }))

    // Sin renglón el saldo no llegaría a ningún estado financiero, y la
    // balanza seguiría cuadrando mientras tanto.
    expect(
      await screen.findAllByText(/dígale en qué renglón del estado financiero/),
    ).not.toHaveLength(0)

    await usuario.selectOptions(
      screen.getByLabelText(/^Clasificación NIIF/),
      'niif-a-06',
    )
    await usuario.click(screen.getByRole('button', { name: /^Guardar/ }))
    expect(
      await screen.findAllByText(/Elija la nota en la que se desglosa/),
    ).not.toHaveLength(0)
  })

  it('el código dice de qué cuenta colgará antes de guardarla', async () => {
    const usuario = userEvent.setup()
    montar('/conta/cuentas')

    await usuario.click(
      await screen.findByRole('button', { name: /Nueva cuenta/ }),
    )
    await usuario.type(screen.getByLabelText(/^Código/), '1.2.01.004')

    // El dedazo de un dígito no se ve leyendo el número: se ve leyendo el
    // nombre de la madre.
    const dialogo = within(screen.getByRole('dialog'))
    expect(
      await dialogo.findByText(/Colgará de.*Propiedad, planta y equipo/),
    ).toBeInTheDocument()
    // Y el tipo lo hereda de ella, sin preguntarlo.
    expect(screen.getByLabelText(/^Tipo/)).toHaveValue('activo')
    expect(screen.getByLabelText(/^Tipo/)).toBeDisabled()
  })

  it('avisa cuando la cuenta madre no existe', async () => {
    const usuario = userEvent.setup()
    montar('/conta/cuentas')

    await usuario.click(
      await screen.findByRole('button', { name: /Nueva cuenta/ }),
    )
    await usuario.type(screen.getByLabelText(/^Código/), '1.9.99.001')

    expect(
      await screen.findByText(/No existe la cuenta 1\.9\.99/),
    ).toBeInTheDocument()
  })

  it('no deja reescribir la definición de una cuenta con movimientos', async () => {
    const usuario = userEvent.setup()
    montar('/conta/cuentas')

    await usuario.click(
      await screen.findByRole('button', { name: 'Editar la cuenta 1.1.02.001' }),
    )

    expect(
      await screen.findByText(/ya tiene movimientos en el mayor/),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/^Naturaleza/)).toBeDisabled()
    // Lo que sí se puede: renombrarla y desactivarla.
    expect(screen.getByLabelText(/^Nombre/)).toBeEnabled()
    expect(screen.getByLabelText(/Cuenta activa/)).toBeEnabled()
  })

  it('la cuenta nueva entra en su sitio del árbol y sirve para mapear una categoría', async () => {
    const usuario = userEvent.setup()
    montar('/conta/cuentas')

    await crearCuenta(usuario, {
      codigo: '1.2.01.004',
      nombre: 'Maquinaria y equipo de planta',
    })
    await crearCuenta(usuario, {
      codigo: '1.2.02.004',
      nombre: 'Dep. acumulada — maquinaria',
      naturaleza: 'acreedora',
    })

    // Entra ordenada, justo detrás de Vehículos y no al final del catálogo.
    const codigos = screen
      .getAllByRole('row')
      .map((f) => f.querySelector('td')?.textContent ?? '')
    expect(codigos.indexOf('1.2.01.004')).toBe(codigos.indexOf('1.2.01.003') + 1)

    // Y ya se puede mapear una categoría de activo contra ellas.
    montar('/activos/categorias')
    await usuario.click(
      await screen.findByRole('button', { name: /Nueva categoría/ }),
    )
    await usuario.type(screen.getByLabelText(/^Nombre/), 'Maquinaria pesada')
    await usuario.type(screen.getByLabelText('Cuenta de activo'), '1.2.01.004')
    await usuario.type(
      screen.getByLabelText('Cuenta de depreciación acumulada'),
      '1.2.02.004',
    )
    await usuario.type(
      screen.getByLabelText('Cuenta de gasto por depreciación'),
      '6.1.02.010',
    )
    await usuario.click(screen.getByRole('button', { name: /^Guardar/ }))

    const fila = (await screen.findByText('Maquinaria pesada')).closest('tr')!
    expect(within(fila).getByText(/1\.2\.01\.004/)).toBeInTheDocument()
    // Dos altas completas —con su presentación— y el mapeo de una categoría en
    // una sola prueba: no le alcanza el límite general de la suite.
  }, 45_000)
})

describe('Monedas', () => {
  // Aplicar el tipo de cambio escribe en el catálogo del mock, que es estado de
  // módulo compartido por el archivo entero.
  afterEach(() => {
    monedasMock.splice(
      0,
      monedasMock.length,
      ...MONEDAS_SEED.map((m) => ({ ...m })),
    )
  })

  /** Abre el diálogo del tipo de cambio y espera a que la fuente responda. */
  async function abrirTipoCambio(usuario: ReturnType<typeof userEvent.setup>) {
    await usuario.click(
      screen.getByRole('button', { name: /Tipo de cambio del día/ }),
    )
    const dialogo = await screen.findByRole('dialog')
    await within(dialogo).findByText(/agosto de 2026/)
    return dialogo
  }

  const filaDe = (raiz: HTMLElement, codigo: string) =>
    within(raiz).getByText(codigo).closest('tr') as HTMLElement

  it('trae el tipo de cambio del día y lo lleva al catálogo', async () => {
    const usuario = userEvent.setup()
    montar('/configuracion/monedas')

    await screen.findByText('USD')
    const filaCatalogo = filaDe(document.body, 'USD')
    expect(within(filaCatalogo).getByText('505.25')).toBeInTheDocument()

    const dialogo = await abrirTipoCambio(usuario)

    // La fuente publica compra y venta del dólar por separado.
    const dolar = filaDe(dialogo, 'USD')
    expect(within(dolar).getByText('448.38')).toBeInTheDocument()
    expect(within(dolar).getAllByText('452.88')).toHaveLength(2)

    // Del euro publica un solo valor: la compra se deriva y se dice.
    const euro = filaDe(dialogo, 'EUR')
    expect(within(euro).getByText('Derivado')).toBeInTheDocument()
    expect(within(euro).getByText('522.50')).toBeInTheDocument()
    expect(within(euro).getAllByText('527.74')).toHaveLength(2)

    await usuario.click(
      within(dialogo).getByRole('button', { name: /Aplicar a 2 monedas/ }),
    )

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(
        within(filaDe(document.body, 'USD')).getByText('452.88'),
      ).toBeInTheDocument(),
    )
    expect(
      within(filaDe(document.body, 'EUR')).getByText('527.74'),
    ).toBeInTheDocument()
  })

  it('aplica la compra cuando es la que se elige', async () => {
    const usuario = userEvent.setup()
    montar('/configuracion/monedas')
    await screen.findByText('USD')

    const dialogo = await abrirTipoCambio(usuario)
    await usuario.selectOptions(
      within(dialogo).getByLabelText(/Tipo que se lleva al catálogo/),
      'compra',
    )
    await usuario.click(
      within(dialogo).getByRole('button', { name: /Aplicar a 2 monedas/ }),
    )

    await waitFor(() =>
      expect(
        within(filaDe(document.body, 'USD')).getByText('448.38'),
      ).toBeInTheDocument(),
    )
    expect(
      within(filaDe(document.body, 'EUR')).getByText('522.50'),
    ).toBeInTheDocument()
  })
})

describe('Impuestos', () => {
  // La tabla del mock es estado de módulo: dar de alta una vigencia aquí la
  // dejaría puesta para el resto del archivo.
  afterEach(() => {
    tarifasImpuestoMock.splice(
      0,
      tarifasImpuestoMock.length,
      ...TARIFAS_IMPUESTO_SEED.map((t) => ({ ...t })),
    )
  })

  it('explica por qué no se puede eliminar una tarifa con facturas', async () => {
    const usuario = userEvent.setup()
    montar('/configuracion/impuestos')

    const fila = (await screen.findByText('GENERAL')).closest('tr')!
    expect(within(fila).getByText('13%')).toBeInTheDocument()
    expect(within(fila).getByText('Vigente')).toBeInTheDocument()

    await usuario.click(
      within(fila).getByRole('button', { name: 'Eliminar la vigencia' }),
    )
    const dialogo = await screen.findByRole('dialog')
    await usuario.click(within(dialogo).getByRole('button', { name: /^Eliminar/ }))

    // No basta con negarse: la pantalla dice cuántas facturas la usan y cuál
    // es la salida, que es cerrar la vigencia en vez de borrarla.
    expect(
      await within(dialogo).findByText(
        /hay facturas calculadas con esta tarifa/i,
      ),
    ).toBeInTheDocument()
    expect(
      within(dialogo).getByText(/GENERAL se usó en \d+ factura/),
    ).toBeInTheDocument()
    // Y retira el botón que no puede funcionar.
    expect(
      within(dialogo).queryByRole('button', { name: /^Eliminar/ }),
    ).not.toBeInTheDocument()
  })

  it('rechaza una vigencia solapada y admite la que no lo está', async () => {
    const usuario = userEvent.setup()
    montar('/configuracion/impuestos')
    await screen.findByText('GENERAL')

    await usuario.click(screen.getByRole('button', { name: /Nueva tarifa/ }))
    const dialogo = await screen.findByRole('dialog')

    // Otra fila del mismo código que pisa la vigencia abierta: a esa fecha
    // habría dos porcentajes posibles para la misma factura.
    await usuario.type(within(dialogo).getByLabelText(/^Código\*/), 'GENERAL')
    await usuario.type(
      within(dialogo).getByLabelText(/^Nombre/),
      'IVA general 15%',
    )
    await ponerNumero(usuario, /^Porcentaje/, '15')
    await ponerFecha(usuario, /^Vigente desde/, '2027-01-01')
    await usuario.click(within(dialogo).getByRole('button', { name: /^Guardar/ }))

    // Dos veces: bajo el campo de la vigencia y en el resumen de errores.
    expect(
      await within(dialogo).findAllByText(
        /cierre esa vigencia antes de abrir otra/,
      ),
    ).toHaveLength(2)

    // Un código que la tabla no tiene sí entra, y entra con su vigencia.
    await usuario.clear(within(dialogo).getByLabelText(/^Código\*/))
    await usuario.type(
      within(dialogo).getByLabelText(/^Código\*/),
      'REDUCIDA_15',
    )
    await usuario.click(within(dialogo).getByRole('button', { name: /^Guardar/ }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    const nueva = (await screen.findByText('REDUCIDA_15')).closest('tr')!
    expect(within(nueva).getByText('15%')).toBeInTheDocument()
    // Empieza en 2027: hoy todavía no rige, y la pantalla lo dice.
    expect(within(nueva).getByText('Futura')).toBeInTheDocument()
  })
})
