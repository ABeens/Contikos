import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, LogIn } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Field, Input } from '@/shared/ui/Field'
import { ApiError } from '@/shared/api/client'
import { servicioAuth } from '@/shared/api/servicios'
import { USAR_MOCKS } from '@/shared/api/entorno'
import {
  empresaActiva,
  establecerEmpresaActiva,
} from '@/shared/almacen/almacen'
import {
  establecerSesion,
  motivoDeCierre,
  useSesionActual,
} from '@/shared/auth/sesion'
import { empresasDe } from '@/shared/auth/permisos'
import type { Sesion } from '@/shared/api/contracts/auth'

/**
 * La sesión delante de todo (docs/17 §6).
 *
 * Sin sesión no se monta nada de la aplicación: ni el proveedor de empresa ni
 * el de monedas, que lo primero que hacen es pedir datos. Se enseña la pantalla
 * de inicio y nada más. Con sesión, la aplicación entera, y al cerrarla se
 * vacía la caché: los saldos que vio un usuario no pueden quedar a la vista
 * del siguiente que entre en el mismo navegador.
 */
export function ProveedorSesion({ children }: { children: ReactNode }) {
  const sesion = useSesionActual()
  const cliente = useQueryClient()
  const token = sesion?.token ?? null

  useEffect(() => {
    if (token === null) cliente.clear()
  }, [token, cliente])

  if (!sesion) return <PantallaInicioSesion />
  // La clave por usuario desmonta todo al cambiar de persona: ningún estado
  // de pantalla del anterior sobrevive.
  return <div key={sesion.usuario.id} className="contents">{children}</div>
}

/**
 * Abre la sesión y deja abierta una empresa a la que el usuario tiene acceso.
 *
 * La empresa se decide antes de montar la aplicación: si la última que se usó
 * en este navegador no es de este usuario, lo primero que pidiera la
 * aplicación sería un 403.
 */
function abrir(sesion: Sesion): void {
  const permitidas = empresasDe(sesion.usuario)
  if (!permitidas.includes(empresaActiva())) {
    establecerEmpresaActiva(permitidas[0])
  }
  establecerSesion(sesion)
}

export function PantallaInicioSesion() {
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Por qué se está aquí, si no fue por elección: la sesión venció.
  const [motivo] = useState(motivoDeCierre)

  const entrar = async (e: FormEvent) => {
    e.preventDefault()
    if (enviando) return
    setEnviando(true)
    setError(null)
    try {
      abrir(await servicioAuth.iniciarSesion({ correo, clave }))
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'No se pudo contactar con el servidor',
      )
      setEnviando(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-lg font-bold text-white shadow-flotante">
            C
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Entrar a Contikos</h1>
        </div>

        <form
          onSubmit={entrar}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-suave"
        >
          {motivo && !error && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
              {motivo}
            </p>
          )}
          <Field label="Correo">
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="username"
                autoFocus
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
              />
            )}
          </Field>
          <Field label="Contraseña">
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="flex items-center gap-1.5 text-sm text-red-700">
              <CircleAlert className="size-4 shrink-0" />
              {error}
            </p>
          )}
          <Button
            type="submit"
            variante="primario"
            className="w-full justify-center"
            icono={<LogIn className="size-4" />}
            disabled={enviando}
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>

        {USAR_MOCKS && <UsuariosDemostracion onElegir={setCorreo} />}
      </div>
    </main>
  )
}

/**
 * Los usuarios de la demostración, uno por rol.
 *
 * Solo contra el mock: con la API real no existen, y enseñar correos y una
 * contraseña en la pantalla de inicio de un sistema de verdad sería un regalo.
 */
function UsuariosDemostracion({ onElegir }: { onElegir: (correo: string) => void }) {
  const usuarios = [
    ['admin@contikos.cr', 'Administrador'],
    ['contadora@contikos.cr', 'Contadora (consulta en la segunda empresa)'],
    ['auxiliar@contikos.cr', 'Auxiliar contable'],
    ['planilla@contikos.cr', 'Planilla'],
    ['consulta@contikos.cr', 'Solo consulta'],
  ]
  return (
    <div className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-xs text-slate-600">
      <p className="mb-1.5 font-medium text-slate-700">
        Usuarios de demostración · contraseña <code>contikos</code>
      </p>
      <ul className="space-y-0.5">
        {usuarios.map(([correo, rol]) => (
          <li key={correo}>
            <button
              type="button"
              className="text-brand-700 hover:underline"
              onClick={() => onElegir(correo)}
            >
              {correo}
            </button>{' '}
            <span className="text-slate-500">· {rol}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
