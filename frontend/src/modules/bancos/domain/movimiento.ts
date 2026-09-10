import Decimal from 'decimal.js'
import { Money, type Moneda } from '@/shared/money/money'
import type {
  Cuenta,
  LineaSolicitud,
  Periodo,
  SolicitudAsiento,
} from '@/shared/api/contracts/conta'
import type {
  CuentaBancaria,
  MapeoBancos,
  MovimientoBancario,
  SolicitudComision,
  SolicitudInteres,
  SolicitudTraspaso,
  TipoMovimientoBancario,
} from '@/shared/api/contracts/bancos'
import { cuentaPorCodigo } from '@/shared/cuentas/cuenta'

/**
 * Movimientos propios de tesorería (docs/06 §2.1).
 *
 * La mayoría de lo que pasa por una cuenta bancaria **no se captura aquí**:
 * llega de otros módulos. El cobro de CxC deposita, el pago de CxP retira, y el
 * día que exista, la dispersión de nómina retira. Lo que nace en este módulo
 * son las tres cosas que no son de nadie más: las comisiones que cobra el
 * banco, los intereses que abona y los traspasos entre cuentas propias.
 *
 * Esa distinción es la que decide quién emite el asiento. Un movimiento que
 * llega de otro módulo YA está contabilizado por quien lo originó, y aquí solo
 * se registra para poder conciliarlo; uno que nace aquí genera su propio
 * asiento. Registrar el primero otra vez duplicaría el efectivo.
 *
 * Todo lo de este archivo es puro: recibe la solicitud, el catálogo y el mapeo,
 * y devuelve las verificaciones y el asiento que se emitiría. Quien escribe lo
 * llama dos veces con los mismos datos, una para enseñar el asiento antes de
 * confirmar y otra para contabilizarlo, y por construcción obtiene lo mismo.
 */

export const MODULO_ORIGEN = 'bancos' as const

export const TIPO_ORIGEN_COMISION = 'comision'
export const TIPO_ORIGEN_INTERES = 'interes'
export const TIPO_ORIGEN_TRASPASO = 'traspaso'

/**
 * Tipos de origen de los movimientos que llegan de fuera.
 *
 * Se nombran aquí, con el módulo que los publica, porque son la llave con la
 * que este módulo reconoce un evento que ya vio: recibir dos veces el cobro
 * `cob-0001` no puede producir dos depósitos (docs/06 §2.1).
 */
export const ORIGEN_COBRO = { modulo: 'cxc' as const, tipo: 'cobro' }
export const ORIGEN_PAGO = { modulo: 'cxp' as const, tipo: 'pago' }

export type CodigoErrorMovimiento =
  | 'CUENTA_BANCARIA_INVALIDA'
  | 'CUENTA_BANCARIA_INACTIVA'
  | 'CUENTA_CONTABLE_INVALIDA'
  | 'IMPORTE_INVALIDO'
  | 'IMPUESTO_INVALIDO'
  | 'TIPO_CAMBIO_INVALIDO'
  | 'CONCEPTO_REQUERIDO'
  | 'PERIODO_CERRADO'
  | 'MAPEO_INCOMPLETO'
  | 'MISMA_CUENTA'
  | 'IMPORTES_DISTINTOS'

export interface ErrorMovimiento {
  readonly codigo: CodigoErrorMovimiento
  readonly mensaje: string
}

export interface ResultadoMovimiento {
  readonly valido: boolean
  readonly errores: readonly ErrorMovimiento[]
}

export interface ContextoMovimiento {
  readonly cuentasBancarias: readonly CuentaBancaria[]
  readonly cuentas: readonly Cuenta[]
  readonly periodos: readonly Periodo[]
  readonly mapeo: MapeoBancos
  readonly monedaFuncional: Moneda
}

const ETIQUETAS: Record<TipoMovimientoBancario, string> = {
  deposito: 'Depósito',
  retiro: 'Retiro',
  transferencia: 'Traspaso',
  comision: 'Comisión',
  interes: 'Interés',
}

export function etiquetaTipoMovimiento(tipo: TipoMovimientoBancario): string {
  return ETIQUETAS[tipo] ?? tipo
}

/* ----------------------------------------------------- Utilidades */

function aDecimal(valor: string | undefined): Decimal {
  try {
    return new Decimal(valor && valor.trim() !== '' ? valor : 0)
  } catch {
    return new Decimal(0)
  }
}

function periodoDe(
  fecha: string,
  periodos: readonly Periodo[],
): Periodo | undefined {
  return periodos.find((p) => fecha >= p.fechaInicio && fecha <= p.fechaFin)
}

/** El asiento cae en periodo abierto o no cae (docs/02 §3, validación 3). */
function comprobarPeriodo(
  fecha: string,
  periodos: readonly Periodo[],
  errores: ErrorMovimiento[],
): void {
  const periodo = periodoDe(fecha, periodos)
  if (!periodo || periodo.estado !== 'abierto') {
    errores.push({
      codigo: 'PERIODO_CERRADO',
      mensaje: periodo
        ? `El periodo de ${fecha} está ${periodo.estado}`
        : `La fecha ${fecha} no cae en ningún periodo contable`,
    })
  }
}

function comprobarCuentaMapeo(
  codigo: string,
  rol: string,
  cuentas: readonly Cuenta[],
  errores: ErrorMovimiento[],
): void {
  const cuenta = cuentaPorCodigo(cuentas, codigo)
  if (!cuenta || !cuenta.esDetalle || !cuenta.activa) {
    errores.push({
      codigo: 'MAPEO_INCOMPLETO',
      mensaje: `La cuenta del rol ${rol} no está configurada o no admite movimientos`,
    })
  }
}

/**
 * Cuenta bancaria en la que se va a mover el dinero.
 *
 * Comprueba las tres cosas de las que depende todo lo demás: que exista, que
 * esté activa y que su cuenta de control siga siendo utilizable en el mayor.
 */
function comprobarCuentaBancaria(
  id: string,
  contexto: ContextoMovimiento,
  errores: ErrorMovimiento[],
  etiqueta = 'La cuenta bancaria',
): CuentaBancaria | undefined {
  const cuenta = contexto.cuentasBancarias.find((c) => c.id === id)
  if (!cuenta) {
    errores.push({
      codigo: 'CUENTA_BANCARIA_INVALIDA',
      mensaje: `${etiqueta} no existe en el catálogo`,
    })
    return undefined
  }
  if (!cuenta.activa) {
    errores.push({
      codigo: 'CUENTA_BANCARIA_INACTIVA',
      mensaje: `${etiqueta} ${cuenta.codigo} está inactiva`,
    })
  }
  const contable = cuentaPorCodigo(contexto.cuentas, cuenta.cuentaContable)
  if (!contable || !contable.esDetalle || !contable.activa) {
    errores.push({
      codigo: 'CUENTA_CONTABLE_INVALIDA',
      mensaje: `La cuenta de control ${cuenta.cuentaContable} de ${cuenta.codigo} no admite movimientos`,
    })
  }
  return cuenta
}

function comprobarTipoCambio(
  valor: string,
  cuenta: CuentaBancaria | undefined,
  funcional: Moneda,
  errores: ErrorMovimiento[],
): void {
  const tc = aDecimal(valor)
  if (tc.lessThanOrEqualTo(0)) {
    errores.push({
      codigo: 'TIPO_CAMBIO_INVALIDO',
      mensaje: 'El tipo de cambio debe ser mayor que cero',
    })
    return
  }
  // En la funcional el único tipo de cambio posible es 1. Aceptar otro dejaría
  // entrar al mayor un importe distinto del que dice el documento.
  if (cuenta && cuenta.moneda === funcional && !tc.equals(1)) {
    errores.push({
      codigo: 'TIPO_CAMBIO_INVALIDO',
      mensaje: `${cuenta.codigo} está en la moneda funcional: su tipo de cambio es 1`,
    })
  }
}

/** Importe de la cuenta bancaria convertido a la moneda del mayor. */
function enFuncional(
  importe: Decimal,
  tipoCambio: string,
  funcional: Moneda,
): Money {
  return new Money(importe.times(aDecimal(tipoCambio)), funcional).redondear()
}

/* ---------------------------------------------------------- Comisión */

export function validarComision(
  solicitud: SolicitudComision,
  contexto: ContextoMovimiento,
): ResultadoMovimiento {
  const errores: ErrorMovimiento[] = []
  const cuenta = comprobarCuentaBancaria(
    solicitud.cuentaBancariaId,
    contexto,
    errores,
  )

  if (solicitud.concepto.trim() === '') {
    errores.push({ codigo: 'CONCEPTO_REQUERIDO', mensaje: 'Indique el concepto' })
  }
  if (aDecimal(solicitud.importe).lessThanOrEqualTo(0)) {
    errores.push({
      codigo: 'IMPORTE_INVALIDO',
      mensaje: 'El importe de la comisión debe ser mayor que cero',
    })
  }
  if (aDecimal(solicitud.impuesto).isNegative()) {
    errores.push({
      codigo: 'IMPUESTO_INVALIDO',
      mensaje: 'El impuesto no puede ser negativo',
    })
  }

  comprobarTipoCambio(
    solicitud.tipoCambio,
    cuenta,
    contexto.monedaFuncional,
    errores,
  )
  comprobarPeriodo(solicitud.fecha, contexto.periodos, errores)
  comprobarCuentaMapeo(contexto.mapeo.comision, 'comisión', contexto.cuentas, errores)
  if (aDecimal(solicitud.impuesto).greaterThan(0)) {
    comprobarCuentaMapeo(
      contexto.mapeo.impuestoAcreditable,
      'impuesto acreditable',
      contexto.cuentas,
      errores,
    )
  }

  return { valido: errores.length === 0, errores }
}

/**
 * Asiento de la comisión bancaria (docs/06 §2.1).
 *
 * | Cuenta              | Cargo    | Abono |
 * |---------------------|----------|-------|
 * | Gastos financieros  | Importe  |       |
 * | IVA acreditable     | Impuesto |       |
 * | Bancos              |          | Total |
 *
 * El impuesto va en su propia línea y no sumado al gasto porque es acreditable:
 * lo que se puede compensar contra el IVA por pagar tiene que estar en la
 * cuenta de crédito fiscal, no escondido dentro de un gasto.
 */
export function armarAsientoComision(
  movimientoId: string,
  solicitud: SolicitudComision,
  cuenta: CuentaBancaria,
  contexto: ContextoMovimiento,
): SolicitudAsiento {
  const funcional = contexto.monedaFuncional
  const base = enFuncional(
    aDecimal(solicitud.importe),
    solicitud.tipoCambio,
    funcional,
  )
  const impuesto = enFuncional(
    aDecimal(solicitud.impuesto),
    solicitud.tipoCambio,
    funcional,
  )
  const total = base.plus(impuesto)
  const concepto = solicitud.concepto.trim()

  const lineas: LineaSolicitud[] = [
    {
      cuenta: contexto.mapeo.comision,
      concepto,
      cargo: base.toApi(),
      abono: '0',
    },
  ]

  if (impuesto.esPositivo()) {
    lineas.push({
      cuenta: contexto.mapeo.impuestoAcreditable,
      concepto: `Impuesto de ${concepto}`,
      cargo: impuesto.toApi(),
      abono: '0',
    })
  }

  lineas.push({
    cuenta: cuenta.cuentaContable,
    concepto: `${cuenta.banco} · ${cuenta.numeroCuenta}`,
    cargo: '0',
    abono: total.toApi(),
    auxiliarTipo: 'banco',
    auxiliarId: cuenta.id,
  })

  return {
    fecha: solicitud.fecha,
    concepto: `Comisión bancaria · ${concepto}`,
    // La moneda del asiento es la funcional porque sus importes lo son; el
    // movimiento conserva la de su cuenta y el tipo de cambio con el que se
    // convirtió, igual que hace el pago de CxP (docs/05 §2.2).
    moneda: funcional,
    tipoCambio: '1',
    origen: {
      modulo: MODULO_ORIGEN,
      tipo: TIPO_ORIGEN_COMISION,
      id: movimientoId,
    },
    lineas,
  }
}

/* ------------------------------------------------------ Interés ganado */

export function validarInteres(
  solicitud: SolicitudInteres,
  contexto: ContextoMovimiento,
): ResultadoMovimiento {
  const errores: ErrorMovimiento[] = []
  const cuenta = comprobarCuentaBancaria(
    solicitud.cuentaBancariaId,
    contexto,
    errores,
  )

  if (solicitud.concepto.trim() === '') {
    errores.push({ codigo: 'CONCEPTO_REQUERIDO', mensaje: 'Indique el concepto' })
  }
  if (aDecimal(solicitud.importe).lessThanOrEqualTo(0)) {
    errores.push({
      codigo: 'IMPORTE_INVALIDO',
      mensaje: 'El interés debe ser mayor que cero',
    })
  }

  comprobarTipoCambio(
    solicitud.tipoCambio,
    cuenta,
    contexto.monedaFuncional,
    errores,
  )
  comprobarPeriodo(solicitud.fecha, contexto.periodos, errores)
  comprobarCuentaMapeo(
    contexto.mapeo.interesGanado,
    'interés ganado',
    contexto.cuentas,
    errores,
  )

  return { valido: errores.length === 0, errores }
}

/**
 * Asiento del interés ganado (docs/06 §5).
 *
 * El banco abona y la contrapartida es un producto financiero: cargo a bancos,
 * abono a ingresos. Es la comisión al revés.
 */
export function armarAsientoInteres(
  movimientoId: string,
  solicitud: SolicitudInteres,
  cuenta: CuentaBancaria,
  contexto: ContextoMovimiento,
): SolicitudAsiento {
  const funcional = contexto.monedaFuncional
  const importe = enFuncional(
    aDecimal(solicitud.importe),
    solicitud.tipoCambio,
    funcional,
  )
  const concepto = solicitud.concepto.trim()

  return {
    fecha: solicitud.fecha,
    concepto: `Interés ganado · ${concepto}`,
    moneda: funcional,
    tipoCambio: '1',
    origen: {
      modulo: MODULO_ORIGEN,
      tipo: TIPO_ORIGEN_INTERES,
      id: movimientoId,
    },
    lineas: [
      {
        cuenta: cuenta.cuentaContable,
        concepto: `${cuenta.banco} · ${cuenta.numeroCuenta}`,
        cargo: importe.toApi(),
        abono: '0',
        auxiliarTipo: 'banco',
        auxiliarId: cuenta.id,
      },
      {
        cuenta: contexto.mapeo.interesGanado,
        concepto,
        cargo: '0',
        abono: importe.toApi(),
      },
    ],
  }
}

/* ----------------------------------------------------------- Traspaso */

export function validarTraspaso(
  solicitud: SolicitudTraspaso,
  contexto: ContextoMovimiento,
): ResultadoMovimiento {
  const errores: ErrorMovimiento[] = []

  if (solicitud.cuentaOrigenId === solicitud.cuentaDestinoId) {
    errores.push({
      codigo: 'MISMA_CUENTA',
      mensaje: 'El traspaso va entre dos cuentas distintas',
    })
  }

  const origen = comprobarCuentaBancaria(
    solicitud.cuentaOrigenId,
    contexto,
    errores,
    'La cuenta de origen',
  )
  const destino =
    solicitud.cuentaDestinoId === solicitud.cuentaOrigenId
      ? undefined
      : comprobarCuentaBancaria(
          solicitud.cuentaDestinoId,
          contexto,
          errores,
          'La cuenta de destino',
        )

  if (solicitud.concepto.trim() === '') {
    errores.push({ codigo: 'CONCEPTO_REQUERIDO', mensaje: 'Indique el concepto' })
  }

  const salida = aDecimal(solicitud.importeOrigen)
  const entrada = aDecimal(solicitud.importeDestino)
  if (salida.lessThanOrEqualTo(0) || entrada.lessThanOrEqualTo(0)) {
    errores.push({
      codigo: 'IMPORTE_INVALIDO',
      mensaje: 'Los dos importes del traspaso deben ser mayores que cero',
    })
  } else if (
    origen &&
    destino &&
    origen.moneda === destino.moneda &&
    !salida.equals(entrada)
  ) {
    // Entre cuentas de la misma moneda, lo que sale es lo que entra. Si no lo
    // es, falta un movimiento (una comisión de traspaso, por ejemplo) y hay que
    // capturarlo aparte en vez de esconderlo dentro del traspaso.
    errores.push({
      codigo: 'IMPORTES_DISTINTOS',
      mensaje: `Las dos cuentas están en ${origen.moneda}: lo que sale y lo que entra tienen que ser el mismo importe`,
    })
  }

  comprobarTipoCambio(
    solicitud.tipoCambioOrigen,
    origen,
    contexto.monedaFuncional,
    errores,
  )
  comprobarTipoCambio(
    solicitud.tipoCambioDestino,
    destino,
    contexto.monedaFuncional,
    errores,
  )
  comprobarPeriodo(solicitud.fecha, contexto.periodos, errores)

  // El mapeo cambiario solo hace falta cuando hay diferencia, pero se comprueba
  // siempre que las monedas difieran: es donde puede aparecer.
  if (origen && destino && origen.moneda !== destino.moneda) {
    comprobarCuentaMapeo(
      contexto.mapeo.diferencialGanado,
      'diferencial cambiario ganado',
      contexto.cuentas,
      errores,
    )
    comprobarCuentaMapeo(
      contexto.mapeo.diferencialPerdido,
      'diferencial cambiario perdido',
      contexto.cuentas,
      errores,
    )
  }

  return { valido: errores.length === 0, errores }
}

/**
 * Diferencia cambiaria del traspaso.
 *
 * Positiva cuando entra más de lo que sale, medido en la moneda funcional. Con
 * las dos cuentas en la misma moneda es cero por construcción, porque la
 * validación ya exigió que los importes sean iguales y el tipo de cambio de las
 * dos es el mismo.
 */
export function diferenciaTraspaso(
  solicitud: SolicitudTraspaso,
  funcional: Moneda,
): Money {
  const salida = enFuncional(
    aDecimal(solicitud.importeOrigen),
    solicitud.tipoCambioOrigen,
    funcional,
  )
  const entrada = enFuncional(
    aDecimal(solicitud.importeDestino),
    solicitud.tipoCambioDestino,
    funcional,
  )
  return entrada.minus(salida)
}

/**
 * Asiento del traspaso entre cuentas propias (docs/06 §2.1).
 *
 * | Cuenta            | Cargo   | Abono   |
 * |-------------------|---------|---------|
 * | Bancos (destino)  | Importe |         |
 * | Bancos (origen)   |         | Importe |
 *
 * El dinero no entra ni sale de la empresa: cambia de sitio, y por eso el
 * asiento no toca ninguna cuenta de resultados. La excepción es el traspaso
 * entre monedas distintas, donde lo que sale y lo que entra no valen lo mismo
 * en la funcional y la diferencia es un resultado cambiario realizado.
 */
export function armarAsientoTraspaso(
  traspasoId: string,
  solicitud: SolicitudTraspaso,
  origen: CuentaBancaria,
  destino: CuentaBancaria,
  contexto: ContextoMovimiento,
): SolicitudAsiento {
  const funcional = contexto.monedaFuncional
  const salida = enFuncional(
    aDecimal(solicitud.importeOrigen),
    solicitud.tipoCambioOrigen,
    funcional,
  )
  const entrada = enFuncional(
    aDecimal(solicitud.importeDestino),
    solicitud.tipoCambioDestino,
    funcional,
  )
  const diferencia = entrada.minus(salida)
  const concepto = solicitud.concepto.trim()

  const lineas: LineaSolicitud[] = [
    {
      cuenta: destino.cuentaContable,
      concepto: `Entra en ${destino.banco} · ${destino.numeroCuenta}`,
      cargo: entrada.toApi(),
      abono: '0',
      auxiliarTipo: 'banco',
      auxiliarId: destino.id,
    },
  ]

  // La pérdida es cargo y va antes del abono al banco de origen, para que el
  // asiento se lea en el orden en que se explica: qué entró, qué costó, de
  // dónde salió.
  if (diferencia.esNegativo()) {
    lineas.push({
      cuenta: contexto.mapeo.diferencialPerdido,
      concepto: 'Diferencial cambiario del traspaso',
      cargo: diferencia.abs().toApi(),
      abono: '0',
    })
  }

  lineas.push({
    cuenta: origen.cuentaContable,
    concepto: `Sale de ${origen.banco} · ${origen.numeroCuenta}`,
    cargo: '0',
    abono: salida.toApi(),
    auxiliarTipo: 'banco',
    auxiliarId: origen.id,
  })

  if (diferencia.esPositivo()) {
    lineas.push({
      cuenta: contexto.mapeo.diferencialGanado,
      concepto: 'Diferencial cambiario del traspaso',
      cargo: '0',
      abono: diferencia.toApi(),
    })
  }

  return {
    fecha: solicitud.fecha,
    concepto: `Traspaso ${origen.codigo} → ${destino.codigo} · ${concepto}`,
    moneda: funcional,
    tipoCambio: '1',
    origen: {
      modulo: MODULO_ORIGEN,
      tipo: TIPO_ORIGEN_TRASPASO,
      id: traspasoId,
    },
    lineas,
  }
}

/* ------------------------------------------- Construcción de la ficha */

export interface DatosMovimiento {
  id: string
  cuentaBancariaId: string
  fecha: string
  tipo: TipoMovimientoBancario
  concepto: string
  referencia?: string | null
  /** Con signo, en la moneda de la cuenta bancaria. */
  importe: string
  origen: MovimientoBancario['origen']
  asientoId: string | null
}

/**
 * Ficha de un movimiento propio, recién nacida.
 *
 * Nace `registrado`, que es como se presenta "sin conciliar": la conciliación
 * es lo único que le pasa a un movimiento después de existir, y hasta que
 * ocurra sigue siendo una diferencia entre lo que dice la empresa y lo que dirá
 * el banco.
 */
export function crearMovimiento(datos: DatosMovimiento): MovimientoBancario {
  return {
    id: datos.id,
    cuentaBancariaId: datos.cuentaBancariaId,
    fecha: datos.fecha,
    tipo: datos.tipo,
    concepto: datos.concepto.trim(),
    referencia: datos.referencia?.trim() || null,
    importe: new Decimal(datos.importe).toFixed(2),
    origen: datos.origen,
    estado: 'registrado',
    asientoId: datos.asientoId,
    conciliacionId: null,
    creadoEn: new Date().toISOString(),
  }
}

/**
 * ¿Este evento de otro módulo ya se registró?
 *
 * La comprobación es por la terna de origen y no por el importe ni por la
 * fecha: es la misma llave de idempotencia del contrato de asientos (docs/02
 * §4), y es lo que hace que reenviar un cobro no duplique el depósito.
 */
export function movimientoDeOrigen(
  movimientos: readonly MovimientoBancario[],
  modulo: string,
  tipo: string,
  id: string,
): MovimientoBancario | undefined {
  return movimientos.find(
    (m) =>
      m.origen !== null &&
      m.origen.modulo === modulo &&
      m.origen.tipo === tipo &&
      m.origen.id === id,
  )
}

/** Consecutivo del identificador de movimiento, a partir del mayor emitido. */
export function siguienteIdMovimiento(
  movimientos: readonly MovimientoBancario[],
): string {
  const mayor = movimientos.reduce((acc, m) => {
    const numero = Number(m.id.replace(/\D/g, ''))
    return Number.isNaN(numero) ? acc : Math.max(acc, numero)
  }, 0)
  return `mov-${String(mayor + 1).padStart(5, '0')}`
}
