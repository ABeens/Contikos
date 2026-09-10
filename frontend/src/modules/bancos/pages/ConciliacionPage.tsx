import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  CircleAlert,
  CircleCheck,
  Link2,
  Link2Off,
  TriangleAlert,
  Wand2,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { cn } from '@/shared/ui/cn'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { ApiError } from '@/shared/api/client'
import type {
  MovimientoBancario,
  MovimientoEstadoCuenta,
  PartidaConciliatoria,
  SugerenciaEmparejamiento,
} from '@/shared/api/contracts/bancos'
import { importeBanco } from '../domain/conciliacion'
import { etiquetaTipoMovimiento } from '../domain/movimiento'
import {
  useConciliacion,
  useConciliaciones,
  useConciliar,
  useCuentasBancarias,
  useEstadoCuenta,
} from '../api/queries'

/**
 * Conciliación bancaria (docs/06 §2.3).
 *
 * Es el flujo más valioso del módulo y la pantalla enseña sus dos mitades una
 * al lado de la otra: lo que la empresa registró y lo que el banco dice. Que
 * estén separadas no es una decisión visual, es el diseño del módulo: la
 * conciliación existe para explicar en qué se diferencian, y una tabla única
 * borraría justamente esa diferencia.
 *
 * La ecuación que tiene que cerrar está a la vista todo el rato, porque es la
 * única forma de que quien concilia entienda por qué todavía no puede cerrar.
 */
export function ConciliacionPage() {
  const [parametros, setParametros] = useSearchParams()
  const { data: cuentas = [] } = useCuentasBancarias(true)
  const { emparejar, deshacer, cerrar } = useConciliar()

  const cuentaId = parametros.get('cuenta') ?? cuentas[0]?.id ?? ''
  const cuenta = cuentas.find((c) => c.id === cuentaId)

  const [fechaCorte, setFechaCorte] = useState(hoyISO)
  const [saldoCapturado, setSaldoCapturado] = useState('')
  const [propiosElegidos, setPropiosElegidos] = useState<string[]>([])
  const [bancoElegido, setBancoElegido] = useState<string | null>(null)

  const { data: resumen, isLoading } = useConciliacion(
    cuentaId || undefined,
    fechaCorte,
    saldoCapturado.trim() === '' ? undefined : saldoCapturado,
  )
  const { data: cerradas = [] } = useConciliaciones(cuentaId || undefined)
  const { data: lineasBanco = [] } = useEstadoCuenta(cuentaId || undefined)

  /**
   * Emparejamientos provisionales: los que se pueden deshacer.
   *
   * Se reconocen por su marca, que es provisional mientras la conciliación no
   * se cierra. Lo que ya entró en una conciliación cerrada lleva el id de esa
   * conciliación y no se deshace: es una foto que alguien firmó (docs/06 §2.3).
   */
  const emparejados = lineasBanco.filter((l) =>
    l.conciliacionId?.startsWith('emp-'),
  )

  const moneda = cuenta?.moneda ?? 'CRC'
  const errorServidor =
    emparejar.error instanceof ApiError
      ? emparejar.error
      : cerrar.error instanceof ApiError
        ? cerrar.error
        : null

  const limpiarSeleccion = () => {
    setPropiosElegidos([])
    setBancoElegido(null)
  }

  const alternarPropio = (id: string) =>
    setPropiosElegidos((previos) =>
      previos.includes(id)
        ? previos.filter((x) => x !== id)
        : [...previos, id],
    )

  const casarSeleccion = async () => {
    if (!bancoElegido || propiosElegidos.length === 0) return
    await emparejar.mutateAsync({
      cuentaBancariaId: cuentaId,
      movimientosPropios: propiosElegidos,
      movimientoBanco: bancoElegido,
      // Lo eligió una persona: no hay regla del motor que lo explique, y no
      // hace falta que la haya.
      regla: 'manual',
    })
    limpiarSeleccion()
  }

  const aceptar = async (sugerencia: SugerenciaEmparejamiento) => {
    await emparejar.mutateAsync({
      cuentaBancariaId: cuentaId,
      movimientosPropios: sugerencia.movimientosPropios,
      movimientoBanco: sugerencia.movimientoBanco,
      regla: sugerencia.regla,
    })
    limpiarSeleccion()
  }

  /**
   * Acepta de golpe lo que el motor da por seguro.
   *
   * Las tres primeras reglas y solo esas. La cuarta, sumar varios movimientos
   * propios contra uno del banco, queda fuera a propósito: es la que más falsos
   * positivos produce y el diseño pide que se confirme una a una.
   */
  const aceptarSeguras = async () => {
    const seguras = (resumen?.sugerencias ?? []).filter(
      (s) => !s.requiereConfirmacion,
    )
    for (const sugerencia of seguras) {
      await aceptar(sugerencia)
    }
  }

  const cerrarConciliacion = async () => {
    if (!resumen?.saldoBanco) return
    await cerrar.mutateAsync({
      cuentaBancariaId: cuentaId,
      fechaCorte,
      saldoBanco: resumen.saldoBanco,
    })
    limpiarSeleccion()
  }

  const seguras = (resumen?.sugerencias ?? []).filter(
    (s) => !s.requiereConfirmacion,
  )
  const porConfirmar = (resumen?.sugerencias ?? []).filter(
    (s) => s.requiereConfirmacion,
  )

  return (
    <div>
      <PageHeader
        titulo="Conciliación bancaria"
        descripcion="Lo que registró la empresa contra lo que dice el banco. La diferencia tiene que quedar explicada y en cero."
        acciones={
          <Link to="/bancos/estado-cuenta">
            <Button>Importar estado de cuenta</Button>
          </Link>
        }
      />

      <Card className="mb-4">
        <div className="grid gap-4 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Cuenta bancaria">
            {(p) => (
              <Select
                {...p}
                value={cuentaId}
                onChange={(e) => {
                  setParametros({ cuenta: e.target.value }, { replace: true })
                  limpiarSeleccion()
                }}
              >
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} · {c.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Fecha de corte" requerido>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={fechaCorte}
                onChange={(e) => setFechaCorte(e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Saldo del estado de cuenta"
            ayuda={
              cuenta?.saldoBancoAl
                ? `Importado al ${formatFecha(cuenta.saldoBancoAl)}`
                : 'Cápturelo si el archivo no lo trae'
            }
          >
            {(p) => (
              <MoneyInput
                {...p}
                value={saldoCapturado}
                onChange={setSaldoCapturado}
                moneda={moneda}
              />
            )}
          </Field>

          <div className="flex flex-col justify-center">
            <span className="text-[11px] text-slate-500">Saldo en libros</span>
            <span className="text-lg font-semibold text-slate-900">
              <MoneyCell
                valor={resumen?.saldoLibros ?? '0.00'}
                moneda={moneda}
                mostrarSimbolo
              />
            </span>
          </div>
        </div>
      </Card>

      {resumen && <Ecuacion resumen={resumen} moneda={moneda} />}

      {errorServidor && (
        <div className="mb-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
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

      {resumen && resumen.sugerencias.length > 0 && (
        <Card className="mb-4">
          <CardHeader
            titulo="Emparejamientos propuestos"
            descripcion="Nada se aplica solo: aceptar una propuesta es la decisión, y todo es reversible mientras la conciliación no se cierre."
            acciones={
              seguras.length > 0 ? (
                <Button
                  tamano="sm"
                  variante="primario"
                  icono={<Wand2 className="size-3.5" />}
                  onClick={() => void aceptarSeguras()}
                  disabled={emparejar.isPending}
                >
                  Aceptar las {seguras.length} seguras
                </Button>
              ) : undefined
            }
          />
          <ul className="divide-y divide-slate-100">
            {[...seguras, ...porConfirmar].map((sugerencia) => (
              <li
                key={`${sugerencia.movimientoBanco}-${sugerencia.regla}`}
                className="flex items-center gap-3 px-4 py-2"
              >
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                    sugerencia.requiereConfirmacion
                      ? 'bg-amber-50 text-amber-700 ring-amber-200'
                      : 'bg-sky-50 text-sky-700 ring-sky-200',
                  )}
                >
                  {etiquetaRegla(sugerencia.regla)}
                </span>
                <span className="flex-1 text-sm text-slate-700">
                  {sugerencia.motivo}
                  {sugerencia.requiereConfirmacion && (
                    <span className="ml-1 text-xs text-amber-700">
                      · revísela una a una, es la que más se equivoca
                    </span>
                  )}
                </span>
                <Button
                  tamano="sm"
                  icono={<Link2 className="size-3.5" />}
                  onClick={() => void aceptar(sugerencia)}
                  disabled={emparejar.isPending}
                >
                  Emparejar
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            titulo="Movimientos propios sin conciliar"
            descripcion="Lo que registró la empresa y todavía no aparece en el banco."
          />
          {isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Calculando…
            </p>
          ) : (
            <ListaPropios
              movimientos={resumen?.propiosSinConciliar ?? []}
              moneda={moneda}
              elegidos={propiosElegidos}
              onAlternar={alternarPropio}
            />
          )}
        </Card>

        <Card>
          <CardHeader
            titulo="Líneas del banco sin conciliar"
            descripcion="Lo que dice el estado de cuenta y la empresa todavía no ha casado."
            acciones={
              propiosElegidos.length > 0 && bancoElegido ? (
                <Button
                  tamano="sm"
                  variante="primario"
                  icono={<Link2 className="size-3.5" />}
                  onClick={() => void casarSeleccion()}
                  disabled={emparejar.isPending}
                >
                  Emparejar lo seleccionado
                </Button>
              ) : undefined
            }
          />
          <ListaBanco
            lineas={resumen?.bancoSinConciliar ?? []}
            moneda={moneda}
            elegido={bancoElegido}
            onElegir={setBancoElegido}
          />
        </Card>
      </div>

      {resumen && resumen.partidas.length > 0 && (
        <Card className="mb-4">
          <CardHeader
            titulo="Partidas conciliatorias"
            descripcion="Lo que explica la diferencia. Las que exigen acción son dinero que el banco movió y la empresa no registró."
          />
          <ul className="divide-y divide-slate-100">
            {resumen.partidas.map((partida) => (
              <Partida
                key={partida.movimientoId}
                partida={partida}
                moneda={moneda}
                cuentaId={cuentaId}
              />
            ))}
          </ul>
        </Card>
      )}

      {resumen && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="text-sm">
              {resumen.puedeCerrar ? (
                <p className="flex items-center gap-1.5 font-medium text-emerald-700">
                  <CircleCheck className="size-4" />
                  La diferencia es cero: la conciliación se puede cerrar.
                </p>
              ) : (
                <>
                  <p className="flex items-center gap-1.5 font-medium text-amber-800">
                    <TriangleAlert className="size-4" />
                    Todavía no se puede cerrar
                  </p>
                  <ul className="mt-1 ml-6 list-disc space-y-0.5 text-xs text-slate-600">
                    {resumen.impedimentos.map((mensaje, i) => (
                      <li key={i}>{mensaje}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <Button
              variante="primario"
              onClick={() => void cerrarConciliacion()}
              disabled={!resumen.puedeCerrar || cerrar.isPending}
              title={
                resumen.puedeCerrar
                  ? 'Deja la conciliación cerrada a esta fecha de corte'
                  : 'Una conciliación no se cierra con diferencia'
              }
            >
              {cerrar.isPending ? 'Cerrando…' : 'Cerrar conciliación'}
            </Button>
          </div>
        </Card>
      )}

      {emparejados.length > 0 && (
        <Card className="mb-4">
          <CardHeader
            titulo="Emparejado en esta conciliación"
            descripcion="Todo lo que se casa es reversible mientras la conciliación no se cierre."
          />
          <ul className="divide-y divide-slate-100">
            {emparejados.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800">
                    {l.descripcion}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatFecha(l.fechaOperacion)}
                    {l.referencia ? ` · ${l.referencia}` : ''}
                  </span>
                </span>
                <MoneyCell valor={importeBanco(l).toFixed(2)} moneda={moneda} />
                <Button
                  tamano="sm"
                  variante="fantasma"
                  icono={<Link2Off className="size-3.5" />}
                  onClick={() => void deshacer.mutateAsync(l.id)}
                  disabled={deshacer.isPending}
                >
                  Deshacer
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {cerradas.length > 0 && (
        <Card>
          <CardHeader
            titulo="Conciliaciones cerradas"
            descripcion="Cada una es una foto firmada: lo que quedó dentro ya no se deshace."
          />
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left">Corte</th>
                <th className="px-3 py-2 text-right">Saldo del banco</th>
                <th className="px-3 py-2 text-right">Saldo en libros</th>
                <th className="px-3 py-2 text-right">Movimientos</th>
                <th className="px-4 py-2 text-left">Cerrada por</th>
              </tr>
            </thead>
            <tbody>
              {cerradas.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-1.5">{formatFecha(c.fechaCorte)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <MoneyCell valor={c.saldoBanco} moneda={moneda} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <MoneyCell valor={c.saldoLibros} moneda={moneda} />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular">
                    {c.movimientosPropios} propios · {c.movimientosBanco} del banco
                  </td>
                  <td className="px-4 py-1.5 text-xs text-slate-500">
                    {c.cerradaPor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

/* ------------------------------------------------------- Componentes */

const ETIQUETAS_REGLA: Record<string, string> = {
  referencia_importe: 'Regla 1',
  importe_fecha: 'Regla 2',
  importe_descripcion: 'Regla 3',
  agrupado: 'Regla 4 · agrupado',
  manual: 'Manual',
}

function etiquetaRegla(regla: string): string {
  return ETIQUETAS_REGLA[regla] ?? regla
}

/**
 * La ecuación de docs/06 §2.3, a la vista.
 *
 * Se enseña siempre y no solo cuando falla: es la única forma de que quien
 * concilia entienda de dónde sale la diferencia en vez de tener que creérsela.
 */
function Ecuacion({
  resumen,
  moneda,
}: {
  resumen: NonNullable<ReturnType<typeof useConciliacion>['data']>
  moneda: string
}) {
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
        <Termino titulo="Saldo del banco" valor={resumen.saldoBanco} moneda={moneda} />
        <span className="text-slate-400">−</span>
        <Termino
          titulo="Cheques en tránsito"
          valor={sumaPartidas(resumen.partidas, 'cheque_transito')}
          moneda={moneda}
        />
        <span className="text-slate-400">+</span>
        <Termino
          titulo="Depósitos en tránsito"
          valor={sumaPartidas(resumen.partidas, 'deposito_transito')}
          moneda={moneda}
        />
        <span className="text-slate-400">=</span>
        <Termino
          titulo="Saldo del banco ajustado"
          valor={resumen.saldoBancoAjustado}
          moneda={moneda}
        />
        <span className="ml-auto flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5">
          <span className="text-[11px] text-slate-500">Diferencia</span>
          <span
            className={cn(
              'text-base font-semibold',
              resumen.diferencia === '0.00'
                ? 'text-emerald-700'
                : 'text-red-700',
            )}
          >
            <MoneyCell valor={resumen.diferencia} moneda={moneda} />
          </span>
        </span>
      </div>
    </Card>
  )
}

function sumaPartidas(
  partidas: readonly PartidaConciliatoria[],
  tipo: PartidaConciliatoria['tipo'],
): string {
  return partidas
    .filter((p) => p.tipo === tipo)
    .reduce((acc, p) => acc + Math.abs(Number(p.importe)), 0)
    .toFixed(2)
}

function Termino({
  titulo,
  valor,
  moneda,
}: {
  titulo: string
  valor: string | null
  moneda: string
}) {
  return (
    <span className="flex flex-col">
      <span className="text-[11px] text-slate-500">{titulo}</span>
      <span className="font-medium text-slate-800">
        <MoneyCell valor={valor} moneda={moneda} />
      </span>
    </span>
  )
}

function ListaPropios({
  movimientos,
  moneda,
  elegidos,
  onAlternar,
}: {
  movimientos: readonly MovimientoBancario[]
  moneda: string
  elegidos: readonly string[]
  onAlternar: (id: string) => void
}) {
  if (movimientos.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-slate-500">
        Nada pendiente por este lado.
      </p>
    )
  }

  return (
    <ul className="max-h-96 divide-y divide-slate-100 overflow-auto">
      {movimientos.map((m) => (
        <li key={m.id}>
          <label className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-brand-50">
            <input
              type="checkbox"
              checked={elegidos.includes(m.id)}
              onChange={() => onAlternar(m.id)}
              className="size-4 rounded border-slate-300"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-slate-800">
                {m.concepto}
              </span>
              <span className="text-xs text-slate-500">
                {formatFecha(m.fecha)} · {etiquetaTipoMovimiento(m.tipo)}
                {m.referencia ? ` · ${m.referencia}` : ''}
              </span>
            </span>
            <MoneyCell valor={m.importe} moneda={moneda} />
          </label>
        </li>
      ))}
    </ul>
  )
}

function ListaBanco({
  lineas,
  moneda,
  elegido,
  onElegir,
}: {
  lineas: readonly MovimientoEstadoCuenta[]
  moneda: string
  elegido: string | null
  onElegir: (id: string) => void
}) {
  if (lineas.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-slate-500">
        No hay líneas del banco sin conciliar. Importe un estado de cuenta si
        todavía no lo ha hecho.
      </p>
    )
  }

  return (
    <ul className="max-h-96 divide-y divide-slate-100 overflow-auto">
      {lineas.map((l) => (
        <li key={l.id}>
          <label className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-brand-50">
            <input
              type="radio"
              name="linea-banco"
              checked={elegido === l.id}
              onChange={() => onElegir(l.id)}
              className="size-4 border-slate-300"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-slate-800">
                {l.descripcion}
              </span>
              <span className="text-xs text-slate-500">
                {formatFecha(l.fechaOperacion)}
                {l.referencia ? ` · ${l.referencia}` : ''}
              </span>
            </span>
            <MoneyCell valor={importeBanco(l).toFixed(2)} moneda={moneda} />
          </label>
        </li>
      ))}
    </ul>
  )
}

function Partida({
  partida,
  moneda,
  cuentaId,
}: {
  partida: PartidaConciliatoria
  moneda: string
  cuentaId: string
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <span
        className={cn(
          'rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
          partida.exigeAccion
            ? 'bg-amber-50 text-amber-700 ring-amber-200'
            : 'bg-slate-100 text-slate-600 ring-slate-200',
        )}
      >
        {ETIQUETAS_PARTIDA[partida.tipo]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-slate-800">
          {partida.descripcion}
        </span>
        <span className="text-xs text-slate-500">
          {formatFecha(partida.fecha)}
        </span>
      </span>
      <MoneyCell valor={partida.importe} moneda={moneda} />
      {partida.exigeAccion && (
        // Lo que el banco movió y la empresa no registró no se ajusta: se
        // captura y se contabiliza. El enlace lleva justo ahí.
        <Link
          to={`/bancos/movimientos/nuevo?cuenta=${cuentaId}`}
          className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline"
        >
          Registrarlo
        </Link>
      )}
    </li>
  )
}

const ETIQUETAS_PARTIDA: Record<PartidaConciliatoria['tipo'], string> = {
  cheque_transito: 'Cheque en tránsito',
  deposito_transito: 'Depósito en tránsito',
  cargo_no_registrado: 'Cargo sin registrar',
  abono_no_registrado: 'Abono sin registrar',
}
