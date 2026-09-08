import { useId } from 'react'
import { cn } from '@/shared/ui/cn'
import { inputClass } from '@/shared/ui/estilos'
import type { ItemCatalogo } from '@/shared/api/contracts/cxc'

export interface SelectorItemProps {
  /** Código tecleado. No tiene por qué existir en el catálogo. */
  value: string
  onChange: (codigo: string) => void
  items: readonly ItemCatalogo[]
  /** Nombre accesible. Hay uno por línea de la factura. */
  etiqueta: string
  className?: string
}

/**
 * Buscador del catálogo de venta.
 *
 * Mismo mecanismo que el selector de cuenta: `datalist` nativo, que sugiere sin
 * capturar el Tab ni el Enter, que en la captura de factura tienen significado
 * propio (docs/14 §8). Y por la misma razón deja escribir lo que no está en la
 * lista: la línea puede no salir del catálogo, y obligar a elegir uno forzaría
 * a inventar un item por cada venta excepcional.
 *
 * Solo ofrece items activos. Los inactivos siguen apareciendo en las facturas
 * viejas que los citan, pero no se venden más.
 */
export function SelectorItem({
  value,
  onChange,
  items,
  etiqueta,
  className,
}: SelectorItemProps) {
  const listaId = useId()

  return (
    <>
      <input
        list={listaId}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="Código"
        aria-label={etiqueta}
        className={cn(inputClass, 'font-mono text-xs', className)}
      />
      <datalist id={listaId}>
        {items
          .filter((i) => i.activo)
          .map((i) => (
            <option key={i.id} value={i.codigo} label={i.nombre} />
          ))}
      </datalist>
    </>
  )
}
