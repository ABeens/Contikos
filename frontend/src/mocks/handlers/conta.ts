import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import { rutaApi } from '@/shared/api/entorno'
import { latencia } from '../latencia'
import type {
  Asiento,
  Balanza,
  ChecklistCierre,
  Cuenta,
  ClasificacionNiif,
  ClasificacionNiifBase,
  LineaAsiento,
  NotaEeff,
  NotaEeffBase,
  Periodo,
  RenglonBalanza,
  SolicitudAsiento,
  SolicitudReversa,
} from '@/shared/api/contracts/conta'
import {
  SolicitudAsientoSchema,
  SolicitudCierreSchema,
  SolicitudClasificacionCuentaSchema,
  SolicitudClasificacionNiifSchema,
  SolicitudCuentaSchema,
  SolicitudNotaEeffSchema,
  SolicitudReversaSchema,
} from '@/shared/api/contracts/conta'
import type { AuxiliarTipo, Libro } from '@/shared/api/contracts/comunes'
import {
  construirReversa,
  ejercicioDeFecha,
  numeroDisponible,
  siguienteNumero,
  validarAsiento,
  validarReversa,
} from '@/modules/conta/domain/asiento'
import { codigoAsiento } from '@/shared/asiento/formato'
import type {
  ContextoCatalogo,
  ResultadoClasificacion,
} from '@/modules/conta/domain/clasificacion'
import {
  cuentasDeClasificacion,
  cuentasDeNota,
  normalizarLiteral,
  notasDeClasificacion,
  ordenarClasificaciones,
  validarClasificacion,
  validarClasificacionCuenta,
  validarEliminacionClasificacion,
  validarEliminacionNota,
  validarNota,
} from '@/modules/conta/domain/clasificacion'
import type { ContextoCuenta } from '@/modules/conta/domain/cuenta'
import {
  codigoPadreDe,
  nivelDe,
  validarCuenta,
} from '@/modules/conta/domain/cuenta'
import type { ContextoCierre } from '@/modules/conta/domain/periodo'
import {
  decidirCierre,
  validarReapertura,
  verificarCierre,
} from '@/modules/conta/domain/periodo'
import { compararBalanzas } from '@/modules/conta/domain/balanza'
import { hoyISO } from '@/shared/format/fecha'
import {
  esLibro,
  lineaAfecta,
  librosAfectados,
  librosDe,
} from '@/shared/asiento/libro'
import {
  CUENTAS,
  CUENTA_POR_CODIGO,
  persistirCuentas,
  registrarCuenta,
} from '../seed/cuentas'
import {
  clasificacionesMock,
  notasMock,
  persistirClasificaciones,
  persistirNotas,
} from '../seed/clasificaciones'
import { PERIODOS, persistirPeriodos } from '../seed/periodos'
import { ASIENTOS, idAsiento, persistirAsientos } from '../seed/asientos'
import { monedaFuncionalMock } from '../seed/monedas'
import { clientesMock } from '../seed/cxc'
import { proveedoresMock } from '../seed/cxp'
import { activosMock } from '../seed/activos'

/**
 * Nombre de la ficha a la que apunta `auxiliarId`.
 *
 * El asiento guarda el id, pero quien lo lee necesita el nombre: sin esto, un
 * asiento capturado a mano contra un cliente se muestra sin auxiliar y parece
 * que se contabilizó a nadie. El servidor de verdad hará el mismo join.
 */
function nombreAuxiliar(
  tipo: AuxiliarTipo | null,
  id: string | null,
): string | null {
  if (!tipo || !id) return null
  switch (tipo) {
    case 'cliente':
      return clientesMock.find((c) => c.id === id)?.razonSocial ?? null
    case 'proveedor':
      return proveedoresMock.find((p) => p.id === id)?.razonSocial ?? null
    case 'activo':
      return activosMock.find((a) => a.id === id)?.nombre ?? null
    // empleado y banco todavía no tienen catálogo (docs/11).
    default:
      return null
  }
}

/**
 * Mock del módulo de contabilidad.
 *
 * Aplica las MISMAS validaciones del contrato (docs/02 §3) reutilizando
 * `validarAsiento`. Un mock permisivo produciría una UI que solo funciona con
 * datos perfectos y que se rompe el día que se conecta el backend real.
 */

/**
 * Libro de asientos del mock.
 *
 * Se exporta porque la configuración de monedas necesita saber si una moneda
 * tiene movimientos antes de dejar que se elimine.
 */
export const asientosMock: Asiento[] = ASIENTOS

const asientos = asientosMock

const CERO = new Decimal(0)

/** Saldo interno con convención "deudor positivo": cargos suman, abonos restan. */
interface Acumulado {
  inicialFirmado: Decimal
  cargos: Decimal
  abonos: Decimal
}

/**
 * Acumula el mayor de UN libro.
 *
 * El mayor no es compartido: una línea marcada solo como corporativa no existe
 * para el mayor fiscal. Es exactamente aquí donde se separan las dos
 * contabilidades. Todo lo demás (catálogo, periodos, consecutivo) es común.
 *
 * Los asientos reversados SÍ se acumulan, igual que su reversa. Un asiento
 * contabilizado es inmutable y nunca sale del mayor (docs/02 §6): lo que lo
 * neutraliza es otro asiento con los importes invertidos, y el par se anula
 * solo en el saldo. Excluir el original y contar la reversa restaría dos
 * veces; excluir los dos borraría movimientos de un periodo que puede estar
 * cerrado, que es justo lo que la reversa existe para no hacer.
 */
function acumular(
  hasta: (a: Asiento) => 'inicial' | 'periodo' | 'fuera',
  libro: Libro,
) {
  const mapa = new Map<string, Acumulado>()
  const obtener = (codigo: string): Acumulado => {
    let a = mapa.get(codigo)
    if (!a) {
      a = { inicialFirmado: CERO, cargos: CERO, abonos: CERO }
      mapa.set(codigo, a)
    }
    return a
  }

  for (const asiento of asientos) {
    const ubicacion = hasta(asiento)
    if (ubicacion === 'fuera') continue

    for (const linea of asiento.lineas) {
      if (!lineaAfecta(linea, libro)) continue
      const a = obtener(linea.cuentaCodigo)
      const cargo = new Decimal(linea.cargo)
      const abono = new Decimal(linea.abono)
      if (ubicacion === 'inicial') {
        a.inicialFirmado = a.inicialFirmado.plus(cargo).minus(abono)
      } else {
        a.cargos = a.cargos.plus(cargo)
        a.abonos = a.abonos.plus(abono)
      }
    }
  }
  return mapa
}

function construirBalanza(periodoId: string, libro: Libro): Balanza | null {
  const periodo = PERIODOS.find((p) => p.id === periodoId)
  if (!periodo) return null

  const movimientos = acumular((a) => {
    if (a.fecha < periodo.fechaInicio) return 'inicial'
    if (a.fecha <= periodo.fechaFin) return 'periodo'
    return 'fuera'
  }, libro)

  // Los saldos de las cuentas acumulativas se obtienen sumando sus hijas.
  // Se acumula en convención deudor-positivo para que una cuenta de naturaleza
  // acreedora bajo un padre deudor (depreciación acumulada) sume correctamente.
  const agregados = new Map<string, Acumulado>()
  const asegurar = (codigo: string): Acumulado => {
    let a = agregados.get(codigo)
    if (!a) {
      a = { inicialFirmado: CERO, cargos: CERO, abonos: CERO }
      agregados.set(codigo, a)
    }
    return a
  }

  for (const [codigo, mov] of movimientos) {
    const partes = codigo.split('.')
    for (let i = partes.length; i >= 1; i--) {
      const ancestro = partes.slice(0, i).join('.')
      if (!CUENTA_POR_CODIGO.has(ancestro)) continue
      const a = asegurar(ancestro)
      a.inicialFirmado = a.inicialFirmado.plus(mov.inicialFirmado)
      a.cargos = a.cargos.plus(mov.cargos)
      a.abonos = a.abonos.plus(mov.abonos)
    }
  }

  const renglones: RenglonBalanza[] = CUENTAS.filter((c) =>
    agregados.has(c.codigo),
  ).map((cuenta) => {
    const a = agregados.get(cuenta.codigo)!
    const finalFirmado = a.inicialFirmado.plus(a.cargos).minus(a.abonos)
    const signo = cuenta.naturaleza === 'deudora' ? 1 : -1
    return {
      cuentaId: cuenta.id,
      codigo: cuenta.codigo,
      nombre: cuenta.nombre,
      nivel: cuenta.nivel,
      esDetalle: cuenta.esDetalle,
      naturaleza: cuenta.naturaleza,
      saldoInicial: a.inicialFirmado.times(signo).toFixed(2),
      cargos: a.cargos.toFixed(2),
      abonos: a.abonos.toFixed(2),
      saldoFinal: finalFirmado.times(signo).toFixed(2),
    }
  })

  // Los totales se calculan SOLO sobre cuentas de detalle: sumar también las
  // acumulativas contaría cada movimiento tantas veces como niveles tenga.
  const detalle = renglones.filter((r) => r.esDetalle)
  const totalCargos = detalle.reduce(
    (acc, r) => acc.plus(new Decimal(r.cargos)),
    CERO,
  )
  const totalAbonos = detalle.reduce(
    (acc, r) => acc.plus(new Decimal(r.abonos)),
    CERO,
  )

  return {
    // El mayor se lleva siempre en moneda funcional (docs/01 §4.2), y cuál es
    // la funcional lo decide la configuración.
    periodo,
    libro,
    moneda: monedaFuncionalMock(),
    renglones,
    totalCargos: totalCargos.toFixed(2),
    totalAbonos: totalAbonos.toFixed(2),
    cuadra: totalCargos.equals(totalAbonos),
  }
}

function errorApi(codigo: string, mensaje: string, detalles: string[] = []) {
  return HttpResponse.json({ codigo, mensaje, detalles }, { status: 422 })
}

/* --------------------------------------- Cierre de periodo (docs/03 §5) */

const dosDigitos = (n: number): string => String(n).padStart(2, '0')

/**
 * Terna de origen de la corrida de depreciación del periodo (docs/07 §3.2).
 *
 * Se escribe aquí y no se importa de `modules/activos`: el checklist es de
 * `conta`, y `conta` no depende de ningún módulo (docs/03, encabezado). Lo que
 * comparten es el formato del id, que es parte del contrato de origen de
 * docs/02 §4 y no una función privada de activos.
 */
function origenDepreciacion(periodo: Periodo): string {
  return `dep-${periodo.ejercicio}-${dosDigitos(periodo.numero)}`
}

/**
 * El contexto del checklist, armado sobre el estado vigente del mock.
 *
 * La parte de depreciación se calcula aquí porque es lo único que el checklist
 * no puede mirar por su cuenta: `conta` no conoce el inventario de activos, y
 * el mock sí lo tiene delante. En el backend real lo resolverá una consulta al
 * módulo por su superficie pública, con la misma forma.
 */
function contextoCierre(periodo: Periodo): ContextoCierre {
  const origen = origenDepreciacion(periodo)
  const contabilizada = asientos.some(
    (a) =>
      a.origenModulo === 'activos' &&
      a.origenTipo === 'depreciacion' &&
      a.origenId === origen,
  )

  // Misma selección que la corrida (docs/07 §3.2): en uso, con la
  // depreciación ya empezada y con algo que depreciar todavía.
  const activosDepreciables = activosMock.filter(
    (a) =>
      a.estado === 'activo' &&
      a.fechaInicioDepreciacion <= periodo.fechaFin &&
      new Decimal(a.valorEnLibros).greaterThan(new Decimal(a.valorResidual)),
  ).length

  return {
    periodos: PERIODOS,
    asientos,
    cuentas: CUENTAS,
    // El día de hoy del servidor. El checklist no consulta el reloj por su
    // cuenta: recibe la fecha y así dos llamadas seguidas comparan lo mismo.
    fechaReferencia: hoyISO(),
    depreciacion: { contabilizada, activosDepreciables },
  }
}

/** Calcula el checklist. No escribe nada: es la mitad que solo mira. */
function checklistDe(periodo: Periodo): ChecklistCierre {
  const contexto = contextoCierre(periodo)
  const resultado = verificarCierre(periodo, contexto)
  return {
    periodo,
    fechaReferencia: contexto.fechaReferencia,
    verificaciones: [...resultado.verificaciones],
    puedeCerrar: resultado.puedeCerrar,
  }
}

/* ------------------------------------------------ Emisión de asientos */

export type ResultadoEmision =
  | { ok: true; asiento: Asiento; yaExistia: boolean }
  | { ok: false; error: { codigo: string; mensaje: string; detalles: string[] } }

/**
 * Contabiliza una solicitud de asiento.
 *
 * Es el único camino al mayor del mock, y lo usan igual la captura manual y los
 * módulos subsidiarios. Que CxC, CxP y activos pasen por aquí es lo que hace
 * que el mock se comporte como el backend descrito en docs/02: las mismas
 * validaciones, el mismo consecutivo compartido y la misma idempotencia por
 * origen, sin que ningún módulo escriba en el libro por su cuenta.
 */
export function emitirAsiento(solicitud: SolicitudAsiento): ResultadoEmision {
  // Idempotencia (docs/02 §4): mismo origen, se devuelve el asiento existente.
  if (solicitud.origen) {
    const existente = asientos.find(
      (a) =>
        a.origenModulo === solicitud.origen!.modulo &&
        a.origenTipo === solicitud.origen!.tipo &&
        a.origenId === solicitud.origen!.id,
    )
    if (existente) return { ok: true, asiento: existente, yaExistia: true }
  }

  const resultado = validarAsiento(solicitud, {
    cuentas: CUENTAS,
    periodos: PERIODOS,
    // Solo la captura manual tiene vedadas las cuentas de control: el módulo
    // dueño sí las mueve, y es justo lo que hace un asiento con origen.
    esManual: !solicitud.origen,
  })

  if (!resultado.valido) {
    const principal = resultado.errores[0]
    return {
      ok: false,
      error: {
        codigo: principal.codigo,
        mensaje: principal.mensaje,
        detalles: resultado.errores.map((e) =>
          e.linea === undefined
            ? e.mensaje
            : `Línea ${e.linea + 1}: ${e.mensaje}`,
        ),
      },
    }
  }

  // Consecutivo único por ejercicio, sin huecos (docs/03 §3). Se calcula al
  // emitir y no al cargar el módulo: al cambiar de empresa el libro que hay
  // delante es otro, y su numeración empieza donde ese libro se quedó.
  const ejercicio = ejercicioDeFecha(solicitud.fecha, PERIODOS)
  const consecutivo = siguienteNumero(asientos, ejercicio)
  const codigo = codigoAsiento(ejercicio, consecutivo)

  // Defensivo: con `siguienteNumero` no puede pasar, pero el backend lo
  // garantiza con un índice único y el mock tiene que rechazar lo mismo.
  if (!numeroDisponible(asientos, ejercicio, consecutivo)) {
    return {
      ok: false,
      error: {
        codigo: 'NUMERO_DUPLICADO',
        mensaje: `El asiento ${codigo} ya existe en el ejercicio ${ejercicio}`,
        detalles: [],
      },
    }
  }

  // El libro se materializa aquí: quien no lo mandó queda con los dos, y a
  // partir de este punto nadie más tiene que conocer el valor por omisión.
  const lineas: LineaAsiento[] = solicitud.lineas.map((l, i) => ({
    id: `lin-${ejercicio}-${consecutivo}-${i}`,
    orden: i + 1,
    cuentaCodigo: l.cuenta,
    cuentaNombre: CUENTA_POR_CODIGO.get(l.cuenta)?.nombre ?? l.cuenta,
    concepto: l.concepto ?? '',
    cargo: new Decimal(l.cargo || '0').toFixed(2),
    abono: new Decimal(l.abono || '0').toFixed(2),
    libros: [...librosDe(l)],
    centroCosto: l.centroCosto ?? null,
    auxiliarTipo: l.auxiliarTipo ?? null,
    auxiliarId: l.auxiliarId ?? null,
    auxiliarNombre: nombreAuxiliar(l.auxiliarTipo ?? null, l.auxiliarId ?? null),
  }))

  const esReversa =
    solicitud.origen?.modulo === 'conta' && solicitud.origen.tipo === 'reversa'

  const nuevo: Asiento = {
    id: idAsiento(ejercicio, consecutivo),
    numero: consecutivo,
    ejercicio,
    codigo,
    fecha: solicitud.fecha,
    concepto: solicitud.concepto,
    origenModulo: solicitud.origen?.modulo ?? null,
    origenTipo: solicitud.origen?.tipo ?? null,
    origenId: solicitud.origen?.id ?? null,
    moneda: solicitud.moneda,
    tipoCambio: solicitud.tipoCambio,
    estado: 'contabilizado',
    // El origen de una reversa apunta al asiento que neutraliza (docs/02 §6):
    // de ahí sale el enlace, sin un campo aparte que pudiera discrepar.
    reversaDeId: esReversa ? solicitud.origen!.id : null,
    reversadoPorId: null,
    motivoReversa: null,
    // Trazabilidad manual. El origen no se toca: son dos cosas distintas.
    documentoRelacionado: solicitud.documentoRelacionado ?? null,
    libros: librosAfectados(lineas),
    totales: resultado.totales.map((t) => ({
      libro: t.libro,
      totalCargos: t.totalCargos.toApi(),
      totalAbonos: t.totalAbonos.toApi(),
    })),
    lineas,
    creadoPor: 'demo@contikos.cr',
    creadoEn: new Date().toISOString(),
  }

  asientos.push(nuevo)
  persistirAsientos()
  return { ok: true, asiento: nuevo, yaExistia: false }
}

/* ------------------------------------------------ Reversa de asientos */

export type ResultadoReversa =
  | { ok: true; reversa: Asiento; yaExistia: boolean }
  | { ok: false; error: { codigo: string; mensaje: string; detalles: string[] } }

/**
 * Reversa un asiento (docs/02 §6).
 *
 * Emite la reversa por el mismo camino que todo lo demás (`emitirAsiento`) y
 * después marca el original. Es idempotente en el sentido de docs/02 §4:
 * repetir la misma solicitud sobre un asiento ya reversado devuelve la
 * reversa que ya existe; pedir OTRA reversa (otra fecha, otro motivo) se
 * rechaza con `ASIENTO_YA_REVERSADO`, porque un asiento se reversa una vez.
 *
 * Se exporta para que los módulos subsidiarios cancelen sus documentos por
 * aquí el día que lo hagan, igual que hoy contabilizan por `emitirAsiento`.
 */
export function reversarAsiento(
  asientoId: string,
  solicitud: SolicitudReversa,
): ResultadoReversa {
  const original = asientos.find((a) => a.id === asientoId)
  if (!original) {
    return {
      ok: false,
      error: {
        codigo: 'NO_ENCONTRADO',
        mensaje: 'Asiento no encontrado',
        detalles: [],
      },
    }
  }

  if (original.estado === 'reversado') {
    const reversa = asientos.find((a) => a.id === original.reversadoPorId)
    const misma =
      reversa &&
      reversa.fecha === solicitud.fecha &&
      original.motivoReversa === solicitud.motivo.trim()
    if (misma) return { ok: true, reversa, yaExistia: true }
  }

  const resultado = validarReversa(original, solicitud, {
    cuentas: CUENTAS,
    periodos: PERIODOS,
  })
  if (!resultado.valido) {
    const principal = resultado.errores[0]
    return {
      ok: false,
      error: {
        codigo: principal.codigo,
        mensaje: principal.mensaje,
        detalles: resultado.errores.map((e) => e.mensaje),
      },
    }
  }

  const emision = emitirAsiento(construirReversa(original, solicitud))
  if (!emision.ok) return emision

  // El original no se edita: cambia de estado y apunta a su reversa. Sus
  // líneas e importes quedan como estaban, que es lo que promete docs/02 §6.
  original.estado = 'reversado'
  original.reversadoPorId = emision.asiento.id
  original.motivoReversa = solicitud.motivo.trim()
  persistirAsientos()

  return { ok: true, reversa: emision.asiento, yaExistia: emision.yaExistia }
}

/* --------------------------------------- Catálogos de presentación */

/**
 * El contexto que ven las validaciones.
 *
 * Se construye en cada petición sobre el estado vigente del mock: los tres
 * catálogos se validan unos contra otros y una copia estancada haría que el
 * mock aceptara lo que la API real rechaza.
 */
function contextoCatalogo(): ContextoCatalogo {
  return {
    clasificaciones: clasificacionesMock,
    notas: notasMock,
    cuentas: CUENTAS,
  }
}

/**
 * El contexto que ven las reglas del catálogo de cuentas.
 *
 * Las cuentas con movimientos se recalculan en cada petición sobre los asientos
 * vigentes: una cuenta que hoy se puede reescribir deja de poder en cuanto
 * alguien la usa, y una lista congelada al arrancar no se enteraría.
 */
function contextoCuentas(cuenta?: Cuenta): ContextoCuenta {
  return {
    cuentas: CUENTAS,
    conMovimientos: new Set(
      asientos.flatMap((a) => a.lineas.map((l) => l.cuentaCodigo)),
    ),
    // El alta declara su presentación y hay que validarla contra los dos
    // catálogos vivos, no contra los que había al arrancar el mock.
    clasificaciones: clasificacionesMock,
    notas: notasMock,
    cuenta,
  }
}

/** Añade los campos derivados que el contrato promete. */
function serializarClasificacion(
  clasificacion: ClasificacionNiifBase,
): ClasificacionNiif {
  return {
    ...clasificacion,
    cuentas: cuentasDeClasificacion(clasificacion.id, CUENTAS).length,
    notas: notasDeClasificacion(clasificacion.id, notasMock).length,
  }
}

function serializarNota(nota: NotaEeffBase): NotaEeff {
  return { ...nota, cuentas: cuentasDeNota(nota.id, CUENTAS).length }
}

function rechazarCatalogo(resultado: ResultadoClasificacion) {
  const principal = resultado.errores[0]
  return errorApi(
    principal.codigo,
    principal.mensaje,
    resultado.errores.map((e) => e.mensaje),
  )
}

function noEncontrado(codigo: string, mensaje: string) {
  return HttpResponse.json({ codigo, mensaje }, { status: 404 })
}

/**
 * Id legible y estable, como el resto de la semilla.
 *
 * El código se normaliza para el id, así que dos códigos distintos (`A.01` y
 * `A-01`) producirían el mismo. Se desempata con un sufijo: el código es la
 * llave visible, pero el id tiene que ser único de verdad.
 */
function idClasificacion(codigo: string): string {
  const base = `niif-${codigo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  if (!clasificacionesMock.some((c) => c.id === base)) return base
  let n = 2
  while (clasificacionesMock.some((c) => c.id === `${base}-${n}`)) n += 1
  return `${base}-${n}`
}

const handlersCatalogosPresentacion = [
  http.get(rutaApi('/conta/clasificaciones-niif'), async () => {
    await latencia(90)
    return HttpResponse.json(
      ordenarClasificaciones(clasificacionesMock).map(serializarClasificacion),
    )
  }),

  http.post(rutaApi('/conta/clasificaciones-niif'), async ({ request }) => {
    await latencia(250)

    const parsed = SolicitudClasificacionNiifSchema.safeParse(
      await request.json(),
    )
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = {
      ...parsed.data,
      codigo: parsed.data.codigo.trim().toUpperCase(),
    }
    const resultado = validarClasificacion(solicitud, contextoCatalogo())
    if (!resultado.valido) return rechazarCatalogo(resultado)

    const nueva: ClasificacionNiifBase = {
      ...solicitud,
      id: idClasificacion(solicitud.codigo),
    }
    clasificacionesMock.push(nueva)
    persistirClasificaciones()
    return HttpResponse.json(serializarClasificacion(nueva), { status: 201 })
  }),

  http.put(rutaApi('/conta/clasificaciones-niif/:id'), async ({ params, request }) => {
    await latencia(250)

    const id = String(params.id)
    const indice = clasificacionesMock.findIndex((c) => c.id === id)
    if (indice === -1) {
      return noEncontrado(
        'CLASIFICACION_NO_ENCONTRADA',
        'La clasificación no está en el catálogo',
      )
    }

    const parsed = SolicitudClasificacionNiifSchema.safeParse(
      await request.json(),
    )
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = {
      ...parsed.data,
      codigo: parsed.data.codigo.trim().toUpperCase(),
    }
    const resultado = validarClasificacion(solicitud, contextoCatalogo(), id)
    if (!resultado.valido) return rechazarCatalogo(resultado)

    const actualizada: ClasificacionNiifBase = { ...solicitud, id }
    clasificacionesMock[indice] = actualizada
    persistirClasificaciones()
    return HttpResponse.json(serializarClasificacion(actualizada))
  }),

  http.delete(rutaApi('/conta/clasificaciones-niif/:id'), async ({ params }) => {
    await latencia(250)

    const id = String(params.id)
    const resultado = validarEliminacionClasificacion(id, contextoCatalogo())
    if (!resultado.valido) {
      return resultado.errores[0].codigo === 'CLASIFICACION_NO_ENCONTRADA'
        ? noEncontrado(
            'CLASIFICACION_NO_ENCONTRADA',
            'La clasificación no está en el catálogo',
          )
        : rechazarCatalogo(resultado)
    }

    clasificacionesMock.splice(
      clasificacionesMock.findIndex((c) => c.id === id),
      1,
    )
    persistirClasificaciones()
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(rutaApi('/conta/notas-eeff'), async () => {
    await latencia(90)
    return HttpResponse.json(
      [...notasMock]
        .sort(
          (a, b) => a.numero - b.numero || a.literal.localeCompare(b.literal),
        )
        .map(serializarNota),
    )
  }),

  http.post(rutaApi('/conta/notas-eeff'), async ({ request }) => {
    await latencia(250)

    const parsed = SolicitudNotaEeffSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = {
      ...parsed.data,
      literal: normalizarLiteral(parsed.data.literal),
    }
    const resultado = validarNota(solicitud, contextoCatalogo())
    if (!resultado.valido) return rechazarCatalogo(resultado)

    // La referencia (número + literal) es única en el catálogo (lo valida el
    // dominio), así que sirve de id sin más desempate.
    const nueva: NotaEeffBase = {
      ...solicitud,
      id: `nota-${String(solicitud.numero).padStart(2, '0')}${solicitud.literal}`,
    }
    notasMock.push(nueva)
    persistirNotas()
    return HttpResponse.json(serializarNota(nueva), { status: 201 })
  }),

  http.put(rutaApi('/conta/notas-eeff/:id'), async ({ params, request }) => {
    await latencia(250)

    const id = String(params.id)
    const indice = notasMock.findIndex((n) => n.id === id)
    if (indice === -1) {
      return noEncontrado('NOTA_NO_ENCONTRADA', 'La nota no está en el catálogo')
    }

    const parsed = SolicitudNotaEeffSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const solicitud = {
      ...parsed.data,
      literal: normalizarLiteral(parsed.data.literal),
    }
    const resultado = validarNota(solicitud, contextoCatalogo(), id)
    if (!resultado.valido) return rechazarCatalogo(resultado)

    const actualizada: NotaEeffBase = { ...solicitud, id }
    notasMock[indice] = actualizada
    persistirNotas()
    return HttpResponse.json(serializarNota(actualizada))
  }),

  http.delete(rutaApi('/conta/notas-eeff/:id'), async ({ params }) => {
    await latencia(250)

    const id = String(params.id)
    const resultado = validarEliminacionNota(id, contextoCatalogo())
    if (!resultado.valido) {
      return resultado.errores[0].codigo === 'NOTA_NO_ENCONTRADA'
        ? noEncontrado('NOTA_NO_ENCONTRADA', 'La nota no está en el catálogo')
        : rechazarCatalogo(resultado)
    }

    notasMock.splice(
      notasMock.findIndex((n) => n.id === id),
      1,
    )
    persistirNotas()
    return new HttpResponse(null, { status: 204 })
  }),

  /**
   * Asignar a una cuenta su renglón y su nota.
   *
   * Endpoint propio y no un PUT de la cuenta entera: es otra decisión, con otro
   * permiso y otras reglas. Devuelve la cuenta ya actualizada para que la
   * pantalla no tenga que recomponerla.
   */
  http.put(rutaApi('/conta/cuentas/:id/clasificacion'), async ({ params, request }) => {
    await latencia(250)

    const id = String(params.id)
    const cuenta = CUENTAS.find((c) => c.id === id)
    if (!cuenta) {
      return noEncontrado('CUENTA_NO_ENCONTRADA', 'La cuenta no está en el catálogo')
    }

    const parsed = SolicitudClasificacionCuentaSchema.safeParse(
      await request.json(),
    )
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const resultado = validarClasificacionCuenta(
      id,
      parsed.data,
      contextoCatalogo(),
    )
    if (!resultado.valido) return rechazarCatalogo(resultado)

    cuenta.clasificacionNiifId = parsed.data.clasificacionNiifId
    cuenta.notaEeffId = parsed.data.notaEeffId
    persistirCuentas()
    return HttpResponse.json(cuenta)
  }),
]

export const handlersConta = [
  http.get(rutaApi('/conta/cuentas'), async () => {
    await latencia(120)
    return HttpResponse.json(CUENTAS)
  }),

  http.post(rutaApi('/conta/cuentas'), async ({ request }) => {
    await latencia(250)

    const parsed = SolicitudCuentaSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const resultado = validarCuenta(parsed.data, contextoCuentas())
    if (!resultado.valido) {
      const principal = resultado.errores[0]
      return errorApi(
        principal.codigo,
        principal.mensaje,
        resultado.errores.map((e) => e.mensaje),
      )
    }

    const solicitud = parsed.data
    const codigoPadre = codigoPadreDe(solicitud.codigo)

    // Nace clasificada: la validación ya exigió el renglón y la nota si es una
    // cuenta de detalle, y los prohibió si es acumulativa.
    return HttpResponse.json(
      registrarCuenta({
        id: `cta-${solicitud.codigo}`,
        codigo: solicitud.codigo,
        nombre: solicitud.nombre.trim(),
        cuentaPadreId: codigoPadre ? `cta-${codigoPadre}` : null,
        nivel: nivelDe(solicitud.codigo),
        naturaleza: solicitud.naturaleza,
        tipo: solicitud.tipo,
        esDetalle: solicitud.esDetalle,
        requiereAuxiliar: solicitud.requiereAuxiliar,
        esCuentaControl: solicitud.moduloDueno !== null,
        moduloDueno: solicitud.moduloDueno,
        clasificacionNiifId: solicitud.clasificacionNiifId,
        notaEeffId: solicitud.notaEeffId,
        moneda: solicitud.moneda,
        activa: solicitud.activa,
      }),
      { status: 201 },
    )
  }),

  http.put(rutaApi('/conta/cuentas/:id'), async ({ params, request }) => {
    await latencia(250)

    const cuenta = CUENTAS.find((c) => c.id === String(params.id))
    if (!cuenta) {
      return noEncontrado(
        'CUENTA_NO_ENCONTRADA',
        'La cuenta no está en el catálogo',
      )
    }

    const parsed = SolicitudCuentaSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const resultado = validarCuenta(parsed.data, contextoCuentas(cuenta))
    if (!resultado.valido) {
      const principal = resultado.errores[0]
      return errorApi(
        principal.codigo,
        principal.mensaje,
        resultado.errores.map((e) => e.mensaje),
      )
    }

    // Se muta en su sitio: el catálogo se sirve por referencia y el orden del
    // array es el del árbol. El código no cambia, así que la posición tampoco.
    Object.assign(cuenta, {
      nombre: parsed.data.nombre.trim(),
      tipo: parsed.data.tipo,
      naturaleza: parsed.data.naturaleza,
      esDetalle: parsed.data.esDetalle,
      requiereAuxiliar: parsed.data.requiereAuxiliar,
      esCuentaControl: parsed.data.moduloDueno !== null,
      moduloDueno: parsed.data.moduloDueno,
      moneda: parsed.data.moneda,
      clasificacionNiifId: parsed.data.clasificacionNiifId,
      notaEeffId: parsed.data.notaEeffId,
      activa: parsed.data.activa,
    })
    persistirCuentas()
    return HttpResponse.json(cuenta)
  }),

  http.get(rutaApi('/conta/periodos'), async () => {
    await latencia(80)
    return HttpResponse.json(PERIODOS)
  }),

  /**
   * Checklist de cierre del periodo (docs/03 §5). Calcula y no escribe.
   *
   * Es la misma función que decide el cierre, con los mismos datos: lo que se
   * enseña en pantalla es exactamente lo que se va a evaluar al pulsar cerrar.
   */
  http.get(rutaApi('/conta/periodos/:id/verificacion'), async ({ params }) => {
    await latencia(180)
    const periodo = PERIODOS.find((p) => p.id === String(params.id))
    if (!periodo) {
      return noEncontrado('PERIODO_NO_ENCONTRADO', 'El periodo no existe')
    }
    return HttpResponse.json(checklistDe(periodo))
  }),

  /**
   * Cierra el periodo.
   *
   * Recalcula el checklist en vez de recibirlo del cliente: lo que decide es
   * el estado del libro ahora, no el que alguien vio hace diez minutos en otra
   * pestaña. Un error lo rechaza siempre; un aviso solo se salta con la
   * confirmación y el motivo, que quedan en la bitácora del periodo.
   */
  http.post(rutaApi('/conta/periodos/:id/cerrar'), async ({ params, request }) => {
    await latencia(400)

    const periodo = PERIODOS.find((p) => p.id === String(params.id))
    if (!periodo) {
      return noEncontrado('PERIODO_NO_ENCONTRADO', 'El periodo no existe')
    }

    const parsed = SolicitudCierreSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const resultado = verificarCierre(periodo, contextoCierre(periodo))
    const decision = decidirCierre(resultado, parsed.data)
    if (!decision.ok) {
      return errorApi(
        decision.error.codigo,
        decision.error.mensaje,
        [...decision.error.detalles],
      )
    }

    // Se muta el periodo del array vivo: media aplicación lo tiene importado
    // por referencia, y un cierre en una copia dejaría el mes admitiendo
    // asientos para todos los demás.
    periodo.estado = 'cerrado'
    periodo.cerradoEn = new Date().toISOString()
    periodo.cerradoPor = 'demo@contikos.cr'
    // El motivo se guarda solo cuando hubo avisos que autorizar: un cierre
    // limpio no tiene nada que justificar, y escribir ahí el texto que el
    // usuario dejó de una vez anterior sería inventar una excepción.
    periodo.motivoCierre =
      decision.avisos.length > 0 ? parsed.data.motivo.trim() : null
    persistirPeriodos()

    return HttpResponse.json(periodo)
  }),

  /**
   * Reabre un periodo cerrado (docs/03 §5).
   *
   * El bloqueado no se reabre nunca: se usa tras presentar declaraciones o
   * cerrar el ejercicio, y volver a moverlo dejaría el mayor diciendo algo
   * distinto de lo ya declarado.
   */
  http.post(rutaApi('/conta/periodos/:id/reabrir'), async ({ params }) => {
    await latencia(300)

    const periodo = PERIODOS.find((p) => p.id === String(params.id))
    if (!periodo) {
      return noEncontrado('PERIODO_NO_ENCONTRADO', 'El periodo no existe')
    }

    const resultado = validarReapertura(periodo)
    if (!resultado.valido) {
      return errorApi(resultado.error!.codigo, resultado.error!.mensaje)
    }

    periodo.estado = 'abierto'
    // La bitácora del cierre NO se borra: lo que dice es que ese cierre
    // ocurrió, no que el periodo esté cerrado hoy. Borrarla al reabrir sería
    // perder el rastro de quién lo cerró y por qué.
    persistirPeriodos()

    return HttpResponse.json(periodo)
  }),

  http.get(rutaApi('/conta/asientos'), async ({ request }) => {
    await latencia(150)
    const url = new URL(request.url)
    const periodoId = url.searchParams.get('periodoId')
    const periodo = PERIODOS.find((p) => p.id === periodoId)
    const libro = url.searchParams.get('libro')

    let filtrados = periodo
      ? asientos.filter(
          (a) => a.fecha >= periodo.fechaInicio && a.fecha <= periodo.fechaFin,
        )
      : asientos

    // Sin `libro` se listan todos: la pantalla de asientos es la vista donde
    // las dos contabilidades se ven juntas.
    if (esLibro(libro)) {
      filtrados = filtrados.filter((a) => a.libros.includes(libro))
    }

    // Consulta inversa desde un documento: el asiento que lo generó (origen)
    // Y los manuales que lo mencionan (documentoRelacionado). Los tres
    // parámetros van juntos: un id de factura solo identifica dentro de su
    // módulo y su tipo.
    const documentoModulo = url.searchParams.get('documentoModulo')
    const documentoTipo = url.searchParams.get('documentoTipo')
    const documentoId = url.searchParams.get('documentoId')
    if (documentoModulo && documentoTipo && documentoId) {
      filtrados = filtrados.filter(
        (a) =>
          (a.origenModulo === documentoModulo &&
            a.origenTipo === documentoTipo &&
            a.origenId === documentoId) ||
          (a.documentoRelacionado?.modulo === documentoModulo &&
            a.documentoRelacionado.tipo === documentoTipo &&
            a.documentoRelacionado.id === documentoId),
      )
    }

    return HttpResponse.json(
      [...filtrados].sort(
        (a, b) => b.fecha.localeCompare(a.fecha) || b.numero - a.numero,
      ),
    )
  }),

  http.get(rutaApi('/conta/asientos/:id'), async ({ params }) => {
    await latencia(100)
    const asiento = asientos.find((a) => a.id === params.id)
    if (!asiento) {
      return HttpResponse.json(
        { codigo: 'NO_ENCONTRADO', mensaje: 'Asiento no encontrado' },
        { status: 404 },
      )
    }
    return HttpResponse.json(asiento)
  }),

  http.get(rutaApi('/conta/balanza'), async ({ request }) => {
    await latencia(200)
    const url = new URL(request.url)
    const periodoId = url.searchParams.get('periodoId') ?? ''
    const solicitado = url.searchParams.get('libro')
    // La balanza es siempre de un libro. Sin indicarlo se devuelve el fiscal:
    // es el que se declara, y equivocarse de libro en un reporte es caro.
    const libro: Libro = esLibro(solicitado) ? solicitado : 'fiscal'
    const balanza = construirBalanza(periodoId, libro)
    if (!balanza) {
      return HttpResponse.json(
        { codigo: 'NO_ENCONTRADO', mensaje: 'Periodo no encontrado' },
        { status: 404 },
      )
    }
    return HttpResponse.json(balanza)
  }),

  /**
   * Balanza comparativa entre dos periodos (docs/09 §3.2).
   *
   * Construye las DOS balanzas por el mismo camino que la sencilla y las cruza
   * en dominio puro. El motor de saldos es uno solo: una comparativa que
   * sumara por su cuenta acabaría enseñando para agosto una cifra distinta de
   * la que enseña la balanza de agosto.
   */
  http.get(rutaApi('/conta/balanza/comparativa'), async ({ request }) => {
    await latencia(280)
    const url = new URL(request.url)
    const solicitado = url.searchParams.get('libro')
    const libro: Libro = esLibro(solicitado) ? solicitado : 'fiscal'

    const balanzaA = construirBalanza(
      url.searchParams.get('periodoA') ?? '',
      libro,
    )
    const balanzaB = construirBalanza(
      url.searchParams.get('periodoB') ?? '',
      libro,
    )
    if (!balanzaA || !balanzaB) {
      return noEncontrado('PERIODO_NO_ENCONTRADO', 'El periodo no existe')
    }

    return HttpResponse.json(compararBalanzas(balanzaA, balanzaB))
  }),

  http.post(rutaApi('/conta/asientos'), async ({ request }) => {
    await latencia(400)

    const cuerpo = await request.json()
    const parsed = SolicitudAsientoSchema.safeParse(cuerpo)
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const emision = emitirAsiento(parsed.data)
    if (!emision.ok) {
      return errorApi(
        emision.error.codigo,
        emision.error.mensaje,
        emision.error.detalles,
      )
    }

    return HttpResponse.json(emision.asiento, {
      status: emision.yaExistia ? 200 : 201,
    })
  }),

  /**
   * Reversa de un asiento (docs/02 §6). Devuelve el asiento de reversa; el
   * original se consulta aparte y llega ya con estado `reversado`.
   */
  http.post(rutaApi('/conta/asientos/:id/reversar'), async ({ params, request }) => {
    await latencia(400)

    const parsed = SolicitudReversaSchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorApi(
        'SOLICITUD_INVALIDA',
        'La solicitud no cumple el contrato',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const resultado = reversarAsiento(String(params.id), parsed.data)
    if (!resultado.ok) {
      return resultado.error.codigo === 'NO_ENCONTRADO'
        ? noEncontrado('NO_ENCONTRADO', 'Asiento no encontrado')
        : errorApi(
            resultado.error.codigo,
            resultado.error.mensaje,
            resultado.error.detalles,
          )
    }

    return HttpResponse.json(resultado.reversa, {
      status: resultado.yaExistia ? 200 : 201,
    })
  }),

  ...handlersCatalogosPresentacion,
]
