import type { Empleado, Planilla } from '@/shared/api/contracts/rh'

/**
 * Archivos que salen de la planilla: el de pago para el banco y el de la
 * planilla para la CCSS.
 *
 * Los dos son CSV genéricos y lo dicen en su nombre. El formato exacto del
 * archivo de cada banco y el de carga en SICERE están pendientes de confirmar
 * (docs/13 §6.4); cuando se tengan, se añade un escritor por formato con la
 * misma entrada, igual que los lectores de estado de cuenta de bancos
 * (docs/06 §2.2).
 */

function csv(filas: (string | number)[][]): string {
  const celda = (v: string | number) => {
    const t = String(v)
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  return '﻿' + filas.map((f) => f.map(celda).join(';')).join('\r\n')
}

function descargar(texto: string, nombre: string) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

const coma = (importe: string) => importe.replace('.', ',')

/** Filas del archivo de pago: a quién, a qué cuenta y cuánto. */
export function filasDePago(planilla: Planilla, empleados: readonly Empleado[]) {
  return planilla.lineas
    .filter((l) => Number(l.neto) > 0)
    .map((l) => {
      const e = empleados.find((x) => x.id === l.empleadoId)
      return [e?.identificacion ?? '', l.empleadoNombre, e?.cuentaIban ?? '', coma(l.neto)]
    })
}

export function archivoDePago(planilla: Planilla, empleados: readonly Empleado[]) {
  descargar(
    csv([['Cédula', 'Nombre', 'Cuenta IBAN', 'Monto'], ...filasDePago(planilla, empleados)]),
    `pago-planilla-${planilla.periodoId}-generico.csv`,
  )
}

/** Filas del reporte a la CCSS: asegurado, nombre, días y salario reportado. */
export function filasSicere(planilla: Planilla, empleados: readonly Empleado[]) {
  return planilla.lineas.map((l) => {
    const e = empleados.find((x) => x.id === l.empleadoId)
    return [
      e?.numeroAsegurado ?? '',
      e?.identificacion ?? '',
      l.empleadoNombre,
      coma(l.bruto),
      coma(l.cargasTrabajador),
      coma(l.cargasPatrono),
    ]
  })
}

export function archivoSicere(planilla: Planilla, empleados: readonly Empleado[], etiqueta: string) {
  descargar(
    csv([
      [`Planilla ${etiqueta}`],
      ['Asegurado', 'Cédula', 'Nombre', 'Salario reportado', 'Cuota obrera', 'Cuota patronal'],
      ...filasSicere(planilla, empleados),
    ]),
    `planilla-ccss-${planilla.periodoId}-generico.csv`,
  )
}
