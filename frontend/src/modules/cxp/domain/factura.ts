import Decimal from 'decimal.js'
import { addDays, format, parseISO } from 'date-fns'
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
import type { CategoriaActivo } from '@/shared/api/contracts/activos'
import type {
  LineaSolicitudFacturaCompra,
  MapeoCxp,
  Proveedor,
  SolicitudFacturaCompra,
} from '@/shared/api/contracts/cxp'

/**
 * Reglas de la factura de proveedor (docs/05 §2.1).
 *
 * Espejo de la factura de venta con dos diferencias que cambian el asiento:
 *
 * - El impuesto es **acreditable**: va al activo, no al pasivo.
 * - La retención de renta se le descuenta al proveedor. Lo facturado y lo que
 *   se le paga no son el mismo importe, y por eso el saldo por pagar nace en
 *   total menos retención.
 *
 * La tercera diferencia no es contable sino de alcance: una línea puede
 * capitalizarse como activo fijo, y entonces esta captura es también el alta
 * del activo (docs/07 §3.1).
 */

export type CodigoErrorFacturaCompra =
  | 'PROVEEDOR_INVALIDO'
  | 'PROVEEDOR_INACTIVO'
  | 'FOLIO_REQUERIDO'
  | 'FACTURA_DUPLICADA'
  | 'FACTURA_SIN_LINEAS'
  | 'LINEA_INVALIDA'
  | 'CUENTA_INVALIDA'
  | 'ACTIVO_REQUERIDO'
  | 'CATEGORIA_INVALIDA'
  | 'TARIFA_INVALIDA'
  | 'VENCIMIENTO_INVALIDO'
  | 'TOTAL_INVALIDO'
  | 'TIPO_CAMBIO_INVALIDO'
  | 'PERIODO_CERRADO'

export interface ErrorFacturaCompra {
  readonly codigo: CodigoErrorFacturaCompra
  readonly mensaje: string
  readonly linea?: number
}

export interface ContextoFacturaCompra {
  readonly proveedor: Proveedor | undefined
  readonly cuentas: readonly Cuenta[]
  readonly periodos: readonly Periodo[]
  readonly categorias: readonly CategoriaActivo[]
  readonly mapeo: MapeoCxp
  /**
   * Folios ya registrados de ese proveedor: `(proveedor, folio)` es único
   * (docs/05 §2.1). El control de duplicados es la defensa contra pagar dos
   * veces la misma factura.
   */
  readonly foliosRegistrados?: readonly string[]
  /**
   * Tabla de impuestos de la empresa. Las líneas se resuelven por la fecha de
   * emisión del comprobante del proveedor. Sin ella, tabla por defecto.
   */
  readonly tarifas?: readonly TarifaImpuesto[]
}

/** Resolutor de tarifas del contexto para la fecha del documento. */
export function resolutorDeContextoCompra(
  contexto: Pick<ContextoFacturaCompra, 'tarifas'>,
  fechaEmision: string,
): ResolverTarifa {
  return contexto.tarifas
    ? resolutorDe(contexto.tarifas, fechaEmision)
    : resolverPorDefecto
}

export interface LineaCompraCalculada extends ImpuestoLinea {
  readonly cuenta: string
  /** true si la línea se capitaliza como activo fijo. */
  readonly capitaliza: boolean
}

export interface TotalesFacturaCompra {
  readonly subtotal: Money
  readonly descuentos: Money
  readonly impuesto: Money
  readonly retencion: Money
  /** Lo que el proveedor factura. */
  readonly total: Money
  /** Lo que se le queda debiendo: total menos retención. */
  readonly porPagar: Money
}

export interface ResultadoFacturaCompra {
  readonly valido: boolean
  readonly errores: readonly ErrorFacturaCompra[]
  readonly lineas: readonly LineaCompraCalculada[]
  readonly totales: TotalesFacturaCompra
}

/** Cuenta de cargo de una línea: la capturada, la del proveedor o el mapeo. */
export function cuentaGastoDe(
  linea: Pick<LineaSolicitudFacturaCompra, 'cuenta'>,
  proveedor: Proveedor | undefined,
  mapeo: MapeoCxp,
): string {
  return linea.cuenta || proveedor?.cuentaGasto || mapeo.gasto
}

export function vencimientoDe(
  fechaEmision: string,
  diasCredito: number,
): string {
  const emision = parseISO(fechaEmision)
  if (Number.isNaN(emision.getTime())) return fechaEmision
  return format(addDays(emision, diasCredito), 'yyyy-MM-dd')
}

export function claveFolio(proveedorId: string, folio: string): string {
  return `${proveedorId}|${folio.trim().toUpperCase()}`
}

export function calcularLineasCompra(
  lineas: readonly LineaSolicitudFacturaCompra[],
  moneda: Moneda,
  proveedor: Proveedor | undefined,
  mapeo: MapeoCxp,
  resolver: ResolverTarifa = resolverPorDefecto,
): LineaCompraCalculada[] {
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
    cuenta: cuentaGastoDe(l, proveedor, mapeo),
    capitaliza: Boolean(l.activo),
  }))
}

/**
 * Retención de renta sobre la base gravable.
 *
 * Se calcula sobre el subtotal y nunca sobre el total: la retención es del
 * impuesto sobre la renta y el IVA no forma parte de su base (docs/13 §5).
 */
export function retencionDe(
  subtotal: Money,
  porcentaje: string | undefined,
): Money {
  const tasa = new Decimal(porcentaje || '0')
  if (tasa.lessThanOrEqualTo(0)) return Money.cero(subtotal.moneda)
  return subtotal.times(tasa.dividedBy(100)).redondear()
}

export function totalesCompraDe(
  lineas: readonly LineaSolicitudFacturaCompra[],
  calculadas: readonly LineaCompraCalculada[],
  moneda: Moneda,
  proveedor: Proveedor | undefined,
): TotalesFacturaCompra {
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
  const retencion = retencionDe(subtotal, proveedor?.retencionRenta)
  const total = subtotal.plus(impuesto)
  return {
    subtotal,
    descuentos,
    impuesto,
    retencion,
    total,
    porPagar: total.minus(retencion),
  }
}

/**
 * Líneas del asiento que genera la factura (docs/05 §2.1).
 *
 *   Gasto / activo      cargo por el subtotal
 *   IVA acreditable     cargo por el impuesto
 *   Retenciones                                 abono por la retención
 *   Proveedores                                 abono por el resto
 *
 * Las líneas capitalizadas NO se agrupan: cada activo lleva su propio auxiliar
 * y agruparlas dejaría el auxiliar de activos sin conciliar contra el mayor.
 */
export function lineasAsientoFacturaCompra(
  solicitud: SolicitudFacturaCompra,
  contexto: ContextoFacturaCompra,
  calculadas: readonly LineaCompraCalculada[],
  /** Activo creado por cada línea capitalizada, por índice de línea. */
  activosPorLinea: ReadonlyMap<number, { id: string; nombre: string }> = new Map(),
): LineaSolicitud[] {
  const moneda = solicitud.moneda
  const totales = totalesCompraDe(
    solicitud.lineas,
    calculadas,
    moneda,
    contexto.proveedor,
  )
  const nombreProveedor =
    contexto.proveedor?.razonSocial ?? solicitud.proveedorId

  const lineas: LineaSolicitud[] = []
  const porCuenta = new Map<string, Money>()

  calculadas.forEach((calculada, indice) => {
    if (calculada.capitaliza) {
      const activo = activosPorLinea.get(indice)
      lineas.push({
        cuenta: calculada.cuenta,
        concepto: activo?.nombre ?? solicitud.lineas[indice].descripcion,
        cargo: calculada.base.toApi(),
        abono: '0',
        auxiliarTipo: 'activo',
        auxiliarId: activo?.id ?? null,
      })
      return
    }
    const previo = porCuenta.get(calculada.cuenta)
    porCuenta.set(
      calculada.cuenta,
      previo ? previo.plus(calculada.base) : calculada.base,
    )
  })

  for (const [cuenta, base] of porCuenta) {
    if (base.esCero()) continue
    lineas.push({
      cuenta,
      concepto: 'Compras y gastos del periodo',
      cargo: base.toApi(),
      abono: '0',
    })
  }

  if (!totales.impuesto.esCero()) {
    lineas.push({
      cuenta: contexto.mapeo.impuestoAcreditable,
      concepto: 'IVA acreditable',
      cargo: totales.impuesto.toApi(),
      abono: '0',
    })
  }

  if (!totales.retencion.esCero()) {
    lineas.push({
      cuenta: contexto.mapeo.retencion,
      concepto: `Retención de renta ${contexto.proveedor?.retencionRenta ?? '0'}%`,
      cargo: '0',
      abono: totales.retencion.toApi(),
    })
  }

  lineas.push({
    cuenta: contexto.mapeo.proveedor,
    concepto: nombreProveedor,
    cargo: '0',
    abono: totales.porPagar.toApi(),
    auxiliarTipo: 'proveedor',
    auxiliarId: solicitud.proveedorId,
  })

  return lineas
}

function periodoDe(
  fecha: string,
  periodos: readonly Periodo[],
): Periodo | undefined {
  return periodos.find((p) => fecha >= p.fechaInicio && fecha <= p.fechaFin)
}

export function validarFacturaCompra(
  solicitud: SolicitudFacturaCompra,
  contexto: ContextoFacturaCompra,
): ResultadoFacturaCompra {
  const errores: ErrorFacturaCompra[] = []
  const moneda = solicitud.moneda
  const calculadas = calcularLineasCompra(
    solicitud.lineas,
    moneda,
    contexto.proveedor,
    contexto.mapeo,
    resolutorDeContextoCompra(contexto, solicitud.fechaEmision),
  )
  const totales = totalesCompraDe(
    solicitud.lineas,
    calculadas,
    moneda,
    contexto.proveedor,
  )

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

  if (!solicitud.folioProveedor.trim()) {
    errores.push({
      codigo: 'FOLIO_REQUERIDO',
      mensaje: 'Capture el folio del comprobante del proveedor',
    })
  } else if (
    contexto.foliosRegistrados?.includes(
      claveFolio(solicitud.proveedorId, solicitud.folioProveedor),
    )
  ) {
    errores.push({
      codigo: 'FACTURA_DUPLICADA',
      mensaje: `El folio ${solicitud.folioProveedor} ya está registrado para este proveedor`,
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

    const codigo = cuentaGastoDe(linea, contexto.proveedor, contexto.mapeo)
    const cuenta = porCodigo.get(codigo)
    if (!cuenta) {
      errores.push({
        codigo: 'CUENTA_INVALIDA',
        mensaje: `La cuenta ${codigo} no existe en el catálogo`,
        linea: indice,
      })
    } else if (!cuenta.esDetalle || !cuenta.activa) {
      errores.push({
        codigo: 'CUENTA_INVALIDA',
        mensaje: `La cuenta ${codigo} no admite movimientos`,
        linea: indice,
      })
    } else if (cuenta.requiereAuxiliar === 'activo' && !linea.activo) {
      // Una compra que carga una cuenta de activo fijo sin dar de alta el
      // activo deja el mayor reconociendo un bien que el auxiliar desconoce.
      // Es exactamente la conciliación que docs/07 §4 exige que cuadre.
      errores.push({
        codigo: 'ACTIVO_REQUERIDO',
        mensaje: `${codigo} es una cuenta de activo fijo: capitalice la línea indicando la ficha del activo`,
        linea: indice,
      })
    } else if (linea.activo && cuenta.requiereAuxiliar !== 'activo') {
      errores.push({
        codigo: 'CUENTA_INVALIDA',
        mensaje: `Para capitalizar la línea, cárguela a una cuenta de activo fijo (${codigo} no lo es)`,
        linea: indice,
      })
    }

    if (linea.activo) {
      const categoria = contexto.categorias.find(
        (c) => c.id === linea.activo?.categoriaId,
      )
      if (!categoria) {
        errores.push({
          codigo: 'CATEGORIA_INVALIDA',
          mensaje: 'Seleccione la categoría del activo',
          linea: indice,
        })
      } else if (!categoria.activa) {
        errores.push({
          codigo: 'CATEGORIA_INVALIDA',
          mensaje: `La categoría ${categoria.nombre} está inactiva`,
          linea: indice,
        })
      }
      if (!linea.activo.nombre.trim()) {
        errores.push({
          codigo: 'ACTIVO_REQUERIDO',
          mensaje: 'El activo requiere un nombre',
          linea: indice,
        })
      }
      if (linea.activo.fechaInicioDepreciacion < solicitud.fechaEmision) {
        errores.push({
          codigo: 'ACTIVO_REQUERIDO',
          mensaje:
            'La depreciación no puede empezar antes de la compra del activo',
          linea: indice,
        })
      }
    }

    // Misma regla que en la venta: la tarifa tiene que regir a la fecha del
    // comprobante y estar activa. El IVA acreditable que se declara sale de
    // aquí, y una tarifa que no regía es un crédito que Hacienda no acepta.
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

  return { valido: errores.length === 0, errores, lineas: calculadas, totales }
}
