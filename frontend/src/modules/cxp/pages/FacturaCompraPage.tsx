import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Building2,
  CircleAlert,
  Paperclip,
  Plus,
  ShoppingCart,
  Trash2,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { SelectorCuenta } from '@/shared/ui/SelectorCuenta'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatMoney } from '@/shared/money/format'
import { hoyISO } from '@/shared/format/fecha'
import { ApiError } from '@/shared/api/client'
import { type IdTarifaIva } from '@/shared/fiscal/iva'
import { opcionesTarifa } from '@/shared/fiscal/impuestos'
import {
  configuracionMoneda,
  monedaFuncional,
  monedasActivas,
  type Moneda,
} from '@/shared/money/money'
import {
  useCuentas,
  usePeriodos,
  useTarifasImpuesto,
} from '@/shared/api/catalogos'
import type { SolicitudAdjunto } from '@/shared/api/contracts/comunes'
import type { SolicitudFacturaCompra } from '@/shared/api/contracts/cxp'
import {
  useAgregarAdjuntos,
  useCategoriasActivo,
  useMapeoCxp,
  useProveedores,
  useRegistrarFacturaCompra,
} from '../api/queries'
import { tamanoLegible } from '../domain/adjunto'
import { SelectorAdjuntos } from '../components/SelectorAdjuntos'
import {
  calcularLineasCompra,
  lineasAsientoFacturaCompra,
  resolutorDeContextoCompra,
  totalesCompraDe,
  validarFacturaCompra,
  vencimientoDe,
  type ContextoFacturaCompra,
} from '../domain/factura'

/**
 * Registro de factura de gasto (docs/05 §2.1).
 *
 * Registrar la factura crea la cuenta por pagar. Si la línea carga una cuenta
 * de activo fijo, además hay que capitalizarla: el activo nace de esta misma
 * captura, porque el asiento necesita su auxiliar y porque una compra de activo
 * que nadie da de alta descuadra el auxiliar contra el mayor (docs/07 §3.1).
 */

interface LineaCaptura {
  clave: number
  descripcion: string
  cantidad: string
  precioUnitario: string
  descuento: string
  tarifa: IdTarifaIva
  /** Vacío = la del proveedor o la del mapeo del módulo. */
  cuenta: string
  capitaliza: boolean
  categoriaId: string
  nombreActivo: string
  fechaInicioDepreciacion: string
  numeroSerie: string
}

let siguienteClave = 0
const lineaVacia = (fecha: string): LineaCaptura => ({
  clave: siguienteClave++,
  descripcion: '',
  cantidad: '1',
  precioUnitario: '',
  descuento: '',
  tarifa: 'GENERAL',
  cuenta: '',
  capitaliza: false,
  categoriaId: '',
  nombreActivo: '',
  fechaInicioDepreciacion: fecha,
  numeroSerie: '',
})

export function FacturaCompraPage() {
  const navegar = useNavigate()
  const { data: proveedores = [] } = useProveedores()
  const { data: cuentas = [] } = useCuentas()
  const { data: periodos = [] } = usePeriodos()
  const { data: categorias = [] } = useCategoriasActivo()
  const { data: mapeo } = useMapeoCxp()
  const registrar = useRegistrarFacturaCompra()
  const subirAdjuntos = useAgregarAdjuntos()

  const funcional = monedaFuncional()

  const [proveedorId, setProveedorId] = useState('')
  const [folioProveedor, setFolioProveedor] = useState('')
  const [fechaEmision, setFechaEmision] = useState(hoyISO)
  const [fechaVencimiento, setFechaVencimiento] = useState(hoyISO)
  const [moneda, setMoneda] = useState<Moneda>(funcional)
  const [tipoCambio, setTipoCambio] = useState('1')
  const [lineas, setLineas] = useState<LineaCaptura[]>(() => [
    lineaVacia(hoyISO()),
  ])
  const [intentoEnvio, setIntentoEnvio] = useState(false)
  // Los adjuntos se eligen aquí y se suben cuando la factura ya existe: el
  // endpoint cuelga de su id, y pedir el comprobante después de registrar es
  // la forma segura de que nadie lo deje para luego.
  const [adjuntos, setAdjuntos] = useState<SolicitudAdjunto[]>([])

  // Por la fecha del documento, no por la de hoy: el IVA acreditable de una
  // compra de junio es el que regía en junio (docs/13 §3).
  const { data: tarifas = [] } = useTarifasImpuesto(fechaEmision)
  const opciones = opcionesTarifa(tarifas)

  const proveedor = proveedores.find((p) => p.id === proveedorId)

  const solicitud: SolicitudFacturaCompra = useMemo(
    () => ({
      proveedorId,
      folioProveedor,
      fechaEmision,
      fechaVencimiento,
      moneda,
      tipoCambio: tipoCambio || '0',
      lineas: lineas.map((l) => ({
        descripcion: l.descripcion,
        cantidad: l.cantidad || '0',
        precioUnitario: l.precioUnitario || '0',
        descuento: l.descuento || '0',
        tarifa: l.tarifa,
        cuenta: l.cuenta || undefined,
        activo: l.capitaliza
          ? {
              categoriaId: l.categoriaId,
              nombre: l.nombreActivo || l.descripcion,
              fechaInicioDepreciacion: l.fechaInicioDepreciacion,
              numeroSerie: l.numeroSerie || null,
            }
          : null,
      })),
    }),
    [
      proveedorId,
      folioProveedor,
      fechaEmision,
      fechaVencimiento,
      moneda,
      tipoCambio,
      lineas,
    ],
  )

  const contexto: ContextoFacturaCompra = useMemo(
    () => ({
      proveedor,
      cuentas,
      periodos,
      categorias,
      mapeo: mapeo ?? {
        proveedor: '',
        gasto: '',
        impuestoAcreditable: '',
        retencion: '',
        anticipo: '',
        diferencialGanado: '',
        diferencialPerdido: '',
      },
      // Sin tabla cargada el dominio cae a la tabla por defecto y no valida
      // la vigencia: es el respaldo mientras llega, no el caso normal.
      tarifas: tarifas.length > 0 ? tarifas : undefined,
    }),
    [proveedor, cuentas, periodos, categorias, mapeo, tarifas],
  )

  const calculadas = useMemo(
    () =>
      calcularLineasCompra(
        solicitud.lineas,
        moneda,
        proveedor,
        contexto.mapeo,
        resolutorDeContextoCompra(contexto, fechaEmision),
      ),
    [solicitud.lineas, moneda, proveedor, contexto, fechaEmision],
  )
  const totales = useMemo(
    () => totalesCompraDe(solicitud.lineas, calculadas, moneda, proveedor),
    [solicitud.lineas, calculadas, moneda, proveedor],
  )
  const validacion = useMemo(
    () => validarFacturaCompra(solicitud, contexto),
    [solicitud, contexto],
  )
  const lineasAsiento = useMemo(
    () =>
      mapeo ? lineasAsientoFacturaCompra(solicitud, contexto, calculadas) : [],
    [mapeo, solicitud, contexto, calculadas],
  )

  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? ''

  /** true si la cuenta de la línea reconoce un activo fijo en el mayor. */
  const esCuentaDeActivo = (codigo: string) => {
    const cuenta = cuentas.find((c) => c.codigo === codigo)
    return cuenta?.requiereAuxiliar === 'activo' && cuenta.naturaleza === 'deudora'
  }

  const actualizar = (clave: number, cambios: Partial<LineaCaptura>) =>
    setLineas((prev) =>
      prev.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)),
    )

  /**
   * Elegir una cuenta de activo fijo enciende la capitalización sola.
   *
   * No es una comodidad: sin ficha, el asiento se rechaza por falta de auxiliar.
   * Es mejor proponerlo que dejar que el error aparezca al final.
   */
  const cambiarCuenta = (linea: LineaCaptura, codigo: string) => {
    const capitaliza = esCuentaDeActivo(codigo)
    actualizar(linea.clave, {
      cuenta: codigo,
      capitaliza: capitaliza || linea.capitaliza,
      categoriaId:
        linea.categoriaId ||
        categorias.find((c) => c.cuentaActivo === codigo)?.id ||
        '',
      nombreActivo: linea.nombreActivo || linea.descripcion,
    })
  }

  const elegirProveedor = (id: string) => {
    setProveedorId(id)
    const elegido = proveedores.find((p) => p.id === id)
    if (!elegido) return
    setFechaVencimiento(vencimientoDe(fechaEmision, elegido.diasCredito))
    setMoneda(elegido.moneda)
    setTipoCambio(
      elegido.moneda === funcional
        ? '1'
        : configuracionMoneda(elegido.moneda).tipoCambio,
    )
  }

  const cambiarEmision = (fecha: string) => {
    setFechaEmision(fecha)
    setFechaVencimiento(vencimientoDe(fecha, proveedor?.diasCredito ?? 0))
  }

  const guardar = async () => {
    setIntentoEnvio(true)
    if (!validacion.valido) return
    // El rechazo del servidor (folio duplicado, periodo cerrado) ya se enseña
    // desde `registrar.error`: se atrapa aquí para no dejar la promesa suelta.
    const factura = await registrar.mutateAsync(solicitud).catch(() => null)
    if (!factura) return
    // Si falla la subida, la factura ya está registrada y no se pierde: se
    // aterriza en su detalle, que es donde se vuelven a adjuntar.
    if (adjuntos.length > 0) {
      try {
        await subirAdjuntos.mutateAsync({ facturaId: factura.id, adjuntos })
      } catch {
        navegar(`/cxp/facturas/${factura.id}`)
        return
      }
    }
    navegar('/cxp/facturas')
  }

  const errorServidor =
    registrar.error instanceof ApiError ? registrar.error : null

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        titulo="Nueva factura de gasto"
        descripcion="Registrarla crea la cuenta por pagar del proveedor y contabiliza el asiento."
        acciones={
          <>
            <Button onClick={() => navegar('/cxp/facturas')}>Cancelar</Button>
            <Button
              variante="primario"
              icono={<ShoppingCart className="size-4" />}
              onClick={() => void guardar()}
              disabled={registrar.isPending}
            >
              {registrar.isPending || subirAdjuntos.isPending
                ? 'Registrando…'
                : 'Registrar factura'}
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
                  .filter((p) => p.activo)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo} · {p.razonSocial}
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          <Field
            label="Folio del proveedor"
            requerido
            ayuda="El que trae su comprobante"
          >
            {(p) => (
              <Input
                {...p}
                value={folioProveedor}
                onChange={(e) => setFolioProveedor(e.target.value)}
              />
            )}
          </Field>

          <Field label="Fecha de emisión" requerido>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={fechaEmision}
                onChange={(e) => cambiarEmision(e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Vencimiento"
            requerido
            ayuda={
              proveedor
                ? proveedor.diasCredito === 0
                  ? 'Contado'
                  : `${proveedor.diasCredito} días de crédito`
                : undefined
            }
          >
            {(p) => (
              <Input
                {...p}
                type="date"
                value={fechaVencimiento}
                onChange={(e) => setFechaVencimiento(e.target.value)}
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
            ayuda={moneda === funcional ? 'Moneda funcional' : 'Referencia BCCR'}
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
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader
          titulo="Detalle"
          acciones={
            <Button
              tamano="sm"
              icono={<Plus className="size-3.5" />}
              onClick={() =>
                setLineas((prev) => [...prev, lineaVacia(fechaEmision)])
              }
            >
              Agregar línea
            </Button>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Descripción</th>
                <th className="w-24 px-3 py-2 text-right">Cantidad</th>
                <th className="w-32 px-3 py-2 text-right">Precio</th>
                <th className="w-36 px-3 py-2 text-left">IVA</th>
                <th className="w-40 px-3 py-2 text-left">Cuenta de cargo</th>
                <th className="w-32 px-3 py-2 text-right">Total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lineas.map((linea, indice) => {
                const calculada = calculadas[indice]
                const errores = intentoEnvio
                  ? validacion.errores.filter((e) => e.linea === indice)
                  : []
                const cuentaResuelta = calculada?.cuenta ?? ''
                const exigeActivo = esCuentaDeActivo(cuentaResuelta)

                return (
                  <tr
                    key={linea.clave}
                    className="border-b border-slate-100 align-top last:border-0"
                  >
                    <td className="px-3 py-2">
                      <Input
                        value={linea.descripcion}
                        aria-label={`Descripción de la línea ${indice + 1}`}
                        placeholder="Bien o servicio"
                        onChange={(e) =>
                          actualizar(linea.clave, { descripcion: e.target.value })
                        }
                      />
                      {(linea.capitaliza || exigeActivo) && (
                        <FichaActivo
                          linea={linea}
                          indice={indice}
                          categorias={categorias}
                          obligatoria={exigeActivo}
                          onCambio={(cambios) => actualizar(linea.clave, cambios)}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={linea.cantidad}
                        aria-label={`Cantidad de la línea ${indice + 1}`}
                        inputMode="decimal"
                        className="tabular text-right"
                        onChange={(e) =>
                          actualizar(linea.clave, {
                            cantidad: e.target.value.replace(',', '.'),
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MoneyInput
                        value={linea.precioUnitario}
                        moneda={moneda}
                        aria-label={`Precio unitario de la línea ${indice + 1}`}
                        onChange={(v) =>
                          actualizar(linea.clave, { precioUnitario: v })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={linea.tarifa}
                        aria-label={`Tarifa de IVA de la línea ${indice + 1}`}
                        onChange={(e) =>
                          actualizar(linea.clave, {
                            tarifa: e.target.value as IdTarifaIva,
                          })
                        }
                      >
                        {opciones.map((t) => (
                          <option key={t.codigo} value={t.codigo}>
                            {t.nombre}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <SelectorCuenta
                        value={linea.cuenta}
                        onChange={(codigo) => cambiarCuenta(linea, codigo)}
                        cuentas={cuentas}
                        error={errores.some(
                          (e) =>
                            e.codigo === 'CUENTA_INVALIDA' ||
                            e.codigo === 'ACTIVO_REQUERIDO',
                        )}
                      />
                      <p className="mt-1 truncate text-[11px] text-slate-500">
                        {cuentaResuelta
                          ? `${cuentaResuelta} ${nombreCuenta(cuentaResuelta)}`
                          : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="tabular text-sm text-slate-800">
                        {calculada
                          ? formatMoney(calculada.total, { simbolo: false })
                          : ''}
                      </div>
                      {calculada && !calculada.impuesto.esCero() && (
                        <div className="text-[11px] text-slate-400">
                          IVA {formatMoney(calculada.impuesto, { simbolo: false })}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() =>
                          setLineas((prev) =>
                            prev.length <= 1
                              ? prev
                              : prev.filter((l) => l.clave !== linea.clave),
                          )
                        }
                        disabled={lineas.length <= 1}
                        title={
                          lineas.length <= 1
                            ? 'La factura requiere al menos una línea'
                            : 'Eliminar línea'
                        }
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end border-t border-slate-200 px-4 py-3">
          <dl className="w-72 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="tabular text-slate-800">
                {formatMoney(totales.subtotal)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">IVA acreditable</dt>
              <dd className="tabular text-slate-800">
                {formatMoney(totales.impuesto)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Total facturado</dt>
              <dd className="tabular text-slate-800">
                {formatMoney(totales.total)}
              </dd>
            </div>
            {!totales.retencion.esCero() && (
              <div className="flex justify-between">
                <dt className="text-slate-500">
                  Retención de renta {proveedor?.retencionRenta}%
                </dt>
                <dd className="tabular text-slate-800">
                  -{formatMoney(totales.retencion)}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
              <dt className="text-slate-700">Total por pagar</dt>
              <dd className="tabular text-slate-900">
                {formatMoney(totales.porPagar)}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader
          titulo="Adjuntos"
          descripcion="El comprobante del proveedor. Se suben en cuanto la factura queda registrada."
          acciones={
            <SelectorAdjuntos
              onElegir={(nuevos) =>
                setAdjuntos((prev) => [...prev, ...nuevos])
              }
            />
          }
        />
        {adjuntos.length === 0 ? (
          <p className="px-4 py-4 text-xs text-slate-500">
            Sin archivos. Una factura de gasto sin su comprobante es un gasto
            que hay que volver a buscar el día de la revisión.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {adjuntos.map((adjunto, indice) => (
              <li
                key={`${adjunto.nombre}-${indice}`}
                className="flex items-center gap-3 px-4 py-2 text-sm"
              >
                <Paperclip className="size-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {adjunto.nombre}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {tamanoLegible(adjunto.tamano)}
                </span>
                <button
                  type="button"
                  title={`Quitar ${adjunto.nombre}`}
                  aria-label={`Quitar ${adjunto.nombre}`}
                  onClick={() =>
                    setAdjuntos((prev) => prev.filter((_, i) => i !== indice))
                  }
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader titulo="Asiento que se generará" />
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
            {lineasAsiento.map((linea, indice) => (
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
                  {linea.auxiliarTipo === 'activo' && (
                    <span className="ml-1 inline-flex items-center gap-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                      <Building2 className="size-3" />
                      activo por crear
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <MoneyCell valor={linea.cargo} moneda={moneda} ocultarCero />
                </td>
                <td className="px-4 py-1.5 text-right">
                  <MoneyCell valor={linea.abono} moneda={moneda} ocultarCero />
                </td>
              </tr>
            ))}
            {lineasAsiento.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  Capture el proveedor y al menos una línea para ver el asiento.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {(intentoEnvio && !validacion.valido) || errorServidor ? (
        <div className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor
              ? `${errorServidor.codigo}: ${errorServidor.message}`
              : 'La factura no se puede registrar'}
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {(errorServidor?.detalles.length
              ? errorServidor.detalles
              : validacion.errores.map((e) =>
                  e.linea === undefined
                    ? e.mensaje
                    : `Línea ${e.linea + 1}: ${e.mensaje}`,
                )
            ).map((mensaje, i) => (
              <li key={i}>{mensaje}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/** Datos mínimos del activo que nace de la línea (docs/07 §1). */
function FichaActivo({
  linea,
  indice,
  categorias,
  obligatoria,
  onCambio,
}: {
  linea: LineaCaptura
  indice: number
  categorias: readonly { id: string; nombre: string; activa: boolean }[]
  obligatoria: boolean
  onCambio: (cambios: Partial<LineaCaptura>) => void
}) {
  return (
    <div className="mt-2 rounded-md bg-slate-50 p-2 ring-1 ring-slate-200 ring-inset">
      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
        <input
          type="checkbox"
          checked={linea.capitaliza || obligatoria}
          disabled={obligatoria}
          aria-label={`Capitalizar la línea ${indice + 1} como activo fijo`}
          onChange={(e) => onCambio({ capitaliza: e.target.checked })}
          className="size-3.5 rounded border-slate-300 accent-brand-600"
        />
        <Building2 className="size-3.5 text-slate-500" />
        Capitalizar como activo fijo
        {obligatoria && (
          <span className="text-[10px] font-normal text-slate-500">
            (la cuenta lo exige)
          </span>
        )}
      </label>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-slate-500">Categoría</span>
          <Select
            value={linea.categoriaId}
            aria-label={`Categoría del activo de la línea ${indice + 1}`}
            onChange={(e) => onCambio({ categoriaId: e.target.value })}
            className="h-8 text-xs"
          >
            <option value="">Seleccione</option>
            {categorias
              .filter((c) => c.activa)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
          </Select>
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-slate-500">Nombre del activo</span>
          <Input
            value={linea.nombreActivo}
            aria-label={`Nombre del activo de la línea ${indice + 1}`}
            placeholder={linea.descripcion || 'Nombre del activo'}
            onChange={(e) => onCambio({ nombreActivo: e.target.value })}
            className="h-8 text-xs"
          />
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-slate-500">
            Inicio de depreciación
          </span>
          <Input
            type="date"
            value={linea.fechaInicioDepreciacion}
            aria-label={`Inicio de depreciación de la línea ${indice + 1}`}
            onChange={(e) =>
              onCambio({ fechaInicioDepreciacion: e.target.value })
            }
            className="h-8 text-xs"
          />
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-slate-500">Número de serie</span>
          <Input
            value={linea.numeroSerie}
            aria-label={`Número de serie de la línea ${indice + 1}`}
            onChange={(e) => onCambio({ numeroSerie: e.target.value })}
            className="h-8 text-xs"
          />
        </label>
      </div>

      <p className="mt-1.5 text-[11px] text-slate-500">
        El activo se deprecia desde que está disponible para su uso, no desde
        que se compró.
      </p>
    </div>
  )
}
