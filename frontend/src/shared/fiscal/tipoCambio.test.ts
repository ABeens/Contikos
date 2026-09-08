import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import type { TipoCambio } from '@/shared/api/contracts/config'
import {
  armarTabla,
  convertirAFuncional,
  tipoCambioContraFuncional,
  tipoCambioVigente,
  valorTipoCambio,
  type RespuestaDolar,
  type RespuestaEuro,
} from './tipoCambio'

/**
 * Respuestas reales del 27 de agosto de 2026.
 *
 * Con la relación que sostiene todo lo del euro: 452,88 × 1,1653 = 527,74.
 */
const DOLAR: RespuestaDolar = {
  compra: { fecha: '2026-08-27', valor: 448.38 },
  venta: { fecha: '2026-08-27', valor: 452.88 },
}

const EURO: RespuestaEuro = {
  fecha: '2026-08-27',
  dolares: 1.1653,
  colones: 527.74,
}

const TABLA = armarTabla(DOLAR, EURO)

const fila = (codigo: string) => TABLA.monedas.find((m) => m.moneda === codigo)

describe('Tabla del día', () => {
  it('se fecha con la publicación del dólar y se expresa en colones', () => {
    expect(TABLA.fecha).toBe('2026-08-27')
    expect(TABLA.base).toBe('CRC')
  })

  it('toma la compra y la venta del dólar tal como se publican', () => {
    expect(fila('USD')).toMatchObject({
      compra: '448.38',
      venta: '452.88',
      origen: 'publicado',
    })
  })

  it('deja la venta del euro en el valor publicado en colones', () => {
    expect(fila('EUR')?.venta).toBe('527.74')
  })

  it('deriva la compra del euro de la compra del dólar por la paridad', () => {
    // 448,38 × 1,1653 = 522,4972…
    expect(fila('EUR')?.compra).toBe('522.50')
  })

  it('marca el euro como derivado y dice por qué', () => {
    expect(fila('EUR')?.origen).toBe('derivado')
    expect(fila('EUR')?.nota).toContain('1.1653')
  })

  it('el valor publicado del euro es la venta del dólar por la paridad', () => {
    // Es la comprobación de la que cuelga la derivación de la compra: si la
    // fuente cambiara de método, esta prueba lo dice antes que un descuadre.
    const reconstruido = new Decimal(DOLAR.venta.valor)
      .times(EURO.dolares)
      .toFixed(2)
    expect(reconstruido).toBe(fila('EUR')?.venta)
  })

  it('no deriva el euro cuando su paridad es de otro día', () => {
    const tabla = armarTabla(DOLAR, { ...EURO, fecha: '2026-08-26' })
    const euro = tabla.monedas.find((m) => m.moneda === 'EUR')
    expect(euro?.compra).toBe('527.74')
    expect(euro?.venta).toBe('527.74')
    expect(euro?.nota).toContain('2026-08-26')
  })
})

describe('Tipo de cambio contra la moneda funcional', () => {
  it('con el colón de funcional usa los valores publicados sin tocarlos', () => {
    expect(tipoCambioContraFuncional(TABLA, 'CRC', 'USD')).toMatchObject({
      compra: '448.38',
      venta: '452.88',
      origen: 'publicado',
    })
  })

  it('la propia funcional se cambia a la par', () => {
    expect(tipoCambioContraFuncional(TABLA, 'CRC', 'CRC')?.venta).toBe('1')
  })

  it('cruza contra el colón cuando la funcional es otra', () => {
    const colon = tipoCambioContraFuncional(TABLA, 'USD', 'CRC')
    expect(colon).toMatchObject({ venta: '0.002208', origen: 'derivado' })

    const euro = tipoCambioContraFuncional(TABLA, 'USD', 'EUR')
    expect(euro?.venta).toBe('1.165298')
  })

  it('el cruce conserva decimales suficientes para no anular el importe', () => {
    // Con dos decimales, el colón contra el dólar sería cero y todo importe
    // convertido se perdería.
    const colon = tipoCambioContraFuncional(TABLA, 'USD', 'CRC')
    expect(new Decimal(colon?.venta ?? 0).isZero()).toBe(false)
  })

  it('no inventa un tipo de cambio para una moneda que la fuente no publica', () => {
    expect(tipoCambioContraFuncional(TABLA, 'CRC', 'GBP')).toBeNull()
    expect(tipoCambioContraFuncional(TABLA, 'GBP', 'USD')).toBeNull()
  })
})

/* --------------------- La serie con fecha (docs/13 §7, docs/10 §2) */

/**
 * Una semana con hueco: el sábado y el domingo no se publican, que es el caso
 * que la regla del último valor anterior existe para resolver.
 */
const SERIE: TipoCambio[] = [
  {
    moneda: 'USD',
    fecha: '2026-08-27',
    compra: '505.00',
    venta: '512.00',
    origen: 'publicado',
    fuente: 'Banco Central de Costa Rica',
  },
  {
    moneda: 'USD',
    fecha: '2026-08-28',
    compra: '506.50',
    venta: '513.50',
    origen: 'publicado',
    fuente: 'Banco Central de Costa Rica',
  },
  {
    moneda: 'USD',
    fecha: '2026-08-31',
    compra: '508.00',
    venta: '515.00',
    origen: 'publicado',
    fuente: 'Banco Central de Costa Rica',
  },
  {
    moneda: 'EUR',
    fecha: '2026-08-28',
    compra: '547.02',
    venta: '554.58',
    origen: 'derivado',
    fuente: 'Plantilla de demostración',
  },
]

describe('Tipo de cambio vigente en una fecha', () => {
  it('toma el del día cuando la fuente publicó ese día', () => {
    expect(tipoCambioVigente(SERIE, 'USD', '2026-08-28')).toMatchObject({
      fecha: '2026-08-28',
      compra: '506.50',
    })
  })

  it('toma el último anterior un domingo o un feriado', () => {
    // El 29 y el 30 son fin de semana: lo que rige es el viernes 28.
    expect(tipoCambioVigente(SERIE, 'USD', '2026-08-30')?.fecha).toBe(
      '2026-08-28',
    )
  })

  it('no mira hacia adelante: una fecha sin serie usa el último publicado', () => {
    expect(tipoCambioVigente(SERIE, 'USD', '2026-12-31')?.fecha).toBe(
      '2026-08-31',
    )
  })

  it('devuelve undefined cuando no hay ningún valor anterior', () => {
    // Preferimos no ofrecer un tipo de cambio a ofrecer uno que nadie publicó.
    expect(tipoCambioVigente(SERIE, 'USD', '2026-08-26')).toBeUndefined()
  })

  it('no cruza monedas: cada serie es la suya', () => {
    expect(tipoCambioVigente(SERIE, 'EUR', '2026-08-31')?.compra).toBe('547.02')
    expect(tipoCambioVigente(SERIE, 'GBP', '2026-08-31')).toBeUndefined()
  })

  it('con la serie vacía no hay nada vigente', () => {
    expect(tipoCambioVigente([], 'USD', '2026-08-31')).toBeUndefined()
  })
})

describe('Conversión contra la moneda funcional', () => {
  const DIA = tipoCambioVigente(SERIE, 'USD', '2026-08-28')!

  it('elige el lado que se le pide', () => {
    expect(valorTipoCambio(DIA, 'compra')).toBe('506.50')
    expect(valorTipoCambio(DIA, 'venta')).toBe('513.50')
  })

  it('multiplica el importe por el tipo del lado indicado', () => {
    expect(convertirAFuncional('100.00', DIA, 'venta', 'CRC').toApi()).toBe(
      '51350.00',
    )
    expect(convertirAFuncional('100.00', DIA, 'compra', 'CRC').toApi()).toBe(
      '50650.00',
    )
  })

  it('redondea a los decimales de la moneda funcional, y solo al final', () => {
    // 12,34 × 506,50 = 6.250,21 exactos hasta el céntimo del colón.
    expect(convertirAFuncional('12.34', DIA, 'compra', 'CRC').toApi()).toBe(
      '6250.21',
    )
  })
})
