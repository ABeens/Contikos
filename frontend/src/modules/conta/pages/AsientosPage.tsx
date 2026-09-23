import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Search, Undo2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { LinkBoton } from '@/shared/ui/LinkBoton'
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
import { periodoDeFecha } from '../domain/asiento'
import { etiquetaPeriodo } from '../domain/periodo'
import { usePeriodoEnUrl } from '../hooks/usePeriodoEnUrl'

export function AsientosPage() {
  const { periodos, cargando: cargandoPeriodos } = useEmpresa()
  const periodo = usePeriodoEnUrl()
  const [parametros, setParametros] = useSearchParams()
  const navegar = useNavigate()
  const ubicacion = useLocation()
  const [reversando, setReversando] = useState(false)
  const [visibles, setVisibles] = useState(0)

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

  /**
   * El asiento abierto también vive en la URL (`?asiento=<id>`), y se guarda el
   * id y no el asiento: tras reversar, el original cambia de estado y el panel
   * tiene que enseñar la versión nueva, no la que se hizo clic.
   *
   * Es la dirección a la que enlazan los demás módulos y la captura tras
   * contabilizar, y es lo que hace que el botón atrás cierre el detalle.
   */
  const seleccionadoId = parametros.get('asiento')
  const detalleApilado = Boolean(
    (ubicacion.state as { detalleApilado?: boolean } | null)?.detalleApilado,
  )
  const abrir = (id: string) => {
    const nuevos = new URLSearchParams(parametros)
    nuevos.set('asiento', id)
    // Abrir desde la lista apila una entrada: atrás vuelve a la lista. Pasar
    // de un asiento a otro con el detalle ya abierto la sustituye, para que
    // atrás no obligue a desandar cada fila que se miró.
    if (seleccionadoId) {
      setParametros(nuevos, { replace: true, state: ubicacion.state })
    } else {
      setParametros(nuevos, { state: { detalleApilado: true } })
    }
  }
  const cerrar = () => {
    // Si el detalle se abrió desde aquí, cerrar es volver atrás: el historial
    // queda como si nunca se hubiera abierto. Si se llegó por un enlace, atrás
    // saldría de la pantalla, así que se quita el parámetro en su sitio.
    if (detalleApilado) {
      void navegar(-1)
      return
    }
    const nuevos = new URLSearchParams(parametros)
    nuevos.delete('asiento')
    setParametros(nuevos, { replace: true })
  }

  // Hasta que el periodo activo esté resuelto no se pide nada: la lista sin
  // filtro que llegaría antes se sustituye enseguida por la del periodo.
  const consulta = useAsientos(periodo?.id, libro, !cargandoPeriodos)
  const { data: asientos = [], isLoading } = consulta

  // El asiento abierto puede no estar en la lista: un enlace desde otro módulo
  // o la reversa de un original de otro mes. Ese se pide aparte, y solo cuando
  // la lista ya llegó y de verdad no está.
  const enLista = asientos.find((a) => a.id === seleccionadoId)
  const consultaSuelta = useAsiento(
    seleccionadoId && !enLista && !isLoading ? seleccionadoId : undefined,
  )
  const seleccionado = enLista ?? consultaSuelta.data ?? null
  const periodoDelSeleccionado =
    seleccionado && !enLista
      ? periodoDeFecha(seleccionado.fecha, periodos)
      : undefined

  // Al abrir un asiento el detalle se acerca a la vista: queda debajo de la
  // lista, y quien llega por un enlace no sabría que está ahí.
  const refDetalle = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (seleccionadoId) refDetalle.current?.scrollIntoView?.({ block: 'nearest' })
  }, [seleccionadoId])

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

  const hayFiltro = filtro.trim() !== ''
  const otroPeriodo =
    periodoDelSeleccionado && periodoDelSeleccionado.id !== periodo?.id
      ? periodoDelSeleccionado
      : undefined

  const irAlPeriodo = (id: string) => {
    const nuevos = new URLSearchParams(parametros)
    nuevos.set('periodo', id)
    setParametros(nuevos, { replace: true, state: ubicacion.state })
  }

  return (
    <div>
      <PageHeader
        titulo="Asientos contables"
        descripcion={
          periodo
            ? `Periodo ${formatPeriodo(periodo.ejercicio, periodo.numero)}`
            : 'Seleccione un periodo'
        }
        acciones={
          <LinkBoton
            to="/conta/asientos/nuevo"
            variante="primario"
            icono={<Plus className="size-4" />}
          >
            Nuevo asiento
          </LinkBoton>
        }
      />

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search className="size-4 text-slate-400" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por concepto, origen o código…"
            aria-label="Buscar asientos"
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
          {/* Con búsqueda, el contador dice cuántas filas quedan a la vista:
              "12 asientos" encima de una tabla con dos se lee como un error. */}
          <span className="text-xs text-slate-500" aria-live="polite">
            {hayFiltro
              ? `${visibles} de ${asientos.length} asientos`
              : `${asientos.length} asientos`}
          </span>
        </div>

        <DataTable
          columns={columnas}
          data={asientos}
          filtro={filtro}
          cargando={isLoading || cargandoPeriodos}
          error={consulta.error}
          onReintentar={() => void consulta.refetch()}
          alFiltrar={setVisibles}
          onRowClick={(asiento) => abrir(asiento.id)}
          esSeleccionada={(asiento) => asiento.id === seleccionadoId}
          vacio={{
            titulo: 'Sin asientos en el periodo',
            descripcion:
              'Los módulos subsidiarios generan sus asientos automáticamente. También puede capturar uno manual.',
          }}
        />
      </Card>

      {seleccionadoId && (
        <div ref={refDetalle}>
          <Card className="mt-4">
            <CardHeader
              titulo="Detalle del asiento"
              descripcion={
                otroPeriodo
                  ? `Es de ${etiquetaPeriodo(otroPeriodo)}: no aparece en la lista del periodo que se está mirando.`
                  : undefined
              }
              acciones={
                <>
                  {otroPeriodo && (
                    <Button
                      tamano="sm"
                      onClick={() => irAlPeriodo(otroPeriodo.id)}
                    >
                      Ver {etiquetaPeriodo(otroPeriodo)}
                    </Button>
                  )}
                  <Button tamano="sm" onClick={cerrar}>
                    Cerrar
                  </Button>
                </>
              }
            />
            {seleccionado ? (
              <PanelAsiento
                asiento={seleccionado}
                onAbrirAsiento={abrir}
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
            ) : consultaSuelta.error ? (
              <EstadoError
                titulo="No se pudo abrir el asiento"
                error={consultaSuelta.error}
                onReintentar={() => void consultaSuelta.refetch()}
                reintentando={consultaSuelta.isFetching}
              />
            ) : (
              <p
                className="px-4 py-10 text-center text-sm text-slate-500"
                aria-busy
              >
                Cargando asiento…
              </p>
            )}
          </Card>
        </div>
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
