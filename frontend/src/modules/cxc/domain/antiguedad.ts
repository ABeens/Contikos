import Decimal from 'decimal.js'
import { Money, type Moneda } from '@/shared/money/money'
import {
  antiguedadPorEntidad,
  type DocumentoCartera,
} from '@/shared/cartera/antiguedad'
import type {
  Antiguedad,
  Cobro,
  FacturaVenta,
} from '@/shared/api/contracts/cxc'

/**
 * Antigüedad de saldos de clientes (docs/04 §3).
 *
 * El saldo se expresa en moneda funcional, convertido al tipo de cambio con el
 * que se contabilizó cada factura. Es lo que hace que el total sea comparable
 * con el saldo de la cuenta de control en el mayor, que se lleva siempre en
 * funcional (docs/01 §4.2).
 */

/** Un importe de la factura llevado a moneda funcional. */
function aFuncional(monto: Decimal, factura: FacturaVenta): Decimal {
  return monto.times(new Decimal(factura.tipoCambio))
}

/** Saldo de una factura llevado a moneda funcional. */
export function saldoFuncional(factura: FacturaVenta): Decimal {
  return aFuncional(new Decimal(factura.saldo), factura)
}

/**
 * ¿Este cobro ya había bajado el saldo a la fecha de corte?
 *
 * Un cobro cuenta si se registró en o antes del corte y todavía no estaba
 * anulado ese día. Un cobro de julio anulado en octubre SÍ bajaba el saldo en
 * agosto, y el mayor lo dice igual: el asiento del cobro está en julio y el de
 * su reversa en octubre.
 */
function vigenteAlCorte(cobro: Cobro, corte: string): boolean {
  if (cobro.fecha > corte) return false
  if (cobro.estado !== 'anulado') return true
  return cobro.anuladoEn === null || cobro.anuladoEn > corte
}

/**
 * Saldo de una factura a una fecha de corte, en su propia moneda.
 *
 * No es `factura.saldo`: ese es el de hoy. La antigüedad de un cierre pasado
 * tiene que seguir siendo reproducible (docs/04 §3), y para eso el saldo se
 * reconstruye desde el total menos lo que se le había aplicado a esa fecha.
 * Con el corte en hoy, las dos formas dan lo mismo, y la prueba de integración
 * lo comprueba.
 */
export function saldoALaFecha(
  factura: FacturaVenta,
  cobros: readonly Cobro[],
  corte: string,
): Decimal {
  const aplicado = cobros
    .filter((c) => c.clienteId === factura.clienteId && vigenteAlCorte(c, corte))
    .flatMap((c) => c.aplicaciones)
    .filter((a) => a.facturaId === factura.id)
    .reduce((acc, a) => acc.plus(new Decimal(a.importeAplicado)), new Decimal(0))

  return Decimal.max(new Decimal(factura.total).minus(aplicado), new Decimal(0))
}

function comoDocumento(
  factura: FacturaVenta,
  cobros: readonly Cobro[],
  corte: string,
): DocumentoCartera & { fechaEmision: string } {
  return {
    entidadId: factura.clienteId,
    entidadNombre: factura.clienteNombre,
    fechaEmision: factura.fechaEmision,
    fechaVencimiento: factura.fechaVencimiento,
    saldo: aFuncional(saldoALaFecha(factura, cobros, corte), factura).toFixed(2),
  }
}

export function antiguedadDeFacturas(
  facturas: readonly FacturaVenta[],
  cobros: readonly Cobro[],
  corte: string,
  moneda: Moneda,
): Antiguedad {
  const { filas, totales } = antiguedadPorEntidad(
    facturas
      .filter((f) => f.estado !== 'cancelada')
      .map((f) => comoDocumento(f, cobros, corte)),
    corte,
    moneda,
  )

  return {
    corte,
    moneda,
    filas: filas.map(({ entidadId, entidadNombre, ...cubetas }) => ({
      clienteId: entidadId,
      clienteNombre: entidadNombre,
      ...cubetas,
    })),
    totales,
  }
}

/** Lo que un cliente debe hoy, en moneda funcional. */
export function saldoDeCliente(
  facturas: readonly FacturaVenta[],
  clienteId: string,
  moneda: Moneda,
): Money {
  return facturas
    .filter((f) => f.clienteId === clienteId && f.estado !== 'cancelada')
    .reduce(
      (acc, f) => acc.plus(new Money(saldoFuncional(f), moneda)),
      Money.cero(moneda),
    )
    .redondear()
}

export function facturasPendientesDe(
  facturas: readonly FacturaVenta[],
  clienteId: string,
): number {
  return facturas.filter(
    (f) =>
      f.clienteId === clienteId &&
      f.estado === 'contabilizada' &&
      new Decimal(f.saldo).greaterThan(0),
  ).length
}
