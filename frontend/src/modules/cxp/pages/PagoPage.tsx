import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import Decimal from 'decimal.js'
import { Banknote, CircleAlert, ListOrdered } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatMoney } from '@/shared/money/format'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { diasVencidos } from '@/shared/cartera/antiguedad'
import { ApiError } from '@/shared/api/client'
import { useCuentas, usePeriodos } from '@/shared/api/catalogos'
import {
  configuracionMoneda,
  monedaFuncional,
  monedasActivas,
  Money,
  type Moneda,
} from '@/shared/money/money'
import {
  MEDIOS_PAGO,
  type MedioPago,
  type SolicitudPago,
} from '@/shared/api/contracts/cxp'
import {
  useFacturasCompra,
  useMapeoCxp,
  useProveedores,
  useRegistrarPago,
} from '../api/queries'
import {
  admitePago,
  armarAsientoPago,
  calcularPago,
  cuentasDePago,
  ordenarPorVencimiento,
  repartirPorAntiguedad,
  saldoDe,
  type ContextoPago,
} from '../domain/pago'

/**
 * Captura de un pago a proveedor (docs/05 §2.2).
 *
 * Se elige el proveedor, se ven sus facturas con saldo ordenadas por
 * vencimiento y se reparte el importe entre ellas. Lo aplicado y el anticipo se
 * ven en vivo, y el asiento se enseña antes de confirmar: quien paga tiene que
 * poder comprobar contra qué se está aplicando su egreso ANTES de que entre al
 * mayor, no después.
 *
 * El botón de repartir por antigüedad es lo que se hace a mano en cualquier
 * tesorería: lo más viejo primero. Se puede corregir factura por factura, que
 * es lo que hace falta cuando hay una en disputa.
 */

const ETIQUETA_MEDIO: Record<MedioPago, string> = {
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
}

export function PagoPage() {
  const navegar = useNavigate()
  const [parametros] = useSearchParams()
  const funcional = monedaFuncional()

  const { data: proveedores = [] } = useProveedores()
  const { data: cuentas = [] } = useCuentas()
  const { data: periodos = [] } = usePeriodos()
  const { data: mapeo } = useMapeoCxp()
  const registrar = useRegistrarPago()

  // `?proveedor=` es la llegada desde la propuesta de pago o desde la ficha
  // del proveedor: quien viene de ahí ya eligió a quién le paga.
  const [proveedorId, setProveedorId] = useState(
    () => parametros.get('proveedor') ?? '',
  )
  const [fecha, setFecha] = useState(hoyISO)
  const [moneda, setMoneda] = useState<Moneda>(funcional)
  const [tipoCambio, setTipoCambio] = useState('1')
  const [cuentaSalida, setCuentaSalida] = useState('')
  const [medioPago, setMedioPago] = useState<MedioPago>('transferencia')
  const [referencia, setReferencia] = useState('')
  const [importe, setImporte] = useState('')
  /** Lo aplicado a cada factura, por id. Vacío = no se le aplica nada. */
  const [aplicado, setAplicado] = useState<Record<string, string>>({})
  const [intentoEnvio, setIntentoEnvio] = useState(false)

  const { data: facturas = [] } = useFacturasCompra(proveedorId || undefined)
  const proveedor = proveedores.find((p) => p.id === proveedorId)
  const opcionesCuenta = useMemo(() => cuentasDePago(cuentas), [cuentas])

  const pendientes = useMemo(
    () => ordenarPorVencimiento(facturas.filter(admitePago)),
    [facturas],
  )

  const solicitud: SolicitudPago = useMemo(
    () => ({
      proveedorId,
      fecha,
      moneda,
      tipoCambio: tipoCambio || '0',
      cuentaSalida,
      medioPago,
      referencia: referencia.trim() || null,
      importe: importe || '0',
      aplicaciones: pendientes
        .filter((f) => new Decimal(aplicado[f.id] || '0').greaterThan(0))
        .map((f) => ({ facturaId: f.id, importe: aplicado[f.id] })),
    }),
    [
      proveedorId,
      fecha,
      moneda,
      tipoCambio,
      cuentaSalida,
      medioPago,
      referencia,
      importe,
      aplicado,
      pendientes,
    ],
  )

  const contexto: ContextoPago = useMemo(
    () => ({
      proveedor,
      facturas,
      cuentas,
      periodos,
      mapeo: mapeo ?? {
        proveedor: '',
        gasto: '',
        impuestoAcreditable: '',
        retencion: '',
        anticipo: '',
        diferencialGanado: '',
        diferencialPerdido: '',
      },
      monedaFuncional: funcional,
    }),
    [proveedor, facturas, cuentas, periodos, mapeo, funcional],
  )

  const calculo = useMemo(
    () => calcularPago(solicitud, contexto),
    [solicitud, contexto],
  )

  const asiento = useMemo(
    () =>
      mapeo && cuentaSalida
        ? armarAsientoPago('', '', solicitud, contexto, calculo)
        : null,
    [mapeo, cuentaSalida, solicitud, contexto, calculo],
  )

  const elegirProveedor = (id: string) => {
    setProveedorId(id)
    setAplicado({})
    const elegido = proveedores.find((p) => p.id === id)
    if (!elegido) return
    setMoneda(elegido.moneda)
    setTipoCambio(
      elegido.moneda === funcional
        ? '1'
        : configuracionMoneda(elegido.moneda).tipoCambio,
    )
  }

  /** Reparte el importe capturado de la factura más vieja a la más nueva. */
  const repartir = () => {
    const reparto = repartirPorAntiguedad(
      pendientes,
      new Money(importe || '0', moneda),
    )
    const nuevo: Record<string, string> = {}
    for (const [facturaId, monto] of reparto) nuevo[facturaId] = monto.toApi()
    setAplicado(nuevo)
  }

  /** El importe que saldaría todo lo pendiente. Atajo del caso más común. */
  const totalPendiente = useMemo(
    () =>
      pendientes
        .filter((f) => f.moneda === moneda)
        .reduce((acc, f) => acc.plus(saldoDe(f)), Money.cero(moneda)),
    [pendientes, moneda],
  )

  const guardar = async () => {
    setIntentoEnvio(true)
    if (!calculo.valido) return
    const pago = await registrar.mutateAsync(solicitud).catch(() => null)
    if (!pago) return
    navegar(`/cxp/pagos/${pago.id}`)
  }

  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? ''

  const errorServidor =
    registrar.error instanceof ApiError ? registrar.error : null

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        titulo="Nuevo pago a proveedor"
        descripcion="Emitirlo contabiliza el egreso y baja el saldo de las facturas a las que se aplica."
        acciones={
          <>
            <Button onClick={() => navegar('/cxp/pagos')}>Cancelar</Button>
            <Button
              variante="primario"
              icono={<Banknote className="size-4" />}
              onClick={() => void guardar()}
              disabled={registrar.isPending}
            >
              {registrar.isPending ? 'Emitiendo…' : 'Emitir pago'}
            </Button>
          </>
        }
      />

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Proveedor" requerido className="lg:col-span-2">
            {(p) => (
              <Select
                {...p}
                value={proveedorId}
                onChange={(e) => elegirProveedor(e.target.value)}
              >
                <option value="">Seleccione un proveedor</option>
                {proveedores
                  .filter((x) => x.activo)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.codigo} · {x.razonSocial}
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          <Field label="Fecha del pago" requerido>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Cuenta de salida"
            requerido
            ayuda="De dónde sale el dinero"
          >
            {(p) => (
              <Select
                {...p}
                value={cuentaSalida}
                onChange={(e) => setCuentaSalida(e.target.value)}
              >
                <option value="">Seleccione la cuenta</option>
                {opcionesCuenta.map((c) => (
                  <option key={c.codigo} value={c.codigo}>
                    {c.codigo} · {c.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Medio de pago" requerido>
            {(p) => (
              <Select
                {...p}
                value={medioPago}
                onChange={(e) => setMedioPago(e.target.value as MedioPago)}
              >
                {MEDIOS_PAGO.map((m) => (
                  <option key={m} value={m}>
                    {ETIQUETA_MEDIO[m]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Referencia" ayuda="Número de transferencia o de cheque">
            {(p) => (
              <Input
                {...p}
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
              />
            )}
          </Field>

          <Field label="Moneda" requerido>
            {(p) => (
              <Select
                {...p}
                value={moneda}
                onChange={(e) => {
                  const nueva = e.target.value
                  setMoneda(nueva)
                  setAplicado({})
                  setTipoCambio(
                    nueva === funcional
                      ? '1'
                      : configuracionMoneda(nueva).tipoCambio,
                  )
                }}
              >
                {monedasActivas().map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.nombre} ({m.codigo})
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Tipo de cambio"
            requerido
            ayuda={
              moneda === funcional
                ? 'Moneda funcional'
                : 'El del día del pago: la diferencia con el de la factura es resultado cambiario'
            }
          >
            {(p) => (
              <Input
                {...p}
                value={tipoCambio}
                disabled={moneda === funcional}
                onChange={(e) => setTipoCambio(e.target.value)}
                className="tabular text-right"
              />
            )}
          </Field>

          <Field label="Importe del pago" requerido>
            {(p) => (
              <MoneyInput
                {...p}
                value={importe}
                moneda={moneda}
                onChange={setImporte}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader
          titulo="Facturas pendientes"
          descripcion="Ordenadas por vencimiento. Se aplica factura por factura, o se reparte lo más viejo primero."
          acciones={
            <>
              <Button
                tamano="sm"
                onClick={() => setImporte(totalPendiente.toApi())}
                disabled={!totalPendiente.esPositivo()}
                title="Pone como importe todo lo que se le debe al proveedor"
              >
                Pagar todo
              </Button>
              <Button
                tamano="sm"
                icono={<ListOrdered className="size-3.5" />}
                onClick={repartir}
                disabled={pendientes.length === 0}
              >
                Repartir por antigüedad
              </Button>
            </>
          }
        />

        {!proveedorId ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Elija un proveedor para ver lo que se le debe.
          </p>
        ) : pendientes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Este proveedor no tiene facturas con saldo. El importe quedará como
            anticipo a su favor.
          </p>
        ) : (
          <table className="w-full text-sm" aria-label="Facturas pendientes">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left">Folio</th>
                <th className="w-28 px-3 py-2 text-left">Vence</th>
                <th className="w-20 px-3 py-2 text-right">Días</th>
                <th className="w-36 px-3 py-2 text-right">Saldo</th>
                <th className="w-40 px-4 py-2 text-right">Se aplica</th>
              </tr>
            </thead>
            <tbody>
              {pendientes.map((f) => {
                const dias = diasVencidos(f.fechaVencimiento, fecha)
                return (
                  <tr
                    key={f.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-1.5">
                      <span className="font-mono text-xs font-medium text-slate-700">
                        {f.folioProveedor}
                      </span>
                      <span className="ml-2 font-mono text-[11px] text-slate-400">
                        {f.folioInterno}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">
                      {formatFecha(f.fechaVencimiento)}
                    </td>
                    <td
                      className={`tabular px-3 py-1.5 text-right text-xs ${
                        dias > 0 ? 'font-medium text-red-600' : 'text-slate-400'
                      }`}
                    >
                      {dias > 0 ? dias : -dias}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <MoneyCell valor={f.saldo} moneda={f.moneda} />
                    </td>
                    <td className="px-4 py-1.5">
                      <MoneyInput
                        value={aplicado[f.id] ?? ''}
                        moneda={moneda}
                        aria-label={`Importe aplicado a la factura ${f.folioProveedor}`}
                        onChange={(v) =>
                          setAplicado((prev) => ({ ...prev, [f.id]: v }))
                        }
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <div className="flex justify-end border-t border-slate-200 px-4 py-3">
          <dl className="w-72 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Importe del pago</dt>
              <dd className="tabular text-slate-800">
                {formatMoney(new Money(importe || '0', moneda))}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Aplicado a facturas</dt>
              <dd className="tabular text-slate-800">
                {formatMoney(calculo.aplicado)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
              <dt className="text-slate-700">Anticipo al proveedor</dt>
              <dd className="tabular text-slate-900">
                {formatMoney(calculo.anticipo)}
              </dd>
            </div>
            {!calculo.diferenciaCambiaria.esCero() && (
              <div className="flex justify-between text-xs">
                <dt className="text-slate-500">
                  Diferencia cambiaria{' '}
                  {calculo.diferenciaCambiaria.esNegativo()
                    ? '(pérdida)'
                    : '(ganancia)'}
                </dt>
                <dd className="tabular text-slate-700">
                  {formatMoney(calculo.diferenciaCambiaria.abs())}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </Card>

      <Card>
        <CardHeader
          titulo="Asiento que se generará"
          descripcion="Cargo a proveedores por lo aplicado, a anticipos por lo que sobra, y abono a la cuenta de salida."
        />
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Cuenta</th>
              <th className="px-3 py-2 text-left">Concepto</th>
              <th className="w-36 px-3 py-2 text-right">Cargo</th>
              <th className="w-36 px-4 py-2 text-right">Abono</th>
            </tr>
          </thead>
          <tbody>
            {(asiento?.lineas ?? []).map((linea, indice) => (
              <tr
                key={`${linea.cuenta}-${indice}`}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="px-4 py-1.5 text-slate-700">
                  {nombreCuenta(linea.cuenta)}{' '}
                  <span className="font-mono text-xs text-slate-400">
                    {linea.cuenta}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-500">
                  {linea.concepto}
                  {linea.auxiliarId && (
                    <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                      {linea.auxiliarTipo}: {linea.auxiliarId}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <MoneyCell valor={linea.cargo} ocultarCero />
                </td>
                <td className="px-4 py-1.5 text-right">
                  <MoneyCell valor={linea.abono} ocultarCero />
                </td>
              </tr>
            ))}
            {(asiento?.lineas.length ?? 0) === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  Elija el proveedor, la cuenta de salida y el importe para ver
                  el asiento.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {(intentoEnvio && !calculo.valido) || errorServidor ? (
        <div className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor
              ? `${errorServidor.codigo}: ${errorServidor.message}`
              : 'El pago no se puede emitir'}
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {(errorServidor?.detalles.length
              ? errorServidor.detalles
              : calculo.errores.map((e) => e.mensaje)
            ).map((mensaje, i) => (
              <li key={i}>{mensaje}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
