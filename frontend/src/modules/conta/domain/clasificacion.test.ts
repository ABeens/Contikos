import { describe, expect, it } from 'vitest'
import type {
  ClasificacionNiifBase,
  Cuenta,
  NotaEeffBase,
  SolicitudClasificacionNiif,
  SolicitudNotaEeff,
} from '@/shared/api/contracts/conta'
import {
  notasDeClasificacion,
  ordenarClasificaciones,
  referenciaNota,
  validarClasificacion,
  validarClasificacionCuenta,
  validarEliminacionClasificacion,
  validarEliminacionNota,
  validarNota,
  type ContextoCatalogo,
} from './clasificacion'

const CLASIFICACIONES: ClasificacionNiifBase[] = [
  {
    id: 'niif-a-01',
    codigo: 'A.01',
    nombre: 'Efectivo y equivalentes al efectivo',
    estadoFinanciero: 'situacion',
    tiposCuenta: ['activo'],
    seccionNiif: 'Sección 7',
    orden: 10,
    activa: true,
  },
  {
    id: 'niif-r-08',
    codigo: 'R.08',
    nombre: 'Diferencias de cambio, netas',
    estadoFinanciero: 'resultados',
    tiposCuenta: ['ingreso', 'gasto'],
    seccionNiif: 'Sección 30',
    orden: 20,
    activa: true,
  },
  {
    id: 'niif-a-05',
    codigo: 'A.05',
    nombre: 'Otros activos corrientes',
    estadoFinanciero: 'situacion',
    tiposCuenta: ['activo'],
    seccionNiif: 'Sección 4',
    orden: 15,
    activa: true,
  },
  {
    id: 'niif-x-99',
    codigo: 'X.99',
    nombre: 'Renglón retirado',
    estadoFinanciero: 'situacion',
    tiposCuenta: ['activo'],
    seccionNiif: null,
    orden: 99,
    activa: false,
  },
]

const NOTAS: NotaEeffBase[] = [
  {
    id: 'nota-01',
    clasificacionNiifId: 'niif-a-01',
    numero: 1,
    literal: 'a',
    titulo: 'Efectivo en caja',
    descripcion: 'Arqueo por caja.',
    activa: true,
  },
  {
    id: 'nota-01b',
    clasificacionNiifId: 'niif-a-01',
    numero: 1,
    literal: 'b',
    titulo: 'Efectivo en bancos',
    descripcion: 'Saldo por cuenta bancaria.',
    activa: true,
  },
  {
    id: 'nota-15',
    clasificacionNiifId: 'niif-r-08',
    numero: 15,
    literal: '',
    titulo: 'Diferencias de cambio',
    descripcion: 'Efecto neto de la revaluación.',
    activa: true,
  },
]

function cuenta(parcial: Partial<Cuenta> & Pick<Cuenta, 'id'>): Cuenta {
  return {
    codigo: '1.1.01.001',
    nombre: 'Caja general',
    cuentaPadreId: null,
    nivel: 4,
    naturaleza: 'deudora',
    tipo: 'activo',
    esDetalle: true,
    requiereAuxiliar: null,
    esCuentaControl: false,
    moduloDueno: null,
    moneda: null,
    clasificacionNiifId: null,
    notaEeffId: null,
    activa: true,
    ...parcial,
  }
}

const CAJA = cuenta({ id: 'cta-caja' })
const GASTO = cuenta({
  id: 'cta-gasto',
  codigo: '6.1.02.001',
  nombre: 'Alquileres',
  tipo: 'gasto',
})
const ACUMULATIVA = cuenta({
  id: 'cta-1-1-01',
  codigo: '1.1.01',
  nombre: 'Efectivo y equivalentes de efectivo',
  nivel: 3,
  esDetalle: false,
})

function contexto(cuentas: Cuenta[] = []): ContextoCatalogo {
  return { clasificaciones: CLASIFICACIONES, notas: NOTAS, cuentas }
}

const NUEVA: SolicitudClasificacionNiif = {
  codigo: 'A.07',
  nombre: 'Activos intangibles',
  estadoFinanciero: 'situacion',
  tiposCuenta: ['activo'],
  seccionNiif: 'Sección 18',
  orden: 70,
  activa: true,
}

const NUEVA_NOTA: SolicitudNotaEeff = {
  clasificacionNiifId: 'niif-a-01',
  numero: 7,
  literal: '',
  titulo: 'Restricciones sobre el efectivo',
  descripcion: 'Saldos pignorados o de disponibilidad restringida.',
  activa: true,
}

describe('Consultas del catálogo', () => {
  it('ordena por estado financiero y, dentro, por orden', () => {
    const clasificacionDe = (codigo: string) =>
      CLASIFICACIONES.find((c) => c.codigo === codigo)!
    const ordenadas = ordenarClasificaciones([
      clasificacionDe('R.08'),
      clasificacionDe('X.99'),
      clasificacionDe('A.01'),
    ])
    expect(ordenadas.map((c) => c.codigo)).toEqual(['A.01', 'X.99', 'R.08'])
  })

  it('agrupa las notas por su clasificación padre, y ordena por referencia', () => {
    expect(
      notasDeClasificacion('niif-a-01', NOTAS).map(referenciaNota),
    ).toEqual(['1a', '1b'])
    expect(notasDeClasificacion('niif-x-99', NOTAS)).toEqual([])
  })
})

describe('Clasificación NIIF', () => {
  it('acepta un alta con código nuevo', () => {
    expect(validarClasificacion(NUEVA, contexto()).valido).toBe(true)
  })

  it('rechaza un código repetido', () => {
    const r = validarClasificacion(
      { ...NUEVA, codigo: 'a.01' },
      contexto(),
    )
    expect(r.errores.map((e) => e.codigo)).toContain('CODIGO_DUPLICADO')
  })

  it('exige al menos un tipo de cuenta admitido', () => {
    const r = validarClasificacion({ ...NUEVA, tiposCuenta: [] }, contexto())
    expect(r.errores.map((e) => e.codigo)).toContain('TIPOS_CUENTA_REQUERIDOS')
  })

  it('no deja quitar un tipo que ya tiene cuentas clasificadas', () => {
    const clasificada = cuenta({
      id: 'cta-perdida',
      codigo: '6.2.01.002',
      tipo: 'gasto',
      clasificacionNiifId: 'niif-r-08',
    })
    const r = validarClasificacion(
      {
        codigo: 'R.08',
        nombre: 'Diferencias de cambio, netas',
        estadoFinanciero: 'resultados',
        tiposCuenta: ['ingreso'],
        seccionNiif: 'Sección 30',
        orden: 20,
        activa: true,
      },
      contexto([clasificada]),
      'niif-r-08',
    )
    expect(r.errores.map((e) => e.codigo)).toContain('TIPOS_CUENTA_EN_USO')
  })

  it('no deja desactivar una clasificación con cuentas', () => {
    const clasificada = cuenta({
      id: 'cta-caja',
      clasificacionNiifId: 'niif-a-01',
    })
    const r = validarClasificacion(
      {
        codigo: 'A.01',
        nombre: 'Efectivo y equivalentes al efectivo',
        estadoFinanciero: 'situacion',
        tiposCuenta: ['activo'],
        seccionNiif: 'Sección 7',
        orden: 10,
        activa: false,
      },
      contexto([clasificada]),
      'niif-a-01',
    )
    expect(r.errores.map((e) => e.codigo)).toContain('CLASIFICACION_EN_USO')
  })

  it('no se elimina si tiene notas colgando', () => {
    const r = validarEliminacionClasificacion('niif-a-01', contexto())
    expect(r.errores.map((e) => e.codigo)).toContain('CLASIFICACION_CON_NOTAS')
  })

  it('se elimina cuando no tiene ni cuentas ni notas', () => {
    expect(validarEliminacionClasificacion('niif-x-99', contexto()).valido).toBe(
      true,
    )
  })
})

describe('Notas a los EEFF', () => {
  it('acepta un alta con número libre bajo una clasificación existente', () => {
    expect(validarNota(NUEVA_NOTA, contexto()).valido).toBe(true)
  })

  it('rechaza un número ya usado por otra nota', () => {
    const r = validarNota({ ...NUEVA_NOTA, numero: 15 }, contexto())
    expect(r.errores.map((e) => e.codigo)).toContain('NUMERO_DUPLICADO')
  })

  it('admite repetir el número si el literal distingue las dos notas', () => {
    const r = validarNota(
      { ...NUEVA_NOTA, numero: 1, literal: 'c' },
      contexto(),
    )
    expect(r.valido).toBe(true)
  })

  it('rechaza una referencia completa ya usada', () => {
    const r = validarNota(
      { ...NUEVA_NOTA, numero: 1, literal: 'b' },
      contexto(),
    )
    expect(r.errores.map((e) => e.codigo)).toContain('NUMERO_DUPLICADO')
  })

  it('compara la referencia sin distinguir mayúsculas', () => {
    const r = validarNota(
      { ...NUEVA_NOTA, numero: 1, literal: 'B' },
      contexto(),
    )
    expect(r.errores.map((e) => e.codigo)).toContain('NUMERO_DUPLICADO')
  })

  it('rechaza un literal que no son letras', () => {
    const r = validarNota({ ...NUEVA_NOTA, literal: '1.' }, contexto())
    expect(r.errores.map((e) => e.codigo)).toContain('LITERAL_INVALIDO')
  })

  it('exige que la clasificación padre exista', () => {
    const r = validarNota(
      { ...NUEVA_NOTA, clasificacionNiifId: 'niif-inventada' },
      contexto(),
    )
    expect(r.errores.map((e) => e.codigo)).toContain(
      'CLASIFICACION_NO_ENCONTRADA',
    )
  })

  it('no deja colgar una nota activa de una clasificación inactiva', () => {
    const r = validarNota(
      { ...NUEVA_NOTA, clasificacionNiifId: 'niif-x-99' },
      contexto(),
    )
    expect(r.errores.map((e) => e.codigo)).toContain('CLASIFICACION_INACTIVA')
  })

  it('no deja mover de clasificación una nota con cuentas asignadas', () => {
    const asignada = cuenta({
      id: 'cta-caja',
      clasificacionNiifId: 'niif-a-01',
      notaEeffId: 'nota-01',
    })
    const r = validarNota(
      {
        clasificacionNiifId: 'niif-r-08',
        numero: 1,
        literal: 'a',
        titulo: 'Efectivo en caja',
        descripcion: '',
        activa: true,
      },
      contexto([asignada]),
      'nota-01',
    )
    expect(r.errores.map((e) => e.codigo)).toContain('NOTA_EN_USO')
  })

  it('no se elimina una nota que desglosa cuentas', () => {
    const asignada = cuenta({ id: 'cta-caja', notaEeffId: 'nota-01' })
    const r = validarEliminacionNota('nota-01', contexto([asignada]))
    expect(r.errores.map((e) => e.codigo)).toContain('NOTA_EN_USO')
  })
})

describe('Clasificación de una cuenta', () => {
  it('acepta la asignación de renglón y nota compatibles', () => {
    const r = validarClasificacionCuenta(
      CAJA.id,
      { clasificacionNiifId: 'niif-a-01', notaEeffId: 'nota-01' },
      contexto([CAJA]),
    )
    expect(r.valido).toBe(true)
  })

  it('no deja a una cuenta de detalle sin renglón', () => {
    // Su saldo se registraría en el mayor y no llegaría a ningún estado
    // financiero, con la balanza cuadrando mientras tanto.
    const r = validarClasificacionCuenta(
      CAJA.id,
      { clasificacionNiifId: null, notaEeffId: null },
      contexto([CAJA]),
    )
    expect(r.errores.map((e) => e.codigo)).toContain('CLASIFICACION_REQUERIDA')
  })

  it('no deja a una cuenta de detalle sin nota', () => {
    const r = validarClasificacionCuenta(
      CAJA.id,
      { clasificacionNiifId: 'niif-a-01', notaEeffId: null },
      contexto([CAJA]),
    )
    expect(r.errores.map((e) => e.codigo)).toContain('NOTA_REQUERIDA')
  })

  it('señala el renglón sin notas en vez de pedir una nota que no existe', () => {
    // A.05 admite la cuenta, pero no tiene ninguna nota que asignarle: lo que
    // hay que hacer es crearla en el catálogo, no elegirla aquí.
    const r = validarClasificacionCuenta(
      CAJA.id,
      { clasificacionNiifId: 'niif-a-05', notaEeffId: null },
      contexto([CAJA]),
    )
    expect(r.errores.map((e) => e.codigo)).toContain('CLASIFICACION_SIN_NOTAS')
  })

  it('exige que la acumulativa venga sin renglón y sin nota', () => {
    const r = validarClasificacionCuenta(
      ACUMULATIVA.id,
      { clasificacionNiifId: null, notaEeffId: null },
      contexto([ACUMULATIVA]),
    )
    expect(r.valido).toBe(true)
  })

  it('rechaza una nota de otra clasificación', () => {
    const r = validarClasificacionCuenta(
      CAJA.id,
      { clasificacionNiifId: 'niif-a-01', notaEeffId: 'nota-15' },
      contexto([CAJA]),
    )
    expect(r.errores.map((e) => e.codigo)).toContain('NOTA_AJENA')
  })

  it('rechaza un renglón que no admite el tipo de la cuenta', () => {
    const r = validarClasificacionCuenta(
      GASTO.id,
      { clasificacionNiifId: 'niif-a-01', notaEeffId: null },
      contexto([GASTO]),
    )
    expect(r.errores.map((e) => e.codigo)).toContain('TIPO_INCOMPATIBLE')
  })

  it('admite el renglón que reúne dos tipos', () => {
    const r = validarClasificacionCuenta(
      GASTO.id,
      { clasificacionNiifId: 'niif-r-08', notaEeffId: 'nota-15' },
      contexto([GASTO]),
    )
    expect(r.valido).toBe(true)
  })

  it('no clasifica una cuenta acumulativa', () => {
    const r = validarClasificacionCuenta(
      ACUMULATIVA.id,
      { clasificacionNiifId: 'niif-a-01', notaEeffId: null },
      contexto([ACUMULATIVA]),
    )
    expect(r.errores.map((e) => e.codigo)).toContain('CUENTA_NO_DETALLE')
  })

  it('no admite nota sin clasificación', () => {
    const r = validarClasificacionCuenta(
      CAJA.id,
      { clasificacionNiifId: null, notaEeffId: 'nota-01' },
      contexto([CAJA]),
    )
    expect(r.errores.map((e) => e.codigo)).toContain('NOTA_SIN_CLASIFICACION')
  })

  it('rechaza una clasificación inactiva', () => {
    const r = validarClasificacionCuenta(
      CAJA.id,
      { clasificacionNiifId: 'niif-x-99', notaEeffId: null },
      contexto([CAJA]),
    )
    expect(r.errores.map((e) => e.codigo)).toContain('CLASIFICACION_INACTIVA')
  })
})
