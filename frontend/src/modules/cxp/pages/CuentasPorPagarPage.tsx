import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import Decimal from 'decimal.js'
import { Banknote, Plus } from 'lucide-react'
import { LinkBoton } from '@/shared/ui/LinkBoton'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Field'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import {
  CUBETAS,
  ETIQUETAS_CUBETA,
  diasVencidos,
} from '@/shared/cartera/antiguedad'
import { monedaFuncional } from '@/shared/money/money'
import type { FacturaCompra, FilaAntiguedadCxp } from '@/shared/api/contracts/cxp'
import { useAntiguedadCxp, useFacturasCompra } from '../api/queries'

/**
 * Cuentas por pagar y antigüedad de saldos (docs/05 §5).
 *
 * Misma lógica y misma verificación de integridad que en CxC: el total a la
 * fecha de corte debe ser el saldo de la cuenta de control en el mayor.
 */
export function CuentasPorPagarPage() {
  const [parametros, setParametros] = useSearchParams()
  const corte = parametros.get('corte') ?? hoyISO()

  const setCorte = (valor: string) => {
    const nuevos = new URLSearchParams(parametros)
    if (valor) nuevos.set('corte', valor)
    else nuevos.delete('corte')
    setParametros(nuevos, { replace: true })
  }

  const {
    data: antiguedad,
    isLoading,
    error: errorAntiguedad,
    refetch: releerAntiguedad,
  } = useAntiguedadCxp(corte)
  const {
    data: facturas = [],
    isLoading: cargandoFacturas,
    error: errorFacturas,
    refetch: releerFacturas,
  } = useFacturasCompra()

  /**
   * Las facturas con saldo que ya existían al corte.
   *
   * Una registrada después del corte no se debía ese día: listarla con un
   * corte pasado contradiría la antigüedad de arriba, que sí la excluye. El
   * saldo, en cambio, es el de hoy: el documento no guarda su saldo a cada
   * fecha, y la descripción de la tarjeta lo advierte.
   */
  const pendientes = useMemo(
    () =>
      facturas
        .filter(
          (f) =>
            f.estado === 'contabilizada' &&
            f.fechaEmision <= corte &&
            new Decimal(f.saldo).greaterThan(0),
        )
        .sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento)),
    [facturas, corte],
  )
  const corteEsHoy = corte >= hoyISO()

  const columnasAntiguedad = useMemo<ColumnDef<FilaAntiguedadCxp, unknown>[]>(
    () => [
      { accessorKey: 'proveedorNombre', header: 'Proveedor' },
      ...CUBETAS.map((cubeta) => ({
        id: cubeta,
        header: ETIQUETAS_CUBETA[cubeta],
        meta: { numerico: true, ancho: '120px' },
        accessorFn: (fila: FilaAntiguedadCxp) => fila[cubeta],
        cell: ({ row }: { row: { original: FilaAntiguedadCxp } }) => (
          <MoneyCell valor={row.original[cubeta]} ocultarCero />
        ),
      })),
      {
        id: 'total',
        header: 'Total',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (fila: FilaAntiguedadCxp) => fila.total,
        cell: ({ row }) => (
          <span className="font-medium">
            <MoneyCell valor={row.original.total} />
          </span>
        ),
      },
    ],
    [],
  )

  const columnasFacturas = useMemo<ColumnDef<FacturaCompra, unknown>[]>(
    () => [
      {
        accessorKey: 'folioProveedor',
        header: 'Folio',
        meta: { ancho: '110px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-700">
            {row.original.folioProveedor}
          </span>
        ),
      },
      { accessorKey: 'proveedorNombre', header: 'Proveedor' },
      {
        accessorKey: 'fechaVencimiento',
        header: 'Vence',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fechaVencimiento),
      },
      {
        id: 'dias',
        header: 'Días',
        meta: { numerico: true, ancho: '90px' },
        accessorFn: (f) => diasVencidos(f.fechaVencimiento, corte),
        // "31 vencidos" junto a un badge que ya dice "Vencido" es la misma
        // frase dos veces. La columna deja el número, que es lo que el badge
        // no puede dar; el badge deja la palabra.
        cell: ({ row }) => {
          const dias = diasVencidos(row.original.fechaVencimiento, corte)
          return (
            <span
              className={
                dias > 0
                  ? 'text-xs font-medium text-red-600'
                  : 'text-xs text-slate-400'
              }
              title={dias > 0 ? 'Días vencidos' : 'Días por vencer'}
            >
              {dias > 0 ? dias : -dias}
            </span>
          )
        },
      },
      {
        id: 'saldo',
        header: 'Por pagar',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (f) => f.saldo,
        cell: ({ row }) => (
          <MoneyCell valor={row.original.saldo} moneda={row.original.moneda} />
        ),
      },
      {
        id: 'estadoPago',
        header: 'Estado',
        meta: { ancho: '120px' },
        accessorFn: (f) => f.estado,
        cell: ({ row }) => (
          <EstadoBadge
            estado={
              diasVencidos(row.original.fechaVencimiento, corte) > 0
                ? 'vencido'
                : 'pendiente'
            }
          />
        ),
      },
    ],
    [corte],
  )

  return (
    <div>
      <PageHeader
        titulo="Cuentas por pagar"
        descripcion="Lo que se les debe a los proveedores, a la fecha de corte. Su total debe coincidir con el saldo de la cuenta de control en el mayor."
        acciones={
          <>
            <LinkBoton to="/cxp/propuesta">Propuesta de pago</LinkBoton>
            <LinkBoton
              to="/cxp/pagos/nuevo"
              icono={<Banknote className="size-4" />}
            >
              Nuevo pago
            </LinkBoton>
            <LinkBoton
              to="/cxp/facturas/nueva"
              variante="primario"
              icono={<Plus className="size-4" />}
            >
              Nueva factura
            </LinkBoton>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            Fecha de corte
          </span>
          <Input
            type="date"
            value={corte}
            onChange={(e) => setCorte(e.target.value)}
            className="w-44"
          />
        </label>

        <div className="flex gap-3">
          <Resumen
            titulo="Total por pagar"
            valor={antiguedad?.totales.total}
          />
          <Resumen
            titulo="Vencido"
            valor={
              antiguedad
                ? CUBETAS.filter((c) => c !== 'porVencer')
                    .reduce(
                      (acc, c) => acc.plus(new Decimal(antiguedad.totales[c])),
                      new Decimal(0),
                    )
                    .toFixed(2)
                : undefined
            }
            alerta
          />
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader
          titulo="Antigüedad de saldos"
          descripcion={`Al ${formatFecha(corte)}, expresada en ${monedaFuncional()}`}
        />
        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Calculando antigüedad…
          </p>
        ) : (
          <DataTable
            columns={columnasAntiguedad}
            data={antiguedad?.filas ?? []}
            error={errorAntiguedad}
            onReintentar={() => void releerAntiguedad()}
            vacio={{
              titulo: 'Sin saldos pendientes',
              descripcion: 'No se le debe nada a ningún proveedor a esta fecha.',
            }}
            pie={
              antiguedad && antiguedad.filas.length > 0 ? (
                <tr>
                  <td className="px-3 py-2 text-xs">Totales</td>
                  {CUBETAS.map((cubeta) => (
                    <td key={cubeta} className="tabular px-3 py-2 text-right">
                      <MoneyCell valor={antiguedad.totales[cubeta]} ocultarCero />
                    </td>
                  ))}
                  <td className="tabular px-3 py-2 text-right">
                    <MoneyCell valor={antiguedad.totales.total} />
                  </td>
                </tr>
              ) : undefined
            }
          />
        )}
      </Card>

      <Card>
        <CardHeader
          titulo="Facturas pendientes"
          descripcion={
            corteEsHoy
              ? 'Documento a documento, ordenadas por vencimiento. Es la base de la propuesta de pago.'
              : `Las registradas hasta el ${formatFecha(corte)}, ordenadas por vencimiento. El saldo es el de hoy: los pagos posteriores al corte ya están descontados, y una factura pagada después no aparece.`
          }
        />
        <DataTable
          columns={columnasFacturas}
          data={pendientes}
          cargando={cargandoFacturas}
          error={errorFacturas}
          onReintentar={() => void releerFacturas()}
          vacio={{
            titulo: 'Sin facturas pendientes',
            descripcion: 'Todo lo registrado está pagado.',
          }}
        />
      </Card>
    </div>
  )
}

function Resumen({
  titulo,
  valor,
  alerta,
}: {
  titulo: string
  /** Sin valor mientras carga o si la consulta falló: nunca un cero falso. */
  valor: string | undefined
  alerta?: boolean
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <p className="text-[11px] text-slate-500">{titulo}</p>
      <p
        className={`text-lg font-semibold ${alerta ? 'text-red-600' : 'text-slate-900'}`}
      >
        <MoneyCell valor={valor} mostrarSimbolo />
      </p>
    </div>
  )
}
