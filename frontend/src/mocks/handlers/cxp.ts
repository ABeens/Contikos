import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import { rutaApi } from '@/shared/api/entorno'
import { latencia } from '../latencia'
import type {
  AplicacionPago,
  FacturaCompra,
  LineaFacturaCompra,
  Pago,
  Proveedor,
  ProveedorBase,
} from '@/shared/api/contracts/cxp'
import {
  SolicitudAnulacionPagoSchema,
  SolicitudFacturaCompraSchema,
  SolicitudPagoSchema,
  SolicitudProveedorSchema,
} from '@/shared/api/contracts/cxp'
import { SolicitudAdjuntoSchema } from '@/shared/api/contracts/comunes'
import type { SolicitudAsiento } from '@/shared/api/contracts/conta'
import { Money, monedaFuncional } from '@/shared/money/money'
import { normalizarIdentificacion } from '@/shared/fiscal/identificacion'
import { normalizarTelefono } from '@/shared/fiscal/contacto'
import {
  calcularLineasCompra,
  claveFolio,
  lineasAsientoFacturaCompra,
  resolutorDeContextoCompra,
  totalesCompraDe,
  validarFacturaCompra,
  type ContextoFacturaCompra,
} from '@/modules/cxp/domain/factura'
import {
  antiguedadDeFacturas,
  facturasPendientesDe,
  saldoDeProveedor,
} from '@/modules/cxp/domain/antiguedad'
import {
  armarAsientoPago,
  calcularPago,
  calcularPropuestaPago,
  type ContextoPago,
} from '@/modules/cxp/domain/pago'
import { validarProveedor } from '@/modules/cxp/domain/proveedor'
import { validarAdjunto } from '@/modules/cxp/domain/adjunto'
import { CUENTAS } from '../seed/cuentas'
import { PERIODOS } from '../seed/periodos'
import { tarifasImpuestoMock } from '../seed/impuestos'
import {
  adjuntosCompraMock,
  facturasCompraMock,
  MAPEO_CXP,
  metadatosDeAdjunto,
  pagosCompraMock,
  persistirAdjuntosCompra,
  persistirFacturasCompra,
  persistirPagos,
  persistirProveedores,
  proveedoresMock,
  siguienteFolioInterno,
  siguienteFolioPago,
  siguienteIdAdjunto,
  type AdjuntoAlmacenado,
} from '../seed/cxp'
import { asientosMock, emitirAsiento, reversarAsiento } from './conta'
import {
  cuentasBancariasServidas,
  eliminarMovimientoExterno,
  registrarMovimientoExterno,
} from './bancos'
import {
  categoriaPorId,
  categoriasServidas,
  descartarActivo,
  registrarActivoDeCompra,
} from './activos'

/**
 * Mock de CxP.
 *
 * Registrar la factura de gasto hace tres cosas en una sola operación: crea el
 * documento, crea la cuenta por pagar del proveedor y contabiliza. Si además
 * alguna línea se capitaliza, crea también la ficha del activo (docs/07 §3.1).
 *
 * Las cuatro van juntas o no va ninguna: cuando el asiento se rechaza, se
 * deshacen los activos que se habían dado de alta y la factura no se guarda.
 */

const facturas = facturasCompraMock
const proveedores = proveedoresMock
const adjuntos = adjuntosCompraMock
const pagos = pagosCompraMock

function errorApi(codigo: string, mensaje: string, detalles: string[] = []) {
  return HttpResponse.json({ codigo, mensaje, detalles }, { status: 422 })
}

function noEncontrado(codigo: string, mensaje: string) {
  return HttpResponse.json({ codigo, mensaje }, { status: 404 })
}

function serializar(proveedor: ProveedorBase): Proveedor {
  const funcional = monedaFuncional()
  return {
    ...proveedor,
    saldo: saldoDeProveedor(facturas, proveedor.id, funcional).toApi(),
    facturasPendientes: facturasPendientesDe(facturas, proveedor.id),
  }
}

/** Lo que se guarda: identificación y teléfono solo con dígitos. */
function normalizarProveedor(
  datos: Omit<ProveedorBase, 'id'>,
): Omit<ProveedorBase, 'id'> {
  return {
    ...datos,
    codigo: datos.codigo.trim(),
    razonSocial: datos.razonSocial.trim(),
    nombreComercial: datos.nombreComercial?.trim() || null,
    identificacion: normalizarIdentificacion(datos.identificacion),
    telefono: normalizarTelefono(datos.telefono),
    correo: datos.correo?.trim() || null,
    actividadEconomica: datos.actividadEconomica?.trim() || null,
  }
}

function rechazar(errores: readonly { codigo: string; mensaje: string }[]) {
  return errorApi(
    errores[0].codigo,
    errores[0].mensaje,
    errores.map((e) => e.mensaje),
  )
}

function contexto(proveedorId: string): ContextoFacturaCompra {
  const base = proveedores.find((p) => p.id === proveedorId)
  return {
    proveedor: base ? serializar(base) : undefined,
    cuentas: CUENTAS,
    periodos: PERIODOS,
    // El catálogo de categorías es de activos; aquí solo hace falta para
    // validar la capitalización de una línea.
    categorias: categoriasServidas(),
    mapeo: MAPEO_CXP,
    foliosRegistrados: facturas
      .filter((f) => f.estado !== 'cancelada')
      .map((f) => claveFolio(f.proveedorId, f.folioProveedor)),
    tarifas: tarifasImpuestoMock,
  }
}

/**
 * Contexto de un pago: el proveedor, sus facturas y los catálogos.
 *
 * Se arma en cada petición sobre el estado vigente. Es lo que hace que lo que
 * se contabiliza sea lo que el servidor ve ahora y no lo que alguien vio hace
 * diez minutos en otra pestaña: el cliente manda qué aplicar, nunca cuánto
 * saldo tenía la factura.
 */
function contextoPago(proveedorId: string): ContextoPago {
  const base = proveedores.find((p) => p.id === proveedorId)
  return {
    proveedor: base ? serializar(base) : undefined,
    facturas,
    cuentas: CUENTAS,
    cuentasBancarias: cuentasBancariasServidas(),
    periodos: PERIODOS,
    mapeo: MAPEO_CXP,
    monedaFuncional: monedaFuncional(),
  }
}

/** base64 a bytes. `atob` existe en el navegador y en jsdom. */
function decodificarBase64(contenido: string): Uint8Array {
  const binario = atob(contenido.replace(/\s/g, ''))
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i)
  return bytes
}

export const handlersCxp = [
  http.get(rutaApi('/cxp/mapeo'), async () => {
    await latencia(60)
    return HttpResponse.json(MAPEO_CXP)
  }),

  http.get(rutaApi('/cxp/proveedores'), async () => {
    await latencia(120)
    return HttpResponse.json(proveedores.map(serializar))
  }),

  http.post(rutaApi('/cxp/proveedores'), async ({ request }) => {
    await latencia(250)

    const parsed = SolicitudProveedorSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const datos = normalizarProveedor(parsed.data)
    const resultado = validarProveedor(datos, { proveedores })
    if (!resultado.valido) return rechazar(resultado.errores)

    const nuevo: ProveedorBase = {
      ...datos,
      id: `pro-${String(proveedores.length + 1).padStart(3, '0')}`,
    }
    proveedores.push(nuevo)
    persistirProveedores()
    return HttpResponse.json(serializar(nuevo), { status: 201 })
  }),

  http.put(rutaApi('/cxp/proveedores/:id'), async ({ params, request }) => {
    await latencia(250)

    const id = String(params.id)
    const indice = proveedores.findIndex((p) => p.id === id)
    if (indice === -1) {
      return noEncontrado('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe')
    }

    const parsed = SolicitudProveedorSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const datos = normalizarProveedor(parsed.data)
    const resultado = validarProveedor(datos, {
      proveedores,
      proveedor: proveedores[indice],
    })
    if (!resultado.valido) return rechazar(resultado.errores)

    const actualizado: ProveedorBase = { ...datos, id }
    proveedores[indice] = actualizado
    persistirProveedores()
    return HttpResponse.json(serializar(actualizado))
  }),

  http.get(rutaApi('/cxp/facturas'), async ({ request }) => {
    await latencia(150)
    const url = new URL(request.url)
    const proveedorId = url.searchParams.get('proveedorId')
    const pendientes = url.searchParams.get('pendientes') === 'true'

    let resultado = [...facturas]
    if (proveedorId) {
      resultado = resultado.filter((f) => f.proveedorId === proveedorId)
    }
    if (pendientes) {
      resultado = resultado.filter((f) => f.estado === 'contabilizada')
    }

    return HttpResponse.json(
      resultado.sort(
        (a, b) =>
          b.fechaEmision.localeCompare(a.fechaEmision) ||
          b.folioInterno.localeCompare(a.folioInterno),
      ),
    )
  }),

  http.get(rutaApi('/cxp/facturas/:id'), async ({ params }) => {
    await latencia(100)
    const factura = facturas.find((f) => f.id === params.id)
    return factura
      ? HttpResponse.json(factura)
      : noEncontrado('FACTURA_NO_ENCONTRADA', 'La factura no existe')
  }),

  http.get(rutaApi('/cxp/facturas/:id/asiento'), async ({ params }) => {
    await latencia(100)
    const factura = facturas.find((f) => f.id === params.id)
    if (!factura) {
      return noEncontrado('FACTURA_NO_ENCONTRADA', 'La factura no existe')
    }
    const asiento = asientosMock.find((a) => a.id === factura.asientoId)
    return asiento
      ? HttpResponse.json(asiento)
      : noEncontrado('ASIENTO_NO_ENCONTRADO', 'La factura no está contabilizada')
  }),

  http.get(rutaApi('/cxp/antiguedad'), async ({ request }) => {
    await latencia(180)
    const url = new URL(request.url)
    const corte =
      url.searchParams.get('corte') ?? new Date().toISOString().slice(0, 10)
    return HttpResponse.json(
      antiguedadDeFacturas(facturas, corte, monedaFuncional()),
    )
  }),

  http.post(rutaApi('/cxp/facturas'), async ({ request }) => {
    await latencia(400)

    const parsed = SolicitudFacturaCompraSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = parsed.data
    const ctx = contexto(solicitud.proveedorId)
    const resultado = validarFacturaCompra(solicitud, ctx)

    if (!resultado.valido) {
      const principal = resultado.errores[0]
      return errorApi(
        principal.codigo,
        principal.mensaje,
        resultado.errores.map((e) =>
          e.linea === undefined
            ? e.mensaje
            : `Línea ${e.linea + 1}: ${e.mensaje}`,
        ),
      )
    }

    const calculadas = calcularLineasCompra(
      solicitud.lineas,
      solicitud.moneda,
      ctx.proveedor,
      MAPEO_CXP,
      resolutorDeContextoCompra(ctx, solicitud.fechaEmision),
    )
    const totales = totalesCompraDe(
      solicitud.lineas,
      calculadas,
      solicitud.moneda,
      ctx.proveedor,
    )
    const folioInterno = siguienteFolioInterno()
    const id = `fpr-${folioInterno.replace(/\D/g, '')}`

    // Los activos nacen antes que el asiento porque el asiento los necesita:
    // la cuenta de activo fijo es de control y exige su auxiliar (docs/02 §3).
    const activosPorLinea = new Map<number, { id: string; nombre: string }>()
    solicitud.lineas.forEach((linea, indice) => {
      if (!linea.activo) return
      const categoria = categoriaPorId(linea.activo.categoriaId)
      if (!categoria) return
      const activo = registrarActivoDeCompra({
        nombre: linea.activo.nombre,
        descripcion: linea.descripcion,
        categoria,
        fechaAdquisicion: solicitud.fechaEmision,
        fechaInicioDepreciacion: linea.activo.fechaInicioDepreciacion,
        moneda: solicitud.moneda,
        costo: calculadas[indice].base.toApi(),
        ubicacion: linea.activo.ubicacion,
        responsable: linea.activo.responsable,
        numeroSerie: linea.activo.numeroSerie,
        proveedorId: solicitud.proveedorId,
        proveedorNombre: ctx.proveedor?.razonSocial ?? solicitud.proveedorId,
        facturaId: id,
        facturaFolio: solicitud.folioProveedor,
      })
      activosPorLinea.set(indice, { id: activo.id, nombre: activo.nombre })
    })

    const solicitudAsiento: SolicitudAsiento = {
      fecha: solicitud.fechaEmision,
      concepto: `Factura proveedor ${solicitud.folioProveedor}: ${ctx.proveedor?.razonSocial ?? ''}`.trim(),
      moneda: solicitud.moneda,
      tipoCambio: solicitud.tipoCambio,
      origen: { modulo: 'cxp', tipo: 'factura', id },
      lineas: lineasAsientoFacturaCompra(
        solicitud,
        ctx,
        calculadas,
        activosPorLinea,
      ),
    }

    const emision = emitirAsiento(solicitudAsiento)
    if (!emision.ok) {
      // Transaccionalidad (docs/02 §8): si el mayor rechaza el asiento, los
      // activos que ya se habían creado se deshacen. Un activo sin compra es
      // un descuadre que nadie encuentra hasta la conciliación.
      for (const activo of activosPorLinea.values()) descartarActivo(activo.id)
      return errorApi(
        emision.error.codigo,
        emision.error.mensaje,
        emision.error.detalles,
      )
    }

    const lineas: LineaFacturaCompra[] = solicitud.lineas.map((l, i) => ({
      id: `${id}-l${i + 1}`,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      descuento: l.descuento ?? '0.00',
      tarifa: l.tarifa,
      cuenta: calculadas[i].cuenta,
      base: calculadas[i].base.toApi(),
      impuesto: calculadas[i].impuesto.toApi(),
      total: calculadas[i].total.toApi(),
      activoId: activosPorLinea.get(i)?.id ?? null,
    }))

    const factura: FacturaCompra = {
      id,
      folioProveedor: solicitud.folioProveedor.trim(),
      folioInterno,
      proveedorId: solicitud.proveedorId,
      proveedorNombre: ctx.proveedor?.razonSocial ?? solicitud.proveedorId,
      fechaEmision: solicitud.fechaEmision,
      fechaVencimiento: solicitud.fechaVencimiento,
      moneda: solicitud.moneda,
      tipoCambio: solicitud.tipoCambio,
      lineas,
      subtotal: totales.subtotal.toApi(),
      descuentos: totales.descuentos.toApi(),
      impuesto: totales.impuesto.toApi(),
      retencion: totales.retencion.toApi(),
      total: totales.total.toApi(),
      // La cuenta por pagar nace por el neto: la retención no se le paga al
      // proveedor, se le entera a Hacienda.
      saldo: totales.porPagar.toApi(),
      estado: 'contabilizada',
      asientoId: emision.asiento.id,
      creadoEn: new Date().toISOString(),
      // Los adjuntos se suben después de crear la factura, uno por uno.
      adjuntos: [],
    }

    facturas.push(factura)
    persistirFacturasCompra()
    return HttpResponse.json(factura, { status: 201 })
  }),

  /* --------------------------------------------------------------- Pagos */

  /**
   * GET /cxp/propuesta-pago
   *
   * Qué pagar con el efectivo que hay (docs/05 §2.3).
   *
   * No guarda nada. La propuesta se recalcula sobre las facturas vigentes cada
   * vez que se pide, porque una propuesta guardada envejece mal: las facturas
   * que la componen se pagan por otros caminos y el documento quedaría
   * proponiendo pagar lo que ya se pagó.
   */
  http.get(rutaApi('/cxp/propuesta-pago'), async ({ request }) => {
    await latencia(200)
    const url = new URL(request.url)
    const corte =
      url.searchParams.get('corte') ?? new Date().toISOString().slice(0, 10)
    const disponible = url.searchParams.get('disponible') ?? '0'
    return HttpResponse.json(
      calcularPropuestaPago(facturas, corte, disponible, monedaFuncional()),
    )
  }),

  /** GET /cxp/pagos: filtra por proveedor y por factura aplicada. */
  http.get(rutaApi('/cxp/pagos'), async ({ request }) => {
    await latencia(150)
    const url = new URL(request.url)
    const proveedorId = url.searchParams.get('proveedorId')
    const facturaId = url.searchParams.get('facturaId')

    let resultado = [...pagos]
    if (proveedorId) {
      resultado = resultado.filter((p) => p.proveedorId === proveedorId)
    }
    if (facturaId) {
      // El filtro por factura es la vuelta de la relación N a N: desde una
      // factura se llega a todos los pagos que la abonaron.
      resultado = resultado.filter((p) =>
        p.aplicaciones.some((a) => a.facturaId === facturaId),
      )
    }

    return HttpResponse.json(
      resultado.sort(
        (a, b) =>
          b.fecha.localeCompare(a.fecha) || b.folio.localeCompare(a.folio),
      ),
    )
  }),

  http.get(rutaApi('/cxp/pagos/:id'), async ({ params }) => {
    await latencia(100)
    const pago = pagos.find((p) => p.id === params.id)
    return pago
      ? HttpResponse.json(pago)
      : noEncontrado('PAGO_NO_ENCONTRADO', 'El pago no existe')
  }),

  http.get(rutaApi('/cxp/pagos/:id/asiento'), async ({ params }) => {
    await latencia(100)
    const pago = pagos.find((p) => p.id === params.id)
    if (!pago) return noEncontrado('PAGO_NO_ENCONTRADO', 'El pago no existe')
    const asiento = asientosMock.find((a) => a.id === pago.asientoId)
    return asiento
      ? HttpResponse.json(asiento)
      : noEncontrado('ASIENTO_NO_ENCONTRADO', 'El pago no está contabilizado')
  }),

  /**
   * POST /cxp/pagos
   *
   * Registrar el pago hace tres cosas en una sola operación (docs/02 §8): crea
   * el documento, contabiliza el egreso y baja el saldo de cada factura
   * aplicada. Las tres van juntas o no va ninguna: si el mayor rechaza el
   * asiento, ni el pago se guarda ni ninguna factura cambia de saldo.
   *
   * El orden importa. Primero el asiento y después los saldos: un saldo que
   * baja sin su asiento deja el auxiliar del proveedor por debajo de la cuenta
   * de control, que es el descuadre que docs/05 §5 exige vigilar.
   */
  http.post(rutaApi('/cxp/pagos'), async ({ request }) => {
    await latencia(400)

    const parsed = SolicitudPagoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = parsed.data
    const ctx = contextoPago(solicitud.proveedorId)
    const calculo = calcularPago(solicitud, ctx)

    if (!calculo.valido) {
      const principal = calculo.errores[0]
      return errorApi(
        principal.codigo,
        principal.mensaje,
        calculo.errores.map((e) =>
          e.aplicacion === undefined
            ? e.mensaje
            : `Aplicación ${e.aplicacion + 1}: ${e.mensaje}`,
        ),
      )
    }

    const { id, folio } = siguienteFolioPago()
    const emision = emitirAsiento(
      armarAsientoPago(id, folio, solicitud, ctx, calculo),
    )
    if (!emision.ok) {
      return errorApi(
        emision.error.codigo,
        emision.error.mensaje,
        emision.error.detalles,
      )
    }

    const aplicaciones: AplicacionPago[] = calculo.aplicaciones.map((a) => ({
      facturaId: a.factura.id,
      folioProveedor: a.factura.folioProveedor,
      folioInterno: a.factura.folioInterno,
      fechaVencimiento: a.factura.fechaVencimiento,
      tipoCambioFactura: a.factura.tipoCambio,
      importe: a.importe.toApi(),
      saldoAnterior: a.saldoAnterior.toApi(),
      saldoResultante: a.saldoResultante.toApi(),
      diferenciaCambiaria: a.diferenciaCambiaria.toApi(),
    }))

    // El saldo de la factura es un dato guardado y no uno derivado de recorrer
    // sus pagos: es lo que hará el backend y lo que permite que la antigüedad
    // y el saldo del proveedor se calculen sobre una sola lectura.
    for (const aplicacion of calculo.aplicaciones) {
      const factura = facturas.find((f) => f.id === aplicacion.factura.id)
      if (!factura) continue
      factura.saldo = aplicacion.saldoResultante.toApi()
      if (!aplicacion.saldoResultante.esPositivo()) factura.estado = 'pagada'
    }
    persistirFacturasCompra()

    const pago: Pago = {
      id,
      folio,
      proveedorId: solicitud.proveedorId,
      proveedorNombre: ctx.proveedor?.razonSocial ?? solicitud.proveedorId,
      fecha: solicitud.fecha,
      moneda: solicitud.moneda,
      tipoCambio: solicitud.tipoCambio,
      cuentaSalida: solicitud.cuentaSalida,
      auxiliarBanco: solicitud.auxiliarBanco?.trim() || null,
      medioPago: solicitud.medioPago,
      referencia: solicitud.referencia?.trim() || null,
      importe: new Money(solicitud.importe, solicitud.moneda).toApi(),
      aplicado: calculo.aplicado.toApi(),
      anticipo: calculo.anticipo.toApi(),
      aplicaciones,
      diferenciaCambiaria: calculo.diferenciaCambiaria.toApi(),
      estado: 'emitido',
      asientoId: emision.asiento.id,
      creadoEn: new Date().toISOString(),
      anuladoEn: null,
      motivoAnulacion: null,
      asientoAnulacionId: null,
    }

    pagos.push(pago)
    persistirPagos()

    /*
     * El retiro llega a tesorería (docs/06 §2.1).
     *
     * No genera asiento: el que se emitió arriba ya reconoció la salida de
     * efectivo, y volver a contabilizarla duplicaría el egreso. Lo que hace es
     * dejar el movimiento en el auxiliar de bancos para que la conciliación
     * tenga contra qué cruzar el cargo cuando llegue el estado de cuenta. El
     * importe va en negativo porque sale, que es el criterio de signo del
     * auxiliar. Contra caja no se publica nada: la caja no se concilia con un
     * banco, se arquea.
     */
    if (pago.auxiliarBanco) {
      registrarMovimientoExterno({
        cuentaBancariaId: pago.auxiliarBanco,
        fecha: pago.fecha,
        importe: new Decimal(pago.importe).negated().toFixed(2),
        concepto: `Pago ${pago.folio} · ${pago.proveedorNombre}`,
        referencia: pago.referencia,
        origen: { modulo: 'cxp', tipo: 'pago', id: pago.id },
        asientoId: emision.asiento.id,
      })
    }

    return HttpResponse.json(pago, { status: 201 })
  }),

  /**
   * POST /cxp/pagos/:id/anulacion
   *
   * Anular reversa el asiento del pago y devuelve el saldo a cada factura que
   * había abonado. El documento no se borra ni se edita: queda en el histórico
   * en estado `anulado`, con el motivo y el asiento que lo neutralizó
   * (docs/02 §6 y §7).
   *
   * Sobre el periodo: NO se exige que el periodo del pago siga abierto. Lo que
   * tiene que caer en periodo abierto es la FECHA DE LA REVERSA, y de eso se
   * ocupa `reversarAsiento`. Es la regla de docs/02 §6: si el periodo del
   * original ya cerró, la reversa va en el abierto y no se reabre nada para
   * corregir. Exigir lo contrario obligaría a reabrir un mes ya declarado para
   * anular un cheque devuelto, que es justo lo que el cierre existe para
   * impedir.
   */
  http.post(rutaApi('/cxp/pagos/:id/anulacion'), async ({ params, request }) => {
    await latencia(350)

    const pago = pagos.find((p) => p.id === params.id)
    if (!pago) return noEncontrado('PAGO_NO_ENCONTRADO', 'El pago no existe')

    const parsed = SolicitudAnulacionPagoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    if (pago.estado === 'anulado') {
      return errorApi(
        'PAGO_YA_ANULADO',
        `El pago ${pago.folio} ya está anulado`,
        pago.motivoAnulacion ? [pago.motivoAnulacion] : [],
      )
    }
    if (!pago.asientoId) {
      return errorApi(
        'PAGO_SIN_ASIENTO',
        `El pago ${pago.folio} no tiene asiento que reversar`,
      )
    }

    const reversa = reversarAsiento(pago.asientoId, parsed.data)
    if (!reversa.ok) {
      return errorApi(
        reversa.error.codigo,
        reversa.error.mensaje,
        reversa.error.detalles,
      )
    }

    // El saldo vuelve a donde estaba y la factura deja de estar pagada. Se suma
    // lo aplicado en vez de restaurar `saldoAnterior`: entre medias pudo haber
    // otro pago, y devolver la foto vieja borraría ese otro abono.
    for (const aplicacion of pago.aplicaciones) {
      const factura = facturas.find((f) => f.id === aplicacion.facturaId)
      if (!factura || factura.estado === 'cancelada') continue
      const devuelto = new Money(factura.saldo, factura.moneda).plus(
        new Money(aplicacion.importe, factura.moneda),
      )
      factura.saldo = devuelto.toApi()
      if (devuelto.esPositivo()) factura.estado = 'contabilizada'
    }
    persistirFacturasCompra()

    // El movimiento bancario se va con el asiento que lo explicaba. Si ya
    // estaba conciliado no se toca: el banco sí registró ese cargo, y lo que
    // corresponde entonces es una devolución, que es otro movimiento.
    if (pago.auxiliarBanco) {
      eliminarMovimientoExterno('cxp', 'pago', pago.id)
    }

    pago.estado = 'anulado'
    pago.anuladoEn = new Date().toISOString()
    pago.motivoAnulacion = parsed.data.motivo.trim()
    pago.asientoAnulacionId = reversa.reversa.id
    persistirPagos()

    return HttpResponse.json(pago)
  }),

  /* ------------------------------------------------------------ Adjuntos */

  /**
   * POST /cxp/facturas/:id/adjuntos
   *
   * JSON con el contenido en base64. El contenido se guarda en su propia
   * colección y la factura recibe solo los metadatos: así listar facturas
   * no descarga PDF y guardar la factura no reescribe sus archivos.
   */
  http.post(rutaApi('/cxp/facturas/:id/adjuntos'), async ({ params, request }) => {
    await latencia(300)

    const factura = facturas.find((f) => f.id === params.id)
    if (!factura) {
      return noEncontrado('FACTURA_NO_ENCONTRADA', 'La factura no existe')
    }

    const parsed = SolicitudAdjuntoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'ADJUNTO_INVALIDO',
        'El adjunto no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const resultado = validarAdjunto(parsed.data)
    if (!resultado.valido) return rechazar(resultado.errores)

    const almacenado: AdjuntoAlmacenado = {
      id: siguienteIdAdjunto(factura.id),
      facturaId: factura.id,
      nombre: parsed.data.nombre.trim(),
      tipoMime: parsed.data.tipoMime,
      tamano: parsed.data.tamano,
      fechaCarga: new Date().toISOString(),
      // Sin usuarios todavía: el backend pondrá el de la sesión.
      cargadoPor: 'demo',
      descripcion: parsed.data.descripcion?.trim() || null,
      contenidoBase64: parsed.data.contenidoBase64.replace(/\s/g, ''),
    }
    adjuntos.push(almacenado)
    persistirAdjuntosCompra()

    const metadatos = metadatosDeAdjunto(almacenado)
    factura.adjuntos = [...factura.adjuntos, metadatos]
    persistirFacturasCompra()
    return HttpResponse.json(metadatos, { status: 201 })
  }),

  /**
   * GET /cxp/facturas/:id/adjuntos/:adjuntoId
   *
   * El binario, con su tipo: es lo que el navegador abre en otra pestaña.
   */
  http.get(
    rutaApi('/cxp/facturas/:id/adjuntos/:adjuntoId'),
    async ({ params }) => {
      await latencia(200)
      const adjunto = adjuntos.find(
        (a) => a.facturaId === params.id && a.id === params.adjuntoId,
      )
      if (!adjunto) {
        return noEncontrado('ADJUNTO_NO_ENCONTRADO', 'El adjunto no existe')
      }
      return new HttpResponse(decodificarBase64(adjunto.contenidoBase64), {
        status: 200,
        headers: {
          'Content-Type': adjunto.tipoMime,
          'Content-Disposition': `inline; filename="${adjunto.nombre}"`,
        },
      })
    },
  ),

  http.delete(
    rutaApi('/cxp/facturas/:id/adjuntos/:adjuntoId'),
    async ({ params }) => {
      await latencia(200)
      const factura = facturas.find((f) => f.id === params.id)
      if (!factura) {
        return noEncontrado('FACTURA_NO_ENCONTRADA', 'La factura no existe')
      }
      const indice = adjuntos.findIndex(
        (a) => a.facturaId === factura.id && a.id === params.adjuntoId,
      )
      if (indice === -1) {
        return noEncontrado('ADJUNTO_NO_ENCONTRADO', 'El adjunto no existe')
      }

      adjuntos.splice(indice, 1)
      persistirAdjuntosCompra()
      factura.adjuntos = factura.adjuntos.filter((a) => a.id !== params.adjuntoId)
      persistirFacturasCompra()
      return new HttpResponse(null, { status: 204 })
    },
  ),
]
