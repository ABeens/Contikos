import Decimal from 'decimal.js'
import { Money, type Moneda } from '@/shared/money/money'
import {
  antiguedadPorEntidad,
  type DocumentoCartera,
} from '@/shared/cartera/antiguedad'
import type { AntiguedadCxp, FacturaCompra } from '@/shared/api/contracts/cxp'

/**
 * Antigüedad de saldos de proveedores (docs/05 §5).
 *
 * Misma lógica y misma verificación de integridad que en CxC: el total a la
 * fecha de corte debe ser el saldo de la cuenta de control en el mayor. Por eso
 * el saldo se lleva a moneda funcional con el tipo de cambio de la factura.
 */

export function saldoFuncional(factura: FacturaCompra): Decimal {
  return new Decimal(factura.saldo).times(new Decimal(factura.tipoCambio))
}

function comoDocumento(factura: FacturaCompra): DocumentoCartera & {
  fechaEmision: string
} {
  return {
    entidadId: factura.proveedorId,
    entidadNombre: factura.proveedorNombre,
    fechaEmision: factura.fechaEmision,
    fechaVencimiento: factura.fechaVencimiento,
    saldo: saldoFuncional(factura).toFixed(2),
  }
}

export function antiguedadDeFacturas(
  facturas: readonly FacturaCompra[],
  corte: string,
  moneda: Moneda,
): AntiguedadCxp {
  const { filas, totales } = antiguedadPorEntidad(
    facturas.filter((f) => f.estado !== 'cancelada').map(comoDocumento),
    corte,
    moneda,
  )

  return {
    corte,
    moneda,
    filas: filas.map(({ entidadId, entidadNombre, ...cubetas }) => ({
      proveedorId: entidadId,
      proveedorNombre: entidadNombre,
      ...cubetas,
    })),
    totales,
  }
}

export function saldoDeProveedor(
  facturas: readonly FacturaCompra[],
  proveedorId: string,
  moneda: Moneda,
): Money {
  return facturas
    .filter((f) => f.proveedorId === proveedorId && f.estado !== 'cancelada')
    .reduce(
      (acc, f) => acc.plus(new Money(saldoFuncional(f), moneda)),
      Money.cero(moneda),
    )
    .redondear()
}

export function facturasPendientesDe(
  facturas: readonly FacturaCompra[],
  proveedorId: string,
): number {
  return facturas.filter(
    (f) =>
      f.proveedorId === proveedorId &&
      f.estado === 'contabilizada' &&
      new Decimal(f.saldo).greaterThan(0),
  ).length
}
