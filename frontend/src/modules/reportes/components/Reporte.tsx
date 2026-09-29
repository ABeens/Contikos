import { Fragment, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Download,
  Printer,
  TriangleAlert,
} from 'lucide-react'
import Decimal from 'decimal.js'
import type { Periodo } from '@/shared/api/contracts/conta'
import { useEmpresa } from '@/app/empresa'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Field'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatPeriodo } from '@/shared/format/fecha'
import { formatIdentificacion } from '@/shared/fiscal/identificacion'
import { cn } from '@/shared/ui/cn'
import type {
  GrupoPresentado,
  RenglonPresentado,
} from '../domain/presentacion'
import type { Alcance } from './useFiltrosReporte'

/**
 * Piezas comunes de los reportes.
 *
 * Todos los estados se leen igual: renglones con su nota, un importe por
 * periodo, subtotales, y cada renglón se abre en sus cuentas y cada cuenta
 * lleva a su auxiliar en el mayor (docs/09 §5). Por eso la tabla es una sola y
 * cada pantalla solo decide qué bloques le pone.
 */

/* ----------------------------------------------------------------- Cabecera */

/**
 * Cabecera imprimible: empresa, estado, corte, libro y hora de generación.
 *
 * El libro va impreso siempre (docs/09 §3), y la hora también (docs/09 §9): dos
 * copias del mismo estado con cifras distintas solo se explican sabiendo cuándo
 * se generó cada una.
 */
export function EncabezadoReporte({
  titulo,
  lineas,
}: {
  titulo: string
  lineas: readonly string[]
}) {
  const { empresa } = useEmpresa()
  // Se fija al montar: la hora de generación es la de este cálculo, no la de
  // cada re-render.
  const [generado] = useState(() =>
    new Date().toLocaleString('es-CR', {
      dateStyle: 'long',
      timeStyle: 'short',
    }),
  )
  return (
    <div className="border-b border-slate-200 px-5 py-4 text-center">
      <p className="text-sm font-semibold text-slate-900">{empresa.nombre}</p>
      <p className="text-xs text-slate-500">
        {formatIdentificacion(empresa.identificacion, empresa.tipoIdentificacion)}
      </p>
      <h2 className="mt-2 text-base font-semibold text-slate-900">{titulo}</h2>
      {lineas.map((linea) => (
        <p key={linea} className="text-xs text-slate-600">
          {linea}
        </p>
      ))}
      <p className="mt-1 text-[11px] text-slate-400">Generado el {generado}</p>
    </div>
  )
}

/* --------------------------------------------------------------- Controles */

export function AccionesReporte({
  onExportar,
  exportable,
}: {
  onExportar: () => void
  exportable: boolean
}) {
  return (
    <>
      <Button
        tamano="sm"
        icono={<Download className="size-3.5" />}
        onClick={onExportar}
        disabled={!exportable}
      >
        Exportar CSV
      </Button>
      <Button
        tamano="sm"
        icono={<Printer className="size-3.5" />}
        onClick={() => window.print()}
        disabled={!exportable}
      >
        Imprimir
      </Button>
    </>
  )
}

export function SelectorComparar({
  periodos,
  actual,
  comparado,
  onChange,
}: {
  periodos: readonly Periodo[]
  actual: Periodo | undefined
  comparado: Periodo | undefined
  onChange: (id: string | null) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-600">
      Comparar con
      <Select
        aria-label="Periodo de comparación"
        className="h-7 w-44 py-0 text-xs"
        value={comparado?.id ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Sin comparar</option>
        {periodos
          .filter((p) => p.id !== actual?.id)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {formatPeriodo(p.ejercicio, p.numero)}
            </option>
          ))}
      </Select>
    </label>
  )
}

export function SelectorAlcance({
  valor,
  onChange,
}: {
  valor: Alcance
  onChange: (alcance: Alcance) => void
}) {
  const opciones: { valor: Alcance; etiqueta: string }[] = [
    { valor: 'mes', etiqueta: 'Del mes' },
    { valor: 'ejercicio', etiqueta: 'Acumulado del ejercicio' },
  ]
  return (
    <div
      role="radiogroup"
      aria-label="Alcance"
      className="inline-flex rounded-md bg-slate-100 p-0.5"
    >
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          aria-checked={valor === o.valor}
          onClick={() => onChange(o.valor)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            valor === o.valor
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ Avisos */

export function AvisoCuadre({
  cuadra,
  correcto,
  incorrecto,
}: {
  cuadra: boolean
  correcto: string
  incorrecto: ReactNode
}) {
  return cuadra ? (
    <p className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
      <CircleCheck className="size-3.5" />
      {correcto}
    </p>
  ) : (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200 ring-inset"
    >
      <CircleAlert className="size-4 shrink-0" />
      <span>{incorrecto}</span>
    </div>
  )
}

/**
 * Hay saldos en cuentas sin un renglón válido para este estado.
 *
 * El estado sigue cuadrando porque esos saldos se presentan aparte, pero no se
 * puede entregar así: el aviso dice dónde se arregla.
 */
export function AvisoSinClasificar() {
  return (
    <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset print:hidden">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>
        Hay cuentas con saldo que no tienen un renglón de este estado. Se
        presentan aparte, marcadas, para que el total no mienta. Asígneles su
        clasificación en{' '}
        <Link to="/conta/cuentas" className="font-medium underline">
          el catálogo de cuentas
        </Link>
        .
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------- Tabla */

/**
 * La tabla de un estado financiero.
 *
 * Una `<table>` y no el `DataTable` de listados: aquí no se ordena ni se
 * filtra, y el orden de las filas ES el estado. Los importes van a la derecha,
 * con los negativos entre paréntesis como es costumbre en estados financieros.
 */
export function TablaEstado({
  comparando,
  etiquetaActual,
  etiquetaComparado,
  children,
}: {
  comparando: boolean
  etiquetaActual: string
  etiquetaComparado?: string
  children: ReactNode
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500">
            <th className="px-4 py-2 text-left font-medium">Concepto</th>
            <th className="w-16 px-2 py-2 text-center font-medium">Nota</th>
            <th className="w-40 px-4 py-2 text-right font-medium">
              {etiquetaActual}
            </th>
            {comparando && (
              <>
                <th className="w-40 px-4 py-2 text-right font-medium">
                  {etiquetaComparado}
                </th>
                <th className="w-32 px-4 py-2 text-right font-medium">
                  Variación
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Importes({
  importe,
  comparado,
  comparando,
  className,
}: {
  importe: string
  comparado: string | null
  comparando: boolean
  className?: string
}) {
  return (
    <>
      <td className={cn('px-4 py-1.5 text-right', className)}>
        <MoneyCell valor={importe} parentesisNegativos />
      </td>
      {comparando && (
        <>
          <td className={cn('px-4 py-1.5 text-right', className)}>
            <MoneyCell valor={comparado ?? '0'} parentesisNegativos />
          </td>
          <td className={cn('px-4 py-1.5 text-right text-slate-500', className)}>
            <MoneyCell
              valor={new Decimal(importe).minus(comparado ?? '0').toFixed(2)}
              parentesisNegativos
              ocultarCero
            />
          </td>
        </>
      )}
    </>
  )
}

export function FilaTitulo({
  titulo,
  comparando,
  nivel = 1,
}: {
  titulo: string
  comparando: boolean
  nivel?: 1 | 2
}) {
  return (
    <tr>
      <td
        colSpan={comparando ? 5 : 3}
        className={cn(
          'px-4 pt-4 pb-1',
          nivel === 1
            ? 'text-xs font-semibold tracking-wide text-slate-900 uppercase'
            : 'text-sm font-semibold text-slate-700',
        )}
      >
        {titulo}
      </td>
    </tr>
  )
}

export function FilaTotal({
  etiqueta,
  importe,
  comparado,
  comparando,
  enfasis = 'subtotal',
}: {
  etiqueta: string
  importe: string
  comparado: string | null
  comparando: boolean
  enfasis?: 'subtotal' | 'total' | 'final'
}) {
  const clases = {
    subtotal: 'font-medium text-slate-800 border-t border-slate-200',
    total: 'font-semibold text-slate-900 border-t-2 border-slate-300',
    final: 'font-semibold text-slate-900 border-t-2 border-b-4 border-double border-slate-400',
  }[enfasis]
  return (
    <tr className={clases}>
      <td className="px-4 py-2">{etiqueta}</td>
      <td />
      <Importes importe={importe} comparado={comparado} comparando={comparando} />
    </tr>
  )
}

/**
 * Un renglón que se abre en sus cuentas, y cada cuenta enlaza a su auxiliar.
 *
 * Es el drill-down de docs/09 §5: renglón, cuentas, movimientos del mayor,
 * asiento y documento. Los dos últimos escalones los da la pantalla de
 * asientos, que ya enlaza el documento de origen.
 */
export function FilaRenglon({
  renglon,
  comparando,
  enlaceCuenta,
  sangria = 0,
}: {
  renglon: RenglonPresentado
  comparando: boolean
  enlaceCuenta?: (codigo: string) => string
  sangria?: number
}) {
  const [abierto, setAbierto] = useState(false)
  const tieneCuentas = renglon.cuentas.length > 0
  return (
    <>
      <tr
        className={cn(
          'hover:bg-slate-50',
          renglon.sinClasificar && 'bg-amber-50/60',
        )}
      >
        <td className="px-4 py-1.5" style={{ paddingLeft: 16 + sangria * 16 }}>
          {tieneCuentas ? (
            <button
              type="button"
              aria-expanded={abierto}
              onClick={() => setAbierto((v) => !v)}
              className="inline-flex items-center gap-1 text-left text-slate-800 hover:text-brand-700"
            >
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 text-slate-400 transition-transform print:hidden',
                  abierto && 'rotate-90',
                )}
              />
              {renglon.nombre}
            </button>
          ) : (
            <span className="text-slate-800">{renglon.nombre}</span>
          )}
          {renglon.sinClasificar && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              sin clasificar
            </span>
          )}
        </td>
        <td className="px-2 py-1.5 text-center text-xs text-slate-500">
          {renglon.notas.join(', ')}
        </td>
        <Importes
          importe={renglon.importe}
          comparado={renglon.comparado}
          comparando={comparando}
        />
      </tr>
      {abierto &&
        renglon.cuentas.map((cuenta) => (
          <tr key={cuenta.codigo} className="text-xs text-slate-600">
            <td
              className="py-1"
              style={{ paddingLeft: 40 + sangria * 16 }}
            >
              {enlaceCuenta ? (
                <Link
                  to={enlaceCuenta(cuenta.codigo)}
                  className="hover:text-brand-700 hover:underline"
                  title="Ver los movimientos de la cuenta"
                >
                  <span className="font-mono">{cuenta.codigo}</span>{' '}
                  {cuenta.nombre}
                </Link>
              ) : (
                <>
                  <span className="font-mono">{cuenta.codigo}</span>{' '}
                  {cuenta.nombre}
                </>
              )}
            </td>
            <td />
            <Importes
              importe={cuenta.importe}
              comparado={cuenta.comparado}
              comparando={comparando}
              className="py-1"
            />
          </tr>
        ))}
    </>
  )
}

/** Un grupo con su título, sus renglones y su subtotal. */
export function FilasGrupo({
  titulo,
  grupo,
  comparando,
  enlaceCuenta,
  etiquetaTotal,
}: {
  titulo: string
  grupo: GrupoPresentado
  comparando: boolean
  enlaceCuenta?: (codigo: string) => string
  etiquetaTotal?: string
}) {
  return (
    <Fragment>
      <FilaTitulo titulo={titulo} comparando={comparando} nivel={2} />
      {grupo.renglones.map((renglon) => (
        <FilaRenglon
          key={renglon.clave}
          renglon={renglon}
          comparando={comparando}
          enlaceCuenta={enlaceCuenta}
          sangria={1}
        />
      ))}
      <FilaTotal
        etiqueta={etiquetaTotal ?? `Total ${titulo.toLowerCase()}`}
        importe={grupo.total}
        comparado={grupo.comparado}
        comparando={comparando}
      />
    </Fragment>
  )
}

/** Estado de carga común, para no repetir el mismo párrafo en cada pantalla. */
export function Calculando({ texto = 'Calculando el reporte…' }: { texto?: string }) {
  return (
    <p className="px-4 py-10 text-center text-sm text-slate-500" aria-busy>
      {texto}
    </p>
  )
}
