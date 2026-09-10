import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { setupServer } from 'msw/node'
import { handlers } from '@/mocks/handlers'
import { servicioBancos, servicioConta } from '@/shared/api/servicios'
import { restablecerMonedas } from '@/shared/money/money'

/**
 * Tesorería de punta a punta (docs/06).
 *
 * Recorre el ciclo entero del módulo: se captura una comisión que genera su
 * asiento, se importa el estado de cuenta del banco, se empareja lo que el
 * motor propone y se intenta cerrar la conciliación.
 *
 * Lo que comprueba, y que es lo que el módulo existe para garantizar:
 *
 * - **El auxiliar de bancos cuadra contra el mayor** (docs/06 §4). El saldo de
 *   la cuenta bancaria y el de su cuenta de control tienen que ser el mismo
 *   número, siempre, y esa es la verificación de integridad del módulo.
 * - **Importar no contabiliza nada.** El mayor no se mueve al cargar un estado
 *   de cuenta, por buenas que parezcan sus líneas.
 * - **No se cierra con diferencia.** Un cargo del banco que la empresa no
 *   registró impide cerrar hasta que se capture y se contabilice.
 *
 * Va en su propio archivo porque muta el estado del mock: después de conciliar,
 * los saldos que esperan las otras pruebas ya no son los de la semilla.
 */

const servidor = setupServer(...handlers)

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  servidor.resetHandlers()
  restablecerMonedas()
})
afterAll(() => servidor.close())

/** La cuenta en colones de la demo y su cuenta de control en el mayor. */
const CUENTA = 'bco-001'
const CONTROL = '1.1.01.010'
const AGOSTO = 'per-2026-08'

/** Agosto de 2026 está abierto en la semilla. */
const FECHA = '2026-08-20'

/**
 * Saldo de la cuenta de control en el mayor, sumando el libro fiscal.
 *
 * Es la otra mitad de la verificación de integridad: el auxiliar de bancos
 * tiene que decir exactamente esto.
 */
async function saldoEnElMayor(): Promise<string> {
  const balanza = await servicioConta.obtenerBalanza(AGOSTO, 'fiscal')
  const renglon = balanza.renglones.find((r) => r.codigo === CONTROL)
  return renglon?.saldoFinal ?? '0.00'
}

async function saldoDelAuxiliar(): Promise<string> {
  const cuentas = await servicioBancos.listarCuentas()
  return cuentas.find((c) => c.id === CUENTA)!.saldoLibros
}

describe('Auxiliar de bancos contra el mayor', () => {
  it('arranca cuadrado con el libro de la demostración', async () => {
    // Los movimientos de la semilla se derivan del propio mayor: si esto falla,
    // el módulo nace descuadrado y nada de lo que venga después significa nada.
    expect(await saldoDelAuxiliar()).toBe(await saldoEnElMayor())
  })
})

describe('Movimientos que nacen en tesorería', () => {
  it('la comisión genera su asiento y mueve el auxiliar', async () => {
    const antes = new Decimal(await saldoDelAuxiliar())

    const resultado = await servicioBancos.registrarComision({
      cuentaBancariaId: CUENTA,
      fecha: FECHA,
      concepto: 'Comisión por transferencias del mes',
      referencia: 'COM-0820',
      importe: '9000',
      impuesto: '1170',
      tipoCambio: '1',
    })

    expect(resultado.movimientos).toHaveLength(1)
    expect(resultado.movimientos[0].tipo).toBe('comision')
    // El signo lo pone el módulo: quien captura teclea lo que le cobraron.
    expect(resultado.movimientos[0].importe).toBe('-10170.00')

    const asiento = await servicioConta.obtenerAsiento(resultado.asientoId)
    expect(asiento.origenModulo).toBe('bancos')
    expect(asiento.origenTipo).toBe('comision')
    // El impuesto va en su cuenta y no sumado al gasto: es crédito fiscal.
    expect(asiento.lineas).toHaveLength(3)
    expect(
      asiento.lineas.find((l) => l.cuentaCodigo === '1.1.03.001')?.cargo,
    ).toBe('1170.00')

    const despues = new Decimal(await saldoDelAuxiliar())
    expect(despues.toFixed(2)).toBe(antes.minus(10170).toFixed(2))
    // Y lo que importa: el auxiliar sigue diciendo lo mismo que el mayor.
    expect(await saldoDelAuxiliar()).toBe(await saldoEnElMayor())
  })
})

describe('Importación del estado de cuenta', () => {
  it('importa el archivo sin tocar el mayor y deduplica al recargarlo', async () => {
    const [formato] = await servicioBancos.formatos()
    expect(formato.ejemplo).not.toBeNull()

    const saldoAntes = await saldoEnElMayor()

    const primera = await servicioBancos.importarEstadoCuenta({
      cuentaBancariaId: CUENTA,
      formato: formato.id,
      contenido: formato.ejemplo!,
      archivo: 'estado-agosto.csv',
    })

    expect(primera.importadas).toBeGreaterThan(0)
    expect(primera.duplicadas).toBe(0)
    expect(primera.rechazadas).toHaveLength(0)
    // Importar es leer, no contabilizar: el mayor no se ha movido.
    expect(await saldoEnElMayor()).toBe(saldoAntes)

    // Recargar el mismo archivo es lo que pasa de verdad cuando se traslapan
    // fechas entre descargas. No puede producir movimientos repetidos.
    const segunda = await servicioBancos.importarEstadoCuenta({
      cuentaBancariaId: CUENTA,
      formato: formato.id,
      contenido: formato.ejemplo!,
      archivo: 'estado-agosto.csv',
    })
    expect(segunda.importadas).toBe(0)
    expect(segunda.duplicadas).toBe(primera.importadas)
  })
})

describe('Conciliación', () => {
  const corte = '2026-08-31'

  it('propone emparejamientos y los aplica', async () => {
    const antes = await servicioBancos.conciliacion({
      cuentaBancariaId: CUENTA,
      fechaCorte: corte,
    })
    expect(antes.sugerencias.length).toBeGreaterThan(0)

    // La regla 1 es la que casa el cobro de julio: comparten la referencia de
    // la transferencia, que es lo que el banco imprime en su estado de cuenta.
    expect(antes.sugerencias.some((s) => s.regla === 'referencia_importe')).toBe(
      true,
    )

    let resumen = antes
    for (const sugerencia of antes.sugerencias.filter(
      (s) => !s.requiereConfirmacion,
    )) {
      resumen = await servicioBancos.emparejar({
        cuentaBancariaId: CUENTA,
        movimientosPropios: sugerencia.movimientosPropios,
        movimientoBanco: sugerencia.movimientoBanco,
        regla: sugerencia.regla,
      })
    }

    expect(resumen.bancoSinConciliar.length).toBeLessThan(
      antes.bancoSinConciliar.length,
    )
  })

  it('no deja cerrar mientras haya un cargo del banco sin registrar', async () => {
    // El ejemplo trae un servicio de banca en línea que la empresa nunca
    // registró. Eso no se ajusta: se captura y se contabiliza.
    const resumen = await servicioBancos.conciliacion({
      cuentaBancariaId: CUENTA,
      fechaCorte: corte,
    })

    const sinRegistrar = resumen.partidas.filter((p) => p.exigeAccion)
    expect(sinRegistrar.length).toBeGreaterThan(0)
    expect(resumen.puedeCerrar).toBe(false)

    await expect(
      servicioBancos.cerrarConciliacion({
        cuentaBancariaId: CUENTA,
        fechaCorte: corte,
        saldoBanco: resumen.saldoBanco ?? '0',
      }),
    ).rejects.toThrow()
  })

  it('deshace un emparejamiento, que es siempre reversible', async () => {
    const conciliadas = (
      await servicioBancos.listarEstadoCuenta({ cuentaBancariaId: CUENTA })
    ).filter((l) => l.conciliacionId?.startsWith('emp-'))
    expect(conciliadas.length).toBeGreaterThan(0)

    const resumen = await servicioBancos.deshacerEmparejamiento(
      conciliadas[0].id,
    )
    expect(
      resumen.bancoSinConciliar.some((l) => l.id === conciliadas[0].id),
    ).toBe(true)
  })
})
