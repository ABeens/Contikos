import { useMemo, useState } from 'react'
import { Ban, CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input } from '@/shared/ui/Field'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { ApiError } from '@/shared/api/client'
import { usePeriodos } from '@/shared/api/catalogos'
import type { Cobro, SolicitudAnulacionCobro } from '@/shared/api/contracts/cxc'
import type { Periodo } from '@/shared/api/contracts/conta'
import { useAnularCobro } from '../api/queries'

/**
 * Fecha con la que se propone la anulación.
 *
 * Hoy, si hoy cae en periodo abierto; si no, el primer día del primer periodo
 * abierto. Es la regla de docs/02 §6: la reversa va en un periodo abierto, y
 * proponer una fecha que el servidor va a rechazar es hacer teclear dos veces.
 */
function fechaPropuesta(periodos: readonly Periodo[]): string {
  const hoy = hoyISO()
  const periodoDeHoy = periodos.find(
    (p) => hoy >= p.fechaInicio && hoy <= p.fechaFin,
  )
  if (periodoDeHoy?.estado === 'abierto') return hoy
  return periodos.find((p) => p.estado === 'abierto')?.fechaInicio ?? hoy
}

/**
 * Anulación de un cobro (docs/04 §2.2, docs/02 §6).
 *
 * Anular no borra: reversa el asiento y devuelve el saldo a las facturas que el
 * cobro había bajado. El documento queda en el histórico con su motivo, que es
 * lo único que explicará dentro de un año por qué una factura que estaba pagada
 * volvió a estar por cobrar.
 *
 * Se admite aunque el cobro esté en un periodo ya cerrado: la reversa va en el
 * periodo abierto, no se reabre nada para corregir. Lo que sí se exige es que
 * la fecha de la anulación caiga en periodo abierto, y por eso se propone sola.
 */
export function DialogoAnularCobro({
  cobro,
  abierto,
  onCerrar,
}: {
  cobro: Cobro
  abierto: boolean
  onCerrar: () => void
}) {
  const { data: periodos = [] } = usePeriodos()
  const anular = useAnularCobro()

  const [fecha, setFecha] = useState(() => fechaPropuesta(periodos))
  const [motivo, setMotivo] = useState('')
  const [intentoEnvio, setIntentoEnvio] = useState(false)

  const solicitud: SolicitudAnulacionCobro = useMemo(
    () => ({ fecha, motivo }),
    [fecha, motivo],
  )

  const periodo = periodos.find(
    (p) => fecha >= p.fechaInicio && fecha <= p.fechaFin,
  )
  const periodoDelCobro = periodos.find(
    (p) => cobro.fecha >= p.fechaInicio && cobro.fecha <= p.fechaFin,
  )

  const errorMotivo =
    intentoEnvio && motivo.trim() === ''
      ? 'El motivo de la anulación es obligatorio'
      : undefined
  const errorFecha = !periodo
    ? intentoEnvio
      ? 'No existe un periodo que contenga esa fecha'
      : undefined
    : periodo.estado !== 'abierto'
      ? `El periodo ${periodo.numero}/${periodo.ejercicio} está ${periodo.estado}`
      : undefined

  const errorServidor = anular.error instanceof ApiError ? anular.error : null

  const confirmar = async () => {
    setIntentoEnvio(true)
    if (motivo.trim() === '' || errorFecha) return
    const anulado = await anular.mutateAsync({ id: cobro.id, solicitud })
      .catch(() => null)
    if (!anulado) return
    onCerrar()
  }

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={`Anular el cobro ${cobro.numero}`}
      descripcion="Se reversa el asiento y el saldo vuelve a las facturas. El cobro no se borra: queda en el histórico como anulado."
      className="w-[min(94vw,42rem)]"
      acciones={
        <>
          <Button onClick={onCerrar} disabled={anular.isPending}>
            Cancelar
          </Button>
          <Button
            variante="peligro"
            icono={<Ban className="size-4" />}
            onClick={() => void confirmar()}
            disabled={anular.isPending}
          >
            {anular.isPending ? 'Anulando…' : 'Confirmar anulación'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          label="Fecha de la anulación"
          requerido
          error={errorFecha}
          ayuda={
            periodoDelCobro && periodoDelCobro.estado !== 'abierto'
              ? 'El periodo del cobro ya cerró: la reversa va en el abierto'
              : undefined
          }
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
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
              placeholder="Por qué se anula. Queda en el histórico del cobro."
              onChange={(e) => setMotivo(e.target.value)}
            />
          )}
        </Field>
      </div>

      <p className="mt-4 text-xs font-medium text-slate-600">
        Saldo que vuelve a las facturas
      </p>
      <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 font-semibold text-slate-600">
            <tr>
              <th className="px-3 py-1.5 text-left">Factura</th>
              <th className="w-32 px-3 py-1.5 text-right">Saldo que vuelve</th>
            </tr>
          </thead>
          <tbody>
            {cobro.aplicaciones.map((aplicacion) => (
              <tr key={aplicacion.facturaId} className="border-t border-slate-100">
                <td className="px-3 py-1 font-mono text-slate-600">
                  {aplicacion.facturaNumero}
                </td>
                <td className="px-3 py-1 text-right">
                  <MoneyCell
                    valor={aplicacion.importeAplicado}
                    moneda={cobro.moneda}
                  />
                </td>
              </tr>
            ))}
            {cobro.aplicaciones.length === 0 && (
              <tr>
                <td
                  colSpan={2}
                  className="px-3 py-3 text-center text-slate-500"
                >
                  El cobro no se aplicó a ninguna factura. Lo que se reversa es
                  el anticipo del {formatFecha(cobro.fecha)}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {errorServidor && (
        <div className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor.codigo}: {errorServidor.message}
          </p>
          {errorServidor.detalles.length > 0 && (
            <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
              {errorServidor.detalles.map((mensaje, i) => (
                <li key={i}>{mensaje}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialogo>
  )
}
