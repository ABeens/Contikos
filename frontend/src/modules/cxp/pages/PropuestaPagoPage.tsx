import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import Decimal from 'decimal.js'
import { Banknote, CircleAlert, CircleCheck, Search } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { LinkBoton } from '@/shared/ui/LinkBoton'
import { Card, CardHeader, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { DialogoConfirmacion } from '@/shared/ui/DialogoConfirmacion'
import { MensajeError } from '@/shared/ui/MensajeError'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { useCuentas, useCuentasBancarias } from '@/shared/api/catalogos'
import { monedaFuncional } from '@/shared/money/money'
import type {
  LineaPropuestaPago,
  MedioPago,
  SolicitudPago,
} from '@/shared/api/contracts/cxp'
import { MEDIOS_PAGO } from '@/shared/api/contracts/cxp'
import { useCalcularPropuestaPago, useRegistrarPago } from '../api/queries'
import {
  claveEfectivo,
  opcionesDeEfectivo,
} from '@/shared/cuentas/efectivo'

/**
 * Propuesta de pago (docs/05 §2.3).
 *
 * El flujo más usado del módulo en la práctica: se fija una fecha de corte y
 * cuánto efectivo hay, y el sistema dice qué pagar empezando por lo que vence
 * antes. Lo que no cabe se enseña igual, con propuesto en cero: un reporte que
 * solo listara lo que alcanza escondería justo el dato con el que se pide más
 * efectivo.
 *
 * Convertir la propuesta en pagos genera UN pago por proveedor, con sus
 * facturas ya aplicadas. Se emiten en serie y no en paralelo porque cada uno
 * consume consecutivo y toca los mismos saldos: emitirlos a la vez dejaría el
 * resultado dependiendo del orden en que contesta el servidor.
 *
 * La propuesta es una foto: lo que se emite sale de ella y no se recalcula a
 * media emisión. Cada pago emitido se descuenta del efectivo disponible, y un
 * grupo emitido no se ofrece otra vez. Así, emitir de a uno o en lote nunca
 * suma más que el disponible con el que se calculó. Si se cambian el corte o
 * el disponible, hay que recalcular antes de emitir.
 */

const ETIQUETA_MEDIO: Record<MedioPago, string> = {
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
}

interface Grupo {
  clave: string
  proveedorId: string
  proveedorNombre: string
  moneda: string
  tipoCambio: string
  lineas: LineaPropuestaPago[]
  /** En la moneda del pago. */
  total: string
  /** Su equivalente funcional: es lo que se descuenta del disponible. */
  totalFuncional: string
}

/** Un pago por proveedor y moneda: no se mezclan monedas en un mismo egreso. */
function agrupar(lineas: readonly LineaPropuestaPago[]): Grupo[] {
  const grupos = new Map<string, Grupo>()
  for (const linea of lineas) {
    if (new Decimal(linea.propuesto).lessThanOrEqualTo(0)) continue
    const clave = `${linea.proveedorId}|${linea.moneda}`
    let grupo = grupos.get(clave)
    if (!grupo) {
      grupo = {
        clave,
        proveedorId: linea.proveedorId,
        proveedorNombre: linea.proveedorNombre,
        moneda: linea.moneda,
        tipoCambio: linea.tipoCambio,
        lineas: [],
        total: '0',
        totalFuncional: '0',
      }
      grupos.set(clave, grupo)
    }
    grupo.lineas.push(linea)
    grupo.total = new Decimal(grupo.total).plus(linea.propuesto).toFixed(2)
    grupo.totalFuncional = new Decimal(grupo.totalFuncional)
      .plus(linea.propuestoFuncional)
      .toFixed(2)
  }
  return [...grupos.values()]
}

const plural = (n: number, palabra: string) =>
  `${n} ${palabra}${n === 1 ? '' : 's'}`

export function PropuestaPagoPage() {
  const funcional = monedaFuncional()
  const { data: cuentas = [] } = useCuentas()
  const registrar = useRegistrarPago()
  /** Se pide al pulsar "Calcular": una propuesta que se recalcula a cada tecla
   *  no se puede leer, y una que se recalcula sola a media emisión se paga dos
   *  veces. */
  const calculo = useCalcularPropuestaPago()
  const propuesta = calculo.data

  const [corte, setCorte] = useState(hoyISO)
  // La fecha del egreso no es la del corte: se calcula qué vence a fin de mes
  // y se paga hoy.
  const [fechaPago, setFechaPago] = useState(hoyISO)
  const [disponible, setDisponible] = useState('1000000')
  const [opcionElegida, setOpcionElegida] = useState('')
  const [medioPago, setMedioPago] = useState<MedioPago>('transferencia')
  /** Folio emitido por cada grupo de la propuesta en pantalla. */
  const [emitidos, setEmitidos] = useState<Record<string, string>>({})
  /** Lo emitido de esta propuesta, en moneda funcional. */
  const [consumido, setConsumido] = useState('0')
  const [emitiendo, setEmitiendo] = useState(false)
  /** Grupos que esperan confirmación. Null = no hay diálogo. */
  const [aConfirmar, setAConfirmar] = useState<string[] | null>(null)
  const [errorLote, setErrorLote] = useState<{
    proveedor: string
    error: unknown
  } | null>(null)
  const [intentoEmitir, setIntentoEmitir] = useState(false)

  const { data: cuentasBancarias = [] } = useCuentasBancarias(true)

  const opcionesCuenta = useMemo(
    () => opcionesDeEfectivo(cuentas, cuentasBancarias),
    [cuentas, cuentasBancarias],
  )
  // La ficha bancaria elegida trae las dos cosas que el pago necesita: la
  // cuenta de control del mayor y su auxiliar (docs/06 §1).
  const opcion = opcionesCuenta.find((o) => claveEfectivo(o) === opcionElegida)
  const cuentaSalida = opcion?.codigo ?? ''
  const grupos = useMemo(() => agrupar(propuesta?.lineas ?? []), [propuesta])
  const pendientes = grupos.filter((g) => !emitidos[g.clave])
  const folios = Object.values(emitidos)

  /**
   * La propuesta en pantalla ya no corresponde a los parámetros: el corte
   * cambió, o el disponible no es el calculado menos lo ya emitido. Emitir
   * sobre ella sería pagar con un efectivo que nadie volvió a medir.
   */
  const desactualizada =
    propuesta !== undefined &&
    (corte !== propuesta.corte ||
      !new Decimal(disponible || '0').equals(
        new Decimal(propuesta.disponible).minus(consumido),
      ))

  const errorFechaPago =
    intentoEmitir && fechaPago === '' ? 'Indique la fecha de los pagos' : undefined
  const errorCuenta =
    intentoEmitir && !cuentaSalida ? 'Elija de dónde saldrán los pagos' : undefined

  const calcular = () => {
    setEmitidos({})
    setConsumido('0')
    setErrorLote(null)
    setIntentoEmitir(false)
    registrar.reset()
    calculo.mutate({ corte, disponible: disponible || '0' })
  }

  const solicitudDe = (grupo: Grupo): SolicitudPago => ({
    proveedorId: grupo.proveedorId,
    fecha: fechaPago,
    moneda: grupo.moneda,
    // El de la factura: la propuesta no cambia dinero, solo decide qué pagar.
    // Un tipo de cambio distinto lo captura quien emite el pago a mano, que
    // es a donde lleva "Ajustar" en cada grupo.
    tipoCambio: grupo.tipoCambio,
    cuentaSalida,
    auxiliarBanco: opcion?.auxiliarBanco ?? null,
    medioPago,
    referencia: null,
    importe: grupo.total,
    aplicaciones: grupo.lineas.map((l) => ({
      facturaId: l.facturaId,
      importe: l.propuesto,
    })),
  })

  /** Pide confirmación para emitir estos grupos, si los datos están completos. */
  const pedirConfirmacion = (lote: Grupo[]) => {
    setIntentoEmitir(true)
    if (!cuentaSalida || fechaPago === '' || desactualizada) return
    setErrorLote(null)
    registrar.reset()
    setAConfirmar(lote.map((g) => g.clave))
  }

  /**
   * Emite los grupos en serie y se detiene en el primero que falla.
   *
   * No se relee la propuesta al terminar: cada pago emitido se marca y se
   * descuenta del disponible, y para ver lo que queda se recalcula a mano.
   */
  const emitir = async (lote: Grupo[]) => {
    setErrorLote(null)
    setEmitiendo(true)
    for (const grupo of lote) {
      try {
        const pago = await registrar.mutateAsync(solicitudDe(grupo))
        setEmitidos((prev) => ({ ...prev, [grupo.clave]: pago.folio }))
        setConsumido((prev) =>
          new Decimal(prev).plus(grupo.totalFuncional).toFixed(2),
        )
        setDisponible((prev) =>
          Decimal.max(0, new Decimal(prev || '0').minus(grupo.totalFuncional))
            .toFixed(2),
        )
      } catch (error) {
        setErrorLote({ proveedor: grupo.proveedorNombre, error })
        setEmitiendo(false)
        return
      }
    }
    setEmitiendo(false)
    setAConfirmar(null)
  }

  // Lo que queda por emitir de lo que se pidió confirmar: tras un fallo a
  // medio lote, reintentar no repite los que ya salieron.
  const loteConfirmar = aConfirmar
    ? pendientes.filter((g) => aConfirmar.includes(g.clave))
    : []
  const totalLote = loteConfirmar.reduce(
    (acc, g) => acc.plus(g.totalFuncional),
    new Decimal(0),
  )

  const puedeEmitir =
    pendientes.length > 0 && !emitiendo && !desactualizada

  return (
    <div>
      <PageHeader
        titulo="Propuesta de pago"
        descripcion="Qué pagar a la fecha de corte con el efectivo disponible, empezando por lo que vence antes."
        acciones={<LinkBoton to="/cxp/pagos">Pagos emitidos</LinkBoton>}
      />

      <Card className="mb-4">
        {/* Enter en cualquier parámetro calcula la propuesta. */}
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!calculo.isPending && !emitiendo) calcular()
          }}
        >
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Fecha de corte" requerido ayuda="Qué vence hasta ese día">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={corte}
                  onChange={(e) => setCorte(e.target.value)}
                />
              )}
            </Field>

            <Field
              label="Efectivo disponible"
              requerido
              ayuda={
                new Decimal(consumido).greaterThan(0)
                  ? `Ya descontado lo emitido, en ${funcional}`
                  : `Tope del lote, en ${funcional}`
              }
            >
              {(p) => (
                <MoneyInput
                  {...p}
                  value={disponible}
                  moneda={funcional}
                  onChange={setDisponible}
                />
              )}
            </Field>

            <Field
              label="Fecha de pago"
              requerido
              error={errorFechaPago}
              ayuda={errorFechaPago ? undefined : 'Fecha de los pagos que se emitan'}
            >
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={fechaPago}
                  onChange={(e) => setFechaPago(e.target.value)}
                />
              )}
            </Field>

            <Field
              label="Cuenta de salida"
              error={errorCuenta}
              ayuda={errorCuenta ? undefined : 'De dónde saldrán los pagos'}
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

            <Field label="Medio de pago">
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
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3">
            <Button
              type="submit"
              variante="primario"
              icono={<Search className="size-4" />}
              disabled={calculo.isPending || emitiendo}
            >
              {calculo.isPending ? 'Calculando…' : 'Calcular propuesta'}
            </Button>

            {propuesta && (
              <>
                <Resumen titulo="Propuesto" valor={propuesta.totalPropuesto} />
                <Resumen titulo="Remanente" valor={propuesta.remanente} />
                <Resumen titulo="Sin cubrir" valor={propuesta.sinCubrir} alerta />
                {new Decimal(consumido).greaterThan(0) && (
                  <Resumen titulo="Ya emitido" valor={consumido} />
                )}
                <div className="ml-auto">
                  <Button
                    variante="primario"
                    icono={<Banknote className="size-4" />}
                    onClick={() => pedirConfirmacion(pendientes)}
                    disabled={!puedeEmitir}
                    title="Genera un pago por proveedor con sus facturas aplicadas"
                  >
                    {emitiendo
                      ? 'Emitiendo…'
                      : `Emitir ${plural(pendientes.length, 'pago')}`}
                  </Button>
                </div>
              </>
            )}
          </div>
        </form>

        {desactualizada && (
          <p
            role="status"
            className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
          >
            <CircleAlert className="size-4 shrink-0" />
            El corte o el efectivo disponible cambiaron: recalcule la propuesta
            antes de emitir.
          </p>
        )}

        {folios.length > 0 && (
          <p
            role="status"
            className="flex items-center gap-2 border-t border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800"
          >
            <CircleCheck className="size-4 shrink-0" />
            Emitidos {plural(folios.length, 'pago')}: {folios.join(', ')}. Se
            descontaron del efectivo disponible.{' '}
            {pendientes.length === 0 &&
              'Recalcule para ver lo que queda pendiente. '}
            <Link to="/cxp/pagos" className="underline">
              Ver el listado
            </Link>
          </p>
        )}

        {errorLote && aConfirmar === null && (
          <div className="border-t border-red-200 px-4 py-2">
            <MensajeError error={errorLote.error} />
            <p className="mt-1 text-xs text-red-700">
              Falló el pago de {errorLote.proveedor}. El lote se detuvo ahí: los
              anteriores ya están emitidos.
            </p>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          titulo="Facturas a la fecha de corte"
          descripcion={
            propuesta
              ? `Al ${formatFecha(propuesta.corte)}. Lo propuesto se mide contra el disponible en ${propuesta.moneda}.`
              : 'Elija el corte y el efectivo disponible, y calcule la propuesta.'
          }
        />

        {calculo.isError ? (
          <EstadoError
            titulo="No se pudo calcular la propuesta"
            error={calculo.error}
            onReintentar={calcular}
            reintentando={calculo.isPending}
          />
        ) : calculo.isPending ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500" aria-busy>
            Calculando…
          </p>
        ) : !propuesta ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Todavía no hay propuesta. Pulse «Calcular propuesta».
          </p>
        ) : propuesta.lineas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            No hay facturas con saldo a esa fecha de corte.
          </p>
        ) : (
          <table className="w-full text-sm" aria-label="Propuesta de pago">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left">Folio</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="w-28 px-3 py-2 text-left">Vence</th>
                <th className="w-20 px-3 py-2 text-right">Días</th>
                <th className="w-36 px-3 py-2 text-right">Saldo</th>
                <th className="w-36 px-3 py-2 text-right">Propuesto</th>
                <th className="w-28 px-4 py-2 text-left">Cubre</th>
              </tr>
            </thead>
            <tbody>
              {propuesta.lineas.map((linea) => (
                <tr
                  key={linea.facturaId}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-1.5">
                    <Link
                      to={`/cxp/facturas/${linea.facturaId}`}
                      className="font-mono text-xs font-medium text-brand-700 hover:underline"
                    >
                      {linea.folioProveedor}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">
                    {linea.proveedorNombre}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">
                    {formatFecha(linea.fechaVencimiento)}
                  </td>
                  <td
                    className={`tabular px-3 py-1.5 text-right text-xs ${
                      linea.diasVencidos > 0
                        ? 'font-medium text-red-600'
                        : 'text-slate-400'
                    }`}
                  >
                    {linea.diasVencidos > 0
                      ? linea.diasVencidos
                      : -linea.diasVencidos}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <MoneyCell valor={linea.saldo} moneda={linea.moneda} />
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium">
                    <MoneyCell
                      valor={linea.propuesto}
                      moneda={linea.moneda}
                      ocultarCero
                    />
                  </td>
                  <td className="px-4 py-1.5 text-xs">
                    {linea.salda ? (
                      <span className="text-emerald-700">Salda</span>
                    ) : new Decimal(linea.propuesto).greaterThan(0) ? (
                      <span className="text-amber-700">Parcial</span>
                    ) : (
                      <span className="text-slate-400">No alcanza</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold text-slate-800">
              <tr>
                <td colSpan={4} className="px-4 py-2 text-right text-xs">
                  Totales en {propuesta.moneda}
                </td>
                <td className="px-3 py-2 text-right">
                  <MoneyCell valor={propuesta.totalPendiente} />
                </td>
                <td className="px-3 py-2 text-right">
                  <MoneyCell valor={propuesta.totalPropuesto} />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {grupos.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            titulo="Pagos que se generarán"
            descripcion="Uno por proveedor, con sus facturas ya aplicadas. «Ajustar» abre la captura del pago de ese proveedor para cambiar importe o tipo de cambio."
          />
          <ul className="divide-y divide-slate-100">
            {grupos.map((grupo) => {
              const folio = emitidos[grupo.clave]
              return (
                <li
                  key={grupo.clave}
                  className="flex items-center gap-3 px-4 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-slate-700">
                    {grupo.proveedorNombre}
                  </span>
                  <span className="text-xs text-slate-500">
                    {plural(grupo.lineas.length, 'factura')}
                  </span>
                  <span className="w-36 text-right">
                    <MoneyCell valor={grupo.total} moneda={grupo.moneda} />
                  </span>
                  {folio ? (
                    <span className="w-32 text-right text-xs font-medium text-emerald-700">
                      Emitido {folio}
                    </span>
                  ) : (
                    <span className="flex w-32 justify-end gap-2">
                      <LinkBoton
                        tamano="sm"
                        to={`/cxp/pagos/nuevo?proveedor=${encodeURIComponent(grupo.proveedorId)}`}
                      >
                        Ajustar
                      </LinkBoton>
                      <Button
                        tamano="sm"
                        onClick={() => pedirConfirmacion([grupo])}
                        disabled={!puedeEmitir}
                        aria-label={`Emitir el pago de ${grupo.proveedorNombre}`}
                      >
                        Emitir
                      </Button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {aConfirmar !== null && (
        <DialogoConfirmacion
          abierto
          titulo={`¿Emitir ${plural(loteConfirmar.length, 'pago')}?`}
          descripcion="Cada pago contabiliza su egreso y baja el saldo de sus facturas. No se deshace sin anularlo."
          textoConfirmar="Confirmar y emitir"
          textoConfirmando="Emitiendo…"
          pendiente={emitiendo}
          error={errorLote?.error}
          onConfirmar={() => void emitir(loteConfirmar)}
          onCancelar={() => setAConfirmar(null)}
        >
          <p>
            {plural(loteConfirmar.length, 'pago')} por un total de{' '}
            <strong>
              <MoneyCell valor={totalLote.toFixed(2)} mostrarSimbolo />
            </strong>
            , con fecha {formatFecha(fechaPago)}, desde{' '}
            {opcion?.nombre ?? cuentaSalida}.
          </p>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-xs">
            {loteConfirmar.map((g) => (
              <li key={g.clave} className="flex justify-between gap-3 px-3 py-1.5">
                <span className="truncate">{g.proveedorNombre}</span>
                <MoneyCell valor={g.total} moneda={g.moneda} mostrarSimbolo />
              </li>
            ))}
          </ul>
          {errorLote && (
            <p className="text-xs text-red-700">
              Falló el pago de {errorLote.proveedor}. Los anteriores ya están
              emitidos; confirmar de nuevo reintenta solo los que faltan.
            </p>
          )}
        </DialogoConfirmacion>
      )}
    </div>
  )
}

function Resumen({
  titulo,
  valor,
  alerta,
}: {
  titulo: string
  valor: string
  alerta?: boolean
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
      <p className="text-[11px] text-slate-500">{titulo}</p>
      <p
        className={`text-sm font-semibold ${alerta ? 'text-red-600' : 'text-slate-900'}`}
      >
        <MoneyCell valor={valor} mostrarSimbolo />
      </p>
    </div>
  )
}
