import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import Decimal from 'decimal.js'
import { CalendarClock, Plus, Search } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Field'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha } from '@/shared/format/fecha'
import type { Diferido } from '@/shared/api/contracts/diferidos'
import { useCuentas } from '@/shared/api/catalogos'
import { useDiferidos } from '../api/queries'

/**
 * Auxiliar de diferidos (docs/15 §4).
 *
 * Lo que se lee de un vistazo es el saldo por amortizar, porque es el que tiene
 * que explicar la cuenta de balance: la suma de esta columna es el saldo que la
 * conciliación de docs/15 §4 compara contra el mayor. El avance está al lado
 * para saber cuánto falta sin tener que restar de cabeza.
 */
export function DiferidosPage() {
  const { data: diferidos = [], isLoading } = useDiferidos()
  const { data: cuentas = [] } = useCuentas()
  const [parametros, setParametros] = useSearchParams()
  const [filtro, setFiltro] = useState('')
  const [seleccionado, setSeleccionado] = useState<Diferido | null>(null)

  // `?diferido=` es la ida desde la corrida: quien llega desde una línea de la
  // amortización quiere esa ficha, no el auxiliar entero.
  const pedido = parametros.get('diferido')
  useEffect(() => {
    if (!pedido) return
    const diferido = diferidos.find((d) => d.id === pedido)
    if (diferido) setSeleccionado(diferido)
  }, [pedido, diferidos])

  const cerrarFicha = () => {
    setSeleccionado(null)
    if (pedido) {
      const nuevos = new URLSearchParams(parametros)
      nuevos.delete('diferido')
      setParametros(nuevos, { replace: true })
    }
  }

  const totales = useMemo(() => {
    const vivos = diferidos.filter((d) => d.estado !== 'cancelado')
    const sumar = (campo: 'monto' | 'montoAmortizado' | 'saldoPorAmortizar') =>
      vivos
        .reduce((acc, d) => acc.plus(new Decimal(d[campo])), new Decimal(0))
        .toFixed(2)
    return {
      monto: sumar('monto'),
      amortizado: sumar('montoAmortizado'),
      saldo: sumar('saldoPorAmortizar'),
    }
  }, [diferidos])

  const columnas = useMemo<ColumnDef<Diferido, unknown>[]>(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Código',
        meta: { ancho: '100px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-600">
            {row.original.codigo}
          </span>
        ),
      },
      {
        accessorKey: 'descripcion',
        header: 'Diferido',
        cell: ({ row }) => (
          <div>
            <p className="text-slate-800">{row.original.descripcion}</p>
            <p className="text-[11px] text-slate-500">
              {row.original.tercero?.nombre ?? 'Sin tercero'}
            </p>
          </div>
        ),
      },
      {
        id: 'tipo',
        header: 'Tipo',
        meta: { ancho: '110px' },
        accessorFn: (d) => (d.tipo === 'gasto' ? 'gasto diferido' : 'ingreso diferido'),
        cell: ({ row }) => (
          <span className="text-[11px] text-slate-600">
            {row.original.tipo === 'gasto' ? 'Gasto' : 'Ingreso'}
          </span>
        ),
      },
      {
        accessorKey: 'fechaInicio',
        header: 'Inicio',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fechaInicio),
      },
      {
        id: 'plazo',
        header: 'Plazo',
        meta: { ancho: '90px' },
        accessorFn: (d) => `${d.plazoMeses} meses`,
        cell: ({ row }) => (
          <span className="text-xs text-slate-600">
            {row.original.plazoMeses} meses
          </span>
        ),
      },
      {
        id: 'monto',
        header: 'Monto',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (d) => d.monto,
        cell: ({ row }) => (
          <MoneyCell valor={row.original.monto} moneda={row.original.moneda} />
        ),
      },
      {
        id: 'saldo',
        header: 'Por amortizar',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (d) => d.saldoPorAmortizar,
        cell: ({ row }) => (
          <MoneyCell
            valor={row.original.saldoPorAmortizar}
            moneda={row.original.moneda}
          />
        ),
      },
      {
        id: 'avance',
        header: 'Avance',
        meta: { ancho: '120px' },
        accessorFn: (d) => porcentaje(d),
        cell: ({ row }) => <Avance diferido={row.original} />,
      },
      {
        accessorKey: 'estado',
        header: 'Estado',
        meta: { ancho: '110px' },
        cell: ({ row }) => <EstadoBadge estado={row.original.estado} />,
      },
    ],
    [],
  )

  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? codigo

  return (
    <div>
      <PageHeader
        titulo="Asientos diferidos"
        descripcion="Gastos pagados e ingresos cobrados por adelantado, y lo que falta por reconocer de cada uno."
        acciones={
          <>
            <Link to="/diferidos/amortizacion">
              <Button icono={<CalendarClock className="size-4" />}>
                Amortización
              </Button>
            </Link>
            <Link to="/diferidos/nuevo">
              <Button variante="primario" icono={<Plus className="size-4" />}>
                Registrar diferido
              </Button>
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Resumen titulo="Monto diferido" valor={totales.monto} />
        <Resumen titulo="Ya reconocido" valor={totales.amortizado} />
        <Resumen titulo="Por amortizar" valor={totales.saldo} destacado />
      </div>

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search className="size-4 text-slate-400" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por descripción, código o tercero…"
            className="h-8 max-w-sm border-0 px-0 focus:ring-0"
          />
          <span className="ml-auto text-xs text-slate-500">
            {diferidos.length} diferido{diferidos.length === 1 ? '' : 's'}
          </span>
        </div>

        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Cargando diferidos…
          </p>
        ) : (
          <DataTable
            columns={columnas}
            data={diferidos}
            filtro={filtro}
            onRowClick={setSeleccionado}
            vacio={{
              titulo: 'Sin diferidos registrados',
              descripcion:
                'Registre la póliza, el alquiler o el mantenimiento que se pagó o se cobró por adelantado.',
            }}
          />
        )}
      </Card>

      {seleccionado && (
        <Card className="mt-4">
          <CardHeader
            titulo={`${seleccionado.codigo} · ${seleccionado.descripcion}`}
            descripcion={
              seleccionado.tipo === 'gasto'
                ? 'Gasto diferido: el saldo por amortizar descansa en el activo.'
                : 'Ingreso diferido: el saldo por amortizar descansa en el pasivo.'
            }
            acciones={
              <Button tamano="sm" onClick={cerrarFicha}>
                Cerrar
              </Button>
            }
          />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <Dato
              titulo="Tercero"
              valor={seleccionado.tercero?.nombre ?? 'Sin tercero'}
            />
            <Dato titulo="Inicio" valor={formatFecha(seleccionado.fechaInicio)} />
            <Dato titulo="Plazo" valor={`${seleccionado.plazoMeses} meses`} />
            <Dato
              titulo="Cuota mensual"
              valor={`${seleccionado.cuotaMensual} ${seleccionado.moneda}`}
            />
            <Dato
              titulo="Cuenta de balance"
              valor={`${seleccionado.cuentaDiferido} ${nombreCuenta(seleccionado.cuentaDiferido)}`}
            />
            <Dato
              titulo="Cuenta de resultados"
              valor={`${seleccionado.cuentaDestino} ${nombreCuenta(seleccionado.cuentaDestino)}`}
            />
            <Dato
              titulo="Reconocido"
              valor={`${seleccionado.montoAmortizado} ${seleccionado.moneda}`}
            />
            <Dato
              titulo="Por amortizar"
              valor={`${seleccionado.saldoPorAmortizar} ${seleccionado.moneda}`}
            />
            <Dato
              titulo="Origen"
              valor={
                seleccionado.origen
                  ? `${seleccionado.origen.modulo} · ${seleccionado.origen.tipo} · ${seleccionado.origen.id}`
                  : 'Registro directo'
              }
            />
            <Dato
              titulo="Asiento propio"
              valor="No: lo contabilizó el documento que lo originó"
            />
          </dl>

          {seleccionado.cancelacion && (
            <p className="mx-4 mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200 ring-inset">
              Cancelado el {formatFecha(seleccionado.cancelacion.fecha)}:{' '}
              {seleccionado.cancelacion.motivo}. Se reconocieron de golpe{' '}
              {seleccionado.cancelacion.importeReconocido} {seleccionado.moneda}
              {seleccionado.cancelacion.asientoId
                ? ` en el asiento ${seleccionado.cancelacion.asientoId}.`
                : ' (no quedaba saldo, así que no hubo asiento).'}
            </p>
          )}

          <HistorialAmortizaciones diferido={seleccionado} />
        </Card>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- Avance */

/** Porcentaje reconocido, con el cero a salvo de un monto vacío. */
function porcentaje(diferido: Diferido): number {
  const monto = new Decimal(diferido.monto)
  if (monto.lessThanOrEqualTo(0)) return 0
  return new Decimal(diferido.montoAmortizado)
    .dividedBy(monto)
    .times(100)
    .toDecimalPlaces(0)
    .toNumber()
}

function Avance({ diferido }: { diferido: Diferido }) {
  const valor = Math.min(porcentaje(diferido), 100)
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200"
        role="presentation"
      >
        <div
          className="h-full rounded-full bg-brand-500"
          style={{ width: `${valor}%` }}
        />
      </div>
      <span className="tabular text-[11px] text-slate-600">{valor}%</span>
    </div>
  )
}

/**
 * Las cuotas que ya entraron al mayor sobre el diferido.
 *
 * Es lo que explica el monto reconocido de la ficha: cada renglón es una
 * corrida contabilizada y lleva al asiento que la escribió.
 */
function HistorialAmortizaciones({ diferido }: { diferido: Diferido }) {
  const amortizaciones = diferido.amortizaciones ?? []
  return (
    <div className="border-t border-slate-200 px-4 py-3">
      <h3 className="text-xs font-semibold text-slate-600">
        Amortizaciones contabilizadas
      </h3>
      {amortizaciones.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">
          Ninguna corrida ha tocado este diferido todavía.
        </p>
      ) : (
        <table
          className="mt-2 w-full max-w-xl text-sm"
          aria-label="Amortizaciones del diferido"
        >
          <thead className="text-[11px] text-slate-500">
            <tr>
              <th className="py-1 text-left font-medium">Periodo</th>
              <th className="py-1 text-left font-medium">Fecha</th>
              <th className="py-1 text-right font-medium">Cuota</th>
              <th className="py-1 pl-4 text-left font-medium">Asiento</th>
            </tr>
          </thead>
          <tbody>
            {[...amortizaciones].reverse().map((a) => (
              <tr key={a.periodoId} className="border-t border-slate-100">
                <td className="py-1 font-mono text-xs text-slate-600">
                  {a.periodoId}
                </td>
                <td className="py-1 text-slate-700">{formatFecha(a.fecha)}</td>
                <td className="py-1 text-right">
                  <MoneyCell valor={a.cuota} moneda={diferido.moneda} />
                </td>
                <td className="py-1 pl-4">
                  <Link
                    to="/conta/asientos"
                    className="font-mono text-xs text-brand-700 hover:underline"
                  >
                    {a.asientoId}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Resumen({
  titulo,
  valor,
  destacado,
}: {
  titulo: string
  valor: string
  destacado?: boolean
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <p className="text-[11px] text-slate-500">{titulo}</p>
      <p
        className={`text-lg font-semibold ${destacado ? 'text-brand-700' : 'text-slate-900'}`}
      >
        <MoneyCell valor={valor} mostrarSimbolo />
      </p>
    </div>
  )
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500">{titulo}</dt>
      <dd className="text-slate-800">{valor}</dd>
    </div>
  )
}
