import Decimal from 'decimal.js'
import { LIBROS_TODOS, type Libro } from '@/shared/api/contracts/comunes'
import type {
  Asiento,
  Cuenta,
  Periodo,
  VerificacionCierre,
} from '@/shared/api/contracts/conta'
import { etiquetaLibro, lineaAfecta } from '@/shared/asiento/libro'
import { nombreMes } from '@/shared/format/fecha'

/**
 * Cierre y reapertura de periodos (docs/03 §5).
 *
 * Cerrar un periodo no es cambiar un estado: es declarar que el mes ya no
 * admite movimientos, y eso solo se puede afirmar después de comprobarlo. El
 * checklist de docs/03 §5 es esa comprobación, y aquí está entera y pura:
 * recibe el mayor, el catálogo y los periodos, y devuelve un semáforo por
 * punto. Quien escribe (el mock hoy, el backend mañana) lo llama dos veces con
 * los mismos datos, una para enseñarlo y otra para decidir si cierra, y por
 * construcción obtiene lo mismo. Es el modelo de la corrida de depreciación
 * (docs/07 §3.2), por la misma razón: lo que se revisó es lo que se aplica.
 *
 * Un `error` impide cerrar; un `aviso` no, pero exige que alguien lo lea y lo
 * confirme (docs/03 §5: "el cierre con excepciones requiere autorización
 * explícita y queda registrado"); un `ok` es el punto que ya está bien, y se
 * devuelve igualmente para que el checklist esté completo en pantalla y no
 * solo cuando algo falla.
 *
 * NO valida que un asiento caiga en periodo abierto: de eso se ocupa
 * `periodoDeFecha` en `asiento.ts`, que es donde se rechaza el movimiento. Aquí
 * se decide si el periodo puede pasar a cerrado; allí, qué pasa después.
 */

export type CodigoVerificacionCierre =
  | 'PERIODO_YA_CERRADO'
  | 'PERIODO_ANTERIOR_ABIERTO'
  | 'FECHA_FUTURA'
  | 'ASIENTOS_FUERA_DE_RANGO'
  | 'BALANZA_DESCUADRADA'
  | 'AUXILIARES_SIN_CUADRAR'
  | 'DEPRECIACION_PENDIENTE'
  | 'NOMINA_PENDIENTE'
  | 'BANCOS_SIN_CONCILIAR'
  | 'REVALUACION_PENDIENTE'

/** Lo que el checklist necesita saber del resto del sistema. */
export interface ContextoCierre {
  /** Todos los periodos del catálogo, para ubicar el anterior. */
  readonly periodos: readonly Periodo[]
  /** El mayor entero. El checklist filtra lo que necesita de cada punto. */
  readonly asientos: readonly Asiento[]
  readonly cuentas: readonly Cuenta[]
  /**
   * Hoy, según quien pregunta.
   *
   * Es un parámetro y no `new Date()` a propósito: un checklist que consulta el
   * reloj por su cuenta no se puede probar, y el día que el backend cierre
   * periodos por lote querrá pasarle la fecha del proceso, no la del servidor.
   */
  readonly fechaReferencia: string
  /**
   * Estado de la corrida de depreciación del periodo.
   *
   * Llega calculado en vez de deducirse aquí porque `conta` no conoce a
   * `activos` (docs/14 §3.1): quien arma el contexto sí puede mirar el
   * inventario y la terna de origen de la corrida.
   */
  readonly depreciacion: {
    /** true si ya hay un asiento con el origen de la corrida del periodo. */
    readonly contabilizada: boolean
    /** Cuántos activos se depreciarían en el periodo. Cero: nada que correr. */
    readonly activosDepreciables: number
  }
  /**
   * Estado de la tesorería al cierre (docs/06 §2.3 y §6).
   *
   * Llega calculado por la misma razón que la depreciación: `conta` no conoce a
   * `bancos`, y quien arma el contexto sí puede mirar el auxiliar bancario y la
   * terna de origen de la revaluación.
   */
  readonly bancos: {
    /** Movimientos propios sin conciliar hasta el fin del periodo. */
    readonly movimientosSinConciliar: number
    /** Cuentas bancarias con algo sin conciliar. Cero: todo cuadrado. */
    readonly cuentasSinConciliar: number
    /** true si la revaluación del periodo ya tiene su asiento. */
    readonly revaluacionContabilizada: boolean
    /** Cuentas activas en moneda extranjera. Cero: nada que revaluar. */
    readonly cuentasEnMonedaExtranjera: number
  }
}

export interface ResultadoCierre {
  readonly verificaciones: readonly VerificacionCierre[]
  /** Ningún error. Los avisos se saltan con autorización explícita. */
  readonly puedeCerrar: boolean
}

const CERO = new Decimal(0)

const dosDigitos = (n: number): string => String(n).padStart(2, '0')

export function etiquetaPeriodo(periodo: Periodo): string {
  return `${nombreMes(periodo.numero)} ${periodo.ejercicio}`
}

/**
 * El mes anterior DEL MISMO EJERCICIO.
 *
 * No se cruza al ejercicio anterior a propósito: al cerrar el ejercicio todos
 * sus periodos pasan a bloqueado (docs/03 §6), así que enero nunca espera a un
 * diciembre abierto. Lo que esta regla evita es cerrar agosto dejando julio
 * vivo, porque entonces un asiento de julio seguiría cambiando saldos que
 * agosto ya dio por buenos.
 */
export function periodoAnterior(
  periodo: Periodo,
  periodos: readonly Periodo[],
): Periodo | undefined {
  return periodos.find(
    (p) => p.ejercicio === periodo.ejercicio && p.numero === periodo.numero - 1,
  )
}

export function asientosDelPeriodo(
  periodo: Periodo,
  asientos: readonly Asiento[],
): readonly Asiento[] {
  return asientos.filter(
    (a) => a.fecha >= periodo.fechaInicio && a.fecha <= periodo.fechaFin,
  )
}

/**
 * Sufijo con el que una corrida mensual nombra a su periodo: `-2026-08`.
 *
 * Los orígenes de los procesos de cierre (la depreciación es el primero, la
 * revaluación y la nómina irán igual) llevan el periodo en el id. Se usa para
 * detectar el asiento que dice ser de un mes y quedó fechado en otro.
 */
function sufijoPeriodo(periodo: Periodo): string {
  return `-${periodo.ejercicio}-${dosDigitos(periodo.numero)}`
}

function verificacion(
  codigo: CodigoVerificacionCierre,
  severidad: VerificacionCierre['severidad'],
  mensaje: string,
  detalle?: string,
): VerificacionCierre {
  return detalle === undefined
    ? { codigo, severidad, mensaje }
    : { codigo, severidad, mensaje, detalle }
}

/* ------------------------------------------------------ Los puntos */

/** 0: el periodo tiene que estar abierto. Cerrar lo cerrado no es cerrar. */
function comprobarEstado(periodo: Periodo): VerificacionCierre {
  if (periodo.estado === 'abierto') {
    return verificacion(
      'PERIODO_YA_CERRADO',
      'ok',
      `${etiquetaPeriodo(periodo)} está abierto`,
    )
  }
  return verificacion(
    'PERIODO_YA_CERRADO',
    'error',
    `${etiquetaPeriodo(periodo)} ya está ${periodo.estado}`,
    periodo.estado === 'bloqueado'
      ? 'Un periodo bloqueado no vuelve a cambiar de estado'
      : 'Para volver a cerrarlo, primero hay que reabrirlo',
  )
}

/** 1: los meses se cierran en orden. */
function comprobarAnterior(
  periodo: Periodo,
  periodos: readonly Periodo[],
): VerificacionCierre {
  const anterior = periodoAnterior(periodo, periodos)
  if (!anterior) {
    return verificacion(
      'PERIODO_ANTERIOR_ABIERTO',
      'ok',
      `${etiquetaPeriodo(periodo)} es el primer periodo del ejercicio`,
    )
  }
  if (anterior.estado === 'abierto') {
    return verificacion(
      'PERIODO_ANTERIOR_ABIERTO',
      'error',
      `${etiquetaPeriodo(anterior)} sigue abierto y los meses se cierran en orden`,
      'Un asiento en el mes anterior cambiaría el saldo inicial de este',
    )
  }
  return verificacion(
    'PERIODO_ANTERIOR_ABIERTO',
    'ok',
    `${etiquetaPeriodo(anterior)} está ${anterior.estado}`,
  )
}

/** 2: no se cierra un mes que todavía no ha terminado. */
function comprobarFecha(
  periodo: Periodo,
  fechaReferencia: string,
): VerificacionCierre {
  if (fechaReferencia < periodo.fechaFin) {
    return verificacion(
      'FECHA_FUTURA',
      'error',
      `${etiquetaPeriodo(periodo)} termina el ${periodo.fechaFin} y todavía está en curso`,
      `Fecha de referencia: ${fechaReferencia}`,
    )
  }
  return verificacion(
    'FECHA_FUTURA',
    'ok',
    `El periodo terminó el ${periodo.fechaFin}`,
  )
}

/**
 * 3: integridad de fechas.
 *
 * La pertenencia de un asiento a un periodo la da su fecha, así que lo que se
 * comprueba es que las OTRAS dos formas de decirlo digan lo mismo: el
 * `ejercicio` que el asiento lleva materializado y el periodo que declara su
 * origen. Un asiento fechado en agosto pero registrado en otro ejercicio, o una
 * corrida de agosto contabilizada con fecha de setiembre, son movimientos que
 * el mes no vería y que dejarían el cierre mintiendo.
 */
function comprobarRango(
  periodo: Periodo,
  asientos: readonly Asiento[],
): VerificacionCierre {
  const sufijo = sufijoPeriodo(periodo)
  const desviados: string[] = []

  for (const asiento of asientos) {
    const enRango =
      asiento.fecha >= periodo.fechaInicio && asiento.fecha <= periodo.fechaFin
    if (enRango && asiento.ejercicio !== periodo.ejercicio) {
      desviados.push(
        `${asiento.codigo} tiene fecha ${asiento.fecha} pero está registrado en el ejercicio ${asiento.ejercicio}`,
      )
    }
    if (!enRango && asiento.origenId?.endsWith(sufijo)) {
      desviados.push(
        `${asiento.codigo} declara ser de este periodo (origen ${asiento.origenId}) y tiene fecha ${asiento.fecha}`,
      )
    }
  }

  if (desviados.length > 0) {
    return verificacion(
      'ASIENTOS_FUERA_DE_RANGO',
      'error',
      `${desviados.length} asiento${desviados.length === 1 ? '' : 's'} no cuadra${desviados.length === 1 ? '' : 'n'} con el rango ${periodo.fechaInicio} a ${periodo.fechaFin}`,
      desviados.join('; '),
    )
  }

  const cuantos = asientosDelPeriodo(periodo, asientos).length
  return verificacion(
    'ASIENTOS_FUERA_DE_RANGO',
    'ok',
    `Los ${cuantos} asiento${cuantos === 1 ? '' : 's'} del periodo caen dentro de ${periodo.fechaInicio} a ${periodo.fechaFin}`,
  )
}

/** 4: el mes cuadra, libro por libro. Uno por libro: cada mayor es suyo. */
function comprobarBalanza(
  periodo: Periodo,
  asientos: readonly Asiento[],
  libro: Libro,
): VerificacionCierre {
  let cargos = CERO
  let abonos = CERO
  for (const asiento of asientosDelPeriodo(periodo, asientos)) {
    for (const linea of asiento.lineas) {
      if (!lineaAfecta(linea, libro)) continue
      cargos = cargos.plus(new Decimal(linea.cargo))
      abonos = abonos.plus(new Decimal(linea.abono))
    }
  }

  const etiqueta = etiquetaLibro(libro).toLowerCase()
  if (!cargos.equals(abonos)) {
    return verificacion(
      'BALANZA_DESCUADRADA',
      'error',
      `La contabilidad ${etiqueta} no cuadra en el periodo: diferencia de ${cargos.minus(abonos).toFixed(2)}`,
      `Cargos ${cargos.toFixed(2)} contra abonos ${abonos.toFixed(2)}`,
    )
  }
  return verificacion(
    'BALANZA_DESCUADRADA',
    'ok',
    `La contabilidad ${etiqueta} cuadra: ${cargos.toFixed(2)} de cargos y de abonos`,
  )
}

/**
 * 5: los auxiliares cuadran contra sus cuentas de control.
 *
 * LIMITACIÓN CONOCIDA: se compara el saldo de la cuenta de control contra la
 * suma de sus líneas por auxiliar DEL PROPIO MAYOR, no contra el auxiliar de
 * CxC o de CxP. Es lo que `conta` puede afirmar sin importar de otro módulo
 * (docs/14 §3.1), y lo que detecta es el movimiento que entró a la cuenta de
 * control sin decir de quién es: ese saldo no está en el auxiliar de nadie y
 * es exactamente la forma en que el mayor y el auxiliar se separan. La
 * conciliación completa contra el saldo del cliente y del proveedor la hará
 * reportes, que sí puede leer los tres (docs/09 §2).
 *
 * Se acumula sobre TODO el mayor hasta el fin del periodo y sin distinguir
 * libro: el auxiliar es común a las dos contabilidades (docs/02 §3.1), y un
 * descuadre arrastrado de meses anteriores sigue sin cuadrar hoy.
 */
function comprobarAuxiliares(
  periodo: Periodo,
  contexto: ContextoCierre,
): VerificacionCierre {
  const conAuxiliar = contexto.cuentas.filter(
    (c) => c.esCuentaControl && c.requiereAuxiliar !== null,
  )
  const porCodigo = new Map(conAuxiliar.map((c) => [c.codigo, c]))
  const sinAuxiliar = new Map<string, Decimal>()

  for (const asiento of contexto.asientos) {
    if (asiento.fecha > periodo.fechaFin) continue
    for (const linea of asiento.lineas) {
      if (!porCodigo.has(linea.cuentaCodigo)) continue
      if (linea.auxiliarId) continue
      const acumulado = sinAuxiliar.get(linea.cuentaCodigo) ?? CERO
      sinAuxiliar.set(
        linea.cuentaCodigo,
        acumulado.plus(new Decimal(linea.cargo)).minus(new Decimal(linea.abono)),
      )
    }
  }

  const descuadradas = [...sinAuxiliar.entries()].filter(
    ([, saldo]) => !saldo.isZero(),
  )

  if (descuadradas.length > 0) {
    return verificacion(
      'AUXILIARES_SIN_CUADRAR',
      'aviso',
      `${descuadradas.length} cuenta${descuadradas.length === 1 ? '' : 's'} de control con saldo que no está en ningún auxiliar`,
      descuadradas
        .map(
          ([codigo, saldo]) =>
            `${codigo} ${porCodigo.get(codigo)!.nombre}: ${saldo.toFixed(2)} sin auxiliar`,
        )
        .join('; '),
    )
  }

  return verificacion(
    'AUXILIARES_SIN_CUADRAR',
    'ok',
    `Las ${conAuxiliar.length} cuentas de control con auxiliar cuadran contra su detalle en el mayor`,
  )
}

/** 6: la depreciación del mes corrió (docs/03 §5, punto 3). */
function comprobarDepreciacion(
  periodo: Periodo,
  contexto: ContextoCierre,
): VerificacionCierre {
  const { contabilizada, activosDepreciables } = contexto.depreciacion

  if (contabilizada) {
    return verificacion(
      'DEPRECIACION_PENDIENTE',
      'ok',
      `La depreciación de ${etiquetaPeriodo(periodo)} está contabilizada`,
    )
  }
  if (activosDepreciables === 0) {
    return verificacion(
      'DEPRECIACION_PENDIENTE',
      'ok',
      'No hay activos que se depreciaran en el periodo',
    )
  }
  // Aviso y no error: la empresa puede decidir cerrar sin la corrida y
  // registrarla como excepción. Lo que no puede es no enterarse.
  return verificacion(
    'DEPRECIACION_PENDIENTE',
    'aviso',
    `La depreciación de ${etiquetaPeriodo(periodo)} no está contabilizada`,
    `${activosDepreciables} activo${activosDepreciables === 1 ? '' : 's'} se depreciaría${activosDepreciables === 1 ? '' : 'n'} en el periodo`,
  )
}

/** 7: las cuentas bancarias están conciliadas (docs/03 §5, docs/06 §2.3). */
function comprobarConciliacion(
  periodo: Periodo,
  contexto: ContextoCierre,
): VerificacionCierre {
  const { movimientosSinConciliar, cuentasSinConciliar } = contexto.bancos

  if (movimientosSinConciliar === 0) {
    return verificacion(
      'BANCOS_SIN_CONCILIAR',
      'ok',
      'Las cuentas bancarias están conciliadas',
    )
  }

  // Aviso y no error, igual que la depreciación: hay meses en que el estado de
  // cuenta llega después del cierre, y la empresa puede decidir cerrar con
  // partidas en tránsito. Lo que no puede es no enterarse.
  return verificacion(
    'BANCOS_SIN_CONCILIAR',
    'aviso',
    `Quedan ${movimientosSinConciliar} movimientos sin conciliar al cerrar ${etiquetaPeriodo(periodo)}`,
    `En ${cuentasSinConciliar} cuenta${cuentasSinConciliar === 1 ? '' : 's'} bancaria${cuentasSinConciliar === 1 ? '' : 's'}`,
  )
}

/** 8: la revaluación en moneda extranjera corrió (docs/06 §6). */
function comprobarRevaluacion(
  periodo: Periodo,
  contexto: ContextoCierre,
): VerificacionCierre {
  const { revaluacionContabilizada, cuentasEnMonedaExtranjera } = contexto.bancos

  if (revaluacionContabilizada) {
    return verificacion(
      'REVALUACION_PENDIENTE',
      'ok',
      `La revaluación de ${etiquetaPeriodo(periodo)} está contabilizada`,
    )
  }
  if (cuentasEnMonedaExtranjera === 0) {
    return verificacion(
      'REVALUACION_PENDIENTE',
      'ok',
      'No hay cuentas en moneda extranjera que revaluar',
    )
  }
  return verificacion(
    'REVALUACION_PENDIENTE',
    'aviso',
    `La revaluación de ${etiquetaPeriodo(periodo)} no está contabilizada`,
    `${cuentasEnMonedaExtranjera} cuenta${cuentasEnMonedaExtranjera === 1 ? '' : 's'} en moneda extranjera se revaluaría${cuentasEnMonedaExtranjera === 1 ? '' : 'n'}`,
  )
}

/**
 * 9: el punto del checklist que todavía no tiene módulo.
 *
 * Se declara desde ahora, en `ok` y con el detalle que lo explica, para que el
 * checklist de docs/03 §5 esté completo en pantalla: el día que exista nómina,
 * lo único que cambia es de dónde sale la severidad. Un checklist al que le
 * falta un punto enseña un cierre más limpio de lo que es.
 */
const PENDIENTES_DE_MODULO: readonly {
  codigo: CodigoVerificacionCierre
  mensaje: string
}[] = [
  { codigo: 'NOMINA_PENDIENTE', mensaje: 'La nómina del mes está contabilizada' },
]

/* ------------------------------------------------------ El checklist */

export function verificarCierre(
  periodo: Periodo,
  contexto: ContextoCierre,
): ResultadoCierre {
  const verificaciones: VerificacionCierre[] = [
    comprobarEstado(periodo),
    comprobarAnterior(periodo, contexto.periodos),
    comprobarFecha(periodo, contexto.fechaReferencia),
    comprobarRango(periodo, contexto.asientos),
    ...LIBROS_TODOS.map((libro) =>
      comprobarBalanza(periodo, contexto.asientos, libro),
    ),
    comprobarAuxiliares(periodo, contexto),
    comprobarDepreciacion(periodo, contexto),
    comprobarConciliacion(periodo, contexto),
    comprobarRevaluacion(periodo, contexto),
    ...PENDIENTES_DE_MODULO.map((p) =>
      verificacion(p.codigo, 'ok', p.mensaje, 'El módulo aún no existe'),
    ),
  ]

  return {
    verificaciones,
    puedeCerrar: !verificaciones.some((v) => v.severidad === 'error'),
  }
}

/** Los avisos son los que exigen autorización explícita para cerrar. */
export function avisosDe(
  verificaciones: readonly VerificacionCierre[],
): readonly VerificacionCierre[] {
  return verificaciones.filter((v) => v.severidad === 'aviso')
}

export function erroresDe(
  verificaciones: readonly VerificacionCierre[],
): readonly VerificacionCierre[] {
  return verificaciones.filter((v) => v.severidad === 'error')
}

/* ---------------------------------------------- Decisión de cierre */

export type CodigoErrorCierre =
  | 'CIERRE_CON_ERRORES'
  | 'CIERRE_CON_AVISOS'
  | 'MOTIVO_CIERRE_REQUERIDO'

export interface ErrorCierre {
  readonly codigo: CodigoErrorCierre
  readonly mensaje: string
  /** Los puntos del checklist que lo provocan, ya en texto. */
  readonly detalles: readonly string[]
}

export type DecisionCierre =
  | { readonly ok: true; readonly avisos: readonly VerificacionCierre[] }
  | { readonly ok: false; readonly error: ErrorCierre }

/**
 * Si la solicitud puede cerrar el periodo que el checklist acaba de evaluar.
 *
 * Separada de `verificarCierre` porque son dos preguntas distintas: una es
 * cómo está el periodo, y la otra si lo que pide quien cierra alcanza para
 * cerrarlo. Un error no se salta de ninguna manera; un aviso se salta
 * declarando que se leyó y diciendo por qué, que es la "autorización explícita
 * que queda registrada" de docs/03 §5. Confirmar sin motivo no registra nada,
 * así que tampoco vale.
 */
export function decidirCierre(
  resultado: ResultadoCierre,
  solicitud: { readonly confirmarAvisos: boolean; readonly motivo: string },
): DecisionCierre {
  const errores = erroresDe(resultado.verificaciones)
  if (errores.length > 0) {
    return {
      ok: false,
      error: {
        codigo: 'CIERRE_CON_ERRORES',
        mensaje: errores[0].mensaje,
        detalles: errores.map(textoVerificacion),
      },
    }
  }

  const avisos = avisosDe(resultado.verificaciones)
  if (avisos.length === 0) return { ok: true, avisos }

  if (!solicitud.confirmarAvisos) {
    return {
      ok: false,
      error: {
        codigo: 'CIERRE_CON_AVISOS',
        mensaje:
          'El periodo tiene avisos que hay que revisar antes de cerrarlo',
        detalles: avisos.map(textoVerificacion),
      },
    }
  }

  if (solicitud.motivo.trim() === '') {
    return {
      ok: false,
      error: {
        codigo: 'MOTIVO_CIERRE_REQUERIDO',
        mensaje: 'Cerrar con avisos exige un motivo, y queda en la bitácora',
        detalles: avisos.map(textoVerificacion),
      },
    }
  }

  return { ok: true, avisos }
}

/** El punto del checklist en una línea, para el detalle de un error de API. */
export function textoVerificacion(v: VerificacionCierre): string {
  return v.detalle ? `${v.mensaje} (${v.detalle})` : v.mensaje
}

/* ------------------------------------------------------- Reapertura */

export interface ResultadoReapertura {
  readonly valido: boolean
  readonly error?: { readonly codigo: 'PERIODO_NO_REABRIBLE'; readonly mensaje: string }
}

/**
 * Reapertura de un periodo (docs/03 §5).
 *
 * Solo un periodo `cerrado` se reabre, y con permiso de administrador. El
 * `bloqueado` no vuelve nunca: se usa después de presentar declaraciones o de
 * cerrar el ejercicio, y reabrirlo dejaría el mayor diciendo algo distinto de
 * lo que ya se declaró. Corregir un mes bloqueado se hace donde se corrige
 * todo lo demás, con un asiento en el periodo abierto (docs/02 §6).
 */
export function validarReapertura(periodo: Periodo): ResultadoReapertura {
  if (periodo.estado === 'cerrado') return { valido: true }

  return {
    valido: false,
    error: {
      codigo: 'PERIODO_NO_REABRIBLE',
      mensaje:
        periodo.estado === 'bloqueado'
          ? `${etiquetaPeriodo(periodo)} está bloqueado y un periodo bloqueado no se reabre`
          : `${etiquetaPeriodo(periodo)} ya está abierto`,
    },
  }
}
