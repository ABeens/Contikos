import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import Decimal from 'decimal.js'
import { Card, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { Select } from '@/shared/ui/Field'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { monedaFuncional } from '@/shared/money/money'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { servicioCxc, servicioCxp, servicioRh } from '@/shared/api/servicios'
import { useCuentasBancarias, usePeriodos } from '@/shared/api/catalogos'
import { useAcceso } from '@/app/acceso'
import { cn } from '@/shared/ui/cn'
import {
  flujosDeCartera,
  flujosDePlanilla,
  proyectar,
  type OrigenFlujo,
} from '../domain/proyeccion'

const SEMANAS = 13

const ETIQUETA: Record<OrigenFlujo, string> = {
  cxc: 'Cobros',
  cxp: 'Pagos a proveedores',
  planilla: 'Planilla',
  cargas: 'Cargas sociales',
  renta: 'Impuesto al salario',
}

/**
 * Flujo de efectivo proyectado a trece semanas (docs/06, docs/17 §3).
 *
 * Lee de tres módulos por sus APIs, sin importar ninguno (docs/14 §3.1): las
 * facturas por cobrar, las por pagar y la planilla. Las claves de caché son
 * las mismas que usan esos módulos, así que una factura emitida en otra
 * pantalla mueve esta proyección sin recargar.
 *
 * La planilla solo entra si quien mira tiene permiso para verla: sin él, la
 * proyección lo dice en vez de enseñar una caja más holgada de lo que es.
 */
export function ProyeccionPage() {
  const corte = hoyISO()
  const funcional = monedaFuncional()
  const { puede } = useAcceso()
  const verPlanilla = puede('planilla.ver')
  const [moneda, setMoneda] = useState(funcional)
  const [incluirVencido, setIncluirVencido] = useState(false)
  const [abierta, setAbierta] = useState<number | null>(null)

  const cuentas = useCuentasBancarias(true)
  const { data: periodos = [] } = usePeriodos()
  const cxc = useQuery({
    queryKey: ['cxc', 'facturas', 'todas'],
    queryFn: ({ signal }) => servicioCxc.listarFacturas({}, { signal }),
  })
  const cxp = useQuery({
    queryKey: ['cxp', 'facturas', 'todas'],
    queryFn: ({ signal }) => servicioCxp.listarFacturas({}, { signal }),
  })
  const planillas = useQuery({
    queryKey: ['rh', 'planillas'],
    queryFn: ({ signal }) => servicioRh.listarPlanillas({ signal }),
    enabled: verPlanilla,
  })

  const monedas = useMemo(
    () => [...new Set((cuentas.data ?? []).map((c) => c.moneda))].sort(),
    [cuentas.data],
  )

  const proyeccion = useMemo(() => {
    if (!cuentas.data || !cxc.data || !cxp.data) return undefined
    const hasta = new Date(`${corte}T00:00:00Z`)
    hasta.setUTCDate(hasta.getUTCDate() + SEMANAS * 7 - 1)

    const saldoInicial = cuentas.data
      .filter((c) => c.moneda === moneda)
      .reduce((acc, c) => acc.plus(c.saldoLibros), new Decimal(0))

    const cartera = flujosDeCartera({
      porCobrar: cxc.data
        .filter((f) => f.estado === 'contabilizada')
        .map((f) => ({
          numero: f.numeroInterno,
          tercero: f.clienteNombre,
          fechaVencimiento: f.fechaVencimiento,
          saldo: f.saldo,
          moneda: f.moneda,
        })),
      porPagar: cxp.data
        .filter((f) => f.estado === 'contabilizada')
        .map((f) => ({
          numero: f.folioInterno,
          tercero: f.proveedorNombre,
          fechaVencimiento: f.fechaVencimiento,
          saldo: f.saldo,
          moneda: f.moneda,
        })),
      moneda,
      corte,
      incluirVencidoPorCobrar: incluirVencido,
    })

    // La planilla se paga en moneda funcional: en otra moneda no hay nada que
    // proyectar de ella.
    const deplanilla =
      moneda === funcional && planillas.data
        ? flujosDePlanilla({
            planillas: planillas.data.map((p) => ({
              finDeMes: periodos.find((x) => x.id === p.periodoId)?.fechaFin ?? p.fechaPago,
              neto: p.totalNeto,
              cargas: new Decimal(p.totalCargasTrabajador).plus(p.totalCargasPatrono).toFixed(2),
              renta: p.totalRenta,
              pagada: p.estado === 'pagada',
            })),
            corte,
            hasta: hasta.toISOString().slice(0, 10),
          })
        : []

    return proyectar({
      corte,
      semanas: SEMANAS,
      saldoInicial,
      flujos: [...cartera.flujos, ...deplanilla],
      vencidoPorCobrar: cartera.vencidoPorCobrar,
    })
  }, [cuentas.data, cxc.data, cxp.data, planillas.data, periodos, moneda, funcional, corte, incluirVencido])

  const error = cuentas.error ?? cxc.error ?? cxp.error ?? planillas.error

  return (
    <div>
      <PageHeader
        titulo="Flujo de efectivo proyectado"
        descripcion="Trece semanas desde hoy: el saldo en libros de las cuentas bancarias, más lo que vence por cobrar y menos lo que vence por pagar."
      />

      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <label className="flex items-center gap-2">
          Moneda
          <Select
            aria-label="Moneda"
            className="h-7 w-24 py-0 text-xs"
            value={moneda}
            onChange={(e) => setMoneda(e.target.value)}
          >
            {(monedas.length ? monedas : [funcional]).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={incluirVencido}
            className="size-3.5 rounded border-slate-300"
            onChange={(e) => setIncluirVencido(e.target.checked)}
          />
          Incluir lo vencido por cobrar en la primera semana
        </label>
      </div>

      {!verPlanilla && moneda === funcional && (
        <p className="mb-3 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
          <TriangleAlert className="size-4 shrink-0" />
          Su rol no ve la planilla, así que no está en la proyección. La caja real va a quedar más
          baja que esta.
        </p>
      )}

      {proyeccion && new Decimal(proyeccion.vencidoPorCobrar).greaterThan(0) && !incluirVencido && (
        <p className="mb-3 text-xs text-slate-600">
          Hay <MoneyCell valor={proyeccion.vencidoPorCobrar} moneda={moneda} /> vencidos por cobrar
          que no se cuentan: ya debieron entrar y no entraron.
        </p>
      )}

      <Card>
        {error ? (
          <EstadoError error={error} />
        ) : !proyeccion ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500" aria-busy>
            Proyectando…
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Semana</th>
                  <th className="px-4 py-2 text-right font-medium">Entradas</th>
                  <th className="px-4 py-2 text-right font-medium">Salidas</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo al final</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100 text-slate-700">
                  <td className="px-4 py-2">Saldo en libros hoy</td>
                  <td />
                  <td />
                  <td className="px-4 py-2 text-right font-medium">
                    <MoneyCell valor={proyeccion.saldoInicial} moneda={moneda} parentesisNegativos />
                  </td>
                </tr>
                {proyeccion.semanas.map((s, i) => (
                  <Fragment key={s.desde}>
                    <tr
                      className={cn(
                        'cursor-pointer border-b border-slate-100 hover:bg-slate-50',
                        i === proyeccion.semanaMinima && 'bg-amber-50/60',
                      )}
                      onClick={() => setAbierta(abierta === i ? null : i)}
                    >
                      <td className="px-4 py-2 text-slate-800">
                        {formatFecha(s.desde)} al {formatFecha(s.hasta)}
                        {i === proyeccion.semanaMinima && (
                          <span className="ml-2 text-xs font-medium text-amber-700">punto más bajo</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <MoneyCell valor={s.entradas} moneda={moneda} ocultarCero />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <MoneyCell valor={s.salidas} moneda={moneda} ocultarCero />
                      </td>
                      <td className="px-4 py-2 text-right font-medium">
                        <MoneyCell valor={s.saldoFinal} moneda={moneda} parentesisNegativos />
                      </td>
                    </tr>
                    {abierta === i &&
                      s.flujos.map((f, j) => (
                        <tr key={j} className="text-xs text-slate-600">
                          <td className="py-1 pr-4 pl-8">
                            {formatFecha(f.fecha)} · {ETIQUETA[f.origen]} · {f.concepto}
                            {f.estimado && <span className="ml-1 text-amber-700">(estimado)</span>}
                          </td>
                          <td className="px-4 py-1 text-right">
                            {f.importe.isPositive() && <MoneyCell valor={f.importe.toFixed(2)} moneda={moneda} />}
                          </td>
                          <td className="px-4 py-1 text-right">
                            {f.importe.isNegative() && (
                              <MoneyCell valor={f.importe.negated().toFixed(2)} moneda={moneda} />
                            )}
                          </td>
                          <td />
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
