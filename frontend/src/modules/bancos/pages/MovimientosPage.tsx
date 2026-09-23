import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { LinkBoton } from '@/shared/ui/LinkBoton'
import { Card, CardHeader, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { Field, Select } from '@/shared/ui/Field'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha } from '@/shared/format/fecha'
import type { MovimientoBancario } from '@/shared/api/contracts/bancos'
import { useCuentasBancarias, useMovimientosBancarios } from '../api/queries'
import { etiquetaTipoMovimiento } from '../domain/movimiento'

/**
 * Auxiliar de una cuenta bancaria: lo que la empresa registró (docs/06 §1).
 *
 * Es una de las dos tablas de movimientos del módulo, y la que cuadra contra el
 * mayor. La otra, la del estado de cuenta, es lo que dice el banco y vive en la
 * conciliación: mezclarlas en esta pantalla haría imposible ver la diferencia
 * que la conciliación existe para explicar.
 *
 * Qué cuenta está abierta vive en la URL, igual que en las facturas y los
 * cobros (docs/14 §6): así se puede enviar por enlace y el botón de atrás
 * devuelve a la anterior.
 */
export function MovimientosPage() {
  const [parametros, setParametros] = useSearchParams()
  const consultaCuentas = useCuentasBancarias()
  const { data: cuentas = [] } = consultaCuentas
  const [filtro, setFiltro] = useState('')

  // Sin cuenta en la URL se abre la primera del catálogo: una pantalla de
  // movimientos sin cuenta elegida no puede enseñar nada útil.
  const cuentaId = parametros.get('cuenta') ?? cuentas[0]?.id ?? ''
  const cuenta = cuentas.find((c) => c.id === cuentaId)

  const consulta = useMovimientosBancarios(cuentaId || undefined)
  const { data: movimientos = [] } = consulta

  const columnas = useMemo<ColumnDef<MovimientoBancario, unknown>[]>(
    () => [
      {
        accessorKey: 'fecha',
        header: 'Fecha',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fecha),
      },
      {
        accessorKey: 'tipo',
        header: 'Tipo',
        meta: { ancho: '120px' },
        cell: ({ row }) => etiquetaTipoMovimiento(row.original.tipo),
      },
      {
        // Se busca por concepto Y referencia, que es lo que promete el
        // buscador: la referencia es lo que el banco imprime en su estado.
        id: 'concepto',
        header: 'Concepto',
        accessorFn: (m) => `${m.concepto} ${m.referencia ?? ''}`,
        cell: ({ row }) => (
          <div>
            <p className="text-slate-800">{row.original.concepto}</p>
            {row.original.referencia && (
              <p className="font-mono text-[11px] text-slate-500">
                Ref. {row.original.referencia}
              </p>
            )}
          </div>
        ),
      },
      {
        id: 'origen',
        header: 'Origen',
        meta: { ancho: '160px' },
        accessorFn: (m) => m.origen?.modulo ?? 'bancos',
        cell: ({ row }) =>
          row.original.origen ? (
            <span className="text-xs text-slate-500">
              {row.original.origen.modulo} ·{' '}
              <span className="font-mono">{row.original.origen.id}</span>
            </span>
          ) : (
            <span className="text-xs text-slate-400">Captura manual</span>
          ),
      },
      {
        id: 'asiento',
        header: 'Asiento',
        meta: { ancho: '120px' },
        accessorFn: (m) => m.asientoId ?? '',
        cell: ({ row }) =>
          row.original.asientoId ? (
            // La trazabilidad va en los dos sentidos (docs/02 §5): del auxiliar
            // al libro y del libro al documento que lo escribió.
            <Link
              to={`/conta/asientos?asiento=${row.original.asientoId}`}
              className="font-mono text-xs text-brand-700 underline-offset-2 hover:underline"
            >
              {row.original.asientoId}
            </Link>
          ) : (
            <span className="text-xs text-slate-400">Sin asiento</span>
          ),
      },
      {
        id: 'importe',
        header: 'Importe',
        meta: { numerico: true, ancho: '150px' },
        accessorFn: (m) => Number(m.importe),
        cell: ({ row }) => (
          <MoneyCell
            valor={row.original.importe}
            moneda={cuenta?.moneda ?? 'CRC'}
          />
        ),
      },
      {
        accessorKey: 'estado',
        header: 'Conciliación',
        meta: { ancho: '120px' },
        cell: ({ row }) => <EstadoBadge estado={row.original.estado} />,
      },
    ],
    [cuenta?.moneda],
  )

  return (
    <div>
      <PageHeader
        titulo="Movimientos bancarios"
        descripcion="Lo que registró la empresa. Los cobros y los pagos llegan de sus módulos; las comisiones, los intereses y los traspasos nacen aquí."
        acciones={
          <LinkBoton
            to={
              cuentaId
                ? `/bancos/movimientos/nuevo?cuenta=${cuentaId}`
                : '/bancos/movimientos/nuevo'
            }
            variante="primario"
            icono={<Plus className="size-4" />}
          >
            Registrar movimiento
          </LinkBoton>
        }
      />

      <Card className="mb-4">
        <div className="grid gap-4 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Cuenta bancaria">
            {(p) => (
              <Select
                {...p}
                value={cuentaId}
                // Sin `replace`: cada cuenta es una entrada del historial, que
                // es lo que permite que atrás devuelva a la anterior.
                onChange={(e) =>
                  setParametros(e.target.value ? { cuenta: e.target.value } : {})
                }
              >
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} · {c.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {cuenta && (
            <>
              <div className="flex flex-col justify-center">
                <span className="text-[11px] text-slate-500">
                  Saldo en libros
                </span>
                <span className="text-lg font-semibold text-slate-900">
                  <MoneyCell
                    valor={cuenta.saldoLibros}
                    moneda={cuenta.moneda}
                    mostrarSimbolo
                  />
                </span>
              </div>
              <div className="flex flex-col justify-center">
                <span className="text-[11px] text-slate-500">
                  Último saldo del banco
                </span>
                <span className="text-sm text-slate-700">
                  {cuenta.saldoBanco === null ? (
                    // No es un dato que la empresa pueda inventar: aparece
                    // cuando se importa el primer estado de cuenta.
                    <span className="text-slate-400">
                      Sin estado de cuenta importado
                    </span>
                  ) : (
                    <>
                      <MoneyCell
                        valor={cuenta.saldoBanco}
                        moneda={cuenta.moneda}
                        mostrarSimbolo
                      />{' '}
                      <span className="text-xs text-slate-500">
                        al {formatFecha(cuenta.saldoBancoAl)}
                      </span>
                    </>
                  )}
                </span>
              </div>
              <div className="flex flex-col justify-center">
                <span className="text-[11px] text-slate-500">Sin conciliar</span>
                <span className="text-sm text-slate-700">
                  {cuenta.movimientosSinConciliar} de {cuenta.movimientos}{' '}
                  movimientos
                </span>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          titulo={cuenta ? `${cuenta.codigo} · ${cuenta.nombre}` : 'Movimientos'}
          descripcion="De lo más reciente a lo más antiguo. El importe lleva signo: positivo lo que entró, negativo lo que salió."
          acciones={
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar concepto o referencia"
              aria-label="Buscar movimiento"
              className="h-8 w-56 rounded-md border border-slate-300 px-2 text-sm"
            />
          }
        />
        {consultaCuentas.error && cuentas.length === 0 ? (
          <EstadoError
            titulo="No se pudieron cargar las cuentas bancarias"
            error={consultaCuentas.error}
            onReintentar={() => void consultaCuentas.refetch()}
            reintentando={consultaCuentas.isFetching}
          />
        ) : (
          <DataTable
            columns={columnas}
            data={movimientos}
            filtro={filtro}
            cargando={consulta.isLoading || consultaCuentas.isLoading}
            error={consulta.error}
            onReintentar={() => void consulta.refetch()}
            vacio={{
              titulo: 'Sin movimientos',
              descripcion:
                'Esta cuenta no tiene movimientos registrados todavía.',
            }}
          />
        )}
      </Card>
    </div>
  )
}
