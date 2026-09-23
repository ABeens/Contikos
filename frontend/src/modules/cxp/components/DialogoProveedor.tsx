import { useMemo, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input, Select } from '@/shared/ui/Field'
import { MensajeError } from '@/shared/ui/MensajeError'
import { SelectorCuenta } from '@/shared/ui/SelectorCuenta'
import { SelectorTercero } from '@/shared/ui/SelectorTercero'
import { monedaFuncional, monedasActivas } from '@/shared/money/money'
import {
  TIPOS_IDENTIFICACION,
  normalizarIdentificacion,
  validarIdentificacion,
  type TipoIdentificacion,
} from '@/shared/fiscal/identificacion'
import type { Cuenta } from '@/shared/api/contracts/conta'
import type { Proveedor, SolicitudProveedor } from '@/shared/api/contracts/cxp'
import { useGuardarProveedor } from '../api/queries'
import { validarProveedor } from '../domain/proveedor'

/**
 * Alta y edición de proveedor.
 *
 * La retención aplicable es un dato del proveedor y no de la factura: quien
 * captura no debería tener que acordarse de a quién se le retiene (docs/05 §1).
 *
 * El teléfono y la actividad económica no son adorno: el buzón de
 * comprobantes recibidos (docs/13 §4.4) los cita al aceptar o rechazar ante
 * Hacienda el XML que este proveedor emite.
 */

const NUEVO: SolicitudProveedor = {
  codigo: '',
  razonSocial: '',
  nombreComercial: null,
  tipoIdentificacion: 'JURIDICA',
  identificacion: '',
  correo: null,
  telefono: null,
  actividadEconomica: null,
  diasCredito: 30,
  moneda: 'CRC',
  cuentaGasto: null,
  retencionRenta: '0',
  activo: true,
}

export interface DialogoProveedorProps {
  abierto: boolean
  onCerrar: () => void
  proveedor?: Proveedor
  /** El resto del maestro: es contra él que se validan los duplicados. */
  proveedores: readonly Proveedor[]
  cuentas: readonly Cuenta[]
}

export function DialogoProveedor({
  abierto,
  onCerrar,
  proveedor,
  proveedores,
  cuentas,
}: DialogoProveedorProps) {
  const creando = proveedor === undefined
  const guardar = useGuardarProveedor()

  const [datos, setDatos] = useState<SolicitudProveedor>(() =>
    proveedor
      ? {
          codigo: proveedor.codigo,
          razonSocial: proveedor.razonSocial,
          nombreComercial: proveedor.nombreComercial,
          tipoIdentificacion: proveedor.tipoIdentificacion,
          identificacion: proveedor.identificacion,
          correo: proveedor.correo,
          telefono: proveedor.telefono,
          actividadEconomica: proveedor.actividadEconomica,
          diasCredito: proveedor.diasCredito,
          moneda: proveedor.moneda,
          cuentaGasto: proveedor.cuentaGasto,
          retencionRenta: proveedor.retencionRenta,
          activo: proveedor.activo,
        }
      : { ...NUEVO, moneda: monedaFuncional() },
  )
  // El teléfono se captura suelto y se compone al validar: media captura no
  // es un teléfono, pero sí es lo que hay en pantalla mientras se teclea.
  const [codigoPais, setCodigoPais] = useState(
    () => proveedor?.telefono?.codigoPais ?? '506',
  )
  const [numeroTelefono, setNumeroTelefono] = useState(
    () => proveedor?.telefono?.numero ?? '',
  )
  const [intento, setIntento] = useState(false)

  /** El rechazo del servidor era de los datos de antes: al corregir, estorba. */
  const tocar = () => {
    if (guardar.isError) guardar.reset()
  }

  const cambiar = (cambios: Partial<SolicitudProveedor>) => {
    setDatos((prev) => ({ ...prev, ...cambios }))
    tocar()
  }

  const errorIdentificacion = validarIdentificacion(
    datos.identificacion,
    datos.tipoIdentificacion,
  )

  const solicitud: SolicitudProveedor = useMemo(
    () => ({
      ...datos,
      identificacion: normalizarIdentificacion(datos.identificacion),
      nombreComercial: datos.nombreComercial || null,
      correo: datos.correo || null,
      cuentaGasto: datos.cuentaGasto || null,
      retencionRenta: datos.retencionRenta || '0',
      actividadEconomica: datos.actividadEconomica || null,
      telefono: numeroTelefono.trim()
        ? { codigoPais: codigoPais.trim(), numero: numeroTelefono.trim() }
        : null,
    }),
    [datos, codigoPais, numeroTelefono],
  )

  const validacion = useMemo(
    () => validarProveedor(solicitud, { proveedores, proveedor }),
    [solicitud, proveedores, proveedor],
  )

  const errorDe = (campo: keyof SolicitudProveedor): string | undefined =>
    intento
      ? validacion.errores.find((e) => e.campo === campo)?.mensaje
      : undefined

  // Primero lo local: un rechazo del servidor no tapa lo que falta capturar.
  const errorServidor =
    intento && !validacion.valido ? null : guardar.error

  const enviar = () => {
    setIntento(true)
    if (!validacion.valido) return
    // El rechazo se enseña desde `guardar.error`; aquí solo se evita dejar la
    // promesa suelta y cerrar sobre un proveedor que no se guardó.
    guardar
      .mutateAsync({ datos: solicitud, id: proveedor?.id })
      .then(onCerrar, () => undefined)
  }

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={creando ? 'Nuevo proveedor' : `Proveedor ${proveedor.codigo}`}
      descripcion="Condiciones de pago, cuenta de gasto habitual y retenciones aplicables."
      className="w-[min(94vw,44rem)]"
      bloqueado={guardar.isPending}
      alEnviar={enviar}
      acciones={
        <>
          <Button onClick={onCerrar} disabled={guardar.isPending}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variante="primario"
            disabled={guardar.isPending}
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      {creando && (
        <SelectorTercero
          rol="proveedor"
          onElegir={(t) =>
            cambiar({
              tipoIdentificacion: t.tipoIdentificacion,
              identificacion: t.identificacion,
              razonSocial: t.razonSocial,
              nombreComercial: t.nombreComercial,
              correo: t.correo,
            })
          }
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Código" requerido error={errorDe('codigo')}>
          {(p) => (
            <Input
              {...p}
              value={datos.codigo}
              onChange={(e) => cambiar({ codigo: e.target.value })}
            />
          )}
        </Field>

        <Field label="Razón social" requerido error={errorDe('razonSocial')}>
          {(p) => (
            <Input
              {...p}
              value={datos.razonSocial}
              onChange={(e) => cambiar({ razonSocial: e.target.value })}
            />
          )}
        </Field>

        <Field label="Nombre comercial">
          {(p) => (
            <Input
              {...p}
              value={datos.nombreComercial ?? ''}
              onChange={(e) => cambiar({ nombreComercial: e.target.value })}
            />
          )}
        </Field>

        <Field label="Tipo de identificación" requerido>
          {(p) => (
            <Select
              {...p}
              value={datos.tipoIdentificacion}
              onChange={(e) =>
                cambiar({
                  tipoIdentificacion: e.target.value as TipoIdentificacion,
                })
              }
            >
              {Object.values(TIPOS_IDENTIFICACION).map((t) => (
                <option key={t.tipo} value={t.tipo}>
                  {t.nombre}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Identificación"
          requerido
          error={
            intento && !errorIdentificacion.valido
              ? errorIdentificacion.error
              : errorDe('identificacion')
          }
        >
          {(p) => (
            <Input
              {...p}
              value={datos.identificacion}
              inputMode="numeric"
              onChange={(e) => cambiar({ identificacion: e.target.value })}
            />
          )}
        </Field>

        <Field label="Correo" error={errorDe('correo')}>
          {(p) => (
            <Input
              {...p}
              type="email"
              value={datos.correo ?? ''}
              onChange={(e) => cambiar({ correo: e.target.value })}
            />
          )}
        </Field>

        <Field
          label="Teléfono"
          ayuda="Lo cita el buzón de comprobantes recibidos"
          error={errorDe('telefono')}
        >
          {(p) => (
            <div className="flex gap-2">
              <Input
                value={codigoPais}
                inputMode="numeric"
                aria-label="Código de país del teléfono"
                className="w-16 text-center"
                onChange={(e) => {
                  setCodigoPais(e.target.value)
                  tocar()
                }}
              />
              <Input
                {...p}
                value={numeroTelefono}
                inputMode="numeric"
                placeholder="22001100"
                className="flex-1"
                onChange={(e) => {
                  setNumeroTelefono(e.target.value)
                  tocar()
                }}
              />
            </div>
          )}
        </Field>

        <Field
          label="Actividad económica"
          ayuda="Código CIIU de 6 dígitos"
          error={errorDe('actividadEconomica')}
        >
          {(p) => (
            <Input
              {...p}
              value={datos.actividadEconomica ?? ''}
              inputMode="numeric"
              maxLength={6}
              placeholder="692000"
              onChange={(e) => cambiar({ actividadEconomica: e.target.value })}
            />
          )}
        </Field>

        <Field
          label="Días de crédito"
          ayuda="0 = contado"
          error={errorDe('diasCredito')}
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              value={datos.diasCredito}
              className="tabular text-right"
              onChange={(e) =>
                cambiar({ diasCredito: Math.max(0, Number(e.target.value)) })
              }
            />
          )}
        </Field>

        <Field
          label="Retención de renta (%)"
          ayuda="2% en servicios profesionales; 0 si no se le retiene"
          error={errorDe('retencionRenta')}
        >
          {(p) => (
            <Input
              {...p}
              value={datos.retencionRenta}
              inputMode="decimal"
              className="tabular text-right"
              onChange={(e) =>
                cambiar({ retencionRenta: e.target.value.replace(',', '.') })
              }
            />
          )}
        </Field>

        <Field label="Moneda habitual" error={errorDe('moneda')}>
          {(p) => (
            <Select
              {...p}
              value={datos.moneda}
              onChange={(e) => cambiar({ moneda: e.target.value })}
            >
              {monedasActivas().map((m) => (
                <option key={m.codigo} value={m.codigo}>
                  {m.nombre} ({m.codigo})
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Cuenta de gasto habitual"
          ayuda="Vacío: la cuenta del mapeo del módulo"
        >
          {() => (
            <SelectorCuenta
              value={datos.cuentaGasto ?? ''}
              onChange={(codigo) => cambiar({ cuentaGasto: codigo })}
              cuentas={cuentas}
              excluirControl
            />
          )}
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={datos.activo}
            onChange={(e) => cambiar({ activo: e.target.checked })}
            className="size-3.5 rounded border-slate-300 accent-brand-600"
          />
          Proveedor activo
        </label>
      </div>

      {intento && !validacion.valido ? (
        <div
          role="alert"
          className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset"
        >
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            Revise los datos
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {validacion.errores.map((e, i) => (
              <li key={i}>{e.mensaje}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <MensajeError error={errorServidor} className="mt-4" />
    </Dialogo>
  )
}
