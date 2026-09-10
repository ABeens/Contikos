import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { cn } from '@/shared/ui/cn'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { AsientoPropuesto } from '@/shared/asiento/AsientoPropuesto'
import { hoyISO } from '@/shared/format/fecha'
import { monedaFuncional } from '@/shared/money/money'
import { useCuentas, usePeriodos, useTipoCambioVigente } from '@/shared/api/catalogos'
import { ApiError } from '@/shared/api/client'
import type {
  SolicitudComision,
  SolicitudInteres,
  SolicitudTraspaso,
} from '@/shared/api/contracts/bancos'
import type { SolicitudAsiento } from '@/shared/api/contracts/conta'
import {
  useCuentasBancarias,
  useMapeoBancos,
  useRegistrarMovimiento,
} from '../api/queries'
import {
  armarAsientoComision,
  armarAsientoInteres,
  armarAsientoTraspaso,
  diferenciaTraspaso,
  validarComision,
  validarInteres,
  validarTraspaso,
  type ContextoMovimiento,
} from '../domain/movimiento'

/**
 * Captura de los movimientos que nacen en tesorería (docs/06 §2.1).
 *
 * Son tres y solo tres: la comisión que cobra el banco, el interés que abona y
 * el traspaso entre cuentas propias. Todo lo demás que pasa por una cuenta
 * bancaria llega de otro módulo y ya está contabilizado; capturarlo aquí otra
 * vez duplicaría el efectivo.
 *
 * Las tres comparten pantalla y no formulario: se validan distinto y generan
 * asientos distintos, así que cada una tiene sus campos. Lo que sí comparten es
 * lo que importa: el asiento se enseña antes de confirmar, como en el resto de
 * capturas del sistema (docs/14 §5).
 */

type Clase = 'comision' | 'interes' | 'traspaso'

const CLASES: readonly { valor: Clase; etiqueta: string; ayuda: string }[] = [
  {
    valor: 'comision',
    etiqueta: 'Comisión',
    ayuda: 'Lo que cobra el banco. Sale de la cuenta contra gastos financieros.',
  },
  {
    valor: 'interes',
    etiqueta: 'Interés ganado',
    ayuda: 'Lo que abona el banco. Entra a la cuenta contra productos financieros.',
  },
  {
    valor: 'traspaso',
    etiqueta: 'Traspaso',
    ayuda: 'Entre dos cuentas propias. El dinero no entra ni sale de la empresa.',
  },
]

export function MovimientoPage() {
  const navegar = useNavigate()
  const funcional = monedaFuncional()

  const { data: cuentasBancarias = [] } = useCuentasBancarias(true)
  const { data: cuentas = [] } = useCuentas()
  const { data: periodos = [] } = usePeriodos()
  const { data: mapeo } = useMapeoBancos()
  const registrar = useRegistrarMovimiento()

  const [clase, setClase] = useState<Clase>('comision')
  const [fecha, setFecha] = useState(hoyISO)
  const [concepto, setConcepto] = useState('')
  const [referencia, setReferencia] = useState('')
  const [cuentaId, setCuentaId] = useState('')
  const [importe, setImporte] = useState('')
  const [impuesto, setImpuesto] = useState('')
  const [tipoCambio, setTipoCambio] = useState('1')
  const [cuentaDestinoId, setCuentaDestinoId] = useState('')
  const [importeDestino, setImporteDestino] = useState('')
  const [tipoCambioDestino, setTipoCambioDestino] = useState('1')
  const [intento, setIntento] = useState(false)

  const cuenta = cuentasBancarias.find((c) => c.id === cuentaId)
  const destino = cuentasBancarias.find((c) => c.id === cuentaDestinoId)

  /**
   * El tipo de cambio del DÍA DEL MOVIMIENTO, no el de hoy (docs/13 §7).
   *
   * Se propone el de compra porque un saldo bancario es un activo, que es como
   * se valúan los activos en moneda extranjera. Se propone; no se impone: lo
   * que se contabiliza es lo que quede en el campo, que es lo que el banco
   * aplicó de verdad ese día.
   */
  const vigenteOrigen = useTipoCambioVigente(cuenta?.moneda, fecha)
  const vigenteDestino = useTipoCambioVigente(destino?.moneda, fecha)

  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? codigo

  const contexto: ContextoMovimiento | null = useMemo(
    () =>
      mapeo
        ? {
            cuentasBancarias,
            cuentas,
            periodos,
            mapeo,
            monedaFuncional: funcional,
          }
        : null,
    [cuentasBancarias, cuentas, periodos, mapeo, funcional],
  )

  const comision: SolicitudComision = {
    cuentaBancariaId: cuentaId,
    fecha,
    concepto,
    referencia: referencia.trim() || null,
    importe: importe || '0',
    impuesto: impuesto || '0',
    tipoCambio: tipoCambio || '0',
  }

  const interes: SolicitudInteres = {
    cuentaBancariaId: cuentaId,
    fecha,
    concepto,
    referencia: referencia.trim() || null,
    importe: importe || '0',
    tipoCambio: tipoCambio || '0',
  }

  const traspaso: SolicitudTraspaso = {
    cuentaOrigenId: cuentaId,
    cuentaDestinoId,
    fecha,
    concepto,
    referencia: referencia.trim() || null,
    importeOrigen: importe || '0',
    importeDestino: importeDestino || '0',
    tipoCambioOrigen: tipoCambio || '0',
    tipoCambioDestino: tipoCambioDestino || '0',
  }

  const validacion = !contexto
    ? { valido: false, errores: [] }
    : clase === 'comision'
      ? validarComision(comision, contexto)
      : clase === 'interes'
        ? validarInteres(interes, contexto)
        : validarTraspaso(traspaso, contexto)

  /**
   * El asiento que se emitiría, con el mismo código que lo emitirá.
   *
   * Se arma solo cuando la captura es válida: enseñar un asiento construido
   * sobre datos que el servidor va a rechazar enseña un asiento que nunca va a
   * existir. El identificador es un marcador porque el definitivo lo asigna el
   * servidor al registrar.
   *
   * Sin memorizar: depende de cada tecla del formulario, así que la memoria se
   * invalidaría en todos los renders y solo añadiría el coste de mantenerla.
   * Armar el asiento son unas pocas restas sobre tres o cuatro líneas.
   */
  const asiento: SolicitudAsiento | null = (() => {
    if (!contexto || !validacion.valido) return null
    if (clase === 'comision' && cuenta) {
      return armarAsientoComision('mov-nuevo', comision, cuenta, contexto)
    }
    if (clase === 'interes' && cuenta) {
      return armarAsientoInteres('mov-nuevo', interes, cuenta, contexto)
    }
    if (clase === 'traspaso' && cuenta && destino) {
      return armarAsientoTraspaso(
        'tra-nuevo',
        traspaso,
        cuenta,
        destino,
        contexto,
      )
    }
    return null
  })()

  const mutacion =
    clase === 'comision'
      ? registrar.comision
      : clase === 'interes'
        ? registrar.interes
        : registrar.traspaso
  const errorServidor = mutacion.error instanceof ApiError ? mutacion.error : null

  const enviar = async () => {
    setIntento(true)
    if (!validacion.valido) return
    if (clase === 'comision') await registrar.comision.mutateAsync(comision)
    else if (clase === 'interes') await registrar.interes.mutateAsync(interes)
    else await registrar.traspaso.mutateAsync(traspaso)
    navegar(`/bancos/movimientos?cuenta=${cuentaId}`)
  }

  const elegirClase = (nueva: Clase) => {
    setClase(nueva)
    setIntento(false)
  }

  const elegirCuenta = (id: string) => {
    setCuentaId(id)
    const elegida = cuentasBancarias.find((c) => c.id === id)
    // En la funcional el único tipo de cambio posible es 1, y el dominio lo
    // exige: se pone solo para que nadie tenga que teclearlo.
    setTipoCambio(
      elegida && elegida.moneda !== funcional
        ? (vigenteOrigen.data?.compra ?? '')
        : '1',
    )
  }

  const elegirDestino = (id: string) => {
    setCuentaDestinoId(id)
    const elegida = cuentasBancarias.find((c) => c.id === id)
    setTipoCambioDestino(
      elegida && elegida.moneda !== funcional
        ? (vigenteDestino.data?.compra ?? '')
        : '1',
    )
  }

  const diferencia =
    clase === 'traspaso' && cuenta && destino
      ? diferenciaTraspaso(traspaso, funcional)
      : null

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        titulo="Registrar movimiento bancario"
        descripcion="Las tres cosas que nacen en tesorería. Los cobros y los pagos llegan solos desde CxC y CxP."
      />

      <Card className="mb-4">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 px-4 py-3">
          {CLASES.map((c) => (
            <button
              key={c.valor}
              type="button"
              onClick={() => elegirClase(c.valor)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                clase === c.valor
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {c.etiqueta}
            </button>
          ))}
          <p className="w-full text-xs text-slate-500">
            {CLASES.find((c) => c.valor === clase)?.ayuda}
          </p>
        </div>

        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label={clase === 'traspaso' ? 'Cuenta de origen' : 'Cuenta bancaria'}
            requerido
          >
            {(p) => (
              <Select
                {...p}
                value={cuentaId}
                onChange={(e) => elegirCuenta(e.target.value)}
              >
                <option value="">Seleccione…</option>
                {cuentasBancarias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} · {c.nombre} ({c.moneda})
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {clase === 'traspaso' && (
            <Field label="Cuenta de destino" requerido>
              {(p) => (
                <Select
                  {...p}
                  value={cuentaDestinoId}
                  onChange={(e) => elegirDestino(e.target.value)}
                >
                  <option value="">Seleccione…</option>
                  {cuentasBancarias
                    .filter((c) => c.id !== cuentaId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} · {c.nombre} ({c.moneda})
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          )}

          <Field label="Fecha" requerido>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            )}
          </Field>

          <Field label="Referencia" ayuda="Documento del banco">
            {(p) => (
              <Input
                {...p}
                value={referencia}
                placeholder="TRF-889210"
                onChange={(e) => setReferencia(e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Concepto"
            requerido
            className={clase === 'traspaso' ? 'lg:col-span-4' : 'lg:col-span-2'}
          >
            {(p) => (
              <Input
                {...p}
                value={concepto}
                placeholder={
                  clase === 'comision'
                    ? 'Comisión por manejo de cuenta'
                    : clase === 'interes'
                      ? 'Intereses sobre saldo promedio'
                      : 'Fondeo de la cuenta en dólares'
                }
                onChange={(e) => setConcepto(e.target.value)}
              />
            )}
          </Field>

          <Field
            label={
              clase === 'traspaso'
                ? `Sale de ${cuenta?.codigo ?? 'la cuenta'}`
                : 'Importe'
            }
            requerido
            ayuda={cuenta ? `En ${cuenta.moneda}` : undefined}
          >
            {(p) => (
              <MoneyInput
                {...p}
                value={importe}
                onChange={setImporte}
                moneda={cuenta?.moneda ?? funcional}
              />
            )}
          </Field>

          {clase === 'comision' && (
            <Field label="Impuesto acreditable" ayuda="Cero si no lo lleva">
              {(p) => (
                <MoneyInput
                  {...p}
                  value={impuesto}
                  onChange={setImpuesto}
                  moneda={cuenta?.moneda ?? funcional}
                />
              )}
            </Field>
          )}

          {clase === 'traspaso' && (
            <Field
              label={`Entra en ${destino?.codigo ?? 'la cuenta'}`}
              requerido
              ayuda={destino ? `En ${destino.moneda}` : undefined}
            >
              {(p) => (
                <MoneyInput
                  {...p}
                  value={importeDestino}
                  onChange={setImporteDestino}
                  moneda={destino?.moneda ?? funcional}
                />
              )}
            </Field>
          )}

          {cuenta && cuenta.moneda !== funcional && (
            <Field
              label={`Tipo de cambio ${cuenta.moneda}`}
              requerido
              ayuda="El del día del movimiento"
            >
              {(p) => (
                <Input
                  {...p}
                  value={tipoCambio}
                  onChange={(e) => setTipoCambio(e.target.value)}
                />
              )}
            </Field>
          )}

          {clase === 'traspaso' && destino && destino.moneda !== funcional && (
            <Field
              label={`Tipo de cambio ${destino.moneda}`}
              requerido
              ayuda="El del día del movimiento"
            >
              {(p) => (
                <Input
                  {...p}
                  value={tipoCambioDestino}
                  onChange={(e) => setTipoCambioDestino(e.target.value)}
                />
              )}
            </Field>
          )}
        </div>

        {diferencia && !diferencia.esCero() && (
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
            Diferencia cambiaria del traspaso:{' '}
            <MoneyCell valor={diferencia} moneda={funcional} mostrarSimbolo />
            <span className="ml-1 text-xs text-slate-500">
              {diferencia.esPositivo()
                ? '· entra más de lo que sale, es una ganancia realizada'
                : '· entra menos de lo que sale, es una pérdida realizada'}
            </span>
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <CardHeader
          titulo="Asiento que se generará"
          descripcion={`Expresado en ${funcional}, que es la moneda del mayor.`}
        />
        {asiento ? (
          <AsientoPropuesto asiento={asiento} nombreCuenta={nombreCuenta} />
        ) : (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Complete la captura para ver el asiento.
          </p>
        )}
      </Card>

      {(intento && !validacion.valido) || errorServidor ? (
        <div className="mb-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor
              ? `${errorServidor.codigo}: ${errorServidor.message}`
              : 'El movimiento no se puede registrar'}
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

      <div className="flex justify-end gap-2">
        <Button onClick={() => navegar('/bancos/movimientos')}>Cancelar</Button>
        <Button
          variante="primario"
          onClick={() => void enviar()}
          disabled={mutacion.isPending}
        >
          {mutacion.isPending ? 'Registrando…' : 'Registrar y contabilizar'}
        </Button>
      </div>
    </div>
  )
}
