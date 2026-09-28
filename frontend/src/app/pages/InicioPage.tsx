import type { ReactNode } from 'react'
import { Link } from 'react-router'
import {
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  FileText,
  Scale,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardHeader, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { cn } from '@/shared/ui/cn'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha, formatPeriodo } from '@/shared/format/fecha'
import { formatNumeroAsiento } from '@/shared/asiento/formato'
import { useEmpresa } from '../empresa'
import { ACCIONES_FRECUENTES } from '../layout/menu'
import { useAsientos, useBalanza } from '@/modules/conta/api/queries'

/**
 * Portada.
 *
 * Contesta tres preguntas del día (cuánto se movió, si cuadra y qué se
 * registró) y ofrece a mano lo que más se hace. El diagrama de la
 * arquitectura y la parrilla de los doce periodos ocupaban la mitad de la
 * pantalla para decir algo que no cambia de un día para otro.
 */
export function InicioPage() {
  const { periodoActivo, cargando } = useEmpresa()
  const consultaFiscal = useBalanza(periodoActivo?.id, 'fiscal')
  const consultaCorporativa = useBalanza(periodoActivo?.id, 'corporativo')
  const { data: fiscal } = consultaFiscal
  const { data: corporativa } = consultaCorporativa
  // Sin periodo no se pide nada: la consulta sin periodo es el mayor entero,
  // que llegaría para que la sustituyera un instante después la del periodo.
  // Y una empresa sin periodos no tiene "asientos del periodo" que contar.
  const consultaAsientos = useAsientos(
    periodoActivo?.id,
    undefined,
    Boolean(periodoActivo),
  )
  const { data: asientos = [] } = consultaAsientos
  // Mientras no hay datos no se enseña un cero: "0 asientos" es una
  // afirmación, y todavía no se sabe.
  const asientosListos = consultaAsientos.isSuccess
  // Una empresa sin ningún periodo no está "cargando": no tiene qué contar.
  const sinPeriodo = !cargando && !periodoActivo
  const errorBalanza = consultaFiscal.error ?? consultaCorporativa.error
  const cargadas = Boolean(fiscal && corporativa)
  const cuadran = Boolean(fiscal?.cuadra && corporativa?.cuadra)
  // Los dos libros suelen mover lo mismo. El corporativo solo se enseña cuando
  // difiere, que es justo cuando hace falta mirarlo.
  const difieren =
    cargadas && fiscal!.totalCargos !== corporativa!.totalCargos

  const recientes = [...asientos]
    .sort((a, b) => b.numero - a.numero)
    .slice(0, 5)

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        titulo="Resumen"
        descripcion={
          periodoActivo
            ? `${saludo()}. Esto es lo que lleva el periodo ${formatPeriodo(periodoActivo.ejercicio, periodoActivo.numero)}.`
            : `${saludo()}.`
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Indicador
          icono={FileText}
          tono="brand"
          etiqueta="Asientos del periodo"
          valor={
            asientosListos
              ? String(asientos.length)
              : consultaAsientos.isError || sinPeriodo
                ? SIN_DATO
                : CARGANDO
          }
          nota={consultaAsientos.isError ? 'No se pudo consultar' : undefined}
        />
        <Indicador
          icono={Wallet}
          tono="brand"
          etiqueta="Movimientos del periodo"
          valor={
            fiscal ? (
              <MoneyCell valor={fiscal.totalCargos} mostrarSimbolo />
            ) : consultaFiscal.isError || sinPeriodo ? (
              SIN_DATO
            ) : (
              CARGANDO
            )
          }
          nota={
            difieren ? (
              <>
                Corporativa{' '}
                <MoneyCell valor={corporativa!.totalCargos} mostrarSimbolo />
              </>
            ) : undefined
          }
        />
        <Indicador
          icono={Scale}
          tono={cargadas ? (cuadran ? 'exito' : 'peligro') : 'brand'}
          etiqueta="Cuadre de las dos contabilidades"
          valor={
            cargadas ? (
              <span
                className={`inline-flex items-center gap-1.5 text-base ${
                  cuadran ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {cuadran ? (
                  <CircleCheck className="size-4" />
                ) : (
                  <CircleAlert className="size-4" />
                )}
                {cuadran ? 'Cuadran' : 'No cuadra'}
              </span>
            ) : errorBalanza || sinPeriodo ? (
              SIN_DATO
            ) : (
              CARGANDO
            )
          }
          nota={errorBalanza ? 'No se pudo consultar la balanza' : undefined}
        />
      </div>

      <h2 className="mb-2.5 text-sm font-semibold text-slate-800">
        Acciones frecuentes
      </h2>
      <div className="mb-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {ACCIONES_FRECUENTES.map((a) => (
          <Atajo key={a.ruta} {...a} />
        ))}
      </div>

      <Card>
        <CardHeader
          titulo="Últimos asientos"
          acciones={
            <Link
              to="/conta/asientos"
              className="group inline-flex items-center gap-1 self-center text-xs font-medium text-brand-700 hover:text-brand-800"
            >
              Ver todos
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          }
        />
        {consultaAsientos.isError ? (
          <EstadoError
            titulo="No se pudieron cargar los asientos"
            error={consultaAsientos.error}
            onReintentar={() => void consultaAsientos.refetch()}
            reintentando={consultaAsientos.isFetching}
          />
        ) : sinPeriodo ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Esta empresa todavía no tiene periodos contables.
          </p>
        ) : !asientosListos ? (
          <div aria-busy className="divide-y divide-slate-100">
            <span className="sr-only">Cargando…</span>
            {[0, 1, 2].map((i) => (
              <div key={i} aria-hidden className="flex items-center gap-3 px-4 py-3">
                <div className="h-4 w-12 animate-brillo rounded bg-slate-200/80" />
                <div className="h-3 flex-1 animate-brillo rounded-full bg-slate-200/80" />
                <div className="h-3 w-20 animate-brillo rounded-full bg-slate-200/80" />
              </div>
            ))}
          </div>
        ) : recientes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Sin asientos en el periodo.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recientes.map((asiento) => (
              <li key={asiento.id}>
                {/* Cada asiento abre su detalle, por la misma dirección que
                    usan los demás módulos para enlazarlo. */}
                <Link
                  to={`/conta/asientos?asiento=${encodeURIComponent(asiento.id)}`}
                  className="group flex items-center gap-3 px-4 py-2.5 text-sm transition-colors last:rounded-b-xl hover:bg-slate-50"
                >
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 transition-colors group-hover:bg-brand-100 group-hover:text-brand-700">
                    {formatNumeroAsiento(asiento.numero)}
                  </span>
                  <span className="hidden w-20 shrink-0 text-xs text-slate-500 sm:inline">
                    {formatFecha(asiento.fecha)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-700">
                    {asiento.concepto}
                  </span>
                  <span className="tabular shrink-0 text-slate-800">
                    <MoneyCell
                      valor={asiento.totales[0]?.totalCargos ?? '0'}
                      moneda={asiento.moneda}
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

/** Todavía no se sabe. El lector de pantalla oye "cargando", no "puntos". */
const CARGANDO = (
  <span className="inline-block h-5 w-16 animate-brillo rounded-md bg-slate-200/80 align-middle">
    <span className="sr-only">Cargando</span>
  </span>
)
/** No se pudo saber. Distinto de cero, y distinto de "cargando". */
const SIN_DATO = '-'

/** Saludo según la hora local: la portada es lo primero que se ve al llegar. */
function saludo(ahora = new Date()) {
  const hora = ahora.getHours()
  if (hora < 12) return 'Buenos días'
  if (hora < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

const TONOS_INDICADOR = {
  brand: 'bg-brand-50 text-brand-600',
  exito: 'bg-emerald-50 text-emerald-600',
  peligro: 'bg-red-50 text-red-600',
} as const

function Indicador({
  icono: Icono,
  tono,
  etiqueta,
  valor,
  nota,
}: {
  icono: LucideIcon
  tono: keyof typeof TONOS_INDICADOR
  etiqueta: string
  valor: ReactNode
  nota?: ReactNode
}) {
  return (
    <Card className="flex items-start gap-3 px-4 py-4">
      <span
        aria-hidden
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-lg transition-colors',
          TONOS_INDICADOR[tono],
        )}
      >
        <Icono className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{etiqueta}</p>
        <p className="tabular mt-0.5 truncate text-lg font-semibold text-slate-900">
          {valor}
        </p>
        {nota && <p className="mt-0.5 text-[11px] text-slate-500">{nota}</p>}
      </div>
    </Card>
  )
}

function Atajo({
  ruta,
  etiqueta,
  descripcion,
  icono: Icono,
}: {
  ruta: string
  etiqueta: string
  descripcion: string
  icono: LucideIcon
}) {
  return (
    <Link
      to={ruta}
      className="group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-3.5 py-3 shadow-suave transition-all hover:-translate-y-px hover:border-brand-200 hover:shadow-md active:translate-y-0"
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 transition-colors group-hover:bg-brand-600 group-hover:text-white"
      >
        <Icono className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-800">
          {etiqueta}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {descripcion}
        </span>
      </span>
      <ArrowUpRight
        aria-hidden
        className="size-4 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand-600"
      />
    </Link>
  )
}
