import { useMemo, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input, Select } from '@/shared/ui/Field'
import { ApiError } from '@/shared/api/client'
import { hoyISO } from '@/shared/format/fecha'
import type {
  SolicitudTarifaImpuesto,
  TarifaImpuesto,
  TipoImpuesto,
} from '@/shared/api/contracts/impuestos'
import { useGuardarTarifaImpuesto } from '../api/queries'
import {
  normalizarCodigoTarifa,
  validarTarifaImpuesto,
} from '../domain/impuesto'

/**
 * Alta y edición de una fila de la tabla de impuestos (docs/13 §3).
 *
 * Lo que se edita no es "el IVA general" sino una VIGENCIA suya: el código
 * identifica la tarifa que las facturas citan y las fechas dicen entre qué
 * días ese porcentaje rige. Cuando la ley cambia la tasa no se corrige esta
 * fila, se le pone fin y se abre otra: así una factura de hace dos años se
 * sigue recalculando con el porcentaje que tuvo.
 */

const NUEVA: SolicitudTarifaImpuesto = {
  codigo: '',
  nombre: '',
  tipo: 'iva',
  porcentaje: '13',
  vigenteDesde: hoyISO(),
  vigenteHasta: null,
  activa: true,
  codigoHacienda: null,
  generaImpuesto: true,
}

const TIPOS: readonly { tipo: TipoImpuesto; nombre: string }[] = [
  { tipo: 'iva', nombre: 'IVA' },
  { tipo: 'retencion', nombre: 'Retención en la fuente' },
]

export interface DialogoImpuestoProps {
  abierto: boolean
  onCerrar: () => void
  /** Sin tarifa, el diálogo abre una vigencia nueva. */
  tarifa?: TarifaImpuesto
  /** La tabla entera: es contra ella que se validan los solapamientos. */
  tarifas: readonly TarifaImpuesto[]
}

export function DialogoImpuesto({
  abierto,
  onCerrar,
  tarifa,
  tarifas,
}: DialogoImpuestoProps) {
  const creando = tarifa === undefined
  const guardar = useGuardarTarifaImpuesto()

  const [datos, setDatos] = useState<SolicitudTarifaImpuesto>(() =>
    tarifa
      ? {
          codigo: tarifa.codigo,
          nombre: tarifa.nombre,
          tipo: tarifa.tipo,
          porcentaje: tarifa.porcentaje,
          vigenteDesde: tarifa.vigenteDesde,
          vigenteHasta: tarifa.vigenteHasta,
          activa: tarifa.activa,
          codigoHacienda: tarifa.codigoHacienda,
          generaImpuesto: tarifa.generaImpuesto,
        }
      : { ...NUEVA },
  )
  const [intento, setIntento] = useState(false)

  const cambiar = (cambios: Partial<SolicitudTarifaImpuesto>) =>
    setDatos((prev) => ({ ...prev, ...cambios }))

  const solicitud: SolicitudTarifaImpuesto = useMemo(
    () => ({
      ...datos,
      codigo: normalizarCodigoTarifa(datos.codigo),
      nombre: datos.nombre.trim(),
      porcentaje: datos.porcentaje.trim() || '0',
      vigenteHasta: datos.vigenteHasta || null,
      codigoHacienda: datos.codigoHacienda?.trim() || null,
    }),
    [datos],
  )

  const validacion = useMemo(
    () => validarTarifaImpuesto(solicitud, { tarifas, tarifa }),
    [solicitud, tarifas, tarifa],
  )

  const errorDe = (
    campo: keyof SolicitudTarifaImpuesto,
  ): string | undefined =>
    intento
      ? validacion.errores.find((e) => e.campo === campo)?.mensaje
      : undefined

  const errorServidor = guardar.error instanceof ApiError ? guardar.error : null

  // Editar una vigencia ya cerrada o pasada recalcula documentos que ya se
  // emitieron: se avisa, no se impide, porque corregir una tasa mal tecleada
  // es justo lo que esta pantalla tiene que permitir.
  const tocaElPasado = !creando && solicitud.vigenteDesde <= hoyISO()

  const enviar = async () => {
    setIntento(true)
    if (!validacion.valido) return
    await guardar.mutateAsync({ datos: solicitud, id: tarifa?.id })
    onCerrar()
  }

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={creando ? 'Nueva tarifa' : `Tarifa ${tarifa.codigo}`}
      descripcion="El código es lo que las facturas guardan; el porcentaje se resuelve por la fecha del documento."
      className="w-[min(94vw,42rem)]"
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Código"
          requerido
          ayuda="GENERAL, REDUCIDA_4, EXENTO"
          error={errorDe('codigo')}
        >
          {(p) => (
            <Input
              {...p}
              value={datos.codigo}
              className="font-mono"
              onChange={(e) => cambiar({ codigo: e.target.value })}
            />
          )}
        </Field>

        <Field label="Nombre" requerido error={errorDe('nombre')}>
          {(p) => (
            <Input
              {...p}
              value={datos.nombre}
              placeholder="IVA general 13%"
              onChange={(e) => cambiar({ nombre: e.target.value })}
            />
          )}
        </Field>

        <Field label="Tipo" requerido>
          {(p) => (
            <Select
              {...p}
              value={datos.tipo}
              onChange={(e) =>
                cambiar({ tipo: e.target.value as TipoImpuesto })
              }
            >
              {TIPOS.map((t) => (
                <option key={t.tipo} value={t.tipo}>
                  {t.nombre}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Porcentaje"
          requerido
          ayuda="Sin el signo: 13, 4, 0"
          error={errorDe('porcentaje')}
        >
          {(p) => (
            <Input
              {...p}
              value={datos.porcentaje}
              inputMode="decimal"
              className="tabular text-right"
              onChange={(e) =>
                cambiar({ porcentaje: e.target.value.replace(',', '.') })
              }
            />
          )}
        </Field>

        <Field
          label="Vigente desde"
          requerido
          error={errorDe('vigenteDesde')}
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              value={datos.vigenteDesde}
              onChange={(e) => cambiar({ vigenteDesde: e.target.value })}
            />
          )}
        </Field>

        <Field
          label="Vigente hasta"
          ayuda="Vacío: sigue rigiendo"
          error={errorDe('vigenteHasta')}
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              value={datos.vigenteHasta ?? ''}
              onChange={(e) =>
                cambiar({ vigenteHasta: e.target.value || null })
              }
            />
          )}
        </Field>

        <Field
          label="Código de Hacienda"
          ayuda="El del catálogo del comprobante electrónico. Vacío si no se ha confirmado."
        >
          {(p) => (
            <Input
              {...p}
              value={datos.codigoHacienda ?? ''}
              inputMode="numeric"
              maxLength={2}
              placeholder="08"
              className="font-mono"
              onChange={(e) => cambiar({ codigoHacienda: e.target.value })}
            />
          )}
        </Field>

        <div className="flex flex-col justify-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={datos.activa}
              onChange={(e) => cambiar({ activa: e.target.checked })}
              className="size-3.5 rounded border-slate-300 accent-brand-600"
            />
            Se ofrece al capturar
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={datos.generaImpuesto}
              onChange={(e) => cambiar({ generaImpuesto: e.target.checked })}
              className="size-3.5 rounded border-slate-300 accent-brand-600"
            />
            Genera impuesto
          </label>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Desmarcar &quot;genera impuesto&quot; es lo que distingue exento y no
        sujeto de una tarifa del 0%: los tres dan cero, pero se declaran en
        casillas distintas del D-104.
      </p>

      {tocaElPasado && (
        <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200 ring-inset">
          Esta vigencia ya empezó. Las facturas emitidas guardan sus importes y
          no cambian, pero todo lo que se recalcule contra esta fila usará el
          porcentaje nuevo. Si lo que cambió es la ley, cierre esta vigencia y
          abra otra en lugar de editar el porcentaje.
        </p>
      )}

      {(intento && !validacion.valido) || errorServidor ? (
        <div className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor ? errorServidor.message : 'Revise los datos'}
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {(errorServidor
              ? errorServidor.detalles
              : validacion.errores.map((e) => e.mensaje)
            ).map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialogo>
  )
}
