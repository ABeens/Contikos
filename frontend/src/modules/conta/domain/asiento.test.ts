import { describe, expect, it } from 'vitest'
import type { SolicitudAsiento } from '@/shared/api/contracts/conta'
import { CUENTAS } from '@/mocks/seed/cuentas'
import { PERIODOS } from '@/mocks/seed/periodos'
import { ASIENTOS } from '@/mocks/seed/asientos'
import {
  construirReversa,
  ejercicioDeFecha,
  numeroDisponible,
  resumenDe,
  siguienteNumero,
  validarAsiento,
  validarReversa,
} from './asiento'

const contexto = { cuentas: CUENTAS, periodos: PERIODOS }

/** Fecha dentro de agosto 2026, que es un periodo abierto en la semilla. */
const FECHA_ABIERTA = '2026-08-10'
/** Julio 2026 está cerrado. */
const FECHA_CERRADA = '2026-07-10'

function asiento(parcial: Partial<SolicitudAsiento> = {}): SolicitudAsiento {
  return {
    fecha: FECHA_ABIERTA,
    concepto: 'Asiento de prueba',
    moneda: 'CRC',
    tipoCambio: '1',
    lineas: [
      { cuenta: '6.1.02.004', cargo: '10000.00', abono: '0' },
      { cuenta: '1.1.01.002', cargo: '0', abono: '10000.00' },
    ],
    ...parcial,
  }
}

const codigos = (r: ReturnType<typeof validarAsiento>) =>
  r.errores.map((e) => e.codigo)

/** Los totales del libro fiscal, que es el que mueve casi todo asiento. */
const libroFiscal = (r: ReturnType<typeof validarAsiento>) =>
  resumenDe(r.totales, 'fiscal')!

describe('validarAsiento: asiento correcto', () => {
  it('acepta un asiento cuadrado en periodo abierto', () => {
    const r = validarAsiento(asiento(), contexto)
    expect(r.valido).toBe(true)
    expect(r.errores).toHaveLength(0)
    expect(libroFiscal(r).totalCargos.toApi()).toBe('10000.00')
    expect(libroFiscal(r).totalAbonos.toApi()).toBe('10000.00')
    expect(libroFiscal(r).diferencia.esCero()).toBe(true)
  })
})

describe('validarAsiento: cuadre', () => {
  it('rechaza un asiento descuadrado', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          { cuenta: '6.1.02.004', cargo: '10000.00', abono: '0' },
          { cuenta: '1.1.01.002', cargo: '0', abono: '9999.99' },
        ],
      }),
      contexto,
    )
    expect(r.valido).toBe(false)
    expect(codigos(r)).toContain('ASIENTO_DESCUADRADO')
    expect(libroFiscal(r).diferencia.toApi()).toBe('0.01')
  })

  it('no aplica tolerancia: un céntimo descuadra', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          { cuenta: '6.1.02.004', cargo: '0.02', abono: '0' },
          { cuenta: '1.1.01.002', cargo: '0', abono: '0.01' },
        ],
      }),
      contexto,
    )
    expect(codigos(r)).toContain('ASIENTO_DESCUADRADO')
  })

  it('cuadra con importes que un float no representaría bien', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          { cuenta: '6.1.02.004', cargo: '0.1', abono: '0' },
          { cuenta: '6.1.02.002', cargo: '0.2', abono: '0' },
          { cuenta: '1.1.01.002', cargo: '0', abono: '0.3' },
        ],
      }),
      contexto,
    )
    expect(r.valido).toBe(true)
  })
})

describe('validarAsiento: estructura de línea', () => {
  it('exige al menos dos líneas', () => {
    const r = validarAsiento(
      asiento({ lineas: [{ cuenta: '6.1.02.004', cargo: '100', abono: '0' }] }),
      contexto,
    )
    expect(codigos(r)).toContain('ASIENTO_INSUFICIENTE')
  })

  it('rechaza una línea con cargo y abono a la vez', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          { cuenta: '6.1.02.004', cargo: '100', abono: '50' },
          { cuenta: '1.1.01.002', cargo: '0', abono: '50' },
        ],
      }),
      contexto,
    )
    expect(codigos(r)).toContain('LINEA_INVALIDA')
  })

  it('rechaza una línea sin cargo ni abono', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          { cuenta: '6.1.02.004', cargo: '0', abono: '0' },
          { cuenta: '1.1.01.002', cargo: '0', abono: '0' },
        ],
      }),
      contexto,
    )
    expect(codigos(r)).toContain('LINEA_INVALIDA')
  })

  it('rechaza importes negativos', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          { cuenta: '6.1.02.004', cargo: '-100', abono: '0' },
          { cuenta: '1.1.01.002', cargo: '0', abono: '-100' },
        ],
      }),
      contexto,
    )
    expect(codigos(r)).toContain('IMPORTE_NEGATIVO')
  })
})

describe('validarAsiento: cuentas', () => {
  it('rechaza una cuenta inexistente', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          { cuenta: '9.9.99.999', cargo: '100', abono: '0' },
          { cuenta: '1.1.01.002', cargo: '0', abono: '100' },
        ],
      }),
      contexto,
    )
    expect(codigos(r)).toContain('CUENTA_INVALIDA')
  })

  it('rechaza una cuenta acumulativa: solo las de detalle reciben movimientos', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          { cuenta: '6.1.02', cargo: '100', abono: '0' },
          { cuenta: '1.1.01.002', cargo: '0', abono: '100' },
        ],
      }),
      contexto,
    )
    expect(codigos(r)).toContain('CUENTA_INVALIDA')
  })

  it('rechaza una cuenta inactiva', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          { cuenta: '6.2.01.003', cargo: '100', abono: '0' },
          { cuenta: '1.1.01.002', cargo: '0', abono: '100' },
        ],
      }),
      contexto,
    )
    expect(codigos(r)).toContain('CUENTA_INVALIDA')
  })

  it('impide mover una cuenta de control desde un asiento manual', () => {
    const lineas = [
      { cuenta: '1.1.02.001', cargo: '100', abono: '0', auxiliarId: 'cli-001' },
      { cuenta: '4.1.01.001', cargo: '0', abono: '100' },
    ]
    const manual = validarAsiento(asiento({ lineas }), {
      ...contexto,
      esManual: true,
    })
    expect(codigos(manual)).toContain('CUENTA_CONTROL')

    // El mismo asiento SÍ es válido si viene del módulo dueño.
    const desdeModulo = validarAsiento(asiento({ lineas }), {
      ...contexto,
      esManual: false,
    })
    expect(desdeModulo.valido).toBe(true)
  })

  it('exige auxiliar cuando la cuenta lo requiere', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          { cuenta: '1.1.02.001', cargo: '100', abono: '0' },
          { cuenta: '4.1.01.001', cargo: '0', abono: '100' },
        ],
      }),
      { ...contexto, esManual: false },
    )
    expect(codigos(r)).toContain('AUXILIAR_REQUERIDO')
  })
})

describe('validarAsiento: periodo', () => {
  it('rechaza contabilizar en un periodo cerrado', () => {
    const r = validarAsiento(asiento({ fecha: FECHA_CERRADA }), contexto)
    expect(codigos(r)).toContain('PERIODO_CERRADO')
    expect(r.errores.find((e) => e.codigo === 'PERIODO_CERRADO')?.mensaje)
      .toContain('cerrado')
  })

  it('rechaza una fecha fuera de todo periodo definido', () => {
    const r = validarAsiento(asiento({ fecha: '2030-01-15' }), contexto)
    expect(codigos(r)).toContain('PERIODO_CERRADO')
  })

  it('rechaza un periodo bloqueado', () => {
    const r = validarAsiento(asiento({ fecha: '2026-02-10' }), contexto)
    expect(codigos(r)).toContain('PERIODO_CERRADO')
  })
})

describe('validarAsiento: otros', () => {
  it('rechaza tipo de cambio no positivo', () => {
    const r = validarAsiento(
      asiento({ moneda: 'USD', tipoCambio: '0' }),
      contexto,
    )
    expect(codigos(r)).toContain('TIPO_CAMBIO_INVALIDO')
  })

  it('exige concepto', () => {
    const r = validarAsiento(asiento({ concepto: '   ' }), contexto)
    expect(codigos(r)).toContain('CONCEPTO_REQUERIDO')
  })
})

describe('validarAsiento: libros', () => {
  it('sin indicar libros, el asiento entra en las dos contabilidades', () => {
    const r = validarAsiento(asiento(), contexto)
    expect(r.totales.map((t) => t.libro)).toEqual(['fiscal', 'corporativo'])
    expect(resumenDe(r.totales, 'corporativo')!.totalCargos.toApi()).toBe(
      '10000.00',
    )
  })

  it('rechaza una línea que no afecta a ningún libro', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          { cuenta: '6.1.02.004', cargo: '100', abono: '0', libros: [] },
          { cuenta: '1.1.01.002', cargo: '0', abono: '100' },
        ],
      }),
      contexto,
    )
    expect(codigos(r)).toContain('LIBRO_REQUERIDO')
  })

  it('acepta importes distintos por libro: cada uno cuadra por su cuenta', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          {
            cuenta: '6.1.02.004',
            cargo: '10000.00',
            abono: '0',
            libros: ['fiscal'],
          },
          {
            cuenta: '1.1.01.002',
            cargo: '0',
            abono: '10000.00',
            libros: ['fiscal'],
          },
          {
            cuenta: '6.1.02.004',
            cargo: '8000.00',
            abono: '0',
            libros: ['corporativo'],
          },
          {
            cuenta: '1.1.01.002',
            cargo: '0',
            abono: '8000.00',
            libros: ['corporativo'],
          },
        ],
      }),
      contexto,
    )
    expect(r.valido).toBe(true)
    expect(resumenDe(r.totales, 'fiscal')!.totalCargos.toApi()).toBe('10000.00')
    expect(resumenDe(r.totales, 'corporativo')!.totalCargos.toApi()).toBe(
      '8000.00',
    )
  })

  it('rechaza el asiento entero si un libro descuadra, aunque el otro cuadre', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          { cuenta: '6.1.02.004', cargo: '10000.00', abono: '0' },
          { cuenta: '1.1.01.002', cargo: '0', abono: '10000.00' },
          {
            cuenta: '6.1.02.002',
            cargo: '500.00',
            abono: '0',
            libros: ['corporativo'],
          },
        ],
      }),
      contexto,
    )
    expect(r.valido).toBe(false)
    const descuadre = r.errores.find((e) => e.codigo === 'ASIENTO_DESCUADRADO')
    expect(descuadre?.libro).toBe('corporativo')
    expect(descuadre?.mensaje).toContain('corporativa')
    // El fiscal sigue cuadrando: el rechazo es del asiento, no de ese libro.
    expect(resumenDe(r.totales, 'fiscal')!.diferencia.esCero()).toBe(true)
  })

  it('exige al menos dos líneas en cada libro que se mueve', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          {
            cuenta: '6.1.02.004',
            cargo: '10000.00',
            abono: '0',
            libros: ['fiscal'],
          },
          {
            cuenta: '1.1.01.002',
            cargo: '0',
            abono: '10000.00',
            libros: ['fiscal'],
          },
          {
            cuenta: '6.1.02.002',
            cargo: '500.00',
            abono: '0',
            libros: ['corporativo'],
          },
        ],
      }),
      contexto,
    )
    const insuficiente = r.errores.find(
      (e) => e.codigo === 'ASIENTO_INSUFICIENTE',
    )
    expect(insuficiente?.libro).toBe('corporativo')
  })

  it('un asiento de un solo libro no menciona el otro en sus errores', () => {
    const r = validarAsiento(
      asiento({
        lineas: [
          {
            cuenta: '6.1.02.004',
            cargo: '10000.00',
            abono: '0',
            libros: ['corporativo'],
          },
          {
            cuenta: '1.1.01.002',
            cargo: '0',
            abono: '9000.00',
            libros: ['corporativo'],
          },
        ],
      }),
      contexto,
    )
    expect(r.totales).toHaveLength(1)
    expect(r.errores[0].mensaje).toBe('El asiento no cuadra: diferencia de 1000.00')
  })
})

/* ------------------------------------------------ Consecutivo por ejercicio */

describe('siguienteNumero', () => {
  const libro = [
    { ejercicio: 2025, numero: 1 },
    { ejercicio: 2025, numero: 2 },
    { ejercicio: 2025, numero: 3 },
    { ejercicio: 2026, numero: 1 },
  ]

  it('sigue donde se quedó el ejercicio, no el libro entero', () => {
    expect(siguienteNumero(libro, 2025)).toBe(4)
    expect(siguienteNumero(libro, 2026)).toBe(2)
  })

  it('reinicia en 1 en un ejercicio sin asientos', () => {
    expect(siguienteNumero(libro, 2027)).toBe(1)
    expect(siguienteNumero([], 2026)).toBe(1)
  })

  it('no reutiliza un número aunque el libro tenga huecos por delante', () => {
    // El 2 de 2026 no existe: el siguiente sigue siendo el mayor + 1, porque
    // el hueco no se rellena. Un asiento reversado se queda con su número.
    expect(siguienteNumero([...libro, { ejercicio: 2026, numero: 5 }], 2026)).toBe(6)
  })

  it('numeroDisponible distingue el mismo número en ejercicios distintos', () => {
    expect(numeroDisponible(libro, 2025, 2)).toBe(false)
    expect(numeroDisponible(libro, 2026, 2)).toBe(true)
  })

  it('el ejercicio sale del periodo de la fecha', () => {
    expect(ejercicioDeFecha('2026-08-10', PERIODOS)).toBe(2026)
    // Sin periodo que la contenga se cae al año: la fecha igual se rechaza.
    expect(ejercicioDeFecha('2031-01-01', PERIODOS)).toBe(2031)
  })
})

/* ------------------------------------------------ Reversas (docs/02 §6) */

const original = ASIENTOS.find(
  (a) => a.concepto === 'Reclasificación de gastos de papelería',
)!

/** El asiento de depreciación: líneas en un solo libro, con auxiliar. */
const depreciacion = ASIENTOS.find((a) => a.origenId === 'dep-2026-07')!

const reversaValida = { fecha: FECHA_ABIERTA, motivo: 'Cuenta equivocada' }

describe('construirReversa', () => {
  it('invierte cargos y abonos línea por línea', () => {
    const reversa = construirReversa(original, reversaValida)
    expect(reversa.lineas).toHaveLength(original.lineas.length)
    reversa.lineas.forEach((linea, i) => {
      expect(linea.cuenta).toBe(original.lineas[i].cuentaCodigo)
      expect(linea.cargo).toBe(original.lineas[i].abono)
      expect(linea.abono).toBe(original.lineas[i].cargo)
    })
  })

  it('conserva libros, auxiliar y centro de costo de cada línea', () => {
    const reversa = construirReversa(depreciacion, reversaValida)
    reversa.lineas.forEach((linea, i) => {
      expect(linea.libros).toEqual(depreciacion.lineas[i].libros)
      expect(linea.auxiliarTipo).toBe(depreciacion.lineas[i].auxiliarTipo)
      expect(linea.auxiliarId).toBe(depreciacion.lineas[i].auxiliarId)
      expect(linea.centroCosto).toBe(depreciacion.lineas[i].centroCosto)
    })
    // Y la reversa cuadra libro por libro, igual que el original
    const r = validarAsiento(reversa, { ...contexto, esManual: false })
    expect(r.valido).toBe(true)
    expect(r.totales.map((t) => t.libro)).toEqual(['fiscal', 'corporativo'])
  })

  it('deriva el origen del original y nombra al original en el concepto', () => {
    const reversa = construirReversa(original, reversaValida)
    expect(reversa.origen).toEqual({
      modulo: 'conta',
      tipo: 'reversa',
      id: original.id,
    })
    expect(reversa.concepto).toBe(
      `Reversa del asiento ${original.codigo}: Cuenta equivocada`,
    )
    expect(reversa.fecha).toBe(FECHA_ABIERTA)
    expect(reversa.moneda).toBe(original.moneda)
    expect(reversa.tipoCambio).toBe(original.tipoCambio)
  })
})

describe('validarReversa', () => {
  it('acepta reversar un asiento contabilizado en periodo abierto', () => {
    const r = validarReversa(original, reversaValida, contexto)
    expect(r.valido).toBe(true)
  })

  it('rechaza reversar una reversa', () => {
    const reversa = { ...original, reversaDeId: 'asi-2026-000001' }
    const r = validarReversa(reversa, reversaValida, contexto)
    expect(r.errores.map((e) => e.codigo)).toContain('REVERSA_NO_REVERSABLE')
  })

  it('rechaza reversar dos veces', () => {
    const reversado = {
      ...original,
      estado: 'reversado' as const,
      reversadoPorId: 'asi-2026-000099',
      motivoReversa: 'ya',
    }
    const r = validarReversa(reversado, reversaValida, contexto)
    expect(r.errores.map((e) => e.codigo)).toContain('ASIENTO_YA_REVERSADO')
  })

  it('rechaza una fecha en periodo cerrado', () => {
    const r = validarReversa(
      original,
      { ...reversaValida, fecha: FECHA_CERRADA },
      contexto,
    )
    expect(r.errores.map((e) => e.codigo)).toEqual(['PERIODO_CERRADO'])
  })

  it('exige motivo', () => {
    const r = validarReversa(original, { ...reversaValida, motivo: '  ' }, contexto)
    expect(r.errores.map((e) => e.codigo)).toContain('MOTIVO_REQUERIDO')
  })

  it('permite mover las cuentas de control que movió el original', () => {
    // La factura de cxc carga Clientes, cuenta de control. Su reversa la
    // abona: si la validara como manual, la rechazaría.
    const factura = ASIENTOS.find((a) => a.origenId === 'fac-113')!
    const r = validarReversa(factura, reversaValida, contexto)
    expect(r.valido).toBe(true)
  })
})
