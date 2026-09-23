import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input, Select } from '@/shared/ui/Field'
import { MensajeError } from '@/shared/ui/MensajeError'
import { SelectorCuenta } from '@/shared/ui/SelectorCuenta'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { monedaFuncional, monedasActivas } from '@/shared/money/money'
import { type IdTarifaIva } from '@/shared/fiscal/iva'
import { opcionesTarifa } from '@/shared/fiscal/impuestos'
import { hoyISO } from '@/shared/format/fecha'
import { useTarifasImpuesto } from '@/shared/api/catalogos'
import type { Cuenta } from '@/shared/api/contracts/conta'
import type {
  ItemCatalogo,
  SolicitudItemCatalogo,
  TipoItem,
} from '@/shared/api/contracts/cxc'
import { useGuardarItem } from '../api/queries'
import { validarItem, type CodigoErrorItem } from '../domain/item'

/**
 * Alta y edición de un producto o servicio (docs/04 §1.1).
 *
 * La cuenta y la tarifa son el contenido del catálogo, no un adorno: se
 * deciden aquí, una vez, para que no haya que decidirlas en cada factura. Se
 * pueden cambiar siempre, porque cambiarlas no toca ninguna factura ya
 * emitida: lo que se declaró quedó copiado en su línea.
 */

const NUEVO: SolicitudItemCatalogo = {
  codigo: '',
  nombre: '',
  descripcion: null,
  tipo: 'servicio',
  precioUnitario: '0',
  moneda: 'CRC',
  tarifa: 'GENERAL',
  cuentaIngreso: '',
  activo: true,
}

export interface DialogoItemProps {
  abierto: boolean
  onCerrar: () => void
  /** Sin item, el diálogo da de alta uno nuevo. */
  item?: ItemCatalogo
  items: readonly ItemCatalogo[]
  cuentas: readonly Cuenta[]
}

export function DialogoItem({
  abierto,
  onCerrar,
  item,
  items,
  cuentas,
}: DialogoItemProps) {
  const creando = item === undefined
  const guardar = useGuardarItem()

  // El item no tiene fecha: la tarifa que se le asigna es para las ventas que
  // vengan, así que se ofrecen las que rigen hoy. La factura volverá a
  // resolverla por su propia fecha de emisión.
  const { data: tarifas = [] } = useTarifasImpuesto(hoyISO())
  const opciones = opcionesTarifa(tarifas)

  const [datos, setDatos] = useState<SolicitudItemCatalogo>(() =>
    item
      ? {
          codigo: item.codigo,
          nombre: item.nombre,
          descripcion: item.descripcion,
          tipo: item.tipo,
          precioUnitario: item.precioUnitario,
          moneda: item.moneda,
          tarifa: item.tarifa,
          cuentaIngreso: item.cuentaIngreso,
          activo: item.activo,
        }
      : { ...NUEVO, moneda: monedaFuncional() },
  )
  const [intento, setIntento] = useState(false)

  const cambiar = (cambios: Partial<SolicitudItemCatalogo>) => {
    setDatos((prev) => ({ ...prev, ...cambios }))
    // El rechazo del servidor era de los datos de antes: al corregir, estorba.
    if (guardar.isError) guardar.reset()
  }

  const validacion = validarItem(datos, { cuentas, items, item })

  /** El error local de un campo, junto al campo y no en una lista aparte. */
  const errorDe = (...codigos: CodigoErrorItem[]) =>
    intento
      ? validacion.errores.find((e) => codigos.includes(e.codigo))?.mensaje
      : undefined

  // Primero lo local: un rechazo del servidor no tapa lo que falta capturar.
  const errorServidor =
    intento && !validacion.valido ? null : guardar.error

  const enviar = () => {
    setIntento(true)
    if (!validacion.valido) return
    // El rechazo se enseña desde `guardar.error`; aquí solo se evita dejar la
    // promesa suelta y cerrar sobre un item que no se guardó.
    guardar.mutateAsync({ datos, id: item?.id }).then(onCerrar, () => undefined)
  }

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={creando ? 'Nuevo producto o servicio' : item.nombre}
      descripcion="Lo que se precarga al facturar: precio, tarifa de IVA y cuenta de ingreso."
      className="w-[min(94vw,42rem)]"
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Código"
          requerido
          ayuda="Es lo que se teclea al facturar"
          error={errorDe('CODIGO_REQUERIDO', 'CODIGO_DUPLICADO')}
        >
          {(p) => (
            <Input
              {...p}
              value={datos.codigo}
              placeholder="SRV-001"
              className="font-mono"
              onChange={(e) => cambiar({ codigo: e.target.value })}
            />
          )}
        </Field>

        <Field label="Tipo" requerido>
          {(p) => (
            <Select
              {...p}
              value={datos.tipo}
              onChange={(e) => cambiar({ tipo: e.target.value as TipoItem })}
            >
              <option value="servicio">Servicio</option>
              <option value="producto">Producto</option>
            </Select>
          )}
        </Field>

        <Field
          label="Nombre"
          requerido
          className="sm:col-span-2"
          error={errorDe('NOMBRE_REQUERIDO')}
        >
          {(p) => (
            <Input
              {...p}
              value={datos.nombre}
              placeholder="Consultoría en tecnología (hora)"
              onChange={(e) => cambiar({ nombre: e.target.value })}
            />
          )}
        </Field>

        <Field
          label="Descripción para la factura"
          className="sm:col-span-2"
          ayuda="Vacía: se copia el nombre"
        >
          {(p) => (
            <Input
              {...p}
              value={datos.descripcion ?? ''}
              placeholder="Texto que aparecerá en la línea"
              onChange={(e) => cambiar({ descripcion: e.target.value || null })}
            />
          )}
        </Field>

        <Field
          label="Precio de lista"
          ayuda="Cero: precio a convenir"
          error={errorDe('PRECIO_INVALIDO')}
        >
          {(p) => (
            <MoneyInput
              {...p}
              value={datos.precioUnitario}
              moneda={datos.moneda}
              onChange={(v) => cambiar({ precioUnitario: v || '0' })}
            />
          )}
        </Field>

        <Field
          label="Moneda del precio"
          requerido
          ayuda="Solo se precarga en facturas de esta moneda"
          error={errorDe('MONEDA_INVALIDA')}
        >
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
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <p className="text-xs font-semibold text-slate-700">
          Tratamiento contable y fiscal
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Se copian a la línea al elegir el item y siguen siendo editables ahí:
          la venta que se sale de lo habitual no obliga a crear otro item.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Tarifa de IVA"
            requerido
            error={errorDe('TARIFA_INVALIDA')}
          >
            {(p) => (
              <Select
                {...p}
                value={datos.tarifa}
                onChange={(e) =>
                  cambiar({ tarifa: e.target.value as IdTarifaIva })
                }
              >
                {opciones.map((t) => (
                  <option key={t.codigo} value={t.codigo}>
                    {t.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Cuenta de ingreso"
            requerido
            ayuda="De detalle, activa y de tipo ingreso"
            error={errorDe('CUENTA_INVALIDA')}
          >
            {(p) => (
              <SelectorCuenta
                value={datos.cuentaIngreso}
                onChange={(codigo) => cambiar({ cuentaIngreso: codigo })}
                cuentas={cuentas}
                etiqueta="Cuenta de ingreso del item"
                error={p['aria-invalid']}
              />
            )}
          </Field>
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={datos.activo}
          onChange={(e) => cambiar({ activo: e.target.checked })}
          className="size-3.5 rounded border-slate-300 accent-brand-600"
        />
        Item activo
        <span className="text-xs text-slate-400">
          Inactivo deja de ofrecerse al facturar; las facturas que lo citan no
          cambian
        </span>
      </label>

      <MensajeError error={errorServidor} className="mt-4" />
    </Dialogo>
  )
}
