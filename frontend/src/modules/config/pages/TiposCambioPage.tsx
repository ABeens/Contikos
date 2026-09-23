import { useMemo, useState } from 'react'
import { Plus, TriangleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { DialogoConfirmacion } from '@/shared/ui/DialogoConfirmacion'
import { Field, Input, Select } from '@/shared/ui/Field'
import { MensajeError } from '@/shared/ui/MensajeError'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { configuracionMoneda, monedaFuncional } from '@/shared/money/money'
import type {
  MonedaConfig,
  OrigenTipoCambio,
  SolicitudTipoCambio,
  TipoCambio,
} from '@/shared/api/contracts/config'
import { TasaInput } from '../components/TasaInput'
import { formatTasa } from '../domain/tasa'
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
  const consultaMonedas = useMonedas()
  const { data: monedas = [] } = consultaMonedas

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
  const config = configuracionMoneda(funcional)

  // Sin catálogo no hay nada que listar ni que capturar, y "no hay tipos de
  // cambio" sería mentira: no se sabe.
  if (consultaMonedas.isError && monedas.length === 0) {
    return (
      <div>
        <PageHeader titulo="Tipos de cambio" />
        <Card>
          <EstadoError
            titulo="No se pudo cargar el catálogo de monedas"
            error={consultaMonedas.error}
            onReintentar={() => void consultaMonedas.refetch()}
            reintentando={consultaMonedas.isFetching}
          />
        </Card>
      </div>
    )
  }

  const sinExtranjeras = !consultaMonedas.isLoading && extranjeras.length === 0

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

      {sinExtranjeras ? (
        <Card>
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            El catálogo solo tiene la moneda funcional ({funcional}), y esa se
            cambia a sí misma a la par. Dé de alta una moneda extranjera en
            Monedas para llevar su serie aquí.
          </p>
        </Card>
      ) : (
        <>
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
              {serie.isSuccess && (
                <span className="ml-auto text-xs text-slate-500">
                  {filas.length} día{filas.length === 1 ? '' : 's'} en la serie
                </span>
              )}
            </div>

            {consultaMonedas.isLoading || serie.isLoading ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                Cargando la serie…
              </p>
            ) : serie.isError ? (
              <EstadoError
                titulo={`No se pudo cargar la serie de ${monedaActiva}`}
                error={serie.error}
                onReintentar={() => void serie.refetch()}
                reintentando={serie.isFetching}
              />
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
                        {/* Con todos sus decimales: redondeada a los de la
                            funcional ya no es la tasa que se contabiliza. */}
                        <td className="tabular px-3 py-1.5 text-right text-slate-700">
                          {formatTasa(fila.compra, config)}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right text-slate-700">
                          {formatTasa(fila.venta, config)}
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

          <AltaTipoCambio
            extranjeras={extranjeras}
            monedaInicial={monedaActiva}
            funcional={funcional}
          />
        </>
      )}
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
 * son una contradicción. Pero reemplazar no es lo mismo que capturar, así que
 * antes se enseña el valor que se va a perder y se pide confirmación.
 *
 * La moneda es propia del formulario y no la del filtro de arriba: antes la
 * seguía, y cambiar el filtro para consultar otra serie con una tasa a medio
 * teclear la guardaba en la moneda equivocada.
 */
function AltaTipoCambio({
  extranjeras,
  monedaInicial,
  funcional,
}: {
  extranjeras: readonly MonedaConfig[]
  monedaInicial: string
  funcional: string
}) {
  const registrar = useRegistrarTipoCambio()
  const [monedaElegida, setMonedaElegida] = useState('')
  const [fecha, setFecha] = useState(() => hoyISO())
  const [compra, setCompra] = useState('')
  const [venta, setVenta] = useState('')
  const [fuente, setFuente] = useState('Banco Central de Costa Rica')
  const [guardado, setGuardado] = useState<TipoCambio | null>(null)
  const [porReemplazar, setPorReemplazar] = useState<
    SolicitudTipoCambio | null
  >(null)
  // Remonta los campos de tasa tras guardar: su texto interno es del valor
  // que ya se guardó.
  const [vuelta, setVuelta] = useState(0)

  const moneda = monedaElegida || monedaInicial

  // El valor que ya hay para esa moneda y ese día, si lo hay.
  const existente = useSerieTipoCambio(moneda, { desde: fecha, hasta: fecha })
  const anterior = existente.data?.find((f) => f.fecha === fecha)

  const completo = Boolean(moneda && fecha && compra && venta && fuente.trim())
  // Mientras se averigua si el día ya tiene valor no se deja guardar: la
  // respuesta decide si hay que pedir confirmación.
  const comprobando = existente.isLoading

  const cambiado = () => {
    setGuardado(null)
    if (registrar.error) registrar.reset()
  }

  const guardar = (solicitud: SolicitudTipoCambio) => {
    registrar.mutate(solicitud, {
      onSuccess: (fila) => {
        setGuardado(fila)
        setPorReemplazar(null)
        setCompra('')
        setVenta('')
        setVuelta((v) => v + 1)
      },
    })
  }

  const enviar = () => {
    if (!completo || comprobando || registrar.isPending) return
    setGuardado(null)
    const solicitud = { moneda, fecha, compra, venta, fuente: fuente.trim() }
    // Si no se pudo saber si la fecha ya tiene valor, se pregunta igual: es
    // preferible una confirmación de más que un reemplazo sin aviso.
    if (anterior || existente.isError) {
      registrar.reset()
      setPorReemplazar(solicitud)
      return
    }
    guardar(solicitud)
  }

  const config = configuracionMoneda(funcional)

  return (
    <Card className="mt-4">
      <CardHeader
        titulo="Capturar un tipo de cambio"
        descripcion={`Compra y venta en ${funcional} por una unidad. Se marca como publicado: lo que se teclea es un dato oficial transcrito.`}
      />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          enviar()
        }}
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Moneda" requerido>
            {(props) => (
              <Select
                {...props}
                value={moneda}
                onChange={(e) => {
                  setMonedaElegida(e.target.value)
                  cambiado()
                }}
              >
                {extranjeras.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.codigo} · {m.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Fecha"
            requerido
            ayuda={
              anterior
                ? `Ya hay un valor ese día (venta ${formatTasa(anterior.venta, config)}): se reemplazará`
                : undefined
            }
          >
            {(props) => (
              <Input
                {...props}
                type="date"
                value={fecha}
                onChange={(e) => {
                  setFecha(e.target.value)
                  cambiado()
                }}
              />
            )}
          </Field>
          <Field label="Compra" requerido>
            {(props) => (
              <TasaInput
                key={`compra-${vuelta}`}
                {...props}
                value={compra}
                onChange={(v) => {
                  setCompra(v)
                  cambiado()
                }}
                moneda={funcional}
              />
            )}
          </Field>
          <Field label="Venta" requerido>
            {(props) => (
              <TasaInput
                key={`venta-${vuelta}`}
                {...props}
                value={venta}
                onChange={(v) => {
                  setVenta(v)
                  cambiado()
                }}
                moneda={funcional}
              />
            )}
          </Field>
          <Field label="Fuente" requerido>
            {(props) => (
              <Input
                {...props}
                value={fuente}
                onChange={(e) => {
                  setFuente(e.target.value)
                  cambiado()
                }}
              />
            )}
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3">
          {guardado && (
            // La moneda y la fecha salen de lo guardado, no del formulario:
            // si el usuario ya cambió de moneda, el aviso seguiría diciendo
            // la verdad.
            <p role="status" className="text-sm text-emerald-700">
              Tipo de cambio de {guardado.moneda} del{' '}
              {formatFecha(guardado.fecha)} guardado.
            </p>
          )}
          {!porReemplazar && <MensajeError error={registrar.error} />}
          <Button
            type="submit"
            variante="primario"
            className="ml-auto"
            icono={<Plus className="size-4" />}
            disabled={!completo || comprobando || registrar.isPending}
          >
            {registrar.isPending ? 'Guardando…' : 'Guardar tipo de cambio'}
          </Button>
        </div>
      </form>

      <DialogoConfirmacion
        abierto={porReemplazar !== null}
        titulo={
          anterior
            ? `Reemplazar el tipo de cambio de ${porReemplazar?.moneda ?? ''}`
            : 'Guardar el tipo de cambio'
        }
        descripcion={porReemplazar ? formatFecha(porReemplazar.fecha) : undefined}
        textoConfirmar={anterior ? 'Reemplazar' : 'Guardar'}
        textoConfirmando="Guardando…"
        pendiente={registrar.isPending}
        error={registrar.error}
        onConfirmar={() => porReemplazar && guardar(porReemplazar)}
        onCancelar={() => {
          setPorReemplazar(null)
          registrar.reset()
        }}
      >
        {anterior ? (
          <>
            <p>
              Ese día ya tiene un valor. Solo hay uno por moneda y por fecha,
              así que el nuevo sustituye al anterior. Los asientos ya
              contabilizados con el anterior no cambian: cada uno lo congeló.
            </p>
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 text-left font-medium" />
                  <th className="py-1 text-right font-medium">Compra</th>
                  <th className="py-1 text-right font-medium">Venta</th>
                  <th className="py-1 pl-3 text-left font-medium">Fuente</th>
                </tr>
              </thead>
              <tbody className="tabular">
                <tr>
                  <td className="py-1 text-slate-500">Anterior</td>
                  <td className="py-1 text-right">
                    {formatTasa(anterior.compra, config)}
                  </td>
                  <td className="py-1 text-right">
                    {formatTasa(anterior.venta, config)}
                  </td>
                  <td className="py-1 pl-3 text-slate-600">{anterior.fuente}</td>
                </tr>
                {porReemplazar && (
                  <tr className="font-medium text-slate-800">
                    <td className="py-1 text-slate-500">Nuevo</td>
                    <td className="py-1 text-right">
                      {formatTasa(porReemplazar.compra, config)}
                    </td>
                    <td className="py-1 text-right">
                      {formatTasa(porReemplazar.venta, config)}
                    </td>
                    <td className="py-1 pl-3">{porReemplazar.fuente}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        ) : (
          <p>
            No se pudo comprobar si ese día ya tiene un tipo de cambio. Si lo
            tiene, el nuevo lo sustituye.
          </p>
        )}
      </DialogoConfirmacion>
    </Card>
  )
}
