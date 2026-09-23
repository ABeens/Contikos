import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  BookCheck,
  CircleAlert,
  CircleCheck,
  Search,
  TriangleAlert,
} from 'lucide-react'
import { useEmpresa } from '@/app/empresa'
import { useCuentas, usePeriodos } from '@/shared/api/catalogos'
import { ApiError } from '@/shared/api/client'
import type {
  CorridaDepreciacion,
  CorridaHistorial,
  ResultadoCorrida,
  Verificacion,
} from '@/shared/api/contracts/activos'
import type { Periodo } from '@/shared/api/contracts/conta'
import { formatFecha, formatPeriodo } from '@/shared/format/fecha'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { AsientoPropuesto } from '@/shared/asiento/AsientoPropuesto'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Select } from '@/shared/ui/Field'
import { cn } from '@/shared/ui/cn'
import {
  useContabilizarDepreciacion,
  useHistorialDepreciacion,
  usePrevisualizacionDepreciacion,
} from '../api/queries'

/**
 * Depreciación mensual (docs/07 §3.2).
 *
 *   seleccionar → calcular → revisar → contabilizar
 *
 * La pantalla separa a propósito "verificar" de "contabilizar": lo que entra
 * al mayor es una corrida que alguien miró, con sus avisos leídos. El botón de
 * contabilizar no existe hasta que hay una verificación en pantalla, y se
 * apaga en cuanto la corrida tiene un error o un aviso sin confirmar.
 */
export function DepreciacionPage() {
  const { periodoActivo } = useEmpresa()
  const { data: periodos = [] } = usePeriodos()
  const { data: cuentas = [] } = useCuentas()
  const { data: historial = [] } = useHistorialDepreciacion()

  const [periodoId, setPeriodoId] = useState(periodoActivo?.id ?? '')
  /** Periodo cuya corrida está en pantalla. Nulo hasta pulsar "Verificar". */
  const [verificado, setVerificado] = useState<string | null>(null)
  const [avisosRevisados, setAvisosRevisados] = useState(false)
  const [resultado, setResultado] = useState<ResultadoCorrida | null>(null)

  // El periodo activo del contexto llega después del primer render.
  useEffect(() => {
    if (!periodoId && periodoActivo) setPeriodoId(periodoActivo.id)
  }, [periodoId, periodoActivo])

  const previa = usePrevisualizacionDepreciacion(
    verificado ?? undefined,
    verificado !== null,
  )
  const contabilizar = useContabilizarDepreciacion()

  const cambiarPeriodo = (id: string) => {
    setPeriodoId(id)
    setVerificado(null)
    setAvisosRevisados(false)
    setResultado(null)
    contabilizar.reset()
  }

  const verificar = () => {
    setResultado(null)
    setAvisosRevisados(false)
    contabilizar.reset()
    if (verificado === periodoId) void previa.refetch()
    else setVerificado(periodoId)
  }

  const ejecutar = () => {
    contabilizar.mutate(
      { periodoId, confirmarAvisos: avisosRevisados },
      {
        onSuccess: (r) => {
          setResultado(r)
          // La previsualización ya no vale: ahora diría "ya contabilizada".
          setVerificado(null)
        },
      },
    )
  }

  // Tras contabilizar se enseña la corrida que entró al mayor, no una nueva
  // previsualización que solo diría que el periodo ya se corrió.
  const corrida: CorridaDepreciacion | undefined =
    resultado?.corrida ?? previa.data?.corrida
  const asiento = resultado ? null : (previa.data?.asiento ?? null)
  const periodo = periodos.find((p) => p.id === (corrida?.periodoId ?? periodoId))

  const errores = corrida?.verificaciones.filter((v) => v.severidad === 'error') ?? []
  const avisos = corrida?.verificaciones.filter((v) => v.severidad === 'aviso') ?? []
  const puedeContabilizar =
    Boolean(corrida?.puedeContabilizar) &&
    !resultado &&
    (avisos.length === 0 || avisosRevisados)

  const errorContabilizar = contabilizar.error

  return (
    <div>
      <PageHeader
        titulo="Depreciación mensual"
        descripcion="Calcula la cuota del periodo de cada activo en uso, la verifica y la contabiliza en un solo asiento."
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">
          <Field label="Periodo de la corrida" className="w-56">
            {(props) => (
              <Select
                {...props}
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
            variante="primario"
            icono={<Search className="size-4" />}
            onClick={verificar}
            disabled={!periodoId || previa.isFetching}
          >
            {previa.isFetching ? 'Verificando…' : 'Verificar'}
          </Button>
          {corrida && (
            <span className="ml-auto text-xs text-slate-500">
              {corrida.lineas.length} activo
              {corrida.lineas.length === 1 ? '' : 's'} en la corrida
            </span>
          )}
        </div>

        {previa.isError && (
          <p className="border-t border-slate-200 px-4 py-3 text-sm text-red-700">
            No se pudo calcular la corrida:{' '}
            {previa.error instanceof Error ? previa.error.message : 'error'}
          </p>
        )}

        {corrida && (
          <>
            <Verificaciones verificaciones={corrida.verificaciones} />
            <TablaCorrida corrida={corrida} />
          </>
        )}
      </Card>

      {resultado && periodo && (
        <div
          role="status"
          className="mt-4 flex items-start gap-2 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200 ring-inset"
        >
          <BookCheck className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">
              Corrida contabilizada: {formatPeriodo(periodo.ejercicio, periodo.numero)}{' '}
              quedó en el asiento {resultado.asientoId} (n.º {resultado.asientoNumero}).
            </p>
            <p className="text-xs text-emerald-700">
              {resultado.activosActualizados} ficha
              {resultado.activosActualizados === 1 ? '' : 's'} actualizada
              {resultado.activosActualizados === 1 ? '' : 's'}.{' '}
              <Link
                to={`/conta/asientos?asiento=${resultado.asientoId}`}
                className="underline"
              >
                Ver en el libro de asientos
              </Link>
            </p>
          </div>
        </div>
      )}

      {asiento && (
        <Card className="mt-4">
          <CardHeader
            titulo="Asiento propuesto"
            descripcion="Es exactamente lo que entrará al mayor si se contabiliza. Cargo al gasto por categoría, abono a la depreciación acumulada por activo."
          />
          <AsientoPropuesto
            asiento={asiento}
            nombreCuenta={(codigo) =>
              cuentas.find((c) => c.codigo === codigo)?.nombre ?? codigo
            }
          />

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3">
            {avisos.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-amber-800">
                <input
                  type="checkbox"
                  checked={avisosRevisados}
                  onChange={(e) => setAvisosRevisados(e.target.checked)}
                  className="size-4 rounded border-slate-300 accent-amber-600"
                />
                He revisado los avisos
              </label>
            )}
            {errores.length > 0 && (
              <span className="text-sm text-red-700">
                Hay {errores.length} error{errores.length === 1 ? '' : 'es'} que
                impide{errores.length === 1 ? '' : 'n'} contabilizar.
              </span>
            )}
            <div className="ml-auto flex items-center gap-3">
              {errorContabilizar && (
                <span className="text-sm text-red-700">
                  {errorContabilizar instanceof ApiError
                    ? errorContabilizar.message
                    : 'No se pudo contabilizar la corrida'}
                </span>
              )}
              <Button
                variante="primario"
                icono={<BookCheck className="size-4" />}
                onClick={ejecutar}
                disabled={!puedeContabilizar || contabilizar.isPending}
              >
                {contabilizar.isPending ? 'Contabilizando…' : 'Contabilizar'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader
          titulo="Corridas contabilizadas"
          descripcion="Una por periodo. Volver a correr un periodo no duplica el gasto: el asiento es idempotente por origen."
        />
        <Historial historial={historial} periodos={periodos} />
      </Card>
    </div>
  )
}

/* ------------------------------------------------------- Verificaciones */

const TONO_VERIFICACION: Record<
  Verificacion['severidad'],
  { icono: typeof CircleAlert; clase: string }
> = {
  error: { icono: CircleAlert, clase: 'text-red-700' },
  aviso: { icono: TriangleAlert, clase: 'text-amber-700' },
}

function Verificaciones({
  verificaciones,
}: {
  verificaciones: Verificacion[]
}) {
  if (verificaciones.length === 0) {
    return (
      <p className="flex items-center gap-2 border-t border-slate-200 px-4 py-2 text-sm text-emerald-700">
        <CircleCheck className="size-4 shrink-0" />
        Sin observaciones: la corrida se puede contabilizar.
      </p>
    )
  }

  return (
    <ul
      aria-label="Verificaciones"
      className="border-t border-slate-200 px-4 py-2 text-sm"
    >
      {verificaciones.map((v, i) => {
        const tono = TONO_VERIFICACION[v.severidad]
        const Icono = tono.icono
        return (
          <li
            key={`${v.codigo}-${v.activoId ?? i}`}
            className={cn('flex items-start gap-2 py-1', tono.clase)}
          >
            <Icono className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="mr-1 text-[10px] font-semibold tracking-wider uppercase">
                {v.severidad}
              </span>
              {v.mensaje}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/* ------------------------------------------------------------ Corrida */

function TablaCorrida({ corrida }: { corrida: CorridaDepreciacion }) {
  const conFiscal = corrida.lineas.some((l) => l.cuotaFiscal !== null)

  if (corrida.lineas.length === 0) {
    return (
      <p className="border-t border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
        Ningún activo se deprecia en este periodo.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto border-t border-slate-200">
      <table className="w-full text-sm" aria-label="Corrida de depreciación">
        <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
          <tr>
            <th className="w-24 px-4 py-2 text-left">Código</th>
            <th className="px-3 py-2 text-left">Activo</th>
            <th className="w-32 px-3 py-2 text-left">Método</th>
            <th className="w-36 px-3 py-2 text-right">Valor en libros</th>
            <th className="w-32 px-3 py-2 text-right">Cuota</th>
            {conFiscal && (
              <th className="w-32 px-3 py-2 text-right">Cuota fiscal</th>
            )}
            <th className="w-36 px-3 py-2 text-right">Acumulada</th>
            <th className="w-36 px-3 py-2 text-right">Libros resultante</th>
            <th className="w-40 px-4 py-2 text-left">Observación</th>
          </tr>
        </thead>
        <tbody>
          {corrida.lineas.map((linea) => (
            <tr key={linea.activoId} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-1.5 font-mono text-xs text-slate-600">
                {linea.codigo}
              </td>
              <td className="px-3 py-1.5">
                <p className="text-slate-800">{linea.nombre}</p>
                <p className="text-[11px] text-slate-500">{linea.categoriaNombre}</p>
              </td>
              <td className="px-3 py-1.5 text-xs text-slate-600">
                {linea.metodo === 'linea_recta' ? 'Línea recta' : 'Saldos decrecientes'}
              </td>
              <td className="px-3 py-1.5 text-right">
                <MoneyCell valor={linea.valorEnLibrosInicial} moneda={corrida.moneda} />
              </td>
              <td className="px-3 py-1.5 text-right font-medium">
                <MoneyCell valor={linea.cuota} moneda={corrida.moneda} />
              </td>
              {conFiscal && (
                <td className="px-3 py-1.5 text-right">
                  {linea.cuotaFiscal === null ? (
                    <span className="text-xs text-slate-400">Igual</span>
                  ) : (
                    <MoneyCell valor={linea.cuotaFiscal} moneda={corrida.moneda} />
                  )}
                </td>
              )}
              <td className="px-3 py-1.5 text-right">
                <MoneyCell
                  valor={linea.depreciacionAcumuladaResultante}
                  moneda={corrida.moneda}
                />
              </td>
              <td className="px-3 py-1.5 text-right">
                <MoneyCell valor={linea.valorEnLibrosResultante} moneda={corrida.moneda} />
              </td>
              <td className="px-4 py-1.5 text-xs">
                {linea.verificaciones.length === 0 ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CircleCheck className="size-3.5" /> Correcto
                  </span>
                ) : (
                  linea.verificaciones.map((v) => (
                    <span
                      key={v.codigo}
                      title={v.mensaje}
                      className={cn(
                        'inline-flex items-center gap-1',
                        TONO_VERIFICACION[v.severidad].clase,
                      )}
                    >
                      <TriangleAlert className="size-3.5" />
                      {v.codigo === 'ULTIMA_CUOTA' ? 'Última cuota' : v.codigo}
                    </span>
                  ))
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-slate-50 font-semibold text-slate-800">
          <tr>
            <td colSpan={4} className="px-4 py-2 text-right text-xs">
              Total de la corrida
            </td>
            <td className="px-3 py-2 text-right">
              <MoneyCell valor={corrida.total} moneda={corrida.moneda} />
            </td>
            {conFiscal && (
              <td className="px-3 py-2 text-right">
                <MoneyCell valor={corrida.totalFiscal} moneda={corrida.moneda} />
              </td>
            )}
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/* ---------------------------------------------------------- Historial */

function Historial({
  historial,
  periodos,
}: {
  historial: CorridaHistorial[]
  periodos: Periodo[]
}) {
  if (historial.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-slate-500">
        Todavía no hay corridas contabilizadas.
      </p>
    )
  }

  const etiqueta = (periodoId: string) => {
    const p = periodos.find((x) => x.id === periodoId)
    return p ? formatPeriodo(p.ejercicio, p.numero) : periodoId
  }

  return (
    <table className="w-full text-sm" aria-label="Historial de corridas">
      <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
        <tr>
          <th className="px-4 py-2 text-left">Periodo</th>
          <th className="w-32 px-3 py-2 text-left">Fecha</th>
          <th className="w-24 px-3 py-2 text-right">Activos</th>
          <th className="w-40 px-3 py-2 text-right">Total</th>
          <th className="w-40 px-4 py-2 text-left">Asiento</th>
        </tr>
      </thead>
      <tbody>
        {historial.map((h) => (
          <tr key={h.periodoId} className="border-b border-slate-100 last:border-0">
            <td className="px-4 py-1.5 text-slate-800">{etiqueta(h.periodoId)}</td>
            <td className="px-3 py-1.5 text-slate-600">{formatFecha(h.fecha)}</td>
            <td className="px-3 py-1.5 text-right tabular">{h.activos}</td>
            <td className="px-3 py-1.5 text-right">
              <MoneyCell valor={h.total} />
            </td>
            <td className="px-4 py-1.5">
              <Link
                to={`/conta/asientos?asiento=${h.asientoId}`}
                className="font-mono text-xs text-brand-700 hover:underline"
              >
                {h.asientoId}
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
