import { useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { ETIQUETA_ROL } from '@/shared/auth/permisos'
import type { Usuario } from '@/shared/api/contracts/auth'
import { useEmpresa } from '@/app/empresa'
import { DialogoUsuario } from '../components/DialogoUsuario'
import { useUsuarios } from '../api/queries'

/**
 * Usuarios del grupo y su rol en cada empresa (docs/17 §6).
 *
 * Solo la ve quien tiene el permiso `usuarios` en la empresa abierta. La tabla
 * enseña una columna por empresa: la pregunta que se hace aquí casi siempre es
 * "¿quién puede qué en tal empresa?", y se contesta leyendo una columna.
 */
export function UsuariosPage() {
  const { empresas } = useEmpresa()
  const consulta = useUsuarios()
  const [editando, setEditando] = useState<Usuario | null>(null)
  const [creando, setCreando] = useState(false)

  return (
    <div>
      <PageHeader
        titulo="Usuarios"
        descripcion="Quién entra y con qué rol en cada empresa. Sin rol en una empresa, esa empresa no se le abre."
        acciones={
          <Button variante="primario" icono={<Plus className="size-4" />} onClick={() => setCreando(true)}>
            Nuevo usuario
          </Button>
        }
      />

      <Card>
        {consulta.error ? (
          <EstadoError error={consulta.error} onReintentar={() => void consulta.refetch()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Usuario</th>
                  {empresas.map((e) => (
                    <th key={e.id} className="px-4 py-2 text-left font-medium">
                      {e.codigo}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-left font-medium">Estado</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {(consulta.data ?? []).map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">
                      <p className="font-medium text-slate-900">{u.nombre}</p>
                      <p className="text-xs text-slate-500">{u.correo}</p>
                    </td>
                    {empresas.map((e) => {
                      const rol = u.roles.find((r) => r.empresaId === e.id)?.rol
                      return (
                        <td key={e.id} className="px-4 py-2 text-slate-700">
                          {rol ? ETIQUETA_ROL[rol] : <span className="text-slate-400">Sin acceso</span>}
                        </td>
                      )
                    })}
                    <td className="px-4 py-2">
                      <EstadoBadge estado={u.activo ? 'activo' : 'inactivo'} />
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        tamano="sm"
                        variante="fantasma"
                        aria-label={`Editar ${u.nombre}`}
                        icono={<Pencil className="size-3.5" />}
                        onClick={() => setEditando(u)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creando && (
        <DialogoUsuario abierto onCerrar={() => setCreando(false)} empresas={empresas} />
      )}
      {editando && (
        <DialogoUsuario
          key={editando.id}
          abierto
          usuario={editando}
          onCerrar={() => setEditando(null)}
          empresas={empresas}
        />
      )}
    </div>
  )
}
