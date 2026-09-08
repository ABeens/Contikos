import { useEffect, useState } from 'react'
import {
  CircleAlert,
  CircleCheck,
  Lock,
  LockOpen,
  TriangleAlert,
} from 'lucide-react'
import { useEmpresa } from '@/app/empresa'
import { ApiError } from '@/shared/api/client'
import type {
  ChecklistCierre,
  Periodo,
  VerificacionCierre,
} from '@/shared/api/contracts/conta'
import { formatFecha, formatFechaLarga, formatPeriodo } from '@/shared/format/fecha'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { Field, Input } from '@/shared/ui/Field'
import { cn } from '@/shared/ui/cn'
import {
  usePeriodos,
  useCerrarPeriodo,
  useReabrirPeriodo,
  useVerificacionCierre,
} from '../api/queries'
import { etiquetaPeriodo } from '../domain/periodo'

/**
 * Periodos contables y cierre mensual (docs/03 §5).
 *
 *   elegir el mes → verificar → cerrar
 *
 * Misma forma que la corrida de depreciación (docs/07 §3.2) y por la misma
 * razón: cerrar no es cambiar un estado, es declarar que el mes ya no admite
 * movimientos, y eso solo se afirma después de comprobarlo. El checklist se
 * enseña entero, con los puntos que están bien incluidos, porque un cierre es
 * una firma y hay que ver qué se está firmando.
 */
export function PeriodosPage() {
  const { periodoActivo } = useEmpresa()
  const { data: periodos = [] } = usePeriodos()

  const [seleccionado, setSeleccionado] = useState<string | null>(null)
  const [avisosRevisados, setAvisosRevisados] = useState(false)
  const [motivo, setMotivo] = useState('')
  /** Lo último que se hizo, para decirlo en pantalla. */
  const [hecho, setHecho] = useState<string | null>(null)

  const cerrar = useCerrarPeriodo()
  const reabrir = useReabrirPeriodo()
  const checklist = useVerificacionCierre(seleccionado ?? undefined)

  // El periodo activo del contexto llega después del primer render.
  useEffect(() => {
    if (!seleccionado && periodoActivo) setSeleccionado(periodoActivo.id)
  }, [seleccionado, periodoActivo])

  const elegir = (periodo: Periodo) => {
    setSeleccionado(periodo.id)
    setAvisosRevisados(false)
    setMotivo('')
    setHecho(null)
    cerrar.reset()
    reabrir.reset()
  }

  const periodo = periodos.find((p) => p.id === seleccionado)
  const verificaciones = checklist.data?.verificaciones ?? []
  const avisos = verificaciones.filter((v) => v.severidad === 'aviso')
  const errores = verificaciones.filter((v) => v.severidad === 'error')

  // Los avisos no bloquean, pero no pasan solos: quien cierra declara que los
  // leyó y dice por qué, y las dos cosas quedan en la bitácora del periodo.
  const faltaMotivo = avisos.length > 0 && motivo.trim() === ''
  const puedeCerrar =
    Boolean(checklist.data?.puedeCerrar) &&
    periodo?.estado === 'abierto' &&
    (avisos.length === 0 || (avisosRevisados && !faltaMotivo))

  const ejecutarCierre = () => {
    if (!periodo) return
    cerrar.mutate(
      {
        periodoId: periodo.id,
        solicitud: { confirmarAvisos: avisosRevisados, motivo: motivo.trim() },
      },
      {
        onSuccess: (cerrado) => {
          setHecho(`${etiquetaPeriodo(cerrado)} quedó cerrado`)
          setAvisosRevisados(false)
          setMotivo('')
        },
      },
    )
  }

  const ejecutarReapertura = () => {
    if (!periodo) return
    reabrir.mutate(periodo.id, {
      onSuccess: (abierto) => {
        setHecho(`${etiquetaPeriodo(abierto)} vuelve a admitir asientos`)
      },
    })
  }

  const errorOperacion =
    cerrar.error instanceof ApiError
      ? cerrar.error
      : reabrir.error instanceof ApiError
        ? reabrir.error
        : null

  return (
    <div>
      <PageHeader
        titulo="Periodos contables"
        descripcion="Los meses del ejercicio y su estado. Cerrar un periodo exige pasar el checklist de cierre; reabrirlo, que no esté bloqueado."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader
            titulo="Ejercicio"
            descripcion="Abierto acepta asientos. Bloqueado no se reabre."
          />
          <ul aria-label="Periodos del ejercicio" className="p-2">
            {periodos.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => elegir(p)}
                  aria-current={p.id === seleccionado ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm',
                    p.id === seleccionado
                      ? 'bg-brand-50 font-medium text-brand-800'
                      : 'text-slate-700 hover:bg-slate-50',
                  )}
                >
                  <span>{formatPeriodo(p.ejercicio, p.numero)}</span>
                  <EstadoBadge estado={p.estado} />
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div>
          {!periodo ? (
            <Card>
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                Elija un periodo del ejercicio.
              </p>
            </Card>
          ) : (
            <Card>
              <CardHeader
                titulo={`Checklist de cierre · ${etiquetaPeriodo(periodo)}`}
                descripcion={`Del ${formatFecha(periodo.fechaInicio)} al ${formatFecha(periodo.fechaFin)}`}
                acciones={<EstadoBadge estado={periodo.estado} />}
              />

              {checklist.isLoading ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500">
                  Verificando el periodo…
                </p>
              ) : (
                <Verificaciones verificaciones={verificaciones} />
              )}

              {periodo.cerradoEn && (
                <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
                  Cerrado el {formatFechaLarga(periodo.cerradoEn.slice(0, 10))}{' '}
                  por {periodo.cerradoPor}
                  {periodo.motivoCierre
                    ? ` · Motivo: ${periodo.motivoCierre}`
                    : ''}
                </p>
              )}

              <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 px-4 py-3">
                {periodo.estado === 'abierto' && avisos.length > 0 && (
                  <>
                    <label className="flex items-center gap-2 text-sm text-amber-800">
                      <input
                        type="checkbox"
                        checked={avisosRevisados}
                        onChange={(e) => setAvisosRevisados(e.target.checked)}
                        className="size-4 rounded border-slate-300 accent-amber-600"
                      />
                      He revisado los {avisos.length} aviso
                      {avisos.length === 1 ? '' : 's'}
                    </label>
                    <Field
                      label="Motivo del cierre con avisos"
                      requerido
                      className="w-72"
                      ayuda="Queda en la bitácora del periodo."
                    >
                      {(p) => (
                        <Input
                          {...p}
                          value={motivo}
                          placeholder="Por qué se cierra con estas excepciones"
                          onChange={(e) => setMotivo(e.target.value)}
                        />
                      )}
                    </Field>
                  </>
                )}

                {periodo.estado === 'abierto' && errores.length > 0 && (
                  <span className="text-sm text-red-700">
                    Hay {errores.length} error{errores.length === 1 ? '' : 'es'}{' '}
                    que impide{errores.length === 1 ? '' : 'n'} cerrar.
                  </span>
                )}

                <div className="ml-auto flex items-center gap-3">
                  {errorOperacion && (
                    <span className="text-sm text-red-700">
                      {errorOperacion.message}
                    </span>
                  )}
                  {periodo.estado === 'abierto' ? (
                    <Button
                      variante="primario"
                      icono={<Lock className="size-4" />}
                      onClick={ejecutarCierre}
                      disabled={!puedeCerrar || cerrar.isPending}
                    >
                      {cerrar.isPending ? 'Cerrando…' : 'Cerrar periodo'}
                    </Button>
                  ) : (
                    <Button
                      icono={<LockOpen className="size-4" />}
                      onClick={ejecutarReapertura}
                      disabled={periodo.estado !== 'cerrado' || reabrir.isPending}
                      title={
                        periodo.estado === 'bloqueado'
                          ? 'Un periodo bloqueado no se reabre'
                          : undefined
                      }
                    >
                      {reabrir.isPending ? 'Reabriendo…' : 'Reabrir'}
                    </Button>
                  )}
                </div>
              </div>

              {hecho && (
                <p
                  role="status"
                  className="border-t border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800"
                >
                  {hecho}
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- Verificaciones */

const TONO: Record<
  VerificacionCierre['severidad'],
  { icono: typeof CircleAlert; clase: string }
> = {
  error: { icono: CircleAlert, clase: 'text-red-700' },
  aviso: { icono: TriangleAlert, clase: 'text-amber-700' },
  ok: { icono: CircleCheck, clase: 'text-emerald-700' },
}

/**
 * El checklist entero, punto por punto.
 *
 * También los que están bien: el semáforo verde es la mitad de la información
 * que pide docs/03 §5. Una lista que solo enseña los problemas deja al que
 * cierra sin saber si la depreciación se comprobó o si nadie la miró.
 */
function Verificaciones({
  verificaciones,
}: {
  verificaciones: ChecklistCierre['verificaciones']
}) {
  if (verificaciones.length === 0) return null

  return (
    <ul
      aria-label="Checklist de cierre"
      className="divide-y divide-slate-100 text-sm"
    >
      {verificaciones.map((v, i) => {
        const tono = TONO[v.severidad]
        const Icono = tono.icono
        return (
          <li
            key={`${v.codigo}-${i}`}
            className="flex items-start gap-2 px-4 py-2"
          >
            <Icono className={cn('mt-0.5 size-4 shrink-0', tono.clase)} />
            <span>
              <span
                className={cn(
                  'mr-1 text-[10px] font-semibold tracking-wider uppercase',
                  tono.clase,
                )}
              >
                {v.severidad}
              </span>
              <span className="text-slate-700">{v.mensaje}</span>
              {v.detalle && (
                <span className="block text-xs text-slate-500">{v.detalle}</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
