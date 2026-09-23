import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MoneyInput } from './MoneyInput'

function Campo({ alCambiar }: { alCambiar?: (v: string) => void }) {
  const [valor, setValor] = useState('')
  return (
    <MoneyInput
      aria-label="Importe"
      moneda="CRC"
      value={valor}
      onChange={(v) => {
        setValor(v)
        alCambiar?.(v)
      }}
    />
  )
}

describe('MoneyInput', () => {
  it('conserva lo que no es un importe y lo marca como inválido', async () => {
    const usuario = userEvent.setup()
    const emitidos: string[] = []
    render(<Campo alCambiar={(v) => emitidos.push(v)} />)

    const campo = screen.getByRole('textbox', { name: 'Importe' })
    await usuario.type(campo, '12a')
    await usuario.tab()

    // No se borra en silencio: sigue escrito y marcado, y hacia fuera el
    // campo queda sin valor.
    expect(campo).toHaveValue('12a')
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    expect(emitidos.at(-1)).toBe('')

    // Al corregirlo, la marca desaparece y el importe se formatea.
    await usuario.click(campo)
    expect(campo).toHaveValue('12a')
    await usuario.clear(campo)
    await usuario.type(campo, '1500')
    await usuario.tab()
    expect(campo).not.toHaveAttribute('aria-invalid', 'true')
    expect(emitidos.at(-1)).toBe('1500')
  })
})
