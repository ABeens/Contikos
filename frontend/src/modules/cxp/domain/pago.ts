import Decimal from 'decimal.js'
import { Money, type Moneda } from '@/shared/money/money'
import { diasVencidos } from '@/shared/cartera/antiguedad'
import type {
  Cuenta,
  LineaSolicitud,
  Periodo,
  SolicitudAsiento,
} from '@/shared/api/contracts/conta'
import type {
  FacturaCompra,
  LineaPropuestaPago,
  MapeoCxp,
  Proveedor,
  PropuestaPago,
  SolicitudPago,
} from '@/shared/api/contracts/cxp'

/**
 * El pago a proveedores (docs/05 §2.2).
 *
 *   proponer → autorizar → emitir → aplicar a facturas → contabilizar
 *
 * De esos cinco pasos, aquí viven los tres últimos: emitir el egreso, repartirlo
 * entre las facturas del proveedor y traducirlo a asiento. Proponer es §2.3 y
 * también está aquí, al final del archivo; autorizar es el control interno de
 * §7, que necesita usuarios y todavía no existe.
 *
 * Todo lo de este archivo es puro: recibe el proveedor, sus facturas, el
 * catálogo y los periodos, y devuelve el reparto con sus errores y el asiento
 * que lo contabilizaría. El mock de hoy y el backend de mañana llaman a lo
 * mismo dos veces, una para enseñar el asiento antes de confirmar y otra al
 * grabar, y por construcción obtienen lo mismo.
 *
 * **Lo que se paga es el neto.** La factura de compra aplica retención de renta
 * y la cuenta por pagar nace por el total menos la retención (`factura.saldo`),
 * porque esa retención no se le paga al proveedor: se le entera a Hacienda. El
 * pago trabaja siempre contra `saldo`, nunca contra `total`.
 */

export type CodigoErrorPago =
  | 'PROVEEDOR_INVALIDO'
  | 'PROVEEDOR_INACTIVO'
  | 'PERIODO_CERRADO'
  | 'IMPORTE_INVALIDO'
  | 'TIPO_CAMBIO_INVALIDO'
  | 'CUENTA_INVALIDA'
  | 'CUENTA_ANTICIPO_INVALIDA'
  | 'FACTURA_NO_ENCONTRADA'
  | 'FACTURA_DE_OTRO_PROVEEDOR'
  | 'FACTURA_NO_CONTABILIZADA'
  | 'FACTURA_SIN_SALDO'
  | 'FACTURA_REPETIDA'
  | 'MONEDA_DISTINTA'
  | 'APLICACION_INVALIDA'
  | 'APLICACION_EXCEDE_SALDO'
  | 'APLICACION_EXCEDE_IMPORTE'

export interface ErrorPago {
  readonly codigo: CodigoErrorPago
  readonly mensaje: string
  /** Índice de la aplicación afectada, si el error es de una de ellas. */
  readonly aplicacion?: number
}

export interface ContextoPago {
  readonly proveedor: Proveedor | undefined
  /**
   * Facturas contra las que se aplica. Pueden venir todas: cada aplicación se
   * comprueba contra el proveedor del pago, que es lo que impide saldar la
   * factura de otro.
   */
  readonly facturas: readonly FacturaCompra[]
  readonly cuentas: readonly Cuenta[]
  readonly periodos: readonly Periodo[]
  readonly mapeo: MapeoCxp
  /** Moneda del mayor. La diferencia cambiaria solo existe en ella. */
  readonly monedaFuncional: Moneda
}

export interface AplicacionCalculada {
  readonly factura: FacturaCompra
  /** Lo aplicado, en la moneda del pago. */
  readonly importe: Money
  readonly saldoAnterior: Money
  readonly saldoResultante: Money
  /** En moneda funcional. Positiva = ganancia, negativa = pérdida. */
  readonly diferenciaCambiaria: Money
}

export interface ResultadoPago {
  readonly valido: boolean
  readonly errores: readonly ErrorPago[]
  readonly aplicaciones: readonly AplicacionCalculada[]
  /** Suma de lo aplicado, en la moneda del pago. */
  readonly aplicado: Money
  /** Lo que sobró del importe: queda como anticipo al proveedor. */
  readonly anticipo: Money
  /** Suma de las diferencias cambiarias, en moneda funcional. */
  readonly diferenciaCambiaria: Money
}

/* ------------------------------------------------------------- Cuentas */

/**
 * Cuentas de las que puede salir un pago.
 *
 * Hoy son las de efectivo y equivalentes del catálogo (`1.1.01`): caja y las
 * cuentas bancarias. El día que exista bancos (docs/11, fase 4) la lista la
 * dará su catálogo de cuentas bancarias y esto se borra; mientras tanto se
 * deriva del plan de cuentas, que es el único sitio donde ese dato existe.
 */
export function cuentasDePago(cuentas: readonly Cuenta[]): Cuenta[] {
  return cuentas.filter(
    (c) =>
      c.esDetalle &&
      c.activa &&
      c.tipo === 'activo' &&
      c.codigo.startsWith('1.1.01.'),
  )
}

/**
 * Auxiliar de la cuenta de salida, cuando la cuenta lo exige.
 *
 * Las cuentas bancarias del catálogo son cuentas de control de `bancos` y
 * exigen auxiliar de tipo `banco` (docs/02 §3, validación 8). Ese catálogo no
 * existe todavía, así que el id se deriva de la posición de la cuenta entre
 * las bancarias del plan: la primera es `bco-001`, que es exactamente la
 * convención con la que ya está sembrado el mayor de la demo.
 *
 * TODO(bancos): cuando exista el catálogo, el pago capturará la cuenta
 * bancaria y de ella saldrán las dos cosas, el código contable y este id.
 * La correspondencia es uno a uno (una cuenta contable por cuenta bancaria),
 * así que sustituir esto no cambia ningún asiento ya emitido.
 */
export function auxiliarBancoDe(
  codigo: string,
  cuentas: readonly Cuenta[],
): string | null {
  const cuenta = cuentas.find((c) => c.codigo === codigo)
  if (cuenta?.requiereAuxiliar !== 'banco') return null
  const bancarias = cuentas.filter(
    (c) => c.esDetalle && c.requiereAuxiliar === 'banco',
  )
  const posicion = bancarias.findIndex((c) => c.codigo === codigo)
  return `bco-${String(posicion + 1).padStart(3, '0')}`
}

/* ---------------------------------------------------------- Cálculo */

function periodoDe(
  fecha: string,
  periodos: readonly Periodo[],
): Periodo | undefined {
  return periodos.find((p) => fecha >= p.fechaInicio && fecha <= p.fechaFin)
}

function aDecimal(valor: string | undefined): Decimal {
  try {
    return new Decimal(valor || '0')
  } catch {
    return new Decimal(0)
  }
}

/**
 * Saldo por pagar de una factura, en su propia moneda.
 *
 * Es el neto: la retención de renta ya está descontada desde que la factura se
 * registró, porque a Hacienda se le entera aparte.
 */
export function saldoDe(factura: FacturaCompra): Money {
  return new Money(factura.saldo, factura.moneda)
}

/** true si la factura admite que se le aplique un pago. */
export function admitePago(factura: FacturaCompra): boolean {
  return factura.estado === 'contabilizada' && saldoDe(factura).esPositivo()
}

/**
 * Diferencia cambiaria de aplicar `importe` a una factura, en moneda funcional.
 *
 * El pasivo entró al mayor al tipo de cambio de la factura y se cancela con
 * colones de hoy. La diferencia es la del importe aplicado entre los dos tipos:
 *
 *   diferencia = importe × (tipoCambioFactura − tipoCambioPago)
 *
 * Positiva significa que el pasivo valía más colones de los que costó
 * pagarlo: ganancia. Negativa, pérdida. Cuando los dos tipos coinciden (y
 * siempre que se opera en moneda funcional) la diferencia es cero y el asiento
 * no lleva esa línea.
 */
export function diferenciaCambiariaDe(
  importe: Money,
  tipoCambioFactura: string,
  tipoCambioPago: string,
  monedaFuncional: Moneda,
): Money {
  const delta = aDecimal(tipoCambioFactura).minus(aDecimal(tipoCambioPago))
  return new Money(importe.monto.times(delta), monedaFuncional).redondear()
}

/**
 * Reparto por antigüedad: lo más viejo primero (docs/05 §2.3).
 *
 * Devuelve cuánto aplicar a cada factura, en su orden de vencimiento, hasta
 * agotar el importe. La última factura que alcanza queda parcialmente pagada:
 * es lo que hace un tesorero cuando el efectivo no llega para todo, y es
 * preferible a dejar sin aplicar el remanente, que se convertiría en anticipo.
 */
export function repartirPorAntiguedad(
  facturas: readonly FacturaCompra[],
  importe: Money,
): Map<string, Money> {
  const reparto = new Map<string, Money>()
  let disponible = importe.redondear()

  for (const factura of ordenarPorVencimiento(facturas.filter(admitePago))) {
    if (!disponible.esPositivo()) break
    if (factura.moneda !== importe.moneda) continue
    const saldo = saldoDe(factura)
    const aplicar = saldo.comparadoCon(disponible) <= 0 ? saldo : disponible
    reparto.set(factura.id, aplicar)
    disponible = disponible.minus(aplicar)
  }

  return reparto
}

/** Más viejas primero. El folio interno desempata para que sea determinista. */
export function ordenarPorVencimiento(
  facturas: readonly FacturaCompra[],
): FacturaCompra[] {
  return [...facturas].sort(
    (a, b) =>
      a.fechaVencimiento.localeCompare(b.fechaVencimiento) ||
      a.folioInterno.localeCompare(b.folioInterno),
  )
}

/**
 * Calcula el pago y lo valida, en una sola pasada.
 *
 * Van juntos a propósito: la pantalla necesita el reparto para enseñarlo en
 * vivo aunque todavía no sea válido, y el servidor necesita los dos para
 * decidir. Devolver el cálculo solo cuando es válido obligaría a calcularlo
 * dos veces con reglas distintas.
 *
 * **Criterio de moneda:** una factura solo se salda con un pago en SU misma
 * moneda. Pagar una factura en dólares con un egreso en colones no es una
 * aplicación sino una compra de divisas, que tiene su propio tipo de cambio de
 * compra y su propio asiento, y que pertenece a bancos. Sin ese dato, aplicar
 * entre monedas exigiría inventar una paridad cruzada; se rechaza con
 * `MONEDA_DISTINTA`. Lo que sí puede diferir es el TIPO DE CAMBIO: esa es la
 * diferencia cambiaria, y sí se contabiliza.
 */
export function calcularPago(
  solicitud: SolicitudPago,
  contexto: ContextoPago,
): ResultadoPago {
  const errores: ErrorPago[] = []
  const moneda = solicitud.moneda
  const funcional = contexto.monedaFuncional
  const importe = new Money(aDecimal(solicitud.importe), moneda).redondear()

  if (!contexto.proveedor) {
    errores.push({
      codigo: 'PROVEEDOR_INVALIDO',
      mensaje: 'Seleccione un proveedor del catálogo',
    })
  } else if (!contexto.proveedor.activo) {
    errores.push({
      codigo: 'PROVEEDOR_INACTIVO',
      mensaje: `El proveedor ${contexto.proveedor.razonSocial} está inactivo`,
    })
  }

  if (!importe.esPositivo()) {
    errores.push({
      codigo: 'IMPORTE_INVALIDO',
      mensaje: 'El importe del pago debe ser mayor que cero',
    })
  }

  const tipoCambio = aDecimal(solicitud.tipoCambio)
  if (tipoCambio.lessThanOrEqualTo(0)) {
    errores.push({
      codigo: 'TIPO_CAMBIO_INVALIDO',
      mensaje: 'El tipo de cambio debe ser mayor que cero',
    })
  }

  const periodo = periodoDe(solicitud.fecha, contexto.periodos)
  if (!periodo) {
    errores.push({
      codigo: 'PERIODO_CERRADO',
      mensaje: `No existe un periodo contable que contenga la fecha ${solicitud.fecha}`,
    })
  } else if (periodo.estado !== 'abierto') {
    errores.push({
      codigo: 'PERIODO_CERRADO',
      mensaje: `El periodo ${periodo.numero}/${periodo.ejercicio} está ${periodo.estado}`,
    })
  }

  const salida = contexto.cuentas.find((c) => c.codigo === solicitud.cuentaSalida)
  if (!solicitud.cuentaSalida || !salida) {
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje: solicitud.cuentaSalida
        ? `La cuenta ${solicitud.cuentaSalida} no existe en el catálogo`
        : 'Seleccione la cuenta de la que sale el dinero',
    })
  } else if (!salida.esDetalle || !salida.activa) {
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje: `La cuenta ${salida.codigo} no admite movimientos`,
    })
  }

  const aplicaciones: AplicacionCalculada[] = []
  const vistas = new Set<string>()
  let aplicado = Money.cero(moneda)
  let diferencia = Money.cero(funcional)

  solicitud.aplicaciones.forEach((linea, indice) => {
    const factura = contexto.facturas.find((f) => f.id === linea.facturaId)
    if (!factura) {
      errores.push({
        codigo: 'FACTURA_NO_ENCONTRADA',
        mensaje: `La factura ${linea.facturaId} no existe`,
        aplicacion: indice,
      })
      return
    }

    if (vistas.has(factura.id)) {
      errores.push({
        codigo: 'FACTURA_REPETIDA',
        mensaje: `La factura ${factura.folioProveedor} aparece dos veces en el mismo pago`,
        aplicacion: indice,
      })
      return
    }
    vistas.add(factura.id)

    if (factura.proveedorId !== solicitud.proveedorId) {
      errores.push({
        codigo: 'FACTURA_DE_OTRO_PROVEEDOR',
        mensaje: `La factura ${factura.folioProveedor} es de ${factura.proveedorNombre}: un pago salda solo facturas de su propio proveedor`,
        aplicacion: indice,
      })
      return
    }

    if (factura.estado === 'cancelada') {
      errores.push({
        codigo: 'FACTURA_NO_CONTABILIZADA',
        mensaje: `La factura ${factura.folioProveedor} está cancelada`,
        aplicacion: indice,
      })
      return
    }
    if (factura.estado !== 'contabilizada') {
      errores.push({
        codigo: 'FACTURA_SIN_SALDO',
        mensaje: `La factura ${factura.folioProveedor} ya está pagada`,
        aplicacion: indice,
      })
      return
    }

    if (factura.moneda !== moneda) {
      errores.push({
        codigo: 'MONEDA_DISTINTA',
        mensaje: `La factura ${factura.folioProveedor} está en ${factura.moneda} y el pago en ${moneda}: cambie la moneda del pago o compre la divisa aparte`,
        aplicacion: indice,
      })
      return
    }

    const saldoAnterior = saldoDe(factura)
    if (!saldoAnterior.esPositivo()) {
      errores.push({
        codigo: 'FACTURA_SIN_SALDO',
        mensaje: `La factura ${factura.folioProveedor} no tiene saldo pendiente`,
        aplicacion: indice,
      })
      return
    }

    const aplicar = new Money(aDecimal(linea.importe), moneda).redondear()
    if (!aplicar.esPositivo()) {
      errores.push({
        codigo: 'APLICACION_INVALIDA',
        mensaje: `Lo aplicado a la factura ${factura.folioProveedor} debe ser mayor que cero`,
        aplicacion: indice,
      })
      return
    }
    if (aplicar.comparadoCon(saldoAnterior) > 0) {
      errores.push({
        codigo: 'APLICACION_EXCEDE_SALDO',
        mensaje: `A la factura ${factura.folioProveedor} le quedan ${saldoAnterior.toApi()} ${moneda} y se le aplican ${aplicar.toApi()}`,
        aplicacion: indice,
      })
      return
    }

    const propia = diferenciaCambiariaDe(
      aplicar,
      factura.tipoCambio,
      solicitud.tipoCambio,
      funcional,
    )
    aplicaciones.push({
      factura,
      importe: aplicar,
      saldoAnterior,
      saldoResultante: saldoAnterior.minus(aplicar),
      diferenciaCambiaria: propia,
    })
    aplicado = aplicado.plus(aplicar)
    diferencia = diferencia.plus(propia)
  })

  if (aplicado.comparadoCon(importe) > 0) {
    errores.push({
      codigo: 'APLICACION_EXCEDE_IMPORTE',
      mensaje: `Se aplican ${aplicado.toApi()} y el pago es de ${importe.toApi()}: lo aplicado no puede superar lo que sale de la cuenta`,
    })
  }

  const anticipo = aplicado.comparadoCon(importe) > 0
    ? Money.cero(moneda)
    : importe.minus(aplicado)

  // La cuenta de anticipos solo hace falta cuando sobra dinero. Se comprueba
  // aquí y no siempre para no exigir un mapeo que este pago no va a usar.
  if (anticipo.esPositivo()) {
    const cuenta = contexto.cuentas.find(
      (c) => c.codigo === contexto.mapeo.anticipo,
    )
    if (!cuenta || !cuenta.esDetalle || !cuenta.activa) {
      errores.push({
        codigo: 'CUENTA_ANTICIPO_INVALIDA',
        mensaje: `Sobran ${anticipo.toApi()} sin aplicar y la cuenta de anticipos ${contexto.mapeo.anticipo} no admite movimientos`,
      })
    }
  }

  return {
    valido: errores.length === 0,
    errores,
    aplicaciones,
    aplicado,
    anticipo,
    diferenciaCambiaria: diferencia,
  }
}

/** Concepto con el que el pago entra al mayor. */
export function conceptoPago(folio: string, proveedorNombre: string): string {
  return folio
    ? `Pago ${folio}: ${proveedorNombre}`
    : `Pago a ${proveedorNombre}`
}

/**
 * Asiento del pago (docs/05 §2.2).
 *
 *   Proveedores (auxiliar: proveedor)   cargo por lo aplicado
 *   Anticipos a proveedores             cargo por lo que sobró
 *   Diferencia cambiaria                cargo o abono, según el signo
 *   Bancos o caja                                       abono por el importe
 *
 * **Va en moneda funcional.** Es la única en la que la diferencia cambiaria
 * existe: en la moneda del documento, lo aplicado y lo pagado son el mismo
 * número y la diferencia no tendría dónde aparecer. Cada línea se convierte
 * con el tipo de cambio que le corresponde, y ahí está la gracia: el cargo a
 * Proveedores lleva el tipo de cambio DE LA FACTURA, que es aquel al que el
 * pasivo entró al mayor, mientras que el abono a bancos lleva el del pago. La
 * diferencia entre los dos es exactamente el resultado cambiario, y por eso el
 * asiento cuadra sin ajustes de redondeo.
 *
 * En moneda funcional los dos tipos de cambio son 1 y las líneas quedan con
 * los importes nominales, que es el caso normal.
 *
 * El origen `(cxp, pago, pagoId)` es la llave de idempotencia de docs/02 §4:
 * reintentar el mismo pago devuelve el asiento que ya existe en vez de
 * duplicar el egreso.
 *
 * TODO(bancos): la cuenta de salida es cuenta de control de `bancos` (docs/03
 * §2) y hoy la mueve CxP porque bancos no existe. Cuando exista, docs/05 §2.2
 * dice qué pasa: el pago publica `PagoEmitido`, bancos registra el movimiento
 * y esta línea desaparece de aquí. El asiento resultante es el mismo; cambia
 * quién lo firma.
 */
export function armarAsientoPago(
  pagoId: string,
  folio: string,
  solicitud: SolicitudPago,
  contexto: ContextoPago,
  resultado: ResultadoPago,
): SolicitudAsiento {
  const funcional = contexto.monedaFuncional
  const nombre = contexto.proveedor?.razonSocial ?? solicitud.proveedorId
  const tipoCambioPago = aDecimal(solicitud.tipoCambio)
  const lineas: LineaSolicitud[] = []

  // Una línea por factura y no una sola agrupada: cada una cancela su pasivo
  // al tipo de cambio con el que ese pasivo se reconoció, así que agruparlas
  // solo sería posible cuando todas comparten tipo de cambio. Además deja el
  // mayor diciendo qué factura se saldó, que es lo que se busca cuando alguien
  // audita el auxiliar del proveedor.
  for (const aplicacion of resultado.aplicaciones) {
    const enFuncional = new Money(
      aplicacion.importe.monto.times(aDecimal(aplicacion.factura.tipoCambio)),
      funcional,
    ).redondear()
    if (enFuncional.esCero()) continue
    lineas.push({
      cuenta: contexto.mapeo.proveedor,
      concepto: `${nombre} · factura ${aplicacion.factura.folioProveedor}`,
      cargo: enFuncional.toApi(),
      abono: '0',
      auxiliarTipo: 'proveedor',
      auxiliarId: solicitud.proveedorId,
    })
  }

  const anticipo = new Money(
    resultado.anticipo.monto.times(tipoCambioPago),
    funcional,
  ).redondear()
  if (anticipo.esPositivo()) {
    lineas.push({
      cuenta: contexto.mapeo.anticipo,
      concepto: `Anticipo a ${nombre}`,
      cargo: anticipo.toApi(),
      abono: '0',
      auxiliarTipo: 'proveedor',
      auxiliarId: solicitud.proveedorId,
    })
  }

  const diferencia = resultado.diferenciaCambiaria.redondear()
  if (diferencia.esNegativo()) {
    lineas.push({
      cuenta: contexto.mapeo.diferencialPerdido,
      concepto: 'Diferencial cambiario del pago',
      cargo: diferencia.abs().toApi(),
      abono: '0',
    })
  }

  const importe = new Money(aDecimal(solicitud.importe), solicitud.moneda)
  const salida = new Money(
    importe.monto.times(tipoCambioPago),
    funcional,
  ).redondear()
  const banco = auxiliarBancoDe(solicitud.cuentaSalida, contexto.cuentas)
  lineas.push({
    cuenta: solicitud.cuentaSalida,
    concepto: etiquetaMedio(solicitud),
    cargo: '0',
    abono: salida.toApi(),
    // Caja no exige auxiliar; las cuentas bancarias sí, y su id todavía lo
    // deriva el módulo mientras bancos no tenga catálogo.
    auxiliarTipo: banco ? 'banco' : null,
    auxiliarId: banco,
  })

  if (diferencia.esPositivo()) {
    lineas.push({
      cuenta: contexto.mapeo.diferencialGanado,
      concepto: 'Diferencial cambiario del pago',
      cargo: '0',
      abono: diferencia.toApi(),
    })
  }

  return {
    fecha: solicitud.fecha,
    concepto: conceptoPago(folio, nombre),
    // La moneda del asiento es la funcional porque sus importes lo son. El
    // pago conserva la suya y su tipo de cambio en el documento.
    moneda: funcional,
    tipoCambio: '1',
    origen: { modulo: 'cxp', tipo: 'pago', id: pagoId },
    lineas,
  }
}

const ETIQUETA_MEDIO: Record<SolicitudPago['medioPago'], string> = {
  transferencia: 'Transferencia emitida',
  cheque: 'Cheque emitido',
  efectivo: 'Salida de efectivo',
  tarjeta: 'Cargo a tarjeta',
  otro: 'Pago a proveedor',
}

function etiquetaMedio(solicitud: SolicitudPago): string {
  const base = ETIQUETA_MEDIO[solicitud.medioPago]
  const referencia = solicitud.referencia?.trim()
  return referencia ? `${base} ${referencia}` : base
}

/* ------------------------------------------- Propuesta de pago (§2.3) */

/**
 * Qué pagar con el efectivo que hay (docs/05 §2.3).
 *
 * El flujo más usado del módulo en la práctica: se fija una fecha de corte y un
 * tope de efectivo, y el sistema reparte ese tope entre las facturas vigentes
 * empezando por la que vence antes. La última que alcanza queda propuesta
 * parcialmente; las que no caben se enseñan igual, con propuesto en cero, para
 * que se vea qué se está dejando fuera. Un reporte que solo listara lo que sí
 * cabe escondería justamente la información que hace falta para pedir más
 * efectivo.
 *
 * El tope se mide en moneda funcional, que es la única común a facturas de
 * monedas distintas. Lo propuesto se devuelve en las dos: en la del documento,
 * que es lo que se le paga al proveedor, y en la funcional, que es lo que
 * consume del disponible.
 *
 * Es una función pura y no guarda nada: la propuesta se recalcula cada vez
 * sobre las facturas vigentes. Una propuesta guardada envejece mal, porque las
 * facturas que la componen se pagan por otros caminos.
 */
export function calcularPropuestaPago(
  facturas: readonly FacturaCompra[],
  corte: string,
  disponible: string,
  monedaFuncional: Moneda,
): PropuestaPago {
  const tope = new Money(aDecimal(disponible), monedaFuncional).redondear()
  let remanente = tope.esPositivo() ? tope : Money.cero(monedaFuncional)

  const candidatas = ordenarPorVencimiento(
    facturas.filter((f) => admitePago(f) && f.fechaEmision <= corte),
  )

  const lineas: LineaPropuestaPago[] = candidatas.map((factura) => {
    const saldo = saldoDe(factura)
    const tipoCambio = aDecimal(factura.tipoCambio)
    const saldoFuncional = new Money(
      saldo.monto.times(tipoCambio),
      monedaFuncional,
    ).redondear()

    // El reparto se decide en funcional (es donde vive el tope) y se traduce a
    // la moneda del documento. Cuando la factura cabe entera se propone su
    // saldo exacto, sin pasar por la división: dividir y volver a multiplicar
    // dejaría céntimos de diferencia contra el saldo que se quiere saldar.
    let propuesto = Money.cero(factura.moneda)
    let propuestoFuncional = Money.cero(monedaFuncional)
    if (remanente.esPositivo()) {
      if (saldoFuncional.comparadoCon(remanente) <= 0) {
        propuesto = saldo
        propuestoFuncional = saldoFuncional
      } else {
        propuesto = new Money(
          remanente.monto.dividedBy(tipoCambio),
          factura.moneda,
        ).redondear()
        propuestoFuncional = new Money(
          propuesto.monto.times(tipoCambio),
          monedaFuncional,
        ).redondear()
      }
      remanente = remanente.minus(propuestoFuncional)
    }

    return {
      facturaId: factura.id,
      folioProveedor: factura.folioProveedor,
      folioInterno: factura.folioInterno,
      proveedorId: factura.proveedorId,
      proveedorNombre: factura.proveedorNombre,
      fechaVencimiento: factura.fechaVencimiento,
      diasVencidos: diasVencidos(factura.fechaVencimiento, corte),
      moneda: factura.moneda,
      tipoCambio: factura.tipoCambio,
      saldo: saldo.toApi(),
      saldoFuncional: saldoFuncional.toApi(),
      propuesto: propuesto.toApi(),
      propuestoFuncional: propuestoFuncional.toApi(),
      salda: propuesto.igualA(saldo) && saldo.esPositivo(),
    }
  })

  const sumar = (campo: 'saldoFuncional' | 'propuestoFuncional') =>
    lineas.reduce(
      (acc, l) => acc.plus(new Money(l[campo], monedaFuncional)),
      Money.cero(monedaFuncional),
    )

  const totalPendiente = sumar('saldoFuncional')
  const totalPropuesto = sumar('propuestoFuncional')

  return {
    corte,
    moneda: monedaFuncional,
    disponible: tope.toApi(),
    lineas,
    totalPendiente: totalPendiente.toApi(),
    totalPropuesto: totalPropuesto.toApi(),
    remanente: tope.minus(totalPropuesto).toApi(),
    sinCubrir: totalPendiente.minus(totalPropuesto).toApi(),
  }
}
