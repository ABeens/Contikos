import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'
import { useId } from 'react'
import { cn } from './cn'
import { inputClass } from './estilos'

export interface FieldProps {
  label: string
  error?: string
  ayuda?: string
  requerido?: boolean
  className?: string
  children: (props: {
    id: string
    'aria-invalid': boolean
    'aria-describedby'?: string
  }) => ReactNode
}

export function Field({
  label,
  error,
  ayuda,
  requerido,
  className,
  children,
}: FieldProps) {
  const id = useId()
  // El error (o la ayuda) se asocia al control: un lector de pantalla lo lee
  // al llegar al campo, no solo quien lo ve debajo.
  const idNota = `${id}-nota`
  const hayNota = Boolean(error || ayuda)
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
        {requerido && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': hayNota ? idNota : undefined,
      })}
      {error ? (
        <p id={idNota} className="text-xs text-red-600">
          {error}
        </p>
      ) : ayuda ? (
        <p id={idNota} className="text-xs text-slate-400">
          {ayuda}
        </p>
      ) : null}
    </div>
  )
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputClass, 'pr-8', className)} {...props}>
      {children}
    </select>
  )
}
