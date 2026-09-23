import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import Decimal from 'decimal.js'
import { Ban, CalendarClock, Pencil, Plus, Search } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { LinkBoton } from '@/shared/ui/LinkBoton'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Field, Input } from '@/shared/ui/Field'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { DialogoConfirmacion } from '@/shared/ui/DialogoConfirmacion'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import type { Diferido } from '@/shared/api/contracts/diferidos'
import { useCuentas, usePeriodos } from '@/shared/api/catalogos'
import { useCancelarDiferido, useDiferidos } from '../api/queries'
import { validarCancelacion, validarEdicion } from '../domain/diferido'

/**
 * Auxiliar de diferidos (docs/15 §4).
 *
 * Lo que se lee de un vistazo es el saldo por amortizar, porque es el que tiene
 * que explicar la cuenta de balance: la suma de esta columna es el saldo que la
 * conciliación de docs/15 §4 compara contra el mayor. El avance está al lado
 * para saber cuánto falta sin tener que restar de cabeza.
 *
 * La ficha abierta vive en la URL (`?diferido=`) y se guarda por id, no como
 * copia: un refetch enseña los datos nuevos del mismo diferido (tras cancelarlo,
 * por ejemplo) y nunca vuelve a abrir uno que el usuario cerró.
 */
export function DiferidosPage() {
  const consulta = useDiferidos()
  const { data: diferidos = [] } = consulta
  const { data: cuentas = [] } = useCuentas()
  const [parametros, setParametros] = useSearchParams()
  const [filtro, setFiltro] = useState('')
  const [visibles, setVisibles] = useState(0)
  const [cancelando, setCancelando] = useState(false)

  // `?diferido=` es la ida desde la corrida y la vuelta tras el alta: quien
  // llega quiere esa ficha, no el auxiliar entero.
  const seleccionadoId = parametros.get('diferido')
  const seleccionado = diferidos.find((d) => d.id === seleccionadoId) ?? null

  const abrirFicha = (diferido: Diferido) => {
    const nuevos = new URLSearchParams(parametros)
    nuevos.set('diferido', diferido.id)
    setParametros(nuevos, { replace: true })
  }

  const cerrarFicha = () => {
    const nuevos = new URLSearchParams(parametros)
    nuevos.delete('diferido')
    setParametros(nuevos, { replace: true })
  }

  /**
   * Totales por moneda, de lo que el filtro deja ver.
   *
   * Un diferido en dólares y otro en colones no se suman: el resultado no sería
   * de ninguna moneda. Y si el buscador deja dos diferidos, los totales son de
   * esos dos, para que cuadren con la tabla de debajo.
   */
  const totales = useMemo(() => {
    const porMoneda = new Map<
      string,
      { monto: Decimal; amortizado: Decimal; saldo: Decimal }
    >()
    for (const d of diferidos) {
      if (d.estado === 'cancelado' || !coincide(d, filtro)) continue
      const previo = porMoneda.get(d.moneda) ?? {
        monto: new Decimal(0),
        amortizado: new Decimal(0),
        saldo: new Decimal(0),
      }
      porMoneda.set(d.moneda, {
        monto: previo.monto.plus(new Decimal(d.monto)),
        amortizado: previo.amortizado.plus(new Decimal(d.montoAmortizado)),
        saldo: previo.saldo.plus(new Decimal(d.saldoPorAmortizar)),
      })
    }
    return [...porMoneda.entries()].map(([moneda, t]) => ({
      moneda,
      monto: t.monto.toFixed(2),
      amortizado: t.amortizado.toFixed(2),
      saldo: t.saldo.toFixed(2),
    }))
  }, [diferidos, filtro])

  const columnas = useMemo<ColumnDef<Diferido, unknown>[]>(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Código',
        meta: { ancho: '100px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-600">
            {row.original.codigo}
          </span>
        ),
      },
      {
        // El buscador promete buscar por tercero: el valor de la columna lleva
        // la descripción y el tercero, aunque la celda los pinte separados.
        id: 'descripcion',
        header: 'Diferido',
        accessorFn: textoDescripcion,
        cell: ({ row }) => (
          <div>
            <p className="text-slate-800">{row.original.descripcion}</p>
            <p className="text-[11px] text-slate-500">
              {row.original.tercero?.nombre ?? 'Sin tercero'}
            </p>
          </div>
        ),
      },
      {
        id: 'tipo',
        header: 'Tipo',
        meta: { ancho: '110px' },
        accessorFn: textoTipo,
        cell: ({ row }) => (
          <span className="text-[11px] text-slate-600">
            {row.original.tipo === 'gasto' ? 'Gasto' : 'Ingreso'}
          </span>
        ),
      },
      {
        accessorKey: 'fechaInicio',
        header: 'Inicio',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fechaInicio),
      },
      {
        id: 'plazo',
        header: 'Plazo',
        meta: { ancho: '90px' },
        accessorFn: textoPlazo,
        cell: ({ row }) => (
          <span className="text-xs text-slate-600">
            {row.original.plazoMeses} meses
          </span>
        ),
      },
      {
        id: 'monto',
        header: 'Monto',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (d) => d.monto,
        cell: ({ row }) => (
          <MoneyCell valor={row.original.monto} moneda={row.original.moneda} />
        ),
      },
      {
        id: 'saldo',
        header: 'Por amortizar',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (d) => d.saldoPorAmortizar,
        cell: ({ row }) => (
          <MoneyCell
            valor={row.original.saldoPorAmortizar}
            moneda={row.original.moneda}
          />
        ),
      },
      {
        id: 'avance',
        header: 'Avance',
        meta: { ancho: '120px' },
        accessorFn: (d) => porcentaje(d),
        cell: ({ row }) => <Avance diferido={row.original} />,
      },
      {
        accessorKey: 'estado',
        header: 'Estado',
        meta: { ancho: '110px' },
        cell: ({ row }) => <EstadoBadge estado={row.original.estado} />,
      },
    ],
    [],
  )

  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? codigo

  const edicion = seleccionado ? validarEdicion(seleccionado) : null

  return (
    <div>
      <PageHeader
        titulo="Asientos diferidos"
        descripcion="Gastos pagados e ingresos cobrados por adelantado, y lo que falta por reconocer de cada uno."
        acciones={
          <>
            <LinkBoton
              to="/diferidos/amortizacion"
              icono={<CalendarClock className="size-4" />}
            >
              Amortización
            </LinkBoton>
            <LinkBoton
              to="/diferidos/nuevo"
              variante="primario"
              icono={<Plus className="size-4" />}
            >
              Registrar diferido
            </LinkBoton>
          </>
        }
      />

      {totales.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3">
          <Resumen
            titulo="Monto diferido"
            valores={totales.map((t) => ({ moneda: t.moneda, valor: t.monto }))}
          />
          <Resumen
            titulo="Ya reconocido"
            valores={totales.map((t) => ({
              moneda: t.moneda,
              valor: t.amortizado,
            }))}
          />
          <Resumen
            titulo="Por amortizar"
            valores={totales.map((t) => ({ moneda: t.moneda, valor: t.saldo }))}
            destacado
          />
        </div>
      )}

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search className="size-4 text-slate-400" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por descripción, código o tercero…"
            aria-label="Buscar diferido"
            className="h-8 max-w-sm border-0 px-0 focus:ring-0"
          />
          <span className="ml-auto text-xs text-slate-500">
            {filtro.trim() && visibles !== diferidos.length
              ? `${visibles} de ${diferidos.length} diferidos`
              : `${diferidos.length} diferido${diferidos.length === 1 ? '' : 's'}`}
          </span>
        </div>

        <DataTable
          columns={columnas}
          data={diferidos}
          filtro={filtro}
          onRowClick={abrirFicha}
          esSeleccionada={(d) => d.id === seleccionadoId}
          alFiltrar={setVisibles}
          cargando={consulta.isLoading}
          error={consulta.error}
          onReintentar={() => void consulta.refetch()}
          vacio={{
            titulo: 'Sin diferidos registrados',
            descripcion:
              'Registre la póliza, el alquiler o el mantenimiento que se pagó o se cobró por adelantado.',
          }}
        />
      </Card>

      {seleccionado && (
        <Card className="mt-4">
          <CardHeader
            titulo={`${seleccionado.codigo} · ${seleccionado.descripcion}`}
            descripcion={
              seleccionado.tipo === 'gasto'
                ? 'Gasto diferido: el saldo por amortizar descansa en el activo.'
                : 'Ingreso diferido: el saldo por amortizar descansa en el pasivo.'
            }
            acciones={
              <>
                {/* Editar solo mientras no tenga cuotas contabilizadas
                    (docs/15 §3.3): después, el mayor ya cuenta el plan viejo. */}
                {edicion?.valido && (
                  <LinkBoton
                    tamano="sm"
                    to={`/diferidos/nuevo?editar=${seleccionado.id}`}
                    icono={<Pencil className="size-3.5" />}
                  >
                    Editar
                  </LinkBoton>
                )}
                {seleccionado.estado === 'vigente' && (
                  <Button
                    tamano="sm"
                    icono={<Ban className="size-3.5" />}
                    onClick={() => setCancelando(true)}
                  >
                    Cancelar anticipadamente
                  </Button>
                )}
                <Button tamano="sm" onClick={cerrarFicha}>
                  Cerrar
                </Button>
              </>
            }
          />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <Dato
              titulo="Tercero"
              valor={seleccionado.tercero?.nombre ?? 'Sin tercero'}
            />
            <Dato titulo="Inicio" valor={formatFecha(seleccionado.fechaInicio)} />
            <Dato titulo="Plazo" valor={`${seleccionado.plazoMeses} meses`} />
            <Dato
              titulo="Cuota mensual"
              valor={`${seleccionado.cuotaMensual} ${seleccionado.moneda}`}
            />
            <Dato
              titulo="Cuenta de balance"
              valor={`${seleccionado.cuentaDiferido} ${nombreCuenta(seleccionado.cuentaDiferido)}`}
            />
            <Dato
              titulo="Cuenta de resultados"
              valor={`${seleccionado.cuentaDestino} ${nombreCuenta(seleccionado.cuentaDestino)}`}
            />
            <Dato
              titulo="Reconocido"
              valor={`${seleccionado.montoAmortizado} ${seleccionado.moneda}`}
            />
            <Dato
              titulo="Por amortizar"
              valor={`${seleccionado.saldoPorAmortizar} ${seleccionado.moneda}`}
            />
            <Dato
              titulo="Origen"
              valor={
                seleccionado.origen
                  ? `${seleccionado.origen.modulo} · ${seleccionado.origen.tipo} · ${seleccionado.origen.id}`
                  : 'Registro directo'
              }
            />
            <Dato
              titulo="Asiento propio"
              valor="No: lo contabilizó el documento que lo originó"
            />
          </dl>

          {seleccionado.cancelacion && (
            <p className="mx-4 mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200 ring-inset">
              Cancelado el {formatFecha(seleccionado.cancelacion.fecha)}:{' '}
              {seleccionado.cancelacion.motivo}. Se reconocieron de golpe{' '}
              {seleccionado.cancelacion.importeReconocido} {seleccionado.moneda}
              {seleccionado.cancelacion.asientoId ? (
                <>
                  {' '}
                  en el asiento{' '}
                  <Link
                    to={`/conta/asientos?asiento=${seleccionado.cancelacion.asientoId}`}
                    className="font-mono underline-offset-2 hover:underline"
                  >
                    {seleccionado.cancelacion.asientoId}
                  </Link>
                  .
                </>
              ) : (
                ' (no quedaba saldo, así que no hubo asiento).'
              )}
            </p>
          )}

          <HistorialAmortizaciones diferido={seleccionado} />
        </Card>
      )}

      {seleccionado && cancelando && (
        <DialogoCancelacion
          key={seleccionado.id}
          diferido={seleccionado}
          onCerrar={() => setCancelando(false)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------- Cancelación */

/**
 * Cancelación anticipada (docs/15 §3.4).
 *
 * Es irreversible y escribe en el mayor: reconoce de golpe todo el saldo por
 * amortizar. Por eso se confirma con el importe delante, y la fecha decide en
 * qué periodo entra ese reconocimiento.
 */
function DialogoCancelacion({
  diferido,
  onCerrar,
}: {
  diferido: Diferido
  onCerrar: () => void
}) {
  const cancelar = useCancelarDiferido()
  const { data: periodos = [] } = usePeriodos()
  const [fecha, setFecha] = useState(hoyISO)
  const [motivo, setMotivo] = useState('')
  const [intento, setIntento] = useState(false)

  const validacion = validarCancelacion(diferido, fecha, periodos)
  const errorMotivo =
    intento && motivo.trim() === ''
      ? 'Indique el motivo de la cancelación'
      : undefined

  const confirmar = () => {
    setIntento(true)
    if (motivo.trim() === '' || !validacion.valido) return
    cancelar.mutate(
      { id: diferido.id, datos: { fecha, motivo: motivo.trim() } },
      { onSuccess: onCerrar },
    )
  }

  return (
    <DialogoConfirmacion
      abierto
      titulo={`¿Cancelar ${diferido.codigo} anticipadamente?`}
      descripcion="Deja de amortizarse y el saldo que queda se reconoce de golpe en resultados. No se puede deshacer."
      textoConfirmar="Cancelar y reconocer el saldo"
      textoConfirmando="Cancelando…"
      peligro
      pendiente={cancelar.isPending}
      error={cancelar.error}
      onConfirmar={confirmar}
      onCancelar={onCerrar}
    >
      <p>
        Se reconocen{' '}
        <strong>
          <MoneyCell
            valor={diferido.saldoPorAmortizar}
            moneda={diferido.moneda}
            mostrarSimbolo
          />
        </strong>{' '}
        de {diferido.descripcion}.
      </p>
      <Field
        label="Fecha de la cancelación"
        requerido
        ayuda="Decide el periodo en el que entra el reconocimiento."
        error={
          intento && !validacion.valido
            ? validacion.errores.map((e) => e.mensaje).join('. ')
            : undefined
        }
      >
        {(p) => (
          <Input
            {...p}
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        )}
      </Field>
      <Field label="Motivo" requerido error={errorMotivo}>
        {(p) => (
          <Input
            {...p}
            value={motivo}
            placeholder="Se canceló la póliza con la aseguradora"
            onChange={(e) => setMotivo(e.target.value)}
          />
        )}
      </Field>
    </DialogoConfirmacion>
  )
}

/* --------------------------------------------------------- Búsqueda */

function textoDescripcion(d: Diferido): string {
  return `${d.descripcion} ${d.tercero?.nombre ?? ''}`
}

function textoTipo(d: Diferido): string {
  return d.tipo === 'gasto' ? 'gasto diferido' : 'ingreso diferido'
}

function textoPlazo(d: Diferido): string {
  return `${d.plazoMeses} meses`
}

/**
 * El mismo criterio que el filtro global de la tabla: el texto aparece dentro
 * del valor de alguna columna. Lo usan los totales para sumar exactamente las
 * filas que se ven.
 */
function coincide(d: Diferido, filtro: string): boolean {
  const buscado = filtro.toLowerCase()
  if (!buscado) return true
  return [
    d.codigo,
    textoDescripcion(d),
    textoTipo(d),
    d.fechaInicio,
    textoPlazo(d),
    d.monto,
    d.saldoPorAmortizar,
    String(porcentaje(d)),
    d.estado,
  ].some((valor) => valor.toLowerCase().includes(buscado))
}

/* ------------------------------------------------------------- Avance */

/** Porcentaje reconocido, con el cero a salvo de un monto vacío. */
function porcentaje(diferido: Diferido): number {
  const monto = new Decimal(diferido.monto)
  if (monto.lessThanOrEqualTo(0)) return 0
  return new Decimal(diferido.montoAmortizado)
    .dividedBy(monto)
    .times(100)
    .toDecimalPlaces(0)
    .toNumber()
}

function Avance({ diferido }: { diferido: Diferido }) {
  const valor = Math.min(porcentaje(diferido), 100)
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200"
        role="presentation"
      >
        <div
          className="h-full rounded-full bg-brand-500"
          style={{ width: `${valor}%` }}
        />
      </div>
      <span className="tabular text-[11px] text-slate-600">{valor}%</span>
    </div>
  )
}

/**
 * Las cuotas que ya entraron al mayor sobre el diferido.
 *
 * Es lo que explica el monto reconocido de la ficha: cada renglón es una
 * corrida contabilizada y lleva al asiento que la escribió.
 */
function HistorialAmortizaciones({ diferido }: { diferido: Diferido }) {
  const amortizaciones = diferido.amortizaciones ?? []
  return (
    <div className="border-t border-slate-200 px-4 py-3">
      <h3 className="text-xs font-semibold text-slate-600">
        Amortizaciones contabilizadas
      </h3>
      {amortizaciones.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">
          Ninguna corrida ha tocado este diferido todavía.
        </p>
      ) : (
        <table
          className="mt-2 w-full max-w-xl text-sm"
          aria-label="Amortizaciones del diferido"
        >
          <thead className="text-[11px] text-slate-500">
            <tr>
              <th className="py-1 text-left font-medium">Periodo</th>
              <th className="py-1 text-left font-medium">Fecha</th>
              <th className="py-1 text-right font-medium">Cuota</th>
              <th className="py-1 pl-4 text-left font-medium">Asiento</th>
            </tr>
          </thead>
          <tbody>
            {[...amortizaciones].reverse().map((a) => (
              <tr key={a.periodoId} className="border-t border-slate-100">
                <td className="py-1 font-mono text-xs text-slate-600">
                  {a.periodoId}
                </td>
                <td className="py-1 text-slate-700">{formatFecha(a.fecha)}</td>
                <td className="py-1 text-right">
                  <MoneyCell valor={a.cuota} moneda={diferido.moneda} />
                </td>
                <td className="py-1 pl-4">
                  <Link
                    to={`/conta/asientos?asiento=${a.asientoId}`}
                    className="font-mono text-xs text-brand-700 hover:underline"
                  >
                    {a.asientoId}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Resumen({
  titulo,
  valores,
  destacado,
}: {
  titulo: string
  /** Un renglón por moneda: importes de monedas distintas no se suman. */
  valores: { moneda: string; valor: string }[]
  destacado?: boolean
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <p className="text-[11px] text-slate-500">{titulo}</p>
      {valores.map((v) => (
        <p
          key={v.moneda}
          className={`text-lg font-semibold ${destacado ? 'text-brand-700' : 'text-slate-900'}`}
        >
          <MoneyCell valor={v.valor} moneda={v.moneda} mostrarSimbolo />
        </p>
      ))}
    </div>
  )
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500">{titulo}</dt>
      <dd className="text-slate-800">{valor}</dd>
    </div>
  )
}
