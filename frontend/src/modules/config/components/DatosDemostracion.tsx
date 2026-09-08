import { useState } from 'react'
import { Database, RotateCcw } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Layout'
import { restablecerAlmacen } from '@/shared/almacen/almacen'

/**
 * Restablecer los datos de demostración.
 *
 * Existe porque los datos persisten: mientras no haya backend, lo que se
 * captura se guarda en el navegador y sigue ahí en la siguiente sesión. Eso es
 * lo que se quiere para probar el sistema de verdad, pero deja de serlo cuando
 * los datos de la demo quedan en un estado del que no se sale (un catálogo
 * medio editado, una prueba a medias) o cuando hay que enseñar el sistema desde
 * cero.
 *
 * Se recarga la página después de borrar, y no se invalida la caché: la
 * semilla se siembra al importar los módulos de datos, así que hay que volver
 * a arrancar la aplicación para que se aplique. Es un borrado completo, no una
 * operación de negocio, y desaparece con el backend.
 */
export function DatosDemostracion() {
  const [confirmando, setConfirmando] = useState(false)

  function restablecer() {
    restablecerAlmacen()
    window.location.reload()
  }

  return (
    <Card className="mt-6 border-amber-200 bg-amber-50/50">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-amber-100 text-amber-700">
          <Database className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">
            Datos de demostración
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Mientras no exista la API, todo lo capturado se guarda en este
            navegador y sobrevive a recargar la página. Restablecer devuelve
            catálogos, asientos y documentos a su estado de fábrica.
          </p>

          {confirmando && (
            <p className="mt-2 text-xs font-medium text-amber-800">
              Se borrará todo lo capturado en este navegador. No se puede
              deshacer.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {confirmando ? (
            <>
              <Button
                tamano="sm"
                variante="fantasma"
                onClick={() => setConfirmando(false)}
              >
                Cancelar
              </Button>
              <Button tamano="sm" variante="peligro" onClick={restablecer}>
                Sí, restablecer
              </Button>
            </>
          ) : (
            <Button
              tamano="sm"
              icono={<RotateCcw className="size-3.5" />}
              onClick={() => setConfirmando(true)}
            >
              Restablecer
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
