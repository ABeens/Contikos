import { useMemo, useState } from 'react'
import { CircleAlert, Plus, TriangleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { ApiError } from '@/shared/api/client'
import { monedaFuncional } from '@/shared/money/money'
import type { OrigenTipoCambio } from '@/shared/api/contracts/config'
import { useMonedas } from '../api/queries'
import { useRegistrarTipoCambio, useSerieTipoCambio } from '../api/tiposCambio'

/**
 * Tabla de tipos de cambio (docs/13 §7, docs/10 §2).
 *
 * Es la entidad `TipoCambio` del modelo de datos: un valor por moneda y por
 * día. Existe porque el campo `tipoCambio` del catálogo de monedas no tiene
 * fecha, y sin fecha no se puede contabilizar: lo que vale en una factura de
 * marzo es el tipo de marzo, no el de hoy.
 *
 * La pantalla enseña de dónde sale cada fila (columna Origen y columna Fuente)
 * porque no todas valen lo mismo: una tasa transcrita del Banco Central es un
 * dato oficial, y la plantilla de demostración con la que arranca el sistema no
 * lo es.
 */
export function TiposCambioPage() {
  const funcional = monedaFuncional()
  const { data: monedas = [] } = useMonedas()

  const extranjeras = useMemo(
    () => monedas.filter((m) => !m.funcional),
    [monedas],
  )

  const [moneda, setMoneda] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  // La primera moneda extranjera del catálogo llega después del primer render.
  const monedaActiva = moneda || (extranjeras[0]?.codigo ?? '')

  const serie = useSerieTipoCambio(monedaActiva, {
    desde: desde || undefined,
    hasta: hasta || undefined,
  })
  const filas = serie.data ?? []

  return (
    <div>
      <PageHeader
        titulo="Tipos de cambio"
        descripcion={`Un valor por moneda y por día, expresado en ${funcional} por unidad. Es lo que se usa para contabilizar un documento en moneda extranjera.`}
      />

      <p className="mb-4 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200 ring-inset">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          El sistema arranca con una <strong>plantilla de demostración</strong>:
          una serie de ejemplo, realista pero no oficial, para poder trabajar
          mientras el poblado automático desde la fuente oficial no exista. Las
          filas de la plantilla se reconocen por su fuente y por el origen
          derivado. Capture manualmente la tasa del día cuando necesite el dato
          bueno; lo capturado queda congelado en los asientos que lo usen.
        </span>
      </p>

      <Card>
        <CardHeader
          titulo="Serie de la moneda"
          descripcion="El tipo de cambio que rige en una fecha es el de ese día o, si no lo hay, el último anterior."
        />
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">
          <Field label="Moneda" className="w-44">
            {(props) => (
              <Select
                {...props}
                value={monedaActiva}
                onChange={(e) => setMoneda(e.target.value)}
              >
                {extranjeras.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.codigo} · {m.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Desde" className="w-40">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
            )}
          </Field>
          <Field label="Hasta" className="w-40">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            )}
          </Field>
          <span className="ml-auto text-xs text-slate-500">
            {filas.length} día{filas.length === 1 ? '' : 's'} en la serie
          </span>
        </div>

        {serie.isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Cargando la serie…
          </p>
        ) : filas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            No hay tipos de cambio de {monedaActiva} en el rango indicado.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto border-t border-slate-200">
            <table className="w-full text-sm" aria-label="Tipos de cambio">
              <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="w-36 px-4 py-2 text-left">Fecha</th>
                  <th className="w-40 px-3 py-2 text-right">Compra</th>
                  <th className="w-40 px-3 py-2 text-right">Venta</th>
                  <th className="w-32 px-3 py-2 text-left">Origen</th>
                  <th className="px-4 py-2 text-left">Fuente</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <tr
                    key={fila.fecha}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-1.5 text-slate-800">
                      {formatFecha(fila.fecha)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <MoneyCell valor={fila.compra} moneda={funcional} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <MoneyCell valor={fila.venta} moneda={funcional} />
                    </td>
                    <td className="px-3 py-1.5">
                      <OrigenBadge origen={fila.origen} />
                    </td>
                    <td className="px-4 py-1.5 text-xs text-slate-500">
                      {fila.fuente}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AltaTipoCambio moneda={monedaActiva} funcional={funcional} />
    </div>
  )
}

/**
 * De dónde sale el valor.
 *
 * `publicado` es un dato que la fuente publica tal cual; `derivado` se calculó
 * a partir de otros. La distinción importa en un asiento: no es lo mismo
 * contabilizar con la tasa que el Banco Central publicó que con una deducida.
 */
function OrigenBadge({ origen }: { origen: OrigenTipoCambio }) {
  return (
    <span
      className={
        origen === 'publicado'
          ? 'inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200 ring-inset'
          : 'inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 ring-inset'
      }
    >
      {origen === 'publicado' ? 'Publicado' : 'Derivado'}
    </span>
  )
}

/**
 * Captura manual para una fecha.
 *
 * Si ya hay un valor de esa moneda y esa fecha, lo reemplaza: la llave de la
 * tabla es (moneda, fecha) y dos valores para el mismo día no son historia,
 * son una contradicción.
 */
function AltaTipoCambio({
  moneda,
  funcional,
}: {
  moneda: string
  funcional: string
}) {
  const registrar = useRegistrarTipoCambio()
  const [fecha, setFecha] = useState(hoyISO())
  const [compra, setCompra] = useState('')
  const [venta, setVenta] = useState('')
  const [fuente, setFuente] = useState('Banco Central de Costa Rica')
  const [guardado, setGuardado] = useState<string | null>(null)

  const completo = Boolean(moneda && fecha && compra && venta && fuente.trim())

  const enviar = () => {
    setGuardado(null)
    registrar.mutate(
      { moneda, fecha, compra, venta, fuente },
      {
        onSuccess: (fila) => {
          setGuardado(fila.fecha)
          setCompra('')
          setVenta('')
        },
      },
    )
  }

  return (
    <Card className="mt-4">
      <CardHeader
        titulo={`Capturar tipo de cambio de ${moneda || 'la moneda'}`}
        descripcion={`Compra y venta en ${funcional} por una unidad. Se marca como publicado: lo que se teclea es un dato oficial transcrito.`}
      />
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Fecha" requerido>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          )}
        </Field>
        <Field label="Compra" requerido>
          {(props) => (
            <MoneyInput
              {...props}
              value={compra}
              onChange={setCompra}
              moneda={funcional}
            />
          )}
        </Field>
        <Field label="Venta" requerido>
          {(props) => (
            <MoneyInput
              {...props}
              value={venta}
              onChange={setVenta}
              moneda={funcional}
            />
          )}
        </Field>
        <Field label="Fuente" requerido>
          {(props) => (
            <Input
              {...props}
              value={fuente}
              onChange={(e) => setFuente(e.target.value)}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3">
        {guardado && (
          <p role="status" className="text-sm text-emerald-700">
            Tipo de cambio de {moneda} del {formatFecha(guardado)} guardado.
          </p>
        )}
        {registrar.error && (
          <p className="flex items-center gap-1.5 text-sm text-red-700">
            <CircleAlert className="size-4 shrink-0" />
            {registrar.error instanceof ApiError
              ? registrar.error.message
              : 'No se pudo guardar el tipo de cambio'}
          </p>
        )}
        <Button
          variante="primario"
          className="ml-auto"
          icono={<Plus className="size-4" />}
          onClick={enviar}
          disabled={!completo || registrar.isPending}
        >
          {registrar.isPending ? 'Guardando…' : 'Guardar tipo de cambio'}
        </Button>
      </div>
    </Card>
  )
}
