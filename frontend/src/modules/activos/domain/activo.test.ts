import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { CUENTAS } from '@/mocks/seed/cuentas'
import { PERIODOS } from '@/mocks/seed/periodos'
import { activosMock, categoriasMock } from '@/mocks/seed/activos'
import type {
  Activo,
  AltaPendiente,
  CategoriaActivo,
  SolicitudActivoManual,
  SolicitudCategoriaActivo,
} from '@/shared/api/contracts/activos'
import {
  cuotaMensual,
  lineasAsientoAltaManual,
  valorResidualDe,
  vidaUtilDe,
  validarAltaDesdeFactura,
  validarAltaManual,
  validarCategoria,
} from './activo'

const CATEGORIAS: CategoriaActivo[] = categoriasMock.map((c) => ({
  ...c,
  activos: 0,
}))

const COMPUTO = CATEGORIAS.find((c) => c.id === 'cat-computo')!
const VEHICULOS = CATEGORIAS.find((c) => c.id === 'cat-vehiculos')!

function solicitud(
  cambios: Partial<SolicitudActivoManual> = {},
): SolicitudActivoManual {
  return {
    nombre: 'Servidor donado',
    categoriaId: 'cat-computo',
    fechaAdquisicion: '2026-08-20',
    fechaInicioDepreciacion: '2026-08-20',
    moneda: 'CRC',
    tipoCambio: '1',
    costoAdquisicion: '3000000',
    cuentaContrapartida: '3.1.01.001',
    ...cambios,
  }
}

describe('Ficha del activo', () => {
  it('hereda la vida útil de la categoría y admite sobrescribirla', () => {
    expect(vidaUtilDe(COMPUTO)).toBe(60)
    expect(vidaUtilDe(COMPUTO, 48)).toBe(48)
  })

  it('aplica el porcentaje residual de la categoría cuando no se declara', () => {
    // Vehículos conserva un 10% del costo.
    expect(valorResidualDe('10000000', VEHICULOS).toFixed(2)).toBe('1000000.00')
    expect(valorResidualDe('10000000', VEHICULOS, '500000').toFixed(2)).toBe(
      '500000.00',
    )
  })
})

describe('Cuota de depreciación', () => {
  const activo = activosMock.find((a) => a.id === 'act-021')!

  it('línea recta reparte el costo depreciable entre la vida útil', () => {
    // 9 000 000 en 60 meses: es la cuota corporativa que ya está en el mayor.
    expect(cuotaMensual(activo).toApi()).toBe('150000.00')
  })

  it('nunca deprecia por debajo del valor residual', () => {
    const casiDepreciado: Activo = {
      ...activo,
      depreciacionAcumulada: '8950000.00',
      valorEnLibros: '50000.00',
    }
    // Queda menos de una cuota: el último mes ajusta el remanente en vez de
    // dejar tres céntimos por depreciar para siempre.
    expect(cuotaMensual(casiDepreciado).toApi()).toBe('50000.00')
  })

  it('un activo totalmente depreciado ya no genera cuota', () => {
    const agotado: Activo = {
      ...activo,
      depreciacionAcumulada: activo.costoAdquisicion,
      valorEnLibros: '0.00',
    }
    expect(cuotaMensual(agotado).esCero()).toBe(true)
  })
})

describe('Asiento del alta directa', () => {
  it('carga la cuenta de activo de la categoría y abona la contrapartida', () => {
    const lineas = lineasAsientoAltaManual(solicitud(), COMPUTO, {
      id: 'act-900',
      nombre: 'Servidor donado',
    })

    expect(lineas[0]).toMatchObject({
      cuenta: COMPUTO.cuentaActivo,
      cargo: '3000000.00',
      auxiliarTipo: 'activo',
      auxiliarId: 'act-900',
    })
    expect(lineas[1]).toMatchObject({
      cuenta: '3.1.01.001',
      abono: '3000000.00',
    })

    const cargos = lineas.reduce(
      (acc, l) => acc.plus(new Decimal(l.cargo)),
      new Decimal(0),
    )
    const abonos = lineas.reduce(
      (acc, l) => acc.plus(new Decimal(l.abono)),
      new Decimal(0),
    )
    expect(cargos.toFixed(2)).toBe(abonos.toFixed(2))
  })
})

describe('Validación del alta directa', () => {
  const contexto = { categorias: CATEGORIAS, cuentas: CUENTAS, periodos: PERIODOS }

  it('acepta un alta correcta', () => {
    expect(validarAltaManual(solicitud(), contexto).valido).toBe(true)
  })

  it('exige categoría', () => {
    const resultado = validarAltaManual(solicitud({ categoriaId: '' }), contexto)
    expect(resultado.errores.map((e) => e.codigo)).toContain('CATEGORIA_INVALIDA')
  })

  it('rechaza costo cero', () => {
    const resultado = validarAltaManual(
      solicitud({ costoAdquisicion: '0' }),
      contexto,
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('COSTO_INVALIDO')
  })

  it('rechaza un residual que alcanza el costo', () => {
    const resultado = validarAltaManual(
      solicitud({ valorResidual: '3000000' }),
      contexto,
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('RESIDUAL_INVALIDO')
  })

  it('no deja empezar la depreciación antes de la adquisición', () => {
    const resultado = validarAltaManual(
      solicitud({ fechaInicioDepreciacion: '2026-08-01' }),
      contexto,
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'FECHA_INICIO_INVALIDA',
    )
  })

  it('rechaza una contrapartida que es cuenta de control de otro módulo', () => {
    // Dar de alta un activo contra Proveedores es una compra, y esa entra por
    // CxP: hacerlo aquí dejaría el auxiliar de proveedores sin documento.
    const resultado = validarAltaManual(
      solicitud({ cuentaContrapartida: '2.1.01.001' }),
      contexto,
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('CUENTA_INVALIDA')
  })

  it('rechaza el alta en un periodo que no está abierto', () => {
    const resultado = validarAltaManual(
      solicitud({
        fechaAdquisicion: '2026-07-01',
        fechaInicioDepreciacion: '2026-07-01',
      }),
      contexto,
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('PERIODO_CERRADO')
  })
})

describe('Validación del alta desde una factura', () => {
  const pendiente: AltaPendiente = {
    facturaId: 'fpr-9100',
    facturaFolio: '9100',
    lineaId: 'fpr-9100-l1',
    proveedorId: 'pro-033',
    proveedorNombre: 'Ingeniería y Sistemas Vega S.A.',
    fecha: '2026-08-12',
    descripcion: 'Servidor',
    cuenta: '1.2.01.002',
    cuentaNombre: 'Equipo de cómputo',
    moneda: 'CRC',
    importe: '2400000.00',
    categoriaSugeridaId: 'cat-computo',
  }

  const contexto = { categorias: CATEGORIAS, pendientes: [pendiente] }

  it('acepta el alta de una línea pendiente', () => {
    const resultado = validarAltaDesdeFactura(
      {
        facturaId: pendiente.facturaId,
        lineaId: pendiente.lineaId,
        nombre: 'Servidor de aplicaciones',
        categoriaId: 'cat-computo',
        fechaInicioDepreciacion: '2026-08-15',
      },
      contexto,
    )
    expect(resultado.valido).toBe(true)
  })

  it('rechaza una línea que ya no está pendiente', () => {
    const resultado = validarAltaDesdeFactura(
      {
        facturaId: 'fpr-0000',
        lineaId: 'fpr-0000-l1',
        nombre: 'Servidor',
        categoriaId: 'cat-computo',
        fechaInicioDepreciacion: '2026-08-15',
      },
      contexto,
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('ALTA_NO_DISPONIBLE')
  })

  it('no deja depreciar desde antes de la fecha de la factura', () => {
    const resultado = validarAltaDesdeFactura(
      {
        facturaId: pendiente.facturaId,
        lineaId: pendiente.lineaId,
        nombre: 'Servidor',
        categoriaId: 'cat-computo',
        fechaInicioDepreciacion: '2026-08-01',
      },
      contexto,
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain(
      'FECHA_INICIO_INVALIDA',
    )
  })
})


describe('Validación de la categoría', () => {
  const contexto = { cuentas: CUENTAS, categorias: CATEGORIAS }

  function categoria(
    cambios: Partial<SolicitudCategoriaActivo> = {},
  ): SolicitudCategoriaActivo {
    return {
      nombre: 'Maquinaria de planta',
      vidaUtilMeses: 120,
      metodo: 'linea_recta',
      porcentajeResidual: '5',
      cuentaActivo: '1.2.01.001',
      cuentaDepreciacionAcumulada: '1.2.02.001',
      cuentaGastoDepreciacion: '6.1.02.010',
      tasaFiscalAnual: '10',
      activa: true,
      ...cambios,
    }
  }

  const codigos = (solicitud: SolicitudCategoriaActivo, ctx = contexto) =>
    validarCategoria(solicitud, ctx).errores.map((e) => e.codigo)

  it('acepta una categoría bien mapeada', () => {
    expect(validarCategoria(categoria(), contexto).valido).toBe(true)
  })

  it('rechaza un nombre repetido, sin importar mayúsculas', () => {
    expect(codigos(categoria({ nombre: 'equipo de CÓMPUTO' }))).toContain(
      'NOMBRE_DUPLICADO',
    )
  })

  it('deja renombrar la categoría que se está editando', () => {
    const computo = CATEGORIAS.find((c) => c.id === 'cat-computo')!
    const resultado = validarCategoria(
      categoria({
        nombre: 'Equipo de cómputo',
        cuentaActivo: computo.cuentaActivo,
        cuentaDepreciacionAcumulada: computo.cuentaDepreciacionAcumulada,
        cuentaGastoDepreciacion: computo.cuentaGastoDepreciacion,
      }),
      { ...contexto, categoria: computo },
    )
    expect(resultado.valido).toBe(true)
  })

  it('exige que la cuenta de activo lleve auxiliar de activo y sea deudora', () => {
    // Caja general recibe movimientos, pero no reconoce activos fijos: una
    // compra cargada ahí nunca aparecería como pendiente de ficha.
    expect(codigos(categoria({ cuentaActivo: '1.1.01.001' }))).toContain(
      'CUENTA_INVALIDA',
    )
  })

  it('exige que la depreciación acumulada sea la contracuenta acreedora', () => {
    expect(
      codigos(categoria({ cuentaDepreciacionAcumulada: '1.2.01.001' })),
    ).toContain('CUENTA_INVALIDA')
  })

  it('exige que el gasto por depreciación sea cuenta de resultados', () => {
    expect(
      codigos(categoria({ cuentaGastoDepreciacion: '1.2.01.002' })),
    ).toContain('CUENTA_INVALIDA')
  })

  it('rechaza una cuenta que no existe en el catálogo', () => {
    expect(codigos(categoria({ cuentaActivo: '9.9.99.999' }))).toContain(
      'CUENTA_INVALIDA',
    )
  })

  it('rechaza un residual que no deja nada que depreciar', () => {
    expect(codigos(categoria({ porcentajeResidual: '100' }))).toContain(
      'RESIDUAL_INVALIDO',
    )
    expect(codigos(categoria({ porcentajeResidual: '-1' }))).toContain(
      'RESIDUAL_INVALIDO',
    )
  })

  it('admite la categoría sin tasa fiscal propia y rechaza una imposible', () => {
    expect(validarCategoria(categoria({ tasaFiscalAnual: null }), contexto).valido).toBe(
      true,
    )
    expect(codigos(categoria({ tasaFiscalAnual: '140' }))).toContain(
      'TASA_FISCAL_INVALIDA',
    )
  })

  it('exige al menos un mes de vida útil', () => {
    expect(codigos(categoria({ vidaUtilMeses: 0 }))).toContain(
      'VIDA_UTIL_INVALIDA',
    )
  })

  it('no deja mover el mapeo de una categoría que ya tiene activos', () => {
    // Los asientos de esos activos cargaron la cuenta vieja: cambiarla dejaría
    // el costo en una cuenta y las fichas apuntando a otra (docs/07 §4).
    const conActivos: CategoriaActivo = {
      ...CATEGORIAS.find((c) => c.id === 'cat-computo')!,
      activos: 2,
    }
    const resultado = validarCategoria(
      categoria({ nombre: 'Equipo de cómputo', cuentaActivo: '1.2.01.001' }),
      { ...contexto, categoria: conActivos },
    )
    expect(resultado.errores.map((e) => e.codigo)).toContain('MAPEO_BLOQUEADO')
  })

  it('deja cambiar vida útil y método aunque la categoría tenga activos', () => {
    // La ficha copia los dos al darse de alta: cambiarlos solo rige para los
    // activos que vengan después, y no toca nada de lo ya contabilizado.
    const computo = CATEGORIAS.find((c) => c.id === 'cat-computo')!
    const conActivos: CategoriaActivo = { ...computo, activos: 2 }
    const resultado = validarCategoria(
      categoria({
        nombre: 'Equipo de cómputo',
        vidaUtilMeses: 48,
        metodo: 'saldos_decrecientes',
        cuentaActivo: computo.cuentaActivo,
        cuentaDepreciacionAcumulada: computo.cuentaDepreciacionAcumulada,
        cuentaGastoDepreciacion: computo.cuentaGastoDepreciacion,
      }),
      { ...contexto, categoria: conActivos },
    )
    expect(resultado.valido).toBe(true)
  })
})
