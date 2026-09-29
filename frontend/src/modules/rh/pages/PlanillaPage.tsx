import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Calculator, Download, Landmark, Stamp, TriangleAlert } from 'lucide-react'
import Decimal from 'decimal.js'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { Field, Input, Select } from '@/shared/ui/Field'
import { DialogoConfirmacion } from '@/shared/ui/DialogoConfirmacion'
import { ResumenErrores } from '@/shared/ui/ResumenErrores'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { monedaFuncional } from '@/shared/money/money'
import { AsientoPropuesto } from '@/shared/asiento/AsientoPropuesto'
import { formatPeriodo } from '@/shared/format/fecha'
import { useCuentas, useCuentasBancarias } from '@/shared/api/catalogos'
import { usePeriodoEnUrl } from '@/shared/hooks/usePeriodoEnUrl'
import type { Incidencia, Planilla } from '@/shared/api/contracts/rh'
import { useAcceso } from '@/app/acceso'
import { cn } from '@/shared/ui/cn'
import { estaEnPlanilla, INCIDENCIA_VACIA, requiereRevision } from '../domain/calculo'
import { asientoDePlanilla } from '../domain/asiento'
import { archivoDePago, archivoSicere } from '../domain/archivos'
import {
  useCalcularPlanilla,
  useContabilizarPlanilla,
  useEmpleados,
  useMapeoRh,
  usePagarPlanilla,
  usePlanillas,
} from '../api/queries'

/**
 * La planilla de un mes (docs/08 §3).
 *
 *   incidencias → calcular → revisar → contabilizar → pagar
 *
 * Todo en una pantalla porque es un solo ciclo y se recorre de arriba abajo.
 * Calcular se puede repetir: cambian las horas extra de alguien, se vuelve a
 * calcular. Contabilizar es el punto sin vuelta atrás: desde ahí, cambiarla es
 * reversar su asiento en contabilidad.
 *
 * La revisión se enseña antes de contabilizar y no después: una variación de
 * más del 10 % contra el mes anterior es donde aparece casi todo error de
 * planilla (docs/08 §3).
 */
export function PlanillaPage() {
  const periodo = usePeriodoEnUrl()
  const { puede } = useAcceso()
  const operar = puede('planilla.operar')
  const empleados = useEmpleados()
  const planillas = usePlanillas()
  const { data: mapeo } = useMapeoRh()
  const { data: cuentas = [] } = useCuentas()
  const { data: bancos = [] } = useCuentasBancarias(true)

  const calcular = useCalcularPlanilla()
  const contabilizar = useContabilizarPlanilla()
  const pagar = usePagarPlanilla()

  const planilla = planillas.data?.find((p) => p.periodoId === periodo?.id)
  const enPlanilla = useMemo(
    () =>
      periodo
        ? (empleados.data ?? [])
            .filter((e) => estaEnPlanilla(e, periodo))
            .sort((a, b) => a.codigo.localeCompare(b.codigo))
        : [],
    [empleados.data, periodo],
  )

  const [incidencias, setIncidencias] = useState<Record<string, Incidencia>>({})
  const [pyme, setPyme] = useState(false)
  const [fechaPago, setFechaPago] = useState('')
  const [confirmando, setConfirmando] = useState<'contabilizar' | 'pagar' | null>(null)
  const [cuentaBancariaId, setCuentaBancariaId] = useState('')
  const [fallos, setFallos] = useState(0)

  // Al cambiar de mes, o cuando llega la planilla guardada, las incidencias y
  // la fecha de pago son las de ese mes.
  useEffect(() => {
    if (!periodo) return
    setIncidencias(
      Object.fromEntries((planilla?.incidencias ?? []).map((i) => [i.empleadoId, i])),
    )
    setPyme(planilla?.pymeMenosDe5 ?? false)
    setFechaPago(planilla?.fechaPago ?? periodo.fechaFin)
  }, [periodo, planilla])

  const funcional = monedaFuncional()
  const bancosCrc = bancos.filter((b) => b.moneda === funcional)
  useEffect(() => {
    if (!cuentaBancariaId && bancosCrc.length > 0) setCuentaBancariaId(bancosCrc[0].id)
  }, [cuentaBancariaId, bancosCrc])

  const incidenciaDe = (id: string) => incidencias[id] ?? INCIDENCIA_VACIA(id)
  const cambiarIncidencia = <K extends keyof Incidencia>(id: string, campo: K, valor: Incidencia[K]) =>
    setIncidencias((prev) => ({ ...prev, [id]: { ...incidenciaDe(id), [campo]: valor } }))

  const editable = operar && (!planilla || planilla.estado === 'calculada')
  const etiqueta = periodo ? formatPeriodo(periodo.ejercicio, periodo.numero) : ''

  const ejecutarCalculo = () => {
    if (!periodo || calcular.isPending) return
    calcular.mutate(
      {
        periodoId: periodo.id,
        fechaPago: fechaPago || periodo.fechaFin,
        pymeMenosDe5: pyme,
        // Solo las que dicen algo: una incidencia en cero es la que no hubo.
        incidencias: Object.values(incidencias).filter(
          (i) =>
            Number(i.horasExtra) !== 0 ||
            Number(i.bonificaciones) !== 0 ||
            i.diasSinGoce !== 0 ||
            Number(i.otrasDeducciones) !== 0,
        ),
      },
      { onError: () => setFallos((n) => n + 1) },
    )
  }

  const asiento = planilla && mapeo ? asientoDePlanilla(planilla, mapeo, etiqueta, funcional) : null
  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? codigo
  const aRevisar = planilla?.lineas.filter(requiereRevision) ?? []

  if (empleados.isError || planillas.isError) {
    return (
      <EstadoError
        error={empleados.error ?? planillas.error}
        onReintentar={() => {
          void empleados.refetch()
          void planillas.refetch()
        }}
      />
    )
  }

  return (
    <div>
      <PageHeader
        titulo={`Planilla de ${etiqueta}`}
        descripcion="Salarios, cargas sociales, impuesto al salario y provisiones del mes, con los parámetros vigentes al cierre del mes."
        acciones={planilla && <EstadoBadge estado={planilla.estado} />}
      />

      <Card>
        <CardHeader
          titulo="Incidencias del mes"
          descripcion="Lo que cambia respecto del salario ordinario. Vacío es cero."
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left">Empleado</th>
                <th className="w-36 px-3 py-2 text-right">Salario base</th>
                <th className="w-28 px-3 py-2 text-right">Horas extra</th>
                <th className="w-40 px-3 py-2 text-right">Bonificaciones</th>
                <th className="w-28 px-3 py-2 text-right">Días sin goce</th>
                <th className="w-40 px-3 py-2 text-right">Otras deducciones</th>
              </tr>
            </thead>
            <tbody>
              {enPlanilla.map((e) => {
                const i = incidenciaDe(e.id)
                return (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-1.5 text-slate-800">
                      {e.nombre}
                      <span className="ml-1.5 text-xs text-slate-400">{e.codigo}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <MoneyCell valor={e.salarioBase} />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        aria-label={`Horas extra de ${e.nombre}`}
                        inputMode="decimal"
                        className="tabular h-8 text-right"
                        disabled={!editable}
                        value={i.horasExtra === '0' ? '' : i.horasExtra}
                        placeholder="0"
                        onChange={(ev) => cambiarIncidencia(e.id, 'horasExtra', ev.target.value.replace(',', '.') || '0')}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <MoneyInput
                        aria-label={`Bonificaciones de ${e.nombre}`}
                        moneda={funcional}
                        className="h-8"
                        disabled={!editable}
                        value={i.bonificaciones === '0' ? '' : i.bonificaciones}
                        onChange={(v) => cambiarIncidencia(e.id, 'bonificaciones', v || '0')}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        aria-label={`Días sin goce de ${e.nombre}`}
                        type="number"
                        min={0}
                        max={30}
                        className="tabular h-8 text-right"
                        disabled={!editable}
                        value={i.diasSinGoce || ''}
                        placeholder="0"
                        onChange={(ev) =>
                          cambiarIncidencia(e.id, 'diasSinGoce', Math.min(30, Math.max(0, Number(ev.target.value) || 0)))
                        }
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <MoneyInput
                        aria-label={`Otras deducciones de ${e.nombre}`}
                        moneda={funcional}
                        className="h-8"
                        disabled={!editable}
                        value={i.otrasDeducciones === '0' ? '' : i.otrasDeducciones}
                        onChange={(v) => cambiarIncidencia(e.id, 'otrasDeducciones', v || '0')}
                      />
                    </td>
                  </tr>
                )
              })}
              {enPlanilla.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                    No hay empleados contratados en {etiqueta}.{' '}
                    <Link to="/rh/empleados" className="text-brand-700 underline">
                      Ver empleados
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-4 border-t border-slate-200 px-4 py-3">
          <Field label="Fecha de pago">
            {(p) => (
              <Input
                {...p}
                type="date"
                disabled={!editable}
                value={fechaPago}
                onChange={(e) => setFechaPago(e.target.value)}
              />
            )}
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={pyme}
              disabled={!editable}
              className="size-4 accent-brand-600"
              onChange={(e) => setPyme(e.target.checked)}
            />
            Patrono no agropecuario con menos de cinco trabajadores (sin INA)
          </label>
          {editable && (
            <Button
              variante="primario"
              className="ml-auto"
              icono={<Calculator className="size-4" />}
              onClick={ejecutarCalculo}
              disabled={calcular.isPending || enPlanilla.length === 0}
            >
              {calcular.isPending ? 'Calculando…' : planilla ? 'Recalcular' : 'Calcular planilla'}
            </Button>
          )}
        </div>
      </Card>

      {planilla && (
        <TablaPlanilla planilla={planilla} aRevisar={aRevisar.length} />
      )}

      {planilla && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            icono={<Download className="size-4" />}
            onClick={() => archivoDePago(planilla, empleados.data ?? [])}
          >
            Archivo de pago
          </Button>
          <Button
            icono={<Download className="size-4" />}
            onClick={() => archivoSicere(planilla, empleados.data ?? [], etiqueta)}
          >
            Planilla para la CCSS
          </Button>
          {planilla.asientoId && (
            <Link
              to={`/conta/asientos?asiento=${encodeURIComponent(planilla.asientoId)}`}
              className="text-sm text-brand-700 underline"
            >
              Ver el asiento de la planilla
            </Link>
          )}
          {planilla.asientoPagoId && (
            <Link
              to={`/conta/asientos?asiento=${encodeURIComponent(planilla.asientoPagoId)}`}
              className="text-sm text-brand-700 underline"
            >
              Ver el asiento del pago
            </Link>
          )}
          {operar && planilla.estado === 'calculada' && (
            <Button
              variante="primario"
              className="ml-auto"
              icono={<Stamp className="size-4" />}
              onClick={() => setConfirmando('contabilizar')}
            >
              Contabilizar
            </Button>
          )}
          {operar && planilla.estado === 'contabilizada' && (
            <div className="ml-auto flex items-end gap-2">
              <Field label="Pagar desde">
                {(p) => (
                  <Select
                    {...p}
                    value={cuentaBancariaId}
                    onChange={(e) => setCuentaBancariaId(e.target.value)}
                  >
                    {bancosCrc.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nombre} · {b.banco}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button
                variante="primario"
                icono={<Landmark className="size-4" />}
                disabled={!cuentaBancariaId}
                onClick={() => setConfirmando('pagar')}
              >
                Registrar el pago
              </Button>
            </div>
          )}
        </div>
      )}

      <ResumenErrores
        titulo="La planilla no se pudo calcular"
        errores={[]}
        errorServidor={calcular.error}
        senal={fallos}
      />

      {planilla && (
        <>
          <DialogoConfirmacion
            abierto={confirmando === 'contabilizar'}
            titulo={`Contabilizar la planilla de ${etiqueta}`}
            textoConfirmar="Contabilizar"
            textoConfirmando="Contabilizando…"
            pendiente={contabilizar.isPending}
            error={contabilizar.error}
            onConfirmar={() =>
              contabilizar.mutate(planilla.id, { onSuccess: () => setConfirmando(null) })
            }
            onCancelar={() => {
              setConfirmando(null)
              contabilizar.reset()
            }}
          >
            <p>
              Desde ahora la planilla no se recalcula: cambiarla es reversar su asiento. Este es el
              asiento que se va a registrar, con las provisiones del mes:
            </p>
            {asiento && <AsientoPropuesto asiento={asiento} nombreCuenta={nombreCuenta} />}
          </DialogoConfirmacion>

          <DialogoConfirmacion
            abierto={confirmando === 'pagar'}
            titulo={`Pagar la planilla de ${etiqueta}`}
            textoConfirmar="Registrar el pago"
            textoConfirmando="Registrando…"
            pendiente={pagar.isPending}
            error={pagar.error}
            onConfirmar={() =>
              pagar.mutate(
                { id: planilla.id, solicitud: { cuentaBancariaId, fecha: planilla.fechaPago } },
                { onSuccess: () => setConfirmando(null) },
              )
            }
            onCancelar={() => {
              setConfirmando(null)
              pagar.reset()
            }}
          >
            <p>
              Se registra la salida de {new Decimal(planilla.totalNeto).toFixed(2)} {funcional} el{' '}
              {planilla.fechaPago}, que deja en cero los sueldos por pagar de cada empleado y aparece
              en los movimientos del banco para conciliarse.
            </p>
          </DialogoConfirmacion>
        </>
      )}
    </div>
  )
}

function TablaPlanilla({ planilla, aRevisar }: { planilla: Planilla; aRevisar: number }) {
  return (
    <Card className="mt-4">
      <CardHeader
        titulo="Planilla calculada"
        descripcion={`${planilla.lineas.length} empleados · parámetros ${planilla.parametrosId}`}
      />
      {aRevisar > 0 && (
        <p className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <TriangleAlert className="size-4 shrink-0" />
          {aRevisar} empleado{aRevisar === 1 ? '' : 's'} con una variación de más del 10 % contra
          la planilla anterior. Revíselos antes de contabilizar.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Empleado</th>
              <th className="px-3 py-2 text-right">Bruto</th>
              <th className="px-3 py-2 text-right">CCSS trabajador</th>
              <th className="px-3 py-2 text-right">Renta</th>
              <th className="px-3 py-2 text-right">Otras</th>
              <th className="px-3 py-2 text-right">Neto</th>
              <th className="px-3 py-2 text-right">CCSS patrono</th>
              <th className="px-3 py-2 text-right">Variación</th>
            </tr>
          </thead>
          <tbody>
            {planilla.lineas.map((l) => (
              <tr key={l.empleadoId} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-1.5 text-slate-800">{l.empleadoNombre}</td>
                <td className="px-3 py-1.5 text-right"><MoneyCell valor={l.bruto} /></td>
                <td className="px-3 py-1.5 text-right"><MoneyCell valor={l.cargasTrabajador} /></td>
                <td className="px-3 py-1.5 text-right"><MoneyCell valor={l.impuestoRenta} ocultarCero /></td>
                <td className="px-3 py-1.5 text-right"><MoneyCell valor={l.otrasDeducciones} ocultarCero /></td>
                <td className="px-3 py-1.5 text-right font-medium"><MoneyCell valor={l.neto} /></td>
                <td className="px-3 py-1.5 text-right text-slate-500"><MoneyCell valor={l.cargasPatrono} /></td>
                <td
                  className={cn(
                    'tabular px-3 py-1.5 text-right text-xs',
                    requiereRevision(l) ? 'font-semibold text-amber-700' : 'text-slate-500',
                  )}
                >
                  {l.variacion === null ? 'n/a' : `${l.variacion} %`}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold text-slate-900">
            <tr>
              <td className="px-4 py-2">Totales</td>
              <td className="px-3 py-2 text-right"><MoneyCell valor={planilla.totalBruto} /></td>
              <td className="px-3 py-2 text-right"><MoneyCell valor={planilla.totalCargasTrabajador} /></td>
              <td className="px-3 py-2 text-right"><MoneyCell valor={planilla.totalRenta} /></td>
              <td className="px-3 py-2 text-right"><MoneyCell valor={planilla.totalOtrasDeducciones} /></td>
              <td className="px-3 py-2 text-right"><MoneyCell valor={planilla.totalNeto} /></td>
              <td className="px-3 py-2 text-right"><MoneyCell valor={planilla.totalCargasPatrono} /></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
        Provisiones del mes (aguinaldo, vacaciones y cesantía):{' '}
        <MoneyCell valor={planilla.totalProvisiones} />. El costo total para la empresa es el bruto
        más las cargas patronales y las provisiones.
      </p>
    </Card>
  )
}
