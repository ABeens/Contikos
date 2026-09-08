import type { Diferido } from '@/shared/api/contracts/diferidos'
import { tabla } from '@/shared/almacen/almacen'
import { EMPRESA_PRINCIPAL, segunEmpresa } from './empresas'
import { asientoDeOrigen } from './asientos'

/**
 * Diferidos de la empresa demo (docs/15).
 *
 * Nota sobre el catálogo de cuentas: la plantilla de `seed/cuentas.ts` no trae
 * una cuenta de "Gastos pagados por anticipado" ni una de "Seguros", así que
 * se usan las más cercanas que sí existen y que representan el mismo hecho, un
 * desembolso hecho antes de consumir lo comprado:
 *
 * - `1.1.05.001 Anticipos a proveedores` guarda el saldo de los gastos
 *   diferidos. Exige auxiliar de proveedor, y por eso las dos fichas de gasto
 *   nombran al suyo: sin tercero, el asiento de la corrida se rechazaría.
 * - `2.1.04.001 Anticipos de clientes` guarda el saldo del ingreso diferido,
 *   con auxiliar de cliente por la misma razón.
 * - La póliza se reconoce en `6.1.02.003 Servicios profesionales` porque el
 *   catálogo no tiene renglón de seguros. Es la única de las tres fichas cuyo
 *   mapeo no es exacto, y está documentado en docs/15 §5.
 *
 * Nota sobre el historial: el mayor de la demo arranca en julio de 2026, así
 * que las cuotas de enero a julio que traen las fichas no tienen asiento en el
 * libro. Se sirven con un identificador de marcador para que el historial no
 * nazca vacío y para que el avance de cada diferido se pueda leer desde el
 * primer arranque; la primera corrida que sí escribe en el mayor es la de
 * agosto.
 */

/** Marcador de las cuotas anteriores al arranque del mayor de la demo. */
const ASIENTO_HISTORICO = 'asi-historico'

const dosDigitos = (n: number) => String(n).padStart(2, '0')

function ultimoDia(ejercicio: number, mes: number): number {
  return new Date(Date.UTC(ejercicio, mes, 0)).getUTCDate()
}

/**
 * Cuotas ya corridas, de `desde` hasta `hasta` del ejercicio 2026.
 *
 * Se construye al sembrar y no al cargar el módulo: el id del asiento se
 * resuelve contra el mayor de la empresa que se está abriendo, igual que hace
 * la semilla de activos con la depreciación de julio.
 */
function amortizadas(desde: number, hasta: number, cuota: string) {
  return Array.from({ length: hasta - desde + 1 }, (_, i) => {
    const mes = desde + i
    const periodoId = `per-2026-${dosDigitos(mes)}`
    return {
      periodoId,
      fecha: `2026-${dosDigitos(mes)}-${dosDigitos(ultimoDia(2026, mes))}`,
      cuota,
      asientoId:
        asientoDeOrigen('conta', 'amortizacion_diferidos', periodoId) ??
        ASIENTO_HISTORICO,
    }
  })
}

const construirDiferidos = (): Diferido[] => [
  {
    id: 'dif-0001',
    codigo: 'DIF-0001',
    tipo: 'gasto',
    descripcion: 'Póliza de seguro de responsabilidad civil 2026',
    tercero: {
      tipo: 'proveedor',
      id: 'pro-014',
      nombre: 'Despacho Contable Arias & Asociados',
    },
    monto: '1800000.00',
    moneda: 'CRC',
    cuentaDiferido: '1.1.05.001',
    cuentaDestino: '6.1.02.003',
    fechaInicio: '2026-01-01',
    plazoMeses: 12,
    cuotaMensual: '150000.00',
    montoAmortizado: '1050000.00',
    saldoPorAmortizar: '750000.00',
    estado: 'vigente',
    cancelacion: null,
    origen: null,
    amortizaciones: amortizadas(1, 7, '150000.00'),
    creadoEn: '2026-01-05T09:00:00Z',
  },
  {
    // Seis meses pagados de una vez en abril: es el caso que enseña que el
    // plazo del diferido no tiene por qué ser el ejercicio entero.
    id: 'dif-0002',
    codigo: 'DIF-0002',
    tipo: 'gasto',
    descripcion: 'Alquiler de bodega pagado por adelantado (abril a setiembre)',
    tercero: {
      tipo: 'proveedor',
      id: 'pro-021',
      nombre: 'Suministros de Oficina Delta S.A.',
    },
    monto: '2400000.00',
    moneda: 'CRC',
    cuentaDiferido: '1.1.05.001',
    cuentaDestino: '6.1.02.001',
    fechaInicio: '2026-04-01',
    plazoMeses: 6,
    cuotaMensual: '400000.00',
    montoAmortizado: '1600000.00',
    saldoPorAmortizar: '800000.00',
    estado: 'vigente',
    cancelacion: null,
    origen: null,
    amortizaciones: amortizadas(4, 7, '400000.00'),
    creadoEn: '2026-03-28T10:15:00Z',
  },
  {
    // El caso simétrico: cobrado por adelantado, así que el saldo vive en el
    // pasivo y cada mes se abona el ingreso contra él.
    id: 'dif-0003',
    codigo: 'DIF-0003',
    tipo: 'ingreso',
    descripcion: 'Mantenimiento anual de plataforma cobrado por adelantado',
    tercero: {
      tipo: 'cliente',
      id: 'cli-003',
      nombre: 'Servicios Médicos Escazú S.A.',
    },
    monto: '3600000.00',
    moneda: 'CRC',
    cuentaDiferido: '2.1.04.001',
    cuentaDestino: '4.1.01.001',
    fechaInicio: '2026-01-01',
    plazoMeses: 12,
    cuotaMensual: '300000.00',
    montoAmortizado: '2100000.00',
    saldoPorAmortizar: '1500000.00',
    estado: 'vigente',
    cancelacion: null,
    origen: null,
    amortizaciones: amortizadas(1, 7, '300000.00'),
    creadoEn: '2026-01-08T14:30:00Z',
  },
]

const tablaDiferidos = tabla<Diferido>(
  'diferidos.diferidos',
  segunEmpresa({
    [EMPRESA_PRINCIPAL]: construirDiferidos,
  }),
)

export const diferidosMock: Diferido[] = tablaDiferidos.filas

export function persistirDiferidos(): void {
  tablaDiferidos.persistir()
}

/** Consecutivo a partir del mayor emitido, no del tamaño: la tabla persiste. */
export function siguienteCodigoDiferido(): string {
  const mayor = diferidosMock.reduce((acc, d) => {
    const numero = Number(d.codigo.replace(/\D/g, ''))
    return Number.isNaN(numero) ? acc : Math.max(acc, numero)
  }, 0)
  return `DIF-${String(mayor + 1).padStart(4, '0')}`
}
