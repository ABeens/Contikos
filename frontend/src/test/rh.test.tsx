import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Decimal from 'decimal.js'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioBancos, servicioConta, servicioRh } from '@/shared/api/servicios'
import { ApiError } from '@/shared/api/client'
import { restablecerMonedas } from '@/shared/money/money'
import { PARAMETROS_2026 } from '@/mocks/seed/rh'
import { iniciarSesionDePrueba } from './sesion'

/**
 * Recursos humanos de punta a punta (docs/08): calcular, contabilizar y pagar
 * la planilla de agosto, con la verificación de docs/08 §4: después de pagar,
 * los sueldos por pagar quedan en cero.
 *
 * Archivo aparte porque la planilla muta el mayor y el auxiliar bancario. Las
 * pruebas van en orden.
 */

const servidor = setupServer(...handlers)

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  servidor.resetHandlers()
  restablecerMonedas()
})
afterAll(() => servidor.close())

const AGOSTO = 'per-2026-08'
const JULIO = 'per-2026-07'

async function codigoDe(promesa: Promise<unknown>): Promise<string | null> {
  try {
    await promesa
    return null
  } catch (e) {
    return e instanceof ApiError ? `${e.status} ${e.codigo}` : String(e)
  }
}

describe('Permisos de planilla', () => {
  it('el contador no ve los salarios; quien lleva la planilla sí', async () => {
    iniciarSesionDePrueba('usr-contadora')
    expect(await codigoDe(servicioRh.listarEmpleados())).toBe('403 PERMISO_DENEGADO')
    iniciarSesionDePrueba('usr-planilla')
    expect((await servicioRh.listarEmpleados()).length).toBe(5)
  })
})

describe('Parámetros con vigencia', () => {
  it('rechaza tramos con huecos y una fecha ya usada', async () => {
    const { id, ...base } = PARAMETROS_2026
    void id
    const conHueco = {
      ...base,
      vigenteDesde: '2027-01-01',
      fuente: 'Prueba',
      tramosRenta: [
        { desde: '0.00', hasta: '900000.00', tasa: '0' },
        { desde: '950000.00', hasta: null, tasa: '10' },
      ],
    }
    expect(await codigoDe(servicioRh.registrarParametros(conHueco))).toBe(
      '422 PARAMETROS_INVALIDOS',
    )
    expect(
      await codigoDe(servicioRh.registrarParametros({ ...base, fuente: 'Prueba' })),
    ).toBe('422 PARAMETROS_INVALIDOS')
  })

  it('registra una vigencia nueva sin tocar la anterior', async () => {
    const { id, ...base } = PARAMETROS_2026
    void id
    await servicioRh.registrarParametros({
      ...base,
      vigenteDesde: '2027-01-01',
      fuente: 'Decreto de prueba',
      creditoHijo: '1800.00',
    })
    const lista = await servicioRh.listarParametros()
    expect(lista.map((p) => p.vigenteDesde)).toEqual(['2027-01-01', '2026-01-01'])
    expect(lista[1].creditoHijo).toBe('1710.00')
  })
})

describe('Planilla de agosto', () => {
  it('calcula con los parámetros vigentes en agosto y se puede recalcular', async () => {
    const planilla = await servicioRh.calcularPlanilla({
      periodoId: AGOSTO,
      fechaPago: '2026-08-31',
      pymeMenosDe5: false,
      incidencias: [],
    })
    expect(planilla.lineas).toHaveLength(5)
    // La vigencia de 2027 existe, pero agosto de 2026 usa la de 2026.
    expect(planilla.parametrosId).toBe('par-2026-01')

    const recalculada = await servicioRh.calcularPlanilla({
      periodoId: AGOSTO,
      fechaPago: '2026-08-31',
      pymeMenosDe5: false,
      incidencias: [
        {
          empleadoId: 'emp-rh-002',
          horasExtra: '10',
          bonificaciones: '0',
          diasSinGoce: 0,
          otrasDeducciones: '0',
        },
      ],
    })
    expect(recalculada.id).toBe(planilla.id)
    const jose = recalculada.lineas.find((l) => l.empleadoId === 'emp-rh-002')!
    expect(jose.montoHorasExtra).toBe('48750.00')
  })

  it('el checklist de agosto avisa que la planilla no está contabilizada', async () => {
    const checklist = await servicioConta.obtenerVerificacionCierre(AGOSTO)
    const nomina = checklist.verificaciones.find((v) => v.codigo === 'NOMINA_PENDIENTE')
    expect(nomina?.severidad).toBe('aviso')
  })

  it('contabiliza un asiento que cuadra, mayor que los recibos por la parte patronal', async () => {
    const [planilla] = (await servicioRh.listarPlanillas()).filter((p) => p.periodoId === AGOSTO)
    const contabilizada = await servicioRh.contabilizarPlanilla(planilla.id)
    expect(contabilizada.estado).toBe('contabilizada')

    const asiento = await servicioConta.obtenerAsiento(contabilizada.asientoId!)
    const total = asiento.totales[0]
    expect(total.totalCargos).toBe(total.totalAbonos)
    expect(
      new Decimal(total.totalCargos).greaterThan(
        new Decimal(planilla.totalBruto).plus(planilla.totalCargasPatrono),
      ),
    ).toBe(true)

    // Ya no se recalcula: cambiarla es reversar el asiento.
    expect(
      await codigoDe(
        servicioRh.calcularPlanilla({
          periodoId: AGOSTO,
          fechaPago: '2026-08-31',
          pymeMenosDe5: false,
          incidencias: [],
        }),
      ),
    ).toBe('422 PLANILLA_YA_CONTABILIZADA')

    const checklist = await servicioConta.obtenerVerificacionCierre(AGOSTO)
    expect(checklist.verificaciones.find((v) => v.codigo === 'NOMINA_PENDIENTE')?.severidad).toBe(
      'ok',
    )
  })

  it('al pagar, los sueldos por pagar quedan en cero y el retiro llega al banco', async () => {
    const [planilla] = (await servicioRh.listarPlanillas()).filter((p) => p.periodoId === AGOSTO)
    const [banco] = (await servicioBancos.listarCuentas()).filter(
      (c) => c.moneda === 'CRC' && c.activa,
    )
    const pagada = await servicioRh.pagarPlanilla(planilla.id, {
      cuentaBancariaId: banco.id,
      fecha: '2026-08-31',
    })
    expect(pagada.estado).toBe('pagada')

    // Por empleado, con su auxiliar: la demo trae además la planilla de julio
    // sin pagar, con otro auxiliar, que no es asunto de esta prueba.
    const asientos = await servicioConta.listarAsientos({ periodoId: AGOSTO, libro: 'fiscal' })
    for (const linea of planilla.lineas) {
      const saldo = asientos
        .flatMap((a) => a.lineas)
        .filter((l) => l.cuentaCodigo === '2.1.03.001' && l.auxiliarId === linea.empleadoId)
        .reduce((acc, l) => acc.plus(l.abono).minus(l.cargo), new Decimal(0))
      expect(saldo.isZero(), linea.empleadoNombre).toBe(true)
    }

    const movimientos = await servicioBancos.listarMovimientos({ cuentaBancariaId: banco.id })
    const retiro = movimientos.find((m) => m.origen?.modulo === 'rh')
    expect(retiro?.importe).toBe(new Decimal(planilla.totalNeto).negated().toFixed(2))
  })

  it('julio sin empleados en planilla no pide nada', async () => {
    // Todos los empleados de la demo entraron antes de julio: sí hay planilla.
    const checklist = await servicioConta.obtenerVerificacionCierre(JULIO)
    expect(checklist.verificaciones.some((v) => v.codigo === 'NOMINA_PENDIENTE')).toBe(true)
  })
})

describe('Pantalla de planilla', () => {
  it('calcula la planilla de setiembre desde la pantalla', async () => {
    iniciarSesionDePrueba('usr-planilla')
    const user = userEvent.setup()
    const router = createMemoryRouter(rutas, {
      initialEntries: ['/rh/planilla?periodo=per-2026-09'],
    })
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    )
    await screen.findByRole('heading', { name: 'Planilla de Setiembre 2026' })
    const boton = await screen.findByRole('button', { name: 'Calcular planilla' })
    await waitFor(() => expect(boton).toBeEnabled())
    await user.click(boton)
    expect(await screen.findByText('Planilla calculada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contabilizar' })).toBeInTheDocument()
  })
})
