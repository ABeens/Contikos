import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input, Select } from '@/shared/ui/Field'
import { ApiError } from '@/shared/api/client'
import type { Rol, SolicitudUsuario, Usuario } from '@/shared/api/contracts/auth'
import { RolSchema } from '@/shared/api/contracts/auth'
import type { Empresa } from '@/shared/api/contracts/empresas'
import { DESCRIPCION_ROL, ETIQUETA_ROL } from '@/shared/auth/permisos'
import { useGuardarUsuario } from '../api/queries'

const ROLES: readonly Rol[] = RolSchema.options

/**
 * Alta y edición de un usuario: sus datos y un rol por empresa.
 *
 * Una fila por empresa del grupo, con "Sin acceso" como primera opción: es la
 * forma de que se vea de un vistazo a qué empresas entra y a cuáles no, en vez
 * de una lista de roles que hay que ir sumando.
 */
export function DialogoUsuario({
  abierto,
  onCerrar,
  usuario,
  empresas,
}: {
  abierto: boolean
  onCerrar: () => void
  usuario?: Usuario
  empresas: readonly Empresa[]
}) {
  const guardar = useGuardarUsuario()
  const [nombre, setNombre] = useState(usuario?.nombre ?? '')
  const [correo, setCorreo] = useState(usuario?.correo ?? '')
  const [activo, setActivo] = useState(usuario?.activo ?? true)
  const [clave, setClave] = useState('')
  const [roles, setRoles] = useState<Record<string, Rol | ''>>(() =>
    Object.fromEntries(
      empresas.map((e) => [
        e.id,
        usuario?.roles.find((r) => r.empresaId === e.id)?.rol ?? '',
      ]),
    ),
  )

  const creando = usuario === undefined
  const errores = [
    ...(nombre.trim() === '' ? ['El nombre es obligatorio'] : []),
    ...(!/^\S+@\S+\.\S+$/.test(correo.trim()) ? ['El correo no es válido'] : []),
    ...(creando && clave.length < 8
      ? ['La contraseña inicial tiene que tener al menos 8 caracteres']
      : []),
    ...(!creando && clave !== '' && clave.length < 8
      ? ['La contraseña nueva tiene que tener al menos 8 caracteres']
      : []),
  ]
  const [intento, setIntento] = useState(false)

  const enviar = () => {
    setIntento(true)
    if (errores.length > 0 || guardar.isPending) return
    const datos: SolicitudUsuario = {
      nombre: nombre.trim(),
      correo: correo.trim().toLowerCase(),
      activo,
      roles: Object.entries(roles)
        .filter(([, rol]) => rol !== '')
        .map(([empresaId, rol]) => ({ empresaId, rol: rol as Rol })),
      ...(clave ? { clave } : {}),
    }
    guardar.mutate({ datos, id: usuario?.id }, { onSuccess: onCerrar })
  }

  const errorServidor = guardar.error instanceof ApiError ? guardar.error : null

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={guardar.isPending}
      alEnviar={enviar}
      titulo={creando ? 'Nuevo usuario' : usuario.nombre}
      descripcion="El usuario es del grupo; el rol, de cada empresa."
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
        <Field label="Nombre" requerido className="col-span-2">
          {(p) => <Input {...p} value={nombre} autoFocus onChange={(e) => setNombre(e.target.value)} />}
        </Field>
        <Field label="Correo" requerido>
          {(p) => (
            <Input {...p} type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
          )}
        </Field>
        <Field
          label={creando ? 'Contraseña inicial' : 'Contraseña nueva'}
          requerido={creando}
          ayuda={creando ? 'Al menos 8 caracteres' : 'Vacía deja la que tiene'}
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
            />
          )}
        </Field>

        <fieldset className="col-span-2">
          <legend className="text-xs font-medium text-slate-600">Rol en cada empresa</legend>
          <div className="mt-2 space-y-2">
            {empresas.map((e) => (
              <label key={e.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-700">
                  {e.nombre}
                  <span className="ml-1 text-xs text-slate-400">{e.codigo}</span>
                </span>
                <Select
                  aria-label={`Rol en ${e.nombre}`}
                  className="w-56"
                  value={roles[e.id] ?? ''}
                  onChange={(ev) =>
                    setRoles((prev) => ({ ...prev, [e.id]: ev.target.value as Rol | '' }))
                  }
                >
                  <option value="">Sin acceso</option>
                  {ROLES.map((rol) => (
                    <option key={rol} value={rol} title={DESCRIPCION_ROL[rol]}>
                      {ETIQUETA_ROL[rol]}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="col-span-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={activo}
            className="size-4 accent-brand-600"
            onChange={(e) => setActivo(e.target.checked)}
          />
          Activo
          <span className="text-xs text-slate-500">
            Un usuario inactivo no puede entrar, y sus sesiones abiertas dejan de valer.
          </span>
        </label>
      </div>

      {(intento && errores.length > 0) || errorServidor ? (
        <div role="alert" className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor ? errorServidor.message : 'El usuario no se puede guardar'}
          </p>
          {!errorServidor && (
            <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
              {errores.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Dialogo>
  )
}
