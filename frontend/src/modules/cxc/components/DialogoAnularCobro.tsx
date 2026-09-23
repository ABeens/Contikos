import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha } from '@/shared/format/fecha'
import type { Cobro } from '@/shared/api/contracts/cxc'
import { useAnularCobro } from '../api/queries'
import { DialogoAnulacion } from '@/shared/ui/DialogoAnulacion'

/**
 * Anulación de un cobro (docs/04 §2.2, docs/02 §6).
 *
 * Anular no borra: reversa el asiento y devuelve el saldo a las facturas que el
 * cobro había bajado. El documento queda en el histórico con su motivo, que es
 * lo único que explicará dentro de un año por qué una factura que estaba pagada
 * volvió a estar por cobrar.
 *
 * Se admite aunque el cobro esté en un periodo ya cerrado: la reversa va en el
 * periodo abierto, no se reabre nada para corregir. Lo que sí se exige es que
 * la fecha de la anulación caiga en periodo abierto, y por eso se propone sola.
 *
 * Se monta solo mientras está abierto: cada apertura empieza en limpio, sin el
 * motivo ni el error de la vez anterior.
 */
export function DialogoAnularCobro({
  cobro,
  abierto,
  onCerrar,
}: {
  cobro: Cobro
  abierto: boolean
  onCerrar: () => void
}) {
  const anular = useAnularCobro()

  return (
    <DialogoAnulacion
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={`Anular el cobro ${cobro.numero}`}
      descripcion="Se reversa el asiento y el saldo vuelve a las facturas. El cobro no se borra: queda en el histórico como anulado."
      fechaDocumento={cobro.fecha}
      textoConfirmar="Confirmar anulación"
      placeholderMotivo="Por qué se anula. Queda en el histórico del cobro."
      anular={(solicitud) => anular.mutateAsync({ id: cobro.id, solicitud })}
      pendiente={anular.isPending}
      error={anular.error}
      alEditar={() => {
        if (anular.isError) anular.reset()
      }}
    >
      <p className="mt-4 text-xs font-medium text-slate-600">
        Saldo que vuelve a las facturas
      </p>
      <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 font-semibold text-slate-600">
            <tr>
              <th className="px-3 py-1.5 text-left">Factura</th>
              <th className="w-32 px-3 py-1.5 text-right">Saldo que vuelve</th>
            </tr>
          </thead>
          <tbody>
            {cobro.aplicaciones.map((aplicacion) => (
              <tr key={aplicacion.facturaId} className="border-t border-slate-100">
                <td className="px-3 py-1 font-mono text-slate-600">
                  {aplicacion.facturaNumero}
                </td>
                <td className="px-3 py-1 text-right">
                  <MoneyCell
                    valor={aplicacion.importeAplicado}
                    moneda={cobro.moneda}
                  />
                </td>
              </tr>
            ))}
            {cobro.aplicaciones.length === 0 && (
              <tr>
                <td
                  colSpan={2}
                  className="px-3 py-3 text-center text-slate-500"
                >
                  El cobro no se aplicó a ninguna factura. Lo que se reversa es
                  el anticipo del {formatFecha(cobro.fecha)}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DialogoAnulacion>
  )
}
