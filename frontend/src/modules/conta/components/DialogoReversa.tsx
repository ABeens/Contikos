import { useMemo, useState } from 'react'
import { CircleAlert, Undo2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input } from '@/shared/ui/Field'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { hoyISO } from '@/shared/format/fecha'
import { ApiError } from '@/shared/api/client'
import type { Asiento, SolicitudReversa } from '@/shared/api/contracts/conta'
import { useCuentas, usePeriodos, useReversarAsiento } from '../api/queries'
import {
  construirReversa,
  periodoDeFecha,
  validarReversa,
} from '../domain/asiento'

interface DialogoReversaProps {
  asiento: Asiento
  abierto: boolean
  onCerrar: () => void
  /** La reversa ya emitida. Quien abre el diálogo decide qué enseñar después. */
  onReversado: (reversa: Asiento) => void
}

/**
 * Fecha con la que se propone la reversa.
 *
 * Hoy, si hoy cae en periodo abierto; si no, el primer día del primer periodo
 * abierto. Es la regla de docs/02 §6: la reversa va en un periodo abierto, y
 * proponer una fecha que el servidor va a rechazar es hacer teclear dos veces.
 */
function fechaPropuesta(
  periodos: readonly { estado: string; fechaInicio: string; fechaFin: string }[],
): string {
  const hoy = hoyISO()
  const periodoDeHoy = periodos.find(
    (p) => hoy >= p.fechaInicio && hoy <= p.fechaFin,
  )
  if (periodoDeHoy?.estado === 'abierto') return hoy
  return periodos.find((p) => p.estado === 'abierto')?.fechaInicio ?? hoy
}

/**
 * Reversa de un asiento (docs/02 §6).
 *
 * Solo se capturan la fecha y el motivo: las líneas las construye el dominio
 * invirtiendo cargos y abonos, y se muestran antes de confirmar para que quien
 * reversa vea exactamente qué va a entrar al mayor. Una reversa no se edita ni
 * se deshace; verla antes es la única oportunidad de no equivocarse.
 */
export function DialogoReversa({
  asiento,
  abierto,
  onCerrar,
  onReversado,
}: DialogoReversaProps) {
  const { data: periodos = [] } = usePeriodos()
  const { data: cuentas = [] } = useCuentas()
  const reversar = useReversarAsiento()

  const [fecha, setFecha] = useState(() => fechaPropuesta(periodos))
  const [motivo, setMotivo] = useState('')
  const [intentoEnvio, setIntentoEnvio] = useState(false)

  const solicitud: SolicitudReversa = useMemo(
    () => ({ fecha, motivo }),
    [fecha, motivo],
  )
  const vistaPrevia = useMemo(
    () => construirReversa(asiento, solicitud),
    [asiento, solicitud],
  )
  const validacion = useMemo(
    () => validarReversa(asiento, solicitud, { cuentas, periodos }),
    [asiento, solicitud, cuentas, periodos],
  )

  const periodo = periodoDeFecha(fecha, periodos)
  const periodoCerrado = periodo && periodo.estado !== 'abierto'
  // El original está en un periodo cerrado: la reversa no lo reabre, va en el
  // abierto. Se dice antes de confirmar, porque cambia en qué mes aparece.
  const periodoOriginal = periodoDeFecha(asiento.fecha, periodos)
  const originalCerrado = periodoOriginal && periodoOriginal.estado !== 'abierto'

  const errorMotivo =
    intentoEnvio && motivo.trim() === ''
      ? 'El motivo de la reversa es obligatorio'
      : undefined
  const errorFecha =
    intentoEnvio && !periodo
      ? 'No existe un periodo que contenga esa fecha'
      : periodoCerrado
        ? `El periodo ${periodo.numero}/${periodo.ejercicio} está ${periodo.estado}`
        : undefined

  const errorServidor =
    reversar.error instanceof ApiError ? reversar.error : null

  /**
   * Lo que ya se dice junto a su campo no se repite en el resumen.
   *
   * El motivo vacío y el periodo cerrado tienen su casilla debajo del campo que
   * los provoca, que es donde hay que corregirlos. El resumen de abajo es para
   * lo que no tiene campo donde ponerse: el asiento ya reversado, una reversa
   * que no se reversa, un descuadre. Enseñar el mismo mensaje dos veces hace
   * leer dos problemas donde hay uno.
   */
  const erroresGenerales = validacion.errores.filter(
    (e) => e.codigo !== 'MOTIVO_REQUERIDO' && e.codigo !== 'PERIODO_CERRADO',
  )

  const confirmar = () => {
    setIntentoEnvio(true)
    if (!validacion.valido || reversar.isPending) return
    reversar.mutate({ id: asiento.id, solicitud }, { onSuccess: onReversado })
  }

  /** Lo que diga el servidor era sobre la fecha y el motivo de antes. */
  const editar = (aplicar: () => void) => {
    aplicar()
    if (reversar.isError) reversar.reset()
  }

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={reversar.isPending}
      alEnviar={confirmar}
      titulo={`Reversar el asiento ${asiento.codigo}`}
      descripcion="Se contabiliza un asiento nuevo con los cargos y abonos invertidos. El original no se modifica ni se borra."
      className="w-[min(94vw,44rem)]"
      acciones={
        <>
          <Button onClick={onCerrar} disabled={reversar.isPending}>
            Cancelar
          </Button>
          <Button
            variante="peligro"
            icono={<Undo2 className="size-4" />}
            type="submit"
            disabled={reversar.isPending}
          >
            {reversar.isPending ? 'Reversando…' : 'Confirmar reversa'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          label="Fecha de la reversa"
          requerido
          error={errorFecha}
          ayuda={
            originalCerrado
              ? 'El periodo del original ya cerró: la reversa va en el abierto'
              : undefined
          }
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              value={fecha}
              onChange={(e) => editar(() => setFecha(e.target.value))}
            />
          )}
        </Field>
        <Field
          label="Motivo"
          requerido
          error={errorMotivo}
          className="sm:col-span-2"
        >
          {(p) => (
            <Input
              {...p}
              value={motivo}
              autoFocus
              placeholder="Por qué se reversa. Queda en la bitácora del asiento."
              onChange={(e) => editar(() => setMotivo(e.target.value))}
            />
          )}
        </Field>
      </div>

      <p className="mt-4 text-xs font-medium text-slate-600">
        Líneas de la reversa
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{vistaPrevia.concepto}</p>
      <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 font-semibold text-slate-600">
            <tr>
              <th className="px-3 py-1.5 text-left">Cuenta</th>
              <th className="px-3 py-1.5 text-left">Concepto</th>
              <th className="w-28 px-3 py-1.5 text-right">Cargo</th>
              <th className="w-28 px-3 py-1.5 text-right">Abono</th>
            </tr>
          </thead>
          <tbody>
            {vistaPrevia.lineas.map((linea, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-1 font-mono text-slate-600">
                  {linea.cuenta}
                </td>
                <td className="px-3 py-1 text-slate-500">
                  {linea.concepto}
                  {asiento.lineas[i]?.auxiliarNombre && (
                    <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                      {asiento.lineas[i].auxiliarNombre}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1 text-right">
                  <MoneyCell
                    valor={linea.cargo}
                    moneda={asiento.moneda}
                    ocultarCero
                  />
                </td>
                <td className="px-3 py-1 text-right">
                  <MoneyCell
                    valor={linea.abono}
                    moneda={asiento.moneda}
                    ocultarCero
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(intentoEnvio && erroresGenerales.length > 0) || errorServidor ? (
        <div
          role="alert"
          className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset"
        >
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor
              ? `${errorServidor.codigo}: ${errorServidor.message}`
              : 'No se puede reversar el asiento'}
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {(errorServidor?.detalles.length
              ? errorServidor.detalles
              : erroresGenerales.map((e) => e.mensaje)
            ).map((mensaje, i) => (
              <li key={i}>{mensaje}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialogo>
  )
}
