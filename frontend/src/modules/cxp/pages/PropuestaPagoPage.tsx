import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import Decimal from 'decimal.js'
import { Banknote, CircleAlert, CircleCheck, Search } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { ApiError } from '@/shared/api/client'
import { useCuentas, useCuentasBancarias } from '@/shared/api/catalogos'
import { monedaFuncional } from '@/shared/money/money'
import type {
  LineaPropuestaPago,
  MedioPago,
  SolicitudPago,
} from '@/shared/api/contracts/cxp'
import { MEDIOS_PAGO } from '@/shared/api/contracts/cxp'
import { usePropuestaPago, useRegistrarPago } from '../api/queries'
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
 */

const ETIQUETA_MEDIO: Record<MedioPago, string> = {
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
}

interface Grupo {
  proveedorId: string
  proveedorNombre: string
  moneda: string
  tipoCambio: string
  lineas: LineaPropuestaPago[]
  total: string
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
        proveedorId: linea.proveedorId,
        proveedorNombre: linea.proveedorNombre,
        moneda: linea.moneda,
        tipoCambio: linea.tipoCambio,
        lineas: [],
        total: '0',
      }
      grupos.set(clave, grupo)
    }
    grupo.lineas.push(linea)
    grupo.total = new Decimal(grupo.total).plus(new Decimal(linea.propuesto)).toFixed(2)
  }
  return [...grupos.values()]
}

export function PropuestaPagoPage() {
  const funcional = monedaFuncional()
  const { data: cuentas = [] } = useCuentas()
  const registrar = useRegistrarPago()

  const [corte, setCorte] = useState(hoyISO)
  const [disponible, setDisponible] = useState('1000000')
  const [opcionElegida, setOpcionElegida] = useState('')
  const [medioPago, setMedioPago] = useState<MedioPago>('transferencia')
  /** Se pide al pulsar "Calcular": una propuesta que se recalcula a cada tecla
   *  no se puede leer. */
  const [consulta, setConsulta] = useState<{ corte: string; disponible: string } | null>(
    null,
  )
  const [emitidos, setEmitidos] = useState<string[]>([])
  const [errorLote, setErrorLote] = useState<string | null>(null)

  const propuesta = usePropuestaPago(
    consulta?.corte ?? corte,
    consulta?.disponible ?? disponible,
    consulta !== null,
  )

  const { data: cuentasBancarias = [] } = useCuentasBancarias(true)

  const opcionesCuenta = useMemo(
    () => opcionesDeEfectivo(cuentas, cuentasBancarias),
    [cuentas, cuentasBancarias],
  )
  // La ficha bancaria elegida trae las dos cosas que el pago necesita: la
  // cuenta de control del mayor y su auxiliar (docs/06 §1).
  const opcion = opcionesCuenta.find((o) => claveEfectivo(o) === opcionElegida)
  const cuentaSalida = opcion?.codigo ?? ''
  const grupos = useMemo(
    () => agrupar(propuesta.data?.lineas ?? []),
    [propuesta.data],
  )

  const calcular = () => {
    setEmitidos([])
    setErrorLote(null)
    registrar.reset()
    setConsulta({ corte, disponible: disponible || '0' })
  }

  const solicitudDe = (grupo: Grupo): SolicitudPago => ({
    proveedorId: grupo.proveedorId,
    fecha: consulta?.corte ?? corte,
    moneda: grupo.moneda,
    // El de la factura: la propuesta no cambia dinero, solo decide qué pagar.
    // Un tipo de cambio distinto lo captura quien emite el pago a mano.
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

  /** Emite los grupos en serie y se detiene en el primero que falla. */
  const emitir = async (aEmitir: Grupo[]) => {
    setErrorLote(null)
    for (const grupo of aEmitir) {
      try {
        const pago = await registrar.mutateAsync(solicitudDe(grupo))
        setEmitidos((prev) => [...prev, pago.folio])
      } catch (error) {
        setErrorLote(
          error instanceof ApiError
            ? `${grupo.proveedorNombre}: ${error.message}`
            : `No se pudo emitir el pago de ${grupo.proveedorNombre}`,
        )
        return
      }
    }
    // Los saldos cambiaron: la propuesta que hay en pantalla ya no vale.
    void propuesta.refetch()
  }

  const puedeEmitir = Boolean(cuentaSalida) && grupos.length > 0

  return (
    <div>
      <PageHeader
        titulo="Propuesta de pago"
        descripcion="Qué pagar a la fecha de corte con el efectivo disponible, empezando por lo que vence antes."
        acciones={
          <Link to="/cxp/pagos">
            <Button>Pagos emitidos</Button>
          </Link>
        }
      />

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Fecha de corte" requerido>
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
            ayuda={`Tope del lote, en ${funcional}`}
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

          <Field label="Cuenta de salida" ayuda="De dónde saldrán los pagos">
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
            variante="primario"
            icono={<Search className="size-4" />}
            onClick={calcular}
            disabled={propuesta.isFetching}
          >
            {propuesta.isFetching ? 'Calculando…' : 'Calcular propuesta'}
          </Button>

          {propuesta.data && (
            <>
              <Resumen titulo="Propuesto" valor={propuesta.data.totalPropuesto} />
              <Resumen titulo="Remanente" valor={propuesta.data.remanente} />
              <Resumen
                titulo="Sin cubrir"
                valor={propuesta.data.sinCubrir}
                alerta
              />
              <div className="ml-auto">
                <Button
                  variante="primario"
                  icono={<Banknote className="size-4" />}
                  onClick={() => void emitir(grupos)}
                  disabled={!puedeEmitir || registrar.isPending}
                  title={
                    cuentaSalida
                      ? 'Genera un pago por proveedor con sus facturas aplicadas'
                      : 'Elija primero la cuenta de salida'
                  }
                >
                  {registrar.isPending
                    ? 'Emitiendo…'
                    : `Emitir ${grupos.length} pago${grupos.length === 1 ? '' : 's'}`}
                </Button>
              </div>
            </>
          )}
        </div>

        {emitidos.length > 0 && (
          <p
            role="status"
            className="flex items-center gap-2 border-t border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800"
          >
            <CircleCheck className="size-4 shrink-0" />
            Emitidos {emitidos.length} pago{emitidos.length === 1 ? '' : 's'}:{' '}
            {emitidos.join(', ')}.{' '}
            <Link to="/cxp/pagos" className="underline">
              Ver el listado
            </Link>
          </p>
        )}

        {errorLote && (
          <p className="flex items-center gap-2 border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            <CircleAlert className="size-4 shrink-0" />
            {errorLote} El lote se detuvo ahí: los anteriores ya están emitidos.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader
          titulo="Facturas a la fecha de corte"
          descripcion={
            propuesta.data
              ? `Al ${formatFecha(propuesta.data.corte)}. Lo propuesto se mide contra el disponible en ${propuesta.data.moneda}.`
              : 'Elija el corte y el efectivo disponible, y calcule la propuesta.'
          }
        />

        {!consulta ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Todavía no hay propuesta. Pulse «Calcular propuesta».
          </p>
        ) : propuesta.isFetching ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Calculando…
          </p>
        ) : (propuesta.data?.lineas.length ?? 0) === 0 ? (
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
              {propuesta.data?.lineas.map((linea) => (
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
                  Totales en {propuesta.data?.moneda}
                </td>
                <td className="px-3 py-2 text-right">
                  <MoneyCell valor={propuesta.data?.totalPendiente} />
                </td>
                <td className="px-3 py-2 text-right">
                  <MoneyCell valor={propuesta.data?.totalPropuesto} />
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
            descripcion="Uno por proveedor, con sus facturas ya aplicadas."
          />
          <ul className="divide-y divide-slate-100">
            {grupos.map((grupo) => (
              <li
                key={`${grupo.proveedorId}-${grupo.moneda}`}
                className="flex items-center gap-3 px-4 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {grupo.proveedorNombre}
                </span>
                <span className="text-xs text-slate-500">
                  {grupo.lineas.length} factura
                  {grupo.lineas.length === 1 ? '' : 's'}
                </span>
                <span className="w-36 text-right">
                  <MoneyCell valor={grupo.total} moneda={grupo.moneda} />
                </span>
                <Button
                  tamano="sm"
                  onClick={() => void emitir([grupo])}
                  disabled={!cuentaSalida || registrar.isPending}
                >
                  Emitir
                </Button>
              </li>
            ))}
          </ul>
        </Card>
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
