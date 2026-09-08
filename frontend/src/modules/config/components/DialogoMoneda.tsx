import { useMemo, useState } from 'react'
import Decimal from 'decimal.js'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input, Select } from '@/shared/ui/Field'
import { formatConConfig } from '@/shared/money/format'
import { ApiError } from '@/shared/api/client'
import type {
  MonedaConfig,
  SolicitudMoneda,
} from '@/shared/api/contracts/config'
import type {
  PosicionSimbolo,
  SeparadorDecimal,
  SeparadorGrupo,
} from '@/shared/money/money'
import { aSolicitud, validarMoneda } from '../domain/moneda'
import { useGuardarMoneda } from '../api/queries'

/** Importe de muestra. Suficientemente grande para ver la agrupación. */
const EJEMPLO = new Decimal('1234567.891')

const SEPARADORES_GRUPO: { valor: SeparadorGrupo; etiqueta: string }[] = [
  { valor: '.', etiqueta: 'Punto  ·  1.234.567' },
  { valor: ',', etiqueta: 'Coma  ·  1,234,567' },
  { valor: ' ', etiqueta: 'Espacio  ·  1 234 567' },
  { valor: "'", etiqueta: 'Apóstrofo  ·  1’234’567' },
  { valor: '', etiqueta: 'Ninguno  ·  1234567' },
]

const SEPARADORES_DECIMAL: { valor: SeparadorDecimal; etiqueta: string }[] = [
  { valor: ',', etiqueta: 'Coma  ·  1234,56' },
  { valor: '.', etiqueta: 'Punto  ·  1234.56' },
]

const POSICIONES: { valor: PosicionSimbolo; etiqueta: string }[] = [
  { valor: 'antes', etiqueta: 'Antes del importe  ·  ₡1.234' },
  { valor: 'despues', etiqueta: 'Después del importe  ·  1.234 €' },
]

type Formulario = SolicitudMoneda

const NUEVA: Formulario = {
  codigo: '',
  nombre: '',
  simbolo: '',
  decimales: 2,
  grupo: '.',
  decimal: ',',
  posicionSimbolo: 'antes',
  activa: true,
  tipoCambio: '',
}

export interface DialogoMonedaProps {
  abierto: boolean
  onCerrar: () => void
  /** Sin moneda, el diálogo da de alta una nueva. */
  moneda?: MonedaConfig
  monedas: readonly MonedaConfig[]
}

/**
 * Alta y edición de una moneda.
 *
 * El código no se puede cambiar una vez creada: es la llave con la que quedaron
 * grabados los asientos, y renombrarla los dejaría huérfanos. Para "cambiar" el
 * código hay que dar de alta la nueva y desactivar la anterior.
 */
export function DialogoMoneda({
  abierto,
  onCerrar,
  moneda,
  monedas,
}: DialogoMonedaProps) {
  const creando = moneda === undefined
  const guardar = useGuardarMoneda()

  // El estado se reinicia con la clave del diálogo (ver `key` en la página),
  // así que basta con inicializarlo desde las props.
  const [form, setForm] = useState<Formulario>(() =>
    moneda ? aSolicitud(moneda) : { ...NUEVA },
  )
  const [intentoEnvio, setIntentoEnvio] = useState(false)

  const cambiar = <K extends keyof Formulario>(campo: K, valor: Formulario[K]) =>
    setForm((prev) => ({ ...prev, [campo]: valor }))

  const validacion = useMemo(
    () =>
      validarMoneda(
        { ...form, codigo: form.codigo.trim().toUpperCase() },
        { monedas, enUso: moneda?.enUso },
        creando,
      ),
    [form, monedas, moneda, creando],
  )

  const errorDe = (campo: keyof Formulario): string | undefined => {
    if (!intentoEnvio) return undefined
    return validacion.errores.find((e) => e.campo === campo)?.mensaje
  }

  // La vista previa usa la configuración que se está editando, no la del
  // registro: la gracia es ver el resultado antes de guardar.
  const vistaPrevia = formatConConfig(
    EJEMPLO,
    { ...form, codigo: form.codigo || '???', funcional: false },
    { simbolo: true },
  )

  const enviar = async () => {
    setIntentoEnvio(true)
    if (!validacion.valido) return
    await guardar.mutateAsync({
      moneda: { ...form, codigo: form.codigo.trim().toUpperCase() },
      creando,
    })
    onCerrar()
  }

  const errorServidor =
    guardar.error instanceof ApiError ? guardar.error : null

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={creando ? 'Nueva moneda' : `Moneda ${moneda.codigo}`}
      descripcion={
        creando
          ? 'El código ISO 4217 identifica la moneda y no se puede cambiar después.'
          : 'El código no es editable: es la llave con la que quedaron grabados los asientos.'
      }
      acciones={
        <>
          <Button onClick={onCerrar}>Cancelar</Button>
          <Button
            variante="primario"
            onClick={() => void enviar()}
            disabled={guardar.isPending}
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Código ISO 4217" requerido error={errorDe('codigo')}>
          {(p) => (
            <Input
              {...p}
              value={form.codigo}
              disabled={!creando}
              maxLength={3}
              placeholder="EUR"
              autoFocus={creando}
              className="font-mono uppercase"
              onChange={(e) => cambiar('codigo', e.target.value.toUpperCase())}
            />
          )}
        </Field>

        <Field label="Símbolo" requerido error={errorDe('simbolo')}>
          {(p) => (
            <Input
              {...p}
              value={form.simbolo}
              maxLength={4}
              placeholder="€"
              onChange={(e) => cambiar('simbolo', e.target.value)}
            />
          )}
        </Field>

        <Field
          label="Nombre"
          requerido
          className="col-span-2"
          error={errorDe('nombre')}
        >
          {(p) => (
            <Input
              {...p}
              value={form.nombre}
              placeholder="Euro"
              autoFocus={!creando}
              onChange={(e) => cambiar('nombre', e.target.value)}
            />
          )}
        </Field>

        <Field
          label="Decimales"
          requerido
          error={errorDe('decimales')}
          ayuda={
            moneda?.enUso ? 'No editable: la moneda ya tiene movimientos' : undefined
          }
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              max={6}
              value={String(form.decimales)}
              disabled={moneda?.enUso}
              className="tabular"
              onChange={(e) => cambiar('decimales', Number(e.target.value))}
            />
          )}
        </Field>

        <Field
          label="Tipo de cambio de referencia"
          requerido
          error={errorDe('tipoCambio')}
          ayuda={
            moneda?.funcional
              ? 'Moneda funcional: siempre 1'
              : 'Valor en moneda funcional. Referencia BCCR'
          }
        >
          {(p) => (
            <Input
              {...p}
              value={form.tipoCambio}
              disabled={moneda?.funcional}
              placeholder="592.40"
              className="tabular text-right"
              onChange={(e) => cambiar('tipoCambio', e.target.value)}
            />
          )}
        </Field>

        <Field label="Separador de miles" error={errorDe('grupo')}>
          {(p) => (
            <Select
              {...p}
              value={form.grupo}
              onChange={(e) =>
                cambiar('grupo', e.target.value as SeparadorGrupo)
              }
            >
              {SEPARADORES_GRUPO.map((s) => (
                <option key={s.etiqueta} value={s.valor}>
                  {s.etiqueta}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Separador decimal" error={errorDe('decimal')}>
          {(p) => (
            <Select
              {...p}
              value={form.decimal}
              onChange={(e) =>
                cambiar('decimal', e.target.value as SeparadorDecimal)
              }
            >
              {SEPARADORES_DECIMAL.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.etiqueta}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Posición del símbolo" className="col-span-2">
          {(p) => (
            <Select
              {...p}
              value={form.posicionSimbolo}
              onChange={(e) =>
                cambiar('posicionSimbolo', e.target.value as PosicionSimbolo)
              }
            >
              {POSICIONES.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.etiqueta}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="col-span-2">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.activa}
              disabled={moneda?.funcional}
              className="mt-0.5 size-4 accent-brand-600"
              onChange={(e) => cambiar('activa', e.target.checked)}
            />
            <span>
              Activa
              <span className="block text-xs text-slate-500">
                Una moneda inactiva no se ofrece al capturar, pero los documentos
                que ya la usan se siguen viendo.
              </span>
            </span>
          </label>
          {errorDe('activa') && (
            <p className="mt-1 text-xs text-red-600">{errorDe('activa')}</p>
          )}
        </div>

        <div className="col-span-2 rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200 ring-inset">
          <p className="text-[11px] font-medium text-slate-500">
            Así se verán los importes
          </p>
          <p className="tabular mt-0.5 text-lg font-semibold text-slate-800">
            {vistaPrevia}
          </p>
          <p className="tabular text-xs text-negativo">
            {formatConConfig(
              EJEMPLO.negated(),
              { ...form, codigo: form.codigo || '???', funcional: false },
              { simbolo: true, parentesisNegativos: true },
            )}{' '}
            <span className="text-slate-400">en reportes</span>
          </p>
        </div>
      </div>

      {(intentoEnvio && !validacion.valido) || errorServidor ? (
        <div className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor
              ? `${errorServidor.codigo} — ${errorServidor.message}`
              : 'La moneda no se puede guardar'}
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {(errorServidor?.detalles.length
              ? errorServidor.detalles
              : validacion.errores.map((e) => e.mensaje)
            ).map((mensaje, i) => (
              <li key={i}>{mensaje}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialogo>
  )
}
