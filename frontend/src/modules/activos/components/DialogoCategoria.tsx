import { useState } from 'react'
import { CircleAlert, Lock } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input, Select } from '@/shared/ui/Field'
import { SelectorCuenta } from '@/shared/ui/SelectorCuenta'
import { ApiError } from '@/shared/api/client'
import type { Cuenta } from '@/shared/api/contracts/conta'
import type {
  CategoriaActivo,
  MetodoDepreciacion,
  SolicitudCategoriaActivo,
} from '@/shared/api/contracts/activos'
import { useGuardarCategoria } from '../api/queries'
import { validarCategoria } from '../domain/activo'

/**
 * Alta y edición de la categoría de activo (docs/07 §1 y §6).
 *
 * Las tres cuentas son el contrato de la categoría con el mayor, y por eso el
 * diálogo las trata distinto del resto: mientras la categoría no tenga
 * inventario se pueden corregir, y en cuanto lo tenga quedan fijas. Cambiarlas
 * con activos vivos dejaría el costo en una cuenta y las fichas apuntando a
 * otra, que es la conciliación de docs/07 §4 rota sin que nadie lo vea.
 */

const NUEVA: SolicitudCategoriaActivo = {
  nombre: '',
  vidaUtilMeses: 60,
  metodo: 'linea_recta',
  porcentajeResidual: '0',
  cuentaActivo: '',
  cuentaDepreciacionAcumulada: '',
  cuentaGastoDepreciacion: '',
  tasaFiscalAnual: null,
  activa: true,
}

export interface DialogoCategoriaProps {
  abierto: boolean
  onCerrar: () => void
  /** Sin categoría, el diálogo da de alta una nueva. */
  categoria?: CategoriaActivo
  categorias: readonly CategoriaActivo[]
  cuentas: readonly Cuenta[]
}

export function DialogoCategoria({
  abierto,
  onCerrar,
  categoria,
  categorias,
  cuentas,
}: DialogoCategoriaProps) {
  const creando = categoria === undefined
  const guardar = useGuardarCategoria()

  const [datos, setDatos] = useState<SolicitudCategoriaActivo>(() =>
    categoria
      ? {
          nombre: categoria.nombre,
          vidaUtilMeses: categoria.vidaUtilMeses,
          metodo: categoria.metodo,
          porcentajeResidual: categoria.porcentajeResidual,
          cuentaActivo: categoria.cuentaActivo,
          cuentaDepreciacionAcumulada: categoria.cuentaDepreciacionAcumulada,
          cuentaGastoDepreciacion: categoria.cuentaGastoDepreciacion,
          tasaFiscalAnual: categoria.tasaFiscalAnual,
          activa: categoria.activa,
        }
      : NUEVA,
  )
  const [intento, setIntento] = useState(false)

  const cambiar = (cambios: Partial<SolicitudCategoriaActivo>) =>
    setDatos((prev) => ({ ...prev, ...cambios }))

  // El mapeo de una categoría con inventario ya está escrito en el mayor.
  const mapeoFijo = Boolean(categoria && categoria.activos > 0)

  const validacion = validarCategoria(datos, { cuentas, categorias, categoria })
  const errorServidor = guardar.error instanceof ApiError ? guardar.error : null

  const enviar = async () => {
    setIntento(true)
    if (!validacion.valido) return
    await guardar.mutateAsync({ datos, id: categoria?.id })
    onCerrar()
  }

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={creando ? 'Nueva categoría de activo' : categoria.nombre}
      descripcion="Vida útil, método y las tres cuentas que mueve el ciclo de vida del activo."
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nombre" requerido className="sm:col-span-2">
          {(p) => (
            <Input
              {...p}
              value={datos.nombre}
              placeholder="Equipo de cómputo"
              onChange={(e) => cambiar({ nombre: e.target.value })}
            />
          )}
        </Field>

        <Field
          label="Vida útil (meses)"
          requerido
          ayuda="La heredan los activos de la categoría"
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              value={datos.vidaUtilMeses}
              className="tabular text-right"
              onChange={(e) =>
                cambiar({ vidaUtilMeses: Math.trunc(Number(e.target.value)) })
              }
            />
          )}
        </Field>

        <Field label="Método de depreciación" requerido>
          {(p) => (
            <Select
              {...p}
              value={datos.metodo}
              onChange={(e) =>
                cambiar({ metodo: e.target.value as MetodoDepreciacion })
              }
            >
              <option value="linea_recta">Línea recta</option>
              <option value="saldos_decrecientes">Saldos decrecientes</option>
            </Select>
          )}
        </Field>

        <Field
          label="Porcentaje residual"
          ayuda="Parte del costo que no se deprecia"
        >
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              value={datos.porcentajeResidual}
              className="tabular text-right"
              onChange={(e) =>
                cambiar({ porcentajeResidual: e.target.value || '0' })
              }
            />
          )}
        </Field>

        <Field
          label="Tasa fiscal anual"
          ayuda="Vacía: la cédula fiscal sigue a la contable"
        >
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              value={datos.tasaFiscalAnual ?? ''}
              placeholder="Sin diferencia"
              className="tabular text-right"
              onChange={(e) =>
                cambiar({ tasaFiscalAnual: e.target.value || null })
              }
            />
          )}
        </Field>
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <p className="text-xs font-semibold text-slate-700">
          Mapeo contable de la categoría
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Se resuelve por categoría y nunca por activo: es lo que evita que dos
          equipos iguales terminen en cuentas distintas.
        </p>

        {mapeoFijo && categoria && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800 ring-1 ring-amber-200 ring-inset">
            <Lock className="mt-px size-3.5 shrink-0" />
            La categoría ya tiene {categoria.activos} activo
            {categoria.activos === 1 ? '' : 's'} y sus asientos en el mayor.
            Cambiar ahora las cuentas dejaría el costo en una y las fichas en
            otra.
          </p>
        )}

        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Activo" requerido ayuda="Recibe el costo">
            {() => (
              <SelectorCuenta
                value={datos.cuentaActivo}
                onChange={(codigo) => cambiar({ cuentaActivo: codigo })}
                cuentas={cuentas}
                etiqueta="Cuenta de activo"
                disabled={mapeoFijo}
              />
            )}
          </Field>

          <Field
            label="Depreciación acumulada"
            requerido
            ayuda="Abate el costo"
          >
            {() => (
              <SelectorCuenta
                value={datos.cuentaDepreciacionAcumulada}
                onChange={(codigo) =>
                  cambiar({ cuentaDepreciacionAcumulada: codigo })
                }
                cuentas={cuentas}
                etiqueta="Cuenta de depreciación acumulada"
                disabled={mapeoFijo}
              />
            )}
          </Field>

          <Field
            label="Gasto por depreciación"
            requerido
            ayuda="Cuota del periodo"
          >
            {() => (
              <SelectorCuenta
                value={datos.cuentaGastoDepreciacion}
                onChange={(codigo) =>
                  cambiar({ cuentaGastoDepreciacion: codigo })
                }
                cuentas={cuentas}
                etiqueta="Cuenta de gasto por depreciación"
                excluirControl
                disabled={mapeoFijo}
              />
            )}
          </Field>
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={datos.activa}
          onChange={(e) => cambiar({ activa: e.target.checked })}
          className="size-3.5 rounded border-slate-300 accent-brand-600"
        />
        Categoría activa
        <span className="text-xs text-slate-400">
          Inactiva deja de admitir altas; los activos que ya tiene siguen
          depreciándose
        </span>
      </label>

      {(intento && !validacion.valido) || errorServidor ? (
        <div className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor ? errorServidor.message : 'Revise los datos'}
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {(errorServidor?.detalles.length
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
