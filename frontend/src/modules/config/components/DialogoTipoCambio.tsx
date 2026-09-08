import { useMemo, useState } from 'react'
import Decimal from 'decimal.js'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Select } from '@/shared/ui/Field'
import { formatFechaLarga } from '@/shared/format/fecha'
import { ApiError } from '@/shared/api/client'
import type {
  MonedaConfig,
  SolicitudMoneda,
} from '@/shared/api/contracts/config'
import {
  tipoCambioContraFuncional,
  type CambioContraFuncional,
} from '@/shared/fiscal/tipoCambio'
import { aSolicitud } from '../domain/moneda'
import { useAplicarTipoCambio, useTipoCambioDelDia } from '../api/queries'

/**
 * Trae el tipo de cambio del día y lo lleva al catálogo (docs/13 §7).
 *
 * La fuente publica compra y venta; el catálogo guarda un solo tipo de cambio
 * de referencia por moneda, así que el usuario elige cuál de los dos se aplica
 * y la pantalla enseña los dos antes de tocar nada. Lo que se actualiza es la
 * referencia del catálogo: los asientos ya emitidos no cambian, porque cada uno
 * congeló el suyo.
 */

type Pata = 'compra' | 'venta'

const PATAS: { valor: Pata; etiqueta: string }[] = [
  { valor: 'venta', etiqueta: 'Venta  ·  al que se compran divisas' },
  { valor: 'compra', etiqueta: 'Compra  ·  al que se venden divisas' },
]

interface Fila {
  readonly moneda: MonedaConfig
  /** null cuando la fuente no publica esa moneda. */
  readonly cambio: CambioContraFuncional | null
  readonly nuevo: string | null
  readonly cambia: boolean
}

export interface DialogoTipoCambioProps {
  abierto: boolean
  onCerrar: () => void
  monedas: readonly MonedaConfig[]
}

export function DialogoTipoCambio({
  abierto,
  onCerrar,
  monedas,
}: DialogoTipoCambioProps) {
  const [pata, setPata] = useState<Pata>('venta')
  const consulta = useTipoCambioDelDia(abierto)
  const aplicar = useAplicarTipoCambio()

  const funcional = monedas.find((m) => m.funcional)?.codigo ?? ''
  const tabla = consulta.data

  const filas = useMemo<Fila[]>(() => {
    if (!tabla) return []
    return (
      monedas
        // La funcional se cambia a sí misma a la par: no tiene tipo que traer.
        .filter((m) => !m.funcional)
        .map((moneda) => {
          const cambio = tipoCambioContraFuncional(
            tabla,
            funcional,
            moneda.codigo,
          )
          const nuevo = cambio ? cambio[pata] : null
          return {
            moneda,
            cambio,
            nuevo,
            cambia:
              nuevo !== null && !new Decimal(nuevo).equals(moneda.tipoCambio),
          }
        })
    )
  }, [tabla, monedas, funcional, pata])

  const porAplicar = filas.filter((f) => f.cambia)

  const notas = [
    ...new Set(filas.flatMap((f) => (f.cambio?.nota ? [f.cambio.nota] : []))),
  ]

  const error = [consulta.error, aplicar.error].find(
    (e): e is ApiError => e instanceof ApiError,
  )

  const confirmar = async () => {
    const solicitudes: SolicitudMoneda[] = porAplicar.flatMap((f) =>
      f.nuevo === null ? [] : [{ ...aSolicitud(f.moneda), tipoCambio: f.nuevo }],
    )
    await aplicar.mutateAsync(solicitudes)
    onCerrar()
  }

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Tipo de cambio del día"
      descripcion={
        tabla
          ? `${tabla.fuente}  ·  ${formatFechaLarga(tabla.fecha)}`
          : 'Publicado por el Ministerio de Hacienda'
      }
      className="w-[min(94vw,44rem)]"
      acciones={
        <>
          <Button onClick={onCerrar}>Cancelar</Button>
          <Button
            variante="primario"
            disabled={porAplicar.length === 0 || aplicar.isPending}
            onClick={() => void confirmar()}
          >
            {aplicar.isPending
              ? 'Aplicando…'
              : porAplicar.length === 1
                ? 'Aplicar a 1 moneda'
                : `Aplicar a ${porAplicar.length} monedas`}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4 shrink-0" />
            {error.codigo}: {error.message}
          </p>
        </div>
      )}

      {consulta.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">
          Consultando el tipo de cambio…
        </p>
      ) : tabla ? (
        <div className="flex flex-col gap-4">
          <Field
            label="Tipo que se lleva al catálogo"
            ayuda="La fuente publica los dos. El catálogo guarda uno solo como referencia."
            className="max-w-sm"
          >
            {(props) => (
              <Select
                {...props}
                value={pata}
                onChange={(e) => setPata(e.target.value as Pata)}
              >
                {PATAS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.etiqueta}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="w-20 px-3 py-2 text-left">Moneda</th>
                  <th className="w-28 px-3 py-2 text-right">Compra</th>
                  <th className="w-28 px-3 py-2 text-right">Venta</th>
                  <th className="w-28 px-3 py-2 text-right">En catálogo</th>
                  <th className="px-3 py-2 text-right">Quedaría en</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(({ moneda, cambio, nuevo, cambia }) => (
                  <tr
                    key={moneda.codigo}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs font-semibold text-slate-700">
                        {moneda.codigo}
                      </span>
                      {cambio?.origen === 'derivado' && (
                        <span
                          title={cambio.nota}
                          className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                        >
                          Derivado
                        </span>
                      )}
                    </td>
                    {cambio ? (
                      <>
                        <td className="tabular px-3 py-2 text-right text-slate-700">
                          {cambio.compra}
                        </td>
                        <td className="tabular px-3 py-2 text-right text-slate-700">
                          {cambio.venta}
                        </td>
                      </>
                    ) : (
                      <td
                        colSpan={2}
                        className="px-3 py-2 text-right text-xs text-slate-400"
                      >
                        La fuente no publica esta moneda
                      </td>
                    )}
                    <td className="tabular px-3 py-2 text-right text-slate-500">
                      {moneda.tipoCambio}
                    </td>
                    <td className="tabular px-3 py-2 text-right">
                      {nuevo === null ? (
                        <span className="text-slate-400">sin cambio</span>
                      ) : cambia ? (
                        <span className="font-medium text-slate-800">
                          {nuevo}
                        </span>
                      ) : (
                        <span className="text-slate-400">ya es el vigente</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {notas.map((nota) => (
            <p key={nota} className="text-xs text-slate-500">
              {nota}
            </p>
          ))}

          <p className="text-xs text-slate-500">
            Se actualiza el tipo de cambio de referencia del catálogo. Los
            asientos ya registrados no se tocan: cada uno congeló el tipo con el
            que se contabilizó.
          </p>
        </div>
      ) : null}
    </Dialogo>
  )
}
