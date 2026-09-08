import { describe, expect, it } from 'vitest'
import { clasificacionesMock, notasMock } from '@/mocks/seed/clasificaciones'
import { CUENTAS } from '@/mocks/seed/cuentas'
import type { SolicitudCuenta } from '@/shared/api/contracts/conta'
import { type ContextoCuenta, compararCodigos, validarCuenta } from './cuenta'

const SIN_MOVIMIENTOS = new Set<string>()

/** Propiedades, planta y equipo, y la nota que la desglosa. */
const PPE = { clasificacionNiifId: 'niif-a-06', notaEeffId: 'nota-06' }

function solicitud(cambios: Partial<SolicitudCuenta> = {}): SolicitudCuenta {
  return {
    codigo: '1.2.01.004',
    nombre: 'Maquinaria y equipo de planta',
    tipo: 'activo',
    naturaleza: 'deudora',
    esDetalle: true,
    requiereAuxiliar: 'activo',
    moduloDueno: 'activos',
    moneda: null,
    ...PPE,
    activa: true,
    ...cambios,
  }
}

const cuentaDe = (codigo: string) => CUENTAS.find((c) => c.codigo === codigo)!

const contexto = (extra: Partial<ContextoCuenta> = {}): ContextoCuenta => ({
  cuentas: CUENTAS,
  conMovimientos: SIN_MOVIMIENTOS,
  clasificaciones: clasificacionesMock,
  notas: notasMock,
  ...extra,
})

const codigos = (
  peticion: SolicitudCuenta,
  contextoDado: ContextoCuenta = contexto(),
) => validarCuenta(peticion, contextoDado).errores.map((e) => e.codigo)

describe('Orden del catálogo', () => {
  it('ordena por número y no por texto', () => {
    // Con localeCompare, '1.1.01.010' iría antes que '1.1.01.002'.
    expect(compararCodigos('1.1.01.002', '1.1.01.010')).toBeLessThan(0)
  })

  it('pone la madre antes que sus hijas', () => {
    expect(compararCodigos('1.2.01', '1.2.01.001')).toBeLessThan(0)
    expect(compararCodigos('1.2.02', '1.2.01.001')).toBeGreaterThan(0)
  })
})

describe('Alta de cuenta', () => {
  it('acepta una cuenta que cuelga de una acumulativa de su mismo tipo', () => {
    expect(
      validarCuenta(solicitud(), contexto()).valido,
    ).toBe(true)
  })

  it('rechaza un código que ya está en el catálogo', () => {
    expect(codigos(solicitud({ codigo: '1.2.01.001' }))).toContain(
      'CODIGO_DUPLICADO',
    )
  })

  it('rechaza un código que no son números y puntos', () => {
    expect(codigos(solicitud({ codigo: '1.2.01-A' }))).toContain(
      'CODIGO_INVALIDO',
    )
  })

  it('exige que exista la cuenta madre', () => {
    expect(codigos(solicitud({ codigo: '1.9.99.001' }))).toContain(
      'PADRE_NO_ENCONTRADO',
    )
  })

  it('no deja colgar una cuenta de otra que recibe movimientos', () => {
    // Si Caja general tuviera hijas, su saldo contaría dos veces en la balanza.
    expect(
      codigos(
        solicitud({
          codigo: '1.1.01.001.001',
          requiereAuxiliar: null,
          moduloDueno: null,
        }),
      ),
    ).toContain('PADRE_DE_DETALLE')
  })

  it('obliga a heredar el tipo de la madre', () => {
    // Un gasto dentro del activo movería el balance con lo que gastó la empresa.
    expect(
      codigos(solicitud({ tipo: 'gasto', requiereAuxiliar: null, moduloDueno: null })),
    ).toContain('TIPO_DISTINTO_DEL_PADRE')
  })

  it('admite naturaleza contraria a su tipo', () => {
    // Es lo que es una depreciación acumulada: activo, pero acreedora.
    const resultado = validarCuenta(
      solicitud({
        codigo: '1.2.02.004',
        nombre: 'Dep. acumulada — maquinaria',
        naturaleza: 'acreedora',
      }),
      contexto(),
    )
    expect(resultado.valido).toBe(true)
  })

  it('no deja marcar una acumulativa como de control ni exigirle auxiliar', () => {
    const errores = codigos(
      solicitud({
        codigo: '1.2.03',
        esDetalle: false,
        moneda: 'USD',
        clasificacionNiifId: null,
        notaEeffId: null,
      }),
    )
    expect(errores.filter((c) => c === 'MARCA_SOLO_DE_DETALLE')).toHaveLength(3)
  })

  it('exige nombre', () => {
    expect(codigos(solicitud({ nombre: '   ' }))).toContain('NOMBRE_REQUERIDO')
  })

  it('admite una cuenta de primer nivel, que no tiene madre', () => {
    const resultado = validarCuenta(
      solicitud({
        codigo: '8',
        nombre: 'CUENTAS DE ORDEN',
        tipo: 'orden',
        esDetalle: false,
        requiereAuxiliar: null,
        moduloDueno: null,
        clasificacionNiifId: null,
        notaEeffId: null,
      }),
      contexto(),
    )
    expect(resultado.valido).toBe(true)
  })
})

describe('Presentación en los estados financieros', () => {
  it('no da de alta una cuenta de detalle sin renglón', () => {
    // Sin renglón el saldo se registra en el mayor y no llega a ningún estado
    // financiero, y la balanza sigue cuadrando: nadie se entera.
    expect(
      codigos(solicitud({ clasificacionNiifId: null, notaEeffId: null })),
    ).toContain('CLASIFICACION_REQUERIDA')
  })

  it('no da de alta una cuenta de detalle sin nota', () => {
    expect(codigos(solicitud({ notaEeffId: null }))).toContain('NOTA_REQUERIDA')
  })

  it('rechaza el renglón que no admite el tipo de la cuenta', () => {
    // R.05 es de gasto y la cuenta es de activo.
    expect(
      codigos(
        solicitud({
          clasificacionNiifId: 'niif-r-05',
          notaEeffId: 'nota-16',
        }),
      ),
    ).toContain('TIPO_INCOMPATIBLE')
  })

  it('rechaza una nota que cuelga de otro renglón', () => {
    expect(codigos(solicitud({ notaEeffId: 'nota-02' }))).toContain('NOTA_AJENA')
  })

  it('no le pone renglón a una cuenta acumulativa', () => {
    // Presenta lo que suman sus hijas: dárselo contaría esos saldos dos veces.
    expect(
      codigos(solicitud({ codigo: '1.2.03', esDetalle: false })),
    ).toContain('CUENTA_NO_DETALLE')
  })

  it('deja reclasificar una cuenta que ya tiene movimientos', () => {
    // Cambiar dónde se presenta no reescribe nada de lo asentado: es la única
    // parte de la definición que sigue viva con el mayor encima.
    const caja = cuentaDe('1.1.01.001')
    const resultado = validarCuenta(
      solicitud({
        codigo: caja.codigo,
        nombre: caja.nombre,
        tipo: caja.tipo,
        naturaleza: caja.naturaleza,
        esDetalle: caja.esDetalle,
        requiereAuxiliar: caja.requiereAuxiliar,
        moduloDueno: caja.moduloDueno,
        moneda: caja.moneda,
        clasificacionNiifId: 'niif-a-01',
        notaEeffId: 'nota-01b',
      }),
      contexto({ conMovimientos: new Set([caja.codigo]), cuenta: caja }),
    )
    expect(resultado.valido).toBe(true)
  })
})

describe('Edición de cuenta', () => {
  const conMovimientos = new Set(['1.1.01.001'])
  const caja = cuentaDe('1.1.01.001')

  const editar = (cambios: Partial<SolicitudCuenta>) =>
    codigos(
      solicitud({
        codigo: caja.codigo,
        nombre: caja.nombre,
        tipo: caja.tipo,
        naturaleza: caja.naturaleza,
        esDetalle: caja.esDetalle,
        requiereAuxiliar: caja.requiereAuxiliar,
        moduloDueno: caja.moduloDueno,
        moneda: caja.moneda,
        clasificacionNiifId: caja.clasificacionNiifId,
        notaEeffId: caja.notaEeffId,
        activa: caja.activa,
        ...cambios,
      }),
      contexto({ conMovimientos, cuenta: caja }),
    )

  it('deja renombrar y desactivar una cuenta con movimientos', () => {
    expect(editar({ nombre: 'Caja general de la sede', activa: false })).toEqual(
      [],
    )
  })

  it('no deja invertir la naturaleza de una cuenta con movimientos', () => {
    // Le cambiaría el signo al saldo que ya está en la balanza.
    expect(editar({ naturaleza: 'acreedora' })).toContain(
      'CUENTA_CON_MOVIMIENTOS',
    )
  })

  it('no deja volverla de control ni exigirle auxiliar a posteriori', () => {
    // El mayor tendría líneas sin el auxiliar que la cuenta pasaría a exigir.
    expect(editar({ requiereAuxiliar: 'cliente' })).toContain(
      'CUENTA_CON_MOVIMIENTOS',
    )
    expect(editar({ moduloDueno: 'cxc' })).toContain('CUENTA_CON_MOVIMIENTOS')
  })

  it('nunca deja cambiar el código', () => {
    // Cada línea de asiento lo guarda: el mayor apuntaría a una cuenta que ya
    // no existe.
    expect(editar({ codigo: '1.1.01.009' })).toContain('CODIGO_INMUTABLE')
  })

  it('deja editar libremente una cuenta que el mayor todavía no usa', () => {
    const sinUsar = cuentaDe('2.1.03.010')
    const resultado = validarCuenta(
      solicitud({
        codigo: sinUsar.codigo,
        nombre: sinUsar.nombre,
        tipo: sinUsar.tipo,
        naturaleza: 'deudora',
        esDetalle: true,
        requiereAuxiliar: 'empleado',
        moduloDueno: 'rh',
        moneda: null,
        clasificacionNiifId: sinUsar.clasificacionNiifId,
        notaEeffId: sinUsar.notaEeffId,
        activa: true,
      }),
      contexto({ cuenta: sinUsar }),
    )
    expect(resultado.valido).toBe(true)
  })

  it('no deja volver de detalle una acumulativa que tiene hijas', () => {
    const madre = cuentaDe('1.2.01')
    const errores = codigos(
      solicitud({
        codigo: madre.codigo,
        nombre: madre.nombre,
        tipo: madre.tipo,
        naturaleza: madre.naturaleza,
        esDetalle: true,
        requiereAuxiliar: null,
        moduloDueno: null,
        moneda: null,
        ...PPE,
        activa: true,
      }),
      contexto({ cuenta: madre }),
    )
    expect(errores).toContain('CUENTA_CON_HIJAS')
  })
})
