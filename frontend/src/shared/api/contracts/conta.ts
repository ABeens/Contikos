import { z } from 'zod'
import {
  AuxiliarTipoSchema,
  FechaISO,
  Importe,
  LibroSchema,
  ModuloSchema,
  MonedaSchema,
} from './comunes'

/* ---------------------------------------------------------------- Cuentas */

export const NaturalezaSchema = z.enum(['deudora', 'acreedora'])

export const TipoCuentaSchema = z.enum([
  'activo',
  'pasivo',
  'capital',
  'ingreso',
  'costo',
  'gasto',
  'orden',
])

export const CuentaSchema = z.object({
  id: z.string(),
  codigo: z.string(),
  nombre: z.string(),
  cuentaPadreId: z.string().nullable(),
  nivel: z.number().int(),
  naturaleza: NaturalezaSchema,
  tipo: TipoCuentaSchema,
  /** Solo las cuentas de detalle reciben movimientos. */
  esDetalle: z.boolean(),
  requiereAuxiliar: AuxiliarTipoSchema.nullable(),
  /** Cuenta de control: solo la mueve su módulo dueño (docs/03 §2). */
  esCuentaControl: z.boolean(),
  moduloDueno: ModuloSchema.nullable(),
  moneda: MonedaSchema.nullable(),
  /**
   * Renglón del estado financiero en el que se presenta (catálogo aparte).
   *
   * Obligatorio en toda cuenta de detalle: sin renglón, su saldo no llega a
   * ningún estado financiero. Nulo solo en las acumulativas, que presentan lo
   * que suman sus hijas. Sigue siendo nullable en el contrato porque el tipo
   * describe las dos clases de cuenta; quien exige es la regla (docs/03 §2 bis).
   */
  clasificacionNiifId: z.string().nullable(),
  /** Nota que la desglosa. Obligatoria con la misma regla, y siempre de la
   * clasificación asignada. */
  notaEeffId: z.string().nullable(),
  activa: z.boolean(),
})

export type Cuenta = z.infer<typeof CuentaSchema>
export type TipoCuenta = z.infer<typeof TipoCuentaSchema>
export type Naturaleza = z.infer<typeof NaturalezaSchema>

/* ------------------------------------------------- Clasificación NIIF */

/**
 * Estado financiero en el que presenta una clasificación.
 *
 * Son los cuatro que exige la NIIF para PYMES (Sección 3). El catálogo de
 * clasificaciones es un dato de la empresa; los estados en los que puede
 * presentarse, no: el motor de reportes tiene un algoritmo distinto para cada
 * uno (docs/09 §3).
 */
export const EstadoFinancieroSchema = z.enum([
  'situacion',
  'resultados',
  'patrimonio',
  'flujos',
])

export type EstadoFinanciero = z.infer<typeof EstadoFinancieroSchema>

export const ESTADOS_FINANCIEROS: readonly EstadoFinanciero[] = [
  'situacion',
  'resultados',
  'patrimonio',
  'flujos',
]

/**
 * Clasificación NIIF: el renglón del estado financiero al que va una cuenta.
 *
 * El catálogo de cuentas responde "dónde se registra"; esta clasificación
 * responde "dónde se presenta". Son preguntas distintas y por eso son catálogos
 * distintos: dos empresas pueden numerar sus cuentas como quieran y presentar
 * el mismo Estado de Situación Financiera.
 */
export const ClasificacionNiifSchema = z.object({
  id: z.string(),
  /** Llave visible y estable. No cambia una vez que hay cuentas clasificadas. */
  codigo: z.string(),
  nombre: z.string(),
  estadoFinanciero: EstadoFinancieroSchema,
  /**
   * Tipos de cuenta admitidos.
   *
   * Es un array y no un valor único porque hay renglones que reúnen cuentas de
   * signo contrario: las diferencias de cambio se presentan netas y agrupan
   * cuentas de ingreso y de gasto.
   */
  tiposCuenta: z.array(TipoCuentaSchema).min(1),
  /** Sección de la NIIF para PYMES que la sustenta. Referencia, no llave. */
  seccionNiif: z.string().nullable(),
  /** Orden de presentación dentro de su estado financiero. */
  orden: z.number().int(),
  activa: z.boolean(),
  /** Derivado: cuentas del catálogo clasificadas aquí. */
  cuentas: z.number().int(),
  /** Derivado: notas que cuelgan de ella. */
  notas: z.number().int(),
})

export type ClasificacionNiif = z.infer<typeof ClasificacionNiifSchema>

/** Los campos derivados los calcula quien tiene los datos, no la pantalla. */
export type ClasificacionNiifBase = Omit<
  ClasificacionNiif,
  'cuentas' | 'notas'
>

export const SolicitudClasificacionNiifSchema = ClasificacionNiifSchema.omit({
  id: true,
  cuentas: true,
  notas: true,
})

export type SolicitudClasificacionNiif = z.infer<
  typeof SolicitudClasificacionNiifSchema
>

/* -------------------------------------------------- Notas a los EEFF */

/**
 * Nota a los estados financieros. Subcategoría de una clasificación NIIF.
 *
 * La clasificación dice en qué renglón suma la cuenta; la nota, en qué desglose
 * se explica ese renglón. Por eso la nota SIEMPRE cuelga de una clasificación:
 * una nota que desglosara cuentas de renglones distintos no cuadraría contra
 * ninguno.
 *
 * Las notas narrativas (información general, bases de preparación, políticas
 * contables) no viven en este catálogo: no desglosan saldos, son texto del
 * reporte.
 */
export const NotaEeffSchema = z.object({
  id: z.string(),
  /** Clasificación a la que pertenece. Obligatoria: la nota es subcategoría. */
  clasificacionNiifId: z.string(),
  /**
   * Número con el que se cita en el cuerpo del estado financiero.
   *
   * Corrido sobre TODO el catálogo, no dentro de la clasificación: en los
   * estados financieros "véase Nota 7" tiene que apuntar a una sola nota. Se
   * repite solo entre notas que se distinguen por su literal (1a, 1b).
   */
  numero: z.number().int().min(1),
  /**
   * Literal que subdivide el número: la nota 1 puede desglosarse en 1a y 1b.
   *
   * Cadena vacía cuando la nota no se subdivide. Lo que tiene que ser único es
   * la referencia completa (`numero` + `literal`), no el número: 1a y 1b son
   * dos notas distintas del mismo renglón y se citan por separado.
   */
  literal: z.string().regex(/^[a-z]{0,2}$/),
  titulo: z.string(),
  /** Qué revela la nota. Es el guion del desglose, no el desglose mismo. */
  descripcion: z.string(),
  activa: z.boolean(),
  /** Derivado: cuentas del catálogo asignadas a esta nota. */
  cuentas: z.number().int(),
})

export type NotaEeff = z.infer<typeof NotaEeffSchema>

export type NotaEeffBase = Omit<NotaEeff, 'cuentas'>

export const SolicitudNotaEeffSchema = NotaEeffSchema.omit({
  id: true,
  cuentas: true,
})

export type SolicitudNotaEeff = z.infer<typeof SolicitudNotaEeffSchema>

/* --------------------------------------------- Alta y edición de cuenta */

/**
 * Alta y edición de una cuenta del catálogo (docs/03 §2).
 *
 * No lleva `id`, `nivel` ni `cuentaPadreId`: los tres salen del código. El
 * código es la jerarquía — `1.2.01.004` cuelga de `1.2.01` y está en el nivel
 * cuatro — y capturar por separado lo que el código ya dice es la forma segura
 * de que un día no coincidan.
 *
 * Tampoco lleva `esCuentaControl`: una cuenta es de control cuando tiene módulo
 * dueño, y tenerlo en dos campos permite el estado imposible de una cuenta de
 * control que no es de nadie.
 *
 * Sí lleva la presentación. Una cuenta de detalle no nace sin renglón ni sin
 * nota: mientras no los tenga, su saldo no aparece en ningún estado financiero
 * y nadie se entera hasta que el balance no cuadra contra el mayor. Reclasificar
 * después sigue teniendo su propio endpoint, que es otra decisión y otro rol.
 */
export const SolicitudCuentaSchema = z.object({
  codigo: z
    .string()
    .min(1, 'La cuenta requiere un código')
    .regex(
      /^\d+(\.\d+)*$/,
      'El código son números separados por puntos, como 1.2.01.004',
    ),
  nombre: z.string().min(1, 'La cuenta requiere un nombre'),
  tipo: TipoCuentaSchema,
  naturaleza: NaturalezaSchema,
  /** Solo las cuentas de detalle reciben movimientos. */
  esDetalle: z.boolean(),
  requiereAuxiliar: AuxiliarTipoSchema.nullable(),
  /** Con módulo dueño, la cuenta es de control y solo la mueve ese módulo. */
  moduloDueno: ModuloSchema.nullable(),
  moneda: MonedaSchema.nullable(),
  /**
   * Presentación en los estados financieros.
   *
   * Obligatoria en las cuentas de detalle y prohibida en las acumulativas: el
   * contrato admite las dos formas y la regla decide cuál toca (docs/03 §2 bis).
   */
  clasificacionNiifId: z.string().nullable(),
  notaEeffId: z.string().nullable(),
  activa: z.boolean(),
})

export type SolicitudCuenta = z.infer<typeof SolicitudCuentaSchema>

/* ------------------------------------- Clasificación de una cuenta */

/**
 * Reasignación de clasificación y nota a una cuenta ya existente.
 *
 * Va aparte de la edición de la cuenta porque es otra decisión y la toma otra
 * persona: quién define el catálogo de cuentas y quién arma la presentación de
 * los estados financieros no suelen ser el mismo rol. Lo que no admite es
 * vaciarla: una cuenta de detalle sin renglón no se presenta en ningún lado.
 */
export const SolicitudClasificacionCuentaSchema = z.object({
  clasificacionNiifId: z.string().nullable(),
  notaEeffId: z.string().nullable(),
})

export type SolicitudClasificacionCuenta = z.infer<
  typeof SolicitudClasificacionCuentaSchema
>

/* --------------------------------------------------------------- Periodos */

export const EstadoPeriodoSchema = z.enum(['abierto', 'cerrado', 'bloqueado'])

export const PeriodoSchema = z.object({
  id: z.string(),
  ejercicio: z.number().int(),
  numero: z.number().int().min(1).max(13),
  fechaInicio: FechaISO,
  fechaFin: FechaISO,
  estado: EstadoPeriodoSchema,
  /**
   * Bitácora del cierre (docs/03 §5: "el cierre con excepciones requiere
   * autorización explícita y queda registrado").
   *
   * Los tres campos llevan `.default(null)` y no solo `.nullable()`: un periodo
   * guardado antes de que existiera el cierre no los trae, y un contrato que
   * los exigiera dejaría ilegible lo que ya está en el almacén. Se conservan al
   * reabrir, porque lo que dice la bitácora es que ese cierre ocurrió, no que
   * el periodo esté cerrado ahora.
   */
  cerradoEn: z.string().nullable().default(null),
  cerradoPor: z.string().nullable().default(null),
  /** Por qué se cerró con avisos. Nulo cuando el cierre no tuvo ninguno. */
  motivoCierre: z.string().nullable().default(null),
})

export type Periodo = z.infer<typeof PeriodoSchema>
export type EstadoPeriodo = z.infer<typeof EstadoPeriodoSchema>

/* ----------------------------------------- Cierre de periodo (docs/03 §5) */

/**
 * Semáforo de un punto del checklist de cierre.
 *
 * Tres severidades y no dos, a diferencia de la verificación de la corrida de
 * depreciación (docs/07 §3.2): allí se enumeran los hallazgos y el silencio es
 * la buena noticia; aquí el checklist se enseña entero, punto por punto, y el
 * punto que está bien tiene que decir que lo está. Un checklist que solo lista
 * problemas no deja ver qué se comprobó.
 */
export const SeveridadCierreSchema = z.enum(['error', 'aviso', 'ok'])

export type SeveridadCierre = z.infer<typeof SeveridadCierreSchema>

export const VerificacionCierreSchema = z.object({
  codigo: z.string(),
  severidad: SeveridadCierreSchema,
  mensaje: z.string(),
  /** Lo concreto que hay que mirar: qué asientos, qué cuentas, qué diferencia. */
  detalle: z.string().optional(),
})

export type VerificacionCierre = z.infer<typeof VerificacionCierreSchema>

/**
 * El checklist de cierre de un periodo, tal como se enseña y como se decide.
 *
 * Lo calcula el servidor dos veces con los mismos datos, una al consultarlo y
 * otra al cerrar, y por construcción obtiene lo mismo: lo que se revisó es lo
 * que se aplica.
 */
export const ChecklistCierreSchema = z.object({
  periodo: PeriodoSchema,
  /** Día contra el que se evaluó. Un checklist sin fecha no se puede repetir. */
  fechaReferencia: FechaISO,
  verificaciones: z.array(VerificacionCierreSchema),
  /** Ningún error. Los avisos no bloquean, pero exigen autorización. */
  puedeCerrar: z.boolean(),
})

export type ChecklistCierre = z.infer<typeof ChecklistCierreSchema>

/**
 * Lo que se decide al cerrar: si los avisos se leyeron y por qué se cierra
 * con ellos.
 *
 * El motivo no es decoración: es lo que queda en la bitácora del periodo y lo
 * único que explicará, dentro de un año, por qué agosto se cerró con la
 * depreciación sin correr.
 */
export const SolicitudCierreSchema = z.object({
  confirmarAvisos: z.boolean(),
  motivo: z.string().default(''),
})

export type SolicitudCierre = z.infer<typeof SolicitudCierreSchema>

/* --------------------------------------------------------------- Asientos */

/**
 * Un asiento es el registro contable de partida doble.
 *
 * Consecutivo ÚNICO por ejercicio y sin huecos. No se clasifica en
 * ingreso/egreso/diario: esa es una convención mexicana exigida por el SAT que
 * Costa Rica no requiere — aquí el marco es NIIF y no impone formato de
 * registro. Ver D-04 en docs/12.
 *
 * Un solo asiento alimenta los dos libros (fiscal y corporativo). La línea es
 * la que declara a cuáles afecta, y el consecutivo es compartido: no existen
 * "el asiento fiscal 120" y "el corporativo 98" del mismo hecho. Ver D-11.
 */
export const EstadoAsientoSchema = z.enum(['contabilizado', 'reversado'])

export const LineaAsientoSchema = z.object({
  id: z.string(),
  orden: z.number().int(),
  cuentaCodigo: z.string(),
  cuentaNombre: z.string(),
  concepto: z.string(),
  cargo: Importe,
  abono: Importe,
  /** Libros que mueve esta línea. Ya materializado: nunca viene vacío. */
  libros: z.array(LibroSchema).min(1),
  centroCosto: z.string().nullable(),
  auxiliarTipo: AuxiliarTipoSchema.nullable(),
  auxiliarId: z.string().nullable(),
  auxiliarNombre: z.string().nullable(),
})

/**
 * Totales de un libro dentro del asiento.
 *
 * Van por libro y no en la cabecera porque cuando el tratamiento fiscal y el
 * corporativo difieren, el asiento no tiene "un" total: tiene uno por libro, y
 * cada uno cuadra por su cuenta.
 */
export const TotalLibroSchema = z.object({
  libro: LibroSchema,
  totalCargos: Importe,
  totalAbonos: Importe,
})

/**
 * Documento al que se refiere un asiento manual (un ajuste, una corrección).
 *
 * Es DISTINTO de `origen`. El origen lo pone el módulo que generó el asiento y
 * es la llave de idempotencia (docs/02 §4): una factura tiene UN asiento de
 * origen. Este campo lo pone quien captura a mano para dejar rastro de a qué
 * documento se refiere, y una factura puede tener varios asientos manuales que
 * la mencionen. No da idempotencia ni habilita cuentas de control.
 */
export const DocumentoRelacionadoSchema = z.object({
  modulo: ModuloSchema,
  tipo: z.string().min(1),
  id: z.string().min(1),
  /** Lo que el usuario reconoce: el consecutivo o el folio del documento. */
  referencia: z.string().min(1),
})

export type DocumentoRelacionado = z.infer<typeof DocumentoRelacionadoSchema>

export const AsientoSchema = z.object({
  id: z.string(),
  /**
   * Consecutivo dentro del ejercicio. Reinicia en 1 cada ejercicio, así que
   * solo identifica junto a `ejercicio`; para mostrarlo está `codigo`.
   */
  numero: z.number().int(),
  /** Ejercicio al que pertenece. Sale del periodo de la fecha. */
  ejercicio: z.number().int(),
  /** Presentación estable y única: AS-2026-000012. */
  codigo: z.string(),
  fecha: FechaISO,
  concepto: z.string(),
  /** null cuando es captura manual. */
  origenModulo: ModuloSchema.nullable(),
  origenTipo: z.string().nullable(),
  origenId: z.string().nullable(),
  moneda: MonedaSchema,
  tipoCambio: Importe,
  estado: EstadoAsientoSchema,
  /** En la reversa: el asiento que reversa. */
  reversaDeId: z.string().nullable(),
  /** En el original ya reversado: el asiento de reversa que lo neutralizó. */
  reversadoPorId: z.string().nullable(),
  /** En el original ya reversado: por qué. Queda en bitácora (docs/02 §6). */
  motivoReversa: z.string().nullable(),
  /** Trazabilidad de un asiento manual hacia un documento. Ver el esquema. */
  documentoRelacionado: DocumentoRelacionadoSchema.nullable(),
  /** Unión de los libros que mueven sus líneas. Derivado, no capturado. */
  libros: z.array(LibroSchema).min(1),
  totales: z.array(TotalLibroSchema).min(1),
  lineas: z.array(LineaAsientoSchema),
  creadoPor: z.string(),
  creadoEn: z.string(),
})

export type Asiento = z.infer<typeof AsientoSchema>
export type LineaAsiento = z.infer<typeof LineaAsientoSchema>
export type TotalLibro = z.infer<typeof TotalLibroSchema>
export type EstadoAsiento = z.infer<typeof EstadoAsientoSchema>

/* ------------------------------------------- Solicitud de asiento (docs/02) */

export const LineaSolicitudSchema = z.object({
  cuenta: z.string(),
  cargo: Importe,
  abono: Importe,
  concepto: z.string().optional(),
  /**
   * Omitir = ambos libros.
   *
   * Es el valor por omisión a propósito: un módulo subsidiario que no sabe nada
   * de libros contabiliza igual que siempre y su asiento entra en los dos. Solo
   * quien tiene una diferencia fiscal-corporativa que declarar toca este campo.
   *
   * El array vacío NO se valida aquí sino en el dominio, para devolver
   * `LIBRO_REQUERIDO` y no un error de forma del contrato.
   */
  libros: z.array(LibroSchema).optional(),
  centroCosto: z.string().nullable().optional(),
  auxiliarTipo: AuxiliarTipoSchema.nullable().optional(),
  auxiliarId: z.string().nullable().optional(),
})

export const SolicitudAsientoSchema = z.object({
  fecha: FechaISO,
  concepto: z.string().min(1, 'El concepto es obligatorio'),
  moneda: MonedaSchema,
  tipoCambio: Importe,
  origen: z
    .object({
      modulo: ModuloSchema,
      tipo: z.string(),
      id: z.string(),
    })
    .optional(),
  /** Solo en asientos manuales. Omitir o null: no se refiere a ningún documento. */
  documentoRelacionado: DocumentoRelacionadoSchema.nullable().optional(),
  lineas: z
    .array(LineaSolicitudSchema)
    .min(2, 'El asiento requiere al menos 2 líneas'),
})

export type SolicitudAsiento = z.infer<typeof SolicitudAsientoSchema>
export type LineaSolicitud = z.infer<typeof LineaSolicitudSchema>

/* ------------------------------------------------ Reversa de asiento (docs/02 §6) */

/**
 * Lo único que se decide al reversar: cuándo y por qué.
 *
 * Las líneas no se capturan: son las del original con cargos y abonos
 * invertidos, y las construye el servidor. Dejar que el cliente las mande
 * abriría la puerta a una "reversa" que no neutraliza lo que dice neutralizar.
 */
export const SolicitudReversaSchema = z.object({
  /** Debe caer en periodo abierto. Si el del original ya cerró, va en el actual. */
  fecha: FechaISO,
  motivo: z.string().min(1, 'El motivo de la reversa es obligatorio'),
})

export type SolicitudReversa = z.infer<typeof SolicitudReversaSchema>

/* ---------------------------------------------------------------- Balanza */

export const RenglonBalanzaSchema = z.object({
  cuentaId: z.string(),
  codigo: z.string(),
  nombre: z.string(),
  nivel: z.number().int(),
  esDetalle: z.boolean(),
  naturaleza: NaturalezaSchema,
  saldoInicial: Importe,
  cargos: Importe,
  abonos: Importe,
  saldoFinal: Importe,
})

export const BalanzaSchema = z.object({
  periodo: PeriodoSchema,
  /** La balanza es SIEMPRE de un libro. No existe la balanza "de los dos". */
  libro: LibroSchema,
  moneda: MonedaSchema,
  renglones: z.array(RenglonBalanzaSchema),
  totalCargos: Importe,
  totalAbonos: Importe,
  /** Si esto es false, hay un bug en el núcleo (docs/09 §3.1). */
  cuadra: z.boolean(),
})

export type Balanza = z.infer<typeof BalanzaSchema>
export type RenglonBalanza = z.infer<typeof RenglonBalanzaSchema>

/* ------------------------------------------- Balanza comparativa (docs/09) */

/**
 * Una cuenta con su saldo en dos periodos y la variación entre los dos
 * (docs/09 §3.2: "comparativos con variación absoluta y porcentual").
 *
 * Los saldos llegan ya con el signo de la naturaleza de la cuenta, igual que
 * en la balanza simple, así que la variación se lee sola: positiva es que la
 * cuenta creció EN SU PROPIA NATURALEZA. Un pasivo que sube 100 y un activo
 * que sube 100 dan los dos +100, que es lo que un contador espera leer.
 */
export const RenglonComparativoSchema = z.object({
  cuentaId: z.string(),
  codigo: z.string(),
  nombre: z.string(),
  nivel: z.number().int(),
  esDetalle: z.boolean(),
  naturaleza: NaturalezaSchema,
  saldoA: Importe,
  saldoB: Importe,
  /** Saldo de B menos saldo de A. */
  variacion: Importe,
  /**
   * La variación sobre el saldo base, en porcentaje.
   *
   * Nullable a propósito: con saldo base cero no existe el porcentaje, y
   * cualquier número que se pusiera ahí (cero, 100, infinito) sería mentira.
   * Se presenta como "n/a".
   */
  variacionPorcentual: Importe.nullable(),
})

export const BalanzaComparativaSchema = z.object({
  /** El periodo base: la variación se mide desde él. */
  periodoA: PeriodoSchema,
  periodoB: PeriodoSchema,
  /** Comparar dos libros distintos no compararía nada (docs/09 §3). */
  libro: LibroSchema,
  moneda: MonedaSchema,
  renglones: z.array(RenglonComparativoSchema),
})

export type BalanzaComparativa = z.infer<typeof BalanzaComparativaSchema>
export type RenglonComparativo = z.infer<typeof RenglonComparativoSchema>
