import { useState } from 'react'
import { Link } from 'react-router'
import { BookCheck, CircleAlert, CircleCheck, Search } from 'lucide-react'
import { useEmpresa } from '@/app/empresa'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { DialogoConfirmacion } from '@/shared/ui/DialogoConfirmacion'
import { MensajeError } from '@/shared/ui/MensajeError'
import { Field, Select } from '@/shared/ui/Field'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { AsientoPropuesto } from '@/shared/asiento/AsientoPropuesto'
import { formatFecha, formatPeriodo } from '@/shared/format/fecha'
import { useCuentas } from '@/shared/api/catalogos'
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

  /**
   * El periodo del selector sigue al de la barra superior mientras nadie lo
   * toque aquí: cambiar de mes arriba y encontrarse otro abajo desorienta. En
   * cuanto se elige uno en esta pantalla, manda la elección.
   */
  const [periodoElegido, setPeriodoElegido] = useState<string | null>(null)
  const periodoId = periodoElegido ?? periodoActivo?.id ?? ''

  /** Periodo cuya corrida se mandó verificar. Nulo hasta pulsar "Verificar". */
  const [verificado, setVerificado] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{
    periodoId: string
    datos: ResultadoRevaluacion
  } | null>(null)
  const [confirmando, setConfirmando] = useState(false)

  // Solo se enseña la verificación del periodo que está en el selector: si la
  // barra superior lo cambia, la de otro mes no puede seguir en pantalla.
  const previaVigente = verificado !== null && verificado === periodoId
  const consulta = usePrevisualizacionRevaluacion(periodoId, previaVigente)
  const previa = previaVigente ? consulta.data : undefined
  const resultadoVigente =
    resultado?.periodoId === periodoId ? resultado.datos : null

  const periodo = periodos.find((p) => p.id === periodoId)
  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? codigo

  const cambiarPeriodo = (id: string) => {
    setPeriodoElegido(id)
    setVerificado(null)
    setResultado(null)
    contabilizar.reset()
  }

  /** "Verificar" otra vez vuelve a pedir la corrida: los saldos pudieron cambiar. */
  const verificar = () => {
    setResultado(null)
    contabilizar.reset()
    if (verificado === periodoId) void consulta.refetch()
    else setVerificado(periodoId)
  }

  const emitir = () => {
    if (!periodoId) return
    const corrida = periodoId
    contabilizar.mutate(
      { periodoId: corrida },
      {
        onSuccess: (datos) => {
          setResultado({ periodoId: corrida, datos })
          setConfirmando(false)
          // La verificación ya no vale: ahora diría "ya contabilizada".
          setVerificado(null)
        },
      },
    )
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
                onChange={(e) => cambiarPeriodo(e.target.value)}
              >
                {periodos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPeriodo(p.ejercicio, p.numero)}
                    {p.estado !== 'abierto' ? ` (${p.estado})` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Button
            icono={<Search className="size-4" />}
            onClick={verificar}
            disabled={!periodoId || consulta.isFetching}
          >
            {consulta.isFetching ? 'Verificando…' : 'Verificar'}
          </Button>

          {periodo && (
            <p className="text-xs text-slate-500">
              El tipo de cambio que se aplica es el del {formatFecha(periodo.fechaFin)}
              , o el último anterior si ese día no tiene tasa publicada.
            </p>
          )}
        </div>
      </Card>

      {previaVigente && consulta.isError && (
        <div className="mb-4">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            No se pudo calcular la corrida
          </p>
          <MensajeError error={consulta.error} />
        </div>
      )}

      {resultadoVigente && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200 ring-inset">
          <CircleCheck className="size-4" />
          Revaluación contabilizada en el asiento{' '}
          <Link
            to={`/conta/asientos?asiento=${resultadoVigente.asientoId}`}
            className="font-mono font-medium underline-offset-2 hover:underline"
          >
            {resultadoVigente.asientoId}
          </Link>
        </div>
      )}

      {previaVigente && consulta.isFetching && (
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
              onClick={() => {
                contabilizar.reset()
                setConfirmando(true)
              }}
              disabled={!previa.asiento || contabilizar.isPending}
              title={
                previa.asiento
                  ? 'Contabiliza la revaluación del periodo'
                  : 'No hay ninguna diferencia que contabilizar'
              }
            >
              Contabilizar revaluación
            </Button>
          </div>

          <DialogoConfirmacion
            abierto={confirmando}
            titulo="¿Contabilizar la revaluación?"
            descripcion="Se emite el asiento del resultado cambiario no realizado del periodo."
            textoConfirmar="Contabilizar"
            textoConfirmando="Contabilizando…"
            pendiente={contabilizar.isPending}
            error={contabilizar.error}
            onConfirmar={emitir}
            onCancelar={() => {
              setConfirmando(false)
              contabilizar.reset()
            }}
          >
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-slate-500">Periodo</dt>
              <dd>
                {periodo
                  ? formatPeriodo(periodo.ejercicio, periodo.numero)
                  : periodoId}
              </dd>
              <dt className="text-slate-500">Cuentas revaluadas</dt>
              <dd>{previa.corrida.lineas.length}</dd>
              <dt className="text-slate-500">Resultado del periodo</dt>
              <dd>
                <MoneyCell
                  valor={previa.corrida.total}
                  moneda={previa.corrida.moneda}
                  mostrarSimbolo
                />
              </dd>
            </dl>
          </DialogoConfirmacion>
        </>
      )}
    </div>
  )
}
