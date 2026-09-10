import { useState } from 'react'
import { CircleAlert, Lock } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input, Select } from '@/shared/ui/Field'
import { SelectorCuenta } from '@/shared/ui/SelectorCuenta'
import { ApiError } from '@/shared/api/client'
import { monedasActivas } from '@/shared/money/money'
import { esCuentaDeBanco } from '@/shared/cuentas/cuenta'
import type { Cuenta } from '@/shared/api/contracts/conta'
import type {
  CuentaBancaria,
  SolicitudCuentaBancaria,
  TipoCuentaBancaria,
} from '@/shared/api/contracts/bancos'
import { useGuardarCuentaBancaria } from '../api/queries'
import {
  TIPOS_CUENTA_BANCARIA,
  validarCuentaBancaria,
} from '../domain/cuentaBancaria'

/**
 * Alta y edición de una cuenta bancaria (docs/06 §1).
 *
 * El campo que decide todo lo demás es la cuenta de control: es lo que enlaza
 * esta ficha con el mayor, y la correspondencia es uno a uno. Mientras la
 * cuenta no tenga movimientos se puede corregir; en cuanto los tenga queda
 * fija, igual que el mapeo de una categoría de activo con inventario
 * (docs/07 §6). Cambiarla después dejaría los movimientos viejos apuntando a
 * una cuenta del libro y los nuevos a otra.
 */

const NUEVA: SolicitudCuentaBancaria = {
  banco: '',
  nombre: '',
  numeroCuenta: '',
  iban: null,
  tipo: 'cheques',
  moneda: '',
  cuentaContable: '',
  activa: true,
}

export interface DialogoCuentaBancariaProps {
  abierto: boolean
  onCerrar: () => void
  /** Sin cuenta, el diálogo da de alta una nueva. */
  cuenta?: CuentaBancaria
  cuentasBancarias: readonly CuentaBancaria[]
  cuentas: readonly Cuenta[]
}

export function DialogoCuentaBancaria({
  abierto,
  onCerrar,
  cuenta,
  cuentasBancarias,
  cuentas,
}: DialogoCuentaBancariaProps) {
  const creando = cuenta === undefined
  const guardar = useGuardarCuentaBancaria()
  const monedas = monedasActivas()

  const [datos, setDatos] = useState<SolicitudCuentaBancaria>(() =>
    cuenta
      ? {
          banco: cuenta.banco,
          nombre: cuenta.nombre,
          numeroCuenta: cuenta.numeroCuenta,
          iban: cuenta.iban,
          tipo: cuenta.tipo,
          moneda: cuenta.moneda,
          cuentaContable: cuenta.cuentaContable,
          activa: cuenta.activa,
        }
      : { ...NUEVA, moneda: monedas[0]?.codigo ?? '' },
  )
  const [intento, setIntento] = useState(false)

  const cambiar = (cambios: Partial<SolicitudCuentaBancaria>) =>
    setDatos((prev) => ({ ...prev, ...cambios }))

  /**
   * Una cuenta con movimientos ya está escrita en el mayor con esa cuenta de
   * control y esa moneda. El diálogo las bloquea en vez de dejar que el
   * servidor las rechace: el usuario tiene que ver POR QUÉ no se pueden tocar.
   */
  const mapeoFijo = Boolean(cuenta && cuenta.movimientos > 0)

  // Solo las cuentas que el catálogo declara bancarias, y sin las que ya son de
  // otra ficha: el selector no ofrece lo que la validación va a rechazar.
  const disponibles = cuentas.filter(
    (c) =>
      esCuentaDeBanco(c) &&
      (c.codigo === cuenta?.cuentaContable ||
        !cuentasBancarias.some((b) => b.cuentaContable === c.codigo)),
  )

  const validacion = validarCuentaBancaria(
    datos,
    {
      cuentas,
      cuentasBancarias,
      // El diálogo no conoce los movimientos y no le hace falta: lo que valida
      // aquí es la forma. Las reglas que dependen del historial (congelar el
      // mapeo, no desactivar con saldo) las aplica el servidor, que sí lo tiene.
      movimientos: [],
    },
    cuenta?.id,
  )
  const errorServidor = guardar.error instanceof ApiError ? guardar.error : null

  const enviar = async () => {
    setIntento(true)
    if (!validacion.valido) return
    await guardar.mutateAsync({ datos, id: cuenta?.id })
    onCerrar()
  }

  const errorDe = (codigo: string) =>
    intento
      ? validacion.errores.find((e) => e.codigo === codigo)?.mensaje
      : undefined

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={creando ? 'Nueva cuenta bancaria' : `${cuenta.codigo} · ${cuenta.nombre}`}
      descripcion="Dónde está el dinero y con qué cuenta del mayor se corresponde."
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
        <Field label="Banco" requerido error={errorDe('BANCO_REQUERIDO')}>
          {(p) => (
            <Input
              {...p}
              value={datos.banco}
              placeholder="Banco Nacional de Costa Rica"
              onChange={(e) => cambiar({ banco: e.target.value })}
            />
          )}
        </Field>

        <Field
          label="Nombre"
          requerido
          ayuda="Como la conoce la empresa"
          error={errorDe('NOMBRE_REQUERIDO')}
        >
          {(p) => (
            <Input
              {...p}
              value={datos.nombre}
              placeholder="BN — corriente colones"
              onChange={(e) => cambiar({ nombre: e.target.value })}
            />
          )}
        </Field>

        <Field
          label="Número de cuenta"
          requerido
          error={errorDe('NUMERO_REQUERIDO')}
        >
          {(p) => (
            <Input
              {...p}
              value={datos.numeroCuenta}
              placeholder="100-01-000-123456-7"
              onChange={(e) => cambiar({ numeroCuenta: e.target.value })}
            />
          )}
        </Field>

        <Field
          label="IBAN"
          ayuda="CR y veinte dígitos"
          error={errorDe('IBAN_INVALIDO')}
        >
          {(p) => (
            <Input
              {...p}
              value={datos.iban ?? ''}
              placeholder="CR05015100010012345678"
              onChange={(e) => cambiar({ iban: e.target.value })}
            />
          )}
        </Field>

        <Field label="Tipo" requerido>
          {(p) => (
            <Select
              {...p}
              value={datos.tipo}
              onChange={(e) =>
                cambiar({ tipo: e.target.value as TipoCuentaBancaria })
              }
            >
              {TIPOS_CUENTA_BANCARIA.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.etiqueta}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Moneda"
          requerido
          ayuda={
            mapeoFijo
              ? 'Fija: la cuenta ya tiene movimientos'
              : 'La del saldo que lleva el banco'
          }
          error={errorDe('MONEDA_DISCREPANTE')}
        >
          {(p) => (
            <Select
              {...p}
              value={datos.moneda}
              disabled={mapeoFijo}
              onChange={(e) => cambiar({ moneda: e.target.value })}
            >
              {monedas.map((m) => (
                <option key={m.codigo} value={m.codigo}>
                  {m.codigo} · {m.nombre}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Cuenta de control"
          requerido
          className="sm:col-span-2"
          ayuda={
            mapeoFijo
              ? 'Fija: la cuenta ya tiene movimientos en el mayor'
              : 'La cuenta del mayor donde vive este saldo. Una por cuenta bancaria.'
          }
          error={
            errorDe('CUENTA_CONTABLE_INVALIDA') ??
            errorDe('CUENTA_CONTABLE_NO_BANCARIA') ??
            errorDe('CUENTA_CONTABLE_DUPLICADA')
          }
        >
          {() => (
            <SelectorCuenta
              value={datos.cuentaContable}
              onChange={(codigo) => cambiar({ cuentaContable: codigo })}
              cuentas={disponibles}
              etiqueta="Cuenta de control"
              disabled={mapeoFijo}
            />
          )}
        </Field>

        {disponibles.length === 0 && !mapeoFijo && (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2.5 text-xs text-amber-800 ring-1 ring-amber-200 ring-inset sm:col-span-2">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            No queda ninguna cuenta del catálogo libre para enlazar. Cree en el
            catálogo de cuentas una cuenta de detalle con auxiliar bancario
            antes de dar de alta esta.
          </p>
        )}

        {mapeoFijo && (
          <p className="flex items-start gap-1.5 rounded-md bg-slate-50 p-2.5 text-xs text-slate-600 sm:col-span-2">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            La cuenta tiene movimientos: su cuenta de control y su moneda ya
            explican asientos que están en el mayor y no se pueden cambiar. Lo
            demás sí.
          </p>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input
            type="checkbox"
            checked={datos.activa}
            onChange={(e) => cambiar({ activa: e.target.checked })}
            className="size-4 rounded border-slate-300"
          />
          Activa: se ofrece al capturar cobros, pagos y movimientos
        </label>

        {errorServidor && (
          <div className="rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset sm:col-span-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
              <CircleAlert className="size-4" />
              {errorServidor.codigo}: {errorServidor.message}
            </p>
            <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
              {errorServidor.detalles.map((mensaje, i) => (
                <li key={i}>{mensaje}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialogo>
  )
}
