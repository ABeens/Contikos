import Decimal from 'decimal.js'
import { Money, type Moneda } from '@/shared/money/money'
import type {
  Cuenta,
  LineaSolicitud,
  Periodo,
  SolicitudAsiento,
} from '@/shared/api/contracts/conta'
import type {
  Cliente,
  FacturaVenta,
  LineaSolicitudCobro,
  MapeoCxc,
  SolicitudCobro,
} from '@/shared/api/contracts/cxc'
import type { CuentaBancaria } from '@/shared/api/contracts/bancos'
import { esCuentaDeBanco } from '@/shared/cuentas/cuenta'

/**
 * Reglas del cobro de una cuenta por cobrar (docs/04 §2.2).
 *
 *   capturar → aplicar a facturas → contabilizar → notificar a bancos
 *
 * Todo lo que hay aquí es puro: recibe el cliente, sus facturas, el catálogo de
 * cuentas y los periodos, y devuelve el reparto, la diferencia cambiaria y el
 * asiento que lo contabilizaría. Quien escribe (el mock hoy, el backend mañana)
 * llama a lo mismo dos veces con los mismos datos, una para enseñar el asiento
 * antes de confirmar y otra para emitirlo, y por construcción obtiene lo mismo.
 *
 * El asiento (docs/04 §2.2 y §5):
 *
 *   Bancos o caja (auxiliar: banco)        cargo por lo recibido
 *   Clientes (auxiliar: cliente)                   abono por lo aplicado
 *   Anticipos de clientes (auxiliar: cliente)      abono por lo sin aplicar
 *   Diferencia cambiaria                   según signo
 */

export type CodigoErrorCobro =
  | 'CLIENTE_INVALIDO'
  | 'CLIENTE_INACTIVO'
  | 'PERIODO_CERRADO'
  | 'TIPO_CAMBIO_INVALIDO'
  | 'IMPORTE_INVALIDO'
  | 'CUENTA_DEPOSITO_INVALIDA'
  | 'AUXILIAR_BANCO_REQUERIDO'
  | 'CUENTA_ANTICIPO_INVALIDA'
  | 'FACTURA_INVALIDA'
  | 'FACTURA_DE_OTRO_CLIENTE'
  | 'FACTURA_NO_COBRABLE'
  | 'FACTURA_DUPLICADA'
  | 'MONEDA_INCOMPATIBLE'
  | 'APLICACION_INVALIDA'
  | 'APLICACION_EXCEDE_SALDO'
  | 'APLICACIONES_EXCEDEN_RECIBIDO'

export interface ErrorCobro {
  readonly codigo: CodigoErrorCobro
  readonly mensaje: string
  /** Índice de la aplicación afectada, si el error es de una. */
  readonly aplicacion?: number
}

export interface ContextoCobro {
  readonly cliente: Cliente | undefined
  /** Las facturas del cliente. Con las de todos también funciona: se filtran. */
  readonly facturas: readonly FacturaVenta[]
  readonly cuentas: readonly Cuenta[]
  /**
   * Catálogo de cuentas bancarias (docs/06 §1).
   *
   * De él sale el auxiliar de la cuenta de depósito cuando es bancaria. Antes
   * se tecleaba a mano porque el catálogo no existía; ahora se elige, y lo que
   * se valida es que la ficha elegida sea la de esa cuenta de control.
   */
  readonly cuentasBancarias: readonly CuentaBancaria[]
  readonly periodos: readonly Periodo[]
  readonly mapeo: MapeoCxc
  /** Moneda del mayor. El asiento del cobro se arma en ella (ver más abajo). */
  readonly funcional: Moneda
}

/** Una aplicación con todo lo que se deriva de ella ya calculado. */
export interface AplicacionCalculada {
  readonly facturaId: string
  readonly facturaNumero: string
  /** En la moneda del cobro, que es la de la factura: es lo que baja el saldo. */
  readonly importeAplicado: Money
  readonly saldoResultante: Money
  readonly tipoCambioFactura: string
  /** Lo que se abona a Clientes por esta factura, en funcional. */
  readonly abonoClientes: Money
  /** Positiva = ganancia cambiaria. En funcional. */
  readonly diferenciaCambiaria: Money
}

export interface ResultadoCobro {
  readonly valido: boolean
  readonly errores: readonly ErrorCobro[]
  readonly aplicaciones: readonly AplicacionCalculada[]
  /** En la moneda del cobro. */
  readonly importeRecibido: Money
  readonly importeAplicado: Money
  readonly importeSinAplicar: Money
  /** En moneda funcional: son los importes del asiento. */
  readonly deposito: Money
  readonly abonoClientes: Money
  readonly anticipo: Money
  /** Positiva = ganancia (abono); negativa = pérdida (cargo). */
  readonly diferenciaCambiaria: Money
}

function decimal(valor: string | undefined): Decimal {
  if (!valor || valor.trim() === '') return new Decimal(0)
  try {
    return new Decimal(valor)
  } catch {
    return new Decimal(0)
  }
}

/** Redondea a los decimales de la moneda funcional. */
function enFuncional(monto: Decimal, funcional: Moneda): Money {
  return new Money(monto, funcional).redondear()
}

function periodoDe(
  fecha: string,
  periodos: readonly Periodo[],
): Periodo | undefined {
  return periodos.find((p) => fecha >= p.fechaInicio && fecha <= p.fechaFin)
}

/** Facturas que un cobro puede pagar: contabilizadas y con saldo. */
export function facturasCobrables(
  facturas: readonly FacturaVenta[],
  clienteId: string,
): FacturaVenta[] {
  return facturas
    .filter(
      (f) =>
        f.clienteId === clienteId &&
        f.estado === 'contabilizada' &&
        new Decimal(f.saldo).greaterThan(0),
    )
    .sort(
      (a, b) =>
        a.fechaVencimiento.localeCompare(b.fechaVencimiento) ||
        a.numeroInterno.localeCompare(b.numeroInterno),
    )
}

/**
 * Reparte un importe entre las facturas pendientes, de la más vieja a la más
 * nueva.
 *
 * Es la regla de imputación habitual en cobranza y la que hace que la
 * antigüedad de saldos mejore con cada cobro: pagar primero lo que lleva más
 * tiempo vencido es lo que vacía las cubetas de la derecha. Quien captura
 * puede cambiar el reparto después; esto es el punto de partida, no una
 * imposición.
 *
 * Solo reparte entre facturas de la misma moneda que el cobro: aplicar colones
 * a una factura en dólares exigiría decidir un tipo de cambio de aplicación, y
 * esa decisión no la toma un botón (ver `MONEDA_INCOMPATIBLE`).
 */
export function repartirPorAntiguedad(
  importe: string,
  facturas: readonly FacturaVenta[],
  moneda: Moneda,
): LineaSolicitudCobro[] {
  let restante = decimal(importe)
  const reparto: LineaSolicitudCobro[] = []

  // Se ordena aquí y no se confía en el orden recibido: la garantía de que se
  // paga primero lo más vencido es de esta función, no de quien la llama.
  const porAntiguedad = [...facturas].sort(
    (a, b) =>
      a.fechaVencimiento.localeCompare(b.fechaVencimiento) ||
      a.numeroInterno.localeCompare(b.numeroInterno),
  )

  for (const factura of porAntiguedad) {
    if (restante.lessThanOrEqualTo(0)) break
    if (factura.moneda !== moneda) continue
    const saldo = new Decimal(factura.saldo)
    if (saldo.lessThanOrEqualTo(0)) continue
    const aplicado = Decimal.min(saldo, restante)
    reparto.push({
      facturaId: factura.id,
      importeAplicado: new Money(aplicado, moneda).redondear().toApi(),
    })
    restante = restante.minus(aplicado)
  }

  return reparto
}

/**
 * Calcula el cobro y comprueba sus reglas.
 *
 * Devuelve SIEMPRE los importes calculados, válido o no: la pantalla enseña en
 * vivo lo aplicado, lo que quedaría de anticipo y el asiento mientras se
 * captura, y solo bloquea el botón. Es la misma forma que `validarFacturaVenta`.
 *
 * Decisiones que docs/04 §2.2 no resuelve y que se toman aquí:
 *
 * - **Moneda.** El cobro solo se aplica a facturas de SU MISMA moneda. Aplicar
 *   un cobro en colones a una factura en dólares obligaría a elegir a qué tipo
 *   de cambio se convierte el abono, y esa es una decisión de negocio que el
 *   sistema no puede tomar por nadie. Lo que sí se admite, y es el caso normal
 *   del comercio exterior, es cobrar en la moneda de la factura a OTRO tipo de
 *   cambio: de ahí sale la diferencia cambiaria.
 * - **Exceso.** Lo recibido de más no se rechaza ni se reparte solo: queda como
 *   anticipo del cliente (`2.1.04.001`), que es un pasivo. Devolverlo o
 *   aplicarlo a una factura futura es otra operación.
 * - **Aplicación sobre el saldo.** Lo aplicado a una factura nunca puede
 *   superar su saldo. Aceptarlo dejaría el saldo negativo, y un saldo negativo
 *   en el auxiliar es un anticipo escondido donde nadie lo va a buscar.
 */
export function validarCobro(
  solicitud: SolicitudCobro,
  contexto: ContextoCobro,
): ResultadoCobro {
  const errores: ErrorCobro[] = []
  const moneda = solicitud.moneda
  const funcional = contexto.funcional
  const tipoCambio = decimal(solicitud.tipoCambio)
  const tcValido = tipoCambio.greaterThan(0)
  // Con un tipo de cambio inválido no se puede convertir nada; se calcula con
  // 1 para que la pantalla siga enseñando el reparto, y el error ya está dicho.
  const tc = tcValido ? tipoCambio : new Decimal(1)

  if (!contexto.cliente) {
    errores.push({
      codigo: 'CLIENTE_INVALIDO',
      mensaje: 'Seleccione un cliente del catálogo',
    })
  } else if (!contexto.cliente.activo) {
    errores.push({
      codigo: 'CLIENTE_INACTIVO',
      mensaje: `El cliente ${contexto.cliente.razonSocial} está inactivo`,
    })
  }

  if (!tcValido) {
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

  const recibido = decimal(solicitud.importeRecibido)
  if (recibido.lessThanOrEqualTo(0)) {
    errores.push({
      codigo: 'IMPORTE_INVALIDO',
      mensaje: 'El importe recibido debe ser mayor que cero',
    })
  }

  const porCodigo = new Map(contexto.cuentas.map((c) => [c.codigo, c]))
  const deposito = porCodigo.get(solicitud.cuentaDeposito)
  if (!deposito) {
    errores.push({
      codigo: 'CUENTA_DEPOSITO_INVALIDA',
      mensaje: solicitud.cuentaDeposito
        ? `La cuenta ${solicitud.cuentaDeposito} no existe en el catálogo`
        : 'Indique en qué cuenta entró el dinero',
    })
  } else if (!deposito.esDetalle || !deposito.activa) {
    errores.push({
      codigo: 'CUENTA_DEPOSITO_INVALIDA',
      mensaje: `La cuenta ${deposito.codigo} no admite movimientos`,
    })
  } else if (esCuentaDeBanco(deposito)) {
    // Las cuentas bancarias son de control de `bancos` y exigen auxiliar
    // (docs/03 §2). Sin él, el núcleo contable rechazaría el asiento con
    // AUXILIAR_REQUERIDO y el mensaje no diría dónde corregirlo.
    const elegida = solicitud.auxiliarBanco?.trim()
    const ficha = contexto.cuentasBancarias.find((b) => b.id === elegida)

    if (!elegida) {
      errores.push({
        codigo: 'AUXILIAR_BANCO_REQUERIDO',
        mensaje: `La cuenta ${deposito.codigo} exige indicar la cuenta bancaria; use la cuenta de caja si el cobro no entró a un banco`,
      })
    } else if (!ficha) {
      errores.push({
        codigo: 'AUXILIAR_BANCO_REQUERIDO',
        mensaje: `La cuenta bancaria ${elegida} no existe en el catálogo`,
      })
    } else if (ficha.cuentaContable !== deposito.codigo) {
      // La correspondencia entre cuenta bancaria y cuenta de control es uno a
      // uno (docs/06 §1). Aceptar una ficha que no es la de esta cuenta dejaría
      // el auxiliar de bancos apuntando a un saldo que su control no explica.
      errores.push({
        codigo: 'AUXILIAR_BANCO_REQUERIDO',
        mensaje: `La cuenta bancaria ${ficha.codigo} se lleva en ${ficha.cuentaContable} y el cobro entró en ${deposito.codigo}`,
      })
    }
  }

  /* --------------------------------------------- Reparto a las facturas */

  const aplicaciones: AplicacionCalculada[] = []
  const vistas = new Set<string>()
  let sumaAplicada = new Decimal(0)
  let sumaAbonoClientes = new Decimal(0)

  solicitud.aplicaciones.forEach((linea, indice) => {
    const factura = contexto.facturas.find((f) => f.id === linea.facturaId)
    const aplicado = decimal(linea.importeAplicado)

    if (!factura) {
      errores.push({
        codigo: 'FACTURA_INVALIDA',
        mensaje: `La factura ${linea.facturaId} no existe`,
        aplicacion: indice,
      })
      return
    }

    if (vistas.has(factura.id)) {
      errores.push({
        codigo: 'FACTURA_DUPLICADA',
        mensaje: `La factura ${factura.numeroInterno} aparece dos veces en el mismo cobro`,
        aplicacion: indice,
      })
      return
    }
    vistas.add(factura.id)

    if (factura.clienteId !== solicitud.clienteId) {
      errores.push({
        codigo: 'FACTURA_DE_OTRO_CLIENTE',
        mensaje: `La factura ${factura.numeroInterno} es de ${factura.clienteNombre}`,
        aplicacion: indice,
      })
    }

    if (factura.estado !== 'contabilizada') {
      errores.push({
        codigo: 'FACTURA_NO_COBRABLE',
        mensaje: `La factura ${factura.numeroInterno} está ${factura.estado} y no admite cobros`,
        aplicacion: indice,
      })
    }

    const saldo = new Decimal(factura.saldo)
    if (saldo.lessThanOrEqualTo(0)) {
      errores.push({
        codigo: 'FACTURA_NO_COBRABLE',
        mensaje: `La factura ${factura.numeroInterno} ya no tiene saldo pendiente`,
        aplicacion: indice,
      })
    }

    if (factura.moneda !== moneda) {
      errores.push({
        codigo: 'MONEDA_INCOMPATIBLE',
        mensaje: `La factura ${factura.numeroInterno} está en ${factura.moneda} y el cobro en ${moneda}: registre un cobro por moneda`,
        aplicacion: indice,
      })
    }

    if (aplicado.lessThanOrEqualTo(0)) {
      errores.push({
        codigo: 'APLICACION_INVALIDA',
        mensaje: `El importe aplicado a ${factura.numeroInterno} debe ser mayor que cero`,
        aplicacion: indice,
      })
    } else if (aplicado.greaterThan(saldo)) {
      errores.push({
        codigo: 'APLICACION_EXCEDE_SALDO',
        mensaje: `A ${factura.numeroInterno} se le aplican ${aplicado.toFixed(2)} y su saldo es ${saldo.toFixed(2)}`,
        aplicacion: indice,
      })
    }

    // La cuenta de clientes se abona al tipo de cambio con el que la factura
    // entró al mayor, no al del cobro: es lo que mantiene el auxiliar cuadrado
    // contra la cuenta de control. Lo que sobra o falta es la diferencia
    // cambiaria, y por eso tiene línea propia.
    const tcFactura = new Decimal(factura.tipoCambio)
    const abonoClientes = enFuncional(aplicado.times(tcFactura), funcional)
    const recibidoDeLaFactura = enFuncional(aplicado.times(tc), funcional)

    aplicaciones.push({
      facturaId: factura.id,
      facturaNumero: factura.numeroInterno,
      importeAplicado: new Money(aplicado, moneda).redondear(),
      saldoResultante: new Money(saldo.minus(aplicado), factura.moneda).redondear(),
      tipoCambioFactura: factura.tipoCambio,
      abonoClientes,
      diferenciaCambiaria: recibidoDeLaFactura.minus(abonoClientes),
    })

    sumaAplicada = sumaAplicada.plus(aplicado)
    sumaAbonoClientes = sumaAbonoClientes.plus(abonoClientes.monto)
  })

  const importeRecibido = new Money(recibido, moneda).redondear()
  const importeAplicado = new Money(sumaAplicada, moneda).redondear()
  const sinAplicar = recibido.minus(sumaAplicada)

  if (sinAplicar.lessThan(0)) {
    errores.push({
      codigo: 'APLICACIONES_EXCEDEN_RECIBIDO',
      mensaje: `Se aplican ${sumaAplicada.toFixed(2)} y solo se recibieron ${recibido.toFixed(2)}`,
    })
  }

  // Lo recibido de más es un pasivo con el cliente, no un ingreso.
  const anticipoEnMoneda = Decimal.max(sinAplicar, new Decimal(0))
  const importeSinAplicar = new Money(anticipoEnMoneda, moneda).redondear()

  if (anticipoEnMoneda.greaterThan(0)) {
    const cuentaAnticipo = porCodigo.get(contexto.mapeo.anticipo)
    if (!cuentaAnticipo || !cuentaAnticipo.esDetalle || !cuentaAnticipo.activa) {
      errores.push({
        codigo: 'CUENTA_ANTICIPO_INVALIDA',
        mensaje: `El cobro deja ${importeSinAplicar.toApi()} sin aplicar y la cuenta de anticipos ${contexto.mapeo.anticipo} no admite movimientos`,
      })
    }
  }

  /* ------------------------------------------ Importes del asiento */

  const depositoFuncional = enFuncional(recibido.times(tc), funcional)
  const abonoClientesFuncional = enFuncional(sumaAbonoClientes, funcional)
  const anticipoFuncional = enFuncional(anticipoEnMoneda.times(tc), funcional)

  // La diferencia se calcula como residuo y no como suma de las diferencias
  // por factura, a propósito: así el asiento cuadra SIEMPRE al céntimo. Los
  // céntimos que deja el redondeo de cada conversión caen aquí, que es donde
  // docs/02 §3 pide que el módulo origen los absorba antes de enviar, y donde
  // un contador espera encontrarlos. En moneda funcional, y en cualquier cobro
  // al mismo tipo de cambio de la factura, es exactamente cero.
  const diferenciaCambiaria = depositoFuncional
    .minus(abonoClientesFuncional)
    .minus(anticipoFuncional)

  if (!diferenciaCambiaria.esCero()) {
    const rol = diferenciaCambiaria.esPositivo()
      ? contexto.mapeo.diferenciaCambiariaGanada
      : contexto.mapeo.diferenciaCambiariaPerdida
    const cuenta = porCodigo.get(rol)
    if (!cuenta || !cuenta.esDetalle || !cuenta.activa) {
      errores.push({
        codigo: 'CUENTA_DEPOSITO_INVALIDA',
        mensaje: `El cobro produce una diferencia cambiaria de ${diferenciaCambiaria.toApi()} y la cuenta ${rol} no admite movimientos`,
      })
    }
  }

  return {
    valido: errores.length === 0,
    errores,
    aplicaciones,
    importeRecibido,
    importeAplicado,
    importeSinAplicar,
    deposito: depositoFuncional,
    abonoClientes: abonoClientesFuncional,
    anticipo: anticipoFuncional,
    diferenciaCambiaria,
  }
}

/** Concepto del asiento. Cita el consecutivo del cobro y a quién se le cobró. */
export function conceptoCobro(numero: string, clienteNombre: string): string {
  return `Cobro ${numero}: ${clienteNombre}`.trim()
}

/**
 * Asiento que contabiliza el cobro (docs/04 §2.2 y §5).
 *
 * El `origen` es la terna `(cxc, cobro, id)`: es la llave de idempotencia de
 * docs/02 §4, la que hace que un doble clic o un reintento por timeout no
 * duplique el ingreso de efectivo.
 *
 * **El asiento se expresa en moneda funcional.** Es la única en la que puede
 * cuadrar cuando el cobro y la factura llevan tipos de cambio distintos: en la
 * moneda del cobro, el cargo al banco y el abono a clientes serían el mismo
 * número y la diferencia cambiaria no tendría dónde aparecer. Es también lo que
 * pide docs/02 §3, que deja la conversión a cargo del módulo origen. Cuando el
 * cobro ya viene en funcional, que es el caso normal, no hay conversión que
 * hacer y los importes son los del documento.
 */
export function armarAsientoCobro(
  cobroId: string,
  numero: string,
  solicitud: SolicitudCobro,
  contexto: ContextoCobro,
  calculo: ResultadoCobro,
): SolicitudAsiento {
  const clienteNombre = contexto.cliente?.razonSocial ?? solicitud.clienteId
  const cuentaDeposito = contexto.cuentas.find(
    (c) => c.codigo === solicitud.cuentaDeposito,
  )
  const auxiliarBanco = solicitud.auxiliarBanco?.trim() || null

  const lineas: LineaSolicitud[] = [
    {
      cuenta: solicitud.cuentaDeposito,
      concepto: `Cobro recibido de ${clienteNombre}`,
      cargo: calculo.deposito.toApi(),
      abono: '0',
      // El auxiliar solo va si la cuenta lo exige: la caja no lo lleva, y
      // mandarlo igual ensuciaría el mayor con un auxiliar que nadie concilia.
      auxiliarTipo: cuentaDeposito?.requiereAuxiliar ?? null,
      auxiliarId:
        cuentaDeposito?.requiereAuxiliar === 'banco' ? auxiliarBanco : null,
    },
  ]

  if (calculo.abonoClientes.esPositivo()) {
    lineas.push({
      cuenta: contexto.mapeo.cliente,
      // Qué facturas se saldaron: es lo que permite leer el asiento sin abrir
      // el documento, y lo que la conciliación del auxiliar necesita.
      concepto:
        calculo.aplicaciones.length === 1
          ? `Aplicación a ${calculo.aplicaciones[0].facturaNumero}`
          : `Aplicación a ${calculo.aplicaciones.length} facturas`,
      cargo: '0',
      abono: calculo.abonoClientes.toApi(),
      auxiliarTipo: 'cliente',
      auxiliarId: solicitud.clienteId,
    })
  }

  if (calculo.anticipo.esPositivo()) {
    lineas.push({
      cuenta: contexto.mapeo.anticipo,
      concepto: 'Cobro sin aplicar: anticipo del cliente',
      cargo: '0',
      abono: calculo.anticipo.toApi(),
      // El anticipo también es del cliente: sin auxiliar, aplicarlo a una
      // factura futura sería buscar a quién pertenece en el concepto.
      auxiliarTipo: 'cliente',
      auxiliarId: solicitud.clienteId,
    })
  }

  if (!calculo.diferenciaCambiaria.esCero()) {
    const ganancia = calculo.diferenciaCambiaria.esPositivo()
    lineas.push({
      cuenta: ganancia
        ? contexto.mapeo.diferenciaCambiariaGanada
        : contexto.mapeo.diferenciaCambiariaPerdida,
      concepto: ganancia
        ? 'Diferencial cambiario ganado en el cobro'
        : 'Diferencial cambiario perdido en el cobro',
      cargo: ganancia ? '0' : calculo.diferenciaCambiaria.abs().toApi(),
      abono: ganancia ? calculo.diferenciaCambiaria.toApi() : '0',
    })
  }

  return {
    fecha: solicitud.fecha,
    concepto: conceptoCobro(numero, clienteNombre),
    moneda: contexto.funcional,
    tipoCambio: '1',
    origen: { modulo: 'cxc', tipo: 'cobro', id: cobroId },
    lineas,
  }
}
