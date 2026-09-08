import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Search, Undo2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Input, Select } from '@/shared/ui/Field'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { formatFecha, formatPeriodo } from '@/shared/format/fecha'
import type { Libro } from '@/shared/api/contracts/comunes'
import type { Asiento } from '@/shared/api/contracts/conta'
import { useEmpresa } from '@/app/empresa'
import { useAsiento, useAsientos } from '../api/queries'
import { PanelAsiento } from '@/shared/asiento/PanelAsiento'
import { EtiquetaLibros } from '@/shared/asiento/Libros'
import { LIBROS, esLibro, etiquetaLibro } from '@/shared/asiento/libro'
import { DialogoReversa } from '../components/DialogoReversa'

export function AsientosPage() {
  const { periodoActivo, cargando: cargandoPeriodos } = useEmpresa()
  const [parametros, setParametros] = useSearchParams()
  // Se guarda el id y no el asiento: tras reversar, el original cambia de
  // estado y el panel tiene que enseñar la versión nueva, no la que se hizo
  // clic. Y el enlace a la reversa puede apuntar a otro periodo, que no está
  // en la lista: ese se pide aparte.
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null)
  const [reversando, setReversando] = useState(false)

  // Los filtros viven en la URL: un contador debe poder enviar el enlace
  // a la vista que está mirando (docs/14 §6).
  const filtro = parametros.get('q') ?? ''
  const setFiltro = (valor: string) => {
    const nuevos = new URLSearchParams(parametros)
    if (valor) nuevos.set('q', valor)
    else nuevos.delete('q')
    setParametros(nuevos, { replace: true })
  }

  // Sin filtro se ven las dos contabilidades juntas. Es la única pantalla donde
  // conviven, y es donde se detecta que un asiento entró a un solo libro.
  const parametroLibro = parametros.get('libro')
  const libro: Libro | undefined = esLibro(parametroLibro)
    ? parametroLibro
    : undefined
  const setLibro = (valor: string) => {
    const nuevos = new URLSearchParams(parametros)
    if (esLibro(valor)) nuevos.set('libro', valor)
    else nuevos.delete('libro')
    setParametros(nuevos, { replace: true })
  }

  // Hasta que el periodo activo esté resuelto no se pide nada: la lista sin
  // filtro que llegaría antes se sustituye enseguida por la del periodo.
  const { data: asientos = [], isLoading } = useAsientos(
    periodoActivo?.id,
    libro,
    !cargandoPeriodos,
  )

  const enLista = asientos.find((a) => a.id === seleccionadoId)
  const { data: fueraDeLista } = useAsiento(
    enLista || !seleccionadoId ? undefined : seleccionadoId,
  )
  const seleccionado = enLista ?? fueraDeLista ?? null

  // Solo se reversa lo contabilizado que no es ya una reversa (docs/02 §6):
  // lo reversado ya tiene la suya, y una reversa se deshace capturando el
  // asiento correcto, no reversándola.
  const reversable =
    seleccionado?.estado === 'contabilizado' &&
    seleccionado.reversaDeId === null

  const columnas = useMemo<ColumnDef<Asiento, unknown>[]>(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Asiento',
        meta: { ancho: '140px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs font-medium text-slate-700">
            {row.original.codigo}
          </span>
        ),
      },
      {
        accessorKey: 'fecha',
        header: 'Fecha',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fecha),
      },
      { accessorKey: 'concepto', header: 'Concepto' },
      {
        id: 'origen',
        header: 'Origen',
        meta: { ancho: '160px' },
        accessorFn: (a) => a.origenModulo ?? 'manual',
        cell: ({ row }) => (
          <span className="text-xs text-slate-500">
            {row.original.origenModulo ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                {row.original.origenModulo} · {row.original.origenTipo}
              </span>
            ) : (
              <span className="text-slate-400">Manual</span>
            )}
          </span>
        ),
      },
      {
        id: 'libros',
        header: 'Contabilidad',
        meta: { ancho: '130px' },
        // El accesor devuelve las etiquetas para que la búsqueda de texto
        // encuentre "corporativa" sin un filtro aparte.
        accessorFn: (a) => a.libros.map(etiquetaLibro).join(' '),
        cell: ({ row }) => <EtiquetaLibros libros={row.original.libros} />,
      },
      {
        id: 'importe',
        header: 'Importe',
        meta: { numerico: true, ancho: '170px' },
        accessorFn: (a) => a.totales[0]?.totalCargos ?? '0',
        // Cuando los libros llevan importes distintos no hay "un" importe del
        // asiento: se muestran los dos, en vez de elegir uno y esconder que
        // difieren.
        cell: ({ row }) => (
          <div className="flex flex-col items-end">
            {row.original.totales.map((total) => (
              <span key={total.libro} className="flex items-center gap-1.5">
                {row.original.totales.length > 1 && (
                  <span className="text-[10px] text-slate-400">
                    {LIBROS.find((l) => l.codigo === total.libro)?.abreviatura}
                  </span>
                )}
                <MoneyCell
                  valor={total.totalCargos}
                  moneda={row.original.moneda}
                />
              </span>
            ))}
          </div>
        ),
      },
      {
        accessorKey: 'estado',
        header: 'Estado',
        meta: { ancho: '130px' },
        cell: ({ row }) => <EstadoBadge estado={row.original.estado} />,
      },
    ],
    [],
  )

  return (
    <div>
      <PageHeader
        titulo="Asientos contables"
        descripcion={
          periodoActivo
            ? `Periodo ${formatPeriodo(periodoActivo.ejercicio, periodoActivo.numero)}`
            : 'Seleccione un periodo'
        }
        acciones={
          <Link to="/conta/asientos/nuevo">
            <Button variante="primario" icono={<Plus className="size-4" />}>
              Nuevo asiento
            </Button>
          </Link>
        }
      />

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search className="size-4 text-slate-400" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por concepto, origen o código…"
            className="h-8 max-w-sm border-0 px-0 focus:ring-0"
          />
          <Select
            aria-label="Contabilidad"
            value={libro ?? 'ambas'}
            onChange={(e) => setLibro(e.target.value)}
            className="ml-auto h-8 w-44 text-xs"
          >
            <option value="ambas">Ambas contabilidades</option>
            {LIBROS.map((definicion) => (
              <option key={definicion.codigo} value={definicion.codigo}>
                Solo {definicion.etiqueta.toLowerCase()}
              </option>
            ))}
          </Select>
          <span className="text-xs text-slate-500">
            {asientos.length} asientos
          </span>
        </div>

        {isLoading || cargandoPeriodos ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Cargando asientos…
          </p>
        ) : (
          <DataTable
            columns={columnas}
            data={asientos}
            filtro={filtro}
            onRowClick={(asiento) => setSeleccionadoId(asiento.id)}
            vacio={{
              titulo: 'Sin asientos en el periodo',
              descripcion:
                'Los módulos subsidiarios generan sus asientos automáticamente. También puede capturar uno manual.',
            }}
          />
        )}
      </Card>

      {seleccionado && (
        <Card className="mt-4">
          <CardHeader
            titulo="Detalle del asiento"
            acciones={
              <Button tamano="sm" onClick={() => setSeleccionadoId(null)}>
                Cerrar
              </Button>
            }
          />
          <PanelAsiento
            asiento={seleccionado}
            onAbrirAsiento={setSeleccionadoId}
            acciones={
              reversable ? (
                <Button
                  tamano="sm"
                  icono={<Undo2 className="size-3.5" />}
                  onClick={() => setReversando(true)}
                >
                  Reversar
                </Button>
              ) : null
            }
          />
        </Card>
      )}

      {/* Se monta solo al abrir: así arranca con la fecha propuesta y sin el
          motivo de la reversa anterior. */}
      {seleccionado && reversando && (
        <DialogoReversa
          asiento={seleccionado}
          abierto
          onCerrar={() => setReversando(false)}
          onReversado={() => {
            // Se queda en el original: es donde se ve el badge y el enlace a
            // la reversa recién emitida, que es lo que se acaba de hacer.
            setReversando(false)
          }}
        />
      )}
    </div>
  )
}
