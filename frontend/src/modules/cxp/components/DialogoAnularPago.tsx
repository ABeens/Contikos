import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha } from '@/shared/format/fecha'
import type { Pago } from '@/shared/api/contracts/cxp'
import { useAnularPago } from '../api/queries'
import { DialogoAnulacion } from '@/shared/ui/DialogoAnulacion'

/**
 * Anulación de un pago (docs/05 §2.2, docs/02 §6).
 *
 * Reversa su asiento y devuelve el saldo a las facturas que había abonado. El
 * pago queda en el histórico con su motivo. Comparte diálogo con la anulación
 * de cobros: la fecha se propone en periodo abierto y se valida contra él, y el
 * motivo es obligatorio con su mensaje, igual en los dos lados.
 *
 * Se monta solo mientras está abierto: cada apertura empieza en limpio.
 */
export function DialogoAnularPago({
  pago,
  onCerrar,
}: {
  pago: Pago
  onCerrar: () => void
}) {
  const anular = useAnularPago()

  return (
    <DialogoAnulacion
      abierto
      onCerrar={onCerrar}
      titulo={`Anular el pago ${pago.folio}`}
      descripcion="Se reversa su asiento y el saldo vuelve a las facturas que había abonado. El pago queda en el histórico, no se borra."
      fechaDocumento={pago.fecha}
      textoConfirmar="Anular pago"
      placeholderMotivo="Cheque devuelto, pago duplicado…"
      anular={(solicitud) => anular.mutateAsync({ id: pago.id, solicitud })}
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
            {pago.aplicaciones.map((a) => (
              <tr key={a.facturaId} className="border-t border-slate-100">
                <td className="px-3 py-1 font-mono text-slate-600">
                  {a.folioProveedor}
                </td>
                <td className="px-3 py-1 text-right">
                  <MoneyCell valor={a.importe} moneda={pago.moneda} />
                </td>
              </tr>
            ))}
            {pago.aplicaciones.length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-3 text-center text-slate-500">
                  El pago no se aplicó a ninguna factura. Lo que se reversa es
                  el anticipo del {formatFecha(pago.fecha)}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DialogoAnulacion>
  )
}
