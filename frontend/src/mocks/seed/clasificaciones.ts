import type {
  ClasificacionNiifBase,
  EstadoFinanciero,
  NotaEeffBase,
  TipoCuenta,
} from '@/shared/api/contracts/conta'
import { tabla } from '@/shared/almacen/almacen'

/**
 * Catálogos de presentación de la empresa demo.
 *
 * La clasificación dice en qué renglón del estado financiero suma una cuenta;
 * la nota, en qué desglose se explica ese renglón. Como el catálogo de cuentas
 * (docs/13 §1.1), esto es una plantilla razonable de arranque y no una
 * obligación legal: la NIIF para PYMES regula qué debe revelarse, no con qué
 * códigos lo numera cada empresa.
 *
 * El estado es mutable y vive aquí, no dentro de un handler, porque lo leen
 * dos: los handlers de los catálogos lo administran y el de cuentas necesita
 * validar contra él cada asignación.
 */

type FilaClasificacion = [
  codigo: string,
  nombre: string,
  estado: EstadoFinanciero,
  tipos: TipoCuenta[],
  seccion: string | null,
]

/**
 * El orden va de diez en diez para poder intercalar sin renumerar el resto.
 * Es el orden de presentación dentro del estado financiero, no una llave.
 */
const CLASIFICACIONES_FILAS: FilaClasificacion[] = [
  // Estado de Situación Financiera: activo
  ['A.01', 'Efectivo y equivalentes al efectivo', 'situacion', ['activo'], 'Sección 7'],
  ['A.02', 'Deudores comerciales y otras cuentas por cobrar', 'situacion', ['activo'], 'Sección 11'],
  ['A.03', 'Inventarios', 'situacion', ['activo'], 'Sección 13'],
  ['A.04', 'Activos por impuestos corrientes', 'situacion', ['activo'], 'Sección 29'],
  ['A.05', 'Otros activos corrientes', 'situacion', ['activo'], 'Sección 4'],
  ['A.06', 'Propiedades, planta y equipo', 'situacion', ['activo'], 'Sección 17'],

  // Estado de Situación Financiera: pasivo
  ['P.01', 'Acreedores comerciales y otras cuentas por pagar', 'situacion', ['pasivo'], 'Sección 11'],
  ['P.02', 'Pasivos por impuestos corrientes', 'situacion', ['pasivo'], 'Sección 29'],
  ['P.03', 'Beneficios a los empleados', 'situacion', ['pasivo'], 'Sección 28'],

  // Estado de Situación Financiera: patrimonio
  ['PT.01', 'Capital social', 'situacion', ['capital'], 'Sección 22'],
  ['PT.02', 'Resultados acumulados', 'situacion', ['capital'], 'Sección 6'],

  // Estado de Resultados
  ['R.01', 'Ingresos de actividades ordinarias', 'resultados', ['ingreso'], 'Sección 23'],
  ['R.02', 'Otros ingresos', 'resultados', ['ingreso'], 'Sección 2'],
  ['R.03', 'Costo de ventas', 'resultados', ['costo'], 'Sección 13'],
  ['R.04', 'Gastos por beneficios a los empleados', 'resultados', ['gasto'], 'Sección 28'],
  ['R.05', 'Otros gastos de administración', 'resultados', ['gasto'], 'Sección 5'],
  ['R.06', 'Depreciación y amortización', 'resultados', ['gasto'], 'Sección 17'],
  ['R.07', 'Costos financieros', 'resultados', ['gasto'], 'Sección 25'],
  // El único renglón que reúne dos tipos: la diferencia de cambio se presenta
  // neta, y sus cuentas de ganancia y de pérdida son de signo contrario.
  ['R.08', 'Diferencias de cambio, netas', 'resultados', ['ingreso', 'gasto'], 'Sección 30'],
]

export const CLASIFICACIONES_SEED: readonly ClasificacionNiifBase[] =
  CLASIFICACIONES_FILAS.map(
    ([codigo, nombre, estadoFinanciero, tiposCuenta, seccionNiif], i) => ({
      id: `niif-${codigo.toLowerCase().replace('.', '-')}`,
      codigo,
      nombre,
      estadoFinanciero,
      tiposCuenta,
      seccionNiif,
      orden: (i + 1) * 10,
      activa: true,
    }),
  )

/** Índice por código: lo usa la semilla de cuentas para enlazar sin buscar. */
export const CLASIFICACION_POR_CODIGO = new Map(
  CLASIFICACIONES_SEED.map((c) => [c.codigo, c]),
)

type FilaNota = [
  numero: number,
  literal: string,
  clasificacion: string,
  titulo: string,
  descripcion: string,
]

/**
 * Notas de desglose.
 *
 * Numeración corrida sobre todo el catálogo, no por clasificación: en el cuerpo
 * del estado financiero "véase Nota 7" tiene que apuntar a una sola nota. El
 * literal subdivide un número cuando el renglón se explica en varios cuadros
 * (1a el efectivo en caja, 1b el que está en bancos) sin renumerar el resto.
 *
 * Faltan a propósito las notas narrativas (información general, bases de
 * preparación, políticas contables). No desglosan saldos de cuentas, así que no
 * clasifican nada: son texto del reporte.
 *
 * Todo renglón del catálogo tiene al menos una nota, y no por completitud: la
 * nota es obligatoria en la cuenta de detalle (docs/03 §2 bis), así que un
 * renglón sin notas es un renglón al que no se le puede asignar ninguna cuenta.
 */
const NOTAS_FILAS: FilaNota[] = [
  // El efectivo se revela en dos cuadros y los dos desglosan el mismo renglón:
  // el arqueo de caja y el saldo por cuenta bancaria no comparten tabla.
  [1, 'a', 'A.01', 'Efectivo en caja', 'Arqueo por caja, con el fondo fijo de caja chica y su responsable.'],
  [1, 'b', 'A.01', 'Efectivo en bancos', 'Saldo por cuenta bancaria, con el de moneda extranjera expresado también en su moneda de origen.'],
  [2, '', 'A.02', 'Deudores comerciales y otras cuentas por cobrar', 'Saldo bruto, estimación por deterioro y antigüedad de los saldos vencidos.'],
  [3, '', 'A.03', 'Inventarios', 'Importe en libros por categoría y método de valuación aplicado.'],
  [4, '', 'A.04', 'Saldos con la Administración Tributaria', 'IVA acreditable y retenciones soportadas pendientes de aplicar.'],
  [5, '', 'A.05', 'Otros activos corrientes', 'Anticipos entregados a proveedores y demás saldos deudores pendientes de aplicar.'],
  [6, '', 'A.06', 'Propiedades, planta y equipo', 'Movimiento del periodo por categoría: costo, adiciones, retiros y depreciación acumulada.'],
  [7, '', 'P.01', 'Acreedores comerciales y otras cuentas por pagar', 'Saldo por proveedor y anticipos recibidos de clientes pendientes de aplicar.'],
  [8, '', 'P.02', 'Impuestos por pagar', 'IVA por pagar, retenciones practicadas e impuesto sobre la renta del periodo.'],
  [9, '', 'P.03', 'Beneficios a los empleados', 'Salarios y cargas sociales por pagar, y provisiones de aguinaldo, vacaciones y cesantía.'],
  [10, '', 'PT.01', 'Capital social', 'Número de acciones suscritas y pagadas, y su valor nominal.'],
  [11, '', 'PT.02', 'Resultados acumulados', 'Movimiento de las utilidades acumuladas y del resultado del periodo, con los dividendos declarados.'],
  [12, '', 'R.01', 'Ingresos de actividades ordinarias', 'Desglose por línea de negocio y criterio de reconocimiento aplicado.'],
  [13, '', 'R.02', 'Otros ingresos', 'Ingresos ajenos a la actividad ordinaria: productos financieros y recuperaciones.'],
  [14, '', 'R.03', 'Costo de ventas', 'Composición del costo de las mercancías vendidas durante el periodo.'],
  [15, '', 'R.04', 'Gastos por beneficios a los empleados', 'Salarios, cargas patronales y prestaciones legales cargados al resultado.'],
  [16, '', 'R.05', 'Otros gastos de administración', 'Alquileres, servicios públicos, servicios profesionales y demás gastos de la administración.'],
  [17, '', 'R.06', 'Depreciación del periodo', 'Cargo por depreciación por categoría de activo, conciliado con la Nota 6.'],
  [18, '', 'R.07', 'Costos financieros', 'Intereses y comisiones bancarias reconocidos en el resultado.'],
  [19, '', 'R.08', 'Diferencias de cambio', 'Efecto neto de la revaluación de partidas monetarias en moneda extranjera.'],
]

export const NOTAS_SEED: readonly NotaEeffBase[] = NOTAS_FILAS.map(
  ([numero, literal, clasificacion, titulo, descripcion]) => ({
    id: `nota-${String(numero).padStart(2, '0')}${literal}`,
    clasificacionNiifId:
      CLASIFICACION_POR_CODIGO.get(clasificacion)?.id ?? clasificacion,
    numero,
    literal,
    titulo,
    descripcion,
    activa: true,
  }),
)

/** Índice por la referencia con la que se cita la nota: `1a`, `2`, `13`. */
export const NOTA_POR_REFERENCIA = new Map(
  NOTAS_SEED.map((n) => [`${n.numero}${n.literal}`, n]),
)

const tablaClasificaciones = tabla<ClasificacionNiifBase>(
  'conta.clasificaciones',
  () => CLASIFICACIONES_SEED.map((c) => ({ ...c, tiposCuenta: [...c.tiposCuenta] })),
)

const tablaNotas = tabla<NotaEeffBase>('conta.notas', () =>
  NOTAS_SEED.map((n) => ({ ...n })),
)

export const clasificacionesMock: ClasificacionNiifBase[] =
  tablaClasificaciones.filas

export const notasMock: NotaEeffBase[] = tablaNotas.filas

export function persistirClasificaciones(): void {
  tablaClasificaciones.persistir()
}

export function persistirNotas(): void {
  tablaNotas.persistir()
}
