import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { HandCoins, Wand2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatMoney } from '@/shared/money/format'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { useAvisoSalida } from '@/shared/ui/AvisoSalida'
import { claveEfectivo, opcionesDeEfectivo } from '@/shared/cuentas/efectivo'
import { MEDIOS_PAGO, type MedioPago } from '@/shared/api/contracts/terceros'
import {
  monedaFuncional,
  monedasActivas,
  type Moneda,
} from '@/shared/money/money'
import {
  useCuentas,
  useCuentasBancarias,
  usePeriodos,
} from '@/shared/api/catalogos'
import type { SolicitudCobro } from '@/shared/api/contracts/cxc'
import { diasVencidos } from '../domain/factura'
import { MAPEO_VACIO } from '../domain/mapeo'
import {
  armarAsientoCobro,
  facturasCobrables,
  repartirPorAntiguedad,
  validarCobro,
  type ContextoCobro,
} from '../domain/cobro'
import {
  useClientes,
  useFacturasVenta,
  useMapeoCxc,
  useRegistrarCobro,
} from '../api/queries'
import { useTipoCambioDocumento } from '@/shared/api/tipoCambioDocumento'
import { ResumenErrores } from '@/shared/ui/ResumenErrores'

/**
 * Captura de un cobro (docs/04 §2.2).
 *
 *   capturar → aplicar a facturas → contabilizar → notificar a bancos
 *
 * Lo que distingue esta pantalla de la de factura es la aplicación: el dinero
 * ya entró y lo que se decide aquí es a qué facturas se imputa. Por eso las
 * facturas pendientes del cliente se enseñan enteras, con su saldo y sus días
 * vencidos, y lo aplicado se ve en vivo contra lo recibido: quien cobra tiene
 * que poder darse cuenta antes de confirmar de que le sobran cien mil colones
 * que van a quedar como anticipo.
 *
 * El asiento se enseña antes de registrar, como en el resto de capturas: es lo
 * que hace visible el contrato de docs/02 y la única oportunidad de ver que la
 * cuenta de depósito no es la que era sin necesitar después una reversa.
 */
export function CobroPage() {
  const navegar = useNavigate()
  const { data: clientes = [] } = useClientes()
  const { data: cuentas = [] } = useCuentas()
  const { data: cuentasBancarias = [] } = useCuentasBancarias(true)
  const { data: periodos = [] } = usePeriodos()
  const { data: mapeo } = useMapeoCxc()
  const registrar = useRegistrarCobro()

  const funcional = monedaFuncional()

  const [clienteId, setClienteId] = useState('')
  const [fecha, setFecha] = useState(hoyISO)
  const [moneda, setMoneda] = useState<Moneda>(funcional)
  const tc = useTipoCambioDocumento(moneda, fecha)
  const tipoCambio = tc.tipoCambio
  const [medio, setMedio] = useState<MedioPago>('04')
  const [referencia, setReferencia] = useState('')
  // Vacío = todavía la del mapeo. Se resuelve al leer y no con un efecto: el
  // mapeo llega después del primer render y sobrescribir lo ya elegido sería
  // peor que esperar.
  const [opcionElegida, setOpcionElegida] = useState('')
  const [importeRecibido, setImporteRecibido] = useState('')
  /** Lo aplicado a cada factura, por id. Sin entrada = no se aplica nada. */
  const [aplicado, setAplicado] = useState<Record<string, string>>({})
  const [intentoEnvio, setIntentoEnvio] = useState(false)
  /** Sube en cada envío fallido: el resumen de errores toma el foco. */
  const [fallos, setFallos] = useState(0)

  // Las facturas del cliente, no las de todos: es lo único que este cobro
  // puede pagar, y pedir la cartera entera para filtrarla en la pantalla sería
  // traer trabajo del servidor al navegador.
  const { data: facturas = [] } = useFacturasVenta(clienteId || undefined)

  const cliente = clientes.find((c) => c.id === clienteId)

  /**
   * Dónde entró el dinero: caja o una cuenta bancaria del catálogo.
   *
   * Es una sola elección y no dos. Antes eran dos campos, la cuenta contable y
   * el auxiliar bancario tecleado a mano, porque no había catálogo de bancos al
   * que preguntarle. Ahora la ficha bancaria trae las dos cosas y el usuario
   * elige una vez (docs/06 §1).
   */
  const opciones = useMemo(
    () => opcionesDeEfectivo(cuentas, cuentasBancarias),
    [cuentas, cuentasBancarias],
  )
  const opcion =
    opciones.find((o) => claveEfectivo(o) === opcionElegida) ??
    opciones.find((o) => o.codigo === mapeo?.deposito)
  const cuentaDeposito = opcion?.codigo ?? ''
  const auxiliarBanco = opcion?.auxiliarBanco ?? null

  const cobrables = useMemo(
    () => (clienteId ? facturasCobrables(facturas, clienteId) : []),
    [facturas, clienteId],
  )

  const solicitud: SolicitudCobro = useMemo(
    () => ({
      clienteId,
      fecha,
      moneda,
      tipoCambio: tipoCambio || '0',
      medio,
      referencia: referencia.trim() || null,
      cuentaDeposito,
      auxiliarBanco,
      importeRecibido: importeRecibido || '0',
      // Solo las facturas con algo aplicado: una entrada en cero no es una
      // aplicación, es una casilla que se dejó en blanco.
      aplicaciones: cobrables
        .filter((f) => Number(aplicado[f.id] ?? '0') !== 0)
        .map((f) => ({ facturaId: f.id, importeAplicado: aplicado[f.id] })),
    }),
    [
      clienteId,
      fecha,
      moneda,
      tipoCambio,
      medio,
      referencia,
      cuentaDeposito,
      auxiliarBanco,
      importeRecibido,
      cobrables,
      aplicado,
    ],
  )

  const contexto: ContextoCobro = useMemo(
    () => ({
      cliente,
      facturas,
      cuentas,
      cuentasBancarias,
      periodos,
      mapeo: mapeo ?? MAPEO_VACIO,
      funcional,
    }),
    [cliente, facturas, cuentas, cuentasBancarias, periodos, mapeo, funcional],
  )

  const calculo = useMemo(
    () => validarCobro(solicitud, contexto),
    [solicitud, contexto],
  )

  // El id y el consecutivo los asigna el servidor al registrar; aquí solo se
  // enseñan las líneas, que es lo que hay que revisar antes de confirmar.
  const lineasAsiento = useMemo(
    () =>
      mapeo
        ? armarAsientoCobro('', '', solicitud, contexto, calculo).lineas
        : [],
    [mapeo, solicitud, contexto, calculo],
  )

  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? ''

  const elegirCliente = (id: string) => {
    setClienteId(id)
    // Cambiar de cliente invalida el reparto: las facturas son otras.
    setAplicado({})
    const elegido = clientes.find((c) => c.id === id)
    if (!elegido) return
    // El tipo de cambio lo propone `useTipoCambioDocumento` para la moneda
    // del cliente y la fecha del cobro.
    setMoneda(elegido.moneda)
    // Cómo suele pagar este cliente. Sigue siendo editable.
    if (elegido.medioPago) setMedio(elegido.medioPago)
  }

  /**
   * Reparte lo recibido entre las facturas pendientes, de la más vieja a la
   * más nueva.
   *
   * Es la imputación habitual en cobranza y la que vacía las cubetas de la
   * derecha del reporte de antigüedad. Sustituye el reparto anterior entero:
   * mezclarlo con lo ya tecleado daría un total que nadie pidió.
   */
  const repartir = () => {
    const reparto = repartirPorAntiguedad(
      importeRecibido || '0',
      cobrables,
      moneda,
    )
    setAplicado(
      Object.fromEntries(reparto.map((r) => [r.facturaId, r.importeAplicado])),
    )
  }

  // Hay algo capturado que se perdería al salir.
  const sucio = Boolean(
    clienteId ||
      importeRecibido ||
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
    // El rechazo del servidor (periodo cerrado, saldo que cambió en otra
    // pestaña) se enseña desde `registrar.error`: se atrapa aquí para no dejar
    // la promesa suelta y para no navegar sobre un cobro que no nació.
    const cobro = await registrar.mutateAsync(solicitud).catch(() => null)
    if (!cobro) {
      setFallos((n) => n + 1)
      return
    }
    permitirSalida()
    // Al detalle del cobro recién nacido, como el pago: es donde se ve su
    // asiento y a qué facturas quedó aplicado.
    navegar(`/cxc/cobros/${cobro.id}`)
  }

  // El rechazo del servidor es de la solicitud que se envió. En cuanto se toca
  // algo deja de ser de lo que hay en pantalla y se deja de enseñar.
  const errorServidor =
    registrar.variables === solicitud ? registrar.error : null
  const erroresDe = (facturaId: string) =>
    intentoEnvio
      ? calculo.errores.filter(
          (e) =>
            e.aplicacion !== undefined &&
            solicitud.aplicaciones[e.aplicacion]?.facturaId === facturaId,
        )
      : []

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        titulo="Registrar cobro"
        descripcion="El cobro baja el saldo de las facturas que se le apliquen y contabiliza la entrada de efectivo."
        acciones={
          <>
            <Button onClick={() => navegar('/cxc/cobros')}>Cancelar</Button>
            <Button
              type="submit"
              form="form-cobro"
              variante="primario"
              icono={<HandCoins className="size-4" />}
              disabled={registrar.isPending}
            >
              {registrar.isPending ? 'Registrando…' : 'Registrar cobro'}
            </Button>
          </>
        }
      />

      {aviso}

      <Card className="mb-4">
        {/* Enter en un campo del encabezado registra el cobro. La tabla de
            aplicaciones queda fuera del formulario: ahí Enter no debe enviar
            a medio reparto. */}
        <form
          id="form-cobro"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!registrar.isPending) void guardar()
          }}
          className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
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

          <Field label="Fecha del cobro" requerido>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            )}
          </Field>

          <Field label="Importe recibido" requerido>
            {(p) => (
              <MoneyInput
                {...p}
                value={importeRecibido}
                moneda={moneda}
                onChange={setImporteRecibido}
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
                  // El reparto anterior era en otra moneda: no se conserva.
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
                : `${tc.ayuda ?? ''} La diferencia contra el de la factura se contabiliza aparte.`.trim()
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

          <Field label="Medio de cobro" requerido>
            {(p) => (
              <Select
                {...p}
                value={medio}
                onChange={(e) => setMedio(e.target.value as MedioPago)}
              >
                {MEDIOS_PAGO.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Referencia"
            ayuda="Número de transferencia, de cheque o de voucher"
          >
            {(p) => (
              <Input
                {...p}
                value={referencia}
                placeholder="TRF-000000"
                onChange={(e) => setReferencia(e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Cuenta de depósito"
            requerido
            ayuda="Dónde entró el dinero"
            error={
              intentoEnvio &&
              calculo.errores.some(
                (e) =>
                  e.codigo === 'CUENTA_DEPOSITO_INVALIDA' ||
                  e.codigo === 'AUXILIAR_BANCO_REQUERIDO',
              )
                ? 'Elija dónde entró el dinero'
                : undefined
            }
          >
            {(p) => (
              <Select
                {...p}
                value={opcion ? claveEfectivo(opcion) : ''}
                onChange={(e) => setOpcionElegida(e.target.value)}
              >
                <option value="">Seleccione…</option>
                {opciones.map((o) => (
                  <option key={claveEfectivo(o)} value={claveEfectivo(o)}>
                    {o.nombre}
                    {o.moneda ? ` (${o.moneda})` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {cliente && (
            <div className="flex flex-col justify-center rounded-md bg-slate-50 px-3 py-2 lg:col-span-2">
              <span className="text-[11px] text-slate-500">
                Saldo actual del cliente
              </span>
              <span className="text-sm text-slate-800">
                <MoneyCell valor={cliente.saldo} mostrarSimbolo /> en{' '}
                {cliente.facturasPendientes} facturas pendientes
              </span>
            </div>
          )}
        </form>
      </Card>

      <Card className="mb-4">
        <CardHeader
          titulo="Facturas pendientes"
          descripcion="De la más vieja a la más nueva. Lo que no se aplique queda como anticipo del cliente."
          acciones={
            <Button
              tamano="sm"
              icono={<Wand2 className="size-3.5" />}
              onClick={repartir}
              disabled={cobrables.length === 0}
            >
              Aplicar todo lo que quepa
            </Button>
          }
        />

        <div className="overflow-x-auto">
          <table
            className="w-full text-sm"
            aria-label="Facturas pendientes del cliente"
          >
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="w-32 px-4 py-2 text-left">Factura</th>
                <th className="w-28 px-3 py-2 text-left">Vence</th>
                <th className="w-20 px-3 py-2 text-right">Días</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="w-40 px-3 py-2 text-right">Aplicar</th>
                <th className="w-32 px-4 py-2 text-right">Saldo resultante</th>
              </tr>
            </thead>
            <tbody>
              {cobrables.map((factura) => {
                const errores = erroresDe(factura.id)
                const aplicacion = calculo.aplicaciones.find(
                  (a) => a.facturaId === factura.id,
                )
                const dias = diasVencidos(factura.fechaVencimiento, fecha)
                return (
                  <tr
                    key={factura.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-2 font-mono text-xs font-medium text-slate-700">
                      {factura.numeroInterno}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {formatFecha(factura.fechaVencimiento)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={
                          dias > 0
                            ? 'text-xs font-medium text-red-600'
                            : 'text-xs text-slate-400'
                        }
                      >
                        {dias > 0 ? dias : -dias}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell valor={factura.total} moneda={factura.moneda} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell valor={factura.saldo} moneda={factura.moneda} />
                    </td>
                    <td className="px-3 py-2">
                      <MoneyInput
                        value={aplicado[factura.id] ?? ''}
                        moneda={moneda}
                        aria-label={`Importe aplicado a ${factura.numeroInterno}`}
                        aria-invalid={errores.length > 0}
                        onChange={(v) =>
                          setAplicado((prev) => ({ ...prev, [factura.id]: v }))
                        }
                      />
                      {errores.length > 0 && (
                        <p className="mt-1 text-[11px] text-red-600">
                          {errores[0].mensaje}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <MoneyCell
                        valor={
                          aplicacion
                            ? aplicacion.saldoResultante
                            : factura.saldo
                        }
                        moneda={factura.moneda}
                      />
                    </td>
                  </tr>
                )
              })}
              {cobrables.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    {clienteId
                      ? 'El cliente no tiene facturas pendientes: lo recibido quedará como anticipo.'
                      : 'Seleccione un cliente para ver sus facturas pendientes.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end border-t border-slate-200 px-4 py-3">
          <dl className="w-72 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Recibido</dt>
              <dd className="tabular text-slate-800">
                {formatMoney(calculo.importeRecibido)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Aplicado a facturas</dt>
              <dd className="tabular text-slate-800">
                {formatMoney(calculo.importeAplicado)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
              <dt className="text-slate-700">Queda como anticipo</dt>
              <dd
                className={`tabular ${
                  calculo.importeSinAplicar.esPositivo()
                    ? 'text-amber-700'
                    : 'text-slate-900'
                }`}
              >
                {formatMoney(calculo.importeSinAplicar)}
              </dd>
            </div>
            {!calculo.diferenciaCambiaria.esCero() && (
              <div className="flex justify-between border-t border-slate-200 pt-1">
                <dt className="text-slate-500">
                  Diferencia cambiaria{' '}
                  {calculo.diferenciaCambiaria.esPositivo()
                    ? '(ganada)'
                    : '(perdida)'}
                </dt>
                <dd className="tabular text-slate-800">
                  {formatMoney(calculo.diferenciaCambiaria)}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </Card>

      <Card>
        <CardHeader
          titulo="Asiento que se generará"
          descripcion={`Expresado en ${funcional}, que es la moneda del mayor.`}
        />
        <table className="w-full text-sm" aria-label="Asiento del cobro">
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
                </td>
                <td className="px-3 py-1.5 text-right">
                  <MoneyCell valor={linea.cargo} moneda={funcional} ocultarCero />
                </td>
                <td className="px-4 py-1.5 text-right">
                  <MoneyCell valor={linea.abono} moneda={funcional} ocultarCero />
                </td>
              </tr>
            ))}
            {lineasAsiento.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  Capture el cliente y el importe recibido para ver el asiento.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <ResumenErrores
        titulo="El cobro no se puede registrar"
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
