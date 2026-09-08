import { useState, type InputHTMLAttributes } from 'react'
import Decimal from 'decimal.js'
import { cn } from '@/shared/ui/cn'
import { inputClass } from '@/shared/ui/estilos'
import { configuracionMoneda, type Moneda } from './money'
import { formatMoney, parseMonto } from './format'

export interface MoneyInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type'
  > {
  /** Importe canónico como string. Nunca number. Cadena vacía = sin valor. */
  value: string
  onChange: (valor: string) => void
  moneda: Moneda
  mostrarSimbolo?: boolean
}

/**
 * Campo de importe.
 *
 * - Mientras se edita, muestra el texto tal cual lo escribe el usuario
 * - Al salir del campo, lo normaliza y lo muestra formateado
 * - Acepta coma o punto como separador decimal (docs/14 §8)
 * - Emite siempre un string canónico ("1234.56"), nunca un number
 */
export function MoneyInput({
  value,
  onChange,
  moneda,
  mostrarSimbolo = false,
  className,
  onFocus,
  onBlur,
  ...props
}: MoneyInputProps) {
  const [enfocado, setEnfocado] = useState(false)
  const [texto, setTexto] = useState('')

  const config = configuracionMoneda(moneda)

  const mostrado = enfocado
    ? texto
    : value === ''
      ? ''
      : formatMoney(
          { monto: new Decimal(value), moneda },
          { simbolo: mostrarSimbolo },
        )

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={mostrado}
      className={cn(inputClass, 'tabular text-right', className)}
      onFocus={(e) => {
        setEnfocado(true)
        // Al entrar se muestra el número editable sin separador de miles,
        // con el separador decimal local: 1234,56
        setTexto(
          value === ''
            ? ''
            : new Decimal(value)
                .toFixed(config.decimales)
                .replace('.', config.decimal),
        )
        e.target.select()
        onFocus?.(e)
      }}
      onChange={(e) => {
        const nuevo = e.target.value
        setTexto(nuevo)
        if (nuevo.trim() === '') {
          onChange('')
          return
        }
        const parsed = parseMonto(nuevo)
        if (parsed !== null) onChange(parsed.toString())
      }}
      onBlur={(e) => {
        setEnfocado(false)
        const parsed = parseMonto(texto)
        onChange(parsed === null ? '' : parsed.toString())
        onBlur?.(e)
      }}
    />
  )
}
