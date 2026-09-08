import { useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import type { SolicitudAdjunto } from '@/shared/api/contracts/comunes'
import {
  TIPOS_ADJUNTO_PERMITIDOS,
  validarAdjunto,
} from '../domain/adjunto'

/**
 * Elección de archivos para adjuntar a una factura de gasto (docs/05 §1).
 *
 * Valida con el dominio ANTES de leer el contenido: rechazar un PDF de veinte
 * megabytes después de haberlo cargado en memoria y codificado en base64 no
 * le ahorra el viaje a nadie. Lo que entrega ya es la solicitud que el
 * endpoint espera, con el contenido en base64.
 *
 * El mismo componente sirve en la captura (los archivos esperan a que la
 * factura exista) y en el detalle (se suben en el acto): quien lo usa decide
 * qué hacer con lo que devuelve.
 */

/** Base64 del archivo, por trozos para no reventar la pila con un PDF grande. */
async function leerBase64(archivo: File): Promise<string> {
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  const TROZO = 8192
  let binario = ''
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TROZO))
  }
  return btoa(binario)
}

export interface SelectorAdjuntosProps {
  onElegir: (adjuntos: SolicitudAdjunto[]) => void
  etiqueta?: string
  deshabilitado?: boolean
}

export function SelectorAdjuntos({
  onElegir,
  etiqueta = 'Adjuntar archivos',
  deshabilitado,
}: SelectorAdjuntosProps) {
  const entrada = useRef<HTMLInputElement>(null)
  const [errores, setErrores] = useState<string[]>([])

  const elegir = async (archivos: FileList | null) => {
    if (!archivos || archivos.length === 0) return

    const validos: SolicitudAdjunto[] = []
    const rechazos: string[] = []

    for (const archivo of Array.from(archivos)) {
      const resultado = validarAdjunto({
        nombre: archivo.name,
        tipoMime: archivo.type,
        tamano: archivo.size,
        descripcion: null,
      })
      if (!resultado.valido) {
        rechazos.push(...resultado.errores.map((e) => e.mensaje))
        continue
      }
      validos.push({
        nombre: archivo.name,
        tipoMime: archivo.type,
        tamano: archivo.size,
        descripcion: null,
        contenidoBase64: await leerBase64(archivo),
      })
    }

    setErrores(rechazos)
    if (validos.length > 0) onElegir(validos)
    // Sin esto, volver a elegir el mismo archivo no dispara el evento.
    if (entrada.current) entrada.current.value = ''
  }

  return (
    <div>
      <input
        ref={entrada}
        type="file"
        multiple
        className="hidden"
        aria-label={etiqueta}
        accept={TIPOS_ADJUNTO_PERMITIDOS.join(',')}
        onChange={(e) => void elegir(e.target.files)}
      />
      <Button
        tamano="sm"
        icono={<Paperclip className="size-3.5" />}
        disabled={deshabilitado}
        onClick={() => entrada.current?.click()}
      >
        {etiqueta}
      </Button>

      {errores.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-red-700">
          {errores.map((mensaje, i) => (
            <li key={i}>{mensaje}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
