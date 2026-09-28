import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  avisosActuales,
  descartarAviso,
  notificar,
  suscribirAvisos,
} from './avisos'

afterEach(() => {
  for (const a of avisosActuales()) descartarAviso(a.id)
})

describe('avisos', () => {
  it('avisa a los suscritos y descarta por id', () => {
    const oyente = vi.fn()
    const baja = suscribirAvisos(oyente)

    const id = notificar('Cliente guardado')
    expect(avisosActuales()).toEqual([
      { id, titulo: 'Cliente guardado', descripcion: undefined, tono: 'exito' },
    ])
    expect(oyente).toHaveBeenCalledTimes(1)

    descartarAviso(id)
    expect(avisosActuales()).toEqual([])
    expect(oyente).toHaveBeenCalledTimes(2)

    baja()
    notificar('Otro')
    expect(oyente).toHaveBeenCalledTimes(2)
  })

  it('no acumula más de tres: se van los más viejos', () => {
    for (const t of ['a', 'b', 'c', 'd']) notificar(t)
    expect(avisosActuales().map((a) => a.titulo)).toEqual(['b', 'c', 'd'])
  })
})
