import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, TriangleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { useCuentas } from '@/shared/api/catalogos'
import type { CuentaBancaria } from '@/shared/api/contracts/bancos'
import { useCuentasBancarias, usePosicionTesoreria } from '../api/queries'
import { etiquetaTipoCuenta } from '../domain/cuentaBancaria'
import { DialogoCuentaBancaria } from '../components/DialogoCuentaBancaria'

/**
 * Catálogo de cuentas bancarias y posición de tesorería (docs/06 §1 y §4).
 *
 * Es la primera pantalla del módulo porque es la que lo hace posible: hasta que
 * existe este catálogo, el auxiliar `banco` de las cuentas de control del mayor
 * no tiene contra qué resolverse, y cobros y pagos tienen que derivar el
 * auxiliar de la posición de la cuenta en el plan.
 *
 * La posición va arriba y el catálogo abajo a propósito. Quien abre tesorería
 * pregunta primero cuánto hay y solo después con qué cuentas; enseñar el
 * catálogo sin los saldos convierte la pantalla en una pantalla de
 * configuración, que es lo que se consulta una vez al año.
 */
export function CuentasBancariasPage() {
  const { data: cuentasBancarias = [], isLoading } = useCuentasBancarias()
  const { data: posicion } = usePosicionTesoreria()
  const { data: cuentas = [] } = useCuentas()
  const [editando, setEditando] = useState<CuentaBancaria | null>(null)
  const [creando, setCreando] = useState(false)

  const columnas = useMemo<ColumnDef<CuentaBancaria, unknown>[]>(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Código',
        meta: { ancho: '100px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.codigo}</span>
        ),
      },
      {
        accessorKey: 'nombre',
        header: 'Cuenta',
        cell: ({ row }) => (
          <div>
            <p className="text-slate-800">{row.original.nombre}</p>
            <p className="text-xs text-slate-500">
              {row.original.banco} · {row.original.numeroCuenta}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'tipo',
        header: 'Tipo',
        meta: { ancho: '140px' },
        cell: ({ row }) => etiquetaTipoCuenta(row.original.tipo),
      },
      {
        accessorKey: 'moneda',
        header: 'Moneda',
        meta: { ancho: '80px' },
      },
      {
        id: 'control',
        header: 'Cuenta de control',
        accessorFn: (c) => `${c.cuentaContable} ${c.cuentaContableNombre}`,
        cell: ({ row }) => (
          <div className="text-xs">
            <span className="font-mono text-slate-600">
              {row.original.cuentaContable}
            </span>
            <p className="text-slate-500">{row.original.cuentaContableNombre}</p>
          </div>
        ),
      },
      {
        id: 'saldoLibros',
        header: 'Saldo en libros',
        meta: { numerico: true, ancho: '150px' },
        accessorFn: (c) => Number(c.saldoLibros),
        cell: ({ row }) => (
          <MoneyCell
            valor={row.original.saldoLibros}
            moneda={row.original.moneda}
          />
        ),
      },
      {
        id: 'sinConciliar',
        header: 'Sin conciliar',
        meta: { numerico: true, ancho: '120px' },
        accessorFn: (c) => c.movimientosSinConciliar,
        cell: ({ row }) =>
          row.original.movimientosSinConciliar === 0 ? (
            <span className="text-xs text-slate-400">Al día</span>
          ) : (
            <span className="tabular text-amber-700">
              {row.original.movimientosSinConciliar}
            </span>
          ),
      },
      {
        accessorKey: 'activa',
        header: 'Estado',
        meta: { ancho: '90px' },
        cell: ({ row }) => (
          <EstadoBadge estado={row.original.activa ? 'activo' : 'inactivo'} />
        ),
      },
    ],
    [],
  )

  return (
    <div>
      <PageHeader
        titulo="Tesorería"
        descripcion="Dónde está el dinero y con qué cuenta del mayor se corresponde cada saldo."
        acciones={
          <Button
            variante="primario"
            icono={<Plus className="size-4" />}
            onClick={() => setCreando(true)}
          >
            Nueva cuenta bancaria
          </Button>
        }
      />

      {posicion && posicion.cuentas.length > 0 && (
        <Card className="mb-4">
          <CardHeader
            titulo="Posición de tesorería"
            descripcion={`Saldos de hoy, convertidos a ${posicion.moneda} con el tipo de cambio de referencia del catálogo.`}
          />
          <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            {posicion.cuentas.map((c) => (
              <div key={c.cuentaBancariaId} className="bg-white px-4 py-3">
                <p className="text-xs text-slate-500">{c.nombre}</p>
                <p className="mt-0.5 text-lg font-semibold text-slate-900">
                  <MoneyCell valor={c.saldoLibros} moneda={c.moneda} mostrarSimbolo />
                </p>
                {c.moneda !== posicion.moneda && (
                  <p className="text-[11px] text-slate-400">
                    <MoneyCell valor={c.saldoFuncional} moneda={posicion.moneda} />{' '}
                    al {c.tipoCambio}
                  </p>
                )}
              </div>
            ))}
            <div className="bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">Total del grupo</p>
              <p className="mt-0.5 text-lg font-semibold text-slate-900">
                <MoneyCell
                  valor={posicion.total}
                  moneda={posicion.moneda}
                  mostrarSimbolo
                />
              </p>
              {posicion.totalSinConciliar > 0 && (
                <p className="flex items-center gap-1 text-[11px] text-amber-700">
                  <TriangleAlert className="size-3" />
                  {posicion.totalSinConciliar} movimientos sin conciliar
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card>
        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Cargando cuentas bancarias…
          </p>
        ) : (
          <DataTable
            columns={columnas}
            data={cuentasBancarias}
            onRowClick={setEditando}
            vacio={{
              titulo: 'Sin cuentas bancarias',
              descripcion:
                'Dé de alta la primera: mientras no exista, los cobros y los pagos no pueden decir a qué cuenta entró o salió el dinero.',
            }}
          />
        )}
      </Card>

      {(creando || editando) && (
        <DialogoCuentaBancaria
          key={editando?.id ?? 'nueva'}
          abierto
          cuenta={editando ?? undefined}
          cuentasBancarias={cuentasBancarias}
          cuentas={cuentas}
          onCerrar={() => {
            setCreando(false)
            setEditando(null)
          }}
        />
      )}
    </div>
  )
}
