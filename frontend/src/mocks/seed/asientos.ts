import Decimal from 'decimal.js'
import type {
  Asiento,
  LineaAsiento,
  TotalLibro,
} from '@/shared/api/contracts/conta'
import type {
  AuxiliarTipo,
  Libro,
  Modulo,
} from '@/shared/api/contracts/comunes'
import { LIBROS_TODOS } from '@/shared/api/contracts/comunes'
import { lineaAfecta, librosAfectados } from '@/shared/asiento/libro'
import { codigoAsiento } from '@/shared/asiento/formato'
import { ejercicioDeFecha } from '@/modules/conta/domain/asiento'
import { tabla } from '@/shared/almacen/almacen'
import { EMPRESA_PRINCIPAL, segunEmpresa } from './empresas'
import { CUENTA_POR_CODIGO } from './cuentas'
import { PERIODOS } from './periodos'

/**
 * Asientos de ejemplo.
 *
 * Todos cuadran, cada libro por separado, y los que tocan cuentas de control
 * traen su auxiliar, igual que los exigirá el backend. Un set de datos falso
 * que no respeta las reglas del dominio produce una UI que se cae con datos
 * reales.
 *
 * Casi todos afectan los dos libros, que es el caso normal. Dos no, a
 * propósito, porque son los que hacen visible la contabilidad corporativa:
 * la depreciación de julio (tasa fiscal distinta de la vida útil NIIF) y la
 * provisión de vacaciones (gasto NIIF que fiscalmente no existe hasta pagarse).
 */

interface LineaSemilla {
  cuenta: string
  concepto?: string
  cargo?: string
  abono?: string
  /** Omitido = ambos libros, que es lo normal. */
  libros?: Libro[]
  auxiliar?: { tipo: AuxiliarTipo; id: string; nombre: string }
  centroCosto?: string
}

interface AsientoSemilla {
  fecha: string
  concepto: string
  origen?: { modulo: Modulo; tipo: string; id: string }
  lineas: LineaSemilla[]
}

const SEMILLAS: AsientoSemilla[] = [
  {
    // Queda con saldo y ya vencida: es la que hace que la antigüedad de CxC
    // tenga algo que repartir en cubetas.
    fecha: '2026-06-20',
    concepto: 'Factura electrónica FE-00000114: servicios de salud junio',
    origen: { modulo: 'cxc', tipo: 'factura', id: 'fac-114' },
    lineas: [
      {
        cuenta: '1.1.02.001',
        concepto: 'Servicios Médicos Escazú S.A.',
        cargo: '832000.00',
        auxiliar: { tipo: 'cliente', id: 'cli-003', nombre: 'Servicios Médicos Escazú S.A.' },
      },
      { cuenta: '4.1.01.001', concepto: 'Servicios de salud', abono: '800000.00' },
      { cuenta: '2.1.02.001', concepto: 'IVA 4% servicios de salud', abono: '32000.00' },
    ],
  },
  {
    fecha: '2026-07-03',
    concepto: 'Factura electrónica FE-00000112 — Consultoría julio',
    origen: { modulo: 'cxc', tipo: 'factura', id: 'fac-112' },
    lineas: [
      {
        cuenta: '1.1.02.001',
        concepto: 'Inversiones Tecnológicas del Valle S.A.',
        cargo: '3390000.00',
        auxiliar: { tipo: 'cliente', id: 'cli-001', nombre: 'Inversiones Tecnológicas del Valle S.A.' },
      },
      { cuenta: '4.1.01.001', concepto: 'Servicios de consultoría', abono: '3000000.00' },
      { cuenta: '2.1.02.001', concepto: 'IVA 13%', abono: '390000.00' },
    ],
  },
  {
    fecha: '2026-07-15',
    concepto: 'Cobro FE-00000112 — transferencia BN',
    origen: { modulo: 'cxc', tipo: 'cobro', id: 'cob-088' },
    lineas: [
      {
        cuenta: '1.1.01.010',
        concepto: 'Transferencia recibida',
        cargo: '3390000.00',
        auxiliar: { tipo: 'banco', id: 'bco-001', nombre: 'BN — corriente colones' },
      },
      {
        cuenta: '1.1.02.001',
        concepto: 'Aplicación a FE-00000112',
        abono: '3390000.00',
        auxiliar: { tipo: 'cliente', id: 'cli-001', nombre: 'Inversiones Tecnológicas del Valle S.A.' },
      },
    ],
  },
  {
    fecha: '2026-07-20',
    concepto: 'Factura proveedor 4521 — servicios contables',
    origen: { modulo: 'cxp', tipo: 'factura', id: 'fpr-4521' },
    lineas: [
      { cuenta: '6.1.02.003', concepto: 'Honorarios contables', cargo: '450000.00' },
      { cuenta: '1.1.03.001', concepto: 'IVA acreditable 13%', cargo: '58500.00' },
      {
        cuenta: '2.1.01.001',
        concepto: 'Despacho Contable Arias & Asociados',
        abono: '508500.00',
        auxiliar: { tipo: 'proveedor', id: 'pro-014', nombre: 'Despacho Contable Arias & Asociados' },
      },
    ],
  },
  {
    fecha: '2026-07-31',
    concepto: 'Planilla julio 2026',
    origen: { modulo: 'rh', tipo: 'planilla', id: 'pla-2026-07' },
    lineas: [
      { cuenta: '6.1.01.001', concepto: 'Salarios devengados', cargo: '4200000.00' },
      { cuenta: '6.1.01.002', concepto: 'Cargas sociales patronales', cargo: '1113000.00' },
      { cuenta: '2.1.03.002', concepto: 'CCSS obrero y patronal', abono: '1561140.00' },
      {
        cuenta: '2.1.03.001',
        concepto: 'Neto por pagar',
        abono: '3751860.00',
        auxiliar: { tipo: 'empleado', id: 'emp-todos', nombre: 'Planilla julio' },
      },
    ],
  },
  {
    // La depreciación es el caso clásico de diferencia entre libros: el mismo
    // activo, dos tasas. Se resuelve dentro de UN asiento, con las líneas del
    // equipo de cómputo duplicadas y marcadas a un libro cada una.
    fecha: '2026-07-31',
    concepto: 'Depreciación julio 2026',
    origen: { modulo: 'activos', tipo: 'depreciacion', id: 'dep-2026-07' },
    lineas: [
      { cuenta: '6.1.02.010', concepto: 'Depreciación mobiliario', cargo: '125000.00' },
      {
        cuenta: '1.2.02.001',
        concepto: 'Mobiliario y equipo',
        abono: '125000.00',
        auxiliar: { tipo: 'activo', id: 'act-008', nombre: 'Mobiliario oficina central' },
      },
      {
        cuenta: '6.1.02.010',
        concepto: 'Equipo de cómputo (tasa fiscal 25% anual)',
        cargo: '187500.00',
        libros: ['fiscal'],
      },
      {
        cuenta: '1.2.02.002',
        concepto: 'Equipo de cómputo (tasa fiscal)',
        abono: '187500.00',
        libros: ['fiscal'],
        auxiliar: { tipo: 'activo', id: 'act-021', nombre: 'Lote equipo de cómputo 2024' },
      },
      {
        cuenta: '6.1.02.010',
        concepto: 'Equipo de cómputo (vida útil NIIF 5 años)',
        cargo: '150000.00',
        libros: ['corporativo'],
      },
      {
        cuenta: '1.2.02.002',
        concepto: 'Equipo de cómputo (vida útil NIIF)',
        abono: '150000.00',
        libros: ['corporativo'],
        auxiliar: { tipo: 'activo', id: 'act-021', nombre: 'Lote equipo de cómputo 2024' },
      },
    ],
  },
  {
    fecha: '2026-08-04',
    concepto: 'Pago factura proveedor 4521',
    origen: { modulo: 'cxp', tipo: 'pago', id: 'pag-231' },
    lineas: [
      {
        cuenta: '2.1.01.001',
        concepto: 'Despacho Contable Arias & Asociados',
        cargo: '508500.00',
        auxiliar: { tipo: 'proveedor', id: 'pro-014', nombre: 'Despacho Contable Arias & Asociados' },
      },
      {
        cuenta: '1.1.01.010',
        concepto: 'Transferencia emitida',
        abono: '508500.00',
        auxiliar: { tipo: 'banco', id: 'bco-001', nombre: 'BN — corriente colones' },
      },
    ],
  },
  {
    fecha: '2026-08-05',
    concepto: 'Comisiones bancarias agosto',
    origen: { modulo: 'bancos', tipo: 'comision', id: 'com-0805' },
    lineas: [
      { cuenta: '6.2.01.001', concepto: 'Comisión por manejo de cuenta', cargo: '12500.00' },
      { cuenta: '1.1.03.001', concepto: 'IVA acreditable 13%', cargo: '1625.00' },
      {
        cuenta: '1.1.01.010',
        concepto: 'Cargo automático',
        abono: '14125.00',
        auxiliar: { tipo: 'banco', id: 'bco-001', nombre: 'BN — corriente colones' },
      },
    ],
  },
  {
    fecha: '2026-08-05',
    concepto: 'Factura electrónica FE-00000113: venta de mercancías',
    origen: { modulo: 'cxc', tipo: 'factura', id: 'fac-113' },
    lineas: [
      {
        cuenta: '1.1.02.001',
        concepto: 'Comercial La Sabana S.A.',
        cargo: '1356000.00',
        auxiliar: { tipo: 'cliente', id: 'cli-002', nombre: 'Comercial La Sabana S.A.' },
      },
      { cuenta: '4.1.01.002', concepto: 'Venta de mercancías', abono: '1200000.00' },
      { cuenta: '2.1.02.001', concepto: 'IVA 13%', abono: '156000.00' },
    ],
  },
  {
    fecha: '2026-08-06',
    concepto: 'Reclasificación de gastos de papelería',
    lineas: [
      { cuenta: '6.1.02.004', concepto: 'Papelería y útiles', cargo: '38000.00' },
      { cuenta: '1.1.01.002', concepto: 'Reposición caja chica', abono: '38000.00' },
    ],
  },
  {
    // Devengo NIIF: el derecho a vacaciones ya existe. Fiscalmente el gasto no
    // se reconoce hasta que se paga, así que este asiento no entra al libro
    // fiscal, y es la razón de que las dos utilidades no coincidan.
    fecha: '2026-08-07',
    concepto: 'Provisión de vacaciones agosto (devengo NIIF)',
    lineas: [
      {
        cuenta: '6.1.01.004',
        concepto: 'Vacaciones devengadas del mes',
        cargo: '350000.00',
        libros: ['corporativo'],
      },
      {
        cuenta: '2.1.03.011',
        concepto: 'Provisión de vacaciones',
        abono: '350000.00',
        libros: ['corporativo'],
      },
    ],
  },
  {
    fecha: '2026-08-10',
    concepto: 'Factura proveedor 7788: papelería',
    origen: { modulo: 'cxp', tipo: 'factura', id: 'fpr-7788' },
    lineas: [
      { cuenta: '6.1.02.004', concepto: 'Papelería y útiles', cargo: '180000.00' },
      { cuenta: '1.1.03.001', concepto: 'IVA acreditable 13%', cargo: '23400.00' },
      {
        cuenta: '2.1.01.001',
        concepto: 'Suministros de Oficina Delta S.A.',
        abono: '203400.00',
        auxiliar: { tipo: 'proveedor', id: 'pro-021', nombre: 'Suministros de Oficina Delta S.A.' },
      },
    ],
  },
  {
    // Compra de activo registrada SIN ficha, que es la situación que docs/07 §4
    // llama a vigilar: el mayor ya reconoce el vehículo y el auxiliar de
    // activos no lo conoce. Por eso la línea va sin auxiliar. Es lo que alimenta
    // la lista de altas pendientes hasta que alguien la regulariza.
    fecha: '2026-08-14',
    concepto: 'Factura proveedor 8010: vehículo de reparto',
    origen: { modulo: 'cxp', tipo: 'factura', id: 'fpr-8010' },
    lineas: [
      { cuenta: '1.2.01.003', concepto: 'Vehículo de reparto', cargo: '6000000.00' },
      { cuenta: '1.1.03.001', concepto: 'IVA acreditable 13%', cargo: '780000.00' },
      {
        cuenta: '2.1.01.001',
        concepto: 'Suministros de Oficina Delta S.A.',
        abono: '6780000.00',
        auxiliar: { tipo: 'proveedor', id: 'pro-021', nombre: 'Suministros de Oficina Delta S.A.' },
      },
    ],
  },
  {
    // Compra capitalizada: la línea de la factura carga la cuenta de activo
    // fijo con el auxiliar del activo que nació de esa misma captura
    // (docs/07 §3.1). Lleva retención de renta del 2%, que reduce lo que se le
    // paga al proveedor pero no lo que factura.
    fecha: '2026-08-12',
    concepto: 'Factura proveedor 9001: servidor de aplicaciones',
    origen: { modulo: 'cxp', tipo: 'factura', id: 'fpr-9001' },
    lineas: [
      {
        cuenta: '1.2.01.002',
        concepto: 'Servidor de aplicaciones Dell PowerEdge',
        cargo: '2400000.00',
        auxiliar: { tipo: 'activo', id: 'act-030', nombre: 'Servidor de aplicaciones Dell PowerEdge' },
      },
      { cuenta: '1.1.03.001', concepto: 'IVA acreditable 13%', cargo: '312000.00' },
      { cuenta: '2.1.02.002', concepto: 'Retención de renta 2%', abono: '48000.00' },
      {
        cuenta: '2.1.01.001',
        concepto: 'Ingeniería y Sistemas Vega S.A.',
        abono: '2664000.00',
        auxiliar: { tipo: 'proveedor', id: 'pro-033', nombre: 'Ingeniería y Sistemas Vega S.A.' },
      },
    ],
  },
]

function construirLineas(semillas: LineaSemilla[]): LineaAsiento[] {
  return semillas.map((l, i) => ({
    id: `lin-${i}`,
    orden: i + 1,
    cuentaCodigo: l.cuenta,
    cuentaNombre: CUENTA_POR_CODIGO.get(l.cuenta)?.nombre ?? l.cuenta,
    concepto: l.concepto ?? '',
    cargo: l.cargo ?? '0.00',
    abono: l.abono ?? '0.00',
    libros: l.libros ?? [...LIBROS_TODOS],
    centroCosto: l.centroCosto ?? null,
    auxiliarTipo: l.auxiliar?.tipo ?? null,
    auxiliarId: l.auxiliar?.id ?? null,
    auxiliarNombre: l.auxiliar?.nombre ?? null,
  }))
}

function totalizar(
  lineas: LineaAsiento[],
  libro: Libro,
  campo: 'cargo' | 'abono',
): string {
  return lineas
    .filter((l) => lineaAfecta(l, libro))
    .reduce((acc, l) => acc.plus(new Decimal(l[campo])), new Decimal(0))
    .toFixed(2)
}

/** Un total por libro afectado: cuando difieren, no hay "un" total del asiento. */
function totalesDe(lineas: LineaAsiento[]): TotalLibro[] {
  return librosAfectados(lineas).map((libro) => ({
    libro,
    totalCargos: totalizar(lineas, libro, 'cargo'),
    totalAbonos: totalizar(lineas, libro, 'abono'),
  }))
}

/**
 * Id interno del asiento: `asi-2026-000012`.
 *
 * Lleva el ejercicio porque el número se repite entre ejercicios (docs/03 §3)
 * y el id tiene que ser único en el libro entero. El handler numera con la
 * misma función para que la semilla y lo emitido después sean indistinguibles.
 */
export function idAsiento(ejercicio: number, numero: number): string {
  return `asi-${ejercicio}-${String(numero).padStart(6, '0')}`
}

function construirAsientos(): Asiento[] {
  // Consecutivo único por ejercicio, sin huecos (docs/03 §3). Es uno solo
  // para los dos libros: no existe una numeración fiscal aparte.
  const ultimoPorEjercicio = new Map<number, number>()
  return SEMILLAS.map((s) => {
    const lineas = construirLineas(s.lineas)
    const ejercicio = ejercicioDeFecha(s.fecha, PERIODOS)
    const numero = (ultimoPorEjercicio.get(ejercicio) ?? 0) + 1
    ultimoPorEjercicio.set(ejercicio, numero)
    return {
      id: idAsiento(ejercicio, numero),
      numero,
      ejercicio,
      codigo: codigoAsiento(ejercicio, numero),
      fecha: s.fecha,
      concepto: s.concepto,
      origenModulo: s.origen?.modulo ?? null,
      origenTipo: s.origen?.tipo ?? null,
      origenId: s.origen?.id ?? null,
      moneda: 'CRC' as const,
      tipoCambio: '1.00',
      estado: 'contabilizado' as const,
      reversaDeId: null,
      reversadoPorId: null,
      motivoReversa: null,
      documentoRelacionado: null,
      libros: librosAfectados(lineas),
      totales: totalesDe(lineas),
      lineas,
      creadoPor: 'demo@contikos.cr',
      creadoEn: `${s.fecha}T09:00:00Z`,
    }
  })
}

/**
 * El libro de asientos vivo, persistido.
 *
 * Es la colección que más importa que sobreviva a una recarga: un asiento
 * emitido no se puede perder porque el usuario apretara F5, y el consecutivo
 * que lo numera se deriva de aquí.
 */
const tablaAsientos = tabla<Asiento>(
  'conta.asientos',
  // Solo la empresa de demostración principal trae mayor: las demás arrancan
  // con el libro vacío, que es como arranca una empresa de verdad.
  segunEmpresa({ [EMPRESA_PRINCIPAL]: construirAsientos }),
)

export const ASIENTOS: Asiento[] = tablaAsientos.filas

export function persistirAsientos(): void {
  tablaAsientos.persistir()
}

/**
 * Asiento que contabilizó un documento subsidiario.
 *
 * Las semillas de cada módulo lo consultan en vez de escribir el id a mano: la
 * trazabilidad del documento a su asiento se resuelve por la terna de origen,
 * que es la misma llave con la que el contrato garantiza la idempotencia
 * (docs/02 §4).
 */
export function asientoDeOrigen(
  modulo: Modulo,
  tipo: string,
  id: string,
): string | null {
  return (
    ASIENTOS.find(
      (a) =>
        a.origenModulo === modulo && a.origenTipo === tipo && a.origenId === id,
    )?.id ?? null
  )
}
