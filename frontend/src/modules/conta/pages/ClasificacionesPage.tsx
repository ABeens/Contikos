import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import {
  Card,
  CardHeader,
  EstadoError,
  EstadoVacio,
  PageHeader,
} from '@/shared/ui/Layout'
import { DialogoConfirmacion } from '@/shared/ui/DialogoConfirmacion'
import type {
  ClasificacionNiif,
  EstadoFinanciero,
  NotaEeff,
} from '@/shared/api/contracts/conta'
import { ESTADOS_FINANCIEROS } from '@/shared/api/contracts/conta'
import { DialogoClasificacionNiif } from '../components/DialogoClasificacionNiif'
import { DialogoNotaEeff } from '../components/DialogoNotaEeff'
import {
  ETIQUETA_ESTADO_FINANCIERO,
  ETIQUETA_TIPO_CUENTA,
  notasDeClasificacion,
  ordenarClasificaciones,
  referenciaNota,
} from '../domain/clasificacion'
import {
  useClasificacionesNiif,
  useCuentas,
  useEliminarClasificacion,
  useEliminarNota,
  useNotasEeff,
} from '../api/queries'

/**
 * Los dos catálogos de presentación, en una sola pantalla.
 *
 * No son dos listas independientes: la nota es una subcategoría de la
 * clasificación, y separarlas en dos pantallas obligaría a recordar de qué
 * renglón cuelga cada nota. Aquí la jerarquía se ve, que es justo lo que hay
 * que revisar antes de emitir los estados financieros.
 */
export function ClasificacionesPage() {
  const consultaClasificaciones = useClasificacionesNiif()
  const { data: clasificaciones = [], isLoading } = consultaClasificaciones
  const consultaNotas = useNotasEeff()
  const { data: notas = [] } = consultaNotas
  const { data: cuentas = [] } = useCuentas()
  // Sin notas el árbol diría "0 notas" en cada renglón: tan falso como un
  // catálogo vacío. Si falla cualquiera de los dos, no se enseña el árbol.
  const errorCarga =
    (consultaClasificaciones.isError && clasificaciones.length === 0
      ? consultaClasificaciones.error
      : null) ??
    (consultaNotas.isError && notas.length === 0 ? consultaNotas.error : null)

  const eliminarClasificacion = useEliminarClasificacion()
  const eliminarNota = useEliminarNota()

  const [expandidas, setExpandidas] = useState<ReadonlySet<string>>(new Set())
  const [editando, setEditando] = useState<ClasificacionNiif | null>(null)
  const [creando, setCreando] = useState(false)
  const [notaEditando, setNotaEditando] = useState<NotaEeff | null>(null)
  const [notaCreandoEn, setNotaCreandoEn] = useState<string | null>(null)
  const [porEliminar, setPorEliminar] = useState<ClasificacionNiif | null>(null)
  const [notaPorEliminar, setNotaPorEliminar] = useState<NotaEeff | null>(null)

  const ordenadas = useMemo(
    () => ordenarClasificaciones(clasificaciones),
    [clasificaciones],
  )

  const porEstado = useMemo(() => {
    const mapa = new Map<EstadoFinanciero, ClasificacionNiif[]>()
    for (const c of ordenadas) {
      const grupo = mapa.get(c.estadoFinanciero) ?? []
      grupo.push(c)
      mapa.set(c.estadoFinanciero, grupo)
    }
    // Se recorre el enum y no el mapa para que el orden sea el de los estados
    // financieros, no el de llegada de los datos.
    return ESTADOS_FINANCIEROS.map((estado) => ({
      estado,
      clasificaciones: mapa.get(estado) ?? [],
    })).filter((g) => g.clasificaciones.length > 0)
  }, [ordenadas])

  // Renglón o nota: las dos son obligatorias, así que falta la presentación en
  // cuanto falta cualquiera de las dos (docs/03 §2 bis).
  const sinPresentacion = cuentas.filter(
    (c) =>
      c.esDetalle && (c.clasificacionNiifId === null || c.notaEeffId === null),
  ).length

  const alternar = (id: string) =>
    setExpandidas((prev) => {
      const siguiente = new Set(prev)
      if (!siguiente.delete(id)) siguiente.add(id)
      return siguiente
    })

  // El error de eliminar se enseña dentro de su diálogo y se descarta al
  // cerrarlo: al volver a abrirlo para otro renglón no debe seguir ahí.
  const cerrarEliminarClasificacion = () => {
    setPorEliminar(null)
    eliminarClasificacion.reset()
  }

  const cerrarEliminarNota = () => {
    setNotaPorEliminar(null)
    eliminarNota.reset()
  }

  const confirmarEliminarClasificacion = () => {
    if (!porEliminar || eliminarClasificacion.isPending) return
    eliminarClasificacion.mutate(porEliminar.id, {
      onSuccess: cerrarEliminarClasificacion,
    })
  }

  const confirmarEliminarNota = () => {
    if (!notaPorEliminar || eliminarNota.isPending) return
    eliminarNota.mutate(notaPorEliminar.id, {
      onSuccess: cerrarEliminarNota,
    })
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        titulo="Clasificación NIIF y notas"
        descripcion="Dónde se presenta cada cuenta y en qué nota se desglosa. El catálogo de cuentas dice dónde se registra; esto dice dónde se muestra."
        acciones={
          <Button
            variante="primario"
            icono={<Plus className="size-4" />}
            onClick={() => setCreando(true)}
          >
            Nueva clasificación
          </Button>
        }
      />

      <Card>
        <CardHeader
          titulo="Catálogo de presentación"
          acciones={
            <span className="self-center text-xs text-slate-500">
              {clasificaciones.length} clasificaciones · {notas.length} notas
              {sinPresentacion > 0 &&
                ` · ${sinPresentacion} cuentas sin presentación`}
            </span>
          }
        />

        {/* Un error de carga no es un catálogo vacío: "no hay renglones" y
            "no se pudieron leer" piden cosas muy distintas. */}
        {errorCarga ? (
          <EstadoError
            error={errorCarga}
            onReintentar={() => {
              void consultaClasificaciones.refetch()
              void consultaNotas.refetch()
            }}
            reintentando={
              consultaClasificaciones.isFetching || consultaNotas.isFetching
            }
          />
        ) : isLoading || consultaNotas.isLoading ? (
          <p
            className="px-4 py-10 text-center text-sm text-slate-500"
            aria-busy
          >
            Cargando catálogo…
          </p>
        ) : porEstado.length === 0 ? (
          <EstadoVacio
            titulo="Sin clasificaciones"
            descripcion="Dé de alta los renglones de los estados financieros para poder clasificar las cuentas."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {porEstado.map(({ estado, clasificaciones: grupo }) => (
              <section key={estado}>
                <h3 className="bg-slate-50 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  {ETIQUETA_ESTADO_FINANCIERO[estado]}
                </h3>
                {grupo.map((clasificacion) => (
                  <Renglon
                    key={clasificacion.id}
                    clasificacion={clasificacion}
                    notas={notasDeClasificacion(clasificacion.id, notas)}
                    expandida={expandidas.has(clasificacion.id)}
                    onAlternar={() => alternar(clasificacion.id)}
                    onEditar={() => setEditando(clasificacion)}
                    onEliminar={() => setPorEliminar(clasificacion)}
                    onNuevaNota={() => setNotaCreandoEn(clasificacion.id)}
                    onEditarNota={setNotaEditando}
                    onEliminarNota={setNotaPorEliminar}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </Card>

      {(creando || editando) && (
        <DialogoClasificacionNiif
          // La clave reinicia el formulario al cambiar de clasificación editada.
          key={editando?.id ?? 'nueva'}
          abierto
          clasificacion={editando ?? undefined}
          clasificaciones={clasificaciones}
          notas={notas}
          cuentas={cuentas}
          onCerrar={() => {
            setCreando(false)
            setEditando(null)
          }}
        />
      )}

      {(notaCreandoEn || notaEditando) && (
        <DialogoNotaEeff
          key={notaEditando?.id ?? `nueva-${notaCreandoEn}`}
          abierto
          nota={notaEditando ?? undefined}
          clasificacionInicialId={notaCreandoEn ?? undefined}
          clasificaciones={clasificaciones}
          notas={notas}
          cuentas={cuentas}
          onCerrar={() => {
            setNotaCreandoEn(null)
            setNotaEditando(null)
          }}
        />
      )}

      <DialogoConfirmacion
        abierto={porEliminar !== null}
        onCancelar={cerrarEliminarClasificacion}
        onConfirmar={confirmarEliminarClasificacion}
        titulo={`Eliminar ${porEliminar?.codigo ?? ''}`}
        textoConfirmar="Eliminar"
        textoConfirmando="Eliminando…"
        peligro
        pendiente={eliminarClasificacion.isPending}
        error={eliminarClasificacion.error}
      >
        <p>
          Se retira {porEliminar?.nombre} del catálogo de presentación. Solo es
          posible si no tiene cuentas asignadas ni notas colgando; si las
          tuviera, hay que reclasificarlas o desactivar el renglón.
        </p>
      </DialogoConfirmacion>

      <DialogoConfirmacion
        abierto={notaPorEliminar !== null}
        onCancelar={cerrarEliminarNota}
        onConfirmar={confirmarEliminarNota}
        titulo={`Eliminar la nota ${
          notaPorEliminar ? referenciaNota(notaPorEliminar) : ''
        }`}
        textoConfirmar="Eliminar"
        textoConfirmando="Eliminando…"
        peligro
        pendiente={eliminarNota.isPending}
        error={eliminarNota.error}
      >
        <p>
          Se elimina «{notaPorEliminar?.titulo}». La numeración de las demás
          notas no se recorre: renumerar cambiaría las referencias de los
          estados financieros ya emitidos.
        </p>
      </DialogoConfirmacion>
    </div>
  )
}

function Renglon({
  clasificacion,
  notas,
  expandida,
  onAlternar,
  onEditar,
  onEliminar,
  onNuevaNota,
  onEditarNota,
  onEliminarNota,
}: {
  clasificacion: ClasificacionNiif
  notas: NotaEeff[]
  expandida: boolean
  onAlternar: () => void
  onEditar: () => void
  onEliminar: () => void
  onNuevaNota: () => void
  onEditarNota: (nota: NotaEeff) => void
  onEliminarNota: (nota: NotaEeff) => void
}) {
  const { codigo, nombre, tiposCuenta, activa, cuentas } = clasificacion

  return (
    <div className="group border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-2 px-2 py-2">
        <button
          type="button"
          onClick={onAlternar}
          aria-expanded={expandida}
          aria-label={`Notas de ${codigo}`}
          className="mt-0.5 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          {expandida ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-xs font-semibold text-slate-600">
              {codigo}
            </span>
            <span
              className={activa ? 'text-slate-800' : 'text-slate-400 line-through'}
            >
              {nombre}
            </span>
            {!activa && <Marca tono="gris">Inactiva</Marca>}
          </p>
          {/* La sección NIIF se consulta al editar el renglón: en la lista
              era una tercera cifra que competía con las dos que sí se
              comparan de un vistazo. */}
          <p
            className="mt-0.5 text-xs text-slate-400"
            title={tiposCuenta.map((t) => ETIQUETA_TIPO_CUENTA[t]).join(' · ')}
          >
            {cuentas} {cuentas === 1 ? 'cuenta' : 'cuentas'} · {notas.length}{' '}
            {notas.length === 1 ? 'nota' : 'notas'}
          </p>
        </div>

        {/* Diecinueve renglones × tres iconos era más botonera que catálogo.
            Las acciones aparecen sobre la fila que se está mirando, y con el
            teclado en cuanto una recibe el foco. */}
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <IconoAccion
            titulo="Añadir una nota a este renglón"
            etiqueta={`Añadir una nota a ${codigo}`}
            onClick={onNuevaNota}
          >
            <Plus className="size-4" />
          </IconoAccion>
          <IconoAccion
            titulo="Editar"
            etiqueta={`Editar ${codigo}`}
            onClick={onEditar}
          >
            <Pencil className="size-4" />
          </IconoAccion>
          <IconoAccion
            titulo={
              cuentas > 0
                ? 'Tiene cuentas asignadas: desactívela en vez de eliminarla'
                : notas.length > 0
                  ? 'Tiene notas: elimínelas o muévalas primero'
                  : 'Eliminar del catálogo'
            }
            etiqueta={`Eliminar ${codigo}`}
            deshabilitado={cuentas > 0 || notas.length > 0}
            peligro
            onClick={onEliminar}
          >
            <Trash2 className="size-4" />
          </IconoAccion>
        </div>
      </div>

      {expandida && (
        <div className="border-t border-slate-100 bg-slate-50/60 py-1 pr-2 pl-10">
          {notas.length === 0 ? (
            <p className="py-2 text-xs text-slate-500">
              Este renglón no se desglosa en ninguna nota.
            </p>
          ) : (
            notas.map((nota) => (
              <div
                key={nota.id}
                className="group/nota flex items-start gap-2 border-b border-slate-100 py-1.5 last:border-0"
              >
                <span className="mt-0.5 shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 ring-inset">
                  Nota {referenciaNota(nota)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    {nota.titulo}
                    {!nota.activa && <Marca tono="gris">Inactiva</Marca>}
                  </p>
                  {nota.descripcion && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {nota.descripcion}
                    </p>
                  )}
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {nota.cuentas} {nota.cuentas === 1 ? 'cuenta' : 'cuentas'}{' '}
                    desglosadas
                  </p>
                </div>
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within/nota:opacity-100 group-hover/nota:opacity-100">
                  <IconoAccion
                    titulo="Editar"
                    etiqueta={`Editar la nota ${referenciaNota(nota)}`}
                    onClick={() => onEditarNota(nota)}
                  >
                    <Pencil className="size-4" />
                  </IconoAccion>
                  <IconoAccion
                    titulo={
                      nota.cuentas > 0
                        ? 'Desglosa cuentas: desactívela en vez de eliminarla'
                        : 'Eliminar la nota'
                    }
                    etiqueta={`Eliminar la nota ${referenciaNota(nota)}`}
                    deshabilitado={nota.cuentas > 0}
                    peligro
                    onClick={() => onEliminarNota(nota)}
                  >
                    <Trash2 className="size-4" />
                  </IconoAccion>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * El tooltip explica POR QUÉ un botón está deshabilitado, y ese texto se repite
 * en cada renglón. La etiqueta accesible lleva además el código, para que
 * "eliminar" señale a un renglón concreto y no a dieciocho iguales.
 */
function IconoAccion({
  titulo,
  etiqueta,
  onClick,
  deshabilitado,
  peligro,
  children,
}: {
  titulo: string
  etiqueta: string
  onClick: () => void
  deshabilitado?: boolean
  peligro?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={etiqueta}
      disabled={deshabilitado}
      onClick={onClick}
      // Sin pointer-events-none: el botón apagado tiene que seguir recibiendo
      // el ratón para enseñar su `title`, que es justo el porqué.
      className={`rounded p-1 text-slate-400 disabled:cursor-not-allowed disabled:opacity-30 ${
        peligro
          ? 'hover:bg-red-50 hover:text-red-600 disabled:hover:bg-transparent disabled:hover:text-slate-400'
          : 'hover:bg-slate-100 hover:text-brand-700'
      }`}
    >
      {children}
    </button>
  )
}

function Marca({
  tono,
  children,
}: {
  tono: 'gris'
  children: React.ReactNode
}) {
  const tonos = { gris: 'bg-slate-100 text-slate-600' }
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tonos[tono]}`}
    >
      {children}
    </span>
  )
}
