import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { BookCheck, CircleAlert, CircleCheck, Search } from 'lucide-react'
import { useEmpresa } from '@/app/empresa'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Select } from '@/shared/ui/Field'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { AsientoPropuesto } from '@/shared/asiento/AsientoPropuesto'
import { formatFecha, formatPeriodo } from '@/shared/format/fecha'
import { useCuentas } from '@/shared/api/catalogos'
import { ApiError } from '@/shared/api/client'
import type { ResultadoRevaluacion } from '@/shared/api/contracts/bancos'
import {
  useContabilizarRevaluacion,
  usePrevisualizacionRevaluacion,
} from '../api/queries'

/**
 * Revaluación de saldos en moneda extranjera al cierre (docs/06 §6).
 *
 * Una cuenta en dólares no cambia de dólares sola, pero sí cambia de colones:
 * al cierre hay que poner el mayor al tipo de cambio de esa fecha. La
 * diferencia es un resultado cambiario **no realizado**, que es lo que la
 * separa de la diferencia de un cobro o un pago: aquí nadie vendió nada.
 *
 * Se verifica antes de contabilizar, como la depreciación y la amortización de
 * diferidos, y por lo mismo: lo que se revisa es exactamente lo que entra al
 * mayor. La corrida es idempotente por periodo.
 */
export function RevaluacionPage() {
  const { periodos, periodoActivo } = useEmpresa()
  const { data: cuentas = [] } = useCuentas()
  const contabilizar = useContabilizarRevaluacion()

  const [periodoId, setPeriodoId] = useState(periodoActivo?.id ?? '')
  const [verificar, setVerificar] = useState(false)
  const [resultado, setResultado] = useState<ResultadoRevaluacion | null>(null)

  // El periodo del selector sigue al de la barra superior mientras nadie lo
  // toque aquí: cambiar de mes arriba y encontrarse otro abajo desorienta.
  useEffect(() => {
    if (periodoActivo && periodoId === '') setPeriodoId(periodoActivo.id)
  }, [periodoActivo, periodoId])

  const { data: previa, isFetching } = usePrevisualizacionRevaluacion(
    periodoId,
    verificar,
  )

  const periodo = periodos.find((p) => p.id === periodoId)
  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? codigo
  const errorServidor =
    contabilizar.error instanceof ApiError ? contabilizar.error : null

  const emitir = async () => {
    if (!periodoId) return
    setResultado(await contabilizar.mutateAsync({ periodoId }))
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        titulo="Revaluación de moneda extranjera"
        descripcion="Al cierre, los saldos en otra moneda se ponen al tipo de cambio de la fecha. La diferencia es un resultado cambiario no realizado."
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4 px-4 py-3">
          <Field label="Periodo" className="w-56">
            {(p) => (
              <Select
                {...p}
                value={periodoId}
                onChange={(e) => {
                  setPeriodoId(e.target.value)
                  setVerificar(false)
                  setResultado(null)
                }}
              >
                {periodos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPeriodo(p.ejercicio, p.numero)}
                    {p.estado !== 'abierto' ? ` — ${p.estado}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Button
            icono={<Search className="size-4" />}
            onClick={() => setVerificar(true)}
            disabled={!periodoId}
          >
            Verificar
          </Button>

          {periodo && (
            <p className="text-xs text-slate-500">
              El tipo de cambio que se aplica es el del {formatFecha(periodo.fechaFin)}
              , o el último anterior si ese día no tiene tasa publicada.
            </p>
          )}
        </div>
      </Card>

      {errorServidor && (
        <div className="mb-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor.codigo}: {errorServidor.message}
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {errorServidor.detalles.map((mensaje, i) => (
              <li key={i}>{mensaje}</li>
            ))}
          </ul>
        </div>
      )}

      {resultado && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200 ring-inset">
          <CircleCheck className="size-4" />
          Revaluación contabilizada en el asiento{' '}
          <Link
            to={`/conta/asientos?asiento=${resultado.asientoId}`}
            className="font-mono font-medium underline-offset-2 hover:underline"
          >
            {resultado.asientoId}
          </Link>
        </div>
      )}

      {isFetching && (
        <p className="mb-4 text-sm text-slate-500">Calculando la corrida…</p>
      )}

      {previa && (
        <>
          <Card className="mb-4">
            <CardHeader
              titulo="Cuentas que se revalúan"
              descripcion="Solo las que llevan su saldo en otra moneda. Una cuenta sin tipo de cambio de cierre se queda fuera y se ve aquí que falta."
            />
            {previa.corrida.lineas.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                No hay cuentas en moneda extranjera con tipo de cambio de cierre
                para este periodo.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-2 text-left">Cuenta</th>
                    <th className="px-3 py-2 text-right">Saldo en su moneda</th>
                    <th className="px-3 py-2 text-right">Tipo de cambio</th>
                    <th className="px-3 py-2 text-right">En el mayor</th>
                    <th className="px-3 py-2 text-right">Revaluado</th>
                    <th className="px-4 py-2 text-right">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.corrida.lineas.map((l) => (
                    <tr
                      key={l.cuentaBancariaId}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="px-4 py-1.5">
                        <span className="text-slate-800">{l.nombre}</span>{' '}
                        <span className="font-mono text-xs text-slate-400">
                          {l.cuentaContable}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <MoneyCell valor={l.saldoMoneda} moneda={l.moneda} />
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">
                        {l.tipoCambio}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <MoneyCell
                          valor={l.saldoFuncionalActual}
                          moneda={previa.corrida.moneda}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <MoneyCell
                          valor={l.saldoFuncionalRevaluado}
                          moneda={previa.corrida.moneda}
                        />
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        <MoneyCell
                          valor={l.diferencia}
                          moneda={previa.corrida.moneda}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold text-slate-800">
                  <tr>
                    <td colSpan={5} className="px-4 py-2 text-right text-xs">
                      Resultado cambiario no realizado del periodo
                    </td>
                    <td className="px-4 py-2 text-right">
                      <MoneyCell
                        valor={previa.corrida.total}
                        moneda={previa.corrida.moneda}
                      />
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </Card>

          <Card className="mb-4">
            <CardHeader
              titulo="Asiento que se generará"
              descripcion={`Expresado en ${previa.corrida.moneda}, que es la moneda del mayor.`}
            />
            {previa.asiento ? (
              <AsientoPropuesto
                asiento={previa.asiento}
                nombreCuenta={nombreCuenta}
              />
            ) : (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                No hay ninguna diferencia que reconocer: no se emite un asiento
                vacío.
              </p>
            )}
          </Card>

          <div className="flex justify-end">
            <Button
              variante="primario"
              icono={<BookCheck className="size-4" />}
              onClick={() => void emitir()}
              disabled={!previa.asiento || contabilizar.isPending}
              title={
                previa.asiento
                  ? 'Contabiliza la revaluación del periodo'
                  : 'No hay ninguna diferencia que contabilizar'
              }
            >
              {contabilizar.isPending
                ? 'Contabilizando…'
                : 'Contabilizar revaluación'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
