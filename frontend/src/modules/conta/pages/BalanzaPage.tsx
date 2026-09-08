import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { Card, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Select } from '@/shared/ui/Field'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatPeriodo } from '@/shared/format/fecha'
import type { Libro } from '@/shared/api/contracts/comunes'
import type {
  RenglonBalanza,
  RenglonComparativo,
} from '@/shared/api/contracts/conta'
import { useEmpresa } from '@/app/empresa'
import { useBalanza, useBalanzaComparativa, usePeriodos } from '../api/queries'
import { esLibro, etiquetaLibro } from '@/shared/asiento/libro'
import { SelectorLibro } from '@/shared/asiento/Libros'
import { cn } from '@/shared/ui/cn'

export function BalanzaPage() {
  const { periodoActivo } = useEmpresa()
  const { data: periodos = [] } = usePeriodos()
  const [parametros, setParametros] = useSearchParams()
  // El libro va en la URL como cualquier otro filtro: un contador debe poder
  // enviar el enlace a la balanza que está mirando (docs/14 §6). Y cuál de las
  // dos es no puede quedar implícito en el estado de una pantalla.
  const parametroLibro = parametros.get('libro')
  const libro: Libro = esLibro(parametroLibro) ? parametroLibro : 'fiscal'
  const setLibro = (nuevo: Libro) => {
    const nuevos = new URLSearchParams(parametros)
    nuevos.set('libro', nuevo)
    setParametros(nuevos, { replace: true })
  }

  /**
   * Periodo con el que se compara. Por la misma razón que el libro, va en la
   * URL: el comparativo de agosto contra julio es un reporte concreto y tiene
   * que poder enviarse por enlace.
   */
  const comparadoCon = parametros.get('comparar')
  const setComparadoCon = (nuevo: string | null) => {
    const nuevos = new URLSearchParams(parametros)
    if (nuevo) nuevos.set('comparar', nuevo)
    else nuevos.delete('comparar')
    setParametros(nuevos, { replace: true })
  }
  const comparando = Boolean(comparadoCon)

  const { data: balanza, isLoading } = useBalanza(periodoActivo?.id, libro)
  // Los dos periodos van en el orden en que se leen: A es el de referencia
  // (el anterior) y B el que se está mirando, para que la variación sea "lo
  // que pasó desde entonces" y no al revés.
  const { data: comparativa, isLoading: cargandoComparativa } =
    useBalanzaComparativa(
      comparadoCon ?? undefined,
      periodoActivo?.id,
      libro,
      comparando,
    )
  const [soloDetalle, setSoloDetalle] = useState(false)

  const renglones = useMemo(
    () => (balanza?.renglones ?? []).filter((r) => !soloDetalle || r.esDetalle),
    [balanza, soloDetalle],
  )
  const renglonesComparativa = useMemo(
    () =>
      (comparativa?.renglones ?? []).filter((r) => !soloDetalle || r.esDetalle),
    [comparativa, soloDetalle],
  )

  const periodoComparado = periodos.find((p) => p.id === comparadoCon)

  const columnasCuenta = useMemo<
    ColumnDef<RenglonBalanza | RenglonComparativo, unknown>[]
  >(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Código',
        meta: { ancho: '150px' },
        cell: ({ row }) => (
          <span
            className="font-mono text-xs text-slate-600"
            style={{ paddingLeft: `${(row.original.nivel - 1) * 12}px` }}
          >
            {row.original.codigo}
          </span>
        ),
      },
      {
        accessorKey: 'nombre',
        header: 'Cuenta',
        cell: ({ row }) => (
          <span
            className={
              row.original.esDetalle
                ? 'text-slate-700'
                : 'font-semibold text-slate-900'
            }
          >
            {row.original.nombre}
          </span>
        ),
      },
    ],
    [],
  )

  const columnas = useMemo<ColumnDef<RenglonBalanza, unknown>[]>(
    () => [
      ...(columnasCuenta as ColumnDef<RenglonBalanza, unknown>[]),
      {
        accessorKey: 'saldoInicial',
        header: 'Saldo inicial',
        meta: { numerico: true, ancho: '150px' },
        cell: ({ row }) => (
          <MoneyCell valor={row.original.saldoInicial} ocultarCero />
        ),
      },
      {
        accessorKey: 'cargos',
        header: 'Cargos',
        meta: { numerico: true, ancho: '150px' },
        cell: ({ row }) => <MoneyCell valor={row.original.cargos} ocultarCero />,
      },
      {
        accessorKey: 'abonos',
        header: 'Abonos',
        meta: { numerico: true, ancho: '150px' },
        cell: ({ row }) => <MoneyCell valor={row.original.abonos} ocultarCero />,
      },
      {
        accessorKey: 'saldoFinal',
        header: 'Saldo final',
        meta: { numerico: true, ancho: '150px' },
        cell: ({ row }) => (
          <span className="font-medium">
            <MoneyCell valor={row.original.saldoFinal} ocultarCero />
          </span>
        ),
      },
    ],
    [columnasCuenta],
  )

  const columnasComparativas = useMemo<
    ColumnDef<RenglonComparativo, unknown>[]
  >(
    () => [
      ...(columnasCuenta as ColumnDef<RenglonComparativo, unknown>[]),
      {
        accessorKey: 'saldoA',
        header: periodoComparado
          ? formatPeriodo(periodoComparado.ejercicio, periodoComparado.numero)
          : 'Periodo A',
        meta: { numerico: true, ancho: '150px' },
        cell: ({ row }) => <MoneyCell valor={row.original.saldoA} ocultarCero />,
      },
      {
        accessorKey: 'saldoB',
        header:
          periodoActivo &&
          formatPeriodo(periodoActivo.ejercicio, periodoActivo.numero),
        meta: { numerico: true, ancho: '150px' },
        cell: ({ row }) => (
          <span className="font-medium">
            <MoneyCell valor={row.original.saldoB} ocultarCero />
          </span>
        ),
      },
      {
        accessorKey: 'variacion',
        header: 'Variación',
        meta: { numerico: true, ancho: '150px' },
        cell: ({ row }) => (
          <span className={claseVariacion(row.original.variacion)}>
            <MoneyCell valor={row.original.variacion} ocultarCero />
          </span>
        ),
      },
      {
        accessorKey: 'variacionPorcentual',
        header: '%',
        meta: { numerico: true, ancho: '110px' },
        // Sin saldo base no hay porcentaje: "n/a" y no un cero que se leería
        // como "no se movió" ni un infinito que nadie sabe interpretar.
        cell: ({ row }) =>
          row.original.variacionPorcentual === null ? (
            <span className="text-xs text-slate-400">n/a</span>
          ) : (
            <span
              className={cn('tabular', claseVariacion(row.original.variacion))}
            >
              {row.original.variacionPorcentual} %
            </span>
          ),
      },
    ],
    [columnasCuenta, periodoActivo, periodoComparado],
  )

  return (
    <div>
      <PageHeader
        titulo="Balanza de comprobación"
        descripcion={
          periodoActivo
            ? `Contabilidad ${etiquetaLibro(libro).toLowerCase()} · ${formatPeriodo(periodoActivo.ejercicio, periodoActivo.numero)} · ${balanza?.moneda ?? ''}`
            : undefined
        }
        acciones={<SelectorLibro valor={libro} onChange={setLibro} />}
      />

      {balanza && !balanza.cuadra && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200 ring-inset">
          <CircleAlert className="size-4 shrink-0" />
          <span>
            <strong>La balanza no cuadra.</strong> Esto indica un error en el
            núcleo contable, no un error de captura.
          </span>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={soloDetalle}
              onChange={(e) => setSoloDetalle(e.target.checked)}
              className="size-3.5 rounded border-slate-300"
            />
            Solo cuentas de detalle
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={comparando}
              onChange={(e) =>
                setComparadoCon(
                  e.target.checked ? (periodoPropuesto(periodos, periodoActivo?.id) ?? null) : null,
                )
              }
              className="size-3.5 rounded border-slate-300"
            />
            Comparar con
          </label>
          {comparando && (
            <Select
              aria-label="Periodo de comparación"
              className="h-7 w-44 py-0 text-xs"
              value={comparadoCon ?? ''}
              onChange={(e) => setComparadoCon(e.target.value)}
            >
              {periodos
                .filter((p) => p.id !== periodoActivo?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPeriodo(p.ejercicio, p.numero)}
                  </option>
                ))}
            </Select>
          )}

          <span className="ml-auto text-xs text-slate-500">
            {comparando ? renglonesComparativa.length : renglones.length}{' '}
            renglones
          </span>
          {!comparando && balanza?.cuadra && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CircleCheck className="size-3.5" />
              La balanza cuadra
            </span>
          )}
        </div>

        {comparando ? (
          cargandoComparativa ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              Calculando la comparativa…
            </p>
          ) : (
            <DataTable
              columns={columnasComparativas}
              data={renglonesComparativa}
              maxAltura="calc(100vh - 265px)"
              vacio={{
                titulo: 'Sin movimientos en ninguno de los dos periodos',
                descripcion:
                  'No hay asientos contabilizados que comparar entre los periodos seleccionados.',
              }}
            />
          )
        ) : isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Calculando balanza…
          </p>
        ) : (
          <DataTable
            columns={columnas}
            data={renglones}
            maxAltura="calc(100vh - 265px)"
            vacio={{
              titulo: 'Sin movimientos en el periodo',
              descripcion:
                'No hay asientos contabilizados en el periodo seleccionado.',
            }}
            pie={
              balanza ? (
                <tr className="text-sm font-semibold text-slate-800">
                  <td colSpan={3} className="px-3 py-2 text-right">
                    Totales del periodo (cuentas de detalle)
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    <MoneyCell valor={balanza.totalCargos} />
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    <MoneyCell valor={balanza.totalAbonos} />
                  </td>
                  <td />
                </tr>
              ) : undefined
            }
          />
        )}
      </Card>
    </div>
  )
}

/**
 * Con qué periodo se propone comparar al encender el conmutador: el anterior
 * al que se está mirando, que es la comparación que se pide nueve de cada diez
 * veces. Si no hay anterior (enero), el primero de la lista que no sea él.
 */
function periodoPropuesto(
  periodos: readonly { id: string; numero: number; ejercicio: number }[],
  actualId: string | undefined,
): string | undefined {
  const actual = periodos.find((p) => p.id === actualId)
  const anterior =
    actual &&
    periodos.find(
      (p) => p.ejercicio === actual.ejercicio && p.numero === actual.numero - 1,
    )
  return (anterior ?? periodos.find((p) => p.id !== actualId))?.id
}

/**
 * El color de la variación sigue al signo, y el signo ya viene interpretado
 * según la naturaleza de la cuenta: los saldos de la balanza llegan con el
 * signo de su naturaleza, así que "creció" significa lo mismo en un activo que
 * en un pasivo.
 */
function claseVariacion(variacion: string): string {
  const valor = Number(variacion)
  if (valor > 0) return 'font-medium text-emerald-700'
  if (valor < 0) return 'font-medium text-red-700'
  return 'text-slate-400'
}
