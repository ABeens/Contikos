import { useId, useMemo, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input, Select } from '@/shared/ui/Field'
import { ApiError } from '@/shared/api/client'
import type {
  ClasificacionNiif,
  Cuenta,
  EstadoFinanciero,
  NotaEeff,
  SolicitudClasificacionNiif,
  TipoCuenta,
} from '@/shared/api/contracts/conta'
import {
  ESTADOS_FINANCIEROS,
  TipoCuentaSchema,
} from '@/shared/api/contracts/conta'
import {
  ETIQUETA_ESTADO_FINANCIERO,
  ETIQUETA_TIPO_CUENTA,
  validarClasificacion,
} from '../domain/clasificacion'
import { useGuardarClasificacion } from '../api/queries'

const TIPOS: readonly TipoCuenta[] = TipoCuentaSchema.options

const NUEVA: SolicitudClasificacionNiif = {
  codigo: '',
  nombre: '',
  estadoFinanciero: 'situacion',
  tiposCuenta: [],
  seccionNiif: null,
  orden: 0,
  activa: true,
}

export interface DialogoClasificacionNiifProps {
  abierto: boolean
  onCerrar: () => void
  /** Sin clasificación, el diálogo da de alta una nueva. */
  clasificacion?: ClasificacionNiif
  clasificaciones: readonly ClasificacionNiif[]
  notas: readonly NotaEeff[]
  cuentas: readonly Cuenta[]
}

/**
 * Alta y edición de una clasificación NIIF.
 *
 * Los tipos de cuenta admitidos son la parte que más se toca al editar, y la
 * que más se equivoca: quitar uno que ya tiene cuentas dejaría el catálogo
 * incoherente, así que el diálogo lo dice antes de guardar en vez de dejar que
 * el servidor lo rechace.
 */
export function DialogoClasificacionNiif({
  abierto,
  onCerrar,
  clasificacion,
  clasificaciones,
  notas,
  cuentas,
}: DialogoClasificacionNiifProps) {
  const creando = clasificacion === undefined
  const guardar = useGuardarClasificacion()
  const idAyudaTipos = useId()

  const [form, setForm] = useState<SolicitudClasificacionNiif>(() =>
    clasificacion
      ? {
          codigo: clasificacion.codigo,
          nombre: clasificacion.nombre,
          estadoFinanciero: clasificacion.estadoFinanciero,
          tiposCuenta: [...clasificacion.tiposCuenta],
          seccionNiif: clasificacion.seccionNiif,
          orden: clasificacion.orden,
          activa: clasificacion.activa,
        }
      : { ...NUEVA },
  )
  /**
   * El orden se guarda como lo tecleado y se convierte al validar. Guardado
   * como número, vaciar el campo para escribir otro lo devolvía a 0 en el
   * acto, y el cursor saltaba detrás del cero.
   */
  const [ordenTexto, setOrdenTexto] = useState(() => String(form.orden))
  const [intentoEnvio, setIntentoEnvio] = useState(false)

  /** El error del servidor era sobre los datos de antes de este cambio. */
  const limpiarErrorServidor = () => {
    if (guardar.isError) guardar.reset()
  }

  const cambiar = <K extends keyof SolicitudClasificacionNiif>(
    campo: K,
    valor: SolicitudClasificacionNiif[K],
  ) => {
    limpiarErrorServidor()
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  const alternarTipo = (tipo: TipoCuenta) => {
    limpiarErrorServidor()
    setForm((prev) => ({
      ...prev,
      // Se conserva el orden del enum para que la lista no baile según el orden
      // en que se marcaron las casillas.
      tiposCuenta: TIPOS.filter((t) =>
        t === tipo ? !prev.tiposCuenta.includes(t) : prev.tiposCuenta.includes(t),
      ),
    }))
  }

  // Vacío no es cero: sin número, la validación lo rechaza en vez de guardar
  // un orden que nadie escribió.
  const solicitud = useMemo<SolicitudClasificacionNiif>(
    () => ({
      ...form,
      orden: ordenTexto.trim() === '' ? Number.NaN : Number(ordenTexto),
    }),
    [form, ordenTexto],
  )

  const validacion = useMemo(
    () =>
      validarClasificacion(
        { ...solicitud, codigo: solicitud.codigo.trim().toUpperCase() },
        { clasificaciones, notas, cuentas },
        clasificacion?.id,
      ),
    [solicitud, clasificaciones, notas, cuentas, clasificacion],
  )

  const errorDe = (campo: string): string | undefined =>
    intentoEnvio
      ? validacion.errores.find((e) => e.campo === campo)?.mensaje
      : undefined

  const enviar = () => {
    setIntentoEnvio(true)
    if (!validacion.valido || guardar.isPending) return
    guardar.mutate(
      {
        clasificacion: {
          ...solicitud,
          codigo: solicitud.codigo.trim().toUpperCase(),
          nombre: solicitud.nombre.trim(),
          seccionNiif: solicitud.seccionNiif?.trim() || null,
        },
        id: clasificacion?.id,
      },
      { onSuccess: onCerrar },
    )
  }

  const errorServidor = guardar.error instanceof ApiError ? guardar.error : null

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={guardar.isPending}
      alEnviar={enviar}
      titulo={
        creando ? 'Nueva clasificación NIIF' : `Clasificación ${clasificacion.codigo}`
      }
      descripcion="El renglón del estado financiero en el que se presentan las cuentas que se le asignen."
      acciones={
        <>
          <Button onClick={onCerrar} disabled={guardar.isPending}>
            Cancelar
          </Button>
          <Button
            variante="primario"
            type="submit"
            disabled={guardar.isPending}
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Código" requerido error={errorDe('codigo')}>
          {(p) => (
            <Input
              {...p}
              value={form.codigo}
              maxLength={12}
              placeholder="A.07"
              autoFocus
              className="font-mono uppercase"
              onChange={(e) => cambiar('codigo', e.target.value.toUpperCase())}
            />
          )}
        </Field>

        <Field
          label="Orden"
          requerido
          error={errorDe('orden')}
          ayuda="Posición dentro de su estado financiero"
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              step={10}
              value={ordenTexto}
              className="tabular"
              onChange={(e) => {
                limpiarErrorServidor()
                setOrdenTexto(e.target.value)
              }}
            />
          )}
        </Field>

        <Field
          label="Nombre del renglón"
          requerido
          className="col-span-2"
          error={errorDe('nombre')}
        >
          {(p) => (
            <Input
              {...p}
              value={form.nombre}
              placeholder="Activos intangibles"
              onChange={(e) => cambiar('nombre', e.target.value)}
            />
          )}
        </Field>

        <Field label="Estado financiero" requerido>
          {(p) => (
            <Select
              {...p}
              value={form.estadoFinanciero}
              onChange={(e) =>
                cambiar('estadoFinanciero', e.target.value as EstadoFinanciero)
              }
            >
              {ESTADOS_FINANCIEROS.map((estado) => (
                <option key={estado} value={estado}>
                  {ETIQUETA_ESTADO_FINANCIERO[estado]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Sección NIIF para PYMES"
          ayuda="Referencia, opcional"
        >
          {(p) => (
            <Input
              {...p}
              value={form.seccionNiif ?? ''}
              placeholder="Sección 18"
              onChange={(e) => cambiar('seccionNiif', e.target.value || null)}
            />
          )}
        </Field>

        {/* Un grupo de casillas es un fieldset: el lector de pantalla anuncia
            "Tipos de cuenta admitidos" al entrar en la primera, no solo
            "Activo, casilla". */}
        <fieldset
          className="col-span-2"
          aria-describedby={idAyudaTipos}
        >
          <legend className="text-xs font-medium text-slate-600">
            Tipos de cuenta admitidos <span className="text-red-500">*</span>
          </legend>
          <p id={idAyudaTipos} className="mt-0.5 text-xs text-slate-400">
            Solo se podrán clasificar aquí cuentas de estos tipos. Casi siempre
            es uno; son varios cuando el renglón se presenta neto.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {TIPOS.map((tipo) => (
              <label
                key={tipo}
                className="flex items-center gap-1.5 text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={form.tiposCuenta.includes(tipo)}
                  className="size-4 accent-brand-600"
                  onChange={() => alternarTipo(tipo)}
                />
                {ETIQUETA_TIPO_CUENTA[tipo]}
              </label>
            ))}
          </div>
          {errorDe('tiposCuenta') && (
            <p className="mt-1 text-xs text-red-600">{errorDe('tiposCuenta')}</p>
          )}
        </fieldset>

        <div className="col-span-2">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.activa}
              className="mt-0.5 size-4 accent-brand-600"
              onChange={(e) => cambiar('activa', e.target.checked)}
            />
            <span>
              Activa
              <span className="block text-xs text-slate-500">
                Una clasificación inactiva no se ofrece al clasificar cuentas,
                pero el renglón sigue existiendo en los reportes ya emitidos.
              </span>
            </span>
          </label>
          {errorDe('activa') && (
            <p className="mt-1 text-xs text-red-600">{errorDe('activa')}</p>
          )}
        </div>
      </div>

      {(intentoEnvio && !validacion.valido) || errorServidor ? (
        <div
          role="alert"
          className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset"
        >
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor
              ? `${errorServidor.codigo} · ${errorServidor.message}`
              : 'La clasificación no se puede guardar'}
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
