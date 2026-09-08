import { useMemo, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Select } from '@/shared/ui/Field'
import { ApiError } from '@/shared/api/client'
import type {
  ClasificacionNiif,
  Cuenta,
  NotaEeff,
} from '@/shared/api/contracts/conta'
import {
  ETIQUETA_ESTADO_FINANCIERO,
  ETIQUETA_TIPO_CUENTA,
  notasAsignables,
  ordenarClasificaciones,
  referenciaNota,
  validarClasificacionCuenta,
} from '../domain/clasificacion'
import { useClasificarCuenta } from '../api/queries'

const SIN_ASIGNAR = ''

export interface DialogoClasificarCuentaProps {
  abierto: boolean
  onCerrar: () => void
  cuenta: Cuenta
  clasificaciones: readonly ClasificacionNiif[]
  notas: readonly NotaEeff[]
  cuentas: readonly Cuenta[]
}

/**
 * Reasigna a una cuenta su renglón del estado financiero y su nota.
 *
 * El selector de notas solo ofrece las de la clasificación elegida. Esa es la
 * jerarquía hecha interfaz: si la lista mostrara todas las notas, la mitad de
 * las opciones producirían un desglose que no cuadra contra su renglón.
 *
 * Las dos son obligatorias, así que no hay opción de vaciarlas: desde aquí se
 * cambia la presentación de una cuenta, nunca se le quita (docs/03 §2 bis).
 */
export function DialogoClasificarCuenta({
  abierto,
  onCerrar,
  cuenta,
  clasificaciones,
  notas,
  cuentas,
}: DialogoClasificarCuentaProps) {
  const clasificar = useClasificarCuenta()

  const [clasificacionId, setClasificacionId] = useState(
    cuenta.clasificacionNiifId ?? SIN_ASIGNAR,
  )
  const [notaId, setNotaId] = useState(cuenta.notaEeffId ?? SIN_ASIGNAR)
  const [intentoEnvio, setIntentoEnvio] = useState(false)

  /**
   * Solo las clasificaciones activas que admiten el tipo de esta cuenta.
   *
   * Se filtra en vez de dejar elegir y luego rechazar: el usuario no tiene por
   * qué saber de memoria qué renglones admiten una cuenta de gasto.
   */
  const disponibles = useMemo(
    () =>
      ordenarClasificaciones(
        clasificaciones.filter(
          (c) =>
            c.id === cuenta.clasificacionNiifId ||
            // Sin notas no se puede asignar: la nota es obligatoria y el
            // renglón no tendría ninguna que ofrecer.
            (c.activa &&
              c.tiposCuenta.includes(cuenta.tipo) &&
              notasAsignables(c.id, notas).length > 0),
        ),
      ),
    [clasificaciones, notas, cuenta],
  )

  const notasDisponibles = useMemo(
    () =>
      clasificacionId === SIN_ASIGNAR
        ? []
        : notasAsignables(clasificacionId, notas).concat(
            notas.filter(
              (n) =>
                n.id === cuenta.notaEeffId &&
                !n.activa &&
                n.clasificacionNiifId === clasificacionId,
            ),
          ),
    [clasificacionId, notas, cuenta],
  )

  const asignacion = useMemo(
    () => ({
      clasificacionNiifId:
        clasificacionId === SIN_ASIGNAR ? null : clasificacionId,
      notaEeffId: notaId === SIN_ASIGNAR ? null : notaId,
    }),
    [clasificacionId, notaId],
  )

  const validacion = useMemo(
    () =>
      validarClasificacionCuenta(cuenta.id, asignacion, {
        clasificaciones,
        notas,
        cuentas,
      }),
    [cuenta.id, asignacion, clasificaciones, notas, cuentas],
  )

  const errorDe = (campo: string): string | undefined =>
    intentoEnvio
      ? validacion.errores.find((e) => e.campo === campo)?.mensaje
      : undefined

  /** Cambiar de renglón invalida la nota: pertenecía al renglón anterior. */
  const cambiarClasificacion = (id: string) => {
    setClasificacionId(id)
    setNotaId(SIN_ASIGNAR)
  }

  const enviar = async () => {
    setIntentoEnvio(true)
    if (!validacion.valido) return
    await clasificar.mutateAsync({ cuentaId: cuenta.id, asignacion })
    onCerrar()
  }

  const errorServidor =
    clasificar.error instanceof ApiError ? clasificar.error : null

  const clasificacionElegida = clasificaciones.find(
    (c) => c.id === clasificacionId,
  )

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={`Presentación de ${cuenta.codigo}`}
      descripcion={`${cuenta.nombre} · ${ETIQUETA_TIPO_CUENTA[cuenta.tipo]}`}
      acciones={
        <>
          <Button onClick={onCerrar}>Cancelar</Button>
          <Button
            variante="primario"
            onClick={() => void enviar()}
            disabled={clasificar.isPending || !cuenta.esDetalle}
          >
            {clasificar.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      {!cuenta.esDetalle ? (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600 ring-1 ring-slate-200 ring-inset">
          {cuenta.codigo} es una cuenta acumulativa: presenta lo que suman sus
          cuentas hijas y no se clasifica por separado. Clasifique las cuentas de
          detalle que cuelgan de ella.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Field
            label="Clasificación NIIF"
            requerido
            error={errorDe('clasificacionNiifId')}
            ayuda={
              clasificacionElegida
                ? ETIQUETA_ESTADO_FINANCIERO[
                    clasificacionElegida.estadoFinanciero
                  ]
                : 'Solo se ofrecen los renglones que admiten cuentas de este tipo'
            }
          >
            {(p) => (
              <Select
                {...p}
                value={clasificacionId}
                onChange={(e) => cambiarClasificacion(e.target.value)}
              >
                <option value={SIN_ASIGNAR}>Elija el renglón…</option>
                {disponibles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} · {c.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Nota a los estados financieros"
            requerido
            error={errorDe('notaEeffId')}
            ayuda={
              clasificacionId === SIN_ASIGNAR
                ? 'Primero elija la clasificación: la nota cuelga de ella'
                : notasDisponibles.length === 0
                  ? 'Este renglón todavía no tiene notas: créela en el catálogo de clasificaciones'
                  : 'El desglose en el que se explica esta cuenta'
            }
          >
            {(p) => (
              <Select
                {...p}
                value={notaId}
                disabled={notasDisponibles.length === 0}
                onChange={(e) => setNotaId(e.target.value)}
              >
                <option value={SIN_ASIGNAR}>Elija la nota…</option>
                {notasDisponibles.map((n) => (
                  <option key={n.id} value={n.id}>
                    Nota {referenciaNota(n)} · {n.titulo}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}

      {(intentoEnvio && !validacion.valido) || errorServidor ? (
        <div className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor
              ? `${errorServidor.codigo} · ${errorServidor.message}`
              : 'La cuenta no se puede clasificar'}
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {(errorServidor?.detalles.length
              ? errorServidor.detalles
              : validacion.errores.map((e) => e.mensaje)
            ).map((mensaje, i) => (
              <li key={i}>{mensaje}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialogo>
  )
}
