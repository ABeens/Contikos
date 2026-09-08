import type {
  ClasificacionNiifBase,
  Cuenta,
  EstadoFinanciero,
  Naturaleza,
  NotaEeffBase,
  SolicitudClasificacionCuenta,
  SolicitudClasificacionNiif,
  SolicitudNotaEeff,
  TipoCuenta,
} from '@/shared/api/contracts/conta'
import { ESTADOS_FINANCIEROS } from '@/shared/api/contracts/conta'

/**
 * Reglas de los catálogos de presentación: clasificación NIIF y notas a los
 * estados financieros.
 *
 * Mismo patrón que `domain/asiento.ts` y `config/domain/moneda.ts`: estas
 * reglas las aplica el backend y aquí se replican para dar retroalimentación
 * inmediata durante la captura, NO para sustituirlas. El handler de MSW usa
 * estas mismas funciones, de modo que el mock rechace exactamente lo que
 * rechazará la API real.
 *
 * Los dos catálogos viven en un solo archivo porque la relación entre ellos ES
 * la regla principal: la nota es una subcategoría de la clasificación, y casi
 * toda validación que importa cruza los dos.
 */

export const ETIQUETA_ESTADO_FINANCIERO: Record<EstadoFinanciero, string> = {
  situacion: 'Estado de Situación Financiera',
  resultados: 'Estado de Resultados',
  patrimonio: 'Estado de Cambios en el Patrimonio',
  flujos: 'Estado de Flujos de Efectivo',
}

export const ETIQUETA_TIPO_CUENTA: Record<TipoCuenta, string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  capital: 'Patrimonio',
  ingreso: 'Ingreso',
  costo: 'Costo',
  gasto: 'Gasto',
  orden: 'Orden',
}

/**
 * Naturaleza que le toca a cada tipo de cuenta.
 *
 * Sirve para no repetirla en pantalla: decir "Activo · deudora" en las
 * ochenta cuentas del catálogo no informa de nada. Solo la excepción (una
 * estimación para incobrables, que es activo de saldo acreedor) merece verse.
 */
export const NATURALEZA_HABITUAL: Record<TipoCuenta, Naturaleza> = {
  activo: 'deudora',
  pasivo: 'acreedora',
  capital: 'acreedora',
  ingreso: 'acreedora',
  costo: 'deudora',
  gasto: 'deudora',
  orden: 'deudora',
}

export type CodigoErrorClasificacion =
  | 'CODIGO_REQUERIDO'
  | 'CODIGO_DUPLICADO'
  | 'CLASIFICACION_NO_ENCONTRADA'
  | 'CLASIFICACION_INACTIVA'
  | 'CLASIFICACION_EN_USO'
  | 'CLASIFICACION_CON_NOTAS'
  | 'CLASIFICACION_REQUERIDA'
  | 'CLASIFICACION_SIN_NOTAS'
  | 'NOTA_REQUERIDA'
  | 'NOMBRE_REQUERIDO'
  | 'TIPOS_CUENTA_REQUERIDOS'
  | 'TIPOS_CUENTA_EN_USO'
  | 'ORDEN_INVALIDO'
  | 'NUMERO_INVALIDO'
  | 'NUMERO_DUPLICADO'
  | 'LITERAL_INVALIDO'
  | 'TITULO_REQUERIDO'
  | 'NOTA_NO_ENCONTRADA'
  | 'NOTA_INACTIVA'
  | 'NOTA_AJENA'
  | 'NOTA_SIN_CLASIFICACION'
  | 'NOTA_EN_USO'
  | 'CUENTA_NO_ENCONTRADA'
  | 'CUENTA_NO_DETALLE'
  | 'TIPO_INCOMPATIBLE'

export interface ErrorClasificacion {
  readonly codigo: CodigoErrorClasificacion
  /** Campo del formulario al que apunta el error, si aplica. */
  readonly campo?: string
  readonly mensaje: string
}

export interface ResultadoClasificacion {
  readonly valido: boolean
  readonly errores: readonly ErrorClasificacion[]
}

/**
 * Todo lo que hace falta para decidir.
 *
 * Los tres catálogos juntos: sin las cuentas no se puede saber si una
 * clasificación está en uso, y sin las notas no se puede saber si el padre
 * queda huérfano.
 */
export interface ContextoCatalogo {
  readonly clasificaciones: readonly ClasificacionNiifBase[]
  readonly notas: readonly NotaEeffBase[]
  readonly cuentas: readonly Cuenta[]
}

function resultado(errores: ErrorClasificacion[]): ResultadoClasificacion {
  return { valido: errores.length === 0, errores }
}

/* ------------------------------------------------------------- Consultas */

export function cuentasDeClasificacion(
  clasificacionId: string,
  cuentas: readonly Cuenta[],
): Cuenta[] {
  return cuentas.filter((c) => c.clasificacionNiifId === clasificacionId)
}

/**
 * Cómo se cita la nota: el número y su literal, sin separador.
 *
 * La nota 1 desglosada en 1a y 1b sigue siendo el desglose del renglón 1: el
 * literal subdivide, no renumera. Toda la pantalla y todos los mensajes citan
 * la nota por aquí, para que la referencia sea una sola en todo el sistema.
 */
export function referenciaNota(
  nota: Pick<NotaEeffBase, 'numero' | 'literal'>,
): string {
  return `${nota.numero}${nota.literal}`
}

/** El literal se guarda en minúscula: `1A` y `1a` son la misma nota. */
export function normalizarLiteral(literal: string): string {
  return literal.trim().toLowerCase()
}

export function cuentasDeNota(
  notaId: string,
  cuentas: readonly Cuenta[],
): Cuenta[] {
  return cuentas.filter((c) => c.notaEeffId === notaId)
}

/**
 * Notas que una cuenta puede tomar hoy de esta clasificación.
 *
 * Las inactivas siguen desglosando lo ya asignado, pero no admiten cuentas
 * nuevas. Si esta lista queda vacía, el renglón no puede recibir cuentas: la
 * nota es obligatoria y no habría ninguna que asignarles.
 */
export function notasAsignables<T extends NotaEeffBase>(
  clasificacionId: string,
  notas: readonly T[],
): T[] {
  return notasDeClasificacion(clasificacionId, notas).filter((n) => n.activa)
}

export function notasDeClasificacion<T extends NotaEeffBase>(
  clasificacionId: string,
  notas: readonly T[],
): T[] {
  return notas
    .filter((n) => n.clasificacionNiifId === clasificacionId)
    .sort((a, b) => a.numero - b.numero || a.literal.localeCompare(b.literal))
}

/** Orden de presentación: por estado financiero y, dentro de él, por `orden`. */
export function ordenarClasificaciones<T extends ClasificacionNiifBase>(
  clasificaciones: readonly T[],
): T[] {
  const posicion = (e: EstadoFinanciero) => ESTADOS_FINANCIEROS.indexOf(e)
  return [...clasificaciones].sort(
    (a, b) =>
      posicion(a.estadoFinanciero) - posicion(b.estadoFinanciero) ||
      a.orden - b.orden ||
      a.codigo.localeCompare(b.codigo),
  )
}

/* ---------------------------------------------------- Clasificación NIIF */

/**
 * Valida un alta o una modificación de clasificación.
 *
 * `id` viene undefined al crear. El código es la llave visible: se valida único
 * porque es lo que cita el motor de reportes cuando arma un renglón.
 */
export function validarClasificacion(
  solicitud: SolicitudClasificacionNiif,
  contexto: ContextoCatalogo,
  id?: string,
): ResultadoClasificacion {
  const errores: ErrorClasificacion[] = []
  const codigo = solicitud.codigo.trim().toUpperCase()
  const existente = id
    ? contexto.clasificaciones.find((c) => c.id === id)
    : undefined

  if (id && !existente) {
    return resultado([
      {
        codigo: 'CLASIFICACION_NO_ENCONTRADA',
        mensaje: 'La clasificación no está en el catálogo',
      },
    ])
  }

  if (codigo === '') {
    errores.push({
      codigo: 'CODIGO_REQUERIDO',
      campo: 'codigo',
      mensaje: 'El código es obligatorio',
    })
  } else if (
    contexto.clasificaciones.some(
      (c) => c.codigo.toUpperCase() === codigo && c.id !== id,
    )
  ) {
    errores.push({
      codigo: 'CODIGO_DUPLICADO',
      campo: 'codigo',
      mensaje: `Ya hay una clasificación con el código ${codigo}`,
    })
  }

  if (solicitud.nombre.trim() === '') {
    errores.push({
      codigo: 'NOMBRE_REQUERIDO',
      campo: 'nombre',
      mensaje: 'El nombre es obligatorio',
    })
  }

  if (solicitud.tiposCuenta.length === 0) {
    errores.push({
      codigo: 'TIPOS_CUENTA_REQUERIDOS',
      campo: 'tiposCuenta',
      mensaje: 'Indique al menos un tipo de cuenta admitido',
    })
  }

  if (!Number.isInteger(solicitud.orden) || solicitud.orden < 0) {
    errores.push({
      codigo: 'ORDEN_INVALIDO',
      campo: 'orden',
      mensaje: 'El orden debe ser un entero mayor o igual que cero',
    })
  }

  if (existente) {
    const clasificadas = cuentasDeClasificacion(existente.id, contexto.cuentas)

    // Quitar un tipo que ya tiene cuentas dejaría el catálogo en un estado que
    // la propia validación de asignación rechazaría. No se prohíbe cambiar los
    // tipos: se prohíbe el cambio que deja cuentas ya clasificadas fuera.
    const huerfanas = clasificadas.filter(
      (c) => !solicitud.tiposCuenta.includes(c.tipo),
    )
    if (huerfanas.length > 0) {
      const tipos = [...new Set(huerfanas.map((c) => c.tipo))]
        .map((t) => ETIQUETA_TIPO_CUENTA[t])
        .join(', ')
      errores.push({
        codigo: 'TIPOS_CUENTA_EN_USO',
        campo: 'tiposCuenta',
        mensaje: `Hay ${huerfanas.length} cuenta(s) clasificadas de tipo ${tipos}. Reclasifíquelas antes de quitar el tipo`,
      })
    }

    // Desactivar con cuentas colgando dejaría saldos sin renglón donde
    // presentarse: el estado financiero saldría incompleto y sin avisar.
    if (!solicitud.activa && clasificadas.length > 0) {
      errores.push({
        codigo: 'CLASIFICACION_EN_USO',
        campo: 'activa',
        mensaje: `No se puede desactivar: ${clasificadas.length} cuenta(s) se presentan en esta clasificación`,
      })
    }
  }

  return resultado(errores)
}

/** Reglas para retirar una clasificación del catálogo. */
export function validarEliminacionClasificacion(
  id: string,
  contexto: ContextoCatalogo,
): ResultadoClasificacion {
  const existente = contexto.clasificaciones.find((c) => c.id === id)
  if (!existente) {
    return resultado([
      {
        codigo: 'CLASIFICACION_NO_ENCONTRADA',
        mensaje: 'La clasificación no está en el catálogo',
      },
    ])
  }

  const errores: ErrorClasificacion[] = []
  const clasificadas = cuentasDeClasificacion(id, contexto.cuentas)
  const notas = notasDeClasificacion(id, contexto.notas)

  if (clasificadas.length > 0) {
    errores.push({
      codigo: 'CLASIFICACION_EN_USO',
      mensaje: `${existente.codigo} tiene ${clasificadas.length} cuenta(s) asignadas. Desactívela en vez de eliminarla`,
    })
  }

  // Borrar el padre dejaría notas que no desglosan ningún renglón. Moverlas o
  // eliminarlas es una decisión de quien arma los estados financieros.
  if (notas.length > 0) {
    errores.push({
      codigo: 'CLASIFICACION_CON_NOTAS',
      mensaje: `${existente.codigo} tiene ${notas.length} nota(s). Elimínelas o muévalas de clasificación primero`,
    })
  }

  return resultado(errores)
}

/* ------------------------------------------------------- Notas a los EEFF */

export function validarNota(
  solicitud: SolicitudNotaEeff,
  contexto: ContextoCatalogo,
  id?: string,
): ResultadoClasificacion {
  const errores: ErrorClasificacion[] = []
  const existente = id ? contexto.notas.find((n) => n.id === id) : undefined

  if (id && !existente) {
    return resultado([
      { codigo: 'NOTA_NO_ENCONTRADA', mensaje: 'La nota no está en el catálogo' },
    ])
  }

  const padre = contexto.clasificaciones.find(
    (c) => c.id === solicitud.clasificacionNiifId,
  )

  if (!padre) {
    errores.push({
      codigo: 'CLASIFICACION_NO_ENCONTRADA',
      campo: 'clasificacionNiifId',
      mensaje: 'La nota tiene que colgar de una clasificación del catálogo',
    })
  } else if (!padre.activa && solicitud.activa) {
    errores.push({
      codigo: 'CLASIFICACION_INACTIVA',
      campo: 'clasificacionNiifId',
      mensaje: `La clasificación ${padre.codigo} está inactiva: una nota activa no puede colgar de ella`,
    })
  }

  const literal = normalizarLiteral(solicitud.literal)
  const referencia = `${solicitud.numero}${literal}`

  if (!/^[a-z]{0,2}$/.test(literal)) {
    errores.push({
      codigo: 'LITERAL_INVALIDO',
      campo: 'literal',
      mensaje: 'El literal son una o dos letras (a, b, aa), o nada',
    })
  }

  if (!Number.isInteger(solicitud.numero) || solicitud.numero < 1) {
    errores.push({
      codigo: 'NUMERO_INVALIDO',
      campo: 'numero',
      mensaje: 'El número de nota debe ser un entero mayor que cero',
    })
  } else if (
    // Lo único que no se puede repetir es la referencia completa: 1a y 1b son
    // dos desgloses del mismo renglón y el cuerpo del estado financiero las
    // cita por separado.
    contexto.notas.some(
      (n) => referenciaNota(n) === referencia && n.id !== id,
    )
  ) {
    errores.push({
      codigo: 'NUMERO_DUPLICADO',
      campo: 'numero',
      mensaje: `Ya existe la nota ${referencia}. Dos notas no se citan igual en los estados financieros`,
    })
  }

  if (solicitud.titulo.trim() === '') {
    errores.push({
      codigo: 'TITULO_REQUERIDO',
      campo: 'titulo',
      mensaje: 'El título es obligatorio',
    })
  }

  if (existente) {
    const asignadas = cuentasDeNota(existente.id, contexto.cuentas)

    if (!solicitud.activa && asignadas.length > 0) {
      errores.push({
        codigo: 'NOTA_EN_USO',
        campo: 'activa',
        mensaje: `No se puede desactivar: ${asignadas.length} cuenta(s) se desglosan en esta nota`,
      })
    }

    // Mover la nota de padre arrastraría sus cuentas a un renglón que quizá no
    // admite su tipo. Se vacía la nota primero y luego se mueve.
    if (
      solicitud.clasificacionNiifId !== existente.clasificacionNiifId &&
      asignadas.length > 0
    ) {
      errores.push({
        codigo: 'NOTA_EN_USO',
        campo: 'clasificacionNiifId',
        mensaje: `No se puede cambiar de clasificación: ${asignadas.length} cuenta(s) están asignadas a esta nota`,
      })
    }
  }

  return resultado(errores)
}

export function validarEliminacionNota(
  id: string,
  contexto: ContextoCatalogo,
): ResultadoClasificacion {
  const existente = contexto.notas.find((n) => n.id === id)
  if (!existente) {
    return resultado([
      { codigo: 'NOTA_NO_ENCONTRADA', mensaje: 'La nota no está en el catálogo' },
    ])
  }

  const asignadas = cuentasDeNota(id, contexto.cuentas)
  if (asignadas.length > 0) {
    return resultado([
      {
        codigo: 'NOTA_EN_USO',
        mensaje: `La nota ${referenciaNota(existente)} desglosa ${asignadas.length} cuenta(s). Desactívela en vez de eliminarla`,
      },
    ])
  }

  return resultado([])
}

/* ------------------------------------------- Clasificación de una cuenta */

/** Lo mínimo que hay que saber de la cuenta para decidir su presentación. */
export interface CuentaAPresentar {
  readonly codigo: string
  readonly tipo: TipoCuenta
  readonly esDetalle: boolean
}

/**
 * Valida la presentación de una cuenta: su renglón y su nota.
 *
 * El corazón de la regla es que la presentación es **obligatoria** en toda
 * cuenta de detalle. Una cuenta sin renglón no suma en ningún estado financiero
 * y sin nota no se explica en ninguno: el saldo existe en el mayor y desaparece
 * del reporte, que es la peor forma de faltar, porque la balanza sigue cuadrando
 * y nadie lo nota. En la acumulativa es al revés y por lo mismo: presenta lo que
 * suman sus hijas, y darle renglón propio contaría esos saldos dos veces.
 *
 * Vive aquí y no en `domain/cuenta.ts` porque la comprueban dos caminos: el alta
 * y la edición de la cuenta, y el endpoint que la reclasifica después.
 */
export function validarPresentacion(
  cuenta: CuentaAPresentar,
  presentacion: SolicitudClasificacionCuenta,
  catalogos: Pick<ContextoCatalogo, 'clasificaciones' | 'notas'>,
): ErrorClasificacion[] {
  const errores: ErrorClasificacion[] = []
  const { clasificacionNiifId, notaEeffId } = presentacion

  if (!cuenta.esDetalle) {
    if (clasificacionNiifId !== null || notaEeffId !== null) {
      errores.push({
        codigo: 'CUENTA_NO_DETALLE',
        campo: 'clasificacionNiifId',
        mensaje: `${cuenta.codigo} es acumulativa: presenta lo que suman sus cuentas hijas y no se clasifica`,
      })
    }
    return errores
  }

  if (clasificacionNiifId === null) {
    errores.push({
      codigo: 'CLASIFICACION_REQUERIDA',
      campo: 'clasificacionNiifId',
      mensaje: `${cuenta.codigo} recibe movimientos: dígale en qué renglón del estado financiero se presenta`,
    })
    if (notaEeffId !== null) {
      errores.push({
        codigo: 'NOTA_SIN_CLASIFICACION',
        campo: 'notaEeffId',
        mensaje:
          'Para asignar una nota, la cuenta necesita antes su clasificación',
      })
    }
    return errores
  }

  const clasificacion = catalogos.clasificaciones.find(
    (c) => c.id === clasificacionNiifId,
  )

  if (!clasificacion) {
    errores.push({
      codigo: 'CLASIFICACION_NO_ENCONTRADA',
      campo: 'clasificacionNiifId',
      mensaje: 'La clasificación no está en el catálogo',
    })
    return errores
  }

  if (!clasificacion.activa) {
    errores.push({
      codigo: 'CLASIFICACION_INACTIVA',
      campo: 'clasificacionNiifId',
      mensaje: `La clasificación ${clasificacion.codigo} está inactiva`,
    })
  }

  if (!clasificacion.tiposCuenta.includes(cuenta.tipo)) {
    const admitidos = clasificacion.tiposCuenta
      .map((t) => ETIQUETA_TIPO_CUENTA[t])
      .join(', ')
    errores.push({
      codigo: 'TIPO_INCOMPATIBLE',
      campo: 'clasificacionNiifId',
      mensaje: `${clasificacion.codigo} admite cuentas de tipo ${admitidos}, y ${cuenta.codigo} es de tipo ${ETIQUETA_TIPO_CUENTA[cuenta.tipo]}`,
    })
  }

  if (notaEeffId === null) {
    // El renglón sin notas es el callejón sin salida de la regla: la nota es
    // obligatoria y no hay ninguna que asignar. Se dice así, y no "falta la
    // nota", porque lo que hay que hacer es crearla en el catálogo.
    const asignables = notasAsignables(clasificacionNiifId, catalogos.notas)
    errores.push(
      asignables.length === 0
        ? {
            codigo: 'CLASIFICACION_SIN_NOTAS',
            campo: 'notaEeffId',
            mensaje: `${clasificacion.codigo} ${clasificacion.nombre} todavía no tiene notas activas. Cree la nota que desglosa el renglón antes de asignarle cuentas`,
          }
        : {
            codigo: 'NOTA_REQUERIDA',
            campo: 'notaEeffId',
            mensaje: `Elija la nota en la que se desglosa ${cuenta.codigo} dentro de ${clasificacion.codigo}`,
          },
    )
    return errores
  }

  const nota = catalogos.notas.find((n) => n.id === notaEeffId)

  if (!nota) {
    errores.push({
      codigo: 'NOTA_NO_ENCONTRADA',
      campo: 'notaEeffId',
      mensaje: 'La nota no está en el catálogo',
    })
    return errores
  }

  if (nota.clasificacionNiifId !== clasificacionNiifId) {
    errores.push({
      codigo: 'NOTA_AJENA',
      campo: 'notaEeffId',
      mensaje: `La nota ${referenciaNota(nota)} pertenece a otra clasificación. El desglose de una nota tiene que cuadrar contra su propio renglón`,
    })
  }

  if (!nota.activa) {
    errores.push({
      codigo: 'NOTA_INACTIVA',
      campo: 'notaEeffId',
      mensaje: `La nota ${referenciaNota(nota)} está inactiva`,
    })
  }

  return errores
}

/**
 * Valida la reclasificación de una cuenta que ya está en el catálogo.
 *
 * Aquí es donde la jerarquía se vuelve real: la nota tiene que pertenecer a la
 * clasificación que se está asignando. Sin esta regla los dos catálogos serían
 * dos listas sueltas y el desglose de la nota no cuadraría contra su renglón.
 */
export function validarClasificacionCuenta(
  cuentaId: string,
  solicitud: SolicitudClasificacionCuenta,
  contexto: ContextoCatalogo,
): ResultadoClasificacion {
  const cuenta = contexto.cuentas.find((c) => c.id === cuentaId)

  if (!cuenta) {
    return resultado([
      {
        codigo: 'CUENTA_NO_ENCONTRADA',
        mensaje: 'La cuenta no está en el catálogo',
      },
    ])
  }

  return resultado(validarPresentacion(cuenta, solicitud, contexto))
}
