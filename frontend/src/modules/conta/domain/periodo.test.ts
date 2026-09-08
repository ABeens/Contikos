import { describe, expect, it } from 'vitest'
import { CUENTAS } from '@/mocks/seed/cuentas'
import type { Asiento, Periodo } from '@/shared/api/contracts/conta'
import {
  type ContextoCierre,
  type CodigoVerificacionCierre,
  decidirCierre,
  validarReapertura,
  verificarCierre,
} from './periodo'

/**
 * Checklist de cierre (docs/03 §5), puro.
 *
 * La fecha de referencia entra por parámetro y no sale del reloj: un checklist
 * que consulta la hora del sistema da un resultado distinto cada mes y no se
 * puede probar.
 */

const FIN_DE_AGOSTO = '2026-09-01'

function periodo(numero: number, cambios: Partial<Periodo> = {}): Periodo {
  const dos = String(numero).padStart(2, '0')
  return {
    id: `per-2026-${dos}`,
    ejercicio: 2026,
    numero,
    fechaInicio: `2026-${dos}-01`,
    fechaFin: `2026-${dos}-28`,
    estado: 'abierto',
    cerradoEn: null,
    cerradoPor: null,
    motivoCierre: null,
    ...cambios,
  }
}

const AGOSTO = periodo(8, { fechaFin: '2026-08-31' })
const JULIO = periodo(7, { fechaFin: '2026-07-31', estado: 'cerrado' })

function asiento(cambios: Partial<Asiento> = {}): Asiento {
  const lineas: Asiento['lineas'] = [
    {
      id: 'lin-0',
      orden: 1,
      cuentaCodigo: '6.1.02.004',
      cuentaNombre: 'Papelería y útiles',
      concepto: '',
      cargo: '100.00',
      abono: '0.00',
      libros: ['fiscal', 'corporativo'],
      centroCosto: null,
      auxiliarTipo: null,
      auxiliarId: null,
      auxiliarNombre: null,
    },
    {
      id: 'lin-1',
      orden: 2,
      cuentaCodigo: '1.1.01.002',
      cuentaNombre: 'Caja chica',
      concepto: '',
      cargo: '0.00',
      abono: '100.00',
      libros: ['fiscal', 'corporativo'],
      centroCosto: null,
      auxiliarTipo: null,
      auxiliarId: null,
      auxiliarNombre: null,
    },
  ]
  return {
    id: 'asi-2026-000001',
    numero: 1,
    ejercicio: 2026,
    codigo: 'AS-2026-000001',
    fecha: '2026-08-10',
    concepto: 'Asiento de prueba',
    origenModulo: null,
    origenTipo: null,
    origenId: null,
    moneda: 'CRC',
    tipoCambio: '1.00',
    estado: 'contabilizado',
    reversaDeId: null,
    reversadoPorId: null,
    motivoReversa: null,
    documentoRelacionado: null,
    libros: ['fiscal', 'corporativo'],
    totales: [
      { libro: 'fiscal', totalCargos: '100.00', totalAbonos: '100.00' },
      { libro: 'corporativo', totalCargos: '100.00', totalAbonos: '100.00' },
    ],
    lineas,
    creadoPor: 'demo@contikos.cr',
    creadoEn: '2026-08-10T09:00:00Z',
    ...cambios,
  }
}

function contexto(extra: Partial<ContextoCierre> = {}): ContextoCierre {
  return {
    periodos: [JULIO, AGOSTO],
    asientos: [asiento()],
    cuentas: CUENTAS,
    fechaReferencia: FIN_DE_AGOSTO,
    depreciacion: { contabilizada: true, activosDepreciables: 3 },
    ...extra,
  }
}

const punto = (
  periodoDado: Periodo,
  contextoDado: ContextoCierre,
  codigo: CodigoVerificacionCierre,
) =>
  verificarCierre(periodoDado, contextoDado).verificaciones.filter(
    (v) => v.codigo === codigo,
  )

describe('Checklist de cierre de periodo', () => {
  it('enseña los puntos que están bien, no solo los que fallan', () => {
    const resultado = verificarCierre(AGOSTO, contexto())
    expect(resultado.puedeCerrar).toBe(true)
    expect(resultado.verificaciones.every((v) => v.severidad === 'ok')).toBe(
      true,
    )
    // Los tres módulos que aún no existen ocupan su sitio en el checklist.
    for (const codigo of [
      'NOMINA_PENDIENTE',
      'BANCOS_SIN_CONCILIAR',
      'REVALUACION_PENDIENTE',
    ] as const) {
      expect(punto(AGOSTO, contexto(), codigo)[0].detalle).toBe(
        'El módulo aún no existe',
      )
    }
  })

  it('no cierra un periodo que ya está cerrado ni uno bloqueado', () => {
    for (const estado of ['cerrado', 'bloqueado'] as const) {
      const cerrado = periodo(8, { fechaFin: '2026-08-31', estado })
      expect(verificarCierre(cerrado, contexto()).puedeCerrar).toBe(false)
      expect(punto(cerrado, contexto(), 'PERIODO_YA_CERRADO')[0].severidad).toBe(
        'error',
      )
    }
  })

  it('los meses se cierran en orden: el anterior no puede seguir abierto', () => {
    const julioAbierto = { ...JULIO, estado: 'abierto' as const }
    const conJulioAbierto = contexto({ periodos: [julioAbierto, AGOSTO] })
    expect(verificarCierre(AGOSTO, conJulioAbierto).puedeCerrar).toBe(false)
    expect(
      punto(AGOSTO, conJulioAbierto, 'PERIODO_ANTERIOR_ABIERTO')[0].severidad,
    ).toBe('error')

    // Enero no espera a un diciembre del ejercicio anterior: al cerrar el
    // ejercicio, sus periodos quedan bloqueados (docs/03 §6).
    const enero = periodo(1, { fechaFin: '2026-01-31' })
    const conEnero = contexto({
      periodos: [enero],
      fechaReferencia: '2026-02-01',
    })
    expect(punto(enero, conEnero, 'PERIODO_ANTERIOR_ABIERTO')[0].severidad).toBe(
      'ok',
    )
  })

  it('no cierra un mes que todavía está en curso', () => {
    const enCurso = contexto({ fechaReferencia: '2026-08-20' })
    expect(verificarCierre(AGOSTO, enCurso).puedeCerrar).toBe(false)
    const fecha = punto(AGOSTO, enCurso, 'FECHA_FUTURA')[0]
    expect(fecha.severidad).toBe('error')
    expect(fecha.detalle).toContain('2026-08-20')

    // El último día del periodo ya vale: el mes terminó.
    expect(
      punto(
        AGOSTO,
        contexto({ fechaReferencia: '2026-08-31' }),
        'FECHA_FUTURA',
      )[0].severidad,
    ).toBe('ok')
  })

  it('detecta el asiento cuyo origen dice ser del periodo y está fechado fuera', () => {
    const desviado = asiento({
      id: 'asi-2026-000002',
      codigo: 'AS-2026-000002',
      fecha: '2026-09-02',
      origenModulo: 'activos',
      origenTipo: 'depreciacion',
      origenId: 'dep-2026-08',
    })
    const conDesviado = contexto({ asientos: [asiento(), desviado] })
    const rango = punto(AGOSTO, conDesviado, 'ASIENTOS_FUERA_DE_RANGO')[0]
    expect(rango.severidad).toBe('error')
    expect(rango.detalle).toContain('AS-2026-000002')
    expect(verificarCierre(AGOSTO, conDesviado).puedeCerrar).toBe(false)
  })

  it('el descuadre de un libro impide cerrar, libro por libro', () => {
    // Una línea que solo entra en la corporativa descuadra ese libro y deja el
    // fiscal intacto: por eso el punto se comprueba por separado en cada uno.
    const base = asiento()
    const cojo = asiento({
      id: 'asi-2026-000003',
      codigo: 'AS-2026-000003',
      lineas: [
        { ...base.lineas[0], libros: ['corporativo'] },
        base.lineas[1],
      ],
    })
    const resultado = verificarCierre(AGOSTO, contexto({ asientos: [cojo] }))
    const balanzas = resultado.verificaciones.filter(
      (v) => v.codigo === 'BALANZA_DESCUADRADA',
    )
    expect(balanzas).toHaveLength(2)
    expect(balanzas.filter((v) => v.severidad === 'error')).toHaveLength(1)
    expect(resultado.puedeCerrar).toBe(false)
  })

  it('la depreciación sin correr es aviso, y no lo es si no hay qué depreciar', () => {
    const sinCorrer = contexto({
      depreciacion: { contabilizada: false, activosDepreciables: 3 },
    })
    expect(punto(AGOSTO, sinCorrer, 'DEPRECIACION_PENDIENTE')[0].severidad).toBe(
      'aviso',
    )
    // Un aviso no impide cerrar: exige que alguien lo lea.
    expect(verificarCierre(AGOSTO, sinCorrer).puedeCerrar).toBe(true)

    const nadaQueDepreciar = contexto({
      depreciacion: { contabilizada: false, activosDepreciables: 0 },
    })
    expect(
      punto(AGOSTO, nadaQueDepreciar, 'DEPRECIACION_PENDIENTE')[0].severidad,
    ).toBe('ok')
  })

  it('avisa del saldo de una cuenta de control que no está en ningún auxiliar', () => {
    // Un movimiento contra Clientes sin decir de qué cliente: ese saldo no
    // está en el auxiliar de nadie.
    const base = asiento()
    const sinAuxiliar = asiento({
      lineas: [
        {
          ...base.lineas[0],
          cuentaCodigo: '1.1.02.001',
          cuentaNombre: 'Clientes',
        },
        base.lineas[1],
      ],
    })
    const resultado = verificarCierre(
      AGOSTO,
      contexto({ asientos: [sinAuxiliar] }),
    )
    const auxiliares = resultado.verificaciones.find(
      (v) => v.codigo === 'AUXILIARES_SIN_CUADRAR',
    )!
    expect(auxiliares.severidad).toBe('aviso')
    expect(auxiliares.detalle).toContain('1.1.02.001')
  })
})

describe('Decisión de cierre', () => {
  const conAviso = contexto({
    depreciacion: { contabilizada: false, activosDepreciables: 3 },
  })

  it('un error no se salta de ninguna manera', () => {
    const resultado = verificarCierre(
      AGOSTO,
      contexto({ fechaReferencia: '2026-08-20' }),
    )
    const decision = decidirCierre(resultado, {
      confirmarAvisos: true,
      motivo: 'Da igual lo que se escriba aquí',
    })
    expect(decision).toMatchObject({
      ok: false,
      error: { codigo: 'CIERRE_CON_ERRORES' },
    })
  })

  it('los avisos exigen confirmación y motivo, y así sí cierran', () => {
    const resultado = verificarCierre(AGOSTO, conAviso)
    expect(
      decidirCierre(resultado, { confirmarAvisos: false, motivo: '' }),
    ).toMatchObject({ ok: false, error: { codigo: 'CIERRE_CON_AVISOS' } })
    expect(
      decidirCierre(resultado, { confirmarAvisos: true, motivo: '  ' }),
    ).toMatchObject({ ok: false, error: { codigo: 'MOTIVO_CIERRE_REQUERIDO' } })

    const autorizado = decidirCierre(resultado, {
      confirmarAvisos: true,
      motivo: 'La corrida de depreciación va en setiembre',
    })
    expect(autorizado.ok).toBe(true)
  })

  it('sin avisos no hace falta confirmar nada', () => {
    const decision = decidirCierre(verificarCierre(AGOSTO, contexto()), {
      confirmarAvisos: false,
      motivo: '',
    })
    expect(decision.ok).toBe(true)
  })
})

describe('Reapertura', () => {
  it('solo se reabre lo cerrado', () => {
    expect(validarReapertura({ ...AGOSTO, estado: 'cerrado' }).valido).toBe(true)
  })

  it('un periodo bloqueado no vuelve nunca', () => {
    const bloqueado = validarReapertura({ ...AGOSTO, estado: 'bloqueado' })
    expect(bloqueado.valido).toBe(false)
    expect(bloqueado.error?.codigo).toBe('PERIODO_NO_REABRIBLE')
  })

  it('reabrir lo que ya está abierto tampoco es reabrir', () => {
    expect(validarReapertura(AGOSTO).valido).toBe(false)
  })
})
