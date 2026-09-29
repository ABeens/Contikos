import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Decimal from 'decimal.js'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioConta } from '@/shared/api/servicios'
import { restablecerMonedas } from '@/shared/money/money'
import type { Libro } from '@/shared/api/contracts/comunes'
import type { Catalogos } from '@/modules/reportes/domain/presentacion'
import {
  construirEstadoResultados,
  construirEstadoSituacion,
} from '@/modules/reportes/domain/estados'
import { construirEstadoFlujos } from '@/modules/reportes/domain/flujos'
import { construirEstadoPatrimonio } from '@/modules/reportes/domain/patrimonio'
import { construirMayor } from '@/modules/reportes/domain/libros'
import {
  saldosAlCierre,
  saldosAlInicio,
  variacion,
} from '@/modules/reportes/domain/saldos'

/**
 * Reportes sobre los datos de demostración, de punta a punta.
 *
 * La primera mitad son pruebas de invariante (docs/11 §4): sobre el mayor de
 * la semilla, en cada mes y en los dos libros, el balance cuadra, el flujo
 * explica exactamente la variación del efectivo, el patrimonio termina donde
 * dice el balance y el mayor termina donde dice la balanza. La segunda mitad
 * monta las pantallas.
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

const LIBROS: Libro[] = ['fiscal', 'corporativo']
const AGOSTO = 'per-2026-08'
const ENERO = 'per-2026-01'

async function catalogos(): Promise<Catalogos> {
  const [cuentas, clasificaciones, notas] = await Promise.all([
    servicioConta.listarCuentas(),
    servicioConta.listarClasificaciones(),
    servicioConta.listarNotas(),
  ])
  return { cuentas, clasificaciones, notas }
}

describe('Invariantes sobre el mayor de demostración', () => {
  it.each(LIBROS)(
    'en cada mes del libro %s: el balance cuadra y el flujo explica el efectivo',
    async (libro) => {
      const cat = await catalogos()
      const periodos = await servicioConta.listarPeriodos()
      const apertura = await servicioConta.obtenerBalanza(ENERO, libro, {
        excluirCierre: true,
      })

      for (const periodo of periodos) {
        const conCierre = await servicioConta.obtenerBalanza(periodo.id, libro)
        const sinCierre = await servicioConta.obtenerBalanza(periodo.id, libro, {
          excluirCierre: true,
        })

        const balance = construirEstadoSituacion(
          {
            alCierre: saldosAlCierre(conCierre),
            alAbrirEjercicio: saldosAlInicio(apertura),
          },
          null,
          cat,
        )
        expect(balance.cuadra, `${periodo.id}: ${balance.diferencia}`).toBe(true)

        const flujo = construirEstadoFlujos(
          saldosAlInicio(apertura),
          saldosAlCierre(sinCierre),
          cat,
        )
        expect(flujo.cuadra, `${periodo.id}: ${flujo.diferencia}`).toBe(true)

        // El resultado acumulado del Estado de Resultados es el mismo que el
        // balance presenta como resultado del ejercicio.
        const resultados = construirEstadoResultados(
          variacion(saldosAlCierre(sinCierre), saldosAlInicio(apertura)),
          null,
          cat,
        )
        const renglon = balance.patrimonio.grupos
          .flatMap((g) => g.renglones)
          .find((r) => r.clave === 'resultado-ejercicio')
        expect(renglon?.importe).toBe(resultados.utilidadNeta)

        const patrimonio = construirEstadoPatrimonio(
          {
            inicio: saldosAlInicio(apertura),
            finSinCierre: saldosAlCierre(sinCierre),
            finConCierre: saldosAlCierre(conCierre),
          },
          cat,
        )
        expect(patrimonio.totalFinal).toBe(balance.patrimonio.total)
      }
    },
  )

  it.each(LIBROS)(
    'el mayor del libro %s termina exactamente donde dice la balanza',
    async (libro) => {
      const cat = await catalogos()
      const agosto = await servicioConta.obtenerBalanza(AGOSTO, libro)
      const enero = await servicioConta.obtenerBalanza(ENERO, libro)
      const asientos = await servicioConta.listarAsientos({
        desde: '2026-01-01',
        hasta: '2026-08-31',
        libro,
      })

      const mayor = construirMayor(asientos, enero, cat.cuentas, libro)
      const saldos = new Map(agosto.renglones.map((r) => [r.codigo, r.saldoFinal]))
      expect(mayor.length).toBeGreaterThan(0)
      for (const cuenta of mayor) {
        expect(
          new Decimal(cuenta.saldoFinal).equals(saldos.get(cuenta.codigo) ?? 0),
          cuenta.codigo,
        ).toBe(true)
      }
    },
  )
})

describe('Pantallas de reportes', () => {
  it('la portada lista los estados y los libros', async () => {
    montar(`/reportes?periodo=${AGOSTO}`)
    expect(
      await screen.findByRole('link', { name: /Estado de Situación Financiera/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Libro mayor y auxiliares/ })).toBeInTheDocument()
  })

  it('el balance cuadra y abre un renglón en sus cuentas', async () => {
    const user = userEvent.setup()
    montar(`/reportes/situacion?periodo=${AGOSTO}&libro=fiscal`)

    expect(
      await screen.findByText('Activo igual a pasivo más patrimonio'),
    ).toBeInTheDocument()
    expect(screen.getByText('Total pasivo y patrimonio')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /Efectivo y equivalentes al efectivo/ }),
    )
    // Cada cuenta del renglón enlaza a su auxiliar en el mayor, con el mismo
    // libro: es el drill-down de docs/09 §5.
    const [enlace] = await screen.findAllByRole('link', { name: /^1\.1\.01\./ })
    expect(enlace.getAttribute('href')).toContain('/reportes/mayor?cuenta=1.1.01.')
    expect(enlace.getAttribute('href')).toContain('libro=fiscal')
  })

  it('el estado de resultados llega a la utilidad neta', async () => {
    montar(`/reportes/resultados?periodo=${AGOSTO}`)
    expect(await screen.findByText('Utilidad neta')).toBeInTheDocument()
    expect(screen.getByText('Utilidad bruta')).toBeInTheDocument()
  })

  it('el flujo de efectivo dice que cuadra contra caja y bancos', async () => {
    montar(`/reportes/flujos?periodo=${AGOSTO}`)
    expect(
      await screen.findByText('La variación calculada es la de caja y bancos'),
    ).toBeInTheDocument()
  })

  it('el estado de cambios en el patrimonio presenta sus filas', async () => {
    montar(`/reportes/patrimonio?periodo=${AGOSTO}`)
    expect(await screen.findByText('Saldo al inicio del ejercicio')).toBeInTheDocument()
    expect(screen.getByText('Saldo al final')).toBeInTheDocument()
  })

  it('el auxiliar de una cuenta enlaza cada movimiento con su asiento', async () => {
    montar(`/reportes/mayor?periodo=${AGOSTO}&desde=${ENERO}&cuenta=1.1.02.001&libro=fiscal`)
    expect(await screen.findByRole('heading', { name: 'Auxiliar de cuenta' })).toBeInTheDocument()
    const asientos = await screen.findAllByRole('link', { name: /^AS-2026-/ })
    expect(asientos[0].getAttribute('href')).toContain('/conta/asientos?asiento=')
    expect(screen.queryByText(/El mayor no coincide con la balanza/)).not.toBeInTheDocument()
  })

  it('el libro diario cuadra', async () => {
    montar(`/reportes/diario?periodo=${AGOSTO}`)
    expect(await screen.findByText(/cargos igual a abonos/)).toBeInTheDocument()
  })

  it('el comparativo enfrenta la utilidad de los dos libros', async () => {
    montar(`/reportes/fiscal-corporativo?periodo=${AGOSTO}`)
    expect(await screen.findByText('Utilidad fiscal del ejercicio')).toBeInTheDocument()
    expect(screen.getByText('Utilidad corporativa del ejercicio')).toBeInTheDocument()
  })
})
