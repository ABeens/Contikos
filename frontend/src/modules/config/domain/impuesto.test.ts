import { describe, expect, it } from 'vitest'
import type {
  SolicitudTarifaImpuesto,
  TarifaImpuesto,
} from '@/shared/api/contracts/impuestos'
import {
  documentosQueUsan,
  validarEliminacionTarifa,
  validarTarifaImpuesto,
  vigenciasSeSolapan,
} from './impuesto'

const GENERAL: TarifaImpuesto = {
  id: 'imp-general-2019',
  codigo: 'GENERAL',
  nombre: 'General 13%',
  tipo: 'iva',
  porcentaje: '13',
  vigenteDesde: '2019-07-01',
  vigenteHasta: null,
  activa: true,
  codigoHacienda: '08',
  generaImpuesto: true,
}

const REDUCIDA: TarifaImpuesto = {
  ...GENERAL,
  id: 'imp-reducida-4-2019',
  codigo: 'REDUCIDA_4',
  nombre: 'Reducida 4%',
  porcentaje: '4',
  codigoHacienda: '04',
}

const TABLA = [GENERAL, REDUCIDA]

const NUEVA: SolicitudTarifaImpuesto = {
  codigo: 'REDUCIDA_8',
  nombre: 'Transitoria 8%',
  tipo: 'iva',
  porcentaje: '8',
  vigenteDesde: '2026-01-01',
  vigenteHasta: '2026-12-31',
  activa: true,
  codigoHacienda: null,
  generaImpuesto: true,
}

const codigos = (r: { errores: readonly { codigo: string }[] }) =>
  r.errores.map((e) => e.codigo)

describe('Alta y edición de tarifa', () => {
  it('acepta una tarifa nueva con vigencia acotada', () => {
    expect(validarTarifaImpuesto(NUEVA, { tarifas: TABLA }).valido).toBe(true)
  })

  it('exige código con forma de catálogo y nombre', () => {
    expect(
      codigos(validarTarifaImpuesto({ ...NUEVA, codigo: '  ', nombre: '' }, { tarifas: TABLA })),
    ).toEqual(expect.arrayContaining(['CODIGO_REQUERIDO', 'NOMBRE_REQUERIDO']))
    expect(
      codigos(validarTarifaImpuesto({ ...NUEVA, codigo: '8%' }, { tarifas: TABLA })),
    ).toContain('CODIGO_INVALIDO')
  })

  it('el porcentaje va de 0 a 100', () => {
    for (const porcentaje of ['-1', '101', 'abc']) {
      expect(
        codigos(validarTarifaImpuesto({ ...NUEVA, porcentaje }, { tarifas: TABLA })),
      ).toContain('PORCENTAJE_INVALIDO')
    }
    expect(
      validarTarifaImpuesto({ ...NUEVA, porcentaje: '0' }, { tarifas: TABLA }).valido,
    ).toBe(true)
  })

  it('el fin de vigencia no puede ir antes del inicio', () => {
    expect(
      codigos(
        validarTarifaImpuesto(
          { ...NUEVA, vigenteDesde: '2026-06-01', vigenteHasta: '2026-01-01' },
          { tarifas: TABLA },
        ),
      ),
    ).toContain('VIGENCIA_INVALIDA')
  })

  it('no deja dos vigencias del mismo código que se crucen', () => {
    // La general sigue vigente sin fin: abrir otra GENERAL desde 2027 la pisa.
    const r = validarTarifaImpuesto(
      { ...NUEVA, codigo: 'GENERAL', vigenteDesde: '2027-01-01', vigenteHasta: null },
      { tarifas: TABLA },
    )
    expect(codigos(r)).toContain('VIGENCIA_SOLAPADA')
  })

  it('sí deja abrir la nueva vigencia cuando la anterior se cerró', () => {
    const cerrada = { ...GENERAL, vigenteHasta: '2026-12-31' }
    const r = validarTarifaImpuesto(
      { ...NUEVA, codigo: 'GENERAL', vigenteDesde: '2027-01-01', vigenteHasta: null },
      { tarifas: [cerrada, REDUCIDA] },
    )
    expect(r.valido).toBe(true)
  })

  it('al editar no se acusa a sí misma de solapada', () => {
    const r = validarTarifaImpuesto(
      { ...GENERAL, nombre: 'General 13% (renombrada)' },
      { tarifas: TABLA, tarifa: GENERAL },
    )
    expect(r.valido).toBe(true)
  })

  it('el código se normaliza: minúsculas y espacios no crean otra tarifa', () => {
    const r = validarTarifaImpuesto(
      { ...NUEVA, codigo: 'general', vigenteDesde: '2027-01-01', vigenteHasta: null },
      { tarifas: TABLA },
    )
    expect(codigos(r)).toContain('VIGENCIA_SOLAPADA')
  })

  it('las vigencias se cruzan cuando comparten al menos un día', () => {
    expect(
      vigenciasSeSolapan(
        { vigenteDesde: '2026-01-01', vigenteHasta: '2026-06-30' },
        { vigenteDesde: '2026-06-30', vigenteHasta: null },
      ),
    ).toBe(true)
    expect(
      vigenciasSeSolapan(
        { vigenteDesde: '2026-01-01', vigenteHasta: '2026-06-30' },
        { vigenteDesde: '2026-07-01', vigenteHasta: null },
      ),
    ).toBe(false)
  })
})

describe('Eliminación', () => {
  const FACTURAS = [
    { fechaEmision: '2026-08-05', lineas: [{ tarifa: 'GENERAL' }] },
    { fechaEmision: '2026-06-20', lineas: [{ tarifa: 'REDUCIDA_4' }] },
  ]

  it('cuenta los documentos emitidos dentro de la vigencia que citan el código', () => {
    expect(documentosQueUsan(GENERAL, FACTURAS)).toBe(1)
    // Una vigencia que empezó después de la factura no la calculó.
    expect(
      documentosQueUsan({ ...GENERAL, vigenteDesde: '2027-01-01' }, FACTURAS),
    ).toBe(0)
  })

  it('no elimina una tarifa con facturas', () => {
    const r = validarEliminacionTarifa('imp-general-2019', {
      tarifas: TABLA,
      documentos: FACTURAS,
    })
    expect(codigos(r)).toContain('TARIFA_EN_USO')
  })

  it('elimina una tarifa sin uso y rechaza una que no existe', () => {
    expect(
      validarEliminacionTarifa('imp-general-2019', { tarifas: TABLA, documentos: [] })
        .valido,
    ).toBe(true)
    expect(
      codigos(validarEliminacionTarifa('imp-nada', { tarifas: TABLA, documentos: [] })),
    ).toContain('TARIFA_NO_ENCONTRADA')
  })
})
