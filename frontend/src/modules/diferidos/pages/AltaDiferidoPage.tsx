import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { CircleAlert, Save } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { SelectorCuenta } from '@/shared/ui/SelectorCuenta'
import { SelectorAuxiliar } from '@/shared/ui/SelectorAuxiliar'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { ApiError } from '@/shared/api/client'
import { monedaFuncional, monedasActivas } from '@/shared/money/money'
import { cn } from '@/shared/ui/cn'
import { useAuxiliares, useCuentas, usePeriodos } from '@/shared/api/catalogos'
import {
  auxiliaresVigentes,
  resolverAuxiliar,
  textoAuxiliar,
} from '@/shared/auxiliares/auxiliar'
import type { AuxiliarTipo } from '@/shared/api/contracts/comunes'
import type {
  SolicitudDiferido,
  TipoDiferido,
} from '@/shared/api/contracts/diferidos'
import { tablaAmortizacion, validarDiferido } from '../domain/diferido'
import { useGuardarDiferido } from '../api/queries'

/**
 * Alta de un diferido (docs/15 §3.1).
 *
 * La pantalla enseña el plan completo antes de guardar, cuota a cuota: es la
 * única forma de comprobar de un vistazo que el monto cierra exacto en cero en
 * la última y que el reparto es el que se esperaba. Y dice en voz alta lo que
 * más confunde de este módulo: el alta NO genera asiento, porque el importe ya
 * está en la cuenta de balance desde que se pagó o se cobró.
 */

/** Tercero que exige cada tipo. Coincide con la cuenta de balance que le toca. */
const AUXILIAR_DE: Record<TipoDiferido, AuxiliarTipo> = {
  gasto: 'proveedor',
  ingreso: 'cliente',
}

export function AltaDiferidoPage() {
  const navegar = useNavigate()
  const { data: cuentas = [] } = useCuentas()
  const { data: periodos = [] } = usePeriodos()
  const guardar = useGuardarDiferido()

  const [tipo, setTipo] = useState<TipoDiferido>('gasto')
  const [datos, setDatos] = useState({
    descripcion: '',
    monto: '',
    moneda: monedaFuncional(),
    cuentaDiferido: '',
    cuentaDestino: '',
    fechaInicio: hoyISO(),
    plazoMeses: '12',
  })
  const [textoTercero, setTextoTercero] = useState('')
  const [intentado, setIntentado] = useState(false)

  const auxiliares = useAuxiliares([AUXILIAR_DE[tipo]])
  const catalogoTercero = auxiliares.get(AUXILIAR_DE[tipo]) ?? []
  const tercero = resolverAuxiliar(catalogoTercero, textoTercero)

  const cambiar = (campo: keyof typeof datos, valor: string) =>
    setDatos((previos) => ({ ...previos, [campo]: valor }))

  // Cambiar de tipo cambia el papel de las dos cuentas y del tercero: dejar lo
  // capturado sería ofrecer un mapeo que ya no puede ser válido.
  const cambiarTipo = (nuevo: TipoDiferido) => {
    setTipo(nuevo)
    setDatos((previos) => ({ ...previos, cuentaDiferido: '', cuentaDestino: '' }))
    setTextoTercero('')
  }

  const plazoMeses = Number(datos.plazoMeses) || 0

  const solicitud: SolicitudDiferido = {
    tipo,
    descripcion: datos.descripcion,
    tercero: tercero
      ? { tipo: AUXILIAR_DE[tipo], id: tercero.id, nombre: tercero.nombre }
      : null,
    monto: datos.monto || '0',
    moneda: datos.moneda,
    cuentaDiferido: datos.cuentaDiferido,
    cuentaDestino: datos.cuentaDestino,
    fechaInicio: datos.fechaInicio,
    plazoMeses,
  }

  const validacion = useMemo(
    () => validarDiferido(solicitud, { cuentas, periodos }),
    // La solicitud se reconstruye en cada render; lo que la determina son estos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tipo, datos, tercero?.id, cuentas, periodos],
  )

  const plan = useMemo(
    () =>
      tablaAmortizacion({
        monto: datos.monto || '0',
        plazoMeses,
        fechaInicio: datos.fechaInicio,
        moneda: datos.moneda,
      }),
    [datos.monto, plazoMeses, datos.fechaInicio, datos.moneda],
  )

  const enviar = () => {
    setIntentado(true)
    if (!validacion.valido) return
    guardar.mutate(
      { datos: solicitud },
      { onSuccess: (creado) => navegar(`/diferidos?diferido=${creado.id}`) },
    )
  }

  const errores = intentado ? validacion.errores : []

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        titulo="Registrar diferido"
        descripcion="El plan de reconocimiento de un gasto pagado o de un ingreso cobrado por adelantado."
      />

      <div
        role="radiogroup"
        aria-label="Tipo de diferido"
        className="mb-4 inline-flex rounded-md bg-slate-100 p-0.5"
      >
        <BotonTipo
          activo={tipo === 'gasto'}
          onClick={() => cambiarTipo('gasto')}
          etiqueta="Gasto diferido"
        />
        <BotonTipo
          activo={tipo === 'ingreso'}
          onClick={() => cambiarTipo('ingreso')}
          etiqueta="Ingreso diferido"
        />
      </div>

      <p className="mb-4 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800 ring-1 ring-sky-200 ring-inset">
        {tipo === 'gasto'
          ? 'Pagado por adelantado: el saldo por amortizar descansa en una cuenta de activo y cada mes se carga a resultados.'
          : 'Cobrado por adelantado: el saldo por amortizar descansa en una cuenta de pasivo y cada mes se abona a resultados.'}{' '}
        Registrar el diferido no genera asiento: el importe ya está en la cuenta
        de balance desde que el documento que lo originó se contabilizó.
      </p>

      <Card>
        <CardHeader titulo="Datos del diferido" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Descripción" requerido className="sm:col-span-2">
            {(props) => (
              <Input
                {...props}
                value={datos.descripcion}
                onChange={(e) => cambiar('descripcion', e.target.value)}
                placeholder="Póliza de seguro de responsabilidad civil 2026"
              />
            )}
          </Field>

          <Field
            label={tipo === 'gasto' ? 'Proveedor' : 'Cliente'}
            ayuda="Lo exige la cuenta de balance cuando lleva auxiliar."
          >
            {() => (
              <SelectorAuxiliar
                tipo={AUXILIAR_DE[tipo]}
                value={textoTercero}
                onChange={setTextoTercero}
                onBlur={() =>
                  tercero && setTextoTercero(textoAuxiliar(tercero))
                }
                auxiliares={auxiliaresVigentes(catalogoTercero)}
              />
            )}
          </Field>

          <Field label="Monto" requerido>
            {(props) => (
              <MoneyInput
                {...props}
                value={datos.monto}
                onChange={(valor) => cambiar('monto', valor)}
                moneda={datos.moneda}
              />
            )}
          </Field>

          <Field label="Moneda">
            {(props) => (
              <Select
                {...props}
                value={datos.moneda}
                onChange={(e) => cambiar('moneda', e.target.value)}
              >
                {monedasActivas().map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.codigo} · {m.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Plazo en meses" requerido>
            {(props) => (
              <Input
                {...props}
                type="number"
                min={1}
                value={datos.plazoMeses}
                onChange={(e) => cambiar('plazoMeses', e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Fecha de inicio"
            requerido
            ayuda="Primer mes que se reconoce. El mes de inicio cuenta entero."
          >
            {(props) => (
              <Input
                {...props}
                type="date"
                value={datos.fechaInicio}
                onChange={(e) => cambiar('fechaInicio', e.target.value)}
              />
            )}
          </Field>

          <Field
            label={
              tipo === 'gasto'
                ? 'Cuenta de balance (activo)'
                : 'Cuenta de balance (pasivo)'
            }
            requerido
            className="sm:col-span-2"
          >
            {() => (
              <SelectorCuenta
                value={datos.cuentaDiferido}
                onChange={(codigo) => cambiar('cuentaDiferido', codigo)}
                cuentas={cuentas}
                etiqueta="Cuenta de balance del diferido"
              />
            )}
          </Field>

          <Field
            label={
              tipo === 'gasto'
                ? 'Cuenta de resultados (gasto o costo)'
                : 'Cuenta de resultados (ingreso)'
            }
            requerido
            className="sm:col-span-2"
          >
            {() => (
              <SelectorCuenta
                value={datos.cuentaDestino}
                onChange={(codigo) => cambiar('cuentaDestino', codigo)}
                cuentas={cuentas}
                etiqueta="Cuenta de resultados del diferido"
              />
            )}
          </Field>
        </div>

        {errores.length > 0 && (
          <ul
            aria-label="Errores del diferido"
            className="border-t border-slate-200 px-4 py-2 text-sm text-red-700"
          >
            {errores.map((e) => (
              <li key={e.codigo} className="flex items-start gap-2 py-0.5">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {e.mensaje}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-slate-200 px-4 py-3">
          <span className="text-xs text-slate-500">
            {plan.length > 0
              ? `${plan.length} cuota${plan.length === 1 ? '' : 's'} proyectada${plan.length === 1 ? '' : 's'}.`
              : 'Capture el monto y el plazo para ver el plan.'}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {guardar.error && (
              <span className="text-sm text-red-700">
                {guardar.error instanceof ApiError
                  ? guardar.error.message
                  : 'No se pudo registrar el diferido'}
              </span>
            )}
            <Button
              variante="primario"
              icono={<Save className="size-4" />}
              onClick={enviar}
              disabled={guardar.isPending}
            >
              {guardar.isPending ? 'Guardando…' : 'Registrar diferido'}
            </Button>
          </div>
        </div>
      </Card>

      {plan.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            titulo="Tabla de amortización"
            descripcion="El plan completo antes de guardar. La última cuota ajusta el remanente para que el saldo cierre exacto en cero."
          />
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm" aria-label="Tabla de amortización">
              <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="w-16 px-4 py-2 text-left">Cuota</th>
                  <th className="w-32 px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-right">Importe</th>
                  <th className="px-3 py-2 text-right">Acumulado</th>
                  <th className="px-4 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((fila) => (
                  <tr
                    key={fila.numero}
                    className={cn(
                      'border-b border-slate-100 last:border-0',
                      fila.numero === plan.length && 'bg-slate-50 font-medium',
                    )}
                  >
                    <td className="px-4 py-1.5 tabular text-slate-600">
                      {fila.numero}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700">
                      {formatFecha(fila.fecha)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <MoneyCell valor={fila.cuota} moneda={datos.moneda} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <MoneyCell valor={fila.acumulado} moneda={datos.moneda} />
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <MoneyCell valor={fila.saldo} moneda={datos.moneda} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function BotonTipo({
  activo,
  onClick,
  etiqueta,
}: {
  activo: boolean
  onClick: () => void
  etiqueta: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activo}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors',
        activo ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900',
      )}
    >
      {etiqueta}
    </button>
  )
}
