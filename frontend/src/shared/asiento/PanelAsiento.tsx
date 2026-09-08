import type { ReactNode } from 'react'
import { Link } from 'react-router'
import Decimal from 'decimal.js'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { formatFecha } from '@/shared/format/fecha'
import type { Asiento } from '@/shared/api/contracts/conta'
import { useAsientoPorId } from '@/shared/api/trazabilidad'
import { etiquetaLibro, tratamientoUniforme } from './libro'
import { EtiquetaLibros, MarcaLibros } from './Libros'

/**
 * Adónde lleva el documento relacionado, si es que lleva a algún sitio.
 *
 * Solo CxC y CxP tienen hoy pantalla de detalle por ruta. Devolver null para el
 * resto es deliberado: un enlace que cae en el comodín del router y devuelve al
 * inicio es peor que no ofrecer enlace.
 */
function rutaDocumento(
  documento: NonNullable<Asiento['documentoRelacionado']>,
): string | null {
  if (documento.tipo !== 'factura') return null
  if (documento.modulo === 'cxc') return `/cxc/facturas/${documento.id}`
  if (documento.modulo === 'cxp') return `/cxp/facturas/${documento.id}`
  return null
}

export interface PanelAsientoProps {
  asiento: Asiento
  /** Botonera del encabezado (reversar, imprimir...). Quien la pone decide. */
  acciones?: ReactNode
  /**
   * Abre otro asiento en el mismo sitio. Es lo que vuelve clicable el enlace
   * entre un original y su reversa; sin esto el enlace se muestra como texto.
   */
  onAbrirAsiento?: (id: string) => void
}

/**
 * Enlace entre un asiento y su reversa, en cualquiera de los dos sentidos.
 *
 * El contrato guarda el id; lo que se lee es el código, así que se pide el
 * otro asiento. Es una consulta por id con la misma clave que usa `conta`, y
 * el asiento suele estar ya en caché por haberse listado.
 */
function EnlaceAsiento({
  id,
  prefijo,
  onAbrir,
}: {
  id: string
  prefijo: string
  onAbrir?: (id: string) => void
}) {
  const { data: otro } = useAsientoPorId(id)
  const etiqueta = otro?.codigo ?? '…'
  return (
    <span>
      {prefijo}{' '}
      {onAbrir ? (
        <button
          type="button"
          onClick={() => onAbrir(id)}
          className="font-mono font-medium text-brand-700 underline-offset-2 hover:underline"
        >
          {etiqueta}
        </button>
      ) : (
        <span className="font-mono font-medium">{etiqueta}</span>
      )}
    </span>
  )
}

/**
 * Vista del asiento generado por un documento.
 *
 * Se reutiliza en los cinco módulos subsidiarios: que el usuario vea el asiento
 * antes de contabilizar hace visible el contrato de docs/02 y es, de paso, la
 * mejor herramienta de depuración del proyecto (docs/14 §5).
 */
export function PanelAsiento({
  asiento,
  acciones,
  onAbrirAsiento,
}: PanelAsientoProps) {
  const cuadra = asiento.totales.every((t) =>
    new Decimal(t.totalCargos).equals(new Decimal(t.totalAbonos)),
  )
  // La columna por línea solo aparece cuando hay algo que mirar: si todas las
  // líneas van a los dos libros, repetirlo en cada renglón es ruido.
  const uniforme = tratamientoUniforme(asiento.lineas)
  const columnas = uniforme ? 5 : 6
  // Con tratamiento uniforme los dos libros llevan los mismos totales: se
  // muestra una fila, nombrando a las dos contabilidades.
  const filasTotales = uniforme ? asiento.totales.slice(0, 1) : asiento.totales

  const esReversa = asiento.reversaDeId !== null
  const fueReversado = asiento.estado === 'reversado'

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-slate-200 px-4 py-3">
        <div>
          <span className="text-[11px] text-slate-500">Asiento</span>
          <p className="font-mono text-sm font-semibold text-slate-800">
            {asiento.codigo}
          </p>
        </div>
        <div>
          <span className="text-[11px] text-slate-500">Fecha</span>
          <p className="text-sm text-slate-800">{formatFecha(asiento.fecha)}</p>
        </div>
        <div>
          <span className="text-[11px] text-slate-500">Origen</span>
          <p className="text-sm text-slate-800">
            {asiento.origenModulo
              ? `${asiento.origenModulo} · ${asiento.origenTipo} · ${asiento.origenId}`
              : 'Captura manual'}
          </p>
        </div>
        {asiento.documentoRelacionado && (
          <div>
            <span className="text-[11px] text-slate-500">
              Documento relacionado
            </span>
            {/* Los módulos con pantalla de detalle propia se enlazan; el resto
                se queda en texto. La trazabilidad es el dato, y el enlace solo
                existe donde hay adónde ir. */}
            <p className="text-sm text-slate-800">
              {asiento.documentoRelacionado.modulo} ·{' '}
              {rutaDocumento(asiento.documentoRelacionado) ? (
                <Link
                  className="font-mono text-brand-700 hover:underline"
                  to={rutaDocumento(asiento.documentoRelacionado)!}
                >
                  {asiento.documentoRelacionado.referencia}
                </Link>
              ) : (
                <span className="font-mono">
                  {asiento.documentoRelacionado.referencia}
                </span>
              )}
            </p>
          </div>
        )}
        <div>
          <span className="text-[11px] text-slate-500">Contabilidad</span>
          <p className="text-sm">
            <EtiquetaLibros libros={asiento.libros} />
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <EstadoBadge estado={asiento.estado} />
          {acciones}
        </div>
      </div>

      {/* El par original-reversa se enlaza en los dos sentidos: desde el
          reversado se llega a lo que lo neutralizó, y desde la reversa a lo
          que corrige. Un auditor recorre el enlace en cualquiera de los dos. */}
      {(fueReversado || esReversa) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          {fueReversado && asiento.reversadoPorId && (
            <EnlaceAsiento
              id={asiento.reversadoPorId}
              prefijo="Reversado por el asiento"
              onAbrir={onAbrirAsiento}
            />
          )}
          {fueReversado && asiento.motivoReversa && (
            <span>Motivo: {asiento.motivoReversa}</span>
          )}
          {esReversa && asiento.reversaDeId && (
            <EnlaceAsiento
              id={asiento.reversaDeId}
              prefijo="Reversa del asiento"
              onAbrir={onAbrirAsiento}
            />
          )}
        </div>
      )}

      <p className="px-4 py-2 text-sm text-slate-700">{asiento.concepto}</p>

      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
          <tr>
            <th className="w-36 px-4 py-2 text-left">Cuenta</th>
            <th className="px-3 py-2 text-left">Nombre</th>
            <th className="px-3 py-2 text-left">Concepto / auxiliar</th>
            {!uniforme && <th className="w-16 px-3 py-2 text-center">Libro</th>}
            <th className="w-36 px-3 py-2 text-right">Cargo</th>
            <th className="w-36 px-4 py-2 text-right">Abono</th>
          </tr>
        </thead>
        <tbody>
          {asiento.lineas.map((linea) => (
            <tr key={linea.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-1.5 font-mono text-xs text-slate-600">
                {linea.cuentaCodigo}
              </td>
              <td className="px-3 py-1.5 text-slate-700">{linea.cuentaNombre}</td>
              <td className="px-3 py-1.5 text-xs text-slate-500">
                {linea.concepto}
                {linea.auxiliarNombre && (
                  <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                    {linea.auxiliarTipo}: {linea.auxiliarNombre}
                  </span>
                )}
              </td>
              {!uniforme && (
                <td className="px-3 py-1.5 text-center">
                  <MarcaLibros libros={linea.libros} />
                </td>
              )}
              <td className="px-3 py-1.5 text-right">
                <MoneyCell valor={linea.cargo} moneda={asiento.moneda} ocultarCero />
              </td>
              <td className="px-4 py-1.5 text-right">
                <MoneyCell valor={linea.abono} moneda={asiento.moneda} ocultarCero />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-slate-50 font-semibold text-slate-800">
          {/* Un total por libro: cada uno cuadra por separado y sumarlos daría
              un importe que no corresponde a ninguna contabilidad. */}
          {filasTotales.map((total) => (
            <tr key={total.libro}>
              <td
                colSpan={columnas - 2}
                className="px-4 py-2 text-right text-xs"
              >
                Totales
                <span className="ml-1 font-normal text-slate-500">
                  ·{' '}
                  {uniforme && asiento.totales.length > 1
                    ? 'ambas contabilidades'
                    : etiquetaLibro(total.libro).toLowerCase()}
                </span>
              </td>
              <td className="px-3 py-2 text-right">
                <MoneyCell valor={total.totalCargos} moneda={asiento.moneda} />
              </td>
              <td className="px-4 py-2 text-right">
                <MoneyCell valor={total.totalAbonos} moneda={asiento.moneda} />
              </td>
            </tr>
          ))}
          {!cuadra && (
            <tr>
              <td
                colSpan={columnas}
                className="px-4 py-2 text-right text-xs text-red-700"
              >
                El asiento no cuadra — esto no debería ocurrir nunca
              </td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  )
}
