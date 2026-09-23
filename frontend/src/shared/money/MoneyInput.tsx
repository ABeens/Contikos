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
 * - Lo que no se entiende ("12a") no se borra al salir: se deja escrito y se
 *   marca como inválido, y hacia fuera el campo queda sin valor. Borrarlo en
 *   silencio hacía creer que se había capturado algo que no existe.
 */
export function MoneyInput({
  value,
  onChange,
  moneda,
  mostrarSimbolo = false,
  className,
  onFocus,
  onBlur,
  'aria-invalid': ariaInvalid,
  ...props
}: MoneyInputProps) {
  const [enfocado, setEnfocado] = useState(false)
  const [texto, setTexto] = useState('')
  /**
   * Lo tecleado que no es un importe, conservado al salir del campo. Solo
   * vale mientras el valor de fuera siga vacío: si quien usa el campo le pone
   * un importe (o lo limpia otra acción que lo rellena), manda ese.
   */
  const [noValido, setNoValido] = useState<string | null>(null)
  // En cuanto llega un importe de fuera, lo conservado deja de existir: si no,
  // reaparecería la próxima vez que el valor volviera a quedar vacío.
  if (noValido !== null && value !== '') setNoValido(null)
  const conservado = noValido !== null && value === '' ? noValido : null

  const config = configuracionMoneda(moneda)

  const mostrado = enfocado
    ? texto
    : conservado !== null
      ? conservado
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
      aria-invalid={conservado !== null || ariaInvalid}
      title={conservado !== null ? 'No es un importe válido' : props.title}
      className={cn(inputClass, 'tabular text-right', className)}
      onFocus={(e) => {
        setEnfocado(true)
        // Al entrar se muestra el número editable sin separador de miles,
        // con el separador decimal local: 1234,56. Si lo que había no era un
        // importe, se devuelve tal cual para corregirlo.
        setTexto(
          conservado !== null
            ? conservado
            : value === ''
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
        setNoValido(parsed === null && texto.trim() !== '' ? texto : null)
        onChange(parsed === null ? '' : parsed.toString())
        onBlur?.(e)
      }}
    />
  )
}
