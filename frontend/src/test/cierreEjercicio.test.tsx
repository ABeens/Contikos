import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import Decimal from 'decimal.js'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioConta } from '@/shared/api/servicios'
import { ApiError } from '@/shared/api/client'
import { restablecerMonedas } from '@/shared/money/money'
import {
  construirEstadoResultados,
  construirEstadoSituacion,
} from '@/modules/reportes/domain/estados'
import {
  saldosAlCierre,
  saldosAlInicio,
  variacion,
} from '@/modules/reportes/domain/saldos'

/**
 * Cierre del ejercicio de punta a punta (docs/03 §6).
 *
 * Archivo aparte porque muta el mock para siempre: bloquea 2026 y abre 2027.
 * Las pruebas van en orden. El reloj se adelanta a enero de 2027, porque un
 * ejercicio en curso no se cierra, y solo se falsea `Date`: MSW y las esperas
 * de las pruebas siguen con los temporizadores reales.
 */

const servidor = setupServer(...handlers)

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-01-15T12:00:00'))
  servidor.listen({ onUnhandledRequest: 'error' })
})
afterEach(() => {
  servidor.resetHandlers()
  restablecerMonedas()
})
afterAll(() => {
  servidor.close()
  vi.useRealTimers()
})

const DESTINO = '3.2.01.001'

async function catalogos() {
  const [cuentas, clasificaciones, notas] = await Promise.all([
    servicioConta.listarCuentas(),
    servicioConta.listarClasificaciones(),
    servicioConta.listarNotas(),
  ])
  return { cuentas, clasificaciones, notas }
}

describe('Cierre del ejercicio', () => {
  let utilidadAntes = ''

  it('no se cierra con meses anteriores abiertos', async () => {
    const checklist = await servicioConta.obtenerVerificacionEjercicio(2026, DESTINO)
    expect(checklist.puedeCerrar).toBe(false)
    expect(
      checklist.verificaciones.find((v) => v.codigo === 'MESES_ABIERTOS')?.severidad,
    ).toBe('error')
    await expect(
      servicioConta.cerrarEjercicio(2026, { cuentaDestino: DESTINO }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('con agosto a noviembre cerrados, se puede cerrar', async () => {
    for (const numero of ['08', '09', '10', '11']) {
      const periodo = `per-2026-${numero}`
      const checklist = await servicioConta.obtenerVerificacionCierre(periodo)
      const hayAvisos = checklist.verificaciones.some((v) => v.severidad === 'aviso')
      await servicioConta.cerrarPeriodo(periodo, {
        confirmarAvisos: hayAvisos,
        motivo: hayAvisos ? 'Prueba del cierre anual' : '',
      })
    }

    const checklist = await servicioConta.obtenerVerificacionEjercicio(2026, DESTINO)
    expect(checklist.puedeCerrar, JSON.stringify(checklist.verificaciones)).toBe(true)
    expect(checklist.fechaCierre).toBe('2026-12-31')

    // La utilidad acumulada del año antes de cerrar, para compararla después.
    const cat = await catalogos()
    const apertura = await servicioConta.obtenerBalanza('per-2026-01', 'fiscal')
    const diciembre = await servicioConta.obtenerBalanza('per-2026-12', 'fiscal')
    utilidadAntes = construirEstadoResultados(
      variacion(saldosAlCierre(diciembre), saldosAlInicio(apertura)),
      null,
      cat,
    ).utilidadNeta
    const fiscal = checklist.resultados.find((r) => r.libro === 'fiscal')
    expect(fiscal?.resultado).toBe(utilidadAntes)
  })

  it('cierra: asiento de cierre, meses bloqueados y el año siguiente abierto', async () => {
    const resultado = await servicioConta.cerrarEjercicio(2026, { cuentaDestino: DESTINO })
    expect(resultado.cerrado).toBe(true)

    const periodos = await servicioConta.listarPeriodos()
    expect(
      periodos.filter((p) => p.ejercicio === 2026).every((p) => p.estado === 'bloqueado'),
    ).toBe(true)
    const nuevos = periodos.filter((p) => p.ejercicio === 2027)
    expect(nuevos).toHaveLength(12)
    expect(nuevos.every((p) => p.estado === 'abierto')).toBe(true)

    const asientos = await servicioConta.listarAsientos({ periodoId: 'per-2026-12' })
    const cierre = asientos.find((a) => a.origenTipo === 'cierre_ejercicio')
    expect(cierre?.fecha).toBe('2026-12-31')
  })

  it('después del cierre, los resultados quedan en cero y el balance sigue cuadrando', async () => {
    const cat = await catalogos()
    for (const libro of ['fiscal', 'corporativo'] as const) {
      const apertura = await servicioConta.obtenerBalanza('per-2026-01', libro)
      const diciembre = await servicioConta.obtenerBalanza('per-2026-12', libro)

      for (const r of diciembre.renglones) {
        const cuenta = cat.cuentas.find((c) => c.codigo === r.codigo)
        if (cuenta?.esDetalle && ['ingreso', 'costo', 'gasto'].includes(cuenta.tipo)) {
          expect(new Decimal(r.saldoFinal).isZero(), `${libro} ${r.codigo}`).toBe(true)
        }
      }

      const balance = construirEstadoSituacion(
        { alCierre: saldosAlCierre(diciembre), alAbrirEjercicio: saldosAlInicio(apertura) },
        null,
        cat,
      )
      expect(balance.cuadra).toBe(true)
    }
  })

  it('el Estado de Resultados del año no cambia: excluye el asiento de cierre', async () => {
    const cat = await catalogos()
    const apertura = await servicioConta.obtenerBalanza('per-2026-01', 'fiscal', {
      excluirCierre: true,
    })
    const diciembre = await servicioConta.obtenerBalanza('per-2026-12', 'fiscal', {
      excluirCierre: true,
    })
    const despues = construirEstadoResultados(
      variacion(saldosAlCierre(diciembre), saldosAlInicio(apertura)),
      null,
      cat,
    ).utilidadNeta
    expect(despues).toBe(utilidadAntes)
  })

  it('no se cierra dos veces', async () => {
    const checklist = await servicioConta.obtenerVerificacionEjercicio(2026, DESTINO)
    expect(checklist.cerrado).toBe(true)
    expect(checklist.puedeCerrar).toBe(false)
  })

  it('la pantalla enseña el checklist del ejercicio', async () => {
    // Las esperas de Testing Library miden el tiempo con `Date`: con el reloj
    // congelado no avanzan. 2027 sigue en curso también con el reloj real.
    vi.useRealTimers()
    const router = createMemoryRouter(rutas, {
      initialEntries: ['/conta/cierre-ejercicio'],
    })
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(
      await screen.findByRole('heading', { name: 'Cierre del ejercicio' }),
    ).toBeInTheDocument()
    // Cerrado 2026, la pantalla propone 2027, que todavía está en curso.
    // `waitFor` y no `findBy`: el checklist se pide otra vez en cuanto se
    // propone la cuenta destino, y el primer nodo encontrado se reemplaza.
    await waitFor(() =>
      expect(screen.getByText(/2027-12-31 y todavía está en curso/)).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Cerrar el ejercicio' })).toBeDisabled()
  })
})
