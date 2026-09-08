import { useMemo, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input, Select } from '@/shared/ui/Field'
import { inputClass } from '@/shared/ui/estilos'
import { ApiError } from '@/shared/api/client'
import type {
  ClasificacionNiif,
  Cuenta,
  NotaEeff,
  SolicitudNotaEeff,
} from '@/shared/api/contracts/conta'
import {
  normalizarLiteral,
  ordenarClasificaciones,
  referenciaNota,
  validarNota,
} from '../domain/clasificacion'
import { useGuardarNota } from '../api/queries'

export interface DialogoNotaEeffProps {
  abierto: boolean
  onCerrar: () => void
  /** Sin nota, el diálogo da de alta una nueva. */
  nota?: NotaEeff
  /** Clasificación preseleccionada al crear desde el detalle de un renglón. */
  clasificacionInicialId?: string
  clasificaciones: readonly ClasificacionNiif[]
  notas: readonly NotaEeff[]
  cuentas: readonly Cuenta[]
}

/**
 * Alta y edición de una nota a los estados financieros.
 *
 * La clasificación es un campo obligatorio y no un adorno: la nota es la
 * subcategoría del renglón, y es lo que permite que su desglose cuadre contra
 * el importe presentado.
 */
export function DialogoNotaEeff({
  abierto,
  onCerrar,
  nota,
  clasificacionInicialId,
  clasificaciones,
  notas,
  cuentas,
}: DialogoNotaEeffProps) {
  const creando = nota === undefined
  const guardar = useGuardarNota()

  const ordenadas = useMemo(
    () => ordenarClasificaciones(clasificaciones),
    [clasificaciones],
  )

  // El primer número libre. Un hueco en la numeración de los EEFF se nota, y
  // dejar que el usuario lo busque a mano es hacerle trabajo del sistema.
  const siguienteNumero = useMemo(() => {
    const usados = new Set(notas.map((n) => n.numero))
    let n = 1
    while (usados.has(n)) n += 1
    return n
  }, [notas])

  const [form, setForm] = useState<SolicitudNotaEeff>(() =>
    nota
      ? {
          clasificacionNiifId: nota.clasificacionNiifId,
          numero: nota.numero,
          literal: nota.literal,
          titulo: nota.titulo,
          descripcion: nota.descripcion,
          activa: nota.activa,
        }
      : {
          clasificacionNiifId:
            clasificacionInicialId ?? ordenadas[0]?.id ?? '',
          numero: siguienteNumero,
          literal: '',
          titulo: '',
          descripcion: '',
          activa: true,
        },
  )
  const [intentoEnvio, setIntentoEnvio] = useState(false)

  const cambiar = <K extends keyof SolicitudNotaEeff>(
    campo: K,
    valor: SolicitudNotaEeff[K],
  ) => setForm((prev) => ({ ...prev, [campo]: valor }))

  const validacion = useMemo(
    () =>
      validarNota(form, { clasificaciones, notas, cuentas }, nota?.id),
    [form, clasificaciones, notas, cuentas, nota],
  )

  const errorDe = (campo: string): string | undefined =>
    intentoEnvio
      ? validacion.errores.find((e) => e.campo === campo)?.mensaje
      : undefined

  const enviar = async () => {
    setIntentoEnvio(true)
    if (!validacion.valido) return
    await guardar.mutateAsync({
      nota: {
        ...form,
        literal: normalizarLiteral(form.literal),
        titulo: form.titulo.trim(),
        descripcion: form.descripcion.trim(),
      },
      id: nota?.id,
    })
    onCerrar()
  }

  const errorServidor = guardar.error instanceof ApiError ? guardar.error : null

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={
        creando ? 'Nueva nota a los EEFF' : `Nota ${referenciaNota(nota)}`
      }
      descripcion="Desglosa un renglón del estado financiero. Cuelga siempre de una clasificación NIIF."
      acciones={
        <>
          <Button onClick={onCerrar}>Cancelar</Button>
          <Button
            variante="primario"
            onClick={() => void enviar()}
            disabled={guardar.isPending}
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-4 gap-4">
        <Field
          label="Número"
          requerido
          error={errorDe('numero')}
          ayuda="Corrido"
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              value={String(form.numero)}
              className="tabular"
              onChange={(e) => cambiar('numero', Number(e.target.value))}
            />
          )}
        </Field>

        {/* El literal subdivide el número sin renumerar el resto del
            catálogo: la nota 1 se explica en 1a y 1b, y cada una se cita por
            separado en el cuerpo del estado financiero. */}
        <Field
          label="Literal"
          error={errorDe('literal')}
          ayuda="Opcional: 1a, 1b"
        >
          {(p) => (
            <Input
              {...p}
              value={form.literal}
              maxLength={2}
              placeholder="a"
              onChange={(e) => cambiar('literal', e.target.value)}
            />
          )}
        </Field>

        {/* El renglón se lleva su propia fila: el desplegable enseña código y
            nombre, y a media fila el nombre se cortaba justo donde informa. */}
        <Field
          label="Clasificación NIIF que desglosa"
          requerido
          className="col-span-4"
          error={errorDe('clasificacionNiifId')}
        >
          {(p) => (
            <Select
              {...p}
              value={form.clasificacionNiifId}
              onChange={(e) => cambiar('clasificacionNiifId', e.target.value)}
            >
              {ordenadas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} · {c.nombre}
                  {c.activa ? '' : ' (inactiva)'}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Título"
          requerido
          className="col-span-4"
          error={errorDe('titulo')}
        >
          {(p) => (
            <Input
              {...p}
              value={form.titulo}
              placeholder="Activos intangibles"
              autoFocus
              onChange={(e) => cambiar('titulo', e.target.value)}
            />
          )}
        </Field>

        <Field
          label="Qué revela"
          className="col-span-4"
          ayuda="El guion del desglose, no el desglose. Los importes los pone el reporte."
        >
          {(p) => (
            <textarea
              {...p}
              rows={3}
              value={form.descripcion}
              placeholder="Importe en libros por categoría, amortización acumulada y vida útil aplicada."
              className={`${inputClass} h-auto py-2`}
              onChange={(e) => cambiar('descripcion', e.target.value)}
            />
          )}
        </Field>

        <div className="col-span-4">
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
                Una nota inactiva no se ofrece al clasificar cuentas.
              </span>
            </span>
          </label>
          {errorDe('activa') && (
            <p className="mt-1 text-xs text-red-600">{errorDe('activa')}</p>
          )}
        </div>
      </div>

      {(intentoEnvio && !validacion.valido) || errorServidor ? (
        <div className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor
              ? `${errorServidor.codigo} · ${errorServidor.message}`
              : 'La nota no se puede guardar'}
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
