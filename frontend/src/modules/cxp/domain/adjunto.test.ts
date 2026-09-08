import { describe, expect, it } from 'vitest'
import {
  TAMANO_MAXIMO_ADJUNTO,
  tamanoDecodificado,
  tamanoLegible,
  validarAdjunto,
} from './adjunto'

const PDF = {
  nombre: 'factura-4521.pdf',
  tipoMime: 'application/pdf',
  tamano: 12_345,
  descripcion: null,
}

describe('Adjuntos de la factura de gasto', () => {
  it('acepta un PDF y una imagen de tamaño razonable', () => {
    expect(validarAdjunto(PDF).valido).toBe(true)
    expect(
      validarAdjunto({ ...PDF, nombre: 'tiquete.jpg', tipoMime: 'image/jpeg' })
        .valido,
    ).toBe(true)
  })

  it('rechaza formatos que no son PDF ni imagen', () => {
    const r = validarAdjunto({
      ...PDF,
      nombre: 'macro.xlsm',
      tipoMime: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    })
    expect(r.valido).toBe(false)
    expect(r.errores[0].codigo).toBe('ADJUNTO_INVALIDO')
    expect(r.errores[0].mensaje).toMatch(/solo se admiten PDF/)
  })

  it('rechaza el archivo vacío y el que pasa de 5 MB', () => {
    expect(validarAdjunto({ ...PDF, tamano: 0 }).valido).toBe(false)
    expect(
      validarAdjunto({ ...PDF, tamano: TAMANO_MAXIMO_ADJUNTO + 1 }).valido,
    ).toBe(false)
    expect(validarAdjunto({ ...PDF, tamano: TAMANO_MAXIMO_ADJUNTO }).valido).toBe(
      true,
    )
  })

  it('exige base64 bien formado cuando viene el contenido', () => {
    expect(validarAdjunto({ ...PDF, contenidoBase64: 'JVBERi0xLjQK' }).valido).toBe(
      true,
    )
    expect(validarAdjunto({ ...PDF, contenidoBase64: '%%no-base64%%' }).valido).toBe(
      false,
    )
    expect(validarAdjunto({ ...PDF, contenidoBase64: '' }).valido).toBe(false)
  })

  it('mide el contenido decodificado, no el tamaño declarado', () => {
    // "hola" son 4 bytes: aG9sYQ==
    expect(tamanoDecodificado('aG9sYQ==')).toBe(4)
    expect(tamanoDecodificado('')).toBe(0)
  })

  it('presenta el tamaño en unidades legibles', () => {
    expect(tamanoLegible(512)).toBe('512 B')
    expect(tamanoLegible(2048)).toBe('2 KB')
    expect(tamanoLegible(1_258_291)).toBe('1,2 MB')
  })
})
