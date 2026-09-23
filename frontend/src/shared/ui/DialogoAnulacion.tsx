import { useState, type ReactNode } from 'react'
import { Ban } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input } from '@/shared/ui/Field'
import { MensajeError } from '@/shared/ui/MensajeError'
import { hoyISO } from '@/shared/format/fecha'
import { usePeriodos } from '@/shared/api/catalogos'
import type { Periodo } from '@/shared/api/contracts/conta'

/**
 * Fecha con la que se propone la anulación.
 *
 * Hoy, si hoy cae en periodo abierto; si no, el primer día del primer periodo
 * abierto. Es la regla de docs/02 §6: la reversa va en un periodo abierto, y
 * proponer una fecha que el servidor va a rechazar es hacer teclear dos veces.
 */
function fechaPropuestaAnulacion(periodos: readonly Periodo[]): string {
  const hoy = hoyISO()
  const periodoDeHoy = periodos.find(
    (p) => hoy >= p.fechaInicio && hoy <= p.fechaFin,
  )
  if (periodoDeHoy?.estado === 'abierto') return hoy
  return periodos.find((p) => p.estado === 'abierto')?.fechaInicio ?? hoy
}

/**
 * Diálogo común de anulación de un documento contabilizado (docs/02 §6).
 *
 * Anular no borra: reversa el asiento y devuelve el saldo a las facturas. Lo
 * que se pide es lo mismo para cualquier documento, una fecha en periodo
 * abierto y un motivo, y por eso vive en un solo sitio: dos diálogos distintos
 * terminaban validando cosas distintas.
 *
 * La fecha se propone a partir de los periodos y se sigue proponiendo mientras
 * nadie la toque: si los periodos llegan después de abrir el diálogo, la
 * propuesta se corrige sola en vez de quedarse con la de hoy.
 */
export function DialogoAnulacion({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  fechaDocumento,
  textoConfirmar,
  placeholderMotivo,
  anular,
  pendiente,
  error,
  alEditar,
  children,
}: {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  descripcion: string
  /** Fecha del documento: si su periodo cerró, se explica dónde va la reversa. */
  fechaDocumento: string
  textoConfirmar: string
  placeholderMotivo: string
  /** Envía la anulación. Si se resuelve, el diálogo se cierra. */
  anular: (solicitud: { fecha: string; motivo: string }) => Promise<unknown>
  pendiente: boolean
  /** Error del servidor, que se enseña dentro del diálogo. */
  error: unknown
  /** Se avisa al editar, para descartar un rechazo que ya no aplica. */
  alEditar: () => void
  /** Lo que se deshace: el saldo que vuelve a cada factura. */
  children?: ReactNode
}) {
  const { data: periodos = [] } = usePeriodos()

  const [fechaEditada, setFechaEditada] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [intentoEnvio, setIntentoEnvio] = useState(false)

  const fecha = fechaEditada ?? fechaPropuestaAnulacion(periodos)

  const periodo = periodos.find(
    (p) => fecha >= p.fechaInicio && fecha <= p.fechaFin,
  )
  const periodoDelDocumento = periodos.find(
    (p) => fechaDocumento >= p.fechaInicio && fechaDocumento <= p.fechaFin,
  )

  const errorMotivo =
    intentoEnvio && motivo.trim() === ''
      ? 'El motivo de la anulación es obligatorio'
      : undefined
  // Sin periodos cargados no se sabe nada de la fecha: se deja pasar y que
  // decida el servidor, que es quien manda.
  const errorFecha =
    fecha === ''
      ? intentoEnvio
        ? 'Indique la fecha de la anulación'
        : undefined
      : periodos.length === 0
        ? undefined
        : !periodo
          ? 'No existe un periodo que contenga esa fecha'
          : periodo.estado !== 'abierto'
            ? `El periodo ${periodo.numero}/${periodo.ejercicio} está ${periodo.estado}`
            : undefined

  const confirmar = () => {
    setIntentoEnvio(true)
    if (motivo.trim() === '' || fecha === '' || errorFecha) return
    // El rechazo se enseña desde `error`; aquí solo se evita dejar la promesa
    // suelta y cerrar sobre una anulación que no ocurrió.
    anular({ fecha, motivo: motivo.trim() }).then(onCerrar, () => undefined)
  }

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={titulo}
      descripcion={descripcion}
      bloqueado={pendiente}
      alEnviar={confirmar}
      className="w-[min(94vw,42rem)]"
      acciones={
        <>
          <Button onClick={onCerrar} disabled={pendiente}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variante="peligro"
            icono={<Ban className="size-4" />}
            disabled={pendiente}
          >
            {pendiente ? 'Anulando…' : textoConfirmar}
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
            periodoDelDocumento && periodoDelDocumento.estado !== 'abierto'
              ? 'El periodo del documento ya cerró: la reversa va en el abierto'
              : undefined
          }
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              value={fecha}
              onChange={(e) => {
                setFechaEditada(e.target.value)
                alEditar()
              }}
            />
          )}
        </Field>
        <Field
          label="Motivo"
          requerido
          error={errorMotivo}
          ayuda={errorMotivo ? undefined : 'Queda en el histórico del documento'}
          className="sm:col-span-2"
        >
          {(p) => (
            <Input
              {...p}
              value={motivo}
              autoFocus
              placeholder={placeholderMotivo}
              onChange={(e) => {
                setMotivo(e.target.value)
                alEditar()
              }}
            />
          )}
        </Field>
      </div>

      {children}

      <MensajeError error={error} className="mt-4" />
    </Dialogo>
  )
}
