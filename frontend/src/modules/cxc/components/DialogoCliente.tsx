import { useMemo, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input, Select } from '@/shared/ui/Field'
import { SelectorCuenta } from '@/shared/ui/SelectorCuenta'
import { SelectorTercero } from '@/shared/ui/SelectorTercero'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { ApiError } from '@/shared/api/client'
import { monedaFuncional, monedasActivas } from '@/shared/money/money'
import {
  TIPOS_IDENTIFICACION,
  normalizarIdentificacion,
  validarIdentificacion,
  type TipoIdentificacion,
} from '@/shared/fiscal/identificacion'
import { PROVINCIAS, provinciaPorCodigo } from '@/shared/fiscal/ubicaciones'
import type { Cuenta } from '@/shared/api/contracts/conta'
import {
  CONDICIONES_VENTA,
  MEDIOS_PAGO,
  type CondicionVenta,
  type MedioPago,
} from '@/shared/api/contracts/terceros'
import type { Cliente, SolicitudCliente } from '@/shared/api/contracts/cxc'
import { useGuardarCliente } from '../api/queries'
import { listoParaFe, validarCliente } from '../domain/cliente'

/**
 * Alta y edición de cliente.
 *
 * La identificación se valida de formato contra las reglas de Costa Rica
 * (docs/13 §2). La verificación real contra el padrón de Hacienda es del
 * servidor: aquí solo se evita capturar una cédula que no puede existir.
 *
 * La segunda mitad del diálogo son los datos del receptor del comprobante
 * electrónico (docs/13 §4). Son opcionales, porque se puede facturar sin
 * ellos mientras la emisión no exista, pero si se capturan tienen que tener
 * la forma que el XML exige: un rechazo de Hacienda llega mucho después de
 * que quien capturó se haya ido a otra cosa.
 */

const NUEVO: SolicitudCliente = {
  codigo: '',
  razonSocial: '',
  nombreComercial: null,
  tipoIdentificacion: 'JURIDICA',
  identificacion: '',
  correo: null,
  diasCredito: 30,
  limiteCredito: '0',
  moneda: 'CRC',
  cuentaIngreso: null,
  activo: true,
  telefono: null,
  ubicacion: null,
  actividadEconomica: null,
  condicionVenta: null,
  medioPago: null,
}

/** Lo que la ubicación es en la pantalla: cinco campos de texto sueltos. */
interface UbicacionCaptura {
  provincia: string
  canton: string
  distrito: string
  barrio: string
  otrasSenas: string
}

const UBICACION_VACIA: UbicacionCaptura = {
  provincia: '',
  canton: '',
  distrito: '',
  barrio: '',
  otrasSenas: '',
}

export interface DialogoClienteProps {
  abierto: boolean
  onCerrar: () => void
  /** Sin cliente, el diálogo da de alta uno nuevo. */
  cliente?: Cliente
  /** El resto de la cartera: es contra ella que se validan los duplicados. */
  clientes: readonly Cliente[]
  cuentas: readonly Cuenta[]
}

export function DialogoCliente({
  abierto,
  onCerrar,
  cliente,
  clientes,
  cuentas,
}: DialogoClienteProps) {
  const creando = cliente === undefined
  const guardar = useGuardarCliente()

  const [datos, setDatos] = useState<SolicitudCliente>(() =>
    cliente
      ? {
          codigo: cliente.codigo,
          razonSocial: cliente.razonSocial,
          nombreComercial: cliente.nombreComercial,
          tipoIdentificacion: cliente.tipoIdentificacion,
          identificacion: cliente.identificacion,
          correo: cliente.correo,
          diasCredito: cliente.diasCredito,
          limiteCredito: cliente.limiteCredito,
          moneda: cliente.moneda,
          cuentaIngreso: cliente.cuentaIngreso,
          activo: cliente.activo,
          telefono: cliente.telefono,
          ubicacion: cliente.ubicacion,
          actividadEconomica: cliente.actividadEconomica,
          condicionVenta: cliente.condicionVenta,
          medioPago: cliente.medioPago,
        }
      : { ...NUEVO, moneda: monedaFuncional() },
  )

  // El teléfono y la ubicación se capturan sueltos y se componen al validar:
  // media dirección tecleada no es una ubicación, pero sí es lo que hay en
  // pantalla mientras se teclea.
  const [codigoPais, setCodigoPais] = useState(
    () => cliente?.telefono?.codigoPais ?? '506',
  )
  const [numeroTelefono, setNumeroTelefono] = useState(
    () => cliente?.telefono?.numero ?? '',
  )
  const [ubicacion, setUbicacion] = useState<UbicacionCaptura>(() =>
    cliente?.ubicacion
      ? {
          provincia: cliente.ubicacion.provincia,
          canton: cliente.ubicacion.canton,
          distrito: cliente.ubicacion.distrito,
          barrio: cliente.ubicacion.barrio ?? '',
          otrasSenas: cliente.ubicacion.otrasSenas,
        }
      : { ...UBICACION_VACIA },
  )
  const [intento, setIntento] = useState(false)

  const cambiar = (cambios: Partial<SolicitudCliente>) =>
    setDatos((prev) => ({ ...prev, ...cambios }))

  const cambiarUbicacion = (cambios: Partial<UbicacionCaptura>) =>
    setUbicacion((prev) => ({ ...prev, ...cambios }))

  const solicitud: SolicitudCliente = useMemo(() => {
    const hayUbicacion = Object.values(ubicacion).some((v) => v.trim() !== '')
    return {
      ...datos,
      identificacion: normalizarIdentificacion(datos.identificacion),
      nombreComercial: datos.nombreComercial || null,
      correo: datos.correo || null,
      cuentaIngreso: datos.cuentaIngreso || null,
      actividadEconomica: datos.actividadEconomica || null,
      telefono: numeroTelefono.trim()
        ? { codigoPais: codigoPais.trim(), numero: numeroTelefono.trim() }
        : null,
      ubicacion: hayUbicacion
        ? {
            provincia: ubicacion.provincia,
            canton: ubicacion.canton,
            distrito: ubicacion.distrito,
            barrio: ubicacion.barrio.trim() || null,
            otrasSenas: ubicacion.otrasSenas,
          }
        : null,
    }
  }, [datos, codigoPais, numeroTelefono, ubicacion])

  const validacion = useMemo(
    () => validarCliente(solicitud, { clientes, cliente }),
    [solicitud, clientes, cliente],
  )

  const errorIdentificacion = validarIdentificacion(
    datos.identificacion,
    datos.tipoIdentificacion,
  )

  const errorDe = (campo: keyof SolicitudCliente): string | undefined =>
    intento
      ? validacion.errores.find((e) => e.campo === campo)?.mensaje
      : undefined

  const errorServidor = guardar.error instanceof ApiError ? guardar.error : null

  const enviar = async () => {
    setIntento(true)
    if (!validacion.valido) return
    await guardar.mutateAsync({ datos: solicitud, id: cliente?.id })
    onCerrar()
  }

  const completo = listoParaFe(solicitud)

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={creando ? 'Nuevo cliente' : `Cliente ${cliente.codigo}`}
      descripcion="Las condiciones de pago y el límite de crédito rigen la facturación."
      className="w-[min(94vw,44rem)]"
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
      {creando && (
        <SelectorTercero
          rol="cliente"
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

        <Field label="Correo de cobros" error={errorDe('correo')}>
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
          label="Límite de crédito"
          ayuda="0 = sin límite"
          error={errorDe('limiteCredito')}
        >
          {(p) => (
            <MoneyInput
              {...p}
              value={datos.limiteCredito}
              moneda={datos.moneda}
              onChange={(v) => cambiar({ limiteCredito: v || '0' })}
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
          label="Cuenta de ingreso"
          ayuda="Vacío: la cuenta del mapeo del módulo"
        >
          {() => (
            <SelectorCuenta
              value={datos.cuentaIngreso ?? ''}
              onChange={(codigo) => cambiar({ cuentaIngreso: codigo })}
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
          Cliente activo
        </label>
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <p className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          Facturación electrónica
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              completo
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            {completo ? 'Datos completos' : 'Datos incompletos'}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Lo que el comprobante pide del receptor (docs/13 §4): correo,
          teléfono, ubicación y actividad económica. Se puede facturar sin
          ellos, pero no emitir el comprobante.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Teléfono" error={errorDe('telefono')}>
            {(p) => (
              <div className="flex gap-2">
                <Input
                  value={codigoPais}
                  inputMode="numeric"
                  aria-label="Código de país del teléfono"
                  className="w-16 text-center"
                  onChange={(e) => setCodigoPais(e.target.value)}
                />
                <Input
                  {...p}
                  value={numeroTelefono}
                  inputMode="numeric"
                  placeholder="22001100"
                  className="flex-1"
                  onChange={(e) => setNumeroTelefono(e.target.value)}
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
                placeholder="620100"
                onChange={(e) =>
                  cambiar({ actividadEconomica: e.target.value })
                }
              />
            )}
          </Field>

          <Field
            label="Condición de venta"
            ayuda="Vacío: se decide en cada factura"
          >
            {(p) => (
              <Select
                {...p}
                value={datos.condicionVenta ?? ''}
                onChange={(e) =>
                  cambiar({
                    condicionVenta: (e.target.value || null) as
                      | CondicionVenta
                      | null,
                  })
                }
              >
                <option value="">Sin condición habitual</option>
                {CONDICIONES_VENTA.map((c) => (
                  <option key={c.codigo} value={c.codigo}>
                    {c.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Medio de pago" ayuda="Vacío: se decide en cada factura">
            {(p) => (
              <Select
                {...p}
                value={datos.medioPago ?? ''}
                onChange={(e) =>
                  cambiar({
                    medioPago: (e.target.value || null) as MedioPago | null,
                  })
                }
              >
                <option value="">Sin medio habitual</option>
                {MEDIOS_PAGO.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <CapturaUbicacion
          valor={ubicacion}
          error={errorDe('ubicacion')}
          onCambio={cambiarUbicacion}
        />
      </div>

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

/**
 * Provincia, cantón y distrito encadenados contra el catálogo de Hacienda.
 *
 * Cambiar la provincia borra el cantón y el distrito, y cambiar el cantón
 * borra el distrito: dejar un cantón de otra provincia produce una ubicación
 * que existe en el formulario y no en el catálogo.
 *
 * Las provincias de las que todavía no está cargado el catálogo (ver
 * `shared/fiscal/ubicaciones`) se capturan a mano con los dos dígitos: es
 * preferible eso a no poder dar de alta a un cliente de Guanacaste.
 */
function CapturaUbicacion({
  valor,
  error,
  onCambio,
}: {
  valor: UbicacionCaptura
  error?: string
  onCambio: (cambios: Partial<UbicacionCaptura>) => void
}) {
  const provincia = provinciaPorCodigo(valor.provincia)
  const cantones = provincia?.cantones ?? []
  const distritos =
    cantones.find((c) => c.codigo === valor.canton)?.distritos ?? []
  const catalogoParcial = provincia !== undefined && cantones.length === 0

  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-slate-600">Ubicación</p>

      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Provincia" error={error}>
          {(p) => (
            <Select
              {...p}
              value={valor.provincia}
              onChange={(e) =>
                onCambio({
                  provincia: e.target.value,
                  canton: '',
                  distrito: '',
                })
              }
            >
              <option value="">Seleccione</option>
              {PROVINCIAS.map((x) => (
                <option key={x.codigo} value={x.codigo}>
                  {x.nombre}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Cantón"
          ayuda={catalogoParcial ? 'Dos dígitos del catálogo' : undefined}
        >
          {(p) =>
            catalogoParcial ? (
              <Input
                {...p}
                value={valor.canton}
                inputMode="numeric"
                maxLength={2}
                placeholder="01"
                onChange={(e) =>
                  onCambio({ canton: e.target.value, distrito: '' })
                }
              />
            ) : (
              <Select
                {...p}
                value={valor.canton}
                disabled={cantones.length === 0}
                onChange={(e) =>
                  onCambio({ canton: e.target.value, distrito: '' })
                }
              >
                <option value="">Seleccione</option>
                {cantones.map((c) => (
                  <option key={c.codigo} value={c.codigo}>
                    {c.nombre}
                  </option>
                ))}
              </Select>
            )
          }
        </Field>

        <Field
          label="Distrito"
          ayuda={catalogoParcial ? 'Dos dígitos del catálogo' : undefined}
        >
          {(p) =>
            catalogoParcial ? (
              <Input
                {...p}
                value={valor.distrito}
                inputMode="numeric"
                maxLength={2}
                placeholder="01"
                onChange={(e) => onCambio({ distrito: e.target.value })}
              />
            ) : (
              <Select
                {...p}
                value={valor.distrito}
                disabled={distritos.length === 0}
                onChange={(e) => onCambio({ distrito: e.target.value })}
              >
                <option value="">Seleccione</option>
                {distritos.map((d) => (
                  <option key={d.codigo} value={d.codigo}>
                    {d.nombre}
                  </option>
                ))}
              </Select>
            )
          }
        </Field>

        <Field label="Barrio">
          {(p) => (
            <Input
              {...p}
              value={valor.barrio}
              onChange={(e) => onCambio({ barrio: e.target.value })}
            />
          )}
        </Field>

        <Field
          label="Otras señas"
          className="sm:col-span-2"
          ayuda="Obligatorias si se captura la dirección"
        >
          {(p) => (
            <Input
              {...p}
              value={valor.otrasSenas}
              placeholder="200 metros norte de la iglesia"
              onChange={(e) => onCambio({ otrasSenas: e.target.value })}
            />
          )}
        </Field>
      </div>
    </div>
  )
}
