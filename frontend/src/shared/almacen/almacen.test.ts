import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMPRESA_INICIAL,
  empresaActiva,
  establecerEmpresaActiva,
  leerDeEmpresa,
  restablecerAlmacen,
  tabla,
  tablaGlobal,
} from './almacen'

/**
 * Pruebas del almacén.
 *
 * Lo que se comprueba no es que `localStorage` funcione, sino las tres cosas
 * que hacen que se pueda confiar en él como sustituto de una base de datos:
 * que la semilla solo se use cuando no hay nada, que lo guardado sobreviva a
 * volver a arrancar, y que un fallo de almacenamiento no tumbe la aplicación.
 */

interface Fila {
  id: string
  nombre: string
}

const SEMILLA: Fila[] = [{ id: 'a', nombre: 'Alfa' }]

function semilla(): Fila[] {
  return SEMILLA.map((f) => ({ ...f }))
}

/** Cada prueba arranca con el navegador limpio y en la empresa inicial. */
beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
  establecerEmpresaActiva(EMPRESA_INICIAL)
})

describe('tabla', () => {
  it('siembra cuando no hay nada guardado y deja la semilla escrita', () => {
    const t = tabla('prueba.siembra', semilla)

    expect(t.filas).toEqual(SEMILLA)
    // Sembrar y no guardar dejaría la pantalla y el almacén diciendo cosas
    // distintas desde el primer arranque.
    expect(window.localStorage.length).toBeGreaterThan(0)
  })

  it('al volver a montarse lee lo guardado y no la semilla', () => {
    const primera = tabla('prueba.persiste', semilla)
    primera.filas.push({ id: 'b', nombre: 'Beta' })
    primera.persistir()

    // Una tabla nueva sobre el mismo nombre es lo que ocurre al recargar.
    const segunda = tabla<Fila>('prueba.persiste', semilla)

    expect(segunda.filas.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('no guarda lo mutado hasta que se persiste', () => {
    const t = tabla('prueba.explicita', semilla)
    t.filas.push({ id: 'b', nombre: 'Beta' })

    expect(tabla<Fila>('prueba.explicita', semilla).filas).toHaveLength(1)
  })

  it('conserva la referencia del array al reemplazar el contenido', () => {
    const t = tabla('prueba.referencia', semilla)
    // Media aplicación importa este array por referencia: sustituirlo dejaría
    // a los demás módulos leyendo el anterior.
    const referencia = t.filas

    t.reemplazar([{ id: 'z', nombre: 'Zeta' }])

    expect(t.filas).toBe(referencia)
    expect(referencia.map((f) => f.id)).toEqual(['z'])
  })

  it('descarta un contenido corrupto y vuelve a sembrar', () => {
    const t = tabla('prueba.corrupta', semilla)
    t.persistir()

    const clave = Object.keys(window.localStorage).find((k) =>
      k.endsWith('prueba.corrupta'),
    )!
    window.localStorage.setItem(clave, '{esto no es json')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(tabla<Fila>('prueba.corrupta', semilla).filas).toEqual(SEMILLA)
  })

  it('sigue funcionando en memoria si no se puede guardar', () => {
    // Cuota agotada o navegación privada: se pierde la persistencia, no la
    // sesión de trabajo.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cuota', 'QuotaExceededError')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const t = tabla('prueba.cuota', semilla)
    t.filas.push({ id: 'b', nombre: 'Beta' })

    expect(() => t.persistir()).not.toThrow()
    expect(t.filas).toHaveLength(2)
  })
})

describe('multiempresa', () => {
  it('la semilla recibe la empresa para la que siembra', () => {
    const t = tabla<Fila>('prueba.semilla-empresa', (empresa) => [
      { id: empresa, nombre: empresa },
    ])

    expect(t.filas.map((f) => f.id)).toEqual([EMPRESA_INICIAL])
    establecerEmpresaActiva('emp-b')
    expect(t.filas.map((f) => f.id)).toEqual(['emp-b'])
  })

  it('cambiar de empresa recarga las colecciones en su sitio y separa los datos', () => {
    const t = tabla('prueba.aislada', semilla)
    const referencia = t.filas
    t.filas.push({ id: 'b', nombre: 'Beta' })
    t.persistir()

    establecerEmpresaActiva('emp-b')

    // La otra empresa arranca de la semilla, y quien importó el array sigue
    // teniendo el mismo array.
    expect(empresaActiva()).toBe('emp-b')
    expect(t.filas).toBe(referencia)
    expect(t.filas.map((f) => f.id)).toEqual(['a'])

    t.filas.push({ id: 'z', nombre: 'Zeta' })
    t.persistir()

    // Al volver, lo que se guardó en cada una sigue siendo de cada una.
    establecerEmpresaActiva(EMPRESA_INICIAL)
    expect(t.filas.map((f) => f.id)).toEqual(['a', 'b'])
    establecerEmpresaActiva('emp-b')
    expect(t.filas.map((f) => f.id)).toEqual(['a', 'z'])
  })

  it('avisa a la tabla cuando su contenido cambia de golpe', () => {
    const vistos: string[][] = []
    const t = tabla('prueba.alcambiar', semilla, {
      alCambiar: (filas) => vistos.push(filas.map((f) => f.id)),
    })

    establecerEmpresaActiva('emp-b')
    t.reemplazar([{ id: 'z', nombre: 'Zeta' }])
    t.restablecer()

    expect(vistos).toEqual([['a'], ['z'], ['a']])
  })

  it('recuerda la empresa activa entre arranques', () => {
    establecerEmpresaActiva('emp-b')
    expect(window.localStorage.getItem('contikos.empresa-activa')).toBe('emp-b')
  })

  it('una colección del grupo no cambia con la empresa', () => {
    const g = tablaGlobal('prueba.grupo', semilla)
    g.filas.push({ id: 'b', nombre: 'Beta' })
    g.persistir()

    establecerEmpresaActiva('emp-b')

    expect(g.filas.map((f) => f.id)).toEqual(['a', 'b'])
    expect(
      Object.keys(window.localStorage).some((k) => k.includes('.grupo.prueba.grupo')),
    ).toBe(true)
  })

  it('lee de otra empresa sin abrirla: lo guardado, o lo que sembraría', () => {
    const t = tabla('prueba.cruzada', semilla)
    t.filas.push({ id: 'b', nombre: 'Beta' })
    t.persistir()

    // Una empresa que nunca se abrió no tiene nada guardado: se ve su semilla.
    expect(leerDeEmpresa<Fila>('emp-b', 'prueba.cruzada').map((f) => f.id)).toEqual(['a'])

    establecerEmpresaActiva('emp-b')
    // De la que se dejó atrás se lee lo guardado, incluido lo que se añadió.
    expect(
      leerDeEmpresa<Fila>(EMPRESA_INICIAL, 'prueba.cruzada').map((f) => f.id),
    ).toEqual(['a', 'b'])
    // De la activa, lo vivo, aunque no esté persistido.
    t.filas.push({ id: 'z', nombre: 'Zeta' })
    expect(leerDeEmpresa<Fila>('emp-b', 'prueba.cruzada').map((f) => f.id)).toEqual(['a', 'z'])
    // Y siempre una copia: escribir en otra empresa no es posible desde aquí.
    expect(leerDeEmpresa<Fila>('emp-b', 'prueba.cruzada')).not.toBe(t.filas)
  })
})

describe('restablecerAlmacen', () => {
  it('devuelve las colecciones a su semilla', () => {
    const t = tabla('prueba.reinicio', semilla)
    t.filas.push({ id: 'b', nombre: 'Beta' })
    t.persistir()

    restablecerAlmacen()

    expect(t.filas).toEqual(SEMILLA)
    expect(tabla<Fila>('prueba.reinicio', semilla).filas).toEqual(SEMILLA)
  })

  it('borra lo que quedó de formatos anteriores', () => {
    window.localStorage.setItem('contikos.v0.emp-001.viejo', '[]')
    tabla('prueba.barrido', semilla)

    restablecerAlmacen()

    expect(window.localStorage.getItem('contikos.v0.emp-001.viejo')).toBeNull()
  })

  it('vuelve a la empresa inicial y barre las demás', () => {
    const t = tabla('prueba.fabrica', semilla)
    establecerEmpresaActiva('emp-b')
    t.filas.push({ id: 'z', nombre: 'Zeta' })
    t.persistir()

    restablecerAlmacen()

    expect(empresaActiva()).toBe(EMPRESA_INICIAL)
    expect(t.filas).toEqual(SEMILLA)
    expect(
      Object.keys(window.localStorage).some((k) => k.includes('.emp-b.')),
    ).toBe(false)
  })
})
