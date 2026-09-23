import { useState } from 'react'
import { useTipoCambioVigente } from '@/shared/api/catalogos'
import { formatFecha } from '@/shared/format/fecha'
import { monedaFuncional, type Moneda } from '@/shared/money/money'

/**
 * Tipo de cambio de un documento: el vigente a SU fecha, no el de hoy
 * (docs/13 §7).
 *
 * Se propone el de referencia de venta, que es el que pide Hacienda en el
 * comprobante electrónico. Se propone; no se impone: quien captura puede
 * teclear otro, y desde ese momento la propuesta deja de pisarlo. Mientras no
 * lo toque, cambiar la moneda o la fecha vuelve a proponer el de ese día.
 *
 * Es estado derivado y no un efecto que copia la consulta en el campo: así no
 * hay un render con el tipo viejo ni una carrera entre la respuesta de dos
 * fechas.
 */
export function useTipoCambioDocumento(moneda: Moneda, fecha: string) {
  const funcional = monedaFuncional()
  const esFuncional = moneda === funcional
  const vigente = useTipoCambioVigente(moneda, fecha)
  /** Lo tecleado a mano, atado a la moneda en la que se tecleó. */
  const [manual, setManual] = useState<{ moneda: Moneda; valor: string } | null>(
    null,
  )

  const editado = !esFuncional && manual !== null && manual.moneda === moneda
  const propuesto = esFuncional ? '1' : (vigente.data?.venta ?? '')
  const tipoCambio = esFuncional ? '1' : editado ? manual.valor : propuesto

  const ayuda = esFuncional
    ? 'Moneda funcional'
    : editado
      ? vigente.data
        ? `Editado a mano. Vigente al ${formatFecha(fecha)}: ${vigente.data.venta}`
        : 'Editado a mano'
      : vigente.isFetching
        ? 'Consultando el del día…'
        : vigente.data
          ? `Venta del ${formatFecha(vigente.data.fecha)} (${vigente.data.fuente})`
          : vigente.isError
            ? 'No hay tipo de cambio para esa fecha: captúrelo a mano'
            : undefined

  return {
    tipoCambio,
    editado,
    ayuda,
    /** Cambio tecleado por el usuario: desde aquí la propuesta no lo pisa. */
    editar: (valor: string) => setManual({ moneda, valor }),
    /** Vuelve a seguir la propuesta del día. */
    restablecer: () => setManual(null),
  }
}
