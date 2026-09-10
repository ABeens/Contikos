import { http, HttpResponse } from 'msw'
import { rutaApi } from '@/shared/api/entorno'
import { latencia } from '../latencia'
import { hoyISO } from '@/shared/format/fecha'
import type {
  Conciliacion,
  MovimientoEstadoCuenta,
  ResultadoImportacion,
  ResumenConciliacion,
} from '@/shared/api/contracts/bancos'
import {
  SolicitudCierreConciliacionSchema,
  SolicitudEmparejamientoSchema,
  SolicitudImportacionSchema,
} from '@/shared/api/contracts/bancos'
import {
  formatosDisponibles,
  huellaDe,
  parserPorId,
  saldoFinalDe,
  separarDuplicados,
} from '@/modules/bancos/domain/importacion'
import {
  calcularConciliacion,
  siguienteIdConciliacion,
  validarEmparejamiento,
} from '@/modules/bancos/domain/conciliacion'
import {
  EJEMPLO_ESTADO_CUENTA,
  conciliacionesMock,
  cuentasBancariasMock,
  estadoCuentaMock,
  movimientosBancariosMock,
  persistirConciliaciones,
  persistirCuentasBancarias,
  persistirEstadoCuenta,
  persistirMovimientosBancarios,
} from '../seed/bancos'
import { cuentasBancariasServidas } from './bancos'

/**
 * Mock del estado de cuenta y de la conciliación (docs/06 §2.2 y §2.3).
 *
 * Vive aparte del resto de tesorería porque es el otro lado del módulo: aquí no
 * se registra lo que la empresa hizo, sino lo que el banco dice, y el trabajo
 * consiste en explicar la diferencia.
 *
 * Las dos reglas que este archivo hace cumplir, y que no son del dominio:
 *
 * - **Importar no toca el mayor.** Ni una línea del estado de cuenta se
 *   contabiliza al importarla. Lo que el banco movió y la empresa no registró
 *   se resuelve capturando el movimiento propio que falta, que sí emite su
 *   asiento. Contabilizar desde el archivo convertiría el estado de cuenta en
 *   la fuente de la contabilidad, que es lo contrario de conciliar.
 * - **Emparejar tampoco.** Casar dos registros no es un hecho económico: es
 *   reconocer que los dos describían el mismo, y por eso es reversible mientras
 *   la conciliación no se cierre.
 */

const cuentas = cuentasBancariasMock
const movimientos = movimientosBancariosMock
const estadoCuenta = estadoCuentaMock
const conciliaciones = conciliacionesMock

function errorApi(codigo: string, mensaje: string, detalles: string[] = []) {
  return HttpResponse.json({ codigo, mensaje, detalles }, { status: 422 })
}

function noEncontrado(codigo: string, mensaje: string) {
  return HttpResponse.json({ codigo, mensaje }, { status: 404 })
}

/* ------------------------------------------------- Estado de cuenta */

const handlersEstadoCuenta = [
  http.get(rutaApi('/bancos/formatos'), async () => {
    await latencia(60)
    // El CSV genérico viaja con un archivo de muestra construido sobre los
    // movimientos de la demostración, para poder recorrer la conciliación
    // entera sin tener delante un estado de cuenta de verdad.
    return HttpResponse.json(
      formatosDisponibles().map((f) =>
        f.id === 'csv_generico'
          ? { ...f, ejemplo: EJEMPLO_ESTADO_CUENTA }
          : f,
      ),
    )
  }),

  http.get(rutaApi('/bancos/estado-cuenta'), async ({ request }) => {
    await latencia(140)
    const params = new URL(request.url).searchParams
    const cuentaBancariaId = params.get('cuentaBancariaId')
    const soloSinConciliar = params.get('sinConciliar') === 'true'

    const resultado = estadoCuenta
      .filter((m) => !cuentaBancariaId || m.cuentaBancariaId === cuentaBancariaId)
      .filter((m) => !soloSinConciliar || m.conciliacionId === null)
      .sort(
        (a, b) =>
          b.fechaOperacion.localeCompare(a.fechaOperacion) ||
          b.id.localeCompare(a.id),
      )

    return HttpResponse.json(resultado)
  }),

  http.post(rutaApi('/bancos/estado-cuenta'), async ({ request }) => {
    await latencia(500)

    const parsed = SolicitudImportacionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = parsed.data
    const cuenta = cuentas.find((c) => c.id === solicitud.cuentaBancariaId)
    if (!cuenta) {
      return noEncontrado(
        'CUENTA_BANCARIA_NO_ENCONTRADA',
        'La cuenta bancaria no existe',
      )
    }

    const parser = parserPorId(solicitud.formato)
    if (!parser) {
      return errorApi(
        'FORMATO_DESCONOCIDO',
        `No hay ningún lector para el formato ${solicitud.formato}`,
      )
    }

    const parseo = parser.parsear(solicitud.contenido)
    const { nuevas, duplicadas } = separarDuplicados(
      cuenta.id,
      parseo.filas,
      estadoCuenta,
    )

    const importados: MovimientoEstadoCuenta[] = nuevas.map((fila, i) => ({
      id: `ecu-${String(estadoCuenta.length + i + 1).padStart(6, '0')}`,
      cuentaBancariaId: cuenta.id,
      fechaOperacion: fila.fechaOperacion,
      fechaValor: fila.fechaValor,
      descripcion: fila.descripcion,
      referencia: fila.referencia,
      cargo: fila.cargo,
      abono: fila.abono,
      saldo: fila.saldo,
      origenCarga: 'archivo',
      conciliacionId: null,
      huella: huellaDe(cuenta.id, fila),
      importadoEn: new Date().toISOString(),
    }))

    estadoCuenta.push(...importados)
    persistirEstadoCuenta()

    const fechas = importados.map((m) => m.fechaOperacion).sort()
    const saldoFinal = saldoFinalDe(nuevas)

    /*
     * El saldo del banco queda en la ficha de la cuenta.
     *
     * Es lo único que la importación escribe fuera de su propia tabla, y no es
     * un saldo contable: es el dato contra el que la conciliación cuadra. Solo
     * avanza, nunca retrocede, porque importar un archivo viejo después de uno
     * reciente no puede hacer que la cuenta diga menos de lo que su último
     * estado de cuenta ya dijo.
     */
    if (saldoFinal !== null && fechas.length > 0) {
      const hasta = fechas[fechas.length - 1]
      if (cuenta.saldoBancoAl === null || hasta >= cuenta.saldoBancoAl) {
        cuenta.saldoBanco = saldoFinal
        cuenta.saldoBancoAl = hasta
        persistirCuentasBancarias()
      }
    }

    const resultado: ResultadoImportacion = {
      cuentaBancariaId: cuenta.id,
      formato: parser.id,
      leidas: parseo.leidas,
      importadas: importados.length,
      duplicadas: duplicadas.length,
      rechazadas: [...parseo.rechazadas],
      desde: fechas[0] ?? null,
      hasta: fechas[fechas.length - 1] ?? null,
      saldoFinal,
      movimientos: importados,
    }
    return HttpResponse.json(resultado, { status: 201 })
  }),
]

/* ---------------------------------------------------- Conciliación */

function resumenDe(
  cuentaBancariaId: string,
  fechaCorte: string,
  saldoBanco: string | null,
): ResumenConciliacion | null {
  const cuenta = cuentasBancariasServidas().find(
    (c) => c.id === cuentaBancariaId,
  )
  if (!cuenta) return null

  return calcularConciliacion({
    cuenta,
    movimientos,
    lineasBanco: estadoCuenta,
    fechaCorte,
    // Lo capturado manda sobre lo importado: quien concilia tiene el estado de
    // cuenta delante, y el archivo puede no traer la columna de saldo.
    saldoBanco: saldoBanco ?? cuenta.saldoBanco,
  })
}

const handlersConciliacion = [
  http.get(rutaApi('/bancos/conciliacion'), async ({ request }) => {
    await latencia(200)
    const params = new URL(request.url).searchParams
    const resumen = resumenDe(
      params.get('cuentaBancariaId') ?? '',
      params.get('fechaCorte') ?? hoyISO(),
      params.get('saldoBanco'),
    )
    return resumen
      ? HttpResponse.json(resumen)
      : noEncontrado(
          'CUENTA_BANCARIA_NO_ENCONTRADA',
          'La cuenta bancaria no existe',
        )
  }),

  http.get(rutaApi('/bancos/conciliaciones'), async ({ request }) => {
    await latencia(120)
    const cuentaBancariaId = new URL(request.url).searchParams.get(
      'cuentaBancariaId',
    )
    return HttpResponse.json(
      conciliaciones
        .filter(
          (c) => !cuentaBancariaId || c.cuentaBancariaId === cuentaBancariaId,
        )
        .sort((a, b) => b.fechaCorte.localeCompare(a.fechaCorte)),
    )
  }),

  /**
   * Casa uno o varios movimientos propios con una línea del banco.
   *
   * Marcar los dos lados es lo que hace la conciliación: a partir de aquí ni el
   * movimiento propio es una partida en tránsito ni la línea del banco es un
   * movimiento sin registrar.
   */
  http.post(
    rutaApi('/bancos/conciliacion/emparejamientos'),
    async ({ request }) => {
      await latencia(250)

      const parsed = SolicitudEmparejamientoSchema.safeParse(
        await request.json(),
      )
      if (!parsed.success) {
        return errorApi(
          'SOLICITUD_INVALIDA',
          'La solicitud no cumple el contrato',
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        )
      }

      const solicitud = parsed.data
      const validacion = validarEmparejamiento(
        solicitud.cuentaBancariaId,
        solicitud.movimientosPropios,
        solicitud.movimientoBanco,
        movimientos,
        estadoCuenta,
      )
      if (!validacion.valido) {
        return errorApi(
          validacion.errores[0].codigo,
          validacion.errores[0].mensaje,
          validacion.errores.map((e) => e.mensaje),
        )
      }

      // Mientras la conciliación no se cierre, la marca es el propio id de la
      // línea del banco: agrupa los dos lados y permite deshacerlo, que es lo
      // que el diseño pide que siempre se pueda (docs/06 §2.3).
      const marca = `emp-${solicitud.movimientoBanco}`
      for (const id of solicitud.movimientosPropios) {
        const movimiento = movimientos.find((m) => m.id === id)!
        movimiento.estado = 'conciliado'
        movimiento.conciliacionId = marca
      }
      const linea = estadoCuenta.find((l) => l.id === solicitud.movimientoBanco)!
      linea.conciliacionId = marca

      persistirMovimientosBancarios()
      persistirEstadoCuenta()

      // El corte del resumen que se devuelve es la fecha de la línea recién
      // casada o la de hoy, la mayor de las dos: así incluye siempre lo que se
      // acaba de hacer, aunque el estado de cuenta traiga fechas futuras.
      const corte =
        linea.fechaOperacion > hoyISO() ? linea.fechaOperacion : hoyISO()
      return HttpResponse.json(
        resumenDe(solicitud.cuentaBancariaId, corte, null)!,
      )
    },
  ),

  http.delete(
    rutaApi('/bancos/conciliacion/emparejamientos/:id'),
    async ({ params }) => {
      await latencia(200)

      const linea = estadoCuenta.find((l) => l.id === params.id)
      if (!linea || linea.conciliacionId === null) {
        return noEncontrado(
          'EMPAREJAMIENTO_NO_ENCONTRADO',
          'Esa línea del estado de cuenta no está emparejada',
        )
      }

      const marca = linea.conciliacionId
      if (conciliaciones.some((c) => c.id === marca)) {
        // Una conciliación cerrada es una foto que alguien firmó: deshacer algo
        // dentro de ella sería cambiar lo que ya se dio por bueno.
        return errorApi(
          'CONCILIACION_CERRADA',
          'El emparejamiento pertenece a una conciliación ya cerrada',
        )
      }

      for (const movimiento of movimientos) {
        if (movimiento.conciliacionId !== marca) continue
        movimiento.estado = 'registrado'
        movimiento.conciliacionId = null
      }
      linea.conciliacionId = null

      persistirMovimientosBancarios()
      persistirEstadoCuenta()

      const corte =
        linea.fechaOperacion > hoyISO() ? linea.fechaOperacion : hoyISO()
      return HttpResponse.json(resumenDe(linea.cuentaBancariaId, corte, null)!)
    },
  ),

  /**
   * Cierra la conciliación de una cuenta a una fecha de corte.
   *
   * Solo con diferencia cero, y esa es la regla del módulo (docs/06 §2.3): una
   * conciliación que se pudiera cerrar con diferencia no conciliaría nada, solo
   * archivaría el descuadre donde ya nadie lo mira.
   */
  http.post(rutaApi('/bancos/conciliacion/cierre'), async ({ request }) => {
    await latencia(450)

    const parsed = SolicitudCierreConciliacionSchema.safeParse(
      await request.json(),
    )
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const { cuentaBancariaId, fechaCorte, saldoBanco } = parsed.data
    const resumen = resumenDe(cuentaBancariaId, fechaCorte, saldoBanco)
    if (!resumen) {
      return noEncontrado(
        'CUENTA_BANCARIA_NO_ENCONTRADA',
        'La cuenta bancaria no existe',
      )
    }

    if (!resumen.puedeCerrar) {
      return errorApi(
        'CONCILIACION_CON_DIFERENCIA',
        resumen.impedimentos[0] ?? 'La conciliación no cuadra',
        resumen.impedimentos,
      )
    }

    const id = siguienteIdConciliacion(conciliaciones)
    const propios = movimientos.filter(
      (m) =>
        m.cuentaBancariaId === cuentaBancariaId &&
        m.fecha <= fechaCorte &&
        m.estado === 'conciliado',
    )
    const lineas = estadoCuenta.filter(
      (l) =>
        l.cuentaBancariaId === cuentaBancariaId &&
        l.fechaOperacion <= fechaCorte &&
        l.conciliacionId !== null,
    )

    // Lo conciliado pasa a llevar el id de la conciliación cerrada: es lo que
    // convierte una marca provisional y reversible en parte de una foto firmada.
    for (const movimiento of propios) movimiento.conciliacionId = id
    for (const linea of lineas) linea.conciliacionId = id

    const conciliacion: Conciliacion = {
      id,
      cuentaBancariaId,
      fechaCorte,
      saldoBanco: resumen.saldoBanco!,
      saldoLibros: resumen.saldoLibros,
      diferencia: '0.00',
      partidas: resumen.partidas,
      movimientosPropios: propios.length,
      movimientosBanco: lineas.length,
      cerradaEn: new Date().toISOString(),
      // Usuario de demostración fijo: la autenticación es lo único de la fase 0
      // del roadmap que sigue sin empezar (docs/11).
      cerradaPor: 'demo@contikos.cr',
    }

    conciliaciones.push(conciliacion)
    persistirConciliaciones()
    persistirMovimientosBancarios()
    persistirEstadoCuenta()

    return HttpResponse.json(conciliacion, { status: 201 })
  }),
]

export const handlersBancosConciliacion = [
  ...handlersEstadoCuenta,
  ...handlersConciliacion,
]
