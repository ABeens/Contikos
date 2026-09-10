import { useMemo } from 'react'
import Decimal from 'decimal.js'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha } from '@/shared/format/fecha'
import { LIBROS_TODOS, type Libro } from '@/shared/api/contracts/comunes'
import type { SolicitudAsiento } from '@/shared/api/contracts/conta'
import { librosDe, lineaAfecta, tratamientoUniforme } from './libro'
import { MarcaLibros } from './Libros'

/**
 * El asiento antes de existir.
 *
 * `PanelAsiento` pinta un asiento ya emitido, con número, estado y totales
 * materializados; aquí solo hay una solicitud. Se muestra con la misma
 * disposición para que quien revisa reconozca lo que verá después en el libro,
 * totales por libro incluidos: cuando el tratamiento fiscal y el corporativo
 * difieren, el asiento no tiene "un" total, tiene uno por libro y cada uno
 * cuadra por su cuenta (docs/02 §3.1).
 *
 * Vive en `shared` y no en un módulo porque lo usan todas las capturas que
 * enseñan su asiento antes de confirmar: la depreciación, la amortización de
 * diferidos y los movimientos de tesorería. Que las tres pinten el asiento
 * igual es lo que hace que revisarlo sea un solo gesto aprendido una vez
 * (docs/14 §5).
 */
export interface AsientoPropuestoProps {
  asiento: SolicitudAsiento
  /** Resuelve el nombre de una cuenta a partir de su código. */
  nombreCuenta: (codigo: string) => string
}

export function AsientoPropuesto({
  asiento,
  nombreCuenta,
}: AsientoPropuestoProps) {
  const uniforme = tratamientoUniforme(asiento.lineas)
  const totales = useMemo(
    () =>
      LIBROS_TODOS.map((libro) => {
        const lineas = asiento.lineas.filter((l) => lineaAfecta(l, libro))
        const sumar = (campo: 'cargo' | 'abono') =>
          lineas
            .reduce(
              (acc, l) => acc.plus(new Decimal(l[campo] || '0')),
              new Decimal(0),
            )
            .toFixed(2)
        return { libro, cargos: sumar('cargo'), abonos: sumar('abono') }
      }),
    [asiento],
  )
  const filasTotales = uniforme ? totales.slice(0, 1) : totales
  const etiqueta = (libro: Libro) =>
    libro === 'fiscal' ? 'fiscal' : 'corporativa'

  return (
    <div className="overflow-x-auto">
      <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2 text-sm text-slate-700">
        <span>
          <span className="text-[11px] text-slate-500">Fecha </span>
          {formatFecha(asiento.fecha)}
        </span>
        <span>
          <span className="text-[11px] text-slate-500">Concepto </span>
          {asiento.concepto}
        </span>
        <span>
          <span className="text-[11px] text-slate-500">Origen </span>
          {asiento.origen
            ? `${asiento.origen.modulo} · ${asiento.origen.tipo} · ${asiento.origen.id}`
            : 'Captura manual'}
        </span>
      </div>
      <table className="w-full text-sm" aria-label="Asiento propuesto">
        <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
          <tr>
            <th className="w-36 px-4 py-2 text-left">Cuenta</th>
            <th className="px-3 py-2 text-left">Nombre</th>
            <th className="px-3 py-2 text-left">Concepto / auxiliar</th>
            {!uniforme && <th className="w-16 px-3 py-2 text-center">Libro</th>}
            <th className="w-36 px-3 py-2 text-right">Cargo</th>
            <th className="w-36 px-4 py-2 text-right">Abono</th>
          </tr>
        </thead>
        <tbody>
          {asiento.lineas.map((linea, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-1.5 font-mono text-xs text-slate-600">
                {linea.cuenta}
              </td>
              <td className="px-3 py-1.5 text-slate-700">
                {nombreCuenta(linea.cuenta)}
              </td>
              <td className="px-3 py-1.5 text-xs text-slate-500">
                {linea.concepto}
                {linea.auxiliarId && (
                  <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                    {linea.auxiliarTipo}: {linea.auxiliarId}
                  </span>
                )}
              </td>
              {!uniforme && (
                <td className="px-3 py-1.5 text-center">
                  <MarcaLibros libros={librosDe(linea)} />
                </td>
              )}
              <td className="px-3 py-1.5 text-right">
                <MoneyCell
                  valor={linea.cargo}
                  moneda={asiento.moneda}
                  ocultarCero
                />
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell
                  valor={linea.abono}
                  moneda={asiento.moneda}
                  ocultarCero
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-slate-50 font-semibold text-slate-800">
          {filasTotales.map((t) => (
            <tr key={t.libro}>
              <td
                colSpan={uniforme ? 3 : 4}
                className="px-4 py-2 text-right text-xs"
              >
                Totales
                <span className="ml-1 font-normal text-slate-500">
                  · {uniforme ? 'ambas contabilidades' : etiqueta(t.libro)}
                </span>
              </td>
              <td className="px-3 py-2 text-right">
                <MoneyCell valor={t.cargos} moneda={asiento.moneda} />
              </td>
              <td className="px-4 py-2 text-right">
                <MoneyCell valor={t.abonos} moneda={asiento.moneda} />
              </td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  )
}
