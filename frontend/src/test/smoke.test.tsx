import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * Prueba de humo: que compile no es que funcione.
 *
 * Renderiza la aplicación real contra los mismos handlers que usa el
 * navegador, y recorre las pantallas del módulo `conta`.
 */

const servidor = setupServer(...handlers)

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  servidor.resetHandlers()
  // El registro de monedas es estado de módulo: sin esto, una prueba que
  // cambia la moneda funcional se la deja cambiada a la siguiente.
  restablecerMonedas()
})
afterAll(() => servidor.close())

/**
 * Fecha dentro del primer periodo abierto de la semilla (agosto de 2026).
 *
 * La captura propone la fecha de hoy, y hoy puede caer en otro periodo
 * abierto: el asiento se contabilizaría bien, pero la lista enseña el periodo
 * activo y la prueba fallaría por calendario y no por lógica.
 */
const FECHA_ABIERTA = '2026-08-20'

async function ponerFechaAbierta(usuario: ReturnType<typeof userEvent.setup>) {
  const campo = screen.getByLabelText(/^fecha/i)
  await usuario.clear(campo)
  await usuario.type(campo, FECHA_ABIERTA)
}

function montar(rutaInicial: string) {
  const router = createMemoryRouter(rutas, { initialEntries: [rutaInicial] })
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('Aplicación', () => {
  it('renderiza el shell con los siete módulos', async () => {
    montar('/')
    const nav = await screen.findByRole('navigation')
    for (const modulo of [
      'Contabilidad',
      'Cuentas por cobrar',
      'Cuentas por pagar',
      'Bancos',
      'Activos fijos',
      'Recursos humanos',
      'Reportes',
    ]) {
      expect(within(nav).getByText(modulo)).toBeInTheDocument()
    }
  })

  it('el menú despliega las pantallas del módulo en el que se está', async () => {
    const { unmount } = montar('/')
    let nav = await screen.findByRole('navigation')

    // Fuera del módulo, el menú enseña los siete módulos y nada más: las
    // veintitantas pantallas del sistema a la vez no orientan, abruman.
    expect(within(nav).queryByText('Catálogo de cuentas')).toBeNull()
    unmount()

    // Dentro, sus pantallas se despliegan sin tener que buscarlas.
    montar('/conta/asientos')
    nav = await screen.findByRole('navigation')
    for (const pantalla of [
      'Catálogo de cuentas',
      'Clasificación NIIF',
      'Asientos',
      'Balanza de comprobación',
    ]) {
      expect(within(nav).getByText(pantalla)).toBeInTheDocument()
    }

    expect(
      within(nav).getByText('Catálogo de cuentas').closest('a'),
    ).toHaveAttribute('href', '/conta/cuentas')
  })

  it('selecciona por defecto el primer periodo abierto', async () => {
    montar('/')
    const selector = await screen.findByLabelText('Periodo')
    await waitFor(() =>
      expect(selector).toHaveDisplayValue('Agosto 2026'),
    )
  })
})

describe('Catálogo de cuentas', () => {
  it('carga el catálogo y marca las cuentas de control', async () => {
    montar('/conta/cuentas')

    expect(await screen.findByText('Clientes')).toBeInTheDocument()
    expect(await screen.findByText('Proveedores')).toBeInTheDocument()

    // La cuenta de clientes es control de cxc
    expect(screen.getAllByText(/Control · cxc/).length).toBeGreaterThan(0)
    // Y exige auxiliar
    expect(screen.getAllByText(/Auxiliar: cliente/).length).toBeGreaterThan(0)
  })
})

describe('Asientos', () => {
  it('lista los asientos del periodo activo y abre el detalle del asiento', async () => {
    const usuario = userEvent.setup()
    montar('/conta/asientos')

    // Agosto 2026: pago a proveedor, comisiones bancarias y reclasificación
    const fila = await screen.findByText('Comisiones bancarias agosto')
    await usuario.click(fila)

    expect(await screen.findByText('Detalle del asiento')).toBeInTheDocument()
    // El panel muestra la trazabilidad al documento origen del módulo
    expect(
      screen.getByText(/bancos · comision · com-0805/),
    ).toBeInTheDocument()
    expect(screen.getByText('Comisión por manejo de cuenta')).toBeInTheDocument()
  })
})

describe('Balanza de comprobación', () => {
  it('cuadra: total de cargos igual a total de abonos', async () => {
    montar('/conta/balanza')
    expect(
      await screen.findByText(/La balanza cuadra/),
    ).toBeInTheDocument()
  })
})

describe('Captura de asiento', () => {
  it('muestra la diferencia en vivo y rechaza un asiento descuadrado', async () => {
    const usuario = userEvent.setup()
    montar('/conta/asientos/nuevo')

    const cuentas = await screen.findAllByRole('combobox', { name: 'Cuenta' })
    await ponerFechaAbierta(usuario)
    expect(cuentas).toHaveLength(2)

    await usuario.type(cuentas[0], '6.1.02.004')
    await usuario.type(cuentas[1], '1.1.01.002')

    await usuario.type(
      screen.getByPlaceholderText('Descripción del asiento'),
      'Compra de papelería',
    )

    // Se capturan importes que NO cuadran
    const filas = screen.getAllByRole('row')
    await usuario.type(
      within(filas[1]).getByRole('textbox', { name: 'Cargo' }),
      '10000',
    )
    await usuario.type(
      within(filas[2]).getByRole('textbox', { name: 'Abono' }),
      '9000',
    )
    await usuario.tab()

    // La diferencia se muestra durante la captura, no solo al guardar
    await waitFor(() =>
      expect(screen.getByText('₡1.000,00')).toBeInTheDocument(),
    )

    await usuario.click(screen.getByRole('button', { name: /Contabilizar/ }))

    expect(
      await screen.findByText(/El asiento no se puede contabilizar/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/El asiento no cuadra: diferencia de 1000.00/),
    ).toBeInTheDocument()
  })

  it('contabiliza un asiento cuadrado y lo muestra en la lista', async () => {
    const usuario = userEvent.setup()
    montar('/conta/asientos/nuevo')

    const cuentas = await screen.findAllByRole('combobox', { name: 'Cuenta' })
    await ponerFechaAbierta(usuario)
    await usuario.type(cuentas[0], '6.1.02.004')
    await usuario.type(cuentas[1], '1.1.01.002')
    await usuario.type(
      screen.getByPlaceholderText('Descripción del asiento'),
      'Compra de papelería agosto',
    )

    const filas = screen.getAllByRole('row')
    await usuario.type(
      within(filas[1]).getByRole('textbox', { name: 'Cargo' }),
      '25000',
    )
    await usuario.type(
      within(filas[2]).getByRole('textbox', { name: 'Abono' }),
      '25000',
    )
    await usuario.tab()

    await usuario.click(screen.getByRole('button', { name: /Contabilizar/ }))

    // Tras contabilizar navega a la lista, donde el asiento nuevo ya aparece
    expect(
      await screen.findByText('Compra de papelería agosto'),
    ).toBeInTheDocument()
  })

  it('impide capturar contra una cuenta de control', async () => {
    const usuario = userEvent.setup()
    montar('/conta/asientos/nuevo')

    const cuentas = await screen.findAllByRole('combobox', { name: 'Cuenta' })
    await ponerFechaAbierta(usuario)
    // 1.1.02.001 es Clientes: cuenta de control de cxc
    await usuario.type(cuentas[0], '1.1.02.001')
    await usuario.type(cuentas[1], '4.1.01.001')
    await usuario.type(
      screen.getByPlaceholderText('Descripción del asiento'),
      'Intento de mover cuenta de control',
    )

    const filas = screen.getAllByRole('row')
    await usuario.type(
      within(filas[1]).getByRole('textbox', { name: 'Cargo' }),
      '5000',
    )
    await usuario.type(
      within(filas[2]).getByRole('textbox', { name: 'Abono' }),
      '5000',
    )
    await usuario.tab()

    await usuario.click(screen.getByRole('button', { name: /Contabilizar/ }))

    expect(
      await screen.findByText(/es cuenta de control de cxc/),
    ).toBeInTheDocument()
  })

  it('busca el auxiliar por código o por nombre, nunca por id', async () => {
    const usuario = userEvent.setup()
    montar('/conta/asientos/nuevo')

    const cuentas = await screen.findAllByRole('combobox', { name: 'Cuenta' })
    await ponerFechaAbierta(usuario)
    // 2.1.04.001 es Anticipos de clientes: exige auxiliar de tipo cliente y no
    // es cuenta de control, así que sí se puede capturar a mano.
    await usuario.type(cuentas[0], '2.1.04.001')

    const auxiliar = await screen.findByRole('combobox', { name: 'Auxiliar' })

    // Se ofrece el catálogo de clientes con el código Y el nombre: son las dos
    // formas en que se busca un cliente, y el id interno no es ninguna.
    await waitFor(() => {
      const opciones = [...document.querySelectorAll('datalist option')].map(
        (o) => o.getAttribute('value'),
      )
      expect(opciones).toContain('C-002 · Comercial La Sabana S.A.')
    })

    // El código resuelve, y la pantalla confirma a quién se está contabilizando
    await usuario.type(auxiliar, 'C-002')
    expect(
      await screen.findByText('Comercial La Sabana S.A.'),
    ).toBeInTheDocument()

    // Y lo que no corresponde a ninguna ficha se dice, en vez de contabilizarse
    await usuario.clear(auxiliar)
    await usuario.type(auxiliar, 'cli-002')
    expect(
      await screen.findByText('Comercial La Sabana S.A.'),
    ).toBeInTheDocument()

    await usuario.clear(auxiliar)
    await usuario.type(auxiliar, 'Un cliente que no existe')
    expect(
      await screen.findByText(/con ese código o nombre/),
    ).toBeInTheDocument()
  })
})

describe('Contabilidad corporativa', () => {
  it('capturar afecta las dos contabilidades sin que haya que elegir', async () => {
    const usuario = userEvent.setup()
    montar('/conta/asientos/nuevo')

    const cuentas = await screen.findAllByRole('combobox', { name: 'Cuenta' })
    await ponerFechaAbierta(usuario)

    // El estado inicial es el que importa: las dos marcadas, en el encabezado
    // y en cada línea.
    for (const etiqueta of [
      'Fiscal: todo el asiento',
      'Corporativa: todo el asiento',
      'Fiscal, línea 1',
      'Corporativa, línea 1',
      'Fiscal, línea 2',
      'Corporativa, línea 2',
    ]) {
      expect(screen.getByRole('checkbox', { name: etiqueta })).toBeChecked()
    }

    await usuario.type(cuentas[0], '6.1.02.001')
    await usuario.type(cuentas[1], '1.1.01.002')
    await usuario.type(
      screen.getByPlaceholderText('Descripción del asiento'),
      'Alquiler de bodega agosto',
    )

    const filas = screen.getAllByRole('row')
    await usuario.type(
      within(filas[1]).getByRole('textbox', { name: 'Cargo' }),
      '120000',
    )
    await usuario.type(
      within(filas[2]).getByRole('textbox', { name: 'Abono' }),
      '120000',
    )
    await usuario.tab()

    await usuario.click(screen.getByRole('button', { name: /Contabilizar/ }))

    const fila = (await screen.findByText('Alquiler de bodega agosto')).closest(
      'tr',
    )!
    expect(within(fila).getByText('Ambas')).toBeInTheDocument()
  })

  it('desmarcar un libro deja el asiento fuera de esa contabilidad', async () => {
    const usuario = userEvent.setup()
    montar('/conta/asientos/nuevo')

    const cuentas = await screen.findAllByRole('combobox', { name: 'Cuenta' })
    await ponerFechaAbierta(usuario)

    // La casilla del encabezado desmarca todas las líneas de una vez
    await usuario.click(
      screen.getByRole('checkbox', { name: 'Fiscal: todo el asiento' }),
    )
    expect(
      screen.getByRole('checkbox', { name: 'Fiscal, línea 2' }),
    ).not.toBeChecked()

    await usuario.type(cuentas[0], '6.1.01.004')
    await usuario.type(cuentas[1], '2.1.03.011')
    await usuario.type(
      screen.getByPlaceholderText('Descripción del asiento'),
      'Provisión de vacaciones setiembre',
    )

    const filas = screen.getAllByRole('row')
    await usuario.type(
      within(filas[1]).getByRole('textbox', { name: 'Cargo' }),
      '80000',
    )
    await usuario.type(
      within(filas[2]).getByRole('textbox', { name: 'Abono' }),
      '80000',
    )
    await usuario.tab()

    await usuario.click(screen.getByRole('button', { name: /Contabilizar/ }))

    const fila = (
      await screen.findByText('Provisión de vacaciones setiembre')
    ).closest('tr')!
    expect(within(fila).getByText('Solo corporativa')).toBeInTheDocument()

    // Y al filtrar por la fiscal, ese asiento no está
    await usuario.selectOptions(screen.getByLabelText('Contabilidad'), 'fiscal')
    await waitFor(() =>
      expect(
        screen.queryByText('Provisión de vacaciones setiembre'),
      ).not.toBeInTheDocument(),
    )
  })

  it('la balanza es de un libro: el devengo NIIF no aparece en la fiscal', async () => {
    const usuario = userEvent.setup()
    montar('/conta/balanza')

    // Agosto 2026 trae una provisión de vacaciones solo corporativa
    expect(await screen.findByText('Caja chica')).toBeInTheDocument()
    expect(screen.queryByText('Provisión de vacaciones')).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('radio', { name: 'Corporativa' }))

    expect(
      await screen.findByText('Provisión de vacaciones'),
    ).toBeInTheDocument()
    // Cada libro cuadra por su cuenta
    expect(screen.getByText(/La balanza cuadra/)).toBeInTheDocument()
  })
})

/**
 * Estas pruebas van al final a propósito: mutan el catálogo del mock, que es
 * estado compartido del archivo. Designar otra moneda funcional a media suite
 * cambiaría la balanza de las pruebas siguientes.
 */
describe('Configuración de monedas', () => {
  it('lista el catálogo y formatea cada moneda con su convención', async () => {
    montar('/configuracion/monedas')

    expect(await screen.findByText('Colón costarricense')).toBeInTheDocument()
    expect(screen.getByText('Dólar estadounidense')).toBeInTheDocument()
    expect(screen.getByText('Euro')).toBeInTheDocument()

    // Cada una con su separador, sus decimales y la posición de su símbolo
    expect(screen.getByText('₡1.234.567,89')).toBeInTheDocument()
    expect(screen.getByText('$1,234,567.89')).toBeInTheDocument()
    expect(screen.getByText('1.234.567,89 €')).toBeInTheDocument()
  })

  it('rechaza un código que no es ISO 4217', async () => {
    const usuario = userEvent.setup()
    montar('/configuracion/monedas')

    await usuario.click(
      await screen.findByRole('button', { name: /Nueva moneda/ }),
    )
    await usuario.type(screen.getByLabelText(/Código ISO 4217/), 'EU')
    await usuario.type(screen.getByLabelText(/^Nombre/), 'Euro raro')
    await usuario.type(screen.getByLabelText(/^Símbolo/), '€')
    await usuario.type(screen.getByLabelText(/Tipo de cambio/), '592.40')
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }))

    // Bajo el campo y en el resumen de errores del pie
    expect(
      await screen.findAllByText(/El código debe ser el ISO 4217/),
    ).toHaveLength(2)
  })

  it('da de alta una moneda y queda disponible al capturar un asiento', async () => {
    const usuario = userEvent.setup()
    const { unmount } = montar('/configuracion/monedas')

    await usuario.click(
      await screen.findByRole('button', { name: /Nueva moneda/ }),
    )
    await usuario.type(screen.getByLabelText(/Código ISO 4217/), 'GBP')
    await usuario.type(screen.getByLabelText(/^Nombre/), 'Libra esterlina')
    await usuario.type(screen.getByLabelText(/^Símbolo/), '£')
    await usuario.type(screen.getByLabelText(/Tipo de cambio/), '640')
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Libra esterlina')).toBeInTheDocument()
    unmount()

    // Lo que se configura es lo que se puede capturar: sin recompilar nada
    montar('/conta/asientos/nuevo')
    const selector = await screen.findByLabelText(/Moneda/)
    expect(
      within(selector).getByRole('option', { name: /Libra esterlina \(GBP\)/ }),
    ).toBeInTheDocument()
  })

  it('designa otra moneda funcional y el resto de la aplicación lo refleja', async () => {
    const usuario = userEvent.setup()
    const { unmount } = montar('/configuracion/monedas')

    // Una por cada moneda no funcional; la primera es la del dólar.
    const designar = await screen.findAllByRole('button', {
      name: 'Designar como moneda funcional',
    })
    await usuario.click(designar[0])
    await usuario.click(screen.getByRole('button', { name: 'Designar' }))

    // El diálogo se cierra cuando la designación queda aplicada.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Designar' })).toBeNull(),
    )
    unmount()

    // La designación es dato de la empresa, no estado de esta pantalla: la
    // balanza se expresa desde ya en la moneda nueva.
    montar('/conta/balanza')
    expect(await screen.findByText(/Contabilidad fiscal .* USD/)).toBeInTheDocument()
  })
})

/**
 * Estas pruebas mutan los catálogos del mock, que son estado compartido del
 * archivo. Van al final, junto a las de monedas, por la misma razón: clasificar
 * una cuenta a media suite cambiaría lo que ven las pruebas siguientes.
 */
describe('Clasificación NIIF y notas a los EEFF', () => {
  it('agrupa las clasificaciones por estado financiero y despliega sus notas', async () => {
    const usuario = userEvent.setup()
    montar('/conta/clasificaciones')

    expect(
      await screen.findByText('Estado de Situación Financiera'),
    ).toBeInTheDocument()
    expect(screen.getByText('Estado de Resultados')).toBeInTheDocument()

    // Las notas cuelgan del renglón: no se ven hasta desplegarlo
    expect(
      screen.queryByText('Arqueo por caja, con el fondo fijo de caja chica y su responsable.'),
    ).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Notas de A.01' }))

    // El renglón A.01 se desglosa en dos notas que comparten número
    expect(await screen.findByText('Nota 1a')).toBeInTheDocument()
    expect(screen.getByText('Nota 1b')).toBeInTheDocument()
    expect(screen.getByText(/Arqueo por caja/)).toBeInTheDocument()
  })

  it('rechaza una nota con una referencia ya usada', async () => {
    const usuario = userEvent.setup()
    montar('/conta/clasificaciones')

    await usuario.click(
      await screen.findByRole('button', { name: 'Añadir una nota a A.01' }),
    )

    const numero = await screen.findByLabelText(/^Número/)
    await usuario.clear(numero)
    await usuario.type(numero, '1')
    // El número solo se repite si el literal también: 1a ya está en el catálogo
    await usuario.type(screen.getByLabelText(/^Literal/), 'a')
    await usuario.type(
      screen.getByLabelText(/^Título/),
      'Otra nota del efectivo',
    )
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }))

    // Bajo el campo y en el resumen de errores del pie
    expect(await screen.findAllByText(/Ya existe la nota 1a/)).toHaveLength(2)
  })

  it('admite dos notas con el mismo número si el literal las distingue', async () => {
    const usuario = userEvent.setup()
    montar('/conta/clasificaciones')

    await usuario.click(
      await screen.findByRole('button', { name: 'Añadir una nota a A.01' }),
    )

    const numero = await screen.findByLabelText(/^Número/)
    await usuario.clear(numero)
    await usuario.type(numero, '1')
    await usuario.type(screen.getByLabelText(/^Literal/), 'c')
    await usuario.type(
      screen.getByLabelText(/^Título/),
      'Efectivo restringido',
    )
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }))

    await usuario.click(
      await screen.findByRole('button', { name: 'Notas de A.01' }),
    )
    expect(await screen.findByText('Nota 1c')).toBeInTheDocument()
  })

  it('no deja eliminar una clasificación que tiene cuentas asignadas', async () => {
    montar('/conta/clasificaciones')

    const eliminar = await screen.findByRole('button', { name: 'Eliminar A.01' })
    expect(eliminar).toBeDisabled()
    expect(eliminar).toHaveAttribute(
      'title',
      'Tiene cuentas asignadas: desactívela en vez de eliminarla',
    )
  })
})

describe('Clasificación de una cuenta', () => {
  it('solo ofrece notas de la clasificación elegida y reclasifica la cuenta', async () => {
    const usuario = userEvent.setup()
    montar('/conta/cuentas')

    // La semilla llega entera: toda cuenta de detalle tiene renglón y nota, y
    // desde aquí se cambian, nunca se quitan.
    expect(
      await screen.findByLabelText(/Solo sin presentación \(0\)/),
    ).toBeInTheDocument()

    await usuario.click(await screen.findByText('Intereses sobre préstamos'))

    expect(
      await screen.findByText('Presentación de 6.2.01.003'),
    ).toBeInTheDocument()

    const renglon = screen.getByLabelText(/^Clasificación NIIF/)
    // Es una cuenta de gasto: no se le ofrecen renglones de activo
    expect(
      within(renglon).queryByRole('option', { name: /A\.01/ }),
    ).not.toBeInTheDocument()
    // Y no hay forma de dejarla sin renglón
    expect(
      within(renglon).queryByRole('option', { name: /Sin clasificar/ }),
    ).not.toBeInTheDocument()

    await usuario.selectOptions(renglon, 'niif-r-05')

    const nota = screen.getByLabelText(/^Nota a los estados financieros/)
    // Solo las notas de R.05. La 1a es de A.01 y no aparece.
    expect(
      within(nota).queryByRole('option', { name: /Nota 1a ·/ }),
    ).not.toBeInTheDocument()
    await usuario.selectOptions(nota, 'nota-16')

    await usuario.click(screen.getByRole('button', { name: 'Guardar' }))

    const fila = (
      await screen.findByText('Intereses sobre préstamos')
    ).closest('tr')!
    expect(
      await within(fila).findByText(/Otros gastos de administración/),
    ).toBeInTheDocument()
  })
})
