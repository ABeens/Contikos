import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input } from '@/shared/ui/Field'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { monedaFuncional } from '@/shared/money/money'
import { ApiError } from '@/shared/api/client'
import type { Empleado, SolicitudEmpleado } from '@/shared/api/contracts/rh'
import { hoyISO } from '@/shared/format/fecha'
import { useGuardarEmpleado } from '../api/queries'

const NUEVO: SolicitudEmpleado = {
  codigo: '',
  nombre: '',
  tipoIdentificacion: 'FISICA',
  identificacion: '',
  numeroAsegurado: '',
  puesto: '',
  fechaIngreso: hoyISO(),
  fechaSalida: null,
  salarioBase: '0',
  hijos: 0,
  creditoConyuge: false,
  cuentaIban: '',
  activo: true,
}

/**
 * Alta y edición de un empleado.
 *
 * Los hijos y el cónyuge están aquí y no en la planilla porque dan derecho al
 * crédito fiscal de todos los meses (docs/13 §6.2): se capturan una vez.
 */
export function DialogoEmpleado({
  abierto,
  onCerrar,
  empleado,
}: {
  abierto: boolean
  onCerrar: () => void
  empleado?: Empleado
}) {
  const guardar = useGuardarEmpleado()
  const [form, setForm] = useState<SolicitudEmpleado>(() => {
    if (!empleado) return { ...NUEVO }
    const { id, ...resto } = empleado
    void id
    return resto
  })
  const [intento, setIntento] = useState(false)

  const cambiar = <K extends keyof SolicitudEmpleado>(campo: K, valor: SolicitudEmpleado[K]) => {
    if (guardar.isError) guardar.reset()
    setForm((f) => ({ ...f, [campo]: valor }))
  }

  const iban = form.cuentaIban.replace(/\s/g, '').toUpperCase()
  const errores = [
    ...(form.codigo.trim() === '' ? ['El código es obligatorio'] : []),
    ...(form.nombre.trim() === '' ? ['El nombre es obligatorio'] : []),
    ...(!/^\d{9,12}$/.test(form.identificacion.replace(/\D/g, ''))
      ? ['La identificación tiene entre 9 y 12 dígitos']
      : []),
    ...(!(Number(form.salarioBase) > 0) ? ['El salario base tiene que ser mayor que cero'] : []),
    ...(!/^CR\d{20}$/.test(iban) ? ['La cuenta IBAN es CR seguida de 20 dígitos'] : []),
  ]

  const enviar = () => {
    setIntento(true)
    if (errores.length > 0 || guardar.isPending) return
    guardar.mutate(
      {
        datos: {
          ...form,
          numeroAsegurado: form.numeroAsegurado.trim() || form.identificacion,
          cuentaIban: iban,
        },
        id: empleado?.id,
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
      titulo={empleado ? empleado.nombre : 'Nuevo empleado'}
      acciones={
        <>
          <Button onClick={onCerrar} disabled={guardar.isPending}>
            Cancelar
          </Button>
          <Button variante="primario" type="submit" disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Código" requerido>
          {(p) => (
            <Input {...p} value={form.codigo} autoFocus onChange={(e) => cambiar('codigo', e.target.value)} />
          )}
        </Field>
        <Field label="Puesto">
          {(p) => <Input {...p} value={form.puesto} onChange={(e) => cambiar('puesto', e.target.value)} />}
        </Field>
        <Field label="Nombre completo" requerido className="col-span-2">
          {(p) => <Input {...p} value={form.nombre} onChange={(e) => cambiar('nombre', e.target.value)} />}
        </Field>
        <Field label="Cédula" requerido>
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={form.identificacion}
              onChange={(e) => cambiar('identificacion', e.target.value)}
            />
          )}
        </Field>
        <Field label="Número de asegurado" ayuda="Vacío: la cédula">
          {(p) => (
            <Input
              {...p}
              value={form.numeroAsegurado}
              onChange={(e) => cambiar('numeroAsegurado', e.target.value)}
            />
          )}
        </Field>
        <Field label="Fecha de ingreso" requerido>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={form.fechaIngreso}
              onChange={(e) => cambiar('fechaIngreso', e.target.value)}
            />
          )}
        </Field>
        <Field label="Fecha de salida" ayuda="Vacía mientras trabaja">
          {(p) => (
            <Input
              {...p}
              type="date"
              value={form.fechaSalida ?? ''}
              onChange={(e) => cambiar('fechaSalida', e.target.value || null)}
            />
          )}
        </Field>
        <Field label="Salario base mensual" requerido>
          {(p) => (
            <MoneyInput
              {...p}
              moneda={monedaFuncional()}
              value={form.salarioBase}
              onChange={(v) => cambiar('salarioBase', v)}
            />
          )}
        </Field>
        <Field label="Cuenta IBAN" requerido>
          {(p) => (
            <Input
              {...p}
              value={form.cuentaIban}
              placeholder="CR05015202001026284066"
              className="font-mono"
              onChange={(e) => cambiar('cuentaIban', e.target.value)}
            />
          )}
        </Field>
        <Field label="Hijos" ayuda="Crédito fiscal por cada uno">
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              value={form.hijos}
              onChange={(e) => cambiar('hijos', Math.max(0, Number(e.target.value) || 0))}
            />
          )}
        </Field>
        <div className="flex flex-col justify-end gap-2 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.creditoConyuge}
              className="size-4 accent-brand-600"
              onChange={(e) => cambiar('creditoConyuge', e.target.checked)}
            />
            Toma el crédito por cónyuge
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.activo}
              className="size-4 accent-brand-600"
              onChange={(e) => cambiar('activo', e.target.checked)}
            />
            Activo
          </label>
        </div>
      </div>

      {(intento && errores.length > 0) || errorServidor ? (
        <div role="alert" className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor?.message ?? 'El empleado no se puede guardar'}
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {(errorServidor?.detalles.length ? errorServidor.detalles : errores).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialogo>
  )
}
