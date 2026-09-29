import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { CircleAlert } from 'lucide-react'
import Decimal from 'decimal.js'
import { Card, EstadoError, EstadoVacio, PageHeader } from '@/shared/ui/Layout'
import { Select } from '@/shared/ui/Field'
import { SelectorLibro } from '@/shared/asiento/Libros'
import { etiquetaLibro } from '@/shared/asiento/libro'
import { formatFecha, formatFechaLarga, formatPeriodo } from '@/shared/format/fecha'
import { MoneyCell } from '@/shared/money/MoneyCell'
import {
  useAsientosRango,
  useBalanzaReporte,
  useCatalogosReporte,
} from '../api/queries'
import { construirMayor, type CuentaMayor } from '../domain/libros'
import { aCsv, importeCsv, nombreArchivo, type Celda } from '../domain/csv'
import {
  AccionesReporte,
  Calculando,
  EncabezadoReporte,
} from '../components/Reporte'
import { descargar } from '../components/descargar'
import { useFiltrosReporte } from '../components/useFiltrosReporte'

/**
 * Libro mayor y auxiliar de cuenta (docs/09 §4).
 *
 * Los dos son la misma pantalla: el mayor es el de todas las cuentas y el
 * auxiliar el de una. Cada movimiento lleva a su asiento, y el asiento a su
 * documento de origen: es el final del drill-down que empieza en un renglón
 * del Balance (docs/09 §5).
 *
 * El saldo final de cada cuenta se compara contra la balanza del último mes.
 * El mayor se arma con los asientos y la balanza con su propio motor: si un día
 * dicen cosas distintas, esta pantalla es donde se nota primero.
 */
export function LibroMayorPage() {
  const filtros = useFiltrosReporte()
  const { periodo: hasta, periodos, libro } = filtros
  const [parametros, setParametros] = useSearchParams()

  const cuenta = parametros.get('cuenta') ?? ''
  const pedidoDesde = periodos.find((p) => p.id === parametros.get('desde'))
  // Un "desde" posterior al "hasta" no es un intervalo: se usa el mismo mes.
  const desde =
    pedidoDesde && hasta && pedidoDesde.fechaInicio <= hasta.fechaInicio
      ? pedidoDesde
      : hasta

  const escribir = (clave: string, valor: string) =>
    setParametros(
      (previos) => {
        const nuevos = new URLSearchParams(previos)
        if (valor) nuevos.set(clave, valor)
        else nuevos.delete(clave)
        return nuevos
      },
      { replace: true },
    )

  const catalogos = useCatalogosReporte()
  const balanzaDesde = useBalanzaReporte(desde?.id, libro)
  const balanzaHasta = useBalanzaReporte(hasta?.id, libro)
  const asientos = useAsientosRango(desde?.fechaInicio, hasta?.fechaFin, libro)

  const mayor = useMemo(() => {
    if (!catalogos.catalogos || !balanzaDesde.data || !asientos.data) return
    return construirMayor(
      asientos.data,
      balanzaDesde.data,
      catalogos.catalogos.cuentas,
      libro,
      cuenta || undefined,
    )
  }, [catalogos.catalogos, balanzaDesde.data, asientos.data, libro, cuenta])

  /** Cuentas cuyo saldo final no es el de la balanza. Debería ser siempre vacío. */
  const descuadres = useMemo(() => {
    if (!mayor || !balanzaHasta.data) return []
    const saldos = new Map(
      balanzaHasta.data.renglones.map((r) => [r.codigo, r.saldoFinal]),
    )
    return mayor.filter(
      (c) => !new Decimal(c.saldoFinal).equals(saldos.get(c.codigo) ?? 0),
    )
  }, [mayor, balanzaHasta.data])

  const consultas = [balanzaDesde, balanzaHasta, asientos]
  const error = catalogos.error ?? consultas.find((c) => c.error)?.error

  const detalle = (catalogos.catalogos?.cuentas ?? []).filter((c) => c.esDetalle)
  const titulo = cuenta ? 'Auxiliar de cuenta' : 'Libro mayor'
  const intervalo =
    desde && hasta
      ? `Del ${formatFechaLarga(desde.fechaInicio)} al ${formatFechaLarga(hasta.fechaFin)}`
      : ''

  const exportar = () => {
    if (!mayor || !hasta) return
    const filas: Celda[][] = [
      [titulo],
      [intervalo],
      [`Contabilidad ${etiquetaLibro(libro).toLowerCase()}`],
      [],
      ['Cuenta', 'Fecha', 'Asiento', 'Concepto', 'Auxiliar', 'Cargo', 'Abono', 'Saldo'],
    ]
    for (const c of mayor) {
      filas.push([`${c.codigo} ${c.nombre}`, '', '', 'Saldo inicial', '', '', '', importeCsv(c.saldoInicial)])
      for (const m of c.movimientos) {
        filas.push([
          c.codigo,
          m.fecha,
          m.asientoCodigo,
          m.concepto,
          m.auxiliar ?? '',
          importeCsv(m.cargo),
          importeCsv(m.abono),
          importeCsv(m.saldo),
        ])
      }
      filas.push([c.codigo, '', '', 'Totales y saldo final', '', importeCsv(c.totalCargos), importeCsv(c.totalAbonos), importeCsv(c.saldoFinal)])
    }
    descargar(
      aCsv(filas),
      nombreArchivo([
        cuenta ? `auxiliar-${cuenta}` : 'libro-mayor',
        formatPeriodo(hasta.ejercicio, hasta.numero),
        libro,
      ]),
    )
  }

  return (
    <div>
      <PageHeader
        titulo={titulo}
        descripcion={hasta ? `Contabilidad ${etiquetaLibro(libro).toLowerCase()} · ${intervalo}` : undefined}
        acciones={
          <>
            <SelectorLibro valor={libro} onChange={filtros.setLibro} />
            <AccionesReporte onExportar={exportar} exportable={Boolean(mayor)} />
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          Cuenta
          <Select
            aria-label="Cuenta"
            className="h-7 w-72 py-0 text-xs"
            value={cuenta}
            onChange={(e) => escribir('cuenta', e.target.value)}
          >
            <option value="">Todas las cuentas</option>
            {detalle.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.codigo} · {c.nombre}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          Desde
          <Select
            aria-label="Desde"
            className="h-7 w-40 py-0 text-xs"
            value={desde?.id ?? ''}
            onChange={(e) => escribir('desde', e.target.value)}
          >
            {periodos
              .filter((p) => !hasta || p.fechaInicio <= hasta.fechaInicio)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {formatPeriodo(p.ejercicio, p.numero)}
                </option>
              ))}
          </Select>
        </label>
        <span className="text-xs text-slate-500">
          hasta {hasta ? formatPeriodo(hasta.ejercicio, hasta.numero) : ''}, el
          periodo de la cabecera
        </span>
      </div>

      {descuadres.length > 0 && (
        <div
          role="alert"
          className="mb-3 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200 ring-inset"
        >
          <CircleAlert className="size-4 shrink-0" />
          <span>
            <strong>El mayor no coincide con la balanza</strong> en{' '}
            {descuadres.map((c) => c.codigo).join(', ')}. Es un error del
            núcleo contable, no de captura.
          </span>
        </div>
      )}

      <Card>
        {error ? (
          <EstadoError
            error={error}
            onReintentar={() => {
              catalogos.reintentar()
              consultas.forEach((c) => void c.refetch())
            }}
          />
        ) : !mayor || !hasta ? (
          <Calculando />
        ) : mayor.length === 0 ? (
          <EstadoVacio
            titulo="Sin movimientos"
            descripcion="Ninguna cuenta tiene saldo ni movimientos en este libro y este intervalo."
          />
        ) : (
          <>
            <EncabezadoReporte
              titulo={titulo}
              lineas={[intervalo, `Contabilidad ${etiquetaLibro(libro).toLowerCase()}`]}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="w-24 px-3 py-2 text-left font-medium">Fecha</th>
                    <th className="w-36 px-3 py-2 text-left font-medium">Asiento</th>
                    <th className="px-3 py-2 text-left font-medium">Concepto</th>
                    <th className="px-3 py-2 text-left font-medium">Auxiliar</th>
                    <th className="w-32 px-3 py-2 text-right font-medium">Cargo</th>
                    <th className="w-32 px-3 py-2 text-right font-medium">Abono</th>
                    <th className="w-36 px-3 py-2 text-right font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {mayor.map((c) => (
                    <FilasCuenta key={c.codigo} cuenta={c} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

function FilasCuenta({ cuenta }: { cuenta: CuentaMayor }) {
  return (
    <>
      <tr className="border-t border-slate-200 bg-slate-50/70">
        <td colSpan={6} className="px-3 py-2 font-medium text-slate-900">
          <span className="font-mono text-xs text-slate-500">{cuenta.codigo}</span>{' '}
          {cuenta.nombre}
          <span className="ml-2 text-xs font-normal text-slate-500">
            saldo {cuenta.naturaleza}
          </span>
        </td>
        <td className="px-3 py-2 text-right">
          <MoneyCell valor={cuenta.saldoInicial} />
        </td>
      </tr>
      {cuenta.movimientos.length === 0 && (
        <tr>
          <td colSpan={7} className="px-6 py-1.5 text-xs text-slate-400">
            Sin movimientos en el intervalo
          </td>
        </tr>
      )}
      {cuenta.movimientos.map((m, i) => (
        <tr key={`${m.asientoId}-${i}`} className="text-slate-700 hover:bg-slate-50">
          <td className="px-3 py-1.5 text-xs whitespace-nowrap">{formatFecha(m.fecha)}</td>
          <td className="px-3 py-1.5 font-mono text-xs">
            <Link
              to={`/conta/asientos?asiento=${encodeURIComponent(m.asientoId)}`}
              className="text-brand-700 hover:underline"
              title="Ver el asiento y su documento de origen"
            >
              {m.asientoCodigo}
            </Link>
          </td>
          <td className="px-3 py-1.5">{m.concepto}</td>
          <td className="px-3 py-1.5 text-xs text-slate-500">{m.auxiliar ?? ''}</td>
          <td className="px-3 py-1.5 text-right">
            <MoneyCell valor={m.cargo} ocultarCero />
          </td>
          <td className="px-3 py-1.5 text-right">
            <MoneyCell valor={m.abono} ocultarCero />
          </td>
          <td className="px-3 py-1.5 text-right">
            <MoneyCell valor={m.saldo} />
          </td>
        </tr>
      ))}
      <tr className="text-xs font-medium text-slate-800">
        <td colSpan={4} className="px-3 py-1.5 text-right">
          Totales y saldo final
        </td>
        <td className="px-3 py-1.5 text-right">
          <MoneyCell valor={cuenta.totalCargos} />
        </td>
        <td className="px-3 py-1.5 text-right">
          <MoneyCell valor={cuenta.totalAbonos} />
        </td>
        <td className="px-3 py-1.5 text-right font-semibold">
          <MoneyCell valor={cuenta.saldoFinal} />
        </td>
      </tr>
    </>
  )
}
