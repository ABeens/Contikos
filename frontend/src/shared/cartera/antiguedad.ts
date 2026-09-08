import { differenceInCalendarDays, parseISO } from 'date-fns'
import { Money, type Moneda } from '@/shared/money/money'

/**
 * Antigüedad de saldos (docs/04 §3 y docs/05 §5).
 *
 * Vive en `shared` porque la regla es la misma por cobrar y por pagar: cambia
 * quién debe, no cómo se reparte el saldo en cubetas. Duplicarla en los dos
 * módulos garantizaría que un día dejaran de coincidir, y el reporte que
 * concilia contra el mayor es justamente el que no puede discrepar.
 *
 * Se calcula a una fecha de corte y no solo a hoy: la antigüedad de un cierre
 * pasado tiene que seguir siendo reproducible.
 */

export const CUBETAS = [
  'porVencer',
  'd1a30',
  'd31a60',
  'd61a90',
  'mas90',
] as const

export type Cubeta = (typeof CUBETAS)[number]

export const ETIQUETAS_CUBETA: Record<Cubeta, string> = {
  porVencer: 'Por vencer',
  d1a30: '1 a 30',
  d31a60: '31 a 60',
  d61a90: '61 a 90',
  mas90: 'Más de 90',
}

export interface DocumentoCartera {
  readonly entidadId: string
  readonly entidadNombre: string
  readonly fechaVencimiento: string
  /** Saldo pendiente. Los documentos saldados no entran en la antigüedad. */
  readonly saldo: string
}

export interface SaldosCubetas {
  readonly porVencer: string
  readonly d1a30: string
  readonly d31a60: string
  readonly d61a90: string
  readonly mas90: string
  readonly total: string
}

export interface FilaCartera extends SaldosCubetas {
  readonly entidadId: string
  readonly entidadNombre: string
}

/** Días vencidos a la fecha de corte. Cero o negativo = todavía por vencer. */
export function diasVencidos(fechaVencimiento: string, corte: string): number {
  return differenceInCalendarDays(parseISO(corte), parseISO(fechaVencimiento))
}

export function cubetaDe(dias: number): Cubeta {
  if (dias <= 0) return 'porVencer'
  if (dias <= 30) return 'd1a30'
  if (dias <= 60) return 'd31a60'
  if (dias <= 90) return 'd61a90'
  return 'mas90'
}

function acumular(moneda: Moneda) {
  return {
    porVencer: Money.cero(moneda),
    d1a30: Money.cero(moneda),
    d31a60: Money.cero(moneda),
    d61a90: Money.cero(moneda),
    mas90: Money.cero(moneda),
  }
}

function serializar(
  acumulado: Record<Cubeta, Money>,
  moneda: Moneda,
): SaldosCubetas {
  const total = CUBETAS.reduce(
    (acc, cubeta) => acc.plus(acumulado[cubeta]),
    Money.cero(moneda),
  )
  return {
    porVencer: acumulado.porVencer.toApi(),
    d1a30: acumulado.d1a30.toApi(),
    d31a60: acumulado.d31a60.toApi(),
    d61a90: acumulado.d61a90.toApi(),
    mas90: acumulado.mas90.toApi(),
    total: total.toApi(),
  }
}

export interface ResultadoAntiguedad {
  readonly filas: readonly FilaCartera[]
  readonly totales: SaldosCubetas
}

/**
 * Reparte el saldo de cada documento en su cubeta y agrupa por entidad.
 *
 * Un documento emitido después del corte no existe todavía a esa fecha: se
 * excluye para que el total siga cuadrando contra el saldo de la cuenta de
 * control en el mayor.
 */
export function antiguedadPorEntidad(
  documentos: readonly (DocumentoCartera & { fechaEmision?: string })[],
  corte: string,
  moneda: Moneda,
): ResultadoAntiguedad {
  const porEntidad = new Map<
    string,
    { nombre: string; cubetas: Record<Cubeta, Money> }
  >()
  const totales = acumular(moneda)

  for (const documento of documentos) {
    const saldo = new Money(documento.saldo, moneda)
    if (!saldo.esPositivo()) continue
    if (documento.fechaEmision && documento.fechaEmision > corte) continue

    let entrada = porEntidad.get(documento.entidadId)
    if (!entrada) {
      entrada = { nombre: documento.entidadNombre, cubetas: acumular(moneda) }
      porEntidad.set(documento.entidadId, entrada)
    }

    const cubeta = cubetaDe(diasVencidos(documento.fechaVencimiento, corte))
    entrada.cubetas[cubeta] = entrada.cubetas[cubeta].plus(saldo)
    totales[cubeta] = totales[cubeta].plus(saldo)
  }

  const filas: FilaCartera[] = [...porEntidad.entries()]
    .map(([entidadId, entrada]) => ({
      entidadId,
      entidadNombre: entrada.nombre,
      ...serializar(entrada.cubetas, moneda),
    }))
    .sort((a, b) => a.entidadNombre.localeCompare(b.entidadNombre, 'es'))

  return { filas, totales: serializar(totales, moneda) }
}
