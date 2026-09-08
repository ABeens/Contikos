import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Decimal from 'decimal.js'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { rutas } from '@/app/router'
import { handlers } from '@/mocks/handlers'
import { servicioConta } from '@/shared/api/servicios'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * Cierre y reapertura de periodos (docs/03 §5) y balanza comparativa
 * (docs/09 §3.2), de punta a punta.
 *
 * Archivo aparte porque cerrar agosto muta el estado del mock: las demás
 * pruebas cuentan con el periodo abierto de la semilla.
 *
 * Las pruebas van en orden y dependen unas de otras: se verifica agosto, se
 * cierra, se comprueba que ya no admite asientos y se reabre. Es el ciclo
 * completo, y partirlo en cuatro montajes independientes obligaría a repetir
 * el cierre tres veces.
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

const JULIO = 'per-2026-07'
const AGOSTO = 'per-2026-08'
/** Diciembre no ha terminado: sirve para probar el punto de la fecha. */
const DICIEMBRE = 'per-2026-12'
const JUNIO = 'per-2026-06'

const MOTIVO = 'La depreciación de agosto se corre en setiembre'

describe('Cierre de periodo', () => {
  it('el checklist enseña los puntos que están bien y los que hay que revisar', async () => {
    const checklist = await servicioConta.obtenerVerificacionCierre(AGOSTO)

    expect(checklist.periodo.id).toBe(AGOSTO)
    expect(checklist.puedeCerrar).toBe(true)

    const codigos = checklist.verificaciones.map((v) => v.codigo)
    // El checklist está completo aunque tres de sus puntos no tengan módulo:
    // el día que exista nómina, lo único que cambia es la severidad.
    expect(codigos).toContain('NOMINA_PENDIENTE')
    expect(codigos).toContain('BANCOS_SIN_CONCILIAR')
    expect(codigos).toContain('REVALUACION_PENDIENTE')

    // Los dos libros se comprueban por separado y los dos cuadran.
    const balanzas = checklist.verificaciones.filter(
      (v) => v.codigo === 'BALANZA_DESCUADRADA',
    )
    expect(balanzas).toHaveLength(2)
    expect(balanzas.every((v) => v.severidad === 'ok')).toBe(true)

    // La semilla no tiene corrida de depreciación de agosto: es un aviso, no
    // un error, y por eso el periodo se puede cerrar igual.
    const depreciacion = checklist.verificaciones.find(
      (v) => v.codigo === 'DEPRECIACION_PENDIENTE',
    )!
    expect(depreciacion.severidad).toBe('aviso')
  })

  it('no deja cerrar un mes que todavía está en curso', async () => {
    const checklist = await servicioConta.obtenerVerificacionCierre(DICIEMBRE)
    expect(checklist.puedeCerrar).toBe(false)

    const fecha = checklist.verificaciones.find(
      (v) => v.codigo === 'FECHA_FUTURA',
    )!
    expect(fecha.severidad).toBe('error')

    // Y el servidor lo rechaza aunque se confirme todo: un error no se salta.
    await expect(
      servicioConta.cerrarPeriodo(DICIEMBRE, {
        confirmarAvisos: true,
        motivo: 'Adelantar el cierre',
      }),
    ).rejects.toMatchObject({ codigo: 'CIERRE_CON_ERRORES' })
  })

  it('los avisos no se saltan solos: hay que confirmarlos', async () => {
    await expect(
      servicioConta.cerrarPeriodo(AGOSTO, { confirmarAvisos: false, motivo: '' }),
    ).rejects.toMatchObject({ codigo: 'CIERRE_CON_AVISOS' })

    // Confirmar sin decir por qué no registra nada, así que tampoco vale.
    await expect(
      servicioConta.cerrarPeriodo(AGOSTO, { confirmarAvisos: true, motivo: '' }),
    ).rejects.toMatchObject({ codigo: 'MOTIVO_CIERRE_REQUERIDO' })

    const periodos = await servicioConta.listarPeriodos()
    expect(periodos.find((p) => p.id === AGOSTO)!.estado).toBe('abierto')
  })

  it('cierra agosto desde la pantalla, con los avisos confirmados', async () => {
    const usuario = userEvent.setup()
    montar('/conta/periodos')

    const checklist = await screen.findByRole('list', {
      name: 'Checklist de cierre',
    })
    // El periodo activo del contexto es agosto: la pantalla arranca en él.
    expect(
      await screen.findByText(/Checklist de cierre · Agosto 2026/),
    ).toBeInTheDocument()
    expect(
      within(checklist).getByText(
        /La depreciación de Agosto 2026 no está contabilizada/,
      ),
    ).toBeInTheDocument()

    // Sin confirmar los avisos, el botón está apagado.
    const boton = screen.getByRole('button', { name: 'Cerrar periodo' })
    expect(boton).toBeDisabled()

    await usuario.click(screen.getByLabelText(/He revisado los .* avisos?/))
    // Con la casilla marcada pero sin motivo tampoco: la autorización es la
    // casilla y el motivo juntos, porque lo que queda registrado es el motivo.
    expect(boton).toBeDisabled()

    await usuario.type(
      screen.getByLabelText(/Motivo del cierre con avisos/),
      MOTIVO,
    )
    expect(boton).toBeEnabled()
    await usuario.click(boton)

    expect(
      await screen.findByText('Agosto 2026 quedó cerrado'),
    ).toBeInTheDocument()
    // La bitácora queda en el periodo y se lee en la pantalla.
    expect(await screen.findByText(new RegExp(MOTIVO))).toBeInTheDocument()

    const periodos = await servicioConta.listarPeriodos()
    const agosto = periodos.find((p) => p.id === AGOSTO)!
    expect(agosto.estado).toBe('cerrado')
    expect(agosto.motivoCierre).toBe(MOTIVO)
    expect(agosto.cerradoPor).toBe('demo@contikos.cr')
    expect(agosto.cerradoEn).not.toBeNull()
  })

  it('el periodo recién cerrado ya no admite asientos', async () => {
    await expect(
      servicioConta.contabilizarAsiento({
        fecha: '2026-08-20',
        concepto: 'Ajuste tardío de agosto',
        moneda: 'CRC',
        tipoCambio: '1.00',
        lineas: [
          { cuenta: '6.1.02.004', cargo: '1000.00', abono: '0.00' },
          { cuenta: '1.1.01.002', cargo: '0.00', abono: '1000.00' },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'PERIODO_CERRADO' })
  })

  it('reabre el cerrado y nunca el bloqueado', async () => {
    await expect(
      servicioConta.reabrirPeriodo(JUNIO),
    ).rejects.toMatchObject({ codigo: 'PERIODO_NO_REABRIBLE' })

    const agosto = await servicioConta.reabrirPeriodo(AGOSTO)
    expect(agosto.estado).toBe('abierto')
    // La bitácora del cierre no se borra: dice que ese cierre ocurrió, no que
    // el periodo esté cerrado hoy.
    expect(agosto.motivoCierre).toBe(MOTIVO)

    // Y el mes vuelve a admitir asientos.
    const asiento = await servicioConta.contabilizarAsiento({
      fecha: '2026-08-20',
      concepto: 'Ajuste de agosto tras la reapertura',
      moneda: 'CRC',
      tipoCambio: '1.00',
      lineas: [
        { cuenta: '6.1.02.004', cargo: '1000.00', abono: '0.00' },
        { cuenta: '1.1.01.002', cargo: '0.00', abono: '1000.00' },
      ],
    })
    expect(asiento.ejercicio).toBe(2026)
  })
})

describe('Balanza comparativa', () => {
  it('cruza dos periodos y la variación cuadra contra las dos balanzas', async () => {
    const [julio, agosto, comparativa] = await Promise.all([
      servicioConta.obtenerBalanza(JULIO, 'fiscal'),
      servicioConta.obtenerBalanza(AGOSTO, 'fiscal'),
      servicioConta.obtenerBalanzaComparativa(JULIO, AGOSTO, 'fiscal'),
    ])

    expect(comparativa.periodoA.id).toBe(JULIO)
    expect(comparativa.periodoB.id).toBe(AGOSTO)
    expect(comparativa.libro).toBe('fiscal')

    // Cada renglón dice lo mismo que las balanzas de las que sale: la
    // comparativa no recalcula saldos, los cruza.
    for (const renglon of comparativa.renglones) {
      const enA = julio.renglones.find((r) => r.codigo === renglon.codigo)
      const enB = agosto.renglones.find((r) => r.codigo === renglon.codigo)
      expect(renglon.saldoA).toBe(enA?.saldoFinal ?? '0.00')
      expect(renglon.saldoB).toBe(enB?.saldoFinal ?? '0.00')
      expect(renglon.variacion).toBe(
        new Decimal(renglon.saldoB).minus(renglon.saldoA).toFixed(2),
      )
    }

    // Papelería solo se movió en agosto: nace en el comparativo, así que su
    // variación es su saldo entero y no hay porcentaje que calcular.
    const papeleria = comparativa.renglones.find(
      (r) => r.codigo === '6.1.02.004',
    )!
    expect(papeleria.saldoA).toBe('0.00')
    expect(new Decimal(papeleria.variacion).greaterThan(0)).toBe(true)
    expect(papeleria.variacionPorcentual).toBeNull()

    // Y una cuenta con saldo en los dos meses sí lo tiene.
    const conBase = comparativa.renglones.find(
      (r) => r.variacionPorcentual !== null,
    )!
    expect(conBase.variacionPorcentual).toMatch(/^-?\d+\.\d{2}$/)
  })

  it('la pantalla pasa a columnas comparativas y vuelve al encender y apagar', async () => {
    const usuario = userEvent.setup()
    montar('/conta/balanza')

    // Apagado, la balanza de siempre.
    expect(await screen.findByText('Saldo inicial')).toBeInTheDocument()
    expect(screen.getByText('La balanza cuadra')).toBeInTheDocument()

    await usuario.click(screen.getByLabelText('Comparar con'))

    // Encendido, las cuatro columnas del comparativo. Se propone el periodo
    // anterior, que es la comparación que se pide casi siempre.
    await waitFor(() =>
      expect(screen.getByLabelText('Periodo de comparación')).toHaveValue(JULIO),
    )
    expect(await screen.findByText('Variación')).toBeInTheDocument()
    expect(screen.getByText('%')).toBeInTheDocument()
    expect(screen.getAllByText('Agosto 2026').length).toBeGreaterThan(0)
    expect(screen.queryByText('Saldo inicial')).toBeNull()

    // El filtro de solo detalle sigue funcionando en el modo comparativo.
    const antes = screen.getAllByRole('row').length
    await usuario.click(screen.getByLabelText('Solo cuentas de detalle'))
    await waitFor(() =>
      expect(screen.getAllByRole('row').length).toBeLessThan(antes),
    )

    // Apagado, la pantalla es exactamente la de antes.
    await usuario.click(screen.getByLabelText('Comparar con'))
    expect(await screen.findByText('Saldo inicial')).toBeInTheDocument()
    expect(screen.queryByText('Variación')).toBeNull()
  })
})
