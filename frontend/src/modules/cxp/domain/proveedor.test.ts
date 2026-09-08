import { describe, expect, it } from 'vitest'
import type {
  ProveedorBase,
  SolicitudProveedor,
} from '@/shared/api/contracts/cxp'
import { validarProveedor } from './proveedor'

const BASE: SolicitudProveedor = {
  codigo: 'P-900',
  razonSocial: 'Proveedor de prueba S.A.',
  nombreComercial: null,
  tipoIdentificacion: 'JURIDICA',
  identificacion: '3101000002',
  correo: 'ventas@prueba.cr',
  telefono: { codigoPais: '506', numero: '22224444' },
  actividadEconomica: '461000',
  diasCredito: 30,
  moneda: 'CRC',
  cuentaGasto: null,
  retencionRenta: '2',
  activo: true,
}

const EXISTENTE: ProveedorBase = {
  id: 'pro-014',
  ...BASE,
  codigo: 'P-014',
  identificacion: '3101334455',
}

const ctx = { proveedores: [EXISTENTE] }

const codigos = (r: { errores: readonly { codigo: string }[] }) =>
  r.errores.map((e) => e.codigo)

describe('Alta de proveedor', () => {
  it('acepta un proveedor completo y uno sin datos de contacto', () => {
    expect(validarProveedor(BASE, ctx).valido).toBe(true)
    expect(
      validarProveedor(
        { ...BASE, correo: null, telefono: null, actividadEconomica: null },
        ctx,
      ).valido,
    ).toBe(true)
  })

  it('rechaza código e identificación repetidos', () => {
    const r = validarProveedor(
      { ...BASE, codigo: 'p-014', identificacion: '3101334455' },
      ctx,
    )
    expect(codigos(r)).toEqual(
      expect.arrayContaining(['CODIGO_DUPLICADO', 'IDENTIFICACION_DUPLICADA']),
    )
  })

  it('al editar no se acusa a sí mismo de duplicado', () => {
    expect(
      validarProveedor(
        { ...BASE, codigo: 'P-014', identificacion: '3101334455' },
        { proveedores: [EXISTENTE], proveedor: EXISTENTE },
      ).valido,
    ).toBe(true)
  })

  it('valida contacto y actividad cuando se capturan', () => {
    const r = validarProveedor(
      {
        ...BASE,
        correo: 'sin-arroba',
        telefono: { codigoPais: '', numero: '1' },
        actividadEconomica: 'ABC',
      },
      ctx,
    )
    expect(codigos(r)).toEqual(
      expect.arrayContaining([
        'CORREO_INVALIDO',
        'TELEFONO_INVALIDO',
        'ACTIVIDAD_INVALIDA',
      ]),
    )
  })

  it('la retención es un porcentaje entre 0 y 100', () => {
    expect(
      codigos(validarProveedor({ ...BASE, retencionRenta: '150' }, ctx)),
    ).toContain('RETENCION_INVALIDA')
    expect(
      codigos(validarProveedor({ ...BASE, retencionRenta: 'x' }, ctx)),
    ).toContain('RETENCION_INVALIDA')
  })
})
