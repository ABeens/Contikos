import type {
  CargaSocial,
  Empleado,
  MapeoRh,
  ParametrosPlanilla,
  Planilla,
} from '@/shared/api/contracts/rh'
import { tabla } from '@/shared/almacen/almacen'
import { EMPRESA_PRINCIPAL, segunEmpresa } from './empresas'

/**
 * Recursos humanos de la demostración.
 *
 * Los parámetros de 2026 son los de docs/13 §6, verificados en setiembre de
 * 2026 contra fuentes secundarias. Son un dato, no código: la pantalla de
 * parámetros los enseña con su fuente y deja registrar una vigencia nueva
 * cuando cambie la ley (D-06).
 */

const cargaT = (codigo: string, nombre: string, tasa: string, base: CargaSocial['base']): CargaSocial => ({
  codigo,
  nombre,
  tasa,
  paga: 'trabajador',
  base,
  exentaPymeMenosDe5: false,
})

const cargaP = (
  codigo: string,
  nombre: string,
  tasa: string,
  base: CargaSocial['base'] = 'salario',
  exentaPymeMenosDe5 = false,
): CargaSocial => ({ codigo, nombre, tasa, paga: 'patrono', base, exentaPymeMenosDe5 })

/** Vigentes desde el 1 de enero de 2026 (docs/13 §6.1 y §6.2). */
export const PARAMETROS_2026: ParametrosPlanilla = {
  id: 'par-2026-01',
  vigenteDesde: '2026-01-01',
  fuente:
    'CCSS: aumento del IVM del Transitorio XI, vigente hasta 2028. Decreto 45303-MTSS (base mínima). Decreto 45333-H (tramos y créditos). Ver docs/13 §6.',
  cargas: [
    cargaT('SEM-T', 'Seguro de Enfermedad y Maternidad', '5.50', 'sem'),
    cargaT('IVM-T', 'Invalidez, Vejez y Muerte', '4.33', 'ivm'),
    cargaT('BP-T', 'Banco Popular', '1.00', 'salario'),
    cargaP('SEM-P', 'Seguro de Enfermedad y Maternidad', '9.25', 'sem'),
    cargaP('IVM-P', 'Invalidez, Vejez y Muerte', '5.58', 'ivm'),
    cargaP('FODESAF', 'Asignaciones Familiares (FODESAF)', '5.00'),
    cargaP('IMAS', 'IMAS', '0.50'),
    cargaP('INA', 'INA', '1.50', 'salario', true),
    cargaP('BP-P', 'Banco Popular, cuota patronal', '0.25'),
    cargaP('BP-LPT', 'Banco Popular, Ley de Protección al Trabajador', '0.25'),
    cargaP('FCL', 'Fondo de Capitalización Laboral', '1.50'),
    cargaP('ROP', 'Operadora de Pensiones Complementarias', '2.00'),
    // ⚠️ Pendiente de confirmar contra una factura de la CCSS (docs/13 §6.4).
    cargaP('INS', 'Instituto Nacional de Seguros', '1.00'),
  ],
  baseMinimaSem: '333328.00',
  baseMinimaIvm: '311990.00',
  tramosRenta: [
    { desde: '0.00', hasta: '918000.00', tasa: '0' },
    { desde: '918000.00', hasta: '1347000.00', tasa: '10' },
    { desde: '1347000.00', hasta: '2364000.00', tasa: '15' },
    { desde: '2364000.00', hasta: '4727000.00', tasa: '20' },
    { desde: '4727000.00', hasta: null, tasa: '25' },
  ],
  creditoHijo: '1710.00',
  creditoConyuge: '2590.00',
  provisionAguinaldo: '8.33',
  provisionVacaciones: '4.17',
  provisionCesantia: '5.33',
  recargoHoraExtra: '50',
  horasMes: '240',
}

const EMPLEADOS_SEED = (): Empleado[] => [
  empleado('emp-rh-001', 'E-001', 'María Fernanda Rojas Solís', '109870654', 'Contadora general', '2021-03-01', '1850000.00', 1, true),
  empleado('emp-rh-002', 'E-002', 'José Pablo Vargas Mora', '205430987', 'Asistente contable', '2023-07-17', '780000.00', 0, false),
  empleado('emp-rh-003', 'E-003', 'Daniela Chaves Jiménez', '304560123', 'Ejecutiva de ventas', '2022-01-10', '1100000.00', 2, false),
  empleado('emp-rh-004', 'E-004', 'Luis Diego Araya Quesada', '112340567', 'Mensajero', '2024-02-05', '420000.00', 0, false),
  empleado('emp-rh-005', 'E-005', 'Andrea Campos Ulate', '401230456', 'Gerente general', '2019-09-02', '3600000.00', 2, true),
]

function empleado(
  id: string,
  codigo: string,
  nombre: string,
  cedula: string,
  puesto: string,
  fechaIngreso: string,
  salarioBase: string,
  hijos: number,
  creditoConyuge: boolean,
): Empleado {
  return {
    id,
    codigo,
    nombre,
    tipoIdentificacion: 'FISICA',
    identificacion: cedula,
    numeroAsegurado: cedula,
    puesto,
    fechaIngreso,
    fechaSalida: null,
    salarioBase,
    hijos,
    creditoConyuge,
    // Formato IBAN de Costa Rica: CR + 20 dígitos. De demostración.
    cuentaIban: `CR05015202001${cedula}`.slice(0, 22).padEnd(22, '0'),
    activo: true,
  }
}

/** Las cuentas del catálogo de plantilla que mueve la planilla. */
export const MAPEO_RH: MapeoRh = {
  gastoSalarios: '6.1.01.001',
  gastoCargasPatronales: '6.1.01.002',
  gastoAguinaldo: '6.1.01.003',
  gastoVacaciones: '6.1.01.004',
  gastoCesantia: '6.1.01.005',
  ccssPorPagar: '2.1.03.002',
  rentaPorPagar: '2.1.02.002',
  otrasDeduccionesPorPagar: '2.1.01.005',
  salariosPorPagar: '2.1.03.001',
  provisionAguinaldo: '2.1.03.010',
  provisionVacaciones: '2.1.03.011',
  provisionCesantia: '2.1.03.012',
}

const tablaParametros = tabla<ParametrosPlanilla>('rh.parametros', () => [
  structuredClone(PARAMETROS_2026),
])
// Los empleados son de la empresa de demostración; una empresa nueva nace sin.
const tablaEmpleados = tabla<Empleado>(
  'rh.empleados',
  segunEmpresa({ [EMPRESA_PRINCIPAL]: EMPLEADOS_SEED }),
)
const tablaPlanillas = tabla<Planilla>('rh.planillas', () => [])

export const parametrosPlanillaMock: ParametrosPlanilla[] = tablaParametros.filas
export const empleadosMock: Empleado[] = tablaEmpleados.filas
export const planillasMock: Planilla[] = tablaPlanillas.filas

export const persistirParametrosPlanilla = () => tablaParametros.persistir()
export const persistirEmpleados = () => tablaEmpleados.persistir()
export const persistirPlanillas = () => tablaPlanillas.persistir()
