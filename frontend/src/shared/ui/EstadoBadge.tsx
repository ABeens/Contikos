import { cn } from './cn'

/**
 * Colores de estado, consistentes en TODO el sistema.
 *
 * Un mismo estado debe verse igual en cxc, cxp, bancos y conta. Si cada módulo
 * elige su color, el usuario deja de poder leer el estado de un vistazo — que es
 * justamente para lo que existe el badge.
 */
const TONOS = {
  neutro: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  exito: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  alerta: 'bg-amber-50 text-amber-700 ring-amber-200',
  peligro: 'bg-red-50 text-red-700 ring-red-200',
  cerrado: 'bg-slate-800 text-slate-100 ring-slate-700',
} as const

type Tono = keyof typeof TONOS

const ESTADOS: Record<string, { etiqueta: string; tono: Tono }> = {
  // Ciclo de vida de documentos (docs/02 §7)
  borrador: { etiqueta: 'Borrador', tono: 'neutro' },
  validado: { etiqueta: 'Validado', tono: 'info' },
  contabilizado: { etiqueta: 'Contabilizado', tono: 'exito' },
  cancelado: { etiqueta: 'Cancelado', tono: 'peligro' },
  reversado: { etiqueta: 'Reversado', tono: 'peligro' },

  // Los documentos de CxC y CxP concuerdan en femenino con "factura". El
  // estado es el mismo del ciclo de vida de docs/02 §7, así que comparte color.
  validada: { etiqueta: 'Validada', tono: 'info' },
  contabilizada: { etiqueta: 'Contabilizado', tono: 'exito' },
  pagada: { etiqueta: 'Pagado', tono: 'exito' },
  cancelada: { etiqueta: 'Cancelado', tono: 'peligro' },

  // Cobranza y pagos
  pendiente: { etiqueta: 'Pendiente', tono: 'alerta' },
  parcial: { etiqueta: 'Pago parcial', tono: 'alerta' },
  pagado: { etiqueta: 'Pagado', tono: 'exito' },
  vencido: { etiqueta: 'Vencido', tono: 'peligro' },

  // Periodos contables (docs/03 §5)
  abierto: { etiqueta: 'Abierto', tono: 'exito' },
  cerrado: { etiqueta: 'Cerrado', tono: 'neutro' },
  bloqueado: { etiqueta: 'Bloqueado', tono: 'cerrado' },

  // Comprobantes electrónicos — Hacienda (docs/13 §4.3)
  generado: { etiqueta: 'Generado', tono: 'neutro' },
  firmado: { etiqueta: 'Firmado', tono: 'info' },
  enviado: { etiqueta: 'Enviado a Hacienda', tono: 'info' },
  aceptado: { etiqueta: 'Aceptado', tono: 'exito' },
  rechazado: { etiqueta: 'Rechazado', tono: 'peligro' },
  contingencia: { etiqueta: 'Contingencia', tono: 'alerta' },

  // Bancos
  conciliado: { etiqueta: 'Conciliado', tono: 'exito' },
  registrado: { etiqueta: 'Sin conciliar', tono: 'alerta' },

  // Activos
  activo: { etiqueta: 'Activo', tono: 'exito' },
  inactivo: { etiqueta: 'Inactivo', tono: 'neutro' },
  totalmente_depreciado: { etiqueta: 'Depreciado', tono: 'neutro' },
  dado_de_baja: { etiqueta: 'Dado de baja', tono: 'peligro' },

  // Diferidos (docs/15). `agotado` es a lo que llega solo cuando la última
  // cuota deja el saldo en cero: no es un fallo, es el final previsto.
  vigente: { etiqueta: 'Vigente', tono: 'exito' },
  agotado: { etiqueta: 'Agotado', tono: 'neutro' },
}

export interface EstadoBadgeProps {
  estado: string
  className?: string
}

export function EstadoBadge({ estado, className }: EstadoBadgeProps) {
  const config = ESTADOS[estado] ?? { etiqueta: estado, tono: 'neutro' as Tono }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap',
        TONOS[config.tono],
        className,
      )}
    >
      {config.etiqueta}
    </span>
  )
}
