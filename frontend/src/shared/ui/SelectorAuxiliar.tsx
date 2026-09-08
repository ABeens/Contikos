import { useId } from 'react'
import { cn } from './cn'
import { inputClass } from './estilos'
import type { AuxiliarTipo } from '@/shared/api/contracts/comunes'
import {
  auxiliaresVigentes,
  etiquetaAuxiliar,
  textoAuxiliar,
  tieneCatalogo,
  type Auxiliar,
} from '@/shared/auxiliares/auxiliar'

export interface SelectorAuxiliarProps {
  /** Lo exige la cuenta de la línea, o lo eligió el usuario si no lo exigía. */
  tipo: AuxiliarTipo
  /** Texto tecleado, no el id. Quien lo recibe resuelve con `resolverAuxiliar`. */
  value: string
  onChange: (texto: string) => void
  /**
   * Al salir del campo. Es el momento de completar lo tecleado con la ficha
   * que identifica, si es una sola: quien lo recibe usa `buscarAuxiliar`.
   */
  onBlur?: () => void
  /** Catálogo del tipo. Vacío mientras carga, o si el tipo no tiene catálogo. */
  auxiliares: readonly Auxiliar[]
  error?: boolean
  disabled?: boolean
  className?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

/**
 * Buscador del auxiliar de una línea de asiento.
 *
 * Busca por código, por nombre o por cédula en el catálogo del tipo (docs/02
 * §3: cuando la cuenta exige auxiliar, `auxiliarTipo` lo fija la cuenta, no el
 * usuario). Antes había que saberse el id interno para capturar contra
 * clientes o proveedores, que es justo lo que nadie sabe.
 *
 * Usa `datalist` nativo, igual que `SelectorCuenta` y por lo mismo: no captura
 * ni el Tab ni el Enter, que en la captura de asientos tienen significado
 * propio (docs/14 §8). La cédula va como etiqueta de la opción y no en el
 * valor: el navegador filtra por las dos, pero solo el valor queda escrito en
 * el campo al elegir.
 *
 * Los tipos sin catálogo (`empleado`, `banco`, mientras rh y bancos no existan)
 * caen a un campo de texto: es lo que había, y sigue siendo mejor que no poder
 * capturar la línea.
 */
export function SelectorAuxiliar({
  tipo,
  value,
  onChange,
  onBlur,
  auxiliares,
  error,
  disabled,
  className,
  onKeyDown,
}: SelectorAuxiliarProps) {
  const listaId = useId()
  const buscable = tieneCatalogo(tipo)
  const disponibles = buscable ? auxiliaresVigentes(auxiliares) : []

  return (
    <>
      <input
        list={buscable ? listaId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={buscable ? `Código, ${tipo} o cédula` : tipo}
        aria-label="Auxiliar"
        aria-invalid={error}
        className={cn(inputClass, 'text-xs', className)}
      />
      {buscable && (
        <datalist id={listaId}>
          {disponibles.map((a) => (
            <option
              key={a.id}
              value={textoAuxiliar(a)}
              label={etiquetaAuxiliar(a)}
            />
          ))}
        </datalist>
      )}
    </>
  )
}
