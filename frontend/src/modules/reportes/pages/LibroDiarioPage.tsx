import { useMemo } from 'react'
import { Link } from 'react-router'
import { Card, EstadoError, EstadoVacio, PageHeader } from '@/shared/ui/Layout'
import { SelectorLibro } from '@/shared/asiento/Libros'
import { etiquetaLibro } from '@/shared/asiento/libro'
import { formatFecha, formatFechaLarga, formatPeriodo } from '@/shared/format/fecha'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { useAsientosRango } from '../api/queries'
import { construirDiario } from '../domain/libros'
import { aCsv, importeCsv, nombreArchivo, type Celda } from '../domain/csv'
import {
  AccionesReporte,
  AvisoCuadre,
  Calculando,
  EncabezadoReporte,
} from '../components/Reporte'
import { descargar } from '../components/descargar'
import { useFiltrosReporte } from '../components/useFiltrosReporte'

/**
 * Libro diario (docs/09 §4): los asientos del mes en orden cronológico, con
 * sus líneas de UN libro.
 *
 * Los reversados se enseñan junto a su reversa y marcados: el diario es el
 * registro de lo que ocurrió, y un asiento que se borrara de él dejaría la
 * reversa sin nada que explicar.
 */
export function LibroDiarioPage() {
  const filtros = useFiltrosReporte()
  const { periodo, libro } = filtros
  const asientos = useAsientosRango(periodo?.fechaInicio, periodo?.fechaFin, libro)

  const diario = useMemo(
    () => (asientos.data ? construirDiario(asientos.data, libro) : undefined),
    [asientos.data, libro],
  )

  const intervalo = periodo
    ? `Del ${formatFechaLarga(periodo.fechaInicio)} al ${formatFechaLarga(periodo.fechaFin)}`
    : ''

  const exportar = () => {
    if (!diario || !periodo) return
    const filas: Celda[][] = [
      ['Libro diario'],
      [intervalo],
      [`Contabilidad ${etiquetaLibro(libro).toLowerCase()}`],
      [],
      ['Asiento', 'Fecha', 'Concepto', 'Cuenta', 'Nombre', 'Auxiliar', 'Cargo', 'Abono'],
    ]
    for (const a of diario.asientos) {
      for (const l of a.lineas) {
        filas.push([
          a.codigo,
          a.fecha,
          l.concepto || a.concepto,
          l.cuentaCodigo,
          l.cuentaNombre,
          l.auxiliarNombre ?? '',
          importeCsv(l.cargo),
          importeCsv(l.abono),
        ])
      }
    }
    filas.push(['', '', 'Totales', '', '', '', importeCsv(diario.totalCargos), importeCsv(diario.totalAbonos)])
    descargar(
      aCsv(filas),
      nombreArchivo(['libro-diario', formatPeriodo(periodo.ejercicio, periodo.numero), libro]),
    )
  }

  return (
    <div>
      <PageHeader
        titulo="Libro diario"
        descripcion={periodo ? `Contabilidad ${etiquetaLibro(libro).toLowerCase()} · ${intervalo}` : undefined}
        acciones={
          <>
            <SelectorLibro valor={libro} onChange={filtros.setLibro} />
            <AccionesReporte onExportar={exportar} exportable={Boolean(diario)} />
          </>
        }
      />

      {diario && (
        <div className="mb-3 flex justify-end print:hidden">
          <AvisoCuadre
            cuadra={diario.cuadra}
            correcto={`${diario.asientos.length} asientos · cargos igual a abonos`}
            incorrecto={
              <>
                <strong>El diario no cuadra</strong>: es un error del núcleo, no
                de captura.
              </>
            }
          />
        </div>
      )}

      <Card>
        {asientos.error ? (
          <EstadoError error={asientos.error} onReintentar={() => void asientos.refetch()} />
        ) : !diario || !periodo ? (
          <Calculando />
        ) : diario.asientos.length === 0 ? (
          <EstadoVacio
            titulo="Sin asientos en el periodo"
            descripcion="No hay asientos contabilizados de este libro en el mes."
          />
        ) : (
          <>
            <EncabezadoReporte
              titulo="Libro diario"
              lineas={[intervalo, `Contabilidad ${etiquetaLibro(libro).toLowerCase()}`]}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-3 py-2 text-left font-medium">Cuenta</th>
                    <th className="px-3 py-2 text-left font-medium">Concepto</th>
                    <th className="px-3 py-2 text-left font-medium">Auxiliar</th>
                    <th className="w-32 px-3 py-2 text-right font-medium">Cargo</th>
                    <th className="w-32 px-3 py-2 text-right font-medium">Abono</th>
                  </tr>
                </thead>
                <tbody>
                  {diario.asientos.map((a) => (
                    <FilasAsiento key={a.id} asiento={a} />
                  ))}
                  <tr className="border-t-2 border-slate-300 font-semibold text-slate-900">
                    <td colSpan={3} className="px-3 py-2 text-right">
                      Totales del periodo
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell valor={diario.totalCargos} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell valor={diario.totalAbonos} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

function FilasAsiento({
  asiento,
}: {
  asiento: ReturnType<typeof construirDiario>['asientos'][number]
}) {
  return (
    <>
      <tr className="border-t border-slate-200 bg-slate-50/70">
        <td colSpan={5} className="px-3 py-2">
          <span className="text-xs text-slate-500">{formatFecha(asiento.fecha)}</span>
          <Link
            to={`/conta/asientos?asiento=${encodeURIComponent(asiento.id)}`}
            className="ml-3 font-mono text-xs font-medium text-brand-700 hover:underline"
          >
            {asiento.codigo}
          </Link>
          <span className="ml-3 font-medium text-slate-800">{asiento.concepto}</span>
          {asiento.reversado && (
            <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              reversado
            </span>
          )}
        </td>
      </tr>
      {asiento.lineas.map((l) => (
        <tr key={l.id} className="text-slate-700">
          <td className="py-1 pr-3 pl-6">
            <span className="font-mono text-xs text-slate-500">{l.cuentaCodigo}</span>{' '}
            {l.cuentaNombre}
          </td>
          <td className="px-3 py-1 text-xs">{l.concepto}</td>
          <td className="px-3 py-1 text-xs text-slate-500">{l.auxiliarNombre ?? ''}</td>
          <td className="px-3 py-1 text-right">
            <MoneyCell valor={l.cargo} ocultarCero />
          </td>
          <td className="px-3 py-1 text-right">
            <MoneyCell valor={l.abono} ocultarCero />
          </td>
        </tr>
      ))}
    </>
  )
}
