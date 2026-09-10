import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import { rutaApi } from '@/shared/api/entorno'
import { latencia } from '../latencia'
import type {
  AplicacionCobro,
  Cliente,
  ClienteBase,
  Cobro,
  FacturaVenta,
  ItemCatalogo,
  LineaFacturaVenta,
} from '@/shared/api/contracts/cxc'
import {
  SolicitudAnulacionCobroSchema,
  SolicitudClienteSchema,
  SolicitudCobroSchema,
  SolicitudFacturaVentaSchema,
  SolicitudItemCatalogoSchema,
} from '@/shared/api/contracts/cxc'
import type { SolicitudAsiento } from '@/shared/api/contracts/conta'
import { monedaFuncional } from '@/shared/money/money'
import {
  calcularLineas,
  lineasAsientoFactura,
  resolutorDeContexto,
  totalesDe,
  validarFacturaVenta,
  type ContextoFacturaVenta,
} from '@/modules/cxc/domain/factura'
import {
  antiguedadDeFacturas,
  facturasPendientesDe,
  saldoDeCliente,
} from '@/modules/cxc/domain/antiguedad'
import {
  armarAsientoCobro,
  validarCobro,
  type ContextoCobro,
} from '@/modules/cxc/domain/cobro'
import { validarItem } from '@/modules/cxc/domain/item'
import { listoParaFe, validarCliente } from '@/modules/cxc/domain/cliente'
import { normalizarIdentificacion } from '@/shared/fiscal/identificacion'
import { normalizarTelefono } from '@/shared/fiscal/contacto'
import { CUENTAS } from '../seed/cuentas'
import { PERIODOS } from '../seed/periodos'
import { tarifasImpuestoMock } from '../seed/impuestos'
import {
  clientesMock,
  cobrosMock,
  facturasVentaMock,
  idDeNumeroCobro,
  itemsMock,
  MAPEO_CXC,
  persistirClientes,
  persistirCobros,
  persistirFacturasVenta,
  persistirItems,
  siguienteConsecutivoComprobante,
  siguienteIdItem,
  siguienteNumeroCobro,
  siguienteNumeroInterno,
} from '../seed/cxc'
import { asientosMock, emitirAsiento, reversarAsiento } from './conta'
import {
  cuentasBancariasServidas,
  eliminarMovimientoExterno,
  registrarMovimientoExterno,
} from './bancos'

/**
 * Mock de CxC.
 *
 * Emitir una factura hace dos cosas en la misma operación: nace el documento y
 * nace su asiento (docs/02 §8). Si el asiento se rechaza, la factura no se
 * guarda: no existe un estado observable donde el documento esté y el mayor no
 * lo sepa.
 */

const facturas = facturasVentaMock
const clientes = clientesMock
const items = itemsMock
const cobros = cobrosMock

function errorApi(codigo: string, mensaje: string, detalles: string[] = []) {
  return HttpResponse.json({ codigo, mensaje, detalles }, { status: 422 })
}

function noEncontrado(codigo: string, mensaje: string) {
  return HttpResponse.json({ codigo, mensaje }, { status: 404 })
}

/** Añade a un cliente los campos que el contrato promete como derivados. */
function serializar(cliente: ClienteBase): Cliente {
  const funcional = monedaFuncional()
  return {
    ...cliente,
    saldo: saldoDeCliente(facturas, cliente.id, funcional).toApi(),
    facturasPendientes: facturasPendientesDe(facturas, cliente.id),
    listoParaFe: listoParaFe(cliente),
  }
}

/** Lo que se guarda: identificación y teléfono solo con dígitos. */
function normalizarCliente(datos: Omit<ClienteBase, 'id'>): Omit<ClienteBase, 'id'> {
  return {
    ...datos,
    codigo: datos.codigo.trim(),
    razonSocial: datos.razonSocial.trim(),
    identificacion: normalizarIdentificacion(datos.identificacion),
    telefono: normalizarTelefono(datos.telefono),
    correo: datos.correo?.trim() || null,
    actividadEconomica: datos.actividadEconomica?.trim() || null,
  }
}

/**
 * Contexto del cobro.
 *
 * Se arma en cada petición sobre el estado vigente: lo que se contabiliza es el
 * saldo que el servidor ve ahora, no el que alguien vio hace diez minutos en
 * otra pestaña.
 */
function contextoCobro(clienteId: string): ContextoCobro {
  const base = clientes.find((c) => c.id === clienteId)
  return {
    cliente: base ? serializar(base) : undefined,
    facturas,
    cuentas: CUENTAS,
    cuentasBancarias: cuentasBancariasServidas(),
    periodos: PERIODOS,
    mapeo: MAPEO_CXC,
    funcional: monedaFuncional(),
  }
}

function contexto(clienteId: string): ContextoFacturaVenta {
  const base = clientes.find((c) => c.id === clienteId)
  return {
    cliente: base ? serializar(base) : undefined,
    cuentas: CUENTAS,
    periodos: PERIODOS,
    mapeo: MAPEO_CXC,
    items,
    tarifas: tarifasImpuestoMock,
  }
}

/** El id sale del número interno: es el que nunca cambia. */
function idDeNumeroInterno(numeroInterno: string): string {
  return `fac-${Number(numeroInterno.replace(/\D/g, ''))}`
}

function rechazarCliente(errores: readonly { codigo: string; mensaje: string }[]) {
  return errorApi(
    errores[0].codigo,
    errores[0].mensaje,
    errores.map((e) => e.mensaje),
  )
}

export const handlersCxc = [
  http.get(rutaApi('/cxc/mapeo'), async () => {
    await latencia(60)
    return HttpResponse.json(MAPEO_CXC)
  }),

  http.get(rutaApi('/cxc/clientes'), async () => {
    await latencia(120)
    return HttpResponse.json(clientes.map(serializar))
  }),

  http.post(rutaApi('/cxc/clientes'), async ({ request }) => {
    await latencia(250)

    const parsed = SolicitudClienteSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const datos = normalizarCliente(parsed.data)
    const resultado = validarCliente(datos, { clientes })
    if (!resultado.valido) return rechazarCliente(resultado.errores)

    const nuevo: ClienteBase = {
      ...datos,
      id: `cli-${String(clientes.length + 1).padStart(3, '0')}`,
    }
    clientes.push(nuevo)
    persistirClientes()
    return HttpResponse.json(serializar(nuevo), { status: 201 })
  }),

  http.put(rutaApi('/cxc/clientes/:id'), async ({ params, request }) => {
    await latencia(250)

    const id = String(params.id)
    const indice = clientes.findIndex((c) => c.id === id)
    if (indice === -1) {
      return noEncontrado('CLIENTE_NO_ENCONTRADO', 'El cliente no existe')
    }

    const parsed = SolicitudClienteSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const datos = normalizarCliente(parsed.data)
    const resultado = validarCliente(datos, {
      clientes,
      cliente: clientes[indice],
    })
    if (!resultado.valido) return rechazarCliente(resultado.errores)

    const actualizado: ClienteBase = { ...datos, id }
    clientes[indice] = actualizado
    persistirClientes()
    return HttpResponse.json(serializar(actualizado))
  }),

  /* --------------------------- Catálogo de productos y servicios */

  http.get(rutaApi('/cxc/items'), async () => {
    await latencia(120)
    return HttpResponse.json(
      [...items].sort((a, b) => a.codigo.localeCompare(b.codigo)),
    )
  }),

  http.post(rutaApi('/cxc/items'), async ({ request }) => {
    await latencia(250)

    const parsed = SolicitudItemCatalogoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const resultado = validarItem(parsed.data, {
      cuentas: CUENTAS,
      items,
      tarifas: tarifasImpuestoMock,
    })
    if (!resultado.valido) {
      const principal = resultado.errores[0]
      return errorApi(
        principal.codigo,
        principal.mensaje,
        resultado.errores.map((e) => e.mensaje),
      )
    }

    const nuevo: ItemCatalogo = {
      ...parsed.data,
      codigo: parsed.data.codigo.trim(),
      nombre: parsed.data.nombre.trim(),
      id: siguienteIdItem(parsed.data.codigo),
    }
    items.push(nuevo)
    persistirItems()
    return HttpResponse.json(nuevo, { status: 201 })
  }),

  http.put(rutaApi('/cxc/items/:id'), async ({ params, request }) => {
    await latencia(250)

    const id = String(params.id)
    const indice = items.findIndex((i) => i.id === id)
    if (indice === -1) {
      return noEncontrado('ITEM_NO_ENCONTRADO', 'El item no existe')
    }

    const parsed = SolicitudItemCatalogoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const resultado = validarItem(parsed.data, {
      cuentas: CUENTAS,
      items,
      item: items[indice],
      tarifas: tarifasImpuestoMock,
    })
    if (!resultado.valido) {
      const principal = resultado.errores[0]
      return errorApi(
        principal.codigo,
        principal.mensaje,
        resultado.errores.map((e) => e.mensaje),
      )
    }

    // Las facturas ya emitidas NO se tocan: guardan el código con el que se
    // vendió y su cuenta copiada en la línea. Cambiar el catálogo cambia lo
    // que se precargará de aquí en adelante, nunca lo que ya se declaró.
    const actualizado: ItemCatalogo = {
      ...parsed.data,
      codigo: parsed.data.codigo.trim(),
      nombre: parsed.data.nombre.trim(),
      id,
    }
    items[indice] = actualizado
    persistirItems()
    return HttpResponse.json(actualizado)
  }),

  http.get(rutaApi('/cxc/facturas'), async ({ request }) => {
    await latencia(150)
    const url = new URL(request.url)
    const clienteId = url.searchParams.get('clienteId')
    const pendientes = url.searchParams.get('pendientes') === 'true'

    let resultado = [...facturas]
    if (clienteId) resultado = resultado.filter((f) => f.clienteId === clienteId)
    if (pendientes) {
      resultado = resultado.filter((f) => f.estado === 'contabilizada')
    }

    return HttpResponse.json(
      resultado.sort(
        (a, b) =>
          b.fechaEmision.localeCompare(a.fechaEmision) ||
          b.numeroInterno.localeCompare(a.numeroInterno),
      ),
    )
  }),

  http.get(rutaApi('/cxc/facturas/:id'), async ({ params }) => {
    await latencia(100)
    const factura = facturas.find((f) => f.id === params.id)
    return factura
      ? HttpResponse.json(factura)
      : noEncontrado('FACTURA_NO_ENCONTRADA', 'La factura no existe')
  }),

  /**
   * Asiento de una factura.
   *
   * Endpoint propio de CxC y no una consulta a `conta`: el módulo expone la
   * trazabilidad de sus documentos sin que la pantalla tenga que conocer el
   * mayor ni la terna de origen.
   */
  http.get(rutaApi('/cxc/facturas/:id/asiento'), async ({ params }) => {
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

  http.get(rutaApi('/cxc/antiguedad'), async ({ request }) => {
    await latencia(180)
    const url = new URL(request.url)
    const corte =
      url.searchParams.get('corte') ?? new Date().toISOString().slice(0, 10)
    return HttpResponse.json(
      antiguedadDeFacturas(facturas, cobros, corte, monedaFuncional()),
    )
  }),

  http.post(rutaApi('/cxc/facturas'), async ({ request }) => {
    await latencia(400)

    const parsed = SolicitudFacturaVentaSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = parsed.data
    const ctx = contexto(solicitud.clienteId)
    const resultado = validarFacturaVenta(solicitud, ctx)

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

    const calculadas = calcularLineas(
      solicitud.lineas,
      solicitud.moneda,
      ctx.cliente,
      MAPEO_CXC,
      resolutorDeContexto(ctx, solicitud.fechaEmision),
    )
    const totales = totalesDe(solicitud.lineas, calculadas, solicitud.moneda)
    // Dos contadores (docs/13 §4.2): el interno es de la empresa y el del
    // comprobante es por terminal. Hoy avanzan a la par; no tienen por qué.
    const numeroInterno = siguienteNumeroInterno()
    const consecutivo = siguienteConsecutivoComprobante()
    const id = idDeNumeroInterno(numeroInterno)

    const lineas: LineaFacturaVenta[] = solicitud.lineas.map((l, i) => ({
      id: `${id}-l${i + 1}`,
      itemId: l.itemId ?? null,
      // El código se copia, como el nombre del cliente: lo que se vendió no
      // puede cambiar porque después se renombre el catálogo.
      itemCodigo: items.find((it) => it.id === l.itemId)?.codigo ?? null,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      descuento: l.descuento ?? '0.00',
      tarifa: l.tarifa,
      cuentaIngreso: calculadas[i].cuentaIngreso,
      base: calculadas[i].base.toApi(),
      impuesto: calculadas[i].impuesto.toApi(),
      total: calculadas[i].total.toApi(),
    }))

    // El documento y su asiento son la misma transacción (docs/02 §8): si el
    // núcleo contable rechaza el asiento, aquí no queda una factura huérfana.
    const solicitudAsiento: SolicitudAsiento = {
      fecha: solicitud.fechaEmision,
      // El concepto cita el número interno: es el que se teclea para buscar.
      concepto: `Factura ${numeroInterno}: ${ctx.cliente?.razonSocial ?? ''}`.trim(),
      moneda: solicitud.moneda,
      tipoCambio: solicitud.tipoCambio,
      origen: { modulo: 'cxc', tipo: 'factura', id },
      lineas: lineasAsientoFactura(solicitud, ctx, calculadas),
    }

    const emision = emitirAsiento(solicitudAsiento)
    if (!emision.ok) {
      return errorApi(
        emision.error.codigo,
        emision.error.mensaje,
        emision.error.detalles,
      )
    }

    const factura: FacturaVenta = {
      id,
      numeroInterno,
      consecutivo,
      claveNumerica: null,
      clienteId: solicitud.clienteId,
      clienteNombre: ctx.cliente?.razonSocial ?? solicitud.clienteId,
      fechaEmision: solicitud.fechaEmision,
      fechaVencimiento: solicitud.fechaVencimiento,
      moneda: solicitud.moneda,
      tipoCambio: solicitud.tipoCambio,
      lineas,
      subtotal: totales.subtotal.toApi(),
      descuentos: totales.descuentos.toApi(),
      impuesto: totales.impuesto.toApi(),
      total: totales.total.toApi(),
      // Nace por cobrar completa: el cobro es otro documento y otro asiento.
      saldo: totales.total.toApi(),
      estado: 'contabilizada',
      asientoId: emision.asiento.id,
      creadoEn: new Date().toISOString(),
    }

    facturas.push(factura)
    persistirFacturasVenta()
    return HttpResponse.json(factura, { status: 201 })
  }),

  /* ------------------------------------------------------------ Cobros */

  http.get(rutaApi('/cxc/cobros'), async ({ request }) => {
    await latencia(150)
    const url = new URL(request.url)
    const clienteId = url.searchParams.get('clienteId')
    // Por factura: es lo que necesita el detalle de una factura para explicar
    // por qué su saldo bajó, y lo primero que pide quien audita la cartera.
    const facturaId = url.searchParams.get('facturaId')

    let resultado = [...cobros]
    if (clienteId) resultado = resultado.filter((c) => c.clienteId === clienteId)
    if (facturaId) {
      resultado = resultado.filter((c) =>
        c.aplicaciones.some((a) => a.facturaId === facturaId),
      )
    }

    return HttpResponse.json(
      resultado.sort(
        (a, b) =>
          b.fecha.localeCompare(a.fecha) || b.numero.localeCompare(a.numero),
      ),
    )
  }),

  http.get(rutaApi('/cxc/cobros/:id'), async ({ params }) => {
    await latencia(100)
    const cobro = cobros.find((c) => c.id === params.id)
    return cobro
      ? HttpResponse.json(cobro)
      : noEncontrado('COBRO_NO_ENCONTRADO', 'El cobro no existe')
  }),

  /** Asiento del cobro. Mismo criterio que el de la factura: lo expone CxC. */
  http.get(rutaApi('/cxc/cobros/:id/asiento'), async ({ params }) => {
    await latencia(100)
    const cobro = cobros.find((c) => c.id === params.id)
    if (!cobro) {
      return noEncontrado('COBRO_NO_ENCONTRADO', 'El cobro no existe')
    }
    const asiento = asientosMock.find((a) => a.id === cobro.asientoId)
    return asiento
      ? HttpResponse.json(asiento)
      : noEncontrado('ASIENTO_NO_ENCONTRADO', 'El cobro no está contabilizado')
  }),

  /**
   * Registra el cobro (docs/04 §2.2).
   *
   * Cuatro cosas en una sola operación, y en este orden: se valida contra el
   * saldo vigente, se emite el asiento, se baja el saldo de cada factura y se
   * guarda el documento. Si el mayor rechaza el asiento no se toca ni un saldo:
   * un auxiliar que baje sin su asiento deja la cuenta de control descuadrada,
   * que es justo lo que la antigüedad existe para detectar (docs/04 §3).
   */
  http.post(rutaApi('/cxc/cobros'), async ({ request }) => {
    await latencia(400)

    const parsed = SolicitudCobroSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = parsed.data
    const ctx = contextoCobro(solicitud.clienteId)
    const calculo = validarCobro(solicitud, ctx)

    if (!calculo.valido) {
      const principal = calculo.errores[0]
      return errorApi(
        principal.codigo,
        principal.mensaje,
        calculo.errores.map((e) => e.mensaje),
      )
    }

    const numero = siguienteNumeroCobro()
    const id = idDeNumeroCobro(numero)

    const emision = emitirAsiento(
      armarAsientoCobro(id, numero, solicitud, ctx, calculo),
    )
    if (!emision.ok) {
      return errorApi(
        emision.error.codigo,
        emision.error.mensaje,
        emision.error.detalles,
      )
    }

    // El saldo baja solo después de que el mayor aceptó el asiento. Una factura
    // llega a `pagada` cuando su saldo queda exactamente en cero (docs/02 §7).
    const aplicaciones: AplicacionCobro[] = calculo.aplicaciones.map((a) => {
      const factura = facturas.find((f) => f.id === a.facturaId)!
      factura.saldo = a.saldoResultante.toApi()
      if (a.saldoResultante.esCero()) factura.estado = 'pagada'
      return {
        facturaId: a.facturaId,
        facturaNumero: a.facturaNumero,
        importeAplicado: a.importeAplicado.toApi(),
        saldoResultante: a.saldoResultante.toApi(),
        tipoCambioFactura: a.tipoCambioFactura,
        diferenciaCambiaria: a.diferenciaCambiaria.toApi(),
      }
    })

    const cobro: Cobro = {
      id,
      numero,
      clienteId: solicitud.clienteId,
      clienteNombre: ctx.cliente?.razonSocial ?? solicitud.clienteId,
      fecha: solicitud.fecha,
      moneda: solicitud.moneda,
      tipoCambio: solicitud.tipoCambio,
      medio: solicitud.medio,
      referencia: solicitud.referencia?.trim() || null,
      cuentaDeposito: solicitud.cuentaDeposito,
      auxiliarBanco: solicitud.auxiliarBanco?.trim() || null,
      importeRecibido: calculo.importeRecibido.toApi(),
      aplicaciones,
      importeAplicado: calculo.importeAplicado.toApi(),
      importeSinAplicar: calculo.importeSinAplicar.toApi(),
      abonoClientesFuncional: calculo.abonoClientes.toApi(),
      diferenciaCambiaria: calculo.diferenciaCambiaria.toApi(),
      estado: 'contabilizado',
      asientoId: emision.asiento.id,
      asientoReversaId: null,
      anuladoEn: null,
      motivoAnulacion: null,
      creadoEn: new Date().toISOString(),
    }

    cobros.push(cobro)
    persistirCobros()
    persistirFacturasVenta()

    /*
     * El depósito llega a tesorería (docs/06 §2.1).
     *
     * No genera asiento: el que se acaba de emitir arriba ya reconoció la
     * entrada de efectivo, y volver a contabilizarla duplicaría el dinero. Lo
     * que hace es dejar el movimiento en el auxiliar de bancos para que la
     * conciliación tenga contra qué cruzar el depósito cuando llegue el estado
     * de cuenta. Contra caja no se publica nada: la caja no se concilia con un
     * banco, se arquea.
     */
    if (cobro.auxiliarBanco) {
      registrarMovimientoExterno({
        cuentaBancariaId: cobro.auxiliarBanco,
        fecha: cobro.fecha,
        importe: cobro.importeRecibido,
        concepto: `Cobro ${cobro.numero} · ${cobro.clienteNombre}`,
        referencia: cobro.referencia,
        origen: { modulo: 'cxc', tipo: 'cobro', id: cobro.id },
        asientoId: emision.asiento.id,
      })
    }

    return HttpResponse.json(cobro, { status: 201 })
  }),

  /**
   * Anula un cobro: reversa su asiento y devuelve el saldo a las facturas.
   *
   * El documento no se borra ni se edita (docs/02 §6 y §7): queda en el
   * histórico marcado como anulado, con su asiento de reversa y el motivo.
   *
   * Se permite aunque el periodo del cobro ya esté cerrado. Es la regla de
   * docs/02 §6: la reversa va en un periodo abierto y no se reabre nada para
   * corregir. Lo que sí exige es que la FECHA DE LA ANULACIÓN caiga en periodo
   * abierto, y de eso se ocupa `reversarAsiento`.
   */
  http.post(rutaApi('/cxc/cobros/:id/anulacion'), async ({ params, request }) => {
    await latencia(400)

    const cobro = cobros.find((c) => c.id === params.id)
    if (!cobro) {
      return noEncontrado('COBRO_NO_ENCONTRADO', 'El cobro no existe')
    }

    const parsed = SolicitudAnulacionCobroSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    if (cobro.estado === 'anulado') {
      return HttpResponse.json(
        {
          codigo: 'COBRO_YA_ANULADO',
          mensaje: `El cobro ${cobro.numero} ya fue anulado`,
          detalles: cobro.asientoReversaId ? [cobro.asientoReversaId] : [],
        },
        { status: 409 },
      )
    }

    if (!cobro.asientoId) {
      return errorApi(
        'COBRO_SIN_ASIENTO',
        `El cobro ${cobro.numero} no tiene asiento que reversar`,
      )
    }

    const reversa = reversarAsiento(cobro.asientoId, parsed.data)
    if (!reversa.ok) {
      return errorApi(
        reversa.error.codigo,
        reversa.error.mensaje,
        reversa.error.detalles,
      )
    }

    // El saldo vuelve donde estaba, y con él el estado: una factura que había
    // llegado a `pagada` vuelve a estar por cobrar.
    for (const aplicacion of cobro.aplicaciones) {
      const factura = facturas.find((f) => f.id === aplicacion.facturaId)
      if (!factura) continue
      factura.saldo = new Decimal(factura.saldo)
        .plus(new Decimal(aplicacion.importeAplicado))
        .toFixed(2)
      if (factura.estado === 'pagada') factura.estado = 'contabilizada'
    }

    // El movimiento bancario se va con el asiento que lo explicaba. Si ya
    // estaba conciliado no se toca: el banco sí registró ese depósito, y lo
    // que corresponde entonces es una devolución, que es otro movimiento.
    if (cobro.auxiliarBanco) {
      eliminarMovimientoExterno('cxc', 'cobro', cobro.id)
    }

    cobro.estado = 'anulado'
    cobro.asientoReversaId = reversa.reversa.id
    cobro.anuladoEn = parsed.data.fecha
    cobro.motivoAnulacion = parsed.data.motivo.trim()
    persistirCobros()
    persistirFacturasVenta()
    return HttpResponse.json(cobro)
  }),
]
