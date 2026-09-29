import Decimal from 'decimal.js'
import type { LineaSolicitud, SolicitudAsiento } from '@/shared/api/contracts/conta'
import type { MapeoRh, Planilla } from '@/shared/api/contracts/rh'

/**
 * Asientos de la planilla (docs/08 §4 y §5).
 *
 * El error que hay que evitar, repetido del diseño: las cargas patronales no
 * se le rebajan al trabajador, pero sí son gasto de la empresa. El asiento es
 * siempre mayor que la suma de los recibos, y la diferencia es exactamente la
 * parte patronal.
 */

const CERO = new Decimal(0)

function suma(planilla: Planilla, campo: 'provisionAguinaldo' | 'provisionVacaciones' | 'provisionCesantia') {
  return planilla.lineas.reduce((acc, l) => acc.plus(l[campo]), CERO)
}

function cargo(cuenta: string, importe: Decimal, concepto: string): LineaSolicitud | null {
  return importe.isZero() ? null : { cuenta, cargo: importe.toFixed(2), abono: '0', concepto }
}

function abono(cuenta: string, importe: Decimal, concepto: string): LineaSolicitud | null {
  return importe.isZero() ? null : { cuenta, cargo: '0', abono: importe.toFixed(2), concepto }
}

/**
 * El asiento de la planilla y sus provisiones, en uno solo.
 *
 * Van juntos porque se devengan juntos: el aguinaldo de agosto nace del
 * salario de agosto. Separarlos permitiría contabilizar la planilla sin sus
 * provisiones, y el pasivo por prestaciones quedaría corto sin que nada lo
 * dijera.
 *
 * Los sueldos por pagar llevan una línea por empleado con su auxiliar: es lo
 * que permite comprobar, después de pagar, que el saldo de cada uno quedó en
 * cero (docs/08 §4).
 */
export function asientoDePlanilla(
  planilla: Planilla,
  mapeo: MapeoRh,
  etiquetaPeriodo: string,
  monedaFuncional: string,
): SolicitudAsiento {
  const bruto = new Decimal(planilla.totalBruto)
  const patrono = new Decimal(planilla.totalCargasPatrono)
  const trabajador = new Decimal(planilla.totalCargasTrabajador)
  const aguinaldo = suma(planilla, 'provisionAguinaldo')
  const vacaciones = suma(planilla, 'provisionVacaciones')
  const cesantia = suma(planilla, 'provisionCesantia')

  const lineas = [
    cargo(mapeo.gastoSalarios, bruto, 'Salarios devengados'),
    cargo(mapeo.gastoCargasPatronales, patrono, 'Cargas sociales patronales'),
    cargo(mapeo.gastoAguinaldo, aguinaldo, 'Provisión de aguinaldo'),
    cargo(mapeo.gastoVacaciones, vacaciones, 'Provisión de vacaciones'),
    cargo(mapeo.gastoCesantia, cesantia, 'Provisión de cesantía'),
    abono(mapeo.ccssPorPagar, trabajador.plus(patrono), 'Cuotas obreras y patronales'),
    abono(mapeo.rentaPorPagar, new Decimal(planilla.totalRenta), 'Impuesto al salario retenido'),
    abono(
      mapeo.otrasDeduccionesPorPagar,
      new Decimal(planilla.totalOtrasDeducciones),
      'Otras deducciones retenidas',
    ),
    ...planilla.lineas.map((l): LineaSolicitud | null =>
      new Decimal(l.neto).isZero()
        ? null
        : {
            cuenta: mapeo.salariosPorPagar,
            cargo: '0',
            abono: l.neto,
            concepto: `Neto a pagar: ${l.empleadoNombre}`,
            auxiliarTipo: 'empleado',
            auxiliarId: l.empleadoId,
          },
    ),
    abono(mapeo.provisionAguinaldo, aguinaldo, 'Provisión de aguinaldo'),
    abono(mapeo.provisionVacaciones, vacaciones, 'Provisión de vacaciones'),
    abono(mapeo.provisionCesantia, cesantia, 'Provisión de cesantía'),
  ].filter((l): l is LineaSolicitud => l !== null)

  return {
    fecha: planilla.fechaPago,
    concepto: `Planilla de ${etiquetaPeriodo}`,
    moneda: monedaFuncional,
    tipoCambio: '1',
    origen: { modulo: 'rh', tipo: 'planilla', id: planilla.id },
    lineas,
  }
}

/**
 * El pago de la planilla: sueldos por pagar contra la cuenta bancaria.
 *
 * Una línea por empleado, con su auxiliar, para que cada saldo quede en cero.
 */
export function asientoDePago(
  planilla: Planilla,
  mapeo: MapeoRh,
  banco: { cuentaContable: string; id: string; nombre: string },
  fecha: string,
  etiquetaPeriodo: string,
  monedaFuncional: string,
): SolicitudAsiento {
  const pagos = planilla.lineas.filter((l) => !new Decimal(l.neto).isZero())
  const total = pagos.reduce((acc, l) => acc.plus(l.neto), CERO)
  return {
    fecha,
    concepto: `Pago de la planilla de ${etiquetaPeriodo}`,
    moneda: monedaFuncional,
    tipoCambio: '1',
    origen: { modulo: 'rh', tipo: 'pago_planilla', id: planilla.id },
    lineas: [
      ...pagos.map(
        (l): LineaSolicitud => ({
          cuenta: mapeo.salariosPorPagar,
          cargo: l.neto,
          abono: '0',
          concepto: `Pago a ${l.empleadoNombre}`,
          auxiliarTipo: 'empleado',
          auxiliarId: l.empleadoId,
        }),
      ),
      {
        cuenta: banco.cuentaContable,
        cargo: '0',
        abono: total.toFixed(2),
        concepto: `Transferencias de planilla desde ${banco.nombre}`,
        auxiliarTipo: 'banco',
        auxiliarId: banco.id,
      },
    ],
  }
}
