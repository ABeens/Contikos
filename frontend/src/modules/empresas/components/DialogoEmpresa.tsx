import { useMemo, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input, Select } from '@/shared/ui/Field'
import { ApiError } from '@/shared/api/client'
import type { Empresa, SolicitudEmpresa } from '@/shared/api/contracts/empresas'
import {
  TIPOS_IDENTIFICACION,
  type TipoIdentificacion,
} from '@/shared/fiscal/identificacion'
import {
  aSolicitud,
  MESES,
  normalizarSolicitud,
  validarEmpresa,
} from '../domain/empresa'
import { useGuardarEmpresa } from '../api/queries'

const NUEVA: SolicitudEmpresa = {
  codigo: '',
  nombre: '',
  nombreComercial: null,
  tipoIdentificacion: 'JURIDICA',
  identificacion: '',
  pais: 'CR',
  ejercicioInicioMes: 1,
  activa: true,
}

export interface DialogoEmpresaProps {
  abierto: boolean
  onCerrar: () => void
  /** Sin empresa, el diálogo da de alta una nueva. */
  empresa?: Empresa
  empresas: readonly Empresa[]
  /** La abierta en esta sesión: no se puede desactivar desde dentro. */
  empresaAbierta: string
}

/**
 * Alta y edición de una empresa del grupo.
 *
 * Una empresa nueva arranca con los catálogos de plantilla (cuentas NIIF,
 * monedas, periodos, categorías) y sin un solo documento. Lo que aquí se
 * captura es lo que la identifica ante Hacienda; lo demás se configura desde
 * dentro, una vez abierta.
 */
export function DialogoEmpresa({
  abierto,
  onCerrar,
  empresa,
  empresas,
  empresaAbierta,
}: DialogoEmpresaProps) {
  const creando = empresa === undefined
  const guardar = useGuardarEmpresa()

  const [form, setForm] = useState<SolicitudEmpresa>(() =>
    empresa ? aSolicitud(empresa) : { ...NUEVA },
  )
  const [intento, setIntento] = useState(false)

  const cambiar = <K extends keyof SolicitudEmpresa>(
    campo: K,
    valor: SolicitudEmpresa[K],
  ) => setForm((prev) => ({ ...prev, [campo]: valor }))

  const validacion = useMemo(
    () => validarEmpresa(form, { empresas, empresaAbierta }, empresa?.id),
    [form, empresas, empresaAbierta, empresa],
  )

  const errorDe = (campo: keyof SolicitudEmpresa): string | undefined =>
    intento
      ? validacion.errores.find((e) => e.campo === campo)?.mensaje
      : undefined

  const errorServidor = guardar.error instanceof ApiError ? guardar.error : null

  const enviar = async () => {
    setIntento(true)
    if (!validacion.valido) return
    await guardar.mutateAsync({
      datos: normalizarSolicitud(form),
      id: empresa?.id,
    })
    onCerrar()
  }

  const esLaAbierta = empresa?.id === empresaAbierta

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={creando ? 'Nueva empresa' : `Empresa ${empresa.codigo}`}
      descripcion={
        creando
          ? 'Arranca con el catálogo de cuentas de plantilla y sin documentos. Sus datos no se mezclan con los de ninguna otra.'
          : 'Los datos que la identifican ante Hacienda. Los catálogos y el mayor se administran desde dentro de la empresa.'
      }
      className="w-[min(94vw,40rem)]"
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Siglas" requerido error={errorDe('codigo')} ayuda="Hasta 8 caracteres">
          {(p) => (
            <Input
              {...p}
              value={form.codigo}
              maxLength={8}
              placeholder="SCK"
              autoFocus={creando}
              className="font-mono uppercase"
              onChange={(e) => cambiar('codigo', e.target.value.toUpperCase())}
            />
          )}
        </Field>

        <Field
          label="Razón social"
          requerido
          className="sm:col-span-2"
          error={errorDe('nombre')}
        >
          {(p) => (
            <Input
              {...p}
              value={form.nombre}
              placeholder="Soluciones Contikos S.A."
              autoFocus={!creando}
              onChange={(e) => cambiar('nombre', e.target.value)}
            />
          )}
        </Field>

        <Field label="Nombre comercial" className="sm:col-span-3">
          {(p) => (
            <Input
              {...p}
              value={form.nombreComercial ?? ''}
              onChange={(e) => cambiar('nombreComercial', e.target.value || null)}
            />
          )}
        </Field>

        <Field label="Tipo de identificación" requerido>
          {(p) => (
            <Select
              {...p}
              value={form.tipoIdentificacion}
              onChange={(e) =>
                cambiar('tipoIdentificacion', e.target.value as TipoIdentificacion)
              }
            >
              {Object.values(TIPOS_IDENTIFICACION).map((t) => (
                <option key={t.tipo} value={t.tipo}>
                  {t.nombre}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Identificación"
          requerido
          className="sm:col-span-2"
          error={errorDe('identificacion')}
          ayuda="Sin guiones. Única en el grupo."
        >
          {(p) => (
            <Input
              {...p}
              value={form.identificacion}
              inputMode="numeric"
              placeholder="3101123456"
              className="font-mono"
              onChange={(e) => cambiar('identificacion', e.target.value)}
            />
          )}
        </Field>

        <Field label="País" requerido>
          {(p) => (
            <Select {...p} value={form.pais} disabled>
              <option value="CR">Costa Rica</option>
            </Select>
          )}
        </Field>

        <Field
          label="Inicio del ejercicio"
          requerido
          className="sm:col-span-2"
          error={errorDe('ejercicioInicioMes')}
          ayuda="En Costa Rica el periodo fiscal es el año calendario"
        >
          {(p) => (
            <Select
              {...p}
              value={String(form.ejercicioInicioMes)}
              onChange={(e) =>
                cambiar('ejercicioInicioMes', Number(e.target.value))
              }
            >
              {MESES.map((mes, i) => (
                <option key={mes} value={i + 1}>
                  {mes}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="sm:col-span-3">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.activa}
              disabled={esLaAbierta}
              className="mt-0.5 size-4 accent-brand-600"
              onChange={(e) => cambiar('activa', e.target.checked)}
            />
            <span>
              Activa
              <span className="block text-xs text-slate-500">
                {esLaAbierta
                  ? 'Es la empresa abierta: para desactivarla, cambie a otra primero.'
                  : 'Una empresa inactiva no se ofrece en el selector, pero sus datos siguen guardados.'}
              </span>
            </span>
          </label>
          {errorDe('activa') && (
            <p className="mt-1 text-xs text-red-600">{errorDe('activa')}</p>
          )}
        </div>
      </div>

      {(intento && !validacion.valido) || errorServidor ? (
        <div className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor
              ? `${errorServidor.codigo}: ${errorServidor.message}`
              : 'La empresa no se puede guardar'}
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
