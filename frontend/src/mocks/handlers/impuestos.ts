import { http, HttpResponse } from 'msw'
import { rutaApi } from '@/shared/api/entorno'
import { latencia } from '../latencia'
import {
  SolicitudTarifaImpuestoSchema,
  type TarifaImpuesto,
} from '@/shared/api/contracts/impuestos'
import {
  normalizarCodigoTarifa,
  validarEliminacionTarifa,
  validarTarifaImpuesto,
  type ResultadoImpuesto,
} from '@/modules/config/domain/impuesto'
import {
  persistirTarifasImpuesto,
  siguienteIdTarifa,
  tarifasImpuestoMock,
  tarifasVigentes,
} from '../seed/impuestos'
import { facturasVentaMock } from '../seed/cxc'
import { facturasCompraMock } from '../seed/cxp'

/**
 * Mock de la tabla de impuestos (docs/13 §3).
 *
 * Aplica las mismas reglas que aplicará la API reutilizando el dominio del
 * módulo: código único por tipo y vigencia, porcentaje entre 0 y 100, y
 * ninguna fila se borra si hay facturas calculadas con ella.
 */

const tarifas = tarifasImpuestoMock

function solicitudInvalida(detalles: string[]) {
  return HttpResponse.json(
    {
      codigo: 'SOLICITUD_INVALIDA',
      mensaje: 'La solicitud no cumple el contrato',
      detalles,
    },
    { status: 422 },
  )
}

function rechazar(resultado: ResultadoImpuesto) {
  const principal = resultado.errores[0]
  return HttpResponse.json(
    {
      codigo: principal.codigo,
      mensaje: principal.mensaje,
      detalles: resultado.errores.map((e) => e.mensaje),
    },
    { status: 422 },
  )
}

function noEncontrada() {
  return HttpResponse.json(
    { codigo: 'TARIFA_NO_ENCONTRADA', mensaje: 'La tarifa no existe' },
    { status: 404 },
  )
}

/** Orden estable para la pantalla: por tipo, código y vigencia. */
function ordenadas(lista: readonly TarifaImpuesto[]): TarifaImpuesto[] {
  return [...lista].sort(
    (a, b) =>
      a.tipo.localeCompare(b.tipo) ||
      a.codigo.localeCompare(b.codigo) ||
      a.vigenteDesde.localeCompare(b.vigenteDesde),
  )
}

/** Todas las facturas, de venta y de compra: las dos citan tarifas. */
function documentos() {
  return [...facturasVentaMock, ...facturasCompraMock]
}

export const handlersImpuestos = [
  /**
   * GET /config/impuestos?fecha=yyyy-MM-dd
   *
   * Con fecha, solo las que rigen ese día: es lo que la captura de una
   * factura necesita. Sin fecha, la tabla entera, que es lo que mantiene la
   * pantalla de configuración.
   */
  http.get(rutaApi('/config/impuestos'), async ({ request }) => {
    await latencia(80)
    const fecha = new URL(request.url).searchParams.get('fecha')
    return HttpResponse.json(ordenadas(fecha ? tarifasVigentes(fecha) : tarifas))
  }),

  http.post(rutaApi('/config/impuestos'), async ({ request }) => {
    await latencia(250)

    const parsed = SolicitudTarifaImpuestoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return solicitudInvalida(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = {
      ...parsed.data,
      codigo: normalizarCodigoTarifa(parsed.data.codigo),
      nombre: parsed.data.nombre.trim(),
    }
    const resultado = validarTarifaImpuesto(solicitud, { tarifas })
    if (!resultado.valido) return rechazar(resultado)

    const nueva: TarifaImpuesto = {
      ...solicitud,
      id: siguienteIdTarifa(solicitud.codigo, solicitud.vigenteDesde),
    }
    tarifas.push(nueva)
    persistirTarifasImpuesto()
    return HttpResponse.json(nueva, { status: 201 })
  }),

  http.put(rutaApi('/config/impuestos/:id'), async ({ params, request }) => {
    await latencia(250)

    const id = String(params.id)
    const indice = tarifas.findIndex((t) => t.id === id)
    if (indice === -1) return noEncontrada()

    const parsed = SolicitudTarifaImpuestoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return solicitudInvalida(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = {
      ...parsed.data,
      codigo: normalizarCodigoTarifa(parsed.data.codigo),
      nombre: parsed.data.nombre.trim(),
    }
    const resultado = validarTarifaImpuesto(solicitud, {
      tarifas,
      tarifa: tarifas[indice],
    })
    if (!resultado.valido) return rechazar(resultado)

    // Las facturas ya emitidas guardan sus importes calculados: cambiar el
    // porcentaje de aquí en adelante no las toca, y cambiarlo hacia atrás es
    // una decisión del usuario que la pantalla advierte.
    const actualizada: TarifaImpuesto = { ...solicitud, id }
    tarifas[indice] = actualizada
    persistirTarifasImpuesto()
    return HttpResponse.json(actualizada)
  }),

  http.delete(rutaApi('/config/impuestos/:id'), async ({ params }) => {
    await latencia(250)

    const id = String(params.id)
    const resultado = validarEliminacionTarifa(id, {
      tarifas,
      documentos: documentos(),
    })
    if (!resultado.valido) {
      return resultado.errores[0].codigo === 'TARIFA_NO_ENCONTRADA'
        ? noEncontrada()
        : rechazar(resultado)
    }

    tarifas.splice(
      tarifas.findIndex((t) => t.id === id),
      1,
    )
    persistirTarifasImpuesto()
    return new HttpResponse(null, { status: 204 })
  }),
]
