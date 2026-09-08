import { describe, expect, it } from 'vitest'
import {
  auxiliaresVigentes,
  buscarAuxiliar,
  etiquetaAuxiliar,
  resolverAuxiliar,
  textoAuxiliar,
  tieneCatalogo,
} from './auxiliar'
import type { Auxiliar } from './auxiliar'

/**
 * Lo que se prueba aquí es una sola cosa: que lo que el usuario tecleó apunte a
 * la ficha que él cree. Equivocarse en esto no da error, da un asiento
 * contabilizado contra otro cliente.
 */

const CLIENTES: Auxiliar[] = [
  {
    tipo: 'cliente',
    id: 'cli-001',
    codigo: 'C-001',
    nombre: 'Inversiones Tecnológicas del Valle S.A.',
    identificacion: '3101456789',
    activo: true,
  },
  {
    tipo: 'cliente',
    id: 'cli-002',
    codigo: 'C-002',
    nombre: 'Comercial La Sabana S.A.',
    identificacion: '3101223344',
    activo: true,
  },
  {
    tipo: 'cliente',
    id: 'cli-009',
    codigo: 'C-009',
    nombre: 'Distribuidora Cerrada S.A.',
    identificacion: '3101778899',
    activo: false,
  },
]

describe('resolverAuxiliar', () => {
  it('resuelve lo que deja el buscador: código y nombre juntos', () => {
    const elegido = resolverAuxiliar(
      CLIENTES,
      textoAuxiliar(CLIENTES[1]),
    )
    expect(elegido?.id).toBe('cli-002')
  })

  it('resuelve el código suelto, que es como se captura de memoria', () => {
    expect(resolverAuxiliar(CLIENTES, 'C-002')?.id).toBe('cli-002')
    expect(resolverAuxiliar(CLIENTES, ' c-002 ')?.id).toBe('cli-002')
  })

  it('resuelve el nombre suelto, sin tildes ni mayúsculas', () => {
    expect(
      resolverAuxiliar(CLIENTES, 'inversiones tecnologicas del valle s.a.')?.id,
    ).toBe('cli-001')
  })

  it('resuelve el id, que es lo que traen los asientos ya contabilizados', () => {
    expect(resolverAuxiliar(CLIENTES, 'cli-001')?.id).toBe('cli-001')
  })

  it('resuelve la cédula, que es lo que trae el documento', () => {
    expect(resolverAuxiliar(CLIENTES, '3101223344')?.id).toBe('cli-002')
  })

  it('resuelve un texto parcial si identifica a una sola ficha', () => {
    // Media razón social, sin tildes ni mayúsculas
    expect(resolverAuxiliar(CLIENTES, 'sabana')?.id).toBe('cli-002')
    expect(resolverAuxiliar(CLIENTES, 'Tecnologicas')?.id).toBe('cli-001')
    // Prefijo del nombre y de la cédula
    expect(resolverAuxiliar(CLIENTES, 'Distrib')?.id).toBe('cli-009')
    expect(resolverAuxiliar(CLIENTES, '31017')?.id).toBe('cli-009')
  })

  it('no adivina entre varias coincidencias ni resuelve el vacío', () => {
    // "S.A." está en las tres razones sociales
    expect(resolverAuxiliar(CLIENTES, 'S.A.')).toBeUndefined()
    expect(resolverAuxiliar(CLIENTES, '')).toBeUndefined()
    expect(resolverAuxiliar(CLIENTES, '   ')).toBeUndefined()
    expect(resolverAuxiliar(CLIENTES, 'Un cliente que no existe')).toBeUndefined()
  })
})

describe('buscarAuxiliar', () => {
  it('distingue "ninguno" de "varios": la pantalla avisa distinto', () => {
    expect(buscarAuxiliar(CLIENTES, 'zzz')).toEqual({ estado: 'ninguno' })

    const varios = buscarAuxiliar(CLIENTES, 'C-0')
    expect(varios.estado).toBe('ambiguo')
    if (varios.estado === 'ambiguo') {
      expect(varios.coincidencias.map((a) => a.id)).toEqual([
        'cli-001',
        'cli-002',
        'cli-009',
      ])
    }
  })

  it('la coincidencia exacta gana aunque sea prefijo de otra ficha', () => {
    const conPrefijo: Auxiliar[] = [
      ...CLIENTES,
      {
        tipo: 'cliente',
        id: 'cli-020',
        codigo: 'C-0020',
        nombre: 'Comercial La Sabana Norte S.A.',
        activo: true,
      },
    ]
    // "C-002" es exacto de cli-002 y prefijo de C-0020
    expect(buscarAuxiliar(conPrefijo, 'C-002')).toMatchObject({
      estado: 'unico',
      auxiliar: { id: 'cli-002' },
    })
    // Y el nombre completo también, aunque otro lo contenga
    expect(buscarAuxiliar(conPrefijo, 'Comercial La Sabana S.A.')).toMatchObject({
      estado: 'unico',
      auxiliar: { id: 'cli-002' },
    })
    // Mientras que "Sabana" a secas ya es ambiguo
    expect(buscarAuxiliar(conPrefijo, 'Sabana').estado).toBe('ambiguo')
  })

  it('la cédula acompaña a la opción sin entrar en el valor', () => {
    expect(textoAuxiliar(CLIENTES[1])).toBe('C-002 · Comercial La Sabana S.A.')
    expect(etiquetaAuxiliar(CLIENTES[1])).toBe('3101223344')
    expect(
      etiquetaAuxiliar({
        tipo: 'activo',
        id: 'act-001',
        codigo: 'ACT-001',
        nombre: 'Servidor',
        activo: true,
      }),
    ).toBeUndefined()
  })
})

describe('catálogo ofrecido', () => {
  it('no ofrece las fichas inactivas, pero las sigue resolviendo', () => {
    expect(auxiliaresVigentes(CLIENTES).map((a) => a.id)).toEqual([
      'cli-001',
      'cli-002',
    ])
    // Un asiento viejo contra un cliente ya cerrado se tiene que poder leer.
    expect(resolverAuxiliar(CLIENTES, 'C-009')?.id).toBe('cli-009')
  })
})

describe('tipos con catálogo', () => {
  it('solo son buscables los que tienen módulo (docs/11)', () => {
    expect(tieneCatalogo('cliente')).toBe(true)
    expect(tieneCatalogo('proveedor')).toBe(true)
    expect(tieneCatalogo('activo')).toBe(true)
    expect(tieneCatalogo('empleado')).toBe(false)
    expect(tieneCatalogo('banco')).toBe(false)
  })
})
