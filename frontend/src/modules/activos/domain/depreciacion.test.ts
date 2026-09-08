import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { PERIODOS } from '@/mocks/seed/periodos'
import { activosMock, categoriasMock } from '@/mocks/seed/activos'
import type { Activo, CategoriaActivo } from '@/shared/api/contracts/activos'
import type { Periodo, SolicitudAsiento } from '@/shared/api/contracts/conta'
import { lineaAfecta } from '@/shared/asiento/libro'
import {
  armarAsientoCorrida,
  calcularCorrida,
  conceptoCorrida,
  cuotaFiscalMensual,
  difiereFiscal,
  idOrigenCorrida,
  mesDeDepreciacion,
  periodoIdDeOrigen,
  type ContextoCorrida,
} from './depreciacion'

const CATEGORIAS: CategoriaActivo[] = categoriasMock.map((c) => ({
  ...c,
  activos: 0,
}))
const COMPUTO = CATEGORIAS.find((c) => c.id === 'cat-computo')!
const MOBILIARIO = CATEGORIAS.find((c) => c.id === 'cat-mobiliario')!

const JULIO = PERIODOS.find((p) => p.id === 'per-2026-07')!
const AGOSTO = PERIODOS.find((p) => p.id === 'per-2026-08')!
const SETIEMBRE = PERIODOS.find((p) => p.id === 'per-2026-09')!

/** El mayor de la demo ya lleva la corrida de julio. */
const CONTEXTO: ContextoCorrida = {
  periodos: PERIODOS,
  corridasContabilizadas: new Map([['per-2026-07', 'asi-0003']]),
}

const SIN_CORRIDAS: ContextoCorrida = {
  periodos: PERIODOS,
  corridasContabilizadas: new Map(),
}

function activo(cambios: Partial<Activo> = {}): Activo {
  return {
    id: 'act-900',
    codigo: 'AF-0900',
    nombre: 'Activo de prueba',
    descripcion: null,
    categoriaId: 'cat-mobiliario',
    categoriaNombre: 'Mobiliario y equipo de oficina',
    fechaAdquisicion: '2026-01-01',
    fechaInicioDepreciacion: '2026-01-01',
    moneda: 'CRC',
    costoAdquisicion: '1200.00',
    valorResidual: '0.00',
    vidaUtilMeses: 12,
    metodo: 'linea_recta',
    depreciacionAcumulada: '0.00',
    valorEnLibros: '1200.00',
    ubicacion: null,
    responsable: null,
    numeroSerie: null,
    proveedorId: null,
    proveedorNombre: null,
    facturaId: null,
    facturaFolio: null,
    origen: 'manual',
    estado: 'activo',
    asientoId: null,
    depreciaciones: [],
    creadoEn: '2026-01-01T00:00:00Z',
    ...cambios,
  }
}

function corridaDe(
  activos: Activo[],
  periodo: Periodo = AGOSTO,
  contexto: ContextoCorrida = CONTEXTO,
) {
  return calcularCorrida(activos, CATEGORIAS, periodo, 'CRC', contexto)
}

function codigos(corrida: { verificaciones: { codigo: string }[] }) {
  return corrida.verificaciones.map((v) => v.codigo)
}

/** Suma cargos y abonos de un libro. Cada libro cuadra por su cuenta. */
function totalesDe(asiento: SolicitudAsiento, libro: 'fiscal' | 'corporativo') {
  const lineas = asiento.lineas.filter((l) => lineaAfecta(l, libro))
  const sumar = (campo: 'cargo' | 'abono') =>
    lineas
      .reduce((acc, l) => acc.plus(new Decimal(l[campo])), new Decimal(0))
      .toFixed(2)
  return { cargos: sumar('cargo'), abonos: sumar('abono') }
}

describe('Identidad de la corrida', () => {
  it('deriva el origen del periodo, con el prefijo de la corrida de julio', () => {
    expect(idOrigenCorrida(AGOSTO)).toBe('dep-2026-08')
    expect(periodoIdDeOrigen('dep-2026-07')).toBe('per-2026-07')
    expect(periodoIdDeOrigen('per-2026-07')).toBe('per-2026-07')
    expect(periodoIdDeOrigen('act-008')).toBeUndefined()
  })

  it('nombra el asiento como la corrida que ya está en el mayor', () => {
    expect(conceptoCorrida(JULIO)).toBe('Depreciación julio 2026')
    expect(conceptoCorrida(SETIEMBRE)).toBe('Depreciación setiembre 2026')
  })

  it('cuenta los meses de depreciación con convención de mes completo', () => {
    expect(mesDeDepreciacion('2026-08-15', AGOSTO)).toBe(1)
    expect(mesDeDepreciacion('2024-02-01', AGOSTO)).toBe(31)
    expect(mesDeDepreciacion('2024-09-01', AGOSTO)).toBe(24)
    expect(mesDeDepreciacion('2026-09-01', AGOSTO)).toBe(0)
  })
})

describe('Corrida de agosto sobre la semilla', () => {
  const corrida = corridaDe(activosMock)

  it('selecciona los tres activos en uso y calcula la cuota de cada uno', () => {
    expect(corrida.lineas.map((l) => [l.activoId, l.cuota])).toEqual([
      ['act-008', '125000.00'],
      ['act-021', '150000.00'],
      ['act-030', '40000.00'],
    ])
    expect(corrida.total).toBe('315000.00')
  })

  it('actualiza acumulada y valor en libros sin bajar del residual', () => {
    for (const linea of corrida.lineas) {
      const ficha = activosMock.find((a) => a.id === linea.activoId)!
      expect(
        new Decimal(linea.valorEnLibrosResultante).greaterThanOrEqualTo(
          ficha.valorResidual,
        ),
      ).toBe(true)
      expect(linea.ultimaCuota).toBe(false)
    }
    const mobiliario = corrida.lineas[0]
    expect(mobiliario.valorEnLibrosInicial).toBe('11250000.00')
    expect(mobiliario.depreciacionAcumuladaResultante).toBe('3875000.00')
    expect(mobiliario.valorEnLibrosResultante).toBe('11125000.00')
  })

  it('lleva cuota fiscal solo donde la tasa del reglamento difiere de la NIIF', () => {
    const [mobiliario, lote, servidor] = corrida.lineas
    // 10% anual = 120 meses = la vida útil contable: un solo importe.
    expect(mobiliario.cuotaFiscal).toBeNull()
    // 25% anual = 48 meses frente a 60 de vida útil: dos cédulas.
    expect(lote.cuotaFiscal).toBe('187500.00')
    expect(servidor.cuotaFiscal).toBe('50000.00')
    expect(corrida.totalFiscal).toBe('362500.00')
  })

  it('se puede contabilizar: julio ya está corrido y agosto está abierto', () => {
    expect(corrida.verificaciones).toEqual([])
    expect(corrida.puedeContabilizar).toBe(true)
  })

  it('no se lo pone fácil a setiembre mientras agosto no esté corrido', () => {
    const setiembre = corridaDe(activosMock, SETIEMBRE)
    expect(codigos(setiembre)).toContain('PERIODO_ANTERIOR_SIN_CORRIDA')
    expect(
      setiembre.verificaciones.find(
        (v) => v.codigo === 'PERIODO_ANTERIOR_SIN_CORRIDA',
      )?.severidad,
    ).toBe('aviso')
    // Un aviso no impide contabilizar.
    expect(setiembre.puedeContabilizar).toBe(true)
  })
})

describe('Selección de activos', () => {
  it('omite los que no están en estado activo', () => {
    const corrida = corridaDe([
      activo({ id: 'a', estado: 'totalmente_depreciado' }),
      activo({ id: 'b', estado: 'dado_de_baja' }),
      activo({ id: 'c', estado: 'vendido' }),
    ])
    expect(corrida.lineas).toEqual([])
    expect(codigos(corrida)).toEqual(['CORRIDA_VACIA'])
  })

  it('omite en silencio los que empiezan a depreciarse después del periodo', () => {
    const corrida = corridaDe([
      activo({ fechaInicioDepreciacion: '2026-09-01' }),
    ])
    expect(corrida.lineas).toEqual([])
    expect(codigos(corrida)).toEqual(['CORRIDA_VACIA'])
  })

  it('incluye al que entra en uso el último día del periodo', () => {
    const corrida = corridaDe([activo({ fechaInicioDepreciacion: '2026-08-31' })])
    expect(corrida.lineas).toHaveLength(1)
    expect(corrida.lineas[0].cuota).toBe('100.00')
  })

  it('avisa y omite al que no tiene fecha de inicio', () => {
    const corrida = corridaDe([activo({ fechaInicioDepreciacion: '' })])
    expect(corrida.lineas).toEqual([])
    expect(codigos(corrida)).toEqual(['CORRIDA_VACIA', 'SIN_FECHA_INICIO'])
    expect(corrida.verificaciones[1].activoId).toBe('act-900')
    expect(corrida.verificaciones[1].severidad).toBe('aviso')
  })

  it('avisa y omite al que sigue activo pero ya no tiene nada por depreciar', () => {
    const corrida = corridaDe([
      activo({ depreciacionAcumulada: '1200.00', valorEnLibros: '0.00' }),
    ])
    expect(corrida.lineas).toEqual([])
    expect(codigos(corrida)).toContain('CUOTA_CERO')
  })

  it('avisa y omite al que está en otra moneda que la corrida', () => {
    const corrida = corridaDe([activo({ moneda: 'USD' })])
    expect(corrida.lineas).toEqual([])
    expect(codigos(corrida)).toContain('MONEDA_DISTINTA')
  })

  it('ordena las líneas por código de activo', () => {
    const corrida = corridaDe([
      activo({ id: 'b', codigo: 'AF-0002' }),
      activo({ id: 'a', codigo: 'AF-0001' }),
    ])
    expect(corrida.lineas.map((l) => l.activoId)).toEqual(['a', 'b'])
  })
})

describe('Cuota y cierre contra el residual', () => {
  it('línea recta: costo menos residual entre la vida útil', () => {
    const corrida = corridaDe([activo({ valorResidual: '200.00' })])
    // (1200 - 200) / 12
    expect(corrida.lineas[0].cuota).toBe('83.33')
    expect(corrida.lineas[0].ultimaCuota).toBe(false)
  })

  it('nunca deprecia por debajo del residual aunque la cuota sea mayor', () => {
    const corrida = corridaDe([
      activo({
        valorResidual: '200.00',
        depreciacionAcumulada: '950.00',
        valorEnLibros: '250.00',
      }),
    ])
    // Quedan 50 por depreciar y la cuota sería 83,33.
    expect(corrida.lineas[0].cuota).toBe('50.00')
    expect(corrida.lineas[0].valorEnLibrosResultante).toBe('200.00')
    expect(corrida.lineas[0].ultimaCuota).toBe(true)
  })

  it('el último mes de la vida útil cierra el remanente exacto', () => {
    // Vida útil de 3 meses desde junio: agosto es el tercero. La cuota
    // redondeada de 333,33 dejaría un céntimo colgando para siempre.
    const corrida = corridaDe([
      activo({
        costoAdquisicion: '1000.00',
        valorEnLibros: '333.34',
        vidaUtilMeses: 3,
        fechaInicioDepreciacion: '2026-06-01',
        depreciacionAcumulada: '666.66',
      }),
    ])
    expect(corrida.lineas[0].cuota).toBe('333.34')
    expect(corrida.lineas[0].depreciacionAcumuladaResultante).toBe('1000.00')
    expect(corrida.lineas[0].valorEnLibrosResultante).toBe('0.00')
    expect(corrida.lineas[0].ultimaCuota).toBe(true)
  })

  it('marca la última cuota con un aviso, en la línea y en la corrida', () => {
    const corrida = corridaDe([
      activo({ depreciacionAcumulada: '1100.00', valorEnLibros: '100.00' }),
    ])
    expect(corrida.lineas[0].ultimaCuota).toBe(true)
    expect(corrida.lineas[0].verificaciones.map((v) => v.codigo)).toEqual([
      'ULTIMA_CUOTA',
    ])
    expect(codigos(corrida)).toEqual(['ULTIMA_CUOTA'])
    expect(corrida.puedeContabilizar).toBe(true)
  })

  it('saldos decrecientes: valor en libros por el doble de la tasa lineal', () => {
    const corrida = corridaDe([
      activo({ metodo: 'saldos_decrecientes', valorResidual: '100.00' }),
    ])
    // 1200 × (2 / 12)
    expect(corrida.lineas[0].cuota).toBe('200.00')

    const siguiente = corridaDe([
      activo({
        metodo: 'saldos_decrecientes',
        valorResidual: '100.00',
        depreciacionAcumulada: '200.00',
        valorEnLibros: '1000.00',
      }),
    ])
    // Sobre el nuevo valor en libros, no sobre el costo.
    expect(siguiente.lineas[0].cuota).toBe('166.67')
  })

  it('saldos decrecientes tampoco baja del residual', () => {
    const corrida = corridaDe([
      activo({
        metodo: 'saldos_decrecientes',
        valorResidual: '100.00',
        depreciacionAcumulada: '1050.00',
        valorEnLibros: '150.00',
      }),
    ])
    // Libros 150 × 2/12 = 25 cabe; quedan 50 por depreciar.
    expect(corrida.lineas[0].cuota).toBe('25.00')

    const casiAlFinal = corridaDe([
      activo({
        metodo: 'saldos_decrecientes',
        valorResidual: '100.00',
        depreciacionAcumulada: '1090.00',
        valorEnLibros: '110.00',
        fechaInicioDepreciacion: '2025-09-01',
      }),
    ])
    // Mes 12 de 12: cierra el remanente aunque la fórmula diera 18,33.
    expect(casiAlFinal.lineas[0].cuota).toBe('10.00')
    expect(casiAlFinal.lineas[0].ultimaCuota).toBe(true)
  })
})

describe('Cédula fiscal', () => {
  it('detecta la diferencia por la vida útil del activo, no de la categoría', () => {
    expect(difiereFiscal({ vidaUtilMeses: 60 }, COMPUTO)).toBe(true)
    expect(difiereFiscal({ vidaUtilMeses: 48 }, COMPUTO)).toBe(false)
    expect(difiereFiscal({ vidaUtilMeses: 120 }, MOBILIARIO)).toBe(false)
    expect(difiereFiscal({ vidaUtilMeses: 60 }, { tasaFiscalAnual: null })).toBe(
      false,
    )
  })

  it('deprecia a la tasa del reglamento sobre el depreciable', () => {
    const servidor = activosMock.find((a) => a.id === 'act-030')!
    expect(cuotaFiscalMensual(servidor, COMPUTO, AGOSTO, 'CRC').toApi()).toBe(
      '50000.00',
    )
  })

  it('cierra el remanente fiscal en el último mes y luego no produce nada', () => {
    const lote = activosMock.find((a) => a.id === 'act-021')!
    // 48 meses desde setiembre de 2024: agosto de 2028 es el último.
    const ultimo: Periodo = {
      ...AGOSTO,
      id: 'per-2028-08',
      ejercicio: 2028,
      fechaInicio: '2028-08-01',
      fechaFin: '2028-08-31',
    }
    expect(cuotaFiscalMensual(lote, COMPUTO, ultimo, 'CRC').toApi()).toBe(
      '187500.00',
    )
    const despues: Periodo = { ...ultimo, numero: 9, id: 'per-2028-09' }
    expect(cuotaFiscalMensual(lote, COMPUTO, despues, 'CRC').toApi()).toBe(
      '0.00',
    )
  })
})

describe('Verificaciones que bloquean', () => {
  it('rechaza un periodo que no está abierto', () => {
    const corrida = corridaDe(activosMock, JULIO, SIN_CORRIDAS)
    expect(codigos(corrida)).toContain('PERIODO_NO_ABIERTO')
    expect(corrida.puedeContabilizar).toBe(false)
  })

  it('rechaza la corrida de un periodo ya contabilizado y dice en qué asiento', () => {
    const corrida = corridaDe(activosMock, JULIO)
    const bloqueo = corrida.verificaciones.find(
      (v) => v.codigo === 'CORRIDA_YA_CONTABILIZADA',
    )
    expect(bloqueo?.severidad).toBe('error')
    expect(bloqueo?.mensaje).toContain('asi-0003')
    expect(corrida.puedeContabilizar).toBe(false)
  })

  it('rechaza una categoría sin cuenta de gasto o de depreciación acumulada', () => {
    const sinGasto: CategoriaActivo = {
      ...MOBILIARIO,
      cuentaGastoDepreciacion: '',
    }
    const corrida = calcularCorrida(
      [activo()],
      [sinGasto, COMPUTO],
      AGOSTO,
      'CRC',
      CONTEXTO,
    )
    expect(codigos(corrida)).toEqual(['CATEGORIA_SIN_CUENTA'])
    expect(corrida.lineas).toHaveLength(1)
    expect(corrida.puedeContabilizar).toBe(false)
  })

  it('rechaza un activo cuya categoría no existe', () => {
    const corrida = corridaDe([activo({ categoriaId: 'cat-fantasma' })])
    expect(codigos(corrida)).toContain('CATEGORIA_INVALIDA')
    expect(corrida.puedeContabilizar).toBe(false)
  })

  it('una corrida vacía no se contabiliza, pero no es un error', () => {
    const corrida = corridaDe([])
    expect(corrida.verificaciones).toEqual([
      expect.objectContaining({ codigo: 'CORRIDA_VACIA', severidad: 'aviso' }),
    ])
    expect(corrida.puedeContabilizar).toBe(false)
  })

  it('la primera corrida de la empresa no avisa de un mes anterior sin correr', () => {
    const corrida = corridaDe(activosMock, AGOSTO, SIN_CORRIDAS)
    expect(codigos(corrida)).not.toContain('PERIODO_ANTERIOR_SIN_CORRIDA')
  })
})

describe('Asiento de la corrida', () => {
  const corrida = corridaDe(activosMock)
  const asiento = armarAsientoCorrida(
    corrida,
    activosMock,
    CATEGORIAS,
    AGOSTO,
    'CRC',
  )

  it('lleva la terna de origen del periodo, la fecha de fin y el concepto', () => {
    expect(asiento.origen).toEqual({
      modulo: 'activos',
      tipo: 'depreciacion',
      id: 'dep-2026-08',
    })
    expect(asiento.fecha).toBe('2026-08-31')
    expect(asiento.concepto).toBe('Depreciación agosto 2026')
    expect(asiento.moneda).toBe('CRC')
  })

  it('agrupa el gasto por categoría y abona la acumulada por activo', () => {
    expect(asiento.lineas).toEqual([
      // Mobiliario: una sola cédula, a los dos libros.
      expect.objectContaining({
        cuenta: '6.1.02.010',
        cargo: '125000.00',
        abono: '0',
      }),
      expect.objectContaining({
        cuenta: '1.2.02.001',
        abono: '125000.00',
        auxiliarTipo: 'activo',
        auxiliarId: 'act-008',
      }),
      // Cómputo: la fiscal al 25% y la corporativa a cinco años, como julio.
      expect.objectContaining({
        cuenta: '6.1.02.010',
        cargo: '237500.00',
        libros: ['fiscal'],
      }),
      expect.objectContaining({
        cuenta: '1.2.02.002',
        abono: '187500.00',
        auxiliarId: 'act-021',
        libros: ['fiscal'],
      }),
      expect.objectContaining({
        cuenta: '1.2.02.002',
        abono: '50000.00',
        auxiliarId: 'act-030',
        libros: ['fiscal'],
      }),
      expect.objectContaining({
        cuenta: '6.1.02.010',
        cargo: '190000.00',
        libros: ['corporativo'],
      }),
      expect.objectContaining({
        cuenta: '1.2.02.002',
        abono: '150000.00',
        auxiliarId: 'act-021',
        libros: ['corporativo'],
      }),
      expect.objectContaining({
        cuenta: '1.2.02.002',
        abono: '40000.00',
        auxiliarId: 'act-030',
        libros: ['corporativo'],
      }),
    ])
    // Las líneas de una sola cédula no declaran libros: ambos por omisión.
    expect(asiento.lineas[0].libros).toBeUndefined()
    expect(asiento.lineas[1].libros).toBeUndefined()
  })

  it('cuadra por libro, cada uno con su propio total', () => {
    expect(totalesDe(asiento, 'fiscal')).toEqual({
      cargos: '362500.00',
      abonos: '362500.00',
    })
    expect(totalesDe(asiento, 'corporativo')).toEqual({
      cargos: '315000.00',
      abonos: '315000.00',
    })
  })

  it('cuando el reglamento ya terminó, el activo solo mueve el libro corporativo', () => {
    // Empezó en enero de 2022: en agosto de 2026 va por el mes 56, pasado el
    // 48 fiscal y dentro de los 60 contables.
    const viejo = activo({
      id: 'act-901',
      categoriaId: 'cat-computo',
      categoriaNombre: 'Equipo de cómputo',
      costoAdquisicion: '6000.00',
      vidaUtilMeses: 60,
      fechaInicioDepreciacion: '2022-01-01',
      depreciacionAcumulada: '5500.00',
      valorEnLibros: '500.00',
    })
    const corrida = corridaDe([viejo])
    expect(corrida.lineas[0].cuota).toBe('100.00')
    expect(corrida.lineas[0].cuotaFiscal).toBe('0.00')

    const solo = armarAsientoCorrida(corrida, [viejo], CATEGORIAS, AGOSTO, 'CRC')
    expect(solo.lineas.map((l) => [l.cuenta, l.cargo, l.abono, l.libros])).toEqual([
      ['6.1.02.010', '100.00', '0', ['corporativo']],
      ['1.2.02.002', '0', '100.00', ['corporativo']],
    ])
    expect(totalesDe(solo, 'fiscal')).toEqual({ cargos: '0.00', abonos: '0.00' })
  })

  it('el concepto del abono toma el nombre vigente de la ficha', () => {
    const renombrado = activosMock.map((a) =>
      a.id === 'act-008' ? { ...a, nombre: 'Mobiliario sede norte' } : a,
    )
    const conNombre = armarAsientoCorrida(
      corrida,
      renombrado,
      CATEGORIAS,
      AGOSTO,
      'CRC',
    )
    expect(conNombre.lineas[1].concepto).toBe('Mobiliario sede norte')
  })
})
