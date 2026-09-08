import type { Empresa } from '@/shared/api/contracts/empresas'
import {
  EMPRESA_INICIAL,
  tablaGlobal,
  type Semilla,
} from '@/shared/almacen/almacen'

/**
 * Empresas del grupo de demostración.
 *
 * Dos, a propósito: una sola empresa no enseña nada de multiempresa. La
 * principal trae el ejercicio en curso con documentos y saldos; la segunda
 * arranca con los catálogos de plantilla, un par de terceros propios y otro
 * par que comparte con la principal, que es justo el caso que el directorio
 * del grupo resuelve (docs/12 D-12).
 *
 * Es la única colección del grupo: no se recarga al cambiar de empresa.
 */

/** La de demostración principal. Es también la inicial del almacén. */
export const EMPRESA_PRINCIPAL = EMPRESA_INICIAL

export const EMPRESA_SECUNDARIA = 'emp-002'

export const EMPRESAS_SEED: readonly Empresa[] = [
  {
    id: EMPRESA_PRINCIPAL,
    codigo: 'SCK',
    nombre: 'Soluciones Contikos S.A.',
    nombreComercial: 'Contikos',
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101987654',
    pais: 'CR',
    ejercicioInicioMes: 1,
    activa: true,
  },
  {
    id: EMPRESA_SECUNDARIA,
    codigo: 'DCP',
    nombre: 'Distribuidora Contikos del Pacífico S.A.',
    nombreComercial: 'Contikos Pacífico',
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101765432',
    pais: 'CR',
    ejercicioInicioMes: 1,
    activa: true,
  },
]

const tablaEmpresas = tablaGlobal<Empresa>('empresas', () =>
  EMPRESAS_SEED.map((e) => ({ ...e })),
)

export const empresasMock: Empresa[] = tablaEmpresas.filas

export function persistirEmpresas(): void {
  tablaEmpresas.persistir()
}

/** Consecutivo a partir del mayor emitido, no del tamaño: el catálogo persiste. */
export function siguienteIdEmpresa(): string {
  const mayor = empresasMock.reduce((acc, e) => {
    const numero = Number(e.id.replace(/\D/g, ''))
    return Number.isNaN(numero) ? acc : Math.max(acc, numero)
  }, 0)
  return `emp-${String(mayor + 1).padStart(3, '0')}`
}

/**
 * Semilla distinta por empresa.
 *
 * Los catálogos de plantilla (cuentas, monedas, periodos, categorías) son los
 * mismos para toda empresa y no pasan por aquí. Lo que sí varía es lo que la
 * empresa capturó: documentos, terceros, activos. De eso, la demo principal
 * trae su juego, la secundaria el suyo, y una empresa recién creada por el
 * usuario nada, que es como arranca una empresa de verdad.
 */
export function segunEmpresa<T>(
  porEmpresa: Readonly<Record<string, () => T[]>>,
  resto: () => T[] = () => [],
): Semilla<T> {
  return (empresaId) => (porEmpresa[empresaId] ?? resto)()
}
