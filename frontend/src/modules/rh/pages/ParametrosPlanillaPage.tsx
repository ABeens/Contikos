import { useState } from 'react'
import { CopyPlus } from 'lucide-react'
import Decimal from 'decimal.js'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { Field, Input } from '@/shared/ui/Field'
import { ResumenErrores } from '@/shared/ui/ResumenErrores'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFechaLarga, hoyISO } from '@/shared/format/fecha'
import type { ParametrosPlanilla, SolicitudParametrosPlanilla } from '@/shared/api/contracts/rh'
import { useAcceso } from '@/app/acceso'
import { cn } from '@/shared/ui/cn'
import { parametrosVigentes } from '../domain/calculo'
import { useParametrosPlanilla, useRegistrarParametros } from '../api/queries'

/**
 * Parámetros de planilla con vigencia (D-06, docs/13 §6).
 *
 * Es la respuesta a "¿qué pasa cuando cambia la ley?": se registra una
 * vigencia nueva, copiando la actual y cambiando lo que cambió, con la norma
 * que la respalda. Las anteriores no se tocan nunca: siguen rigiendo las
 * planillas de su tiempo, y recalcular un mes viejo da lo mismo que dio.
 */
export function ParametrosPlanillaPage() {
  const consulta = useParametrosPlanilla()
  const { puede } = useAcceso()
  const lista = consulta.data ?? []
  const vigente = parametrosVigentes(lista, hoyISO())
  const [elegido, setElegido] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<SolicitudParametrosPlanilla | null>(null)

  const mostrado = lista.find((p) => p.id === elegido) ?? vigente ?? lista[0]

  const nuevaVigencia = () => {
    const base = vigente ?? lista[0]
    if (!base) return
    const { id, ...resto } = base
    void id
    setBorrador({ ...structuredClone(resto), vigenteDesde: `${new Date().getFullYear() + 1}-01-01`, fuente: '' })
  }

  if (consulta.isError) {
    return <EstadoError error={consulta.error} onReintentar={() => void consulta.refetch()} />
  }

  return (
    <div>
      <PageHeader
        titulo="Parámetros de planilla"
        descripcion="Tasas de la CCSS, tramos del impuesto al salario, créditos y provisiones, cada uno con la fecha desde la que rige. Cuando cambia la ley, se registra una vigencia nueva."
        acciones={
          puede('planilla.operar') &&
          !borrador && (
            <Button variante="primario" icono={<CopyPlus className="size-4" />} onClick={nuevaVigencia}>
              Nueva vigencia
            </Button>
          )
        }
      />

      {borrador ? (
        <FormularioVigencia borrador={borrador} onCambiar={setBorrador} onTerminar={() => setBorrador(null)} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <Card>
            <CardHeader titulo="Vigencias" />
            <ul className="p-2">
              {lista.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setElegido(p.id)}
                    aria-current={p.id === mostrado?.id ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm',
                      p.id === mostrado?.id ? 'bg-brand-50 font-medium text-brand-800' : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    Desde {p.vigenteDesde}
                    {p.id === vigente?.id && <EstadoBadge estado="vigente" />}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {mostrado && <DetalleVigencia parametros={mostrado} />}
        </div>
      )}
    </div>
  )
}

function DetalleVigencia({ parametros }: { parametros: ParametrosPlanilla }) {
  const total = (paga: 'trabajador' | 'patrono') =>
    parametros.cargas
      .filter((c) => c.paga === paga)
      .reduce((acc, c) => acc.plus(c.tasa), new Decimal(0))
      .toFixed(2)
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          titulo={`Vigentes desde el ${formatFechaLarga(parametros.vigenteDesde)}`}
          descripcion={parametros.fuente}
        />
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Carga social</th>
              <th className="px-3 py-2 text-left">Paga</th>
              <th className="px-3 py-2 text-left">Base</th>
              <th className="px-4 py-2 text-right">Tasa</th>
            </tr>
          </thead>
          <tbody>
            {parametros.cargas.map((c) => (
              <tr key={c.codigo} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-1.5 text-slate-800">
                  {c.nombre}
                  {c.exentaPymeMenosDe5 && (
                    <span className="ml-1.5 text-xs text-slate-400">(no aplica a patronos de menos de 5)</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-slate-600">{c.paga}</td>
                <td className="px-3 py-1.5 text-xs text-slate-500">
                  {c.base === 'salario' ? 'Salario' : `Base mínima ${c.base.toUpperCase()}`}
                </td>
                <td className="tabular px-4 py-1.5 text-right">{c.tasa} %</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 text-xs font-semibold text-slate-700">
            <tr>
              <td className="px-4 py-2" colSpan={3}>
                Total trabajador {total('trabajador')} % · total patrono {total('patrono')} %
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader titulo="Impuesto al salario, tramos mensuales" />
          <table className="w-full text-sm">
            <tbody>
              {parametros.tramosRenta.map((t) => (
                <tr key={t.desde} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-1.5 text-slate-700">
                    {t.hasta === null ? (
                      <>Más de <MoneyCell valor={t.desde} /></>
                    ) : (
                      <>
                        <MoneyCell valor={t.desde} /> a <MoneyCell valor={t.hasta} />
                      </>
                    )}
                  </td>
                  <td className="tabular px-4 py-1.5 text-right">{Number(t.tasa) === 0 ? 'Exento' : `${t.tasa} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
            Créditos mensuales: <MoneyCell valor={parametros.creditoHijo} /> por hijo y{' '}
            <MoneyCell valor={parametros.creditoConyuge} /> por cónyuge.
          </p>
        </Card>
        <Card>
          <CardHeader titulo="Bases y provisiones" />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-sm">
            <dt className="text-slate-500">Base mínima SEM</dt>
            <dd className="text-right"><MoneyCell valor={parametros.baseMinimaSem} /></dd>
            <dt className="text-slate-500">Base mínima IVM</dt>
            <dd className="text-right"><MoneyCell valor={parametros.baseMinimaIvm} /></dd>
            <dt className="text-slate-500">Provisión de aguinaldo</dt>
            <dd className="tabular text-right">{parametros.provisionAguinaldo} %</dd>
            <dt className="text-slate-500">Provisión de vacaciones</dt>
            <dd className="tabular text-right">{parametros.provisionVacaciones} %</dd>
            <dt className="text-slate-500">Provisión de cesantía</dt>
            <dd className="tabular text-right">{parametros.provisionCesantia} %</dd>
            <dt className="text-slate-500">Recargo de la hora extra</dt>
            <dd className="tabular text-right">{parametros.recargoHoraExtra} %</dd>
            <dt className="text-slate-500">Horas de la jornada mensual</dt>
            <dd className="tabular text-right">{parametros.horasMes}</dd>
          </dl>
        </Card>
      </div>
    </div>
  )
}

/**
 * Registro de una vigencia nueva.
 *
 * Parte de la actual para que solo se toque lo que cambió: casi siempre es una
 * tasa, o los tramos de renta de enero.
 */
function FormularioVigencia({
  borrador,
  onCambiar,
  onTerminar,
}: {
  borrador: SolicitudParametrosPlanilla
  onCambiar: (b: SolicitudParametrosPlanilla) => void
  onTerminar: () => void
}) {
  const registrar = useRegistrarParametros()
  const [fallos, setFallos] = useState(0)
  const campo = <K extends keyof SolicitudParametrosPlanilla>(k: K, v: SolicitudParametrosPlanilla[K]) =>
    onCambiar({ ...borrador, [k]: v })
  const decimal = (v: string) => v.replace(',', '.').trim()

  const enviar = () =>
    registrar.mutate(borrador, {
      onSuccess: onTerminar,
      onError: () => setFallos((n) => n + 1),
    })

  const numero = (etiqueta: string, valor: string, alCambiar: (v: string) => void, sufijo = '') => (
    <Field label={etiqueta}>
      {(p) => (
        <div className="flex items-center gap-1">
          <Input {...p} inputMode="decimal" className="tabular text-right" value={valor} onChange={(e) => alCambiar(decimal(e.target.value))} />
          {sufijo && <span className="text-xs text-slate-500">{sufijo}</span>}
        </div>
      )}
    </Field>
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader titulo="Nueva vigencia" descripcion="Copia de la actual. Cambie lo que cambió y diga qué norma lo respalda." />
        <div className="grid gap-4 px-4 py-3 sm:grid-cols-[12rem_1fr]">
          <Field label="Rige desde" requerido>
            {(p) => <Input {...p} type="date" value={borrador.vigenteDesde} onChange={(e) => campo('vigenteDesde', e.target.value)} />}
          </Field>
          <Field label="Fuente" requerido ayuda="Decreto, acuerdo de Junta Directiva de la CCSS…">
            {(p) => <Input {...p} value={borrador.fuente} onChange={(e) => campo('fuente', e.target.value)} />}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader titulo="Cargas sociales" />
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
          {borrador.cargas.map((c, i) =>
            <div key={c.codigo}>
              {numero(`${c.nombre} (${c.paga})`, c.tasa, (v) =>
                campo('cargas', borrador.cargas.map((x, j) => (j === i ? { ...x, tasa: v } : x))), '%')}
            </div>,
          )}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader titulo="Tramos del impuesto al salario" descripcion="Cada tramo termina donde empieza el siguiente. El último no tiene tope." />
          <div className="space-y-2 px-4 py-3">
            {borrador.tramosRenta.map((t, i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                {numero('Desde', t.desde, (v) =>
                  campo('tramosRenta', borrador.tramosRenta.map((x, j) => (j === i ? { ...x, desde: v } : x))))}
                {t.hasta === null ? (
                  <p className="self-end pb-2 text-xs text-slate-500">Sin tope</p>
                ) : (
                  numero('Hasta', t.hasta, (v) =>
                    campo('tramosRenta', borrador.tramosRenta.map((x, j) => (j === i ? { ...x, hasta: v } : x))))
                )}
                {numero('Tasa', t.tasa, (v) =>
                  campo('tramosRenta', borrador.tramosRenta.map((x, j) => (j === i ? { ...x, tasa: v } : x))), '%')}
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-2">
              {numero('Crédito por hijo', borrador.creditoHijo, (v) => campo('creditoHijo', v))}
              {numero('Crédito por cónyuge', borrador.creditoConyuge, (v) => campo('creditoConyuge', v))}
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader titulo="Bases y provisiones" />
          <div className="grid grid-cols-2 gap-3 px-4 py-3">
            {numero('Base mínima SEM', borrador.baseMinimaSem, (v) => campo('baseMinimaSem', v))}
            {numero('Base mínima IVM', borrador.baseMinimaIvm, (v) => campo('baseMinimaIvm', v))}
            {numero('Provisión de aguinaldo', borrador.provisionAguinaldo, (v) => campo('provisionAguinaldo', v), '%')}
            {numero('Provisión de vacaciones', borrador.provisionVacaciones, (v) => campo('provisionVacaciones', v), '%')}
            {numero('Provisión de cesantía', borrador.provisionCesantia, (v) => campo('provisionCesantia', v), '%')}
            {numero('Recargo hora extra', borrador.recargoHoraExtra, (v) => campo('recargoHoraExtra', v), '%')}
            {numero('Horas de la jornada mensual', borrador.horasMes, (v) => campo('horasMes', v))}
          </div>
        </Card>
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={onTerminar} disabled={registrar.isPending}>
          Cancelar
        </Button>
        <Button variante="primario" onClick={enviar} disabled={registrar.isPending}>
          {registrar.isPending ? 'Registrando…' : 'Registrar vigencia'}
        </Button>
      </div>

      <ResumenErrores
        titulo="La vigencia no se puede registrar"
        errores={[]}
        errorServidor={registrar.error}
        senal={fallos}
      />
    </div>
  )
}
