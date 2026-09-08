import Decimal from 'decimal.js'
import { cn } from '@/shared/ui/cn'
import { monedaFuncional, Money, type Moneda } from './money'
import { formatMoney } from './format'

export interface MoneyCellProps {
  /** Importe canónico como string, o un Money ya construido. */
  valor: string | Money | null | undefined
  /** Por defecto la funcional: es la del mayor y la de los consolidados. */
  moneda?: Moneda
  /** No muestra nada si el importe es cero. Para columnas de cargo/abono. */
  ocultarCero?: boolean
  /** Negativos entre paréntesis, convención de estados financieros. */
  parentesisNegativos?: boolean
  mostrarSimbolo?: boolean
  className?: string
}

export function MoneyCell({
  valor,
  moneda = monedaFuncional(),
  ocultarCero = false,
  parentesisNegativos = false,
  mostrarSimbolo = false,
  className,
}: MoneyCellProps) {
  if (valor === null || valor === undefined || valor === '') {
    return <span className="text-slate-300">—</span>
  }

  const money =
    valor instanceof Money ? valor : new Money(new Decimal(valor), moneda)
  const texto = formatMoney(money, {
    simbolo: mostrarSimbolo,
    ocultarCero,
    parentesisNegativos,
  })

  if (texto === '') return null

  return (
    <span
      className={cn(
        'tabular',
        money.esNegativo() && 'text-negativo',
        className,
      )}
    >
      {texto}
    </span>
  )
}
