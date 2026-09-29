import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { DialogoConfirmacion } from '@/shared/ui/DialogoConfirmacion'
import { Field, Select } from '@/shared/ui/Field'
import { LinkBoton } from '@/shared/ui/LinkBoton'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { etiquetaLibro } from '@/shared/asiento/libro'
import { formatFechaLarga } from '@/shared/format/fecha'
import {
  useCerrarEjercicio,
  useCuentas,
  usePeriodos,
  useVerificacionEjercicio,
} from '../api/queries'
import { cuentasDestinoValidas } from '../domain/ejercicio'
import { Verificaciones } from '../components/Verificaciones'

/**
 * Cierre del ejercicio (docs/03 §6).
 *
 *   elegir el año y la cuenta destino → verificar → cerrar
 *
 * La misma forma que el cierre mensual, y con más razón: el cierre anual
 * bloquea doce meses para siempre. Por eso el checklist se enseña entero y el
 * cierre pide una confirmación que dice exactamente lo que va a pasar.
 */
export function CierreEjercicioPage() {
  const { data: periodos = [] } = usePeriodos()
  const { data: cuentas = [] } = useCuentas()
  const destinos = useMemo(() => cuentasDestinoValidas(cuentas), [cuentas])

  // Los ejercicios que existen, del más antiguo al más reciente. Se propone
  // el primero que tenga algún mes sin bloquear: es el que toca cerrar.
  const ejercicios = useMemo(
    () => [...new Set(periodos.map((p) => p.ejercicio))].sort((a, b) => a - b),
    [periodos],
  )
  const propuesto = ejercicios.find((e) =>
    periodos.some((p) => p.ejercicio === e && p.estado !== 'bloqueado'),
  )

  const [ejercicio, setEjercicio] = useState<number | undefined>(undefined)
  const [cuentaDestino, setCuentaDestino] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)

  useEffect(() => {
    if (ejercicio === undefined && (propuesto ?? ejercicios.at(-1)) !== undefined) {
      setEjercicio(propuesto ?? ejercicios.at(-1))
    }
  }, [ejercicio, propuesto, ejercicios])

  // Se propone la cuenta de utilidades acumuladas si el catálogo la tiene con
  // ese nombre; si no, la primera de patrimonio. Quien cierra la confirma.
  useEffect(() => {
    if (cuentaDestino || destinos.length === 0) return
    const acumuladas = destinos.find((c) => /acumulad/i.test(c.nombre))
    setCuentaDestino((acumuladas ?? destinos[0]).codigo)
  }, [cuentaDestino, destinos])

  const checklist = useVerificacionEjercicio(ejercicio, cuentaDestino)
  const cerrar = useCerrarEjercicio()
  const datos = checklist.data

  const ejecutar = () => {
    if (ejercicio === undefined || cerrar.isPending) return
    cerrar.mutate(
      { ejercicio, solicitud: { cuentaDestino } },
      {
        onSuccess: () => {
          setConfirmando(false)
          setHecho(
            `El ejercicio ${ejercicio} quedó cerrado: sus meses están bloqueados y el ${ejercicio + 1} está abierto`,
          )
        },
      },
    )
  }

  return (
    <div>
      <PageHeader
        titulo="Cierre del ejercicio"
        descripcion="Salda ingresos, costos y gastos contra el patrimonio, bloquea los doce meses y abre el año siguiente."
        acciones={<LinkBoton to="/conta/periodos">Periodos</LinkBoton>}
      />

      <Card>
        <CardHeader
          titulo={ejercicio !== undefined ? `Ejercicio ${ejercicio}` : 'Ejercicio'}
          descripcion={
            datos ? `El asiento de cierre va fechado el ${formatFechaLarga(datos.fechaCierre)}` : undefined
          }
        />

        <div className="grid gap-4 border-b border-slate-200 px-4 py-3 sm:grid-cols-2">
          <Field label="Ejercicio">
            {(p) => (
              <Select
                {...p}
                value={ejercicio ?? ''}
                onChange={(e) => {
                  setEjercicio(Number(e.target.value))
                  setHecho(null)
                  cerrar.reset()
                }}
              >
                {ejercicios.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Cuenta que recibe el resultado"
            requerido
            ayuda="De patrimonio y de detalle. Casi siempre, utilidades acumuladas."
          >
            {(p) => (
              <Select
                {...p}
                value={cuentaDestino}
                onChange={(e) => setCuentaDestino(e.target.value)}
              >
                {destinos.map((c) => (
                  <option key={c.codigo} value={c.codigo}>
                    {c.codigo} · {c.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {datos && datos.resultados.length > 0 && (
          <div className="grid gap-3 border-b border-slate-200 px-4 py-3 sm:grid-cols-2">
            {datos.resultados.map((r) => (
              <div key={r.libro}>
                <p className="text-xs text-slate-500">
                  Resultado a trasladar · contabilidad {etiquetaLibro(r.libro).toLowerCase()}
                </p>
                <p className="text-base font-semibold text-slate-900">
                  <MoneyCell valor={r.resultado} parentesisNegativos />
                </p>
              </div>
            ))}
          </div>
        )}

        {checklist.isError ? (
          <EstadoError
            titulo="No se pudo verificar el ejercicio"
            error={checklist.error}
            onReintentar={() => void checklist.refetch()}
          />
        ) : checklist.isLoading || !datos ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500" aria-busy>
            Verificando el ejercicio…
          </p>
        ) : (
          <Verificaciones
            verificaciones={datos.verificaciones}
            etiqueta="Checklist del cierre del ejercicio"
          />
        )}

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-4 py-3">
          {datos?.cerrado && (
            <span className="text-xs text-slate-500">
              El ejercicio ya está cerrado y sus meses no se reabren.
            </span>
          )}
          <Button
            variante="primario"
            icono={<CalendarCheck className="size-4" />}
            onClick={() => setConfirmando(true)}
            disabled={!datos?.puedeCerrar || cerrar.isPending}
          >
            Cerrar el ejercicio
          </Button>
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

      {ejercicio !== undefined && (
        <DialogoConfirmacion
          abierto={confirmando}
          titulo={`Cerrar el ejercicio ${ejercicio}`}
          textoConfirmar={`Cerrar ${ejercicio}`}
          textoConfirmando="Cerrando…"
          peligro
          pendiente={cerrar.isPending}
          error={cerrar.error}
          onConfirmar={ejecutar}
          onCancelar={() => {
            setConfirmando(false)
            cerrar.reset()
          }}
        >
          <p>
            Se contabiliza el asiento que salda ingresos, costos y gastos contra{' '}
            {cuentaDestino}, en cada libro con su propio resultado.
          </p>
          <p>
            Los doce meses de {ejercicio} pasan a bloqueados y no se podrán
            reabrir. Si falta un ajuste del año, regístrelo antes de cerrar.
          </p>
        </DialogoConfirmacion>
      )}
    </div>
  )
}
