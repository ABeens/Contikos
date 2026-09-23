import { useId } from 'react'
import { cn } from './cn'
import { inputClass } from './estilos'
import type { Cuenta } from '@/shared/api/contracts/conta'

export interface SelectorCuentaProps {
  value: string
  onChange: (codigo: string) => void
  cuentas: readonly Cuenta[]
  /** Excluye cuentas de control: los asientos manuales no pueden moverlas. */
  excluirControl?: boolean
  error?: boolean
  /** Nombre accesible. Necesario cuando hay varios selectores en un formulario. */
  etiqueta?: string
  /** Solo lectura: la cuenta ya no se puede cambiar sin romper el mayor. */
  disabled?: boolean
  className?: string
  autoFocus?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  /** Dentro de un `Field`: su `id` asocia la etiqueta visible al control. */
  id?: string
  /** Dentro de un `Field`: asocia el mensaje de error o de ayuda. */
  'aria-describedby'?: string
}

/**
 * Buscador de cuenta contable.
 *
 * Solo ofrece cuentas de detalle y activas: son las únicas que reciben
 * movimientos (docs/03 §2). Usa `datalist` nativo: funciona con teclado sin
 * capturar el Tab ni el Enter, que en esta pantalla tienen significado propio
 * (docs/14 §8).
 */
export function SelectorCuenta({
  value,
  onChange,
  cuentas,
  excluirControl = false,
  error,
  etiqueta = 'Cuenta',
  disabled,
  className,
  autoFocus,
  onKeyDown,
  id,
  'aria-describedby': describedBy,
}: SelectorCuentaProps) {
  const listaId = useId()

  const disponibles = cuentas.filter(
    (c) => c.esDetalle && c.activa && (!excluirControl || !c.esCuentaControl),
  )

  return (
    <>
      <input
        id={id}
        list={listaId}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.trim())}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder="Código de cuenta"
        // Con `id` la etiqueta visible del Field ya da el nombre accesible.
        aria-label={id ? undefined : etiqueta}
        aria-describedby={describedBy}
        aria-invalid={error}
        className={cn(
          inputClass,
          'font-mono text-xs',
          disabled && 'cursor-not-allowed bg-slate-50 text-slate-500',
          className,
        )}
      />
      <datalist id={listaId}>
        {disponibles.map((c) => (
          <option key={c.codigo} value={c.codigo} label={c.nombre} />
        ))}
      </datalist>
    </>
  )
}
