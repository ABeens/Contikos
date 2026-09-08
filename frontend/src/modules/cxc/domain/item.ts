import Decimal from 'decimal.js'
import { esMonedaRegistrada } from '@/shared/money/money'
import { nombreTarifa } from '@/shared/fiscal/impuestos'
import type { TarifaImpuesto } from '@/shared/api/contracts/impuestos'
import type { Cuenta } from '@/shared/api/contracts/conta'
import type {
  ItemCatalogo,
  LineaSolicitudFacturaVenta,
  SolicitudItemCatalogo,
} from '@/shared/api/contracts/cxc'

/**
 * Reglas del catálogo de productos y servicios (docs/04 §1.1).
 *
 * El catálogo decide una vez lo que si no habría que decidir en cada factura:
 * a qué cuenta de ingreso va la venta y con qué tarifa se grava. Por eso lo que
 * se valida aquí es sobre todo esa pareja; el resto son datos de presentación.
 *
 * Es la misma función que usa el mock, para que la pantalla y la API rechacen
 * exactamente lo mismo.
 */

export type CodigoErrorItem =
  | 'CODIGO_REQUERIDO'
  | 'CODIGO_DUPLICADO'
  | 'NOMBRE_REQUERIDO'
  | 'PRECIO_INVALIDO'
  | 'MONEDA_INVALIDA'
  | 'CUENTA_INVALIDA'
  | 'TARIFA_INVALIDA'

export interface ErrorItem {
  readonly codigo: CodigoErrorItem
  readonly mensaje: string
}

export interface ContextoItem {
  readonly cuentas: readonly Cuenta[]
  readonly items: readonly ItemCatalogo[]
  /** El item que se edita. Ausente = alta. */
  readonly item?: ItemCatalogo
  /**
   * Tabla de impuestos. Si viene, la tarifa del item tiene que existir en
   * ella (en cualquier vigencia): el item precarga la línea y la vigencia se
   * comprueba al facturar, por la fecha del documento.
   */
  readonly tarifas?: readonly TarifaImpuesto[]
}

export interface ResultadoItem {
  readonly valido: boolean
  readonly errores: readonly ErrorItem[]
}

/**
 * Cuenta que puede recibir el ingreso de una venta.
 *
 * De detalle, activa y de tipo ingreso. La comprobación del tipo es la que
 * importa: una venta abonada a una cuenta de pasivo cuadra el asiento y deja
 * el Estado de Resultados sin la venta.
 */
export function esCuentaDeIngreso(cuenta: Cuenta | undefined): boolean {
  return Boolean(
    cuenta && cuenta.tipo === 'ingreso' && cuenta.esDetalle && cuenta.activa,
  )
}

function decimalDe(valor: string): Decimal | null {
  try {
    const numero = new Decimal(valor)
    return numero.isFinite() ? numero : null
  } catch {
    return null
  }
}

export function validarItem(
  solicitud: SolicitudItemCatalogo,
  contexto: ContextoItem,
): ResultadoItem {
  const errores: ErrorItem[] = []
  const codigo = solicitud.codigo.trim()
  const nombre = solicitud.nombre.trim()

  if (!codigo) {
    errores.push({
      codigo: 'CODIGO_REQUERIDO',
      mensaje: 'El item requiere un código',
    })
  } else if (
    contexto.items.some(
      (i) =>
        i.id !== contexto.item?.id &&
        i.codigo.trim().toLocaleLowerCase() === codigo.toLocaleLowerCase(),
    )
  ) {
    // El código es lo que se teclea al facturar: repetirlo haría que la misma
    // pulsación precargue una cuenta u otra según el orden del catálogo.
    errores.push({
      codigo: 'CODIGO_DUPLICADO',
      mensaje: `Ya existe un item con el código ${codigo}`,
    })
  }

  if (!nombre) {
    errores.push({
      codigo: 'NOMBRE_REQUERIDO',
      mensaje: 'El item requiere un nombre',
    })
  }

  const precio = decimalDe(solicitud.precioUnitario)
  if (!precio || precio.lessThan(0)) {
    errores.push({
      codigo: 'PRECIO_INVALIDO',
      mensaje: 'El precio de lista no puede ser negativo',
    })
  }

  if (!esMonedaRegistrada(solicitud.moneda)) {
    errores.push({
      codigo: 'MONEDA_INVALIDA',
      mensaje: `La moneda ${solicitud.moneda} no está en el catálogo`,
    })
  }

  const cuenta = contexto.cuentas.find((c) => c.codigo === solicitud.cuentaIngreso)
  if (!solicitud.cuentaIngreso) {
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje: 'Indique la cuenta de ingreso que acredita la venta',
    })
  } else if (!cuenta) {
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje: `La cuenta ${solicitud.cuentaIngreso} no existe en el catálogo`,
    })
  } else if (!esCuentaDeIngreso(cuenta)) {
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje: `La cuenta ${solicitud.cuentaIngreso} no admite el ingreso de una venta: tiene que ser de detalle, activa y de tipo ingreso`,
    })
  }

  if (!solicitud.tarifa.trim()) {
    errores.push({
      codigo: 'TARIFA_INVALIDA',
      mensaje: 'Indique la tarifa de IVA con la que se vende el item',
    })
  } else if (
    contexto.tarifas &&
    !contexto.tarifas.some((t) => t.codigo === solicitud.tarifa)
  ) {
    errores.push({
      codigo: 'TARIFA_INVALIDA',
      mensaje: `La tarifa ${solicitud.tarifa} no existe en la tabla de impuestos`,
    })
  }

  return { valido: errores.length === 0, errores }
}

/**
 * Valores que un item aporta a una línea de factura.
 *
 * Son un punto de partida, no una imposición: quien factura los cambia sin
 * pedir permiso y lo que se contabiliza es lo que quedó en la línea. Por eso
 * esto devuelve un objeto y no muta nada: quien llama decide qué acepta.
 *
 * El precio se precarga solo cuando el item está cotizado en la moneda de la
 * factura. Convertirlo por el tipo de cambio del día daría un precio de lista
 * que nadie pactó, y el silencio es peor que el campo vacío.
 */
export function precargaDeItem(
  item: ItemCatalogo,
  monedaFactura: string,
): Pick<
  LineaSolicitudFacturaVenta,
  'itemId' | 'descripcion' | 'tarifa' | 'cuentaIngreso'
> & { precioUnitario: string | null } {
  return {
    itemId: item.id,
    descripcion: item.descripcion ?? item.nombre,
    tarifa: item.tarifa,
    cuentaIngreso: item.cuentaIngreso,
    precioUnitario: item.moneda === monedaFactura ? item.precioUnitario : null,
  }
}

/** Etiqueta corta del item para listas y selectores. */
export function resumenDeItem(
  item: ItemCatalogo,
  tarifas: readonly TarifaImpuesto[] = [],
): string {
  return `${item.nombre} · ${nombreTarifa(tarifas, item.tarifa)} · ${item.cuentaIngreso}`
}
