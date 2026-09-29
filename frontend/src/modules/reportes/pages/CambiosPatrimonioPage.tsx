import { useMemo } from 'react'
import { Card, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { SelectorLibro } from '@/shared/asiento/Libros'
import { etiquetaLibro } from '@/shared/asiento/libro'
import { formatPeriodo } from '@/shared/format/fecha'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { monedaFuncional } from '@/shared/money/money'
import { cn } from '@/shared/ui/cn'
import {
  primerPeriodoDelEjercicio,
  useBalanzaReporte,
  useCatalogosReporte,
} from '../api/queries'
import { construirEstadoPatrimonio } from '../domain/patrimonio'
import { saldosAlCierre, saldosAlInicio } from '../domain/saldos'
import { aCsv, importeCsv, nombreArchivo, type Celda } from '../domain/csv'
import {
  AccionesReporte,
  Calculando,
  EncabezadoReporte,
} from '../components/Reporte'
import { descargar } from '../components/descargar'
import { useFiltrosReporte } from '../components/useFiltrosReporte'
import { descripcionIntervalo } from '../components/intervalo'

/**
 * Estado de Cambios en el Patrimonio (docs/09 §3.5).
 *
 * Siempre del ejercicio hasta el mes: es un estado de movimientos del año, y
 * "del mes" no se presenta. El saldo final de cada columna es el mismo que el
 * Balance enseña a esa fecha.
 */
export function CambiosPatrimonioPage() {
  const filtros = useFiltrosReporte()
  const { periodo, periodos, libro } = filtros
  const inicio = primerPeriodoDelEjercicio(periodos, periodo)

  const catalogos = useCatalogosReporte()
  const balanzaInicio = useBalanzaReporte(inicio?.id, libro)
  const finSinCierre = useBalanzaReporte(periodo?.id, libro, { excluirCierre: true })
  const finConCierre = useBalanzaReporte(periodo?.id, libro)

  const estado = useMemo(() => {
    if (
      !catalogos.catalogos ||
      !balanzaInicio.data ||
      !finSinCierre.data ||
      !finConCierre.data
    ) {
      return
    }
    return construirEstadoPatrimonio(
      {
        inicio: saldosAlInicio(balanzaInicio.data),
        finSinCierre: saldosAlCierre(finSinCierre.data),
        finConCierre: saldosAlCierre(finConCierre.data),
      },
      catalogos.catalogos,
    )
  }, [catalogos.catalogos, balanzaInicio.data, finSinCierre.data, finConCierre.data])

  const consultas = [balanzaInicio, finSinCierre, finConCierre]
  const error = catalogos.error ?? consultas.find((c) => c.error)?.error
  const intervalo = periodo ? descripcionIntervalo(periodo, 'ejercicio') : ''

  const exportar = () => {
    if (!estado || !periodo) return
    const filas: Celda[][] = [
      ['Estado de Cambios en el Patrimonio'],
      [intervalo],
      [`Contabilidad ${etiquetaLibro(libro).toLowerCase()}`],
      [],
      ['Concepto', ...estado.columnas.map((c) => c.nombre), 'Total'],
      ...estado.filas.map((f) => [
        f.concepto,
        ...estado.columnas.map((c) => importeCsv(f.importes[c.clave])),
        importeCsv(f.total),
      ]),
    ]
    descargar(
      aCsv(filas),
      nombreArchivo([
        'cambios-en-el-patrimonio',
        formatPeriodo(periodo.ejercicio, periodo.numero),
        libro,
      ]),
    )
  }

  return (
    <div>
      <PageHeader
        titulo="Estado de Cambios en el Patrimonio"
        descripcion={
          periodo
            ? `Contabilidad ${etiquetaLibro(libro).toLowerCase()} · ${intervalo}`
            : undefined
        }
        acciones={
          <>
            <SelectorLibro valor={libro} onChange={filtros.setLibro} />
            <AccionesReporte onExportar={exportar} exportable={Boolean(estado)} />
          </>
        }
      />

      <Card>
        {error ? (
          <EstadoError
            error={error}
            onReintentar={() => {
              catalogos.reintentar()
              consultas.forEach((c) => void c.refetch())
            }}
          />
        ) : !estado || !periodo ? (
          <Calculando />
        ) : (
          <>
            <EncabezadoReporte
              titulo="Estado de Cambios en el Patrimonio"
              lineas={[
                intervalo,
                `Contabilidad ${etiquetaLibro(libro).toLowerCase()} · Cifras en ${monedaFuncional()}`,
              ]}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-4 py-2 text-left font-medium">Concepto</th>
                    {estado.columnas.map((c) => (
                      <th key={c.clave} className="w-36 px-4 py-2 text-right font-medium">
                        {c.nombre}
                      </th>
                    ))}
                    <th className="w-36 px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {estado.filas.map((fila) => {
                    const saldo = fila.clave === 'saldo-inicial' || fila.clave === 'saldo-final'
                    return (
                      <tr
                        key={fila.clave}
                        className={cn(
                          saldo ? 'font-semibold text-slate-900' : 'text-slate-700',
                          fila.clave === 'saldo-final' &&
                            'border-t-2 border-b-4 border-double border-slate-400',
                        )}
                      >
                        <td className="px-4 py-2">{fila.concepto}</td>
                        {estado.columnas.map((c) => (
                          <td key={c.clave} className="px-4 py-2 text-right">
                            <MoneyCell
                              valor={fila.importes[c.clave]}
                              parentesisNegativos
                              ocultarCero={!saldo}
                            />
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right">
                          <MoneyCell valor={fila.total} parentesisNegativos />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
