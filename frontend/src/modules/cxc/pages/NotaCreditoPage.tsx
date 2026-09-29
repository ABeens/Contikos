import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { FileMinus } from 'lucide-react'
import Decimal from 'decimal.js'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { useAvisoSalida } from '@/shared/ui/AvisoSalida'
import { ResumenErrores } from '@/shared/ui/ResumenErrores'
import { AsientoPropuesto } from '@/shared/asiento/AsientoPropuesto'
import { useCuentas, usePeriodos } from '@/shared/api/catalogos'
import type { SolicitudAsiento } from '@/shared/api/contracts/conta'
import type {
  MotivoNotaCredito,
  SolicitudNotaCredito,
} from '@/shared/api/contracts/cxc'
import {
  disponiblePorLinea,
  lineasAsientoNotaCredito,
  validarNotaCredito,
} from '../domain/notaCredito'
import { MAPEO_VACIO } from '../domain/mapeo'
import {
  useEmitirNotaCredito,
  useFacturaVenta,
  useMapeoCxc,
  useNotasCredito,
} from '../api/queries'

const MOTIVOS: { valor: MotivoNotaCredito; etiqueta: string }[] = [
  { valor: 'devolucion', etiqueta: 'Devolución de mercancía' },
  { valor: 'descuento', etiqueta: 'Descuento posterior a la venta' },
  { valor: 'correccion', etiqueta: 'Corrección de la factura' },
]

/**
 * Emisión de una nota de crédito sobre una factura (docs/04 §2.3).
 *
 *   elegir cantidades por línea → ver el asiento → emitir
 *
 * Se llega desde el detalle de la factura. Las líneas son las de la factura con
 * lo que queda por acreditar de cada una: la nota se captura por cantidad y el
 * importe sale del precio neto original, que es lo que la hace una nota de
 * crédito y no una venta negativa con otro precio.
 */
export function NotaCreditoPage() {
  const navegar = useNavigate()
  const [parametros] = useSearchParams()
  const facturaId = parametros.get('factura') ?? ''

  const consultaFactura = useFacturaVenta(facturaId || undefined)
  const { data: previas = [] } = useNotasCredito(facturaId || undefined)
  const { data: periodos = [] } = usePeriodos()
  const { data: cuentas = [] } = useCuentas()
  const { data: mapeo = MAPEO_VACIO } = useMapeoCxc()
  const emitir = useEmitirNotaCredito()

  const factura = consultaFactura.data

  const [fecha, setFecha] = useState(hoyISO)
  const [motivo, setMotivo] = useState<MotivoNotaCredito>('devolucion')
  const [detalle, setDetalle] = useState('')
  /** Cantidad a acreditar por línea de la factura, como se teclea. */
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [intentoEnvio, setIntentoEnvio] = useState(false)
  const [fallos, setFallos] = useState(0)

  const disponible = useMemo(
    () => (factura ? disponiblePorLinea(factura, previas) : new Map()),
    [factura, previas],
  )

  const solicitud: SolicitudNotaCredito = {
    facturaId,
    fecha,
    motivo,
    detalle,
    lineas: Object.entries(cantidades)
      .filter(([, cantidad]) => cantidad.trim() !== '' && Number(cantidad) !== 0)
      .map(([lineaFacturaId, cantidad]) => ({ lineaFacturaId, cantidad: cantidad.trim() })),
  }

  const calculo = validarNotaCredito(solicitud, {
    factura,
    notasPrevias: previas,
    periodos,
  })
  const errores = [
    ...(solicitud.lineas.length === 0
      ? ['Indique qué cantidad se acredita de al menos una línea']
      : []),
    ...calculo.errores.map((e) => e.mensaje),
  ]

  const asiento: SolicitudAsiento | null =
    factura && calculo.lineas.length > 0
      ? {
          fecha,
          concepto: `Nota de crédito sobre ${factura.numeroInterno}`,
          moneda: factura.moneda,
          tipoCambio: factura.tipoCambio,
          lineas: lineasAsientoNotaCredito(factura, calculo, mapeo),
        }
      : null

  const sucio = Object.keys(cantidades).length > 0 || detalle !== ''
  const { aviso, permitirSalida } = useAvisoSalida(sucio && !emitir.isSuccess)

  const enviar = () => {
    setIntentoEnvio(true)
    if (errores.length > 0 || emitir.isPending) {
      setFallos((n) => n + 1)
      return
    }
    emitir.mutate(solicitud, {
      onSuccess: () => {
        permitirSalida()
        navegar(`/cxc/facturas/${encodeURIComponent(facturaId)}`)
      },
      onError: () => setFallos((n) => n + 1),
    })
  }

  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? codigo

  if (consultaFactura.isError) {
    return (
      <EstadoError
        error={consultaFactura.error}
        onReintentar={() => void consultaFactura.refetch()}
      />
    )
  }
  if (consultaFactura.isLoading) {
    return <p className="py-10 text-center text-sm text-slate-500">Cargando la factura…</p>
  }
  if (!factura) {
    return (
      <div>
        <PageHeader titulo="Nota de crédito" />
        <Card>
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            La nota de crédito se emite desde una factura.{' '}
            <Link to="/cxc/facturas" className="font-medium text-brand-700 underline">
              Elija la factura
            </Link>{' '}
            y use «Nota de crédito» en su detalle.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div>
      {aviso}
      <PageHeader
        titulo={`Nota de crédito sobre ${factura.numeroInterno}`}
        descripcion={`${factura.clienteNombre} · emitida el ${formatFecha(factura.fechaEmision)} · saldo por cobrar ${new Decimal(factura.saldo).toFixed(2)} ${factura.moneda}`}
      />

      <Card>
        <div className="grid gap-4 px-4 py-3 sm:grid-cols-3">
          <Field label="Fecha" requerido>
            {(p) => (
              <Input {...p} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            )}
          </Field>
          <Field label="Motivo" requerido>
            {(p) => (
              <Select
                {...p}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value as MotivoNotaCredito)}
              >
                {MOTIVOS.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.etiqueta}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Detalle" requerido ayuda="Queda en el comprobante">
            {(p) => (
              <Input
                {...p}
                value={detalle}
                placeholder="Qué se devolvió o por qué se descuenta"
                onChange={(e) => setDetalle(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader
          titulo="Qué se acredita"
          descripcion="Por cantidad, al precio neto de la línea original. Lo ya acreditado por notas anteriores no se puede volver a acreditar."
        />
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Línea de la factura</th>
              <th className="w-28 px-3 py-2 text-right">Facturada</th>
              <th className="w-28 px-3 py-2 text-right">Disponible</th>
              <th className="w-32 px-3 py-2 text-right">A acreditar</th>
              <th className="w-36 px-4 py-2 text-right">Total acreditado</th>
            </tr>
          </thead>
          <tbody>
            {factura.lineas.map((linea) => {
              const resto = disponible.get(linea.id)
              const calculada = calculo.lineas.find((l) => l.lineaFacturaId === linea.id)
              return (
                <tr key={linea.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-1.5 text-slate-700">{linea.descripcion}</td>
                  <td className="tabular px-3 py-1.5 text-right text-slate-600">{linea.cantidad}</td>
                  <td className="tabular px-3 py-1.5 text-right text-slate-600">
                    {resto?.cantidad.toString() ?? '0'}
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      aria-label={`Cantidad a acreditar de ${linea.descripcion}`}
                      inputMode="decimal"
                      className="tabular h-8 text-right"
                      value={cantidades[linea.id] ?? ''}
                      placeholder="0"
                      disabled={!resto || resto.cantidad.isZero()}
                      onChange={(e) =>
                        setCantidades((prev) => ({ ...prev, [linea.id]: e.target.value }))
                      }
                    />
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <MoneyCell valor={calculada?.total.toFixed(2) ?? null} moneda={factura.moneda} />
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-slate-50 text-slate-800">
            <tr>
              <td colSpan={4} className="px-4 py-1.5 text-right text-xs">
                Subtotal
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell valor={calculo.subtotal.toFixed(2)} moneda={factura.moneda} />
              </td>
            </tr>
            <tr>
              <td colSpan={4} className="px-4 py-1.5 text-right text-xs">
                IVA
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell valor={calculo.impuesto.toFixed(2)} moneda={factura.moneda} />
              </td>
            </tr>
            <tr className="font-semibold">
              <td colSpan={4} className="px-4 py-1.5 text-right text-xs">
                Total de la nota
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell valor={calculo.total.toFixed(2)} moneda={factura.moneda} />
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>

      <Card className="mt-4">
        <CardHeader
          titulo="Asiento que se va a generar"
          descripcion="El inverso del de la factura por la parte acreditada."
        />
        {asiento ? (
          <AsientoPropuesto asiento={asiento} nombreCuenta={nombreCuenta} />
        ) : (
          <p className="px-4 py-6 text-center text-sm text-slate-500">
            Indique qué se acredita para ver el asiento.
          </p>
        )}
      </Card>

      <div className="mt-4 flex justify-end">
        <Button
          variante="primario"
          icono={<FileMinus className="size-4" />}
          onClick={enviar}
          disabled={emitir.isPending}
        >
          {emitir.isPending ? 'Emitiendo…' : 'Emitir nota de crédito'}
        </Button>
      </div>

      <ResumenErrores
        titulo="La nota de crédito no se puede emitir"
        errores={intentoEnvio ? errores : []}
        errorServidor={emitir.error}
        senal={fallos}
      />
    </div>
  )
}
