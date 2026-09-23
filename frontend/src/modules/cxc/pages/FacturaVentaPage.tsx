import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Plus, Receipt, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { SelectorCuenta } from '@/shared/ui/SelectorCuenta'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatMoney } from '@/shared/money/format'
import { hoyISO } from '@/shared/format/fecha'
import { useAvisoSalida } from '@/shared/ui/AvisoSalida'
import { type IdTarifaIva } from '@/shared/fiscal/iva'
import { opcionesTarifa } from '@/shared/fiscal/impuestos'
import {
  monedaFuncional,
  monedasActivas,
  Money,
  type Moneda,
} from '@/shared/money/money'
import {
  useCuentas,
  usePeriodos,
  useTarifasImpuesto,
} from '@/shared/api/catalogos'
import type { SolicitudFacturaVenta } from '@/shared/api/contracts/cxc'
import {
  useClientes,
  useEmitirFactura,
  useItems,
  useMapeoCxc,
} from '../api/queries'
import {
  calcularLineas,
  lineasAsientoFactura,
  resolutorDeContexto,
  totalesDe,
  validarFacturaVenta,
  vencimientoDe,
  type ContextoFacturaVenta,
} from '../domain/factura'
import { MAPEO_VACIO } from '../domain/mapeo'
import { precargaDeItem } from '../domain/item'
import { SelectorItem } from '../components/SelectorItem'
import { ResumenErrores } from '@/shared/ui/ResumenErrores'
import { useTipoCambioDocumento } from '@/shared/api/tipoCambioDocumento'

/**
 * Emisión de factura de venta (docs/04 §2.1).
 *
 * La pantalla enseña el asiento antes de emitir. No es un adorno: es lo que
 * hace visible el contrato de docs/02 y lo que permite a quien factura darse
 * cuenta de que una línea va a la cuenta de ingreso equivocada, cuando todavía
 * se puede corregir sin una reversa.
 *
 * La línea empieza por el catálogo de venta (docs/04 §1.1): elegir un item
 * precarga descripción, precio, tarifa y cuenta de ingreso. Precarga, no
 * impone: los cuatro campos siguen siendo editables y lo que se contabiliza es
 * lo que quedó en la línea. Sin item, la captura es la de siempre.
 */

interface LineaCaptura {
  clave: number
  /** Código tecleado en el selector. Puede no existir en el catálogo. */
  itemCodigo: string
  /** Item resuelto. Vacío = la línea no salió del catálogo. */
  itemId: string
  descripcion: string
  cantidad: string
  precioUnitario: string
  descuento: string
  tarifa: IdTarifaIva
  /** Vacío = la del cliente o la del mapeo del módulo. */
  cuentaIngreso: string
}

let siguienteClave = 0
const lineaVacia = (): LineaCaptura => ({
  clave: siguienteClave++,
  itemCodigo: '',
  itemId: '',
  descripcion: '',
  cantidad: '1',
  precioUnitario: '',
  descuento: '',
  tarifa: 'GENERAL',
  cuentaIngreso: '',
})

export function FacturaVentaPage() {
  const navegar = useNavigate()
  const { data: clientes = [] } = useClientes()
  const { data: items = [] } = useItems()
  const { data: cuentas = [] } = useCuentas()
  const { data: periodos = [] } = usePeriodos()
  const { data: mapeo } = useMapeoCxc()
  const emitir = useEmitirFactura()

  const funcional = monedaFuncional()

  const [clienteId, setClienteId] = useState('')
  const [fechaEmision, setFechaEmision] = useState(hoyISO)
  const [fechaVencimiento, setFechaVencimiento] = useState(hoyISO)
  const [moneda, setMoneda] = useState<Moneda>(funcional)
  // El del día de la emisión, no el de hoy ni el del catálogo de monedas.
  const tc = useTipoCambioDocumento(moneda, fechaEmision)
  const tipoCambio = tc.tipoCambio
  const [lineas, setLineas] = useState<LineaCaptura[]>(() => [lineaVacia()])
  const [intentoEnvio, setIntentoEnvio] = useState(false)
  /** Sube en cada envío fallido: el resumen de errores toma el foco. */
  const [fallos, setFallos] = useState(0)

  // Las tarifas que rigen el día que se emite, no las de hoy: una factura con
  // fecha de junio se calcula con la tabla de junio (docs/13 §3).
  const { data: tarifas = [] } = useTarifasImpuesto(fechaEmision)
  const opciones = opcionesTarifa(tarifas)

  const cliente = clientes.find((c) => c.id === clienteId)

  const solicitud: SolicitudFacturaVenta = useMemo(
    () => ({
      clienteId,
      fechaEmision,
      fechaVencimiento,
      moneda,
      tipoCambio: tipoCambio || '0',
      lineas: lineas.map((l) => ({
        itemId: l.itemId || undefined,
        descripcion: l.descripcion,
        cantidad: l.cantidad || '0',
        precioUnitario: l.precioUnitario || '0',
        descuento: l.descuento || '0',
        tarifa: l.tarifa,
        cuentaIngreso: l.cuentaIngreso || undefined,
      })),
    }),
    [clienteId, fechaEmision, fechaVencimiento, moneda, tipoCambio, lineas],
  )

  const contexto: ContextoFacturaVenta = useMemo(
    () => ({
      cliente,
      cuentas,
      periodos,
      mapeo: mapeo ?? MAPEO_VACIO,
      items,
      // Sin tabla cargada el dominio cae a la tabla por defecto y no valida
      // la vigencia: es el respaldo mientras llega, no el caso normal.
      tarifas: tarifas.length > 0 ? tarifas : undefined,
    }),
    [cliente, cuentas, periodos, mapeo, items, tarifas],
  )

  const calculadas = useMemo(
    () =>
      calcularLineas(
        solicitud.lineas,
        moneda,
        cliente,
        contexto.mapeo,
        resolutorDeContexto(contexto, fechaEmision),
      ),
    [solicitud.lineas, moneda, cliente, contexto, fechaEmision],
  )
  const totales = useMemo(
    () => totalesDe(solicitud.lineas, calculadas, moneda),
    [solicitud.lineas, calculadas, moneda],
  )
  const validacion = useMemo(
    () => validarFacturaVenta(solicitud, contexto),
    [solicitud, contexto],
  )
  const lineasAsiento = useMemo(
    () => (mapeo ? lineasAsientoFactura(solicitud, contexto, calculadas) : []),
    [mapeo, solicitud, contexto, calculadas],
  )

  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? ''

  const actualizar = (clave: number, cambios: Partial<LineaCaptura>) =>
    setLineas((prev) =>
      prev.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)),
    )

  /**
   * Precarga la línea desde el catálogo.
   *
   * Solo cuando el código corresponde a un item activo. Mientras se teclea, o
   * si lo escrito no está en el catálogo, la línea se queda como está: borrar
   * lo capturado a media palabra sería peor que no precargar nada.
   */
  const elegirItem = (linea: LineaCaptura, codigo: string) => {
    const buscado = codigo.trim()
    const item = items.find((i) => i.codigo === buscado && i.activo)
    if (!item) {
      actualizar(linea.clave, { itemCodigo: codigo, itemId: '' })
      return
    }

    const precarga = precargaDeItem(item, moneda)
    actualizar(linea.clave, {
      itemCodigo: item.codigo,
      itemId: item.id,
      descripcion: precarga.descripcion,
      tarifa: precarga.tarifa,
      cuentaIngreso: precarga.cuentaIngreso,
      // El precio solo viene si el item está cotizado en la moneda de la
      // factura; si no, se deja lo que hubiera y se avisa bajo la línea.
      ...(precarga.precioUnitario === null
        ? {}
        : { precioUnitario: precarga.precioUnitario }),
    })
  }

  const elegirCliente = (id: string) => {
    setClienteId(id)
    const elegido = clientes.find((c) => c.id === id)
    if (!elegido) return
    // Las condiciones de pago son del cliente: el vencimiento se propone solo y
    // quien factura solo lo toca cuando la venta se sale de lo pactado.
    setFechaVencimiento(vencimientoDe(fechaEmision, elegido.diasCredito))
    setMoneda(elegido.moneda)
  }

  const cambiarEmision = (fecha: string) => {
    setFechaEmision(fecha)
    setFechaVencimiento(vencimientoDe(fecha, cliente?.diasCredito ?? 0))
  }

  // Hay algo capturado que se perdería al salir.
  const sucio =
    Boolean(clienteId) ||
    lineas.some(
      (l) => l.itemCodigo || l.descripcion.trim() || l.precioUnitario,
    )
  const { aviso, permitirSalida } = useAvisoSalida(sucio && !emitir.isSuccess)

  const guardar = async () => {
    setIntentoEnvio(true)
    emitir.reset()
    if (!validacion.valido) {
      setFallos((n) => n + 1)
      return
    }
    // El rechazo del servidor (límite de crédito, periodo cerrado) ya se
    // enseña desde `emitir.error`: se atrapa aquí para no dejar la promesa
    // suelta y para no navegar sobre una factura que no nació.
    const factura = await emitir.mutateAsync(solicitud).catch(() => null)
    if (!factura) {
      setFallos((n) => n + 1)
      return
    }
    permitirSalida()
    navegar(`/cxc/facturas/${factura.id}`)
  }

  // El rechazo es de la solicitud que se envió: en cuanto se corrige algo,
  // deja de describir lo que hay en pantalla.
  const errorServidor = emitir.variables === solicitud ? emitir.error : null

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        titulo="Nueva factura de venta"
        descripcion="Emitir la factura crea la cuenta por cobrar del cliente y contabiliza el asiento."
        acciones={
          <>
            <Button onClick={() => navegar('/cxc/facturas')}>Cancelar</Button>
            <Button
              variante="primario"
              icono={<Receipt className="size-4" />}
              onClick={() => void guardar()}
              disabled={emitir.isPending}
            >
              {emitir.isPending ? 'Emitiendo…' : 'Emitir factura'}
            </Button>
          </>
        }
      />

      {aviso}

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Cliente" requerido className="lg:col-span-2">
            {(p) => (
              <Select
                {...p}
                value={clienteId}
                onChange={(e) => elegirCliente(e.target.value)}
              >
                <option value="">Seleccione un cliente</option>
                {clientes
                  .filter((c) => c.activo)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} · {c.razonSocial}
                    </option>
                  ))}
              </Select>
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
              cliente
                ? cliente.diasCredito === 0
                  ? 'Contado'
                  : `${cliente.diasCredito} días de crédito`
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
                onChange={(e) => setMoneda(e.target.value)}
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
            ayuda={tc.ayuda}
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

          {cliente && (
            <div className="flex flex-col justify-center rounded-md bg-slate-50 px-3 py-2 lg:col-span-2">
              <span className="text-[11px] text-slate-500">
                Saldo actual y límite de crédito
              </span>
              <span className="text-sm text-slate-800">
                <MoneyCell valor={cliente.saldo} mostrarSimbolo /> de{' '}
                {new Money(cliente.limiteCredito, funcional).esCero() ? (
                  'sin límite'
                ) : (
                  <MoneyCell valor={cliente.limiteCredito} mostrarSimbolo />
                )}
              </span>
            </div>
          )}
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader
          titulo="Detalle"
          acciones={
            <Button
              tamano="sm"
              icono={<Plus className="size-3.5" />}
              onClick={() => setLineas((prev) => [...prev, lineaVacia()])}
            >
              Agregar línea
            </Button>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="w-36 px-3 py-2 text-left">Producto o servicio</th>
                <th className="px-3 py-2 text-left">Descripción</th>
                <th className="w-24 px-3 py-2 text-right">Cantidad</th>
                <th className="w-32 px-3 py-2 text-right">Precio</th>
                <th className="w-28 px-3 py-2 text-right">Descuento</th>
                <th className="w-36 px-3 py-2 text-left">IVA</th>
                <th className="w-40 px-3 py-2 text-left">Cuenta de ingreso</th>
                <th className="w-32 px-3 py-2 text-right">Total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lineas.map((linea, indice) => {
                const calculada = calculadas[indice]
                const itemElegido = items.find((i) => i.id === linea.itemId)
                const errores = intentoEnvio
                  ? validacion.errores.filter((e) => e.linea === indice)
                  : []

                return (
                  <tr
                    key={linea.clave}
                    className="border-b border-slate-100 align-top last:border-0"
                  >
                    <td className="px-3 py-2">
                      <SelectorItem
                        value={linea.itemCodigo}
                        onChange={(codigo) => elegirItem(linea, codigo)}
                        items={items}
                        etiqueta={`Producto o servicio de la línea ${indice + 1}`}
                      />
                      {itemElegido && itemElegido.moneda !== moneda && (
                        <p className="mt-1 text-[11px] text-amber-700">
                          Precio de lista en {itemElegido.moneda}: capture el de
                          esta factura
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={linea.descripcion}
                        aria-label={`Descripción de la línea ${indice + 1}`}
                        placeholder="Servicio o producto"
                        aria-invalid={errores.some(
                          (e) => e.codigo === 'LINEA_INVALIDA',
                        )}
                        onChange={(e) =>
                          actualizar(linea.clave, { descripcion: e.target.value })
                        }
                      />
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
                      <MoneyInput
                        value={linea.descuento}
                        moneda={moneda}
                        aria-label={`Descuento de la línea ${indice + 1}`}
                        onChange={(v) => actualizar(linea.clave, { descuento: v })}
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
                        value={linea.cuentaIngreso}
                        onChange={(codigo) =>
                          actualizar(linea.clave, { cuentaIngreso: codigo })
                        }
                        cuentas={cuentas}
                        etiqueta={`Cuenta de ingreso de la línea ${indice + 1}`}
                        error={errores.some((e) => e.codigo === 'CUENTA_INVALIDA')}
                      />
                      <p className="mt-1 truncate text-[11px] text-slate-500">
                        {calculada
                          ? `${calculada.cuentaIngreso} ${nombreCuenta(calculada.cuentaIngreso)}`
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
          <dl className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="tabular text-slate-800">
                {formatMoney(totales.subtotal)}
              </dd>
            </div>
            {!totales.descuentos.esCero() && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Descuentos</dt>
                <dd className="tabular text-slate-800">
                  {formatMoney(totales.descuentos)}
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500">IVA</dt>
              <dd className="tabular text-slate-800">
                {formatMoney(totales.impuesto)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
              <dt className="text-slate-700">Total por cobrar</dt>
              <dd className="tabular text-slate-900">
                {formatMoney(totales.total)}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card>
        <CardHeader titulo="Asiento que se generará" />
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            {/* Código y nombre son la misma cosa dicha dos veces: van en una
                columna, con el código de apoyo bajo el nombre. */}
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
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                  Capture el cliente y al menos una línea para ver el asiento.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <ResumenErrores
        titulo="La factura no se puede emitir"
        errores={
          intentoEnvio && !validacion.valido
            ? validacion.errores.map((e) =>
                e.linea === undefined
                  ? e.mensaje
                  : `Línea ${e.linea + 1}: ${e.mensaje}`,
              )
            : []
        }
        errorServidor={errorServidor}
        senal={fallos}
      />
    </div>
  )
}
