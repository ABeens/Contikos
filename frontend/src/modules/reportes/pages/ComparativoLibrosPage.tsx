import { useMemo, useState } from 'react'
import Decimal from 'decimal.js'
import { Card, EstadoError, EstadoVacio, PageHeader } from '@/shared/ui/Layout'
import { formatFechaLarga, formatPeriodo } from '@/shared/format/fecha'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { cn } from '@/shared/ui/cn'
import { useBalanzaReporte, useCatalogosReporte } from '../api/queries'
import { compararLibros } from '../domain/libros'
import { resultadoDe } from '../domain/estados'
import { aCsv, importeCsv, nombreArchivo, type Celda } from '../domain/csv'
import {
  AccionesReporte,
  Calculando,
  EncabezadoReporte,
} from '../components/Reporte'
import { descargar } from '../components/descargar'
import { useFiltrosReporte } from '../components/useFiltrosReporte'
import { useMovimientos } from '../components/useMovimientos'
import { enlaceAuxiliar } from '../components/enlaces'
import { Link } from 'react-router'

/**
 * Comparativo fiscal contra corporativo (docs/09 §3).
 *
 * El único reporte que junta los dos libros, y no los suma: los pone lado a
 * lado. Arriba, la utilidad del ejercicio en cada uno; abajo, las cuentas donde
 * difieren, que son las que explican esa diferencia y el insumo de la
 * conciliación fiscal de la renta.
 */
export function ComparativoLibrosPage() {
  const { periodo, periodos } = useFiltrosReporte()
  const [soloDiferencias, setSoloDiferencias] = useState(true)

  const catalogos = useCatalogosReporte()
  const fiscal = useBalanzaReporte(periodo?.id, 'fiscal')
  const corporativo = useBalanzaReporte(periodo?.id, 'corporativo')
  const utilidadFiscal = useMovimientos(periodo, periodos, 'fiscal', 'ejercicio')
  const utilidadCorporativa = useMovimientos(periodo, periodos, 'corporativo', 'ejercicio')

  const comparativo = useMemo(
    () =>
      fiscal.data && corporativo.data
        ? compararLibros(fiscal.data, corporativo.data)
        : undefined,
    [fiscal.data, corporativo.data],
  )

  const utilidades = useMemo(() => {
    if (!catalogos.catalogos || !utilidadFiscal.movimientos || !utilidadCorporativa.movimientos) {
      return
    }
    const f = resultadoDe(utilidadFiscal.movimientos, catalogos.catalogos)
    const c = resultadoDe(utilidadCorporativa.movimientos, catalogos.catalogos)
    return { fiscal: f.toFixed(2), corporativa: c.toFixed(2), diferencia: c.minus(f).toFixed(2) }
  }, [catalogos.catalogos, utilidadFiscal.movimientos, utilidadCorporativa.movimientos])

  const consultas = [fiscal, corporativo, ...utilidadFiscal.consultas, ...utilidadCorporativa.consultas]
  const error = catalogos.error ?? consultas.find((c) => c.error)?.error

  const renglones = (comparativo?.renglones ?? []).filter(
    (r) => !soloDiferencias || !new Decimal(r.diferencia).isZero(),
  )
  const corte = periodo ? `Al ${formatFechaLarga(periodo.fechaFin)}` : ''

  const exportar = () => {
    if (!comparativo || !utilidades || !periodo) return
    const filas: Celda[][] = [
      ['Comparativo fiscal contra corporativo'],
      [corte],
      [],
      ['Utilidad del ejercicio', '', importeCsv(utilidades.fiscal), importeCsv(utilidades.corporativa), importeCsv(utilidades.diferencia)],
      [],
      ['Cuenta', 'Nombre', 'Fiscal', 'Corporativo', 'Diferencia'],
      ...comparativo.renglones.map((r) => [
        r.codigo,
        r.nombre,
        importeCsv(r.fiscal),
        importeCsv(r.corporativo),
        importeCsv(r.diferencia),
      ]),
    ]
    descargar(
      aCsv(filas),
      nombreArchivo(['comparativo-fiscal-corporativo', formatPeriodo(periodo.ejercicio, periodo.numero)]),
    )
  }

  return (
    <div>
      <PageHeader
        titulo="Comparativo fiscal contra corporativo"
        descripcion="Las dos contabilidades lado a lado, por cuenta. Explica por qué la utilidad que se declara no es la del negocio."
        acciones={<AccionesReporte onExportar={exportar} exportable={Boolean(comparativo && utilidades)} />}
      />

      {utilidades && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {[
            { etiqueta: 'Utilidad fiscal del ejercicio', valor: utilidades.fiscal },
            { etiqueta: 'Utilidad corporativa del ejercicio', valor: utilidades.corporativa },
            { etiqueta: 'Diferencia (corporativa menos fiscal)', valor: utilidades.diferencia },
          ].map((t) => (
            <Card key={t.etiqueta} className="px-4 py-3">
              <p className="text-xs text-slate-500">{t.etiqueta}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                <MoneyCell valor={t.valor} parentesisNegativos />
              </p>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center gap-3 print:hidden">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={soloDiferencias}
            onChange={(e) => setSoloDiferencias(e.target.checked)}
            className="size-3.5 rounded border-slate-300"
          />
          Solo las cuentas donde los libros difieren
        </label>
        {comparativo && (
          <span className="ml-auto text-xs text-slate-500">
            {comparativo.conDiferencia} cuenta(s) con diferencia
          </span>
        )}
      </div>

      <Card>
        {error ? (
          <EstadoError
            error={error}
            onReintentar={() => {
              catalogos.reintentar()
              consultas.forEach((c) => void c.refetch())
            }}
          />
        ) : !comparativo || !periodo ? (
          <Calculando />
        ) : renglones.length === 0 ? (
          <EstadoVacio
            titulo="Los dos libros dicen lo mismo"
            descripcion="Ninguna cuenta tiene un saldo fiscal distinto del corporativo a esta fecha."
          />
        ) : (
          <>
            <EncabezadoReporte titulo="Comparativo fiscal contra corporativo" lineas={[corte]} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-4 py-2 text-left font-medium">Cuenta</th>
                    <th className="w-40 px-4 py-2 text-right font-medium">Fiscal</th>
                    <th className="w-40 px-4 py-2 text-right font-medium">Corporativo</th>
                    <th className="w-40 px-4 py-2 text-right font-medium">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {renglones.map((r) => {
                    const difiere = !new Decimal(r.diferencia).isZero()
                    return (
                      <tr key={r.codigo} className={cn('hover:bg-slate-50', difiere && 'bg-amber-50/40')}>
                        <td className="px-4 py-1.5">
                          <span className="font-mono text-xs text-slate-500">{r.codigo}</span>{' '}
                          {r.nombre}
                          <span className="ml-2 text-xs print:hidden">
                            {(['fiscal', 'corporativo'] as const).map((libro) => (
                              <Link
                                key={libro}
                                to={enlaceAuxiliar({ codigo: r.codigo, desde: periodo, hasta: periodo, libro })}
                                className="mr-2 text-brand-700 hover:underline"
                              >
                                {libro}
                              </Link>
                            ))}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-right">
                          <MoneyCell valor={r.fiscal} parentesisNegativos />
                        </td>
                        <td className="px-4 py-1.5 text-right">
                          <MoneyCell valor={r.corporativo} parentesisNegativos />
                        </td>
                        <td className="px-4 py-1.5 text-right font-medium">
                          <MoneyCell valor={r.diferencia} parentesisNegativos ocultarCero />
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
