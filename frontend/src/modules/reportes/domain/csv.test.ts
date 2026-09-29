import { describe, expect, it } from 'vitest'
import { aCsv, importeCsv, nombreArchivo } from './csv'

describe('Exportación CSV', () => {
  it('usa punto y coma y coma decimal, con BOM', () => {
    const texto = aCsv([
      ['Cuenta', 'Saldo'],
      ['Caja', importeCsv('-1250.50')],
    ])
    expect(texto.startsWith('﻿')).toBe(true)
    expect(texto.slice(1)).toBe('Cuenta;Saldo\r\nCaja;-1250,50')
  })

  it('entrecomilla lo que trae separadores o comillas', () => {
    expect(aCsv([['Uno; dos', 'Dice "hola"']]).slice(1)).toBe(
      '"Uno; dos";"Dice ""hola"""',
    )
  })

  it('arma un nombre de archivo sin acentos ni espacios', () => {
    expect(nombreArchivo(['Estado de Situación', 'Agosto 2026', 'fiscal'])).toBe(
      'estado-de-situacion-agosto-2026-fiscal.csv',
    )
  })
})
