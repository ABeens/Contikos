import type {
  Activo,
  CategoriaActivoBase,
} from '@/shared/api/contracts/activos'
import { tabla } from '@/shared/almacen/almacen'
import { EMPRESA_PRINCIPAL, segunEmpresa } from './empresas'
import { asientoDeOrigen } from './asientos'


/**
 * Categorías y activos de la empresa demo.
 *
 * El mapeo contable vive en la categoría y no en el activo (docs/07 §6): son
 * las tres cuentas que mueve su ciclo de vida.
 *
 * Nota sobre la depreciación acumulada: el mayor de la demo arranca en julio de
 * 2026 y no lleva saldos iniciales, así que la conciliación auxiliar contra
 * mayor de docs/07 §4 solo se puede comprobar sobre los movimientos de esas
 * fechas en adelante. La acumulada de los activos anteriores es la real del
 * activo, no la que suma el mayor de la demo.
 */

const CATEGORIAS_SEED: readonly CategoriaActivoBase[] = [
  {
    id: 'cat-mobiliario',
    nombre: 'Mobiliario y equipo de oficina',
    vidaUtilMeses: 120,
    metodo: 'linea_recta',
    porcentajeResidual: '0',
    cuentaActivo: '1.2.01.001',
    cuentaDepreciacionAcumulada: '1.2.02.001',
    cuentaGastoDepreciacion: '6.1.02.010',
    // La tasa del reglamento coincide con la vida útil contable: no hay
    // diferencia entre libros que declarar.
    tasaFiscalAnual: '10',
    activa: true,
  },
  {
    id: 'cat-computo',
    nombre: 'Equipo de cómputo',
    vidaUtilMeses: 60,
    metodo: 'linea_recta',
    porcentajeResidual: '0',
    cuentaActivo: '1.2.01.002',
    cuentaDepreciacionAcumulada: '1.2.02.002',
    cuentaGastoDepreciacion: '6.1.02.010',
    // 25% anual fiscal frente a cinco años de vida útil NIIF: es la diferencia
    // que la depreciación de julio resuelve dentro de un solo asiento con las
    // líneas marcadas a su libro (docs/02 §3.1).
    tasaFiscalAnual: '25',
    activa: true,
  },
  {
    id: 'cat-vehiculos',
    nombre: 'Vehículos',
    vidaUtilMeses: 120,
    metodo: 'linea_recta',
    porcentajeResidual: '10',
    cuentaActivo: '1.2.01.003',
    cuentaDepreciacionAcumulada: '1.2.02.003',
    cuentaGastoDepreciacion: '6.1.02.010',
    tasaFiscalAnual: '10',
    activa: true,
  },
]

/**
 * La corrida de julio de 2026 ya está en el mayor de la demo, con la terna de
 * origen `(activos, depreciacion, dep-2026-07)`. Las fichas la llevan en su
 * historial para que la acumulada se explique y para que agosto sepa que el
 * mes anterior sí se corrió.
 */
const CORRIDA_JULIO = {
  periodoId: 'per-2026-07',
  fecha: '2026-07-31',
  origenId: 'dep-2026-07',
}

function depreciacionJulio(cuota: string) {
  return {
    periodoId: CORRIDA_JULIO.periodoId,
    fecha: CORRIDA_JULIO.fecha,
    cuota,
    asientoId:
      asientoDeOrigen('activos', 'depreciacion', CORRIDA_JULIO.origenId) ??
      'asi-julio',
  }
}

// Se construye al sembrar y no al cargar el módulo: el id del asiento de julio
// se resuelve contra el mayor de la empresa que se está abriendo.
const construirActivos = (): Activo[] => [
  {
    id: 'act-008',
    codigo: 'AF-0008',
    nombre: 'Mobiliario oficina central',
    descripcion: 'Estaciones de trabajo, sillería y archivo de la sede central',
    categoriaId: 'cat-mobiliario',
    categoriaNombre: 'Mobiliario y equipo de oficina',
    fechaAdquisicion: '2024-01-15',
    fechaInicioDepreciacion: '2024-02-01',
    moneda: 'CRC',
    costoAdquisicion: '15000000.00',
    valorResidual: '0.00',
    vidaUtilMeses: 120,
    metodo: 'linea_recta',
    depreciacionAcumulada: '3750000.00',
    valorEnLibros: '11250000.00',
    ubicacion: 'Oficina central, San José',
    responsable: 'Administración',
    numeroSerie: null,
    proveedorId: null,
    proveedorNombre: null,
    facturaId: null,
    facturaFolio: null,
    origen: 'manual',
    estado: 'activo',
    asientoId: null,
    depreciaciones: [depreciacionJulio('125000.00')],
    creadoEn: '2024-01-15T09:00:00Z',
  },
  {
    id: 'act-021',
    codigo: 'AF-0021',
    nombre: 'Lote equipo de cómputo 2024',
    descripcion: 'Doce portátiles y dos estaciones de diseño',
    categoriaId: 'cat-computo',
    categoriaNombre: 'Equipo de cómputo',
    fechaAdquisicion: '2024-08-05',
    fechaInicioDepreciacion: '2024-09-01',
    moneda: 'CRC',
    costoAdquisicion: '9000000.00',
    valorResidual: '0.00',
    vidaUtilMeses: 60,
    metodo: 'linea_recta',
    depreciacionAcumulada: '3450000.00',
    valorEnLibros: '5550000.00',
    ubicacion: 'Oficina central, San José',
    responsable: 'Tecnología',
    numeroSerie: null,
    proveedorId: null,
    proveedorNombre: null,
    facturaId: null,
    facturaFolio: null,
    origen: 'manual',
    estado: 'activo',
    asientoId: null,
    // La cuota del historial es la contable (NIIF): es la que abate la
    // acumulada de la ficha. La fiscal de julio (187.500) vive solo en el
    // libro fiscal del asiento.
    depreciaciones: [depreciacionJulio('150000.00')],
    creadoEn: '2024-08-05T09:00:00Z',
  },
  {
    // Nació de la factura 9001 de CxP: el asiento lo hizo aquel módulo y esta
    // ficha no genera uno propio (docs/07 §3.1).
    id: 'act-030',
    codigo: 'AF-0030',
    nombre: 'Servidor de aplicaciones Dell PowerEdge',
    descripcion: 'Servidor de virtualización de la sede central',
    categoriaId: 'cat-computo',
    categoriaNombre: 'Equipo de cómputo',
    fechaAdquisicion: '2026-08-12',
    fechaInicioDepreciacion: '2026-08-15',
    moneda: 'CRC',
    costoAdquisicion: '2400000.00',
    valorResidual: '0.00',
    vidaUtilMeses: 60,
    metodo: 'linea_recta',
    depreciacionAcumulada: '0.00',
    valorEnLibros: '2400000.00',
    ubicacion: 'Centro de datos, oficina central',
    responsable: 'Tecnología',
    numeroSerie: 'DPE-2026-77120',
    proveedorId: 'pro-033',
    proveedorNombre: 'Ingeniería y Sistemas Vega S.A.',
    facturaId: 'fpr-9001',
    facturaFolio: '9001',
    origen: 'cxp',
    estado: 'activo',
    // El alta desde CxP no genera asiento propio: el que reconoció el activo
    // en el mayor es el de la compra, y a él se llega por la factura.
    asientoId: null,
    // Entró en uso en agosto: todavía no le toca ninguna corrida.
    depreciaciones: [],
    creadoEn: '2026-08-12T11:30:00Z',
  },
]

const tablaCategorias = tabla<CategoriaActivoBase>('activos.categorias', () =>
  CATEGORIAS_SEED.map((c) => ({ ...c })),
)

const tablaActivos = tabla<Activo>(
  'activos.activos',
  segunEmpresa({
    [EMPRESA_PRINCIPAL]: construirActivos,
  }),
)

export const categoriasMock: CategoriaActivoBase[] = tablaCategorias.filas

export const activosMock: Activo[] = tablaActivos.filas

export function persistirCategorias(): void {
  tablaCategorias.persistir()
}

export function persistirActivos(): void {
  tablaActivos.persistir()
}


/**
 * Identificador de una categoría nueva.
 *
 * Legible a partir del nombre, como los de fábrica, y con sufijo cuando ya
 * existe: dos categorías distintas nunca comparten id aunque se llamen parecido.
 */
export function siguienteIdCategoria(nombre: string): string {
  const raiz =
    nombre
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'categoria'

  let candidato = `cat-${raiz}`
  let sufijo = 2
  while (categoriasMock.some((c) => c.id === candidato)) {
    candidato = `cat-${raiz}-${sufijo}`
    sufijo += 1
  }
  return candidato
}

export function siguienteCodigoActivo(): string {
  const mayor = activosMock.reduce((acc, a) => {
    const numero = Number(a.codigo.replace(/\D/g, ''))
    return Number.isNaN(numero) ? acc : Math.max(acc, numero)
  }, 0)
  return `AF-${String(mayor + 1).padStart(4, '0')}`
}
