import { useState, type InputHTMLAttributes } from 'react'
import { Input } from '@/shared/ui/Field'
import { configuracionMoneda, type Moneda } from '@/shared/money/money'
import { formatTasa, parseTasa } from '../domain/tasa'

export interface TasaInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type'
  > {
  /** Tasa canónica ("512.125"). Cadena vacía = sin valor o no válida. */
  value: string
  onChange: (valor: string) => void
  /** La funcional: de ella salen los separadores con que se enseña. */
  moneda: Moneda
}

/**
 * Campo de tipo de cambio.
 *
 * Como `MoneyInput`, enseña el texto tal cual mientras se escribe y lo
 * normaliza al salir; a diferencia de él, no redondea a los decimales de la
 * moneda (ver `domain/tasa`). Un texto que no es una tasa válida emite cadena
 * vacía, así que el formulario lo trata como campo sin rellenar.
 */
export function TasaInput({
  value,
  onChange,
  moneda,
  className,
  onFocus,
  onBlur,
  ...props
}: TasaInputProps) {
  const [enfocado, setEnfocado] = useState(false)
  const [texto, setTexto] = useState('')

  const config = configuracionMoneda(moneda)
  // Un texto que no es una tasa se queda a la vista al salir, marcado: borrarlo
  // haría creer que el campo nunca se rellenó.
  const invalido = value === '' && texto.trim() !== ''
  const mostrado =
    enfocado || invalido ? texto : value === '' ? '' : formatTasa(value, config)

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={mostrado}
      className={`tabular text-right ${className ?? ''}`}
      onFocus={(e) => {
        setEnfocado(true)
        // Sin separador de miles para editar, con el decimal local.
        // Si lo que había no era válido, se deja tal cual para corregirlo.
        if (!invalido) {
          setTexto(value === '' ? '' : value.replace('.', config.decimal))
        }
        e.target.select()
        onFocus?.(e)
      }}
      onChange={(e) => {
        setTexto(e.target.value)
        onChange(parseTasa(e.target.value) ?? '')
      }}
      aria-invalid={props['aria-invalid'] || invalido}
      onBlur={(e) => {
        setEnfocado(false)
        if (!invalido) setTexto('')
        onBlur?.(e)
      }}
    />
  )
}
