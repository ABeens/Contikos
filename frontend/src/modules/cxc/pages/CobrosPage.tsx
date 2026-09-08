import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Ban, Plus, Search } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Field'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { PanelAsiento } from '@/shared/asiento/PanelAsiento'
import { formatFecha } from '@/shared/format/fecha'
import { monedaFuncional } from '@/shared/money/money'
import { MEDIOS_PAGO } from '@/shared/api/contracts/terceros'
import type { Cobro } from '@/shared/api/contracts/cxc'
import { useAsientoDeCobro, useCobros } from '../api/queries'
import { DialogoAnularCobro } from '../components/DialogoAnularCobro'

/** Nombre del medio de pago según el catálogo de Hacienda. */
function nombreMedio(codigo: string): string {
  return MEDIOS_PAGO.find((m) => m.codigo === codigo)?.nombre ?? codigo
}

/**
 * Cobros registrados y su asiento (docs/04 §2.2).
 *
 * El detalle enseña las tres cosas juntas: el documento, a qué facturas se
 * aplicó y el asiento que movió el mayor. Es la forma de comprobar sin salir
 * del módulo que lo que bajó del auxiliar es lo que se abonó a la cuenta de
 * control, que es la verificación de integridad de docs/04 §3.
 *
 * Cuál está abierto vive en la URL (`/cxc/cobros/:id`) y no en un estado local,
 * igual que en el listado de facturas: así el detalle se puede enviar por
 * enlace y el botón de atrás devuelve al listado (docs/14 §6).
 */
export function CobrosPage() {
  const { data: cobros = [], isLoading } = useCobros()
  const navegar = useNavigate()
  const { id } = useParams()
  const [filtro, setFiltro] = useState('')

  const seleccionado = cobros.find((c) => c.id === id) ?? null

  const columnas = useMemo<ColumnDef<Cobro, unknown>[]>(
    () => [
      {
        accessorKey: 'numero',
        header: 'Cobro',
        meta: { ancho: '120px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs font-medium text-slate-700">
            {row.original.numero}
          </span>
        ),
      },
      {
        accessorKey: 'fecha',
        header: 'Fecha',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fecha),
      },
      { accessorKey: 'clienteNombre', header: 'Cliente' },
      {
        id: 'medio',
        header: 'Medio',
        meta: { ancho: '130px' },
        accessorFn: (c) => nombreMedio(c.medio),
      },
      {
        accessorKey: 'referencia',
        header: 'Referencia',
        meta: { ancho: '140px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-500">
            {row.original.referencia ?? ''}
          </span>
        ),
      },
      {
        id: 'importeRecibido',
        header: 'Recibido',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (c) => c.importeRecibido,
        cell: ({ row }) => (
          <MoneyCell
            valor={row.original.importeRecibido}
            moneda={row.original.moneda}
          />
        ),
      },
      {
        id: 'importeSinAplicar',
        header: 'Anticipo',
        meta: { numerico: true, ancho: '130px' },
        accessorFn: (c) => c.importeSinAplicar,
        cell: ({ row }) => (
          <MoneyCell
            valor={row.original.importeSinAplicar}
            moneda={row.original.moneda}
            ocultarCero
          />
        ),
      },
      {
        accessorKey: 'estado',
        header: 'Estado',
        meta: { ancho: '120px' },
        cell: ({ row }) => <EstadoBadge estado={row.original.estado} />,
      },
    ],
    [],
  )

  return (
    <div>
      <PageHeader
        titulo="Cobros"
        descripcion="Lo que los clientes han pagado, a qué facturas se aplicó y el asiento que lo contabilizó."
        acciones={
          <Link to="/cxc/cobros/nuevo">
            <Button variante="primario" icono={<Plus className="size-4" />}>
              Registrar cobro
            </Button>
          </Link>
        }
      />

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search className="size-4 text-slate-400" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por número, cliente o referencia…"
            className="h-8 max-w-sm border-0 px-0 focus:ring-0"
          />
          <span className="ml-auto text-xs text-slate-500">
            {cobros.length} cobros
          </span>
        </div>

        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Cargando cobros…
          </p>
        ) : (
          <DataTable
            columns={columnas}
            data={cobros}
            filtro={filtro}
            onRowClick={(c) => navegar(`/cxc/cobros/${c.id}`)}
            vacio={{
              titulo: 'Sin cobros registrados',
              descripcion:
                'Registre el primero para bajar el saldo de una factura.',
            }}
          />
        )}
      </Card>

      {seleccionado && (
        <DetalleCobro
          cobro={seleccionado}
          onCerrar={() => navegar('/cxc/cobros')}
        />
      )}
    </div>
  )
}

function DetalleCobro({
  cobro,
  onCerrar,
}: {
  cobro: Cobro
  onCerrar: () => void
}) {
  const { data: asiento, isLoading } = useAsientoDeCobro(cobro.id)
  const [anulando, setAnulando] = useState(false)
  const funcional = monedaFuncional()

  return (
    <>
      <Card className="mt-4">
        <CardHeader
          titulo={`Cobro ${cobro.numero}`}
          descripcion={`${cobro.clienteNombre} · ${nombreMedio(cobro.medio)} el ${formatFecha(cobro.fecha)}`}
          acciones={
            <>
              {cobro.estado === 'contabilizado' && (
                <Button
                  tamano="sm"
                  variante="peligro"
                  icono={<Ban className="size-3.5" />}
                  onClick={() => setAnulando(true)}
                >
                  Anular
                </Button>
              )}
              <Button tamano="sm" onClick={onCerrar}>
                Cerrar
              </Button>
            </>
          }
        />

        <dl className="grid grid-cols-1 gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-3 sm:grid-cols-4">
          <Dato titulo="Recibido">
            <MoneyCell valor={cobro.importeRecibido} moneda={cobro.moneda} />
          </Dato>
          <Dato titulo="Aplicado a facturas">
            <MoneyCell valor={cobro.importeAplicado} moneda={cobro.moneda} />
          </Dato>
          <Dato
            titulo="Anticipo"
            ayuda={
              Number(cobro.importeSinAplicar) > 0
                ? 'Pasivo con el cliente hasta que se aplique'
                : undefined
            }
          >
            <MoneyCell valor={cobro.importeSinAplicar} moneda={cobro.moneda} />
          </Dato>
          <Dato
            titulo="Cuenta de depósito"
            ayuda={cobro.auxiliarBanco ?? undefined}
          >
            {cobro.cuentaDeposito}
          </Dato>
        </dl>

        {cobro.estado === 'anulado' && (
          <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            Anulado el {formatFecha(cobro.anuladoEn)}: {cobro.motivoAnulacion}.
            El saldo volvió a las facturas y el asiento quedó reversado.
          </p>
        )}

        <table className="w-full text-sm" aria-label="Aplicaciones del cobro">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Factura</th>
              <th className="px-3 py-2 text-right">Aplicado</th>
              <th className="px-3 py-2 text-right">Saldo resultante</th>
              <th className="w-40 px-4 py-2 text-right">
                Diferencia cambiaria
              </th>
            </tr>
          </thead>
          <tbody>
            {cobro.aplicaciones.map((aplicacion) => (
              <tr
                key={aplicacion.facturaId}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="px-4 py-1.5">
                  <Link
                    to={`/cxc/facturas/${aplicacion.facturaId}`}
                    className="font-mono text-xs font-medium text-brand-700 hover:underline"
                  >
                    {aplicacion.facturaNumero}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <MoneyCell
                    valor={aplicacion.importeAplicado}
                    moneda={cobro.moneda}
                  />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <MoneyCell
                    valor={aplicacion.saldoResultante}
                    moneda={cobro.moneda}
                  />
                </td>
                <td className="px-4 py-1.5 text-right">
                  <MoneyCell
                    valor={aplicacion.diferenciaCambiaria}
                    moneda={funcional}
                    ocultarCero
                  />
                </td>
              </tr>
            ))}
            {cobro.aplicaciones.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  El cobro no se aplicó a ninguna factura: quedó entero como
                  anticipo del cliente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="mt-4">
        <CardHeader titulo="Asiento generado" />
        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Cargando asiento…
          </p>
        ) : asiento ? (
          <PanelAsiento asiento={asiento} />
        ) : (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            El cobro no tiene asiento asociado.
          </p>
        )}
      </Card>

      {anulando && (
        <DialogoAnularCobro
          cobro={cobro}
          abierto={anulando}
          onCerrar={() => setAnulando(false)}
        />
      )}
    </>
  )
}

/** Celda de la cabecera del documento: rótulo, valor y por qué está ahí. */
function Dato({
  titulo,
  ayuda,
  children,
}: {
  titulo: string
  ayuda?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-slate-500">{titulo}</dt>
      <dd className="font-mono text-xs text-slate-800">{children}</dd>
      {ayuda && <p className="text-[11px] text-slate-400">{ayuda}</p>}
    </div>
  )
}
