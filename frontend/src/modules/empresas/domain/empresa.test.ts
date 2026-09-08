import { describe, expect, it } from 'vitest'
import type { Empresa, SolicitudEmpresa } from '@/shared/api/contracts/empresas'
import {
  empresasAbribles,
  normalizarSolicitud,
  validarEmpresa,
} from './empresa'

const EMPRESAS: Empresa[] = [
  {
    id: 'emp-001',
    codigo: 'SCK',
    nombre: 'Soluciones Contikos S.A.',
    nombreComercial: null,
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101987654',
    pais: 'CR',
    ejercicioInicioMes: 1,
    activa: true,
  },
  {
    id: 'emp-002',
    codigo: 'DCP',
    nombre: 'Distribuidora Contikos del Pacífico S.A.',
    nombreComercial: null,
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101765432',
    pais: 'CR',
    ejercicioInicioMes: 1,
    activa: false,
  },
]

const CONTEXTO = { empresas: EMPRESAS, empresaAbierta: 'emp-001' }

const VALIDA: SolicitudEmpresa = {
  codigo: 'NUE',
  nombre: 'Nueva Empresa S.A.',
  nombreComercial: null,
  tipoIdentificacion: 'JURIDICA',
  identificacion: '3101111222',
  pais: 'CR',
  ejercicioInicioMes: 1,
  activa: true,
}

const codigos = (s: SolicitudEmpresa, id?: string) =>
  validarEmpresa(s, CONTEXTO, id).errores.map((e) => e.codigo)

describe('validarEmpresa', () => {
  it('acepta un alta completa', () => {
    expect(validarEmpresa(VALIDA, CONTEXTO).valido).toBe(true)
  })

  it('exige siglas y razón social', () => {
    expect(codigos({ ...VALIDA, codigo: '  ', nombre: '' })).toEqual([
      'CODIGO_REQUERIDO',
      'NOMBRE_REQUERIDO',
    ])
  })

  it('no admite dos empresas con las mismas siglas, sin distinguir mayúsculas', () => {
    expect(codigos({ ...VALIDA, codigo: 'sck' })).toEqual(['CODIGO_DUPLICADO'])
  })

  it('valida la identificación con las reglas del país', () => {
    // Una cédula jurídica empieza por 2, 3, 4 o 5 (docs/13 §2).
    expect(codigos({ ...VALIDA, identificacion: '1101111222' })).toEqual([
      'IDENTIFICACION_INVALIDA',
    ])
  })

  it('la cédula es única en el grupo aunque venga con separadores', () => {
    expect(codigos({ ...VALIDA, identificacion: '3-101-987654' })).toEqual([
      'IDENTIFICACION_DUPLICADA',
    ])
  })

  it('al editar, la propia empresa no cuenta como duplicado', () => {
    const misma = { ...VALIDA, codigo: 'SCK', identificacion: '3101987654' }
    expect(validarEmpresa(misma, CONTEXTO, 'emp-001').valido).toBe(true)
  })

  it('rechaza editar una empresa que no existe', () => {
    expect(codigos(VALIDA, 'emp-999')).toEqual(['EMPRESA_NO_ENCONTRADA'])
  })

  it('el ejercicio empieza en un mes entre 1 y 12', () => {
    expect(codigos({ ...VALIDA, ejercicioInicioMes: 13 })).toEqual([
      'EJERCICIO_INVALIDO',
    ])
  })

  it('no deja desactivar la empresa abierta', () => {
    const cerrada = { ...VALIDA, codigo: 'SCK', identificacion: '3101987654', activa: false }
    expect(codigos(cerrada, 'emp-001')).toEqual(['EMPRESA_ABIERTA_INACTIVA'])
    // Otra empresa sí se puede desactivar.
    const otra = { ...VALIDA, codigo: 'DCP', identificacion: '3101765432', activa: false }
    expect(validarEmpresa(otra, CONTEXTO, 'emp-002').valido).toBe(true)
  })
})

describe('normalizarSolicitud', () => {
  it('deja las siglas en mayúsculas y la cédula sin separadores', () => {
    const n = normalizarSolicitud({
      ...VALIDA,
      codigo: ' nue ',
      nombreComercial: '  ',
      identificacion: '3-101-111222',
    })
    expect(n.codigo).toBe('NUE')
    expect(n.identificacion).toBe('3101111222')
    expect(n.nombreComercial).toBeNull()
  })
})

describe('empresasAbribles', () => {
  it('ofrece las activas y siempre la abierta', () => {
    expect(empresasAbribles(EMPRESAS, 'emp-001').map((e) => e.id)).toEqual([
      'emp-001',
    ])
    // Si la abierta quedó inactiva desde otra sesión, se sigue viendo hasta
    // que se salga de ella.
    expect(empresasAbribles(EMPRESAS, 'emp-002').map((e) => e.id)).toEqual([
      'emp-001',
      'emp-002',
    ])
  })
})
