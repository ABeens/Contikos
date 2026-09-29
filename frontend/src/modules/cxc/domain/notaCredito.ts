import Decimal from 'decimal.js'
import type { LineaSolicitud, Periodo } from '@/shared/api/contracts/conta'
import type {
  FacturaVenta,
  MapeoCxc,
  NotaCredito,
  SolicitudNotaCredito,
} from '@/shared/api/contracts/cxc'
import type { IdTarifaIva } from '@/shared/fiscal/iva'

/**
 * Nota de crédito sobre una factura de venta (docs/04 §2.3).
 *
 * Es el inverso de la factura, pero no de toda: de la parte que se acredita.
 * Por eso se captura por cantidad sobre las líneas de la factura, y el importe
 * sale del precio neto de cada línea original, nunca de uno tecleado. La nota
 * revierte lo que la factura dijo; si el precio fuera otro, no sería una nota
 * de crédito sino otra venta.
 *
 * Mismo patrón que `factura.ts`: estas reglas las aplica el backend y el mock
 * las reutiliza, de modo que rechacen exactamente lo mismo.
 */

const CERO = new Decimal(0)

export type CodigoErrorNotaCredito =
  | 'FACTURA_NO_ENCONTRADA'
  | 'FACTURA_CANCELADA'
  | 'FECHA_ANTERIOR_A_FACTURA'
  | 'PERIODO_NO_ABIERTO'
  | 'DETALLE_REQUERIDO'
  | 'LINEA_NO_ENCONTRADA'
  | 'LINEA_DUPLICADA'
  | 'CANTIDAD_INVALIDA'
  | 'CANTIDAD_EXCEDE_FACTURADA'
  | 'EXCEDE_SALDO'

export interface ErrorNotaCredito {
  readonly codigo: CodigoErrorNotaCredito
  readonly mensaje: string
  /** Índice de la línea de la solicitud, si el error es de una línea. */
  readonly linea?: number
}

export interface ContextoNotaCredito {
  readonly factura: FacturaVenta | undefined
  /** Las notas ya emitidas sobre esa factura. */
  readonly notasPrevias: readonly NotaCredito[]
  readonly periodos: readonly Periodo[]
}

export interface LineaNotaCalculada {
  readonly lineaFacturaId: string
  readonly descripcion: string
  readonly cantidad: string
  readonly tarifa: IdTarifaIva
  readonly cuentaIngreso: string
  readonly base: Decimal
  readonly impuesto: Decimal
  readonly total: Decimal
}

export interface ResultadoNotaCredito {
  readonly valido: boolean
  readonly errores: readonly ErrorNotaCredito[]
  readonly lineas: readonly LineaNotaCalculada[]
  readonly subtotal: Decimal
  readonly impuesto: Decimal
  readonly total: Decimal
}

/** Lo ya acreditado de cada línea de la factura por notas anteriores. */
export function acreditadoPorLinea(
  notas: readonly NotaCredito[],
): Map<string, { cantidad: Decimal; base: Decimal; impuesto: Decimal }> {
  const mapa = new Map<string, { cantidad: Decimal; base: Decimal; impuesto: Decimal }>()
  for (const nota of notas) {
    for (const l of nota.lineas) {
      const previo = mapa.get(l.lineaFacturaId) ?? {
        cantidad: CERO,
        base: CERO,
        impuesto: CERO,
      }
      mapa.set(l.lineaFacturaId, {
        cantidad: previo.cantidad.plus(l.cantidad),
        base: previo.base.plus(l.base),
        impuesto: previo.impuesto.plus(l.impuesto),
      })
    }
  }
  return mapa
}

/**
 * Cuánto queda por acreditar de cada línea: la cantidad y el importe.
 *
 * Lo usa la pantalla para proponer y limitar, y la validación para rechazar.
 */
export function disponiblePorLinea(
  factura: FacturaVenta,
  notas: readonly NotaCredito[],
): Map<string, { cantidad: Decimal; base: Decimal; impuesto: Decimal }> {
  const acreditado = acreditadoPorLinea(notas)
  return new Map(
    factura.lineas.map((l) => {
      const hecho = acreditado.get(l.id)
      return [
        l.id,
        {
          cantidad: new Decimal(l.cantidad).minus(hecho?.cantidad ?? CERO),
          base: new Decimal(l.base).minus(hecho?.base ?? CERO),
          impuesto: new Decimal(l.impuesto).minus(hecho?.impuesto ?? CERO),
        },
      ]
    }),
  )
}

/**
 * Calcula y valida la nota.
 *
 * El importe de cada línea es la parte proporcional de la línea original, a
 * dos decimales. Cuando la nota agota la cantidad de una línea, se toma lo que
 * queda exacto en vez de la proporción: así la suma de todas las notas de una
 * línea es su importe hasta el céntimo, sin residuos de redondeo, igual que la
 * última cuota de un diferido cierra el remanente (docs/15).
 */
export function validarNotaCredito(
  solicitud: SolicitudNotaCredito,
  contexto: ContextoNotaCredito,
): ResultadoNotaCredito {
  const errores: ErrorNotaCredito[] = []
  const { factura } = contexto
  const vacio = {
    lineas: [],
    subtotal: CERO,
    impuesto: CERO,
    total: CERO,
  }

  if (!factura) {
    return {
      valido: false,
      errores: [{ codigo: 'FACTURA_NO_ENCONTRADA', mensaje: 'La factura no existe' }],
      ...vacio,
    }
  }

  if (factura.estado === 'cancelada') {
    errores.push({
      codigo: 'FACTURA_CANCELADA',
      mensaje: `La factura ${factura.numeroInterno} está cancelada`,
    })
  }

  if (solicitud.fecha < factura.fechaEmision) {
    errores.push({
      codigo: 'FECHA_ANTERIOR_A_FACTURA',
      mensaje: `La nota no puede ser anterior a la factura, emitida el ${factura.fechaEmision}`,
    })
  }

  const periodo = contexto.periodos.find(
    (p) => solicitud.fecha >= p.fechaInicio && solicitud.fecha <= p.fechaFin,
  )
  if (!periodo || periodo.estado !== 'abierto') {
    errores.push({
      codigo: 'PERIODO_NO_ABIERTO',
      mensaje: periodo
        ? `El periodo de ${solicitud.fecha} está ${periodo.estado}`
        : `No hay periodo para ${solicitud.fecha}`,
    })
  }

  if (solicitud.detalle.trim() === '') {
    errores.push({
      codigo: 'DETALLE_REQUERIDO',
      mensaje: 'Explique el motivo de la nota: queda en el comprobante',
    })
  }

  const disponible = disponiblePorLinea(factura, contexto.notasPrevias)
  const vistas = new Set<string>()
  const lineas: LineaNotaCalculada[] = []

  solicitud.lineas.forEach((l, i) => {
    const original = factura.lineas.find((fl) => fl.id === l.lineaFacturaId)
    if (!original) {
      errores.push({
        codigo: 'LINEA_NO_ENCONTRADA',
        mensaje: 'La línea no es de esta factura',
        linea: i,
      })
      return
    }
    if (vistas.has(l.lineaFacturaId)) {
      errores.push({
        codigo: 'LINEA_DUPLICADA',
        mensaje: `«${original.descripcion}» aparece dos veces en la nota`,
        linea: i,
      })
      return
    }
    vistas.add(l.lineaFacturaId)

    const cantidad = new Decimal(l.cantidad || '0')
    if (cantidad.lessThanOrEqualTo(0)) {
      errores.push({
        codigo: 'CANTIDAD_INVALIDA',
        mensaje: 'La cantidad a acreditar tiene que ser mayor que cero',
        linea: i,
      })
      return
    }

    const resto = disponible.get(original.id)!
    if (cantidad.greaterThan(resto.cantidad)) {
      errores.push({
        codigo: 'CANTIDAD_EXCEDE_FACTURADA',
        mensaje: `De «${original.descripcion}» quedan ${resto.cantidad.toString()} por acreditar`,
        linea: i,
      })
      return
    }

    const agota = cantidad.equals(resto.cantidad)
    const proporcion = cantidad.dividedBy(original.cantidad)
    const base = agota
      ? resto.base
      : new Decimal(original.base).times(proporcion).toDecimalPlaces(2)
    const impuesto = agota
      ? resto.impuesto
      : new Decimal(original.impuesto).times(proporcion).toDecimalPlaces(2)

    lineas.push({
      lineaFacturaId: original.id,
      descripcion: original.descripcion,
      cantidad: cantidad.toString(),
      tarifa: original.tarifa,
      cuentaIngreso: original.cuentaIngreso,
      base,
      impuesto,
      total: base.plus(impuesto),
    })
  })

  const subtotal = lineas.reduce((acc, l) => acc.plus(l.base), CERO)
  const impuesto = lineas.reduce((acc, l) => acc.plus(l.impuesto), CERO)
  const total = subtotal.plus(impuesto)

  // No se acredita lo ya cobrado: eso sería devolver dinero, que es otro
  // documento. Con la factura cobrada, la nota se hace después de anular el
  // cobro, o se devuelve el dinero por tesorería.
  if (total.greaterThan(factura.saldo)) {
    errores.push({
      codigo: 'EXCEDE_SALDO',
      mensaje: `La nota suma ${total.toFixed(2)} y a la factura le quedan ${new Decimal(factura.saldo).toFixed(2)} por cobrar`,
    })
  }

  return { valido: errores.length === 0, errores, lineas, subtotal, impuesto, total }
}

/**
 * Las líneas del asiento: el inverso del de la factura por la parte acreditada.
 *
 * Cargo a ingresos por cuenta, cargo al IVA trasladado, y abono a clientes por
 * el total con el auxiliar del cliente, para que la antigüedad de saldos siga
 * cuadrando contra la cuenta de control (docs/04 §3).
 */
export function lineasAsientoNotaCredito(
  factura: FacturaVenta,
  calculo: Pick<ResultadoNotaCredito, 'lineas' | 'impuesto' | 'total'>,
  mapeo: MapeoCxc,
): LineaSolicitud[] {
  const porCuenta = new Map<string, Decimal>()
  for (const l of calculo.lineas) {
    porCuenta.set(l.cuentaIngreso, (porCuenta.get(l.cuentaIngreso) ?? CERO).plus(l.base))
  }

  const lineas: LineaSolicitud[] = []
  for (const [cuenta, base] of porCuenta) {
    if (base.isZero()) continue
    lineas.push({
      cuenta,
      concepto: `Nota de crédito sobre ${factura.numeroInterno}`,
      cargo: base.toFixed(2),
      abono: '0',
    })
  }
  if (!calculo.impuesto.isZero()) {
    lineas.push({
      cuenta: mapeo.impuestoTrasladado,
      concepto: 'IVA trasladado acreditado',
      cargo: calculo.impuesto.toFixed(2),
      abono: '0',
    })
  }
  lineas.push({
    cuenta: mapeo.cliente,
    concepto: factura.clienteNombre,
    cargo: '0',
    abono: calculo.total.toFixed(2),
    auxiliarTipo: 'cliente',
    auxiliarId: factura.clienteId,
  })
  return lineas
}
