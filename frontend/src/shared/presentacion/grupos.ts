import type {
  EstadoFinanciero,
  GrupoPresentacion,
  TipoCuenta,
} from '@/shared/api/contracts/conta'
import { GRUPOS_POR_ESTADO } from '@/shared/api/contracts/conta'

/**
 * Grupos de presentación de los estados financieros.
 *
 * Viven en `shared/` porque los leen dos módulos que no se conocen: `conta`,
 * que los asigna al editar una clasificación, y `reportes`, que arma los
 * subtotales con ellos. La regla de límites de docs/14 §3.1 no deja que uno
 * importe del otro.
 */

export const ETIQUETA_GRUPO: Record<GrupoPresentacion, string> = {
  activo_corriente: 'Activo corriente',
  activo_no_corriente: 'Activo no corriente',
  pasivo_corriente: 'Pasivo corriente',
  pasivo_no_corriente: 'Pasivo no corriente',
  patrimonio: 'Patrimonio',
  ingresos: 'Ingresos de actividades ordinarias',
  costo_ventas: 'Costo de ventas',
  gastos_operacion: 'Gastos de operación',
  otros_resultados: 'Otros ingresos y gastos',
  resultado_financiero: 'Resultado financiero',
  impuesto_renta: 'Impuesto sobre la renta',
}

/**
 * Tipos de cuenta que pueden sumar en cada grupo.
 *
 * Es lo que impide que un renglón de gastos se declare "activo corriente": el
 * estado saldría cuadrado por casualidad y con el gasto sumado al activo.
 * Los grupos de resultados admiten ingreso y gasto a la vez porque hay
 * renglones que se presentan netos (las diferencias de cambio, docs/03 §2 bis).
 */
export const TIPOS_POR_GRUPO: Record<GrupoPresentacion, readonly TipoCuenta[]> =
  {
    activo_corriente: ['activo'],
    activo_no_corriente: ['activo'],
    pasivo_corriente: ['pasivo'],
    pasivo_no_corriente: ['pasivo'],
    patrimonio: ['capital'],
    ingresos: ['ingreso'],
    costo_ventas: ['costo'],
    gastos_operacion: ['gasto', 'costo'],
    otros_resultados: ['ingreso', 'gasto'],
    resultado_financiero: ['ingreso', 'gasto'],
    impuesto_renta: ['gasto'],
  }

/** El estado financiero pide grupo: sin él, el renglón no sabe dónde sumar. */
export function requiereGrupo(estado: EstadoFinanciero): boolean {
  return GRUPOS_POR_ESTADO[estado].length > 0
}

/**
 * Grupo que se propone para un renglón nuevo, a partir de lo ya capturado.
 *
 * Solo una propuesta para no dejar el selector vacío: el primero del estado que
 * admita todos los tipos marcados. Lo corriente se propone antes que lo no
 * corriente porque es lo más frecuente, pero quien decide es el usuario.
 */
export function grupoPropuesto(
  estado: EstadoFinanciero,
  tipos: readonly TipoCuenta[],
): GrupoPresentacion | null {
  const candidatos = GRUPOS_POR_ESTADO[estado]
  if (candidatos.length === 0) return null
  return (
    candidatos.find((g) => tipos.every((t) => TIPOS_POR_GRUPO[g].includes(t))) ??
    candidatos[0]
  )
}
