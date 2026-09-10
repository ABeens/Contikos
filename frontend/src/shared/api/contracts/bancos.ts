import { z } from 'zod'
import { FechaISO, Importe, ModuloSchema, MonedaSchema } from './comunes'
import { SolicitudAsientoSchema } from './conta'

/**
 * Contrato del módulo de tesorería (docs/06).
 *
 * El módulo responde tres preguntas distintas y por eso tiene tres entidades
 * que no se mezclan:
 *
 * - **Dónde está el dinero.** El catálogo de cuentas bancarias, que es además
 *   el catálogo del auxiliar `banco`: cada cuenta bancaria se corresponde con
 *   una cuenta de control del mayor, una a una.
 * - **Qué movió la empresa.** `MovimientoBancario`, que es lo que la empresa
 *   registró: los cobros de CxC, los pagos de CxP y lo que nace aquí, que son
 *   las comisiones, los intereses y los traspasos entre cuentas propias.
 * - **Qué dice el banco.** `MovimientoEstadoCuenta`, que es lo que viene del
 *   estado de cuenta y que nadie escribió en el mayor.
 *
 * **Las dos tablas de movimientos son el diseño central del módulo** (docs/06
 * §1) y están separadas a propósito. Son dos universos que solo se cruzan en la
 * conciliación: meterlos en una sola tabla hace imposible conciliar, porque
 * desaparece justo la diferencia que la conciliación existe para explicar.
 */

/* --------------------------------------------------- Cuenta bancaria */

/**
 * Tipo de cuenta (docs/06 §1).
 *
 * `caja_chica` está en la lista aunque no sea una cuenta de banco: es efectivo
 * bajo custodia, se arquea igual que se concilia una cuenta bancaria y su
 * cuenta de control se comporta igual en el mayor. Lo que no tiene es estado
 * de cuenta que importar.
 */
export const TipoCuentaBancariaSchema = z.enum([
  'cheques',
  'ahorro',
  'inversion',
  'caja_chica',
])

export type TipoCuentaBancaria = z.infer<typeof TipoCuentaBancariaSchema>

export const CuentaBancariaSchema = z.object({
  /**
   * Es también el `auxiliarId` con el que la cuenta aparece en el mayor
   * (`bco-001`). No son dos identificadores que haya que mantener iguales: es
   * uno, y por eso la cuenta bancaria puede nacer del asiento y el asiento de
   * la cuenta bancaria sin que ninguno de los dos tenga que traducir nada.
   */
  id: z.string(),
  /** Llave visible: BCO-001. */
  codigo: z.string(),
  /** Nombre de la entidad: Banco Nacional, BAC San José. */
  banco: z.string(),
  /** Alias con el que la conoce la empresa. Es lo que se lee en las listas. */
  nombre: z.string(),
  numeroCuenta: z.string(),
  /** IBAN. En Costa Rica son `CR` y veinte dígitos. Vacío = no se capturó. */
  iban: z.string().nullable(),
  tipo: TipoCuentaBancariaSchema,
  moneda: MonedaSchema,
  /**
   * Cuenta de control en el mayor (docs/03 §2).
   *
   * La correspondencia es uno a uno: una cuenta contable pertenece a una sola
   * cuenta bancaria. Es lo que permite que el auxiliar de bancos se pueda
   * conciliar contra el mayor cuenta por cuenta (docs/06 §4) sin repartir un
   * saldo entre varias fichas.
   */
  cuentaContable: z.string(),
  /** Derivado: nombre de la cuenta contable, para no pedir el catálogo. */
  cuentaContableNombre: z.string(),
  /**
   * Saldo según los movimientos propios: lo que la empresa cree que tiene.
   *
   * Derivado de la tabla de movimientos, no capturado. Es la mitad del par que
   * la conciliación cruza; la otra es `saldoBanco`.
   */
  saldoLibros: Importe,
  /**
   * Saldo del último estado de cuenta importado: lo que el banco dice.
   *
   * Nulo mientras no se haya importado ninguno. No es un saldo contable y no
   * suma en ningún estado financiero: es el dato contra el que se concilia.
   */
  saldoBanco: Importe.nullable(),
  /** Fecha del estado de cuenta del que salió `saldoBanco`. */
  saldoBancoAl: FechaISO.nullable(),
  /**
   * Derivado: movimientos propios registrados en esta cuenta.
   *
   * Es lo que congela el mapeo. En cuanto hay uno, la cuenta de control y la
   * moneda ya explican asientos que están en el mayor y dejan de ser
   * editables, igual que el mapeo de una categoría de activo con inventario
   * (docs/07 §6).
   */
  movimientos: z.number().int(),
  /** Derivado: de los anteriores, los que todavía nadie ha conciliado. */
  movimientosSinConciliar: z.number().int(),
  activa: z.boolean(),
})

export type CuentaBancaria = z.infer<typeof CuentaBancariaSchema>

/**
 * Lo que se guarda de una cuenta bancaria.
 *
 * Los derivados no están: el saldo en libros sale de los movimientos, el saldo
 * del banco del último estado de cuenta importado y el nombre de la cuenta
 * contable del catálogo. Capturar lo que ya se deduce es la forma segura de
 * que un día no coincidan.
 */
export type CuentaBancariaBase = Omit<
  CuentaBancaria,
  | 'cuentaContableNombre'
  | 'saldoLibros'
  | 'saldoBanco'
  | 'saldoBancoAl'
  | 'movimientos'
  | 'movimientosSinConciliar'
> & {
  saldoBanco: string | null
  saldoBancoAl: string | null
}

/**
 * Alta y edición.
 *
 * No lleva `id` ni `codigo`: los pone el servidor y son el mismo dato con dos
 * formas, porque el id es el auxiliar con el que la cuenta vive en el mayor.
 */
export const SolicitudCuentaBancariaSchema = z.object({
  banco: z.string().min(1, 'Indique el banco'),
  nombre: z.string().min(1, 'La cuenta requiere un nombre'),
  numeroCuenta: z.string().min(1, 'Indique el número de cuenta'),
  iban: z.string().nullable().optional(),
  tipo: TipoCuentaBancariaSchema,
  moneda: MonedaSchema,
  cuentaContable: z.string().min(1, 'Indique la cuenta de control del mayor'),
  activa: z.boolean(),
})

export type SolicitudCuentaBancaria = z.infer<
  typeof SolicitudCuentaBancariaSchema
>

/* ------------------------------------------------ Movimientos propios */

/**
 * Tipo de movimiento propio (docs/06 §1).
 *
 * Describe la naturaleza del movimiento, no su signo: el signo lo lleva el
 * importe. Un `deposito` siempre entra y un `retiro` siempre sale, pero
 * `transferencia` es la que tiene las dos caras, una por cada extremo del
 * traspaso entre cuentas propias.
 */
export const TipoMovimientoBancarioSchema = z.enum([
  'deposito',
  'retiro',
  'transferencia',
  'comision',
  'interes',
])

export type TipoMovimientoBancario = z.infer<
  typeof TipoMovimientoBancarioSchema
>

/**
 * Estado de un movimiento propio.
 *
 * Son solo dos porque la conciliación es lo único que le pasa a un movimiento
 * después de nacer. `registrado` se presenta como "sin conciliar", que es lo
 * que le importa a quien mira la lista.
 */
export const EstadoMovimientoSchema = z.enum(['registrado', 'conciliado'])

export type EstadoMovimiento = z.infer<typeof EstadoMovimientoSchema>

/**
 * De dónde vino el movimiento.
 *
 * Es la misma terna de origen del contrato de asientos (docs/02 §4) y sirve
 * para lo mismo: registrar dos veces el cobro `cob-0001` no produce dos
 * depósitos. Nulo cuando el movimiento nació aquí, de captura manual.
 */
export const OrigenMovimientoSchema = z.object({
  modulo: ModuloSchema,
  tipo: z.string(),
  id: z.string(),
})

export type OrigenMovimiento = z.infer<typeof OrigenMovimientoSchema>

export const MovimientoBancarioSchema = z.object({
  id: z.string(),
  cuentaBancariaId: z.string(),
  fecha: FechaISO,
  tipo: TipoMovimientoBancarioSchema,
  concepto: z.string(),
  /** Número de transferencia, de cheque o de documento. Vacío = sin referencia. */
  referencia: z.string().nullable(),
  /**
   * Importe **con signo**, en la moneda de la cuenta bancaria: positivo lo que
   * entra, negativo lo que sale.
   *
   * Con signo y no con dos columnas de cargo y abono a propósito: este auxiliar
   * no es el mayor, y lo que se hace con estos importes es sumarlos para tener
   * el saldo y compararlos contra el estado de cuenta. Dos columnas obligarían
   * a restar en cada suma.
   */
  importe: Importe,
  origen: OrigenMovimientoSchema.nullable(),
  estado: EstadoMovimientoSchema,
  /** Asiento que lo dejó en el mayor. Nulo solo en movimientos históricos. */
  asientoId: z.string().nullable(),
  /** Conciliación que lo casó. Nulo mientras esté sin conciliar. */
  conciliacionId: z.string().nullable(),
  creadoEn: z.string(),
})

export type MovimientoBancario = z.infer<typeof MovimientoBancarioSchema>

/* ------------------------------------- Captura manual de movimientos */

/**
 * Comisión bancaria (docs/06 §2.1).
 *
 * Es un gasto que cobra el banco descontándolo de la cuenta, así que sale del
 * banco y entra en gastos financieros. El impuesto va aparte porque es
 * acreditable: sumarlo al gasto perdería el crédito fiscal.
 */
export const SolicitudComisionSchema = z.object({
  cuentaBancariaId: z.string().min(1, 'Seleccione la cuenta bancaria'),
  fecha: FechaISO,
  concepto: z.string().min(1, 'Indique el concepto'),
  referencia: z.string().nullable().optional(),
  /** Base del gasto, sin impuesto. Positiva: el signo lo pone el módulo. */
  importe: Importe,
  /** Impuesto acreditable de la comisión. Cero cuando no lo lleva. */
  impuesto: Importe,
  /**
   * Tipo de cambio de la moneda de la cuenta contra la funcional, en la fecha
   * del movimiento. Siempre `1` cuando la cuenta ya está en la funcional.
   *
   * Se captura y no se lee del catálogo en el momento de contabilizar: lo que
   * entra al mayor es el tipo del día del hecho, y una vez emitido el asiento
   * queda congelado (docs/13 §7).
   */
  tipoCambio: Importe,
})

export type SolicitudComision = z.infer<typeof SolicitudComisionSchema>

/**
 * Interés ganado (docs/06 §5).
 *
 * El caso simétrico de la comisión: el banco abona y la contrapartida es un
 * producto financiero. No lleva impuesto acreditable, que es de quien compra;
 * la retención sobre rendimientos, cuando la haya, se captura como una comisión
 * aparte o como asiento manual, porque no es del mismo hecho.
 */
export const SolicitudInteresSchema = z.object({
  cuentaBancariaId: z.string().min(1, 'Seleccione la cuenta bancaria'),
  fecha: FechaISO,
  concepto: z.string().min(1, 'Indique el concepto'),
  referencia: z.string().nullable().optional(),
  importe: Importe,
  /** Igual que en la comisión: el del día del hecho, `1` en la funcional. */
  tipoCambio: Importe,
})

export type SolicitudInteres = z.infer<typeof SolicitudInteresSchema>

/**
 * Traspaso entre cuentas propias (docs/06 §2.1).
 *
 * El dinero no entra ni sale de la empresa: cambia de sitio. Por eso genera
 * DOS movimientos, uno en cada cuenta, y un solo asiento que las mueve a las
 * dos. Cuando las cuentas son de distinta moneda hay además una diferencia
 * cambiaria, porque lo que sale y lo que entra se convierten a la funcional
 * con tipos de cambio distintos.
 */
export const SolicitudTraspasoSchema = z.object({
  cuentaOrigenId: z.string().min(1, 'Seleccione la cuenta de origen'),
  cuentaDestinoId: z.string().min(1, 'Seleccione la cuenta de destino'),
  fecha: FechaISO,
  concepto: z.string().min(1, 'Indique el concepto'),
  referencia: z.string().nullable().optional(),
  /** Lo que sale de la cuenta de origen, en la moneda de esa cuenta. */
  importeOrigen: Importe,
  /**
   * Lo que entra en la de destino, en la moneda de la cuenta de destino.
   *
   * Se captura y no se deriva: entre dos monedas, lo que llega es lo que el
   * banco acreditó al tipo que aplicó ese día, no lo que salga de multiplicar
   * por el tipo de cambio de referencia. Con la misma moneda tiene que ser
   * igual al de origen, y la validación lo exige.
   */
  importeDestino: Importe,
  /**
   * Tipo de cambio de cada extremo contra la funcional.
   *
   * Son dos y no uno porque las dos cuentas pueden estar en monedas distintas,
   * y es justamente la diferencia entre lo que sale convertido y lo que entra
   * convertido la que produce el resultado cambiario del traspaso (docs/06
   * §2.1). Con la misma moneda los dos son iguales y la diferencia es cero.
   */
  tipoCambioOrigen: Importe,
  tipoCambioDestino: Importe,
})

export type SolicitudTraspaso = z.infer<typeof SolicitudTraspasoSchema>

/**
 * Resultado de capturar un movimiento propio.
 *
 * Devuelve los movimientos y el asiento que los dejó en el mayor: son dos
 * escrituras de un solo hecho, y el traspaso produce dos movimientos con un
 * solo asiento.
 */
export const ResultadoMovimientoSchema = z.object({
  movimientos: z.array(MovimientoBancarioSchema).min(1),
  asientoId: z.string(),
  asientoNumero: z.number().int(),
})

export type ResultadoMovimiento = z.infer<typeof ResultadoMovimientoSchema>

/** Previsualización: el asiento que se emitiría, sin escribir nada. */
export const PrevisualizacionMovimientoSchema = z.object({
  asiento: SolicitudAsientoSchema.nullable(),
  errores: z.array(z.object({ codigo: z.string(), mensaje: z.string() })),
})

export type PrevisualizacionMovimiento = z.infer<
  typeof PrevisualizacionMovimientoSchema
>

/* ------------------------------------------------------ Mapeo contable */

/**
 * Cuentas de los roles que mueve el módulo (docs/06 §5).
 *
 * El rol `banco` no está aquí: no es una cuenta fija de configuración, sino la
 * cuenta de control de cada cuenta bancaria, que vive en su ficha.
 */
export const MapeoBancosSchema = z.object({
  /** Rol `gasto` de la comisión: gastos y comisiones bancarias. */
  comision: z.string(),
  impuestoAcreditable: z.string(),
  /** Rol `ingreso` del interés ganado: productos financieros. */
  interesGanado: z.string(),
  /**
   * Diferencia cambiaria del traspaso y de la revaluación, en sus dos signos.
   * Son dos cuentas porque el catálogo las separa por naturaleza: la ganancia
   * es ingreso y la pérdida es gasto.
   */
  diferencialGanado: z.string(),
  diferencialPerdido: z.string(),
})

export type MapeoBancos = z.infer<typeof MapeoBancosSchema>

/* ------------------------------------------------- Posición de tesorería */

/** Una cuenta dentro de la posición, ya convertida a la moneda funcional. */
export const PosicionCuentaSchema = z.object({
  cuentaBancariaId: z.string(),
  codigo: z.string(),
  nombre: z.string(),
  banco: z.string(),
  moneda: MonedaSchema,
  saldoLibros: Importe,
  /** El mismo saldo en la funcional. Igual al anterior si ya lo está. */
  saldoFuncional: Importe,
  tipoCambio: Importe,
  saldoBanco: Importe.nullable(),
  movimientosSinConciliar: z.number().int(),
})

export type PosicionCuenta = z.infer<typeof PosicionCuentaSchema>

/**
 * Posición de tesorería (docs/06 §4): dónde está el dinero, ahora mismo.
 *
 * Es de lectura y no calcula nada de negocio: suma los saldos que ya tienen las
 * fichas y los convierte a la funcional para poder totalizarlos. Sumar monedas
 * distintas sin convertir es la forma más fácil de enseñar un total que no
 * significa nada.
 */
export const PosicionTesoreriaSchema = z.object({
  moneda: MonedaSchema,
  cuentas: z.array(PosicionCuentaSchema),
  total: Importe,
  totalSinConciliar: z.number().int(),
})

export type PosicionTesoreria = z.infer<typeof PosicionTesoreriaSchema>

/* --------------------------------------------- Estado de cuenta (docs/06 §2.2) */

/**
 * De dónde salió la línea del estado de cuenta.
 *
 * `api` no se usa todavía: la integración bancaria directa está fuera del
 * alcance inicial (docs/06 §7). Está declarada desde ahora porque es lo que
 * fija la forma de la importación: el día que exista, entra por aquí y no
 * cambia nada de la conciliación.
 */
export const OrigenCargaSchema = z.enum(['archivo', 'api', 'manual'])

export type OrigenCarga = z.infer<typeof OrigenCargaSchema>

/**
 * Una línea del estado de cuenta: lo que dice el banco.
 *
 * Es la SEGUNDA tabla de movimientos del módulo y no se mezcla con la primera
 * (docs/06 §1). Nada de lo que hay aquí está en el mayor, y no tiene por qué
 * estarlo: es la versión del banco, y la conciliación existe justamente para
 * explicar en qué se diferencia de la de la empresa.
 */
export const MovimientoEstadoCuentaSchema = z.object({
  id: z.string(),
  cuentaBancariaId: z.string(),
  /** Cuándo ocurrió la operación. Es la fecha con la que se empareja. */
  fechaOperacion: FechaISO,
  /** Cuándo quedó disponible el dinero. El banco las distingue; nosotros también. */
  fechaValor: FechaISO,
  descripcion: z.string(),
  referencia: z.string().nullable(),
  /** Lo que el banco cargó (salió) y lo que abonó (entró). Ambos positivos. */
  cargo: Importe,
  abono: Importe,
  /** Saldo que el banco reporta tras la línea. Nulo si el archivo no lo trae. */
  saldo: Importe.nullable(),
  origenCarga: OrigenCargaSchema,
  conciliacionId: z.string().nullable(),
  /**
   * Huella de deduplicación.
   *
   * `(cuenta, fecha de operación, importe, referencia)`, que es la clave que
   * docs/06 §2.2 propone. Recargar el mismo archivo o traslapar fechas entre
   * dos cargas no duplica movimientos, y eso es barato aquí y carísimo después.
   */
  huella: z.string(),
  importadoEn: z.string(),
})

export type MovimientoEstadoCuenta = z.infer<
  typeof MovimientoEstadoCuentaSchema
>

/**
 * Importación de un estado de cuenta.
 *
 * El contenido viaja como texto y no como archivo binario a propósito: el
 * parser es por banco tras una interfaz común (docs/06 §2.2), y lo que cada
 * parser recibe es texto. El día que haya que soportar un formato binario, lo
 * que cambia es quién lo convierte a texto antes de llegar aquí.
 */
export const SolicitudImportacionSchema = z.object({
  cuentaBancariaId: z.string().min(1, 'Seleccione la cuenta bancaria'),
  /** Identificador del parser. `csv_generico` es el respaldo universal. */
  formato: z.string().min(1, 'Indique el formato del archivo'),
  contenido: z.string().min(1, 'El archivo está vacío'),
  /** Nombre del archivo, para dejar rastro de qué se cargó. */
  archivo: z.string().nullable().optional(),
})

export type SolicitudImportacion = z.infer<typeof SolicitudImportacionSchema>

/** Una línea que el parser no pudo leer, con el motivo y su número. */
export const FilaRechazadaSchema = z.object({
  linea: z.number().int(),
  contenido: z.string(),
  motivo: z.string(),
})

export type FilaRechazada = z.infer<typeof FilaRechazadaSchema>

/**
 * Lo que dejó una importación.
 *
 * Los duplicados se cuentan y no se ocultan: que un archivo traiga cuarenta
 * líneas ya conocidas es normal cuando se traslapan fechas, y verlo es la
 * confirmación de que la deduplicación funcionó, no un error.
 */
export const ResultadoImportacionSchema = z.object({
  cuentaBancariaId: z.string(),
  formato: z.string(),
  leidas: z.number().int(),
  importadas: z.number().int(),
  duplicadas: z.number().int(),
  rechazadas: z.array(FilaRechazadaSchema),
  /** Rango de fechas del archivo. Nulo si no se importó ninguna línea. */
  desde: FechaISO.nullable(),
  hasta: FechaISO.nullable(),
  /** Saldo de la última línea, si el archivo lo trae. Es el saldo del banco. */
  saldoFinal: Importe.nullable(),
  movimientos: z.array(MovimientoEstadoCuentaSchema),
})

export type ResultadoImportacion = z.infer<typeof ResultadoImportacionSchema>

/** Un formato de archivo que el módulo sabe leer. */
export const FormatoImportacionSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  descripcion: z.string(),
  /**
   * Archivo de muestra del formato, si el servidor ofrece uno.
   *
   * Sirve para poder recorrer la importación y la conciliación sin tener a mano
   * un archivo del banco. Es un dato del servidor y no de la pantalla: quien
   * sabe qué datos tiene la empresa es quien contesta.
   */
  ejemplo: z.string().nullable(),
})

export type FormatoImportacion = z.infer<typeof FormatoImportacionSchema>

/* ------------------------------------------------ Conciliación (docs/06 §2.3) */

/**
 * Regla que emparejó un movimiento propio con uno del banco.
 *
 * Van de más a menos estricta y se aplican en cascada (docs/06 §2.3). El orden
 * no es decorativo: es lo que hace que la regla floja no se coma un movimiento
 * que la estricta habría casado bien.
 */
export const ReglaEmparejamientoSchema = z.enum([
  /** 1. Referencia exacta e importe exacto. Es la buena. */
  'referencia_importe',
  /** 2. Importe exacto y fecha dentro de una ventana de días. */
  'importe_fecha',
  /** 3. Importe exacto y coincidencia parcial de descripción. */
  'importe_descripcion',
  /** 4. Varios movimientos propios sumados contra uno del banco. */
  'agrupado',
  /** Lo casó una persona. No hay regla que lo explique y no hace falta. */
  'manual',
])

export type ReglaEmparejamiento = z.infer<typeof ReglaEmparejamientoSchema>

/**
 * Un emparejamiento propuesto por el motor.
 *
 * `requiereConfirmacion` no es una preferencia: la regla 4, sumar varios
 * movimientos propios contra uno del banco, es la que más falsos positivos
 * produce y el diseño pide expresamente que no se aplique en silencio.
 */
export const SugerenciaEmparejamientoSchema = z.object({
  regla: ReglaEmparejamientoSchema,
  movimientosPropios: z.array(z.string()).min(1),
  movimientoBanco: z.string(),
  /** Días de diferencia entre las fechas. Cero es el mismo día. */
  diasDiferencia: z.number().int(),
  requiereConfirmacion: z.boolean(),
  /** Por qué se propone, en una línea. Se enseña junto a la propuesta. */
  motivo: z.string(),
})

export type SugerenciaEmparejamiento = z.infer<
  typeof SugerenciaEmparejamientoSchema
>

/**
 * Lo que explica la diferencia entre los dos saldos (docs/06 §2.3).
 *
 * Los dos primeros tipos son informativos: el movimiento existe en un lado y
 * llegará al otro. Los dos últimos exigen acción, porque son dinero que el
 * banco movió y la empresa no ha registrado: hay que capturarlos y
 * contabilizarlos antes de poder cerrar.
 */
export const TipoPartidaSchema = z.enum([
  'cheque_transito',
  'deposito_transito',
  'cargo_no_registrado',
  'abono_no_registrado',
])

export type TipoPartida = z.infer<typeof TipoPartidaSchema>

export const PartidaConciliatoriaSchema = z.object({
  tipo: TipoPartidaSchema,
  descripcion: z.string(),
  fecha: FechaISO,
  /** Con signo, en la moneda de la cuenta. */
  importe: Importe,
  /** Movimiento propio o línea del banco que la origina. */
  movimientoId: z.string(),
  /** True cuando hay que registrar y contabilizar algo para resolverla. */
  exigeAccion: z.boolean(),
})

export type PartidaConciliatoria = z.infer<typeof PartidaConciliatoriaSchema>

/**
 * La conciliación de una cuenta a una fecha de corte, calculada.
 *
 * No se almacena: se recalcula sobre el estado vigente cada vez que se pide,
 * igual que la balanza. Lo que sí se guarda es el cierre, que es la decisión
 * de dar por buena una foto.
 *
 * La ecuación que tiene que cerrar (docs/06 §2.3):
 *
 * ```
 * saldo_banco − cheques_en_tránsito + depósitos_en_tránsito = saldo_libros
 * ```
 */
export const ResumenConciliacionSchema = z.object({
  cuentaBancariaId: z.string(),
  moneda: MonedaSchema,
  fechaCorte: FechaISO,
  /** Lo que dice el banco. Del estado de cuenta, o capturado a mano. */
  saldoBanco: Importe.nullable(),
  /** Lo que dicen los movimientos propios hasta la fecha de corte. */
  saldoLibros: Importe,
  /** El del banco corregido por lo que está en tránsito. */
  saldoBancoAjustado: Importe.nullable(),
  /** Ajustado menos libros. Tiene que ser cero para poder cerrar. */
  diferencia: Importe.nullable(),
  partidas: z.array(PartidaConciliatoriaSchema),
  /** Movimientos propios sin conciliar a la fecha de corte. */
  propiosSinConciliar: z.array(MovimientoBancarioSchema),
  /** Líneas del banco sin conciliar a la fecha de corte. */
  bancoSinConciliar: z.array(MovimientoEstadoCuentaSchema),
  sugerencias: z.array(SugerenciaEmparejamientoSchema),
  /** Sin diferencia, con saldo del banco y sin partidas que exijan acción. */
  puedeCerrar: z.boolean(),
  /** Por qué no se puede cerrar, cuando no se puede. */
  impedimentos: z.array(z.string()),
})

export type ResumenConciliacion = z.infer<typeof ResumenConciliacionSchema>

/**
 * Un emparejamiento consumado.
 *
 * Se aplica de uno en uno y siempre por decisión de alguien, aunque la
 * propuesta venga del motor: aceptar una sugerencia ES la decisión. Todo lo
 * emparejado es reversible mientras la conciliación no se cierre.
 */
export const SolicitudEmparejamientoSchema = z.object({
  cuentaBancariaId: z.string().min(1),
  movimientosPropios: z.array(z.string()).min(1, 'Elija el movimiento propio'),
  movimientoBanco: z.string().min(1, 'Elija la línea del estado de cuenta'),
  regla: ReglaEmparejamientoSchema,
})

export type SolicitudEmparejamiento = z.infer<
  typeof SolicitudEmparejamientoSchema
>

export const ConciliacionSchema = z.object({
  id: z.string(),
  cuentaBancariaId: z.string(),
  fechaCorte: FechaISO,
  saldoBanco: Importe,
  saldoLibros: Importe,
  /** Cero: una conciliación no se cierra con diferencia (docs/06 §2.3). */
  diferencia: Importe,
  partidas: z.array(PartidaConciliatoriaSchema),
  /** Movimientos propios y líneas del banco que quedaron dentro. */
  movimientosPropios: z.number().int(),
  movimientosBanco: z.number().int(),
  cerradaEn: z.string(),
  cerradaPor: z.string(),
})

export type Conciliacion = z.infer<typeof ConciliacionSchema>

export const SolicitudCierreConciliacionSchema = z.object({
  cuentaBancariaId: z.string().min(1),
  fechaCorte: FechaISO,
  /** El del estado de cuenta. Se captura cuando el archivo no lo trae. */
  saldoBanco: Importe,
})

export type SolicitudCierreConciliacion = z.infer<
  typeof SolicitudCierreConciliacionSchema
>

/* --------------------------------------------- Revaluación (docs/06 §6) */

/** Una cuenta bancaria dentro de la corrida de revaluación. */
export const LineaRevaluacionSchema = z.object({
  cuentaBancariaId: z.string(),
  codigo: z.string(),
  nombre: z.string(),
  cuentaContable: z.string(),
  moneda: MonedaSchema,
  /** Lo que hay en la cuenta, en su moneda. La revaluación no lo toca. */
  saldoMoneda: Importe,
  tipoCambio: Importe,
  /** Lo que el mayor dice hoy que vale. */
  saldoFuncionalActual: Importe,
  /** Lo que vale al tipo de cambio de cierre. */
  saldoFuncionalRevaluado: Importe,
  /** Revaluado menos actual. Positivo es ganancia no realizada. */
  diferencia: Importe,
})

export type LineaRevaluacion = z.infer<typeof LineaRevaluacionSchema>

/**
 * Corrida de revaluación de un periodo.
 *
 * La diferencia va a resultado cambiario **no realizado**: nadie vendió esos
 * dólares, solo valen otra cosa. Es lo contrario de la diferencia de un cobro o
 * un pago, que sí es realizada porque el dinero se movió.
 */
export const CorridaRevaluacionSchema = z.object({
  periodoId: z.string(),
  fecha: FechaISO,
  moneda: MonedaSchema,
  lineas: z.array(LineaRevaluacionSchema),
  total: Importe,
  hayQueContabilizar: z.boolean(),
})

export type CorridaRevaluacion = z.infer<typeof CorridaRevaluacionSchema>

/** GET /bancos/revaluacion: la corrida y el asiento que generaría. */
export const PrevisualizacionRevaluacionSchema = z.object({
  corrida: CorridaRevaluacionSchema,
  /** Nulo cuando no hay ninguna diferencia que reconocer. */
  asiento: SolicitudAsientoSchema.nullable(),
})

export type PrevisualizacionRevaluacion = z.infer<
  typeof PrevisualizacionRevaluacionSchema
>

export const SolicitudRevaluacionSchema = z.object({
  periodoId: z.string().min(1, 'Indique el periodo'),
})

export type SolicitudRevaluacion = z.infer<typeof SolicitudRevaluacionSchema>

export const ResultadoRevaluacionSchema = z.object({
  corrida: CorridaRevaluacionSchema,
  asientoId: z.string(),
  asientoNumero: z.number().int(),
})

export type ResultadoRevaluacion = z.infer<typeof ResultadoRevaluacionSchema>
