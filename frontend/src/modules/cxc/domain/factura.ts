import Decimal from 'decimal.js'
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { Money, type Moneda } from '@/shared/money/money'
import {
  calcularImpuestoLinea,
  resolverPorDefecto,
  type ImpuestoLinea,
  type ResolverTarifa,
} from '@/shared/fiscal/iva'
import { resolutorDe, tarifaVigente } from '@/shared/fiscal/impuestos'
import type { TarifaImpuesto } from '@/shared/api/contracts/impuestos'
import type {
  Cuenta,
  LineaSolicitud,
  Periodo,
} from '@/shared/api/contracts/conta'
import type {
  Cliente,
  ItemCatalogo,
  LineaSolicitudFacturaVenta,
  MapeoCxc,
  SolicitudFacturaVenta,
} from '@/shared/api/contracts/cxc'

/**
 * Reglas de la factura de venta (docs/04 §2.1).
 *
 * Aquí ocurre la traducción de la que habla docs/02 §1: el módulo sabe de
 * clientes, líneas e impuestos, y solo en el borde se convierte en cargos y
 * abonos. Es la misma función que usa el mock, para que la pantalla y la API
 * rechacen exactamente lo mismo.
 */

export type CodigoErrorFactura =
  | 'CLIENTE_INVALIDO'
  | 'CLIENTE_INACTIVO'
  | 'FACTURA_SIN_LINEAS'
  | 'LINEA_INVALIDA'
  | 'CUENTA_INVALIDA'
  | 'ITEM_INVALIDO'
  | 'TARIFA_INVALIDA'
  | 'VENCIMIENTO_INVALIDO'
  | 'LIMITE_CREDITO_EXCEDIDO'
  | 'TOTAL_INVALIDO'
  | 'TIPO_CAMBIO_INVALIDO'
  | 'PERIODO_CERRADO'

export interface ErrorFactura {
  readonly codigo: CodigoErrorFactura
  readonly mensaje: string
  /** Índice de la línea afectada, si el error es de línea. */
  readonly linea?: number
}

export interface ContextoFacturaVenta {
  readonly cliente: Cliente | undefined
  readonly cuentas: readonly Cuenta[]
  readonly periodos: readonly Periodo[]
  readonly mapeo: MapeoCxc
  /** Catálogo de venta. La línea que cita un item tiene que poder resolverlo. */
  readonly items: readonly ItemCatalogo[]
  /**
   * Tabla de impuestos de la empresa (docs/13 §3).
   *
   * Cada línea se resuelve por la FECHA DE EMISIÓN contra esta tabla. Sin
   * ella se calcula con la tabla por defecto y no se valida la vigencia: es
   * el respaldo, no el caso normal.
   */
  readonly tarifas?: readonly TarifaImpuesto[]
}

/** Resolutor de tarifas del contexto para la fecha del documento. */
export function resolutorDeContexto(
  contexto: Pick<ContextoFacturaVenta, 'tarifas'>,
  fechaEmision: string,
): ResolverTarifa {
  return contexto.tarifas
    ? resolutorDe(contexto.tarifas, fechaEmision)
    : resolverPorDefecto
}

export interface LineaCalculada extends ImpuestoLinea {
  readonly cuentaIngreso: string
}

export interface TotalesFactura {
  readonly subtotal: Money
  readonly descuentos: Money
  readonly impuesto: Money
  readonly total: Money
}

export interface ResultadoFacturaVenta {
  readonly valido: boolean
  readonly errores: readonly ErrorFactura[]
  readonly lineas: readonly LineaCalculada[]
  readonly totales: TotalesFactura
}

/**
 * Cuenta de ingreso de una línea (docs/02 §5).
 *
 * Tres niveles, del más específico al más general: lo que capturó el usuario,
 * la cuenta propia del cliente y el mapeo del módulo. Que el mapeo exista es lo
 * que permite cambiar el catálogo de cuentas sin tocar CxC.
 */
export function cuentaIngresoDe(
  linea: Pick<LineaSolicitudFacturaVenta, 'cuentaIngreso'>,
  cliente: Cliente | undefined,
  mapeo: MapeoCxc,
): string {
  return linea.cuentaIngreso || cliente?.cuentaIngreso || mapeo.ingreso
}

/**
 * Item del catálogo que precargó la línea, si lo hubo.
 *
 * La línea guarda de qué item salió, no lo que el item dice hoy: el precio, la
 * tarifa y la cuenta ya están copiados en ella y pudieron editarse.
 */
export function itemDeLinea(
  linea: Pick<LineaSolicitudFacturaVenta, 'itemId'>,
  items: readonly ItemCatalogo[],
): ItemCatalogo | undefined {
  return linea.itemId ? items.find((i) => i.id === linea.itemId) : undefined
}

/** Vencimiento propuesto. Con 0 días de crédito vence el día de la emisión. */
export function vencimientoDe(
  fechaEmision: string,
  diasCredito: number,
): string {
  const emision = parseISO(fechaEmision)
  if (Number.isNaN(emision.getTime())) return fechaEmision
  return format(addDays(emision, diasCredito), 'yyyy-MM-dd')
}

/** Días vencidos a una fecha de corte. Cero o negativo = todavía por vencer. */
export function diasVencidos(
  fechaVencimiento: string,
  corte: string,
): number {
  return differenceInCalendarDays(parseISO(corte), parseISO(fechaVencimiento))
}

export function calcularLineas(
  lineas: readonly LineaSolicitudFacturaVenta[],
  moneda: Moneda,
  cliente: Cliente | undefined,
  mapeo: MapeoCxc,
  resolver: ResolverTarifa = resolverPorDefecto,
): LineaCalculada[] {
  return lineas.map((l) => ({
    ...calcularImpuestoLinea(
      {
        cantidad: l.cantidad || '0',
        precioUnitario: l.precioUnitario || '0',
        descuento: l.descuento || '0',
        tarifa: l.tarifa,
      },
      moneda,
      resolver,
    ),
    cuentaIngreso: cuentaIngresoDe(l, cliente, mapeo),
  }))
}

export function totalesDe(
  lineas: readonly LineaSolicitudFacturaVenta[],
  calculadas: readonly LineaCalculada[],
  moneda: Moneda,
): TotalesFactura {
  const subtotal = calculadas.reduce(
    (acc, c) => acc.plus(c.base),
    Money.cero(moneda),
  )
  const descuentos = lineas.reduce(
    (acc, l) => acc.plus(new Money(l.descuento || '0', moneda)),
    Money.cero(moneda),
  )
  const impuesto = calculadas.reduce(
    (acc, c) => acc.plus(c.impuesto),
    Money.cero(moneda),
  )
  return { subtotal, descuentos, impuesto, total: subtotal.plus(impuesto) }
}

/**
 * Líneas del asiento que genera la factura (docs/04 §2.1).
 *
 *   Clientes           cargo por el total
 *   Ventas                                 abono por el subtotal
 *   IVA trasladado                         abono por el impuesto
 *
 * Los ingresos se agrupan por cuenta: una factura con diez líneas del mismo
 * servicio no tiene por qué producir diez renglones en el mayor.
 */
export function lineasAsientoFactura(
  solicitud: SolicitudFacturaVenta,
  contexto: ContextoFacturaVenta,
  calculadas: readonly LineaCalculada[],
): LineaSolicitud[] {
  const moneda = solicitud.moneda
  const totales = totalesDe(solicitud.lineas, calculadas, moneda)
  const nombreCliente = contexto.cliente?.razonSocial ?? solicitud.clienteId

  const porCuenta = new Map<string, Money>()
  for (const calculada of calculadas) {
    const previo = porCuenta.get(calculada.cuentaIngreso)
    porCuenta.set(
      calculada.cuentaIngreso,
      previo ? previo.plus(calculada.base) : calculada.base,
    )
  }

  const lineas: LineaSolicitud[] = [
    {
      cuenta: contexto.mapeo.cliente,
      concepto: nombreCliente,
      cargo: totales.total.toApi(),
      abono: '0',
      // La cuenta de clientes es de control: sin auxiliar, el mayor deja de
      // poder conciliarse contra la antigüedad de saldos (docs/04 §3).
      auxiliarTipo: 'cliente',
      auxiliarId: solicitud.clienteId,
    },
  ]

  for (const [cuenta, base] of porCuenta) {
    if (base.esCero()) continue
    lineas.push({
      cuenta,
      concepto: 'Ingresos facturados',
      cargo: '0',
      abono: base.toApi(),
    })
  }

  if (!totales.impuesto.esCero()) {
    lineas.push({
      cuenta: contexto.mapeo.impuestoTrasladado,
      concepto: 'IVA trasladado',
      cargo: '0',
      abono: totales.impuesto.toApi(),
    })
  }

  return lineas
}

function periodoDe(
  fecha: string,
  periodos: readonly Periodo[],
): Periodo | undefined {
  return periodos.find((p) => fecha >= p.fechaInicio && fecha <= p.fechaFin)
}

export function validarFacturaVenta(
  solicitud: SolicitudFacturaVenta,
  contexto: ContextoFacturaVenta,
): ResultadoFacturaVenta {
  const errores: ErrorFactura[] = []
  const moneda = solicitud.moneda
  const calculadas = calcularLineas(
    solicitud.lineas,
    moneda,
    contexto.cliente,
    contexto.mapeo,
    resolutorDeContexto(contexto, solicitud.fechaEmision),
  )
  const totales = totalesDe(solicitud.lineas, calculadas, moneda)

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

  let tipoCambio: Decimal
  try {
    tipoCambio = new Decimal(solicitud.tipoCambio)
  } catch {
    tipoCambio = new Decimal(0)
  }
  if (tipoCambio.lessThanOrEqualTo(0)) {
    errores.push({
      codigo: 'TIPO_CAMBIO_INVALIDO',
      mensaje: 'El tipo de cambio debe ser mayor que cero',
    })
  }

  if (solicitud.fechaVencimiento < solicitud.fechaEmision) {
    errores.push({
      codigo: 'VENCIMIENTO_INVALIDO',
      mensaje: 'El vencimiento no puede ser anterior a la emisión',
    })
  }

  const periodo = periodoDe(solicitud.fechaEmision, contexto.periodos)
  if (!periodo) {
    errores.push({
      codigo: 'PERIODO_CERRADO',
      mensaje: `No existe un periodo contable que contenga la fecha ${solicitud.fechaEmision}`,
    })
  } else if (periodo.estado !== 'abierto') {
    errores.push({
      codigo: 'PERIODO_CERRADO',
      mensaje: `El periodo ${periodo.numero}/${periodo.ejercicio} está ${periodo.estado}`,
    })
  }

  if (solicitud.lineas.length === 0) {
    errores.push({
      codigo: 'FACTURA_SIN_LINEAS',
      mensaje: 'La factura requiere al menos una línea',
    })
  }

  const porCodigo = new Map(contexto.cuentas.map((c) => [c.codigo, c]))

  solicitud.lineas.forEach((linea, indice) => {
    if (!linea.descripcion.trim()) {
      errores.push({
        codigo: 'LINEA_INVALIDA',
        mensaje: 'La línea requiere una descripción',
        linea: indice,
      })
    }

    const cantidad = new Decimal(linea.cantidad || '0')
    const precio = new Decimal(linea.precioUnitario || '0')
    const descuento = new Decimal(linea.descuento || '0')

    if (cantidad.lessThanOrEqualTo(0)) {
      errores.push({
        codigo: 'LINEA_INVALIDA',
        mensaje: 'La cantidad debe ser mayor que cero',
        linea: indice,
      })
    }
    if (precio.lessThan(0)) {
      errores.push({
        codigo: 'LINEA_INVALIDA',
        mensaje: 'El precio unitario no puede ser negativo',
        linea: indice,
      })
    }
    if (descuento.greaterThan(cantidad.times(precio))) {
      errores.push({
        codigo: 'LINEA_INVALIDA',
        mensaje: 'El descuento no puede superar el importe de la línea',
        linea: indice,
      })
    }

    // La cuenta de ingreso tiene que ser resoluble ANTES de contabilizar
    // (docs/04 §2.1). Descubrirlo en el borde contable produce un mensaje que
    // quien factura no puede interpretar.
    const codigo = cuentaIngresoDe(linea, contexto.cliente, contexto.mapeo)
    const cuenta = porCodigo.get(codigo)
    if (!cuenta) {
      errores.push({
        codigo: 'CUENTA_INVALIDA',
        mensaje: `La cuenta de ingreso ${codigo} no existe en el catálogo`,
        linea: indice,
      })
    } else if (!cuenta.esDetalle || !cuenta.activa) {
      errores.push({
        codigo: 'CUENTA_INVALIDA',
        mensaje: `La cuenta ${codigo} no admite movimientos`,
        linea: indice,
      })
    }

    // La línea puede no citar ningún item, pero si lo cita tiene que existir:
    // una referencia rota deja el comprobante diciendo que vendió algo que el
    // catálogo no conoce.
    if (linea.itemId && !itemDeLinea(linea, contexto.items)) {
      errores.push({
        codigo: 'ITEM_INVALIDO',
        mensaje: `El item ${linea.itemId} no existe en el catálogo`,
        linea: indice,
      })
    }

    // La tarifa tiene que regir a la fecha de emisión y estar activa: una
    // línea al 8% transitorio emitida cuando ya no existía se calcularía a
    // cero en silencio, y Hacienda la rechazaría meses después.
    if (contexto.tarifas) {
      const tarifa = tarifaVigente(
        contexto.tarifas,
        linea.tarifa,
        solicitud.fechaEmision,
      )
      if (!tarifa) {
        errores.push({
          codigo: 'TARIFA_INVALIDA',
          mensaje: `La tarifa ${linea.tarifa} no rige el ${solicitud.fechaEmision}`,
          linea: indice,
        })
      } else if (!tarifa.activa) {
        errores.push({
          codigo: 'TARIFA_INVALIDA',
          mensaje: `La tarifa ${tarifa.nombre} está inactiva`,
          linea: indice,
        })
      }
    }
  })

  if (!totales.total.esPositivo()) {
    errores.push({
      codigo: 'TOTAL_INVALIDO',
      mensaje: 'El total de la factura debe ser mayor que cero',
    })
  }

  // Límite de crédito (docs/04 §2.1). Bloquea en vez de advertir: todavía no
  // hay flujo de autorización que permita seguir adelante, y dejar pasar la
  // venta sería decidir por el usuario.
  if (contexto.cliente) {
    const limite = new Decimal(contexto.cliente.limiteCredito)
    if (limite.greaterThan(0)) {
      const expuesto = new Decimal(contexto.cliente.saldo).plus(
        totales.total.monto,
      )
      if (expuesto.greaterThan(limite)) {
        errores.push({
          codigo: 'LIMITE_CREDITO_EXCEDIDO',
          mensaje: `La factura deja al cliente en ${expuesto.toFixed(2)} y su límite de crédito es ${limite.toFixed(2)}`,
        })
      }
    }
  }

  return { valido: errores.length === 0, errores, lineas: calculadas, totales }
}
