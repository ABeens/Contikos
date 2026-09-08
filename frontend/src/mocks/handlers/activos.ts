import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import { rutaApi } from '@/shared/api/entorno'
import { latencia } from '../latencia'
import type {
  Activo,
  AltaPendiente,
  CategoriaActivo,
  CategoriaActivoBase,
  CorridaHistorial,
  PrevisualizacionCorrida,
  ResultadoCorrida,
} from '@/shared/api/contracts/activos'
import {
  SolicitudActivoDesdeFacturaSchema,
  SolicitudActivoManualSchema,
  SolicitudCategoriaActivoSchema,
  SolicitudCorridaSchema,
} from '@/shared/api/contracts/activos'
import { esCuentaDeActivoFijo } from '@/shared/cuentas/cuenta'
import type { SolicitudAsiento } from '@/shared/api/contracts/conta'
import {
  lineasAsientoAltaManual,
  valorResidualDe,
  vidaUtilDe,
  validarAltaDesdeFactura,
  validarAltaManual,
  validarCategoria,
} from '@/modules/activos/domain/activo'
import {
  armarAsientoCorrida,
  calcularCorrida,
  periodoIdDeOrigen,
  type ContextoCorrida,
} from '@/modules/activos/domain/depreciacion'
import { monedaFuncional } from '@/shared/money/money'
import { CUENTAS, CUENTA_POR_CODIGO } from '../seed/cuentas'
import { PERIODOS } from '../seed/periodos'
import { ASIENTOS } from '../seed/asientos'
import {
  activosMock,
  categoriasMock,
  persistirActivos,
  persistirCategorias,
  siguienteCodigoActivo,
  siguienteIdCategoria,
} from '../seed/activos'
import { facturasCompraMock, persistirFacturasCompra } from '../seed/cxp'
import { emitirAsiento } from './conta'

/**
 * Mock de activos fijos.
 *
 * Las dos puertas de entrada del activo se comportan distinto a propósito
 * (docs/07 §3.1): el alta directa contabiliza y la que viene de una factura de
 * CxP no, porque el asiento de la compra ya reconoció el bien en el mayor.
 */

const activos = activosMock
const categorias = categoriasMock

function errorApi(codigo: string, mensaje: string, detalles: string[] = []) {
  return HttpResponse.json({ codigo, mensaje, detalles }, { status: 422 })
}

function noEncontrado(codigo: string, mensaje: string) {
  return HttpResponse.json({ codigo, mensaje }, { status: 404 })
}

function serializarCategoria(categoria: CategoriaActivoBase): CategoriaActivo {
  return {
    ...categoria,
    activos: activos.filter((a) => a.categoriaId === categoria.id).length,
  }
}

export function categoriasServidas(): CategoriaActivo[] {
  return categorias.map(serializarCategoria)
}

/** Cuenta que reconoce un activo fijo en el mayor. */
function cuentaReconoceActivo(codigo: string): boolean {
  return esCuentaDeActivoFijo(CUENTA_POR_CODIGO.get(codigo))
}

/**
 * Compras que el mayor ya reconoce como activo y el auxiliar todavía no.
 *
 * Mientras esta lista tenga renglones, la conciliación de docs/07 §4 no cuadra:
 * hay costo en la cuenta de activo fijo que ninguna ficha explica.
 */
export function altasPendientes(): AltaPendiente[] {
  return facturasCompraMock
    .filter((f) => f.estado !== 'cancelada')
    .flatMap((factura) =>
      factura.lineas
        .filter((l) => l.activoId === null && cuentaReconoceActivo(l.cuenta))
        .map((linea) => ({
          facturaId: factura.id,
          facturaFolio: factura.folioProveedor,
          lineaId: linea.id,
          proveedorId: factura.proveedorId,
          proveedorNombre: factura.proveedorNombre,
          fecha: factura.fechaEmision,
          descripcion: linea.descripcion,
          cuenta: linea.cuenta,
          cuentaNombre: CUENTA_POR_CODIGO.get(linea.cuenta)?.nombre ?? linea.cuenta,
          moneda: factura.moneda,
          importe: linea.base,
          categoriaSugeridaId:
            categorias.find((c) => c.cuentaActivo === linea.cuenta)?.id ?? null,
        })),
    )
}

export interface DatosActivoDeCompra {
  nombre: string
  descripcion?: string | null
  categoria: CategoriaActivo
  fechaAdquisicion: string
  fechaInicioDepreciacion: string
  moneda: string
  costo: string
  valorResidual?: string
  vidaUtilMeses?: number
  ubicacion?: string | null
  responsable?: string | null
  numeroSerie?: string | null
  proveedorId: string
  proveedorNombre: string
  facturaId: string
  facturaFolio: string
}

/**
 * Da de alta la ficha de un activo comprado, sin generar asiento.
 *
 * La usan los dos caminos que llegan desde una compra: capitalizar la línea al
 * capturar la factura en CxP, y regularizar después un alta pendiente desde
 * este módulo. En ninguno de los dos se contabiliza nada: el asiento de la
 * compra ya reconoció el activo.
 */
export function registrarActivoDeCompra(datos: DatosActivoDeCompra): Activo {
  const codigo = siguienteCodigoActivo()
  const residual = valorResidualDe(
    datos.costo,
    datos.categoria,
    datos.valorResidual,
  )

  const activo: Activo = {
    id: `act-${codigo.replace(/\D/g, '')}`,
    codigo,
    nombre: datos.nombre,
    descripcion: datos.descripcion ?? null,
    categoriaId: datos.categoria.id,
    categoriaNombre: datos.categoria.nombre,
    fechaAdquisicion: datos.fechaAdquisicion,
    fechaInicioDepreciacion: datos.fechaInicioDepreciacion,
    moneda: datos.moneda,
    costoAdquisicion: new Decimal(datos.costo).toFixed(2),
    valorResidual: residual.toFixed(2),
    vidaUtilMeses: vidaUtilDe(datos.categoria, datos.vidaUtilMeses),
    metodo: datos.categoria.metodo,
    depreciacionAcumulada: '0.00',
    valorEnLibros: new Decimal(datos.costo).toFixed(2),
    ubicacion: datos.ubicacion ?? null,
    responsable: datos.responsable ?? null,
    numeroSerie: datos.numeroSerie ?? null,
    proveedorId: datos.proveedorId,
    proveedorNombre: datos.proveedorNombre,
    facturaId: datos.facturaId,
    facturaFolio: datos.facturaFolio,
    origen: 'cxp',
    asientoId: null,
    estado: 'activo',
    depreciaciones: [],
    creadoEn: new Date().toISOString(),
  }

  activos.push(activo)
  persistirActivos()
  return activo
}

/** Deshace un alta. Solo para revertir una captura que el mayor rechazó. */
export function descartarActivo(id: string): void {
  const indice = activos.findIndex((a) => a.id === id)
  if (indice === -1) return
  activos.splice(indice, 1)
  persistirActivos()
}

export function categoriaPorId(id: string): CategoriaActivo | undefined {
  const base = categorias.find((c) => c.id === id)
  return base ? serializarCategoria(base) : undefined
}

/* ------------------------------------------------------ Depreciación */

/**
 * Corridas que ya están en el mayor, leídas del libro y no de las fichas.
 *
 * El mayor es la fuente de verdad de la idempotencia (docs/02 §4): la terna
 * de origen vive en el asiento, y es ahí donde hay que mirar para saber si un
 * periodo ya se corrió, aunque la ficha se hubiera perdido o editado.
 */
function corridasContabilizadas(): Map<string, string> {
  const mapa = new Map<string, string>()
  for (const asiento of ASIENTOS) {
    if (asiento.origenModulo !== 'activos') continue
    if (asiento.origenTipo !== 'depreciacion') continue
    if (!asiento.origenId) continue
    const periodoId = periodoIdDeOrigen(asiento.origenId)
    if (periodoId) mapa.set(periodoId, asiento.id)
  }
  return mapa
}

function contextoCorrida(): ContextoCorrida {
  return { periodos: PERIODOS, corridasContabilizadas: corridasContabilizadas() }
}

/** Calcula la corrida y el asiento que la contabilizaría, sin escribir nada. */
function previsualizarCorrida(
  periodoId: string,
): PrevisualizacionCorrida | null {
  const periodo = PERIODOS.find((p) => p.id === periodoId)
  if (!periodo) return null

  const moneda = monedaFuncional()
  const categorias = categoriasServidas()
  const corrida = calcularCorrida(
    activos,
    categorias,
    periodo,
    moneda,
    contextoCorrida(),
  )
  const asiento =
    corrida.lineas.length > 0
      ? armarAsientoCorrida(corrida, activos, categorias, periodo, moneda)
      : null

  return { corrida, asiento }
}

/**
 * Historial de corridas, reconstruido desde las fichas.
 *
 * Cada activo lleva sus cuotas contabilizadas; agrupar por periodo devuelve la
 * corrida entera con su total y su asiento, sin una tabla aparte que pueda
 * discrepar de las fichas.
 */
export function historialCorridas(): CorridaHistorial[] {
  const porPeriodo = new Map<string, CorridaHistorial>()
  for (const activo of activos) {
    for (const d of activo.depreciaciones ?? []) {
      const previa = porPeriodo.get(d.periodoId)
      if (previa) {
        previa.total = new Decimal(previa.total).plus(d.cuota).toFixed(2)
        previa.activos += 1
      } else {
        porPeriodo.set(d.periodoId, {
          periodoId: d.periodoId,
          fecha: d.fecha,
          total: new Decimal(d.cuota).toFixed(2),
          asientoId: d.asientoId,
          activos: 1,
        })
      }
    }
  }
  return [...porPeriodo.values()].sort((a, b) => b.fecha.localeCompare(a.fecha))
}

const handlersDepreciacion = [
  /** Previsualización: calcula, verifica y no escribe nada. */
  http.get(rutaApi('/activos/depreciacion'), async ({ request }) => {
    await latencia(200)
    const periodoId = new URL(request.url).searchParams.get('periodoId') ?? ''
    const previa = previsualizarCorrida(periodoId)
    return previa
      ? HttpResponse.json(previa)
      : noEncontrado('PERIODO_NO_ENCONTRADO', 'El periodo no existe')
  }),

  http.get(rutaApi('/activos/depreciacion/historial'), async () => {
    await latencia(120)
    return HttpResponse.json(historialCorridas())
  }),

  /**
   * Contabiliza la corrida.
   *
   * Recalcula sobre el estado vigente en vez de recibir la corrida calculada
   * por el cliente: lo que entra al mayor es lo que el servidor ve ahora, no lo
   * que alguien vio hace diez minutos en otra pestaña.
   */
  http.post(rutaApi('/activos/depreciacion'), async ({ request }) => {
    await latencia(450)

    const parsed = SolicitudCorridaSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const { periodoId, confirmarAvisos } = parsed.data
    const periodo = PERIODOS.find((p) => p.id === periodoId)
    if (!periodo) {
      return noEncontrado('PERIODO_NO_ENCONTRADO', 'El periodo no existe')
    }

    // Idempotencia por origen (docs/07 §3.2): la segunda corrida del mismo
    // periodo no duplica el gasto, y se contesta con el asiento que ya existe.
    const yaContabilizada = corridasContabilizadas().get(periodo.id)
    if (yaContabilizada) {
      return HttpResponse.json(
        {
          codigo: 'CORRIDA_YA_CONTABILIZADA',
          mensaje: `La depreciación del periodo ya está contabilizada en el asiento ${yaContabilizada}`,
          detalles: [yaContabilizada],
        },
        { status: 409 },
      )
    }

    const { corrida, asiento } = previsualizarCorrida(periodo.id)!
    const errores = corrida.verificaciones.filter((v) => v.severidad === 'error')
    const avisos = corrida.verificaciones.filter((v) => v.severidad === 'aviso')

    if (errores.length > 0 || !asiento) {
      return errorApi(
        'CORRIDA_CON_ERRORES',
        errores[0]?.mensaje ??
          'La corrida no tiene ninguna línea que contabilizar',
        (errores.length > 0 ? errores : avisos).map((v) => v.mensaje),
      )
    }
    if (avisos.length > 0 && !confirmarAvisos) {
      return errorApi(
        'CORRIDA_CON_AVISOS',
        'La corrida tiene avisos que hay que revisar antes de contabilizar',
        avisos.map((v) => v.mensaje),
      )
    }

    const emision = emitirAsiento(asiento)
    if (!emision.ok) {
      return errorApi(
        emision.error.codigo,
        emision.error.mensaje,
        emision.error.detalles,
      )
    }

    // Las fichas solo cambian si el mayor aceptó el asiento: una acumulada
    // que suba sin su asiento rompe la conciliación de docs/07 §4.
    let actualizados = 0
    for (const linea of corrida.lineas) {
      const activo = activos.find((a) => a.id === linea.activoId)
      if (!activo) continue
      activo.depreciacionAcumulada = linea.depreciacionAcumuladaResultante
      activo.valorEnLibros = linea.valorEnLibrosResultante
      if (linea.ultimaCuota) activo.estado = 'totalmente_depreciado'
      activo.depreciaciones = [
        ...(activo.depreciaciones ?? []),
        {
          periodoId: periodo.id,
          fecha: periodo.fechaFin,
          cuota: linea.cuota,
          asientoId: emision.asiento.id,
        },
      ]
      actualizados += 1
    }
    persistirActivos()

    const resultado: ResultadoCorrida = {
      corrida,
      asientoId: emision.asiento.id,
      asientoNumero: emision.asiento.numero,
      activosActualizados: actualizados,
    }
    return HttpResponse.json(resultado, { status: 201 })
  }),
]

export const handlersActivos = [
  http.get(rutaApi('/activos/categorias'), async () => {
    await latencia(90)
    return HttpResponse.json(categoriasServidas())
  }),

  http.post(rutaApi('/activos/categorias'), async ({ request }) => {
    await latencia(250)

    const parsed = SolicitudCategoriaActivoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const resultado = validarCategoria(parsed.data, {
      cuentas: CUENTAS,
      categorias: categoriasServidas(),
    })
    if (!resultado.valido) {
      const principal = resultado.errores[0]
      return errorApi(
        principal.codigo,
        principal.mensaje,
        resultado.errores.map((e) => e.mensaje),
      )
    }

    const nueva: CategoriaActivoBase = {
      ...parsed.data,
      nombre: parsed.data.nombre.trim(),
      id: siguienteIdCategoria(parsed.data.nombre),
    }
    categorias.push(nueva)
    persistirCategorias()
    return HttpResponse.json(serializarCategoria(nueva), { status: 201 })
  }),

  http.put(rutaApi('/activos/categorias/:id'), async ({ params, request }) => {
    await latencia(250)

    const id = String(params.id)
    const indice = categorias.findIndex((c) => c.id === id)
    if (indice === -1) {
      return noEncontrado('CATEGORIA_NO_ENCONTRADA', 'La categoría no existe')
    }

    const parsed = SolicitudCategoriaActivoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const resultado = validarCategoria(parsed.data, {
      cuentas: CUENTAS,
      categorias: categoriasServidas(),
      categoria: serializarCategoria(categorias[indice]),
    })
    if (!resultado.valido) {
      const principal = resultado.errores[0]
      return errorApi(
        principal.codigo,
        principal.mensaje,
        resultado.errores.map((e) => e.mensaje),
      )
    }

    const actualizada: CategoriaActivoBase = {
      ...parsed.data,
      nombre: parsed.data.nombre.trim(),
      id,
    }
    categorias[indice] = actualizada

    // El nombre de la categoría viaja copiado en cada ficha: renombrarla sin
    // arrastrar las fichas dejaría el inventario diciendo un nombre que el
    // catálogo ya no reconoce.
    for (const activo of activos) {
      if (activo.categoriaId === id) activo.categoriaNombre = actualizada.nombre
    }

    persistirCategorias()
    persistirActivos()
    return HttpResponse.json(serializarCategoria(actualizada))
  }),

  http.get(rutaApi('/activos/altas-pendientes'), async () => {
    await latencia(120)
    return HttpResponse.json(altasPendientes())
  }),

  // Van antes de `/activos/:id`: `depreciacion` no es un id de activo.
  ...handlersDepreciacion,

  http.get(rutaApi('/activos'), async ({ request }) => {
    await latencia(140)
    const url = new URL(request.url)
    const categoriaId = url.searchParams.get('categoriaId')

    const resultado = categoriaId
      ? activos.filter((a) => a.categoriaId === categoriaId)
      : [...activos]

    return HttpResponse.json(
      resultado.sort((a, b) => a.codigo.localeCompare(b.codigo)),
    )
  }),

  http.get(rutaApi('/activos/:id'), async ({ params }) => {
    await latencia(100)
    const activo = activos.find((a) => a.id === params.id)
    return activo
      ? HttpResponse.json(activo)
      : noEncontrado('ACTIVO_NO_ENCONTRADO', 'El activo no existe')
  }),

  /** Alta directa: aportación, donación o activo construido. Contabiliza. */
  http.post(rutaApi('/activos/manual'), async ({ request }) => {
    await latencia(400)

    const parsed = SolicitudActivoManualSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = parsed.data
    const resultado = validarAltaManual(solicitud, {
      categorias: categoriasServidas(),
      cuentas: CUENTAS,
      periodos: PERIODOS,
    })

    if (!resultado.valido) {
      const principal = resultado.errores[0]
      return errorApi(
        principal.codigo,
        principal.mensaje,
        resultado.errores.map((e) => e.mensaje),
      )
    }

    const categoria = categoriaPorId(solicitud.categoriaId)!
    const codigo = siguienteCodigoActivo()
    const id = `act-${codigo.replace(/\D/g, '')}`
    const residual = valorResidualDe(
      solicitud.costoAdquisicion,
      categoria,
      solicitud.valorResidual,
    )

    const solicitudAsiento: SolicitudAsiento = {
      fecha: solicitud.fechaAdquisicion,
      concepto: `Alta de activo fijo ${codigo}: ${solicitud.nombre}`,
      moneda: solicitud.moneda,
      tipoCambio: solicitud.tipoCambio,
      origen: { modulo: 'activos', tipo: 'alta', id },
      lineas: lineasAsientoAltaManual(solicitud, categoria, {
        id,
        nombre: solicitud.nombre,
      }),
    }

    const emision = emitirAsiento(solicitudAsiento)
    if (!emision.ok) {
      return errorApi(
        emision.error.codigo,
        emision.error.mensaje,
        emision.error.detalles,
      )
    }

    const activo: Activo = {
      id,
      codigo,
      nombre: solicitud.nombre,
      descripcion: solicitud.descripcion ?? null,
      categoriaId: categoria.id,
      categoriaNombre: categoria.nombre,
      fechaAdquisicion: solicitud.fechaAdquisicion,
      fechaInicioDepreciacion: solicitud.fechaInicioDepreciacion,
      moneda: solicitud.moneda,
      costoAdquisicion: new Decimal(solicitud.costoAdquisicion).toFixed(2),
      valorResidual: residual.toFixed(2),
      vidaUtilMeses: vidaUtilDe(categoria, solicitud.vidaUtilMeses),
      metodo: categoria.metodo,
      depreciacionAcumulada: '0.00',
      valorEnLibros: new Decimal(solicitud.costoAdquisicion).toFixed(2),
      ubicacion: solicitud.ubicacion ?? null,
      responsable: solicitud.responsable ?? null,
      numeroSerie: solicitud.numeroSerie ?? null,
      proveedorId: null,
      proveedorNombre: null,
      facturaId: null,
      facturaFolio: null,
      origen: 'manual',
      asientoId: emision.asiento.id,
      estado: 'activo',
      depreciaciones: [],
      creadoEn: new Date().toISOString(),
    }

    activos.push(activo)
    persistirActivos()
    return HttpResponse.json(activo, { status: 201 })
  }),

  /** Alta desde una compra ya contabilizada. No genera asiento. */
  http.post(rutaApi('/activos/desde-factura'), async ({ request }) => {
    await latencia(350)

    const parsed = SolicitudActivoDesdeFacturaSchema.safeParse(
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
    const pendientes = altasPendientes()
    const resultado = validarAltaDesdeFactura(solicitud, {
      categorias: categoriasServidas(),
      pendientes,
    })

    if (!resultado.valido) {
      const principal = resultado.errores[0]
      return errorApi(
        principal.codigo,
        principal.mensaje,
        resultado.errores.map((e) => e.mensaje),
      )
    }

    const pendiente = pendientes.find(
      (p) =>
        p.facturaId === solicitud.facturaId && p.lineaId === solicitud.lineaId,
    )!
    const categoria = categoriaPorId(solicitud.categoriaId)!

    const activo = registrarActivoDeCompra({
      nombre: solicitud.nombre,
      categoria,
      fechaAdquisicion: pendiente.fecha,
      fechaInicioDepreciacion: solicitud.fechaInicioDepreciacion,
      moneda: pendiente.moneda,
      costo: pendiente.importe,
      valorResidual: solicitud.valorResidual,
      vidaUtilMeses: solicitud.vidaUtilMeses,
      ubicacion: solicitud.ubicacion,
      responsable: solicitud.responsable,
      numeroSerie: solicitud.numeroSerie,
      proveedorId: pendiente.proveedorId,
      proveedorNombre: pendiente.proveedorNombre,
      facturaId: pendiente.facturaId,
      facturaFolio: pendiente.facturaFolio,
    })

    // La línea queda amarrada a su activo: deja de estar pendiente y desde la
    // factura se puede llegar a la ficha.
    const factura = facturasCompraMock.find((f) => f.id === solicitud.facturaId)
    const linea = factura?.lineas.find((l) => l.id === solicitud.lineaId)
    if (linea) {
      linea.activoId = activo.id
      persistirFacturasCompra()
    }

    return HttpResponse.json(activo, { status: 201 })
  }),
]
