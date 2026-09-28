import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, CornerDownLeft, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import {
  ACCIONES_FRECUENTES,
  CONFIGURACION,
  INICIO,
  MODULOS,
  type ItemMenu,
} from './menu'

interface Entrada {
  ruta: string
  etiqueta: string
  grupo: string
  icono: LucideIcon
  /** Texto en el que se busca, sin tildes ni mayúsculas. */
  indice: string
}

/** "Conciliación" y "conciliacion" son la misma búsqueda. */
function normalizar(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function entradasDe(modulo: ItemMenu): Entrada[] {
  const pantallas = modulo.hijos ?? [{ ruta: modulo.ruta, etiqueta: modulo.etiqueta }]
  return pantallas.map((p) => ({
    ruta: p.ruta,
    etiqueta: p.etiqueta,
    grupo: modulo.etiqueta,
    icono: modulo.icono,
    indice: normalizar(`${p.etiqueta} ${modulo.etiqueta} ${modulo.descripcion}`),
  }))
}

const ENTRADAS: Entrada[] = [
  ...ACCIONES_FRECUENTES.map((a) => ({
    ruta: a.ruta,
    etiqueta: a.etiqueta,
    grupo: 'Acciones',
    icono: a.icono,
    indice: normalizar(`${a.etiqueta} ${a.descripcion} nuevo nueva`),
  })),
  {
    ruta: INICIO.ruta,
    etiqueta: 'Resumen',
    grupo: 'Inicio',
    icono: INICIO.icono,
    indice: normalizar('inicio resumen portada'),
  },
  ...MODULOS.flatMap(entradasDe),
  ...entradasDe(CONFIGURACION),
]

/**
 * Buscador de pantallas y acciones (Ctrl+K).
 *
 * Con veintitantas pantallas repartidas en ocho módulos, saber dónde vive
 * cada una no debería ser requisito para usarla: se escribe lo que se quiere
 * hacer ("cobro", "balanza", "tipo de cambio") y Enter lleva allí.
 */
export function PaletaComandos({
  abierta,
  onCambiar,
}: {
  abierta: boolean
  onCambiar: (abierta: boolean) => void
}) {
  return (
    <Dialog.Root open={abierta} onOpenChange={onCambiar}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-aparecer bg-slate-900/30 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[70vh] w-[min(94vw,36rem)] -translate-x-1/2 animate-subir flex-col overflow-hidden rounded-2xl bg-white shadow-flotante ring-1 ring-slate-200 focus:outline-none"
        >
          <Dialog.Title className="sr-only">Ir a una pantalla</Dialog.Title>
          {/* Se monta al abrir: cada vez empieza con la búsqueda vacía. */}
          <Buscador onIr={() => onCambiar(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Buscador({ onIr }: { onIr: () => void }) {
  const navegar = useNavigate()
  const [consulta, setConsulta] = useState('')
  const [activa, setActiva] = useState(0)
  const lista = useRef<HTMLUListElement>(null)

  const resultados = useMemo(() => {
    const palabras = normalizar(consulta).split(/\s+/).filter(Boolean)
    if (palabras.length === 0) return ENTRADAS
    // Primero lo que coincide en el nombre de la pantalla; después lo que
    // solo coincide en el módulo o la descripción. "conciliación" debe dar
    // Conciliación antes que las demás pantallas de Bancos.
    const relevancia = (e: Entrada) => {
      const nombre = normalizar(e.etiqueta)
      if (nombre.startsWith(palabras[0])) return 0
      if (palabras.every((p) => nombre.includes(p))) return 1
      return 2
    }
    return ENTRADAS.filter((e) => palabras.every((p) => e.indice.includes(p)))
      .map((e, i) => ({ e, i, r: relevancia(e) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(({ e }) => e)
  }, [consulta])

  const ir = (entrada: Entrada | undefined) => {
    if (!entrada) return
    onIr()
    void navegar(entrada.ruta)
  }

  const mover = (delta: number) => {
    if (resultados.length === 0) return
    const siguiente = (activa + delta + resultados.length) % resultados.length
    setActiva(siguiente)
    lista.current
      ?.querySelector(`[data-indice="${siguiente}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  const alTeclear = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      mover(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      mover(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      ir(resultados[activa])
    }
  }

  const idLista = 'paleta-resultados'
  const idOpcion = (i: number) => `paleta-opcion-${i}`

  return (
    <>
      <div className="flex items-center gap-3 border-b border-slate-100 px-4">
        <Search className="size-4 shrink-0 text-slate-400" aria-hidden />
        <input
          autoFocus
          value={consulta}
          onChange={(e) => {
            setConsulta(e.target.value)
            setActiva(0)
          }}
          onKeyDown={alTeclear}
          placeholder="¿Qué quiere hacer? Ej.: cobro, balanza, proveedor"
          role="combobox"
          aria-label="Buscar pantalla o acción"
          aria-expanded
          aria-controls={idLista}
          aria-activedescendant={
            resultados.length > 0 ? idOpcion(activa) : undefined
          }
          className="h-13 min-w-0 flex-1 bg-transparent text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
        <kbd className="hidden rounded-md bg-slate-100 px-1.5 py-0.5 font-sans text-[11px] text-slate-500 sm:block">
          Esc
        </kbd>
      </div>

      {resultados.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate-500">
          Nada coincide con «{consulta.trim()}».
        </p>
      ) : (
        <ul
          ref={lista}
          id={idLista}
          role="listbox"
          aria-label="Resultados"
          className="overflow-y-auto p-2"
        >
          {resultados.map((entrada, i) => {
            // Con búsqueda el orden es por relevancia y los grupos se
            // mezclan: el módulo va junto al nombre, no como encabezado.
            const nuevoGrupo =
              !consulta.trim() &&
              (i === 0 || resultados[i - 1].grupo !== entrada.grupo)
            const Icono = entrada.icono
            const esActiva = i === activa
            return (
              <li key={`${entrada.grupo}-${entrada.ruta}`} role="presentation">
                {nuevoGrupo && (
                  <p
                    aria-hidden
                    className="px-2.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase"
                  >
                    {entrada.grupo}
                  </p>
                )}
                <div
                  id={idOpcion(i)}
                  data-indice={i}
                  role="option"
                  aria-selected={esActiva}
                  onMouseMove={() => setActiva(i)}
                  onClick={() => ir(entrada)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
                    esActiva ? 'bg-brand-50 text-brand-900' : 'text-slate-700',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-7 shrink-0 place-items-center rounded-md transition-colors',
                      esActiva
                        ? 'bg-brand-600 text-white'
                        : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    <Icono className="size-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {entrada.etiqueta}
                    {entrada.grupo !== 'Acciones' &&
                      entrada.grupo !== entrada.etiqueta && (
                        <span className="text-slate-400"> · {entrada.grupo}</span>
                      )}
                  </span>
                  {esActiva ? (
                    <CornerDownLeft className="size-3.5 text-brand-500" aria-hidden />
                  ) : (
                    <ArrowRight className="size-3.5 text-transparent" aria-hidden />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="hidden items-center gap-4 border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-500 sm:flex">
        <span>
          <Tecla>↑</Tecla> <Tecla>↓</Tecla> moverse
        </span>
        <span>
          <Tecla>Enter</Tecla> abrir
        </span>
      </div>
    </>
  )
}

function Tecla({ children }: { children: string }) {
  return (
    <kbd className="rounded bg-white px-1 py-0.5 font-sans ring-1 ring-slate-200">
      {children}
    </kbd>
  )
}
