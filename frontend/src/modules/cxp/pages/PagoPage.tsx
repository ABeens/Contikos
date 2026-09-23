import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import Decimal from 'decimal.js'
import { Banknote, ListOrdered } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatMoney } from '@/shared/money/format'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { diasVencidos } from '@/shared/cartera/antiguedad'
import { useAvisoSalida } from '@/shared/ui/AvisoSalida'
import { claveEfectivo, opcionesDeEfectivo } from '@/shared/cuentas/efectivo'
import {
  useCuentas,
  useCuentasBancarias,
  usePeriodos,
} from '@/shared/api/catalogos'
import {
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
import { useTipoCambioDocumento } from '@/shared/api/tipoCambioDocumento'
import { ResumenErrores } from '@/shared/ui/ResumenErrores'
import {
  admitePago,
  armarAsientoPago,
  calcularPago,
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

  const { data: proveedores = [], isSuccess: proveedoresListos } =
    useProveedores()
  const { data: cuentas = [] } = useCuentas()
  const { data: periodos = [] } = usePeriodos()
  const { data: mapeo } = useMapeoCxp()
  const registrar = useRegistrarPago()

  // `?proveedor=` es la llegada desde "Ajustar" en la propuesta de pago:
  // quien viene de ahí ya eligió a quién le paga.
  const proveedorDeUrl = parametros.get('proveedor') ?? ''
  const [proveedorId, setProveedorId] = useState('')
  /**
   * El proveedor de la URL se aplica cuando llega el catálogo, y no antes:
   * elegirlo es también fijar su moneda, y eso solo se sabe con la ficha.
   * Se hace una vez, durante el render (estado derivado de una carga), para
   * no pintar ni un instante la moneda equivocada.
   */
  const [urlAplicada, setUrlAplicada] = useState(proveedorDeUrl === '')
  const [fecha, setFecha] = useState(hoyISO)
  const [moneda, setMoneda] = useState<Moneda>(funcional)
  // El del día del pago: la diferencia con el de la factura es resultado
  // cambiario, y por eso importa que sea el de esa fecha.
  const tc = useTipoCambioDocumento(moneda, fecha)
  const tipoCambio = tc.tipoCambio
  const [opcionElegida, setOpcionElegida] = useState('')
  const [medioPago, setMedioPago] = useState<MedioPago>('transferencia')
  const [referencia, setReferencia] = useState('')
  const [importe, setImporte] = useState('')
  /** Lo aplicado a cada factura, por id. Vacío = no se le aplica nada. */
  const [aplicado, setAplicado] = useState<Record<string, string>>({})
  const [intentoEnvio, setIntentoEnvio] = useState(false)
  /** Sube en cada envío fallido: el resumen de errores toma el foco. */
  const [fallos, setFallos] = useState(0)

  if (!urlAplicada && proveedoresListos) {
    setUrlAplicada(true)
    const deUrl = proveedores.find((p) => p.id === proveedorDeUrl)
    if (deUrl) {
      setProveedorId(deUrl.id)
      setMoneda(deUrl.moneda)
    }
  }

  const { data: facturas = [] } = useFacturasCompra(proveedorId || undefined)
  const proveedor = proveedores.find((p) => p.id === proveedorId)
  /**
   * De dónde sale el dinero: caja o una cuenta bancaria del catálogo.
   *
   * Es una sola elección y no dos. La ficha bancaria trae a la vez la cuenta de
   * control del mayor y el auxiliar con el que vive en él (docs/06 §1); antes
   * el auxiliar se derivaba de la posición de la cuenta en el plan.
   */
  const { data: cuentasBancarias = [] } = useCuentasBancarias(true)

  const opcionesCuenta = useMemo(
    () => opcionesDeEfectivo(cuentas, cuentasBancarias),
    [cuentas, cuentasBancarias],
  )
  const opcion = opcionesCuenta.find((o) => claveEfectivo(o) === opcionElegida)
  const cuentaSalida = opcion?.codigo ?? ''
  const auxiliarBanco = opcion?.auxiliarBanco ?? null

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
      auxiliarBanco,
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
      auxiliarBanco,
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
      cuentasBancarias,
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
    [proveedor, facturas, cuentas, cuentasBancarias, periodos, mapeo, funcional],
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
    // El tipo de cambio lo propone `useTipoCambioDocumento` para esa moneda y
    // la fecha del pago.
    setMoneda(elegido.moneda)
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

  // Hay algo capturado que se perdería al salir. El proveedor que vino en la
  // URL no cuenta: nadie lo tecleó.
  const sucio = Boolean(
    (proveedorId && proveedorId !== proveedorDeUrl) ||
      importe ||
      referencia.trim() ||
      Object.values(aplicado).some((v) => v !== ''),
  )
  const { aviso, permitirSalida } = useAvisoSalida(sucio && !registrar.isSuccess)

  const guardar = async () => {
    setIntentoEnvio(true)
    registrar.reset()
    if (!calculo.valido) {
      setFallos((n) => n + 1)
      return
    }
    // El rechazo se enseña desde `registrar.error`; aquí solo se evita dejar
    // la promesa suelta y navegar sobre un pago que no nació.
    const pago = await registrar.mutateAsync(solicitud).catch(() => null)
    if (!pago) {
      setFallos((n) => n + 1)
      return
    }
    permitirSalida()
    navegar(`/cxp/pagos/${pago.id}`)
  }

  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? ''

  // El rechazo es de la solicitud que se envió: en cuanto se toca algo deja
  // de describir lo que hay en pantalla.
  const errorServidor =
    registrar.variables === solicitud ? registrar.error : null

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        titulo="Nuevo pago a proveedor"
        descripcion="Emitirlo contabiliza el egreso y baja el saldo de las facturas a las que se aplica."
        acciones={
          <>
            <Button onClick={() => navegar('/cxp/pagos')}>Cancelar</Button>
            <Button
              type="submit"
              form="form-pago"
              variante="primario"
              icono={<Banknote className="size-4" />}
              disabled={registrar.isPending}
            >
              {registrar.isPending ? 'Emitiendo…' : 'Emitir pago'}
            </Button>
          </>
        }
      />

      {aviso}

      <Card className="mb-4">
        {/* Enter en un campo del encabezado emite el pago. La tabla de
            facturas queda fuera del formulario: ahí Enter no debe enviar a
            medio reparto. */}
        <form
          id="form-pago"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!registrar.isPending) void guardar()
          }}
          className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
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
                value={opcionElegida}
                onChange={(e) => setOpcionElegida(e.target.value)}
              >
                <option value="">Seleccione la cuenta</option>
                {opcionesCuenta.map((o) => (
                  <option key={claveEfectivo(o)} value={claveEfectivo(o)}>
                    {o.nombre}
                    {o.moneda ? ` (${o.moneda})` : ''}
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
                  setMoneda(e.target.value)
                  setAplicado({})
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
                ? tc.ayuda
                : `${tc.ayuda ?? ''} La diferencia con el de la factura es resultado cambiario.`.trim()
            }
          >
            {(p) => (
              <Input
                {...p}
                value={tipoCambio}
                disabled={moneda === funcional}
                onChange={(e) => tc.editar(e.target.value)}
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
        </form>
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

      <ResumenErrores
        titulo="El pago no se puede emitir"
        errores={
          intentoEnvio && !calculo.valido
            ? calculo.errores.map((e) => e.mensaje)
            : []
        }
        errorServidor={errorServidor}
        senal={fallos}
      />
    </div>
  )
}
