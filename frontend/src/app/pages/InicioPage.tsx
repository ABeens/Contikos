import { Link } from 'react-router'
import { CircleCheck, CircleAlert } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha } from '@/shared/format/fecha'
import { formatNumeroAsiento } from '@/shared/asiento/formato'
import { useEmpresa } from '../empresa'
import { useAsientos, useBalanza } from '@/modules/conta/api/queries'

/**
 * Portada.
 *
 * Contesta tres preguntas del día — cuánto se movió, si cuadra y qué se
 * registró — y nada más. El diagrama de la arquitectura y la parrilla de los
 * doce periodos ocupaban la mitad de la pantalla para decir algo que no cambia
 * de un día para otro.
 */
export function InicioPage() {
  const { periodoActivo, cargando } = useEmpresa()
  const { data: fiscal } = useBalanza(periodoActivo?.id, 'fiscal')
  const { data: corporativa } = useBalanza(periodoActivo?.id, 'corporativo')
  // Sin periodo resuelto no se pide el mayor entero: llegaría para que lo
  // sustituyera un instante después la consulta del periodo.
  const { data: asientos = [] } = useAsientos(
    periodoActivo?.id,
    undefined,
    !cargando,
  )
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
      <PageHeader titulo="Resumen" />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Indicador
          etiqueta="Asientos del periodo"
          valor={String(asientos.length)}
        />
        <Indicador
          etiqueta="Movimientos del periodo"
          valor={
            fiscal ? <MoneyCell valor={fiscal.totalCargos} mostrarSimbolo /> : '—'
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
            ) : (
              '—'
            )
          }
        />
      </div>

      <Card>
        <CardHeader
          titulo="Últimos asientos"
          acciones={
            <Link
              to="/conta/asientos"
              className="self-center text-xs font-medium text-brand-700 hover:underline"
            >
              Ver todos
            </Link>
          }
        />
        {recientes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Sin asientos en el periodo.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recientes.map((asiento) => (
              <li
                key={asiento.id}
                className="flex items-center gap-3 px-4 py-2 text-sm"
              >
                <span className="font-mono text-xs text-slate-500">
                  {formatNumeroAsiento(asiento.numero)}
                </span>
                <span className="w-20 shrink-0 text-xs text-slate-500">
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
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Atajo a="/conta/asientos/nuevo" texto="Capturar asiento" />
        <Atajo a="/cxc/facturas/nueva" texto="Facturar a un cliente" />
        <Atajo a="/cxp/facturas/nueva" texto="Registrar factura de gasto" />
        <Atajo a="/conta/balanza" texto="Ver balanza" />
      </div>
    </div>
  )
}

function Indicador({
  etiqueta,
  valor,
  nota,
}: {
  etiqueta: string
  valor: React.ReactNode
  nota?: React.ReactNode
}) {
  return (
    <Card className="px-4 py-3">
      <p className="text-[11px] text-slate-500">{etiqueta}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-900">{valor}</p>
      {nota && <p className="mt-0.5 text-[11px] text-slate-500">{nota}</p>}
    </Card>
  )
}

function Atajo({ a, texto }: { a: string; texto: string }) {
  return (
    <Link
      to={a}
      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:border-brand-300 hover:text-brand-700"
    >
      {texto}
    </Link>
  )
}
