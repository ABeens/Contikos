import type { Cuenta, Naturaleza, TipoCuenta } from '@/shared/api/contracts/conta'
import type { AuxiliarTipo, Modulo } from '@/shared/api/contracts/comunes'
import { compararCodigos } from '@/modules/conta/domain/cuenta'
import { tabla } from '@/shared/almacen/almacen'
import { CLASIFICACION_POR_CODIGO, NOTA_POR_REFERENCIA } from './clasificaciones'

/**
 * Catálogo de cuentas base — Costa Rica, NIIF para PYMES.
 *
 * Costa Rica NO impone un catálogo uniforme (docs/13 §1.1), así que este es una
 * plantilla razonable de arranque, no una obligación legal. La empresa lo ajusta.
 *
 * Las cuentas marcadas como control solo las mueve su módulo dueño: nadie
 * captura un asiento manual contra Clientes, porque el auxiliar de CxC dejaría
 * de cuadrar contra el mayor (docs/03 §2).
 */

type Fila = [
  codigo: string,
  nombre: string,
  tipo: TipoCuenta,
  detalle: boolean,
  extra?: {
    naturaleza?: Naturaleza
    control?: Modulo
    auxiliar?: AuxiliarTipo
    /** Código ISO 4217. El catálogo de monedas es configurable. */
    moneda?: string
    inactiva?: boolean
  },
]

const NATURALEZA_POR_TIPO: Record<TipoCuenta, Naturaleza> = {
  activo: 'deudora',
  pasivo: 'acreedora',
  capital: 'acreedora',
  ingreso: 'acreedora',
  costo: 'deudora',
  gasto: 'deudora',
  orden: 'deudora',
}

const FILAS: Fila[] = [
  ['1', 'ACTIVO', 'activo', false],
  ['1.1', 'Activo corriente', 'activo', false],
  ['1.1.01', 'Efectivo y equivalentes de efectivo', 'activo', false],
  ['1.1.01.001', 'Caja general', 'activo', true],
  ['1.1.01.002', 'Caja chica', 'activo', true],
  ['1.1.01.010', 'Banco Nacional — cuenta corriente colones', 'activo', true, { control: 'bancos', auxiliar: 'banco' }],
  ['1.1.01.011', 'BAC San José — cuenta corriente dólares', 'activo', true, { control: 'bancos', auxiliar: 'banco', moneda: 'USD' }],
  ['1.1.02', 'Cuentas por cobrar', 'activo', false],
  ['1.1.02.001', 'Clientes', 'activo', true, { control: 'cxc', auxiliar: 'cliente' }],
  ['1.1.02.005', 'Estimación para incobrables', 'activo', true, { naturaleza: 'acreedora' }],
  ['1.1.03', 'Impuestos por cobrar', 'activo', false],
  ['1.1.03.001', 'IVA acreditable', 'activo', true],
  ['1.1.03.002', 'Retenciones de renta soportadas', 'activo', true],
  ['1.1.04', 'Inventarios', 'activo', false],
  ['1.1.04.001', 'Inventario de mercancías', 'activo', true],
  ['1.1.05', 'Anticipos', 'activo', false],
  ['1.1.05.001', 'Anticipos a proveedores', 'activo', true, { auxiliar: 'proveedor' }],

  ['1.2', 'Activo no corriente', 'activo', false],
  ['1.2.01', 'Propiedad, planta y equipo', 'activo', false],
  ['1.2.01.001', 'Mobiliario y equipo de oficina', 'activo', true, { control: 'activos', auxiliar: 'activo' }],
  ['1.2.01.002', 'Equipo de cómputo', 'activo', true, { control: 'activos', auxiliar: 'activo' }],
  ['1.2.01.003', 'Vehículos', 'activo', true, { control: 'activos', auxiliar: 'activo' }],
  ['1.2.02', 'Depreciación acumulada', 'activo', false],
  ['1.2.02.001', 'Dep. acumulada — mobiliario y equipo', 'activo', true, { naturaleza: 'acreedora', control: 'activos', auxiliar: 'activo' }],
  ['1.2.02.002', 'Dep. acumulada — equipo de cómputo', 'activo', true, { naturaleza: 'acreedora', control: 'activos', auxiliar: 'activo' }],
  ['1.2.02.003', 'Dep. acumulada — vehículos', 'activo', true, { naturaleza: 'acreedora', control: 'activos', auxiliar: 'activo' }],

  ['2', 'PASIVO', 'pasivo', false],
  ['2.1', 'Pasivo corriente', 'pasivo', false],
  ['2.1.01', 'Cuentas por pagar', 'pasivo', false],
  ['2.1.01.001', 'Proveedores', 'pasivo', true, { control: 'cxp', auxiliar: 'proveedor' }],
  ['2.1.01.005', 'Gastos acumulados por pagar', 'pasivo', true],
  ['2.1.02', 'Impuestos por pagar', 'pasivo', false],
  ['2.1.02.001', 'IVA por pagar', 'pasivo', true],
  ['2.1.02.002', 'Retenciones de renta por pagar', 'pasivo', true],
  ['2.1.02.003', 'Impuesto sobre la renta por pagar', 'pasivo', true],
  ['2.1.03', 'Obligaciones laborales', 'pasivo', false],
  ['2.1.03.001', 'Salarios por pagar', 'pasivo', true, { control: 'rh', auxiliar: 'empleado' }],
  ['2.1.03.002', 'CCSS por pagar', 'pasivo', true],
  ['2.1.03.010', 'Provisión de aguinaldo', 'pasivo', true],
  ['2.1.03.011', 'Provisión de vacaciones', 'pasivo', true],
  ['2.1.03.012', 'Provisión de cesantía', 'pasivo', true],
  ['2.1.04', 'Anticipos recibidos', 'pasivo', false],
  ['2.1.04.001', 'Anticipos de clientes', 'pasivo', true, { auxiliar: 'cliente' }],

  ['3', 'PATRIMONIO', 'capital', false],
  ['3.1', 'Capital', 'capital', false],
  ['3.1.01', 'Capital social', 'capital', false],
  ['3.1.01.001', 'Capital social suscrito y pagado', 'capital', true],
  ['3.2', 'Resultados', 'capital', false],
  ['3.2.01', 'Resultados acumulados', 'capital', false],
  ['3.2.01.001', 'Utilidades acumuladas', 'capital', true],
  ['3.2.02', 'Resultado del ejercicio', 'capital', false],
  ['3.2.02.001', 'Resultado del periodo', 'capital', true],

  ['4', 'INGRESOS', 'ingreso', false],
  ['4.1', 'Ingresos de operación', 'ingreso', false],
  ['4.1.01', 'Ventas', 'ingreso', false],
  ['4.1.01.001', 'Venta de servicios', 'ingreso', true],
  ['4.1.01.002', 'Venta de mercancías', 'ingreso', true],
  ['4.2', 'Otros ingresos', 'ingreso', false],
  ['4.2.01', 'Ingresos no operativos', 'ingreso', false],
  ['4.2.01.001', 'Diferencial cambiario ganado', 'ingreso', true],
  ['4.2.01.002', 'Productos financieros', 'ingreso', true],

  ['5', 'COSTOS', 'costo', false],
  ['5.1', 'Costo de ventas', 'costo', false],
  ['5.1.01', 'Costo de mercancías', 'costo', false],
  ['5.1.01.001', 'Costo de mercancías vendidas', 'costo', true],

  ['6', 'GASTOS', 'gasto', false],
  ['6.1', 'Gastos de operación', 'gasto', false],
  ['6.1.01', 'Gastos de personal', 'gasto', false],
  ['6.1.01.001', 'Salarios', 'gasto', true],
  ['6.1.01.002', 'Cargas sociales patronales', 'gasto', true],
  ['6.1.01.003', 'Aguinaldo', 'gasto', true],
  ['6.1.01.004', 'Vacaciones', 'gasto', true],
  ['6.1.02', 'Gastos generales', 'gasto', false],
  ['6.1.02.001', 'Alquileres', 'gasto', true],
  ['6.1.02.002', 'Servicios públicos', 'gasto', true],
  ['6.1.02.003', 'Servicios profesionales', 'gasto', true],
  ['6.1.02.004', 'Papelería y útiles', 'gasto', true],
  ['6.1.02.010', 'Gasto por depreciación', 'gasto', true],
  ['6.2', 'Gastos financieros', 'gasto', false],
  ['6.2.01', 'Gastos financieros y cambiarios', 'gasto', false],
  ['6.2.01.001', 'Comisiones y gastos bancarios', 'gasto', true],
  ['6.2.01.002', 'Diferencial cambiario perdido', 'gasto', true],
  ['6.2.01.003', 'Intereses sobre préstamos', 'gasto', true, { inactiva: true }],
]

/**
 * Presentación: en qué renglón del estado financiero suma cada cuenta y en qué
 * nota se desglosa.
 *
 * Va en una tabla aparte y no en cada fila a propósito: es otra decisión, la
 * toma otro rol y cambia por su cuenta. Quien numera el catálogo de cuentas no
 * es necesariamente quien arma la presentación de los estados financieros.
 *
 * Están TODAS las cuentas de detalle, y las dos columnas de cada una: el
 * renglón y la nota son obligatorios (docs/03 §2 bis). Las acumulativas no
 * aparecen: presentan lo que suman sus hijas.
 */
const PRESENTACION: Record<string, [clasificacion: string, nota: string]> = {
  // La nota se cita por su referencia completa: el efectivo se desglosa en dos
  // cuadros, la caja en 1a y los bancos en 1b.
  '1.1.01.001': ['A.01', '1a'],
  '1.1.01.002': ['A.01', '1a'],
  '1.1.01.010': ['A.01', '1b'],
  '1.1.01.011': ['A.01', '1b'],
  '1.1.02.001': ['A.02', '2'],
  '1.1.02.005': ['A.02', '2'],
  '1.1.03.001': ['A.04', '4'],
  '1.1.03.002': ['A.04', '4'],
  '1.1.04.001': ['A.03', '3'],
  '1.1.05.001': ['A.05', '5'],
  '1.2.01.001': ['A.06', '6'],
  '1.2.01.002': ['A.06', '6'],
  '1.2.01.003': ['A.06', '6'],
  '1.2.02.001': ['A.06', '6'],
  '1.2.02.002': ['A.06', '6'],
  '1.2.02.003': ['A.06', '6'],

  '2.1.01.001': ['P.01', '7'],
  '2.1.01.005': ['P.01', '7'],
  '2.1.02.001': ['P.02', '8'],
  '2.1.02.002': ['P.02', '8'],
  '2.1.02.003': ['P.02', '8'],
  '2.1.03.001': ['P.03', '9'],
  '2.1.03.002': ['P.03', '9'],
  '2.1.03.010': ['P.03', '9'],
  '2.1.03.011': ['P.03', '9'],
  '2.1.03.012': ['P.03', '9'],
  '2.1.04.001': ['P.01', '7'],

  '3.1.01.001': ['PT.01', '10'],
  '3.2.01.001': ['PT.02', '11'],
  '3.2.02.001': ['PT.02', '11'],

  '4.1.01.001': ['R.01', '12'],
  '4.1.01.002': ['R.01', '12'],
  // La ganancia cambiaria y la pérdida cambiaria comparten renglón: se presenta
  // el neto. Por eso R.08 admite cuentas de ingreso y de gasto.
  '4.2.01.001': ['R.08', '19'],
  '4.2.01.002': ['R.02', '13'],

  '5.1.01.001': ['R.03', '14'],

  '6.1.01.001': ['R.04', '15'],
  '6.1.01.002': ['R.04', '15'],
  '6.1.01.003': ['R.04', '15'],
  '6.1.01.004': ['R.04', '15'],
  '6.1.02.001': ['R.05', '16'],
  '6.1.02.002': ['R.05', '16'],
  '6.1.02.003': ['R.05', '16'],
  '6.1.02.004': ['R.05', '16'],
  '6.1.02.010': ['R.06', '17'],
  // Inactiva, pero clasificada igual: la presentación no depende de que la
  // cuenta admita asientos hoy, sino de dónde se presenta lo que ya movió.
  '6.2.01.001': ['R.07', '18'],
  '6.2.01.002': ['R.08', '19'],
  '6.2.01.003': ['R.07', '18'],
}

/**
 * Resuelve la presentación de una cuenta a los ids de los dos catálogos.
 *
 * Se traduce aquí, en la semilla, y no en el handler: lo que se sirve por la
 * API son ids, igual que hará el backend real.
 */
function presentacionDe(codigo: string) {
  const fila = PRESENTACION[codigo]
  // Sin fila es una acumulativa: no se presenta por sí misma.
  if (!fila) return { clasificacionNiifId: null, notaEeffId: null }
  const [clasificacion, nota] = fila
  return {
    clasificacionNiifId: CLASIFICACION_POR_CODIGO.get(clasificacion)?.id ?? null,
    notaEeffId: NOTA_POR_REFERENCIA.get(nota)?.id ?? null,
  }
}

function padreDe(codigo: string): string | null {
  const partes = codigo.split('.')
  if (partes.length === 1) return null
  return partes.slice(0, -1).join('.')
}

function construirCuentas(): Cuenta[] {
  return FILAS.map(
    ([codigo, nombre, tipo, esDetalle, extra]) => ({
      id: `cta-${codigo}`,
      codigo,
      nombre,
      cuentaPadreId: padreDe(codigo) ? `cta-${padreDe(codigo)}` : null,
      nivel: codigo.split('.').length,
      naturaleza: extra?.naturaleza ?? NATURALEZA_POR_TIPO[tipo],
      tipo,
      esDetalle,
      requiereAuxiliar: extra?.auxiliar ?? null,
      esCuentaControl: Boolean(extra?.control),
      moduloDueno: extra?.control ?? null,
      ...presentacionDe(codigo),
      moneda: extra?.moneda ?? null,
      activa: !extra?.inactiva,
    }),
  )
}

/**
 * El catálogo vivo, persistido.
 *
 * Se siembra la primera vez y a partir de ahí manda lo guardado: una cuenta
 * creada por el usuario tiene que seguir ahí después de recargar, igual que
 * seguiría si la hubiera creado el backend.
 */
/**
 * Índice por código. Se reconstruye en su sitio cuando el catálogo cambia de
 * golpe (otra empresa, restablecer): quien lo importó sigue teniendo el mismo
 * mapa, y el mapa sigue diciendo la verdad.
 */
export const CUENTA_POR_CODIGO = new Map<string, Cuenta>()

function indexar(filas: readonly Cuenta[]): void {
  CUENTA_POR_CODIGO.clear()
  for (const c of filas) CUENTA_POR_CODIGO.set(c.codigo, c)
}

const tablaCuentas = tabla<Cuenta>('conta.cuentas', construirCuentas, {
  alCambiar: indexar,
})

export const CUENTAS: Cuenta[] = tablaCuentas.filas

indexar(CUENTAS)

/** Guarda el catálogo tras editar una cuenta en su sitio. */
export function persistirCuentas(): void {
  tablaCuentas.persistir()
}

/**
 * Añade una cuenta al catálogo vivo del mock.
 *
 * Va aquí y no en el handler por dos cosas que hay que hacer juntas o no
 * hacerlas: insertarla en el orden del catálogo, porque la pantalla dibuja el
 * árbol por el orden del array, y meterla en el índice por código, que si no
 * queda contando una cuenta menos que la lista.
 */
export function registrarCuenta(cuenta: Cuenta): Cuenta {
  const posicion = CUENTAS.findIndex(
    (c) => compararCodigos(c.codigo, cuenta.codigo) > 0,
  )
  CUENTAS.splice(posicion === -1 ? CUENTAS.length : posicion, 0, cuenta)
  CUENTA_POR_CODIGO.set(cuenta.codigo, cuenta)
  tablaCuentas.persistir()
  return cuenta
}
