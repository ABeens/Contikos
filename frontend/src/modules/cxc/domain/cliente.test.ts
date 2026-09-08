import { describe, expect, it } from 'vitest'
import type { ClienteBase, SolicitudCliente } from '@/shared/api/contracts/cxc'
import { listoParaFe, validarCliente } from './cliente'

/**
 * El maestro de clientes guarda lo que el comprobante electrónico pedirá del
 * receptor (docs/13 §4). Lo que se prueba es que lo opcional siga siendo
 * opcional, que lo capturado tenga la forma del XML y que la marca "listo
 * para FE" diga la verdad.
 */

const BASE: SolicitudCliente = {
  codigo: 'C-900',
  razonSocial: 'Cliente de prueba S.A.',
  nombreComercial: null,
  tipoIdentificacion: 'JURIDICA',
  identificacion: '3101000001',
  correo: 'pagos@prueba.cr',
  diasCredito: 30,
  limiteCredito: '0',
  moneda: 'CRC',
  cuentaIngreso: null,
  activo: true,
  telefono: { codigoPais: '506', numero: '22223333' },
  ubicacion: {
    provincia: '1',
    canton: '02',
    distrito: '01',
    barrio: null,
    otrasSenas: '200 m norte de la iglesia',
  },
  actividadEconomica: '620100',
  condicionVenta: '02',
  medioPago: '04',
}

const EXISTENTE: ClienteBase = {
  id: 'cli-001',
  ...BASE,
  codigo: 'C-001',
  identificacion: '3101456789',
}

const ctx = { clientes: [EXISTENTE] }

const codigos = (r: { errores: readonly { codigo: string }[] }) =>
  r.errores.map((e) => e.codigo)

describe('Alta de cliente', () => {
  it('acepta un cliente completo', () => {
    expect(validarCliente(BASE, ctx).valido).toBe(true)
  })

  it('acepta un cliente sin datos de facturación electrónica', () => {
    const r = validarCliente(
      {
        ...BASE,
        correo: null,
        telefono: null,
        ubicacion: null,
        actividadEconomica: null,
        condicionVenta: null,
        medioPago: null,
      },
      ctx,
    )
    expect(r.valido).toBe(true)
  })

  it('rechaza código e identificación repetidos', () => {
    const r = validarCliente(
      { ...BASE, codigo: 'c-001', identificacion: '3-101-456789' },
      ctx,
    )
    expect(codigos(r)).toEqual(
      expect.arrayContaining(['CODIGO_DUPLICADO', 'IDENTIFICACION_DUPLICADA']),
    )
  })

  it('al editar no se acusa a sí mismo de duplicado', () => {
    const r = validarCliente(
      { ...BASE, codigo: 'C-001', identificacion: '3101456789' },
      { clientes: [EXISTENTE], cliente: EXISTENTE },
    )
    expect(r.valido).toBe(true)
  })

  it('valida la cédula según su tipo', () => {
    const r = validarCliente({ ...BASE, identificacion: '12' }, ctx)
    expect(codigos(r)).toContain('IDENTIFICACION_INVALIDA')
  })

  it('exige forma de correo y de teléfono cuando se capturan', () => {
    const r = validarCliente(
      {
        ...BASE,
        correo: 'no-es-correo',
        telefono: { codigoPais: '506', numero: '123' },
      },
      ctx,
    )
    expect(codigos(r)).toEqual(
      expect.arrayContaining(['CORREO_INVALIDO', 'TELEFONO_INVALIDO']),
    )
  })

  it('la ubicación tiene que existir en el catálogo y traer otras señas', () => {
    expect(
      codigos(
        validarCliente(
          { ...BASE, ubicacion: { ...BASE.ubicacion!, distrito: '99' } },
          ctx,
        ),
      ),
    ).toContain('UBICACION_INVALIDA')
    expect(
      codigos(
        validarCliente(
          { ...BASE, ubicacion: { ...BASE.ubicacion!, otrasSenas: ' ' } },
          ctx,
        ),
      ),
    ).toContain('UBICACION_INVALIDA')
  })

  it('la actividad económica es un CIIU de 6 dígitos', () => {
    expect(
      codigos(validarCliente({ ...BASE, actividadEconomica: '6201' }, ctx)),
    ).toContain('ACTIVIDAD_INVALIDA')
  })

  it('no admite crédito negativo ni moneda desconocida', () => {
    const r = validarCliente(
      { ...BASE, diasCredito: -1, limiteCredito: '-5', moneda: 'XXX' },
      ctx,
    )
    expect(codigos(r)).toEqual(
      expect.arrayContaining(['CREDITO_INVALIDO', 'MONEDA_INVALIDA']),
    )
  })
})

describe('Listo para facturación electrónica', () => {
  it('lo está con correo, teléfono, ubicación y actividad', () => {
    expect(listoParaFe(BASE)).toBe(true)
  })

  it('le falta algo y deja de estarlo', () => {
    expect(listoParaFe({ ...BASE, correo: null })).toBe(false)
    expect(listoParaFe({ ...BASE, telefono: null })).toBe(false)
    expect(listoParaFe({ ...BASE, ubicacion: null })).toBe(false)
    expect(listoParaFe({ ...BASE, actividadEconomica: null })).toBe(false)
  })
})
