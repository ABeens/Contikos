import Decimal from 'decimal.js'
import type { IdTarifaIva } from '@/shared/fiscal/iva'
import { calcularImpuestoLinea } from '@/shared/fiscal/iva'
import type {
  AplicacionPago,
  FacturaCompra,
  LineaFacturaCompra,
  MapeoCxp,
  MedioPago,
  Pago,
  ProveedorBase,
} from '@/shared/api/contracts/cxp'
import type { Adjunto, EstadoDocumento } from '@/shared/api/contracts/comunes'
import { tabla } from '@/shared/almacen/almacen'
import {
  EMPRESA_PRINCIPAL,
  EMPRESA_SECUNDARIA,
  segunEmpresa,
} from './empresas'
import { asientoDeOrigen } from './asientos'
import { resolutorImpuestos } from './impuestos'

/**
 * Proveedores y facturas recibidas de la empresa demo.
 *
 * Igual que en CxC, cada factura es el reverso de un asiento que ya está en el
 * mayor. La 9001 además capitaliza su línea: es la que enlaza este módulo con
 * activos fijos (docs/07 §3.1).
 */

export const MAPEO_CXP: MapeoCxp = {
  proveedor: '2.1.01.001',
  gasto: '6.1.02.003',
  impuestoAcreditable: '1.1.03.001',
  retencion: '2.1.02.002',
  // Roles del evento `pago_emitido` (docs/05 §6). La cuenta de bancos no está
  // aquí: la elige quien paga, porque la empresa tiene varias.
  anticipo: '1.1.05.001',
  diferencialGanado: '4.2.01.001',
  diferencialPerdido: '6.2.01.002',
}

const PROVEEDORES_SEED: readonly ProveedorBase[] = [
  {
    id: 'pro-014',
    codigo: 'P-014',
    razonSocial: 'Despacho Contable Arias & Asociados',
    nombreComercial: 'Arias & Asociados',
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101334455',
    correo: 'facturacion@ariasyasociados.cr',
    telefono: { codigoPais: '506', numero: '22561234' },
    // Actividades de contabilidad y auditoría (CIIU 6920).
    actividadEconomica: '692000',
    diasCredito: 30,
    moneda: 'CRC',
    cuentaGasto: '6.1.02.003',
    retencionRenta: '0',
    activo: true,
  },
  {
    id: 'pro-021',
    codigo: 'P-021',
    razonSocial: 'Suministros de Oficina Delta S.A.',
    nombreComercial: 'Delta Oficinas',
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101667788',
    correo: 'ventas@delta.cr',
    telefono: { codigoPais: '506', numero: '22909090' },
    // Venta al por menor de artículos de papelería (CIIU 4761).
    actividadEconomica: '476100',
    diasCredito: 15,
    moneda: 'CRC',
    cuentaGasto: '6.1.02.004',
    retencionRenta: '0',
    activo: true,
  },
  {
    id: 'pro-033',
    codigo: 'P-033',
    razonSocial: 'Ingeniería y Sistemas Vega S.A.',
    nombreComercial: null,
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101990011',
    correo: 'cobros@isvega.cr',
    telefono: null,
    actividadEconomica: '620200',
    diasCredito: 30,
    moneda: 'CRC',
    cuentaGasto: null,
    // Servicios profesionales: se le retiene el 2% de renta (docs/13 §5).
    retencionRenta: '2',
    activo: true,
  },
]

/**
 * Proveedores de la segunda empresa del grupo.
 *
 * El despacho contable es el mismo tercero que en la principal (misma cédula)
 * con OTRAS condiciones: aquí se le retiene el 2% y se le paga a quince días.
 * Es el caso que separa la identidad, compartida, de la relación comercial,
 * que es de cada empresa (docs/12 D-12).
 */
const PROVEEDORES_PACIFICO_SEED: readonly ProveedorBase[] = [
  {
    id: 'pro-001',
    codigo: 'P-001',
    razonSocial: 'Despacho Contable Arias & Asociados',
    nombreComercial: 'Arias & Asociados',
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101334455',
    correo: 'facturacion@ariasyasociados.cr',
    telefono: { codigoPais: '506', numero: '22561234' },
    actividadEconomica: '692000',
    diasCredito: 15,
    moneda: 'CRC',
    cuentaGasto: '6.1.02.003',
    retencionRenta: '2',
    activo: true,
  },
  {
    id: 'pro-002',
    codigo: 'P-002',
    razonSocial: 'Transportes del Pacífico Sur S.A.',
    nombreComercial: 'TP Sur',
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101556677',
    correo: 'facturacion@tpsur.cr',
    telefono: { codigoPais: '506', numero: '27750000' },
    // Transporte de carga por carretera (CIIU 4923).
    actividadEconomica: '492300',
    diasCredito: 30,
    moneda: 'CRC',
    cuentaGasto: null,
    retencionRenta: '0',
    activo: true,
  },
]

/** Nombre de la colección. Lo lee también el directorio de terceros del grupo. */
export const TABLA_PROVEEDORES = 'cxp.proveedores'

/**
 * Los proveedores vivos, persistidos.
 *
 * Antes que las facturas: la semilla de facturas lee de aquí la razón social y
 * la retención aplicable de cada proveedor.
 */
const tablaProveedores = tabla<ProveedorBase>(
  TABLA_PROVEEDORES,
  segunEmpresa({
    [EMPRESA_PRINCIPAL]: () => PROVEEDORES_SEED.map((p) => ({ ...p })),
    [EMPRESA_SECUNDARIA]: () => PROVEEDORES_PACIFICO_SEED.map((p) => ({ ...p })),
  }),
)

export const proveedoresMock: ProveedorBase[] = tablaProveedores.filas

export function persistirProveedores(): void {
  tablaProveedores.persistir()
}


/* ---------------------------------------------------------------- Adjuntos */

/**
 * Contenido de los adjuntos, aparte de la factura.
 *
 * La factura lleva solo los metadatos (`FacturaCompra.adjuntos`); el base64
 * vive aquí para que listar facturas no arrastre megabytes de PDF y para que
 * guardar una factura no reescriba sus archivos. Es la misma separación que
 * hará el backend entre la fila y el almacén de objetos.
 */
export interface AdjuntoAlmacenado extends Adjunto {
  facturaId: string
  contenidoBase64: string
}

/**
 * PDF mínimo de demostración: una página con una línea de texto.
 *
 * Sin tabla de referencias cruzadas, que los visores reconstruyen solos. Es
 * suficiente para que "abrir" enseñe algo real y no un archivo roto.
 */
const PDF_DEMO = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 360 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
  '4 0 obj<</Length 78>>stream',
  'BT /F1 16 Tf 24 84 Td (Factura 4521 - Arias & Asociados) Tj ET',
  'endstream',
  'endobj',
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
].join('\n')

/** base64 del texto. `btoa` existe en el navegador y en jsdom. */
function aBase64(texto: string): string {
  return btoa(texto)
}

const ADJUNTOS_SEED: readonly AdjuntoAlmacenado[] = [
  {
    id: 'adj-4521-1',
    facturaId: 'fpr-4521',
    nombre: 'factura-4521.pdf',
    tipoMime: 'application/pdf',
    tamano: PDF_DEMO.length,
    fechaCarga: '2026-07-20T11:05:00Z',
    cargadoPor: 'demo',
    descripcion: 'PDF enviado por el proveedor',
    contenidoBase64: aBase64(PDF_DEMO),
  },
]

const tablaAdjuntos = tabla<AdjuntoAlmacenado>(
  'cxp.adjuntos',
  segunEmpresa({ [EMPRESA_PRINCIPAL]: () => ADJUNTOS_SEED.map((a) => ({ ...a })) }),
)

export const adjuntosCompraMock: AdjuntoAlmacenado[] = tablaAdjuntos.filas

export function persistirAdjuntosCompra(): void {
  tablaAdjuntos.persistir()
}

/**
 * Metadatos, sin contenido: lo que la factura lleva consigo.
 *
 * Se enumeran los campos en vez de descartar los otros dos por destructuring:
 * así, el día que el contrato del adjunto crezca, esto no compila hasta que
 * alguien decida si el campo nuevo viaja con la factura o se queda en el
 * almacén. Omitir a ciegas lo dejaría pasar sin que nadie se entere.
 */
export function metadatosDeAdjunto(adjunto: AdjuntoAlmacenado): Adjunto {
  return {
    id: adjunto.id,
    nombre: adjunto.nombre,
    tipoMime: adjunto.tipoMime,
    tamano: adjunto.tamano,
    fechaCarga: adjunto.fechaCarga,
    cargadoPor: adjunto.cargadoPor,
    descripcion: adjunto.descripcion,
  }
}

export function siguienteIdAdjunto(facturaId: string): string {
  const propios = adjuntosCompraMock.filter((a) => a.facturaId === facturaId)
  const mayor = propios.reduce((acc, a) => {
    const numero = Number(a.id.split('-').at(-1))
    return Number.isNaN(numero) ? acc : Math.max(acc, numero)
  }, 0)
  return `adj-${facturaId.replace(/^fpr-/, '')}-${mayor + 1}`
}


interface LineaSemilla {
  descripcion: string
  cantidad: string
  precioUnitario: string
  tarifa: IdTarifaIva
  cuenta: string
  /** Activo que nació de esta línea, si se capitalizó. */
  activoId?: string
}

interface FacturaSemilla {
  id: string
  folioProveedor: string
  folioInterno: string
  proveedorId: string
  fechaEmision: string
  fechaVencimiento: string
  /**
   * Lo que ya se le pagó, en la moneda del documento.
   *
   * Sale de los pagos que trae la demo (`PAGOS` más abajo) y se escribe aquí
   * porque el saldo de la factura es el dato que se guarda, no uno derivado:
   * el backend tampoco recorre los pagos para saber cuánto debe una factura.
   */
  pagado?: string
  lineas: LineaSemilla[]
}

const FACTURAS: FacturaSemilla[] = [
  {
    id: 'fpr-4521',
    folioProveedor: '4521',
    folioInterno: 'CXP-000045',
    proveedorId: 'pro-014',
    fechaEmision: '2026-07-20',
    fechaVencimiento: '2026-08-19',
    // Saldada por el pago PAG-000231 del 4 de agosto.
    pagado: '508500.00',
    lineas: [
      {
        descripcion: 'Servicios contables de julio',
        cantidad: '1',
        precioUnitario: '450000',
        tarifa: 'GENERAL',
        cuenta: '6.1.02.003',
      },
    ],
  },
  {
    id: 'fpr-7788',
    folioProveedor: '7788',
    folioInterno: 'CXP-000046',
    proveedorId: 'pro-021',
    fechaEmision: '2026-08-10',
    fechaVencimiento: '2026-08-25',
    lineas: [
      {
        descripcion: 'Papelería y útiles de oficina',
        cantidad: '1',
        precioUnitario: '180000',
        tarifa: 'GENERAL',
        cuenta: '6.1.02.004',
      },
    ],
  },
  {
    // Sin `activoId`: la compra se registró y nadie dio de alta el activo. Es
    // la que aparece en las altas pendientes del módulo de activos.
    id: 'fpr-8010',
    folioProveedor: '8010',
    folioInterno: 'CXP-000048',
    proveedorId: 'pro-021',
    fechaEmision: '2026-08-14',
    fechaVencimiento: '2026-08-29',
    lineas: [
      {
        descripcion: 'Vehículo de reparto',
        cantidad: '1',
        precioUnitario: '6000000',
        tarifa: 'GENERAL',
        cuenta: '1.2.01.003',
      },
    ],
  },
  {
    id: 'fpr-9001',
    folioProveedor: '9001',
    folioInterno: 'CXP-000047',
    proveedorId: 'pro-033',
    fechaEmision: '2026-08-12',
    fechaVencimiento: '2026-09-11',
    lineas: [
      {
        descripcion: 'Servidor de aplicaciones Dell PowerEdge',
        cantidad: '1',
        precioUnitario: '2400000',
        tarifa: 'GENERAL',
        // Cuenta de activo fijo: la línea se capitalizó y creó el activo.
        cuenta: '1.2.01.002',
        activoId: 'act-030',
      },
    ],
  },
]

function construir(semilla: FacturaSemilla): FacturaCompra {
  const proveedor = proveedoresMock.find((p) => p.id === semilla.proveedorId)!
  const moneda = proveedor.moneda
  const resolver = resolutorImpuestos(semilla.fechaEmision)

  const lineas: LineaFacturaCompra[] = semilla.lineas.map((l, i) => {
    const calculada = calcularImpuestoLinea(
      {
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        tarifa: l.tarifa,
      },
      moneda,
      resolver,
    )
    return {
      id: `${semilla.id}-l${i + 1}`,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      descuento: '0.00',
      tarifa: l.tarifa,
      cuenta: l.cuenta,
      base: calculada.base.toApi(),
      impuesto: calculada.impuesto.toApi(),
      total: calculada.total.toApi(),
      activoId: l.activoId ?? null,
    }
  })

  const suma = (campo: 'base' | 'impuesto' | 'total') =>
    lineas.reduce((acc, l) => acc.plus(new Decimal(l[campo])), new Decimal(0))

  const subtotal = suma('base')
  const retencion = subtotal
    .times(new Decimal(proveedor.retencionRenta).dividedBy(100))
    .toDecimalPlaces(2)
  const total = suma('total')
  const porPagar = total.minus(retencion)
  const saldo = porPagar.minus(new Decimal(semilla.pagado ?? '0'))
  const estado: EstadoDocumento = saldo.lessThanOrEqualTo(0)
    ? 'pagada'
    : 'contabilizada'

  return {
    id: semilla.id,
    folioProveedor: semilla.folioProveedor,
    folioInterno: semilla.folioInterno,
    proveedorId: proveedor.id,
    proveedorNombre: proveedor.razonSocial,
    fechaEmision: semilla.fechaEmision,
    fechaVencimiento: semilla.fechaVencimiento,
    moneda,
    tipoCambio: '1.00',
    lineas,
    subtotal: subtotal.toFixed(2),
    descuentos: '0.00',
    impuesto: suma('impuesto').toFixed(2),
    retencion: retencion.toFixed(2),
    total: total.toFixed(2),
    saldo: Decimal.max(saldo, 0).toFixed(2),
    estado,
    asientoId: asientoDeOrigen('cxp', 'factura', semilla.id),
    creadoEn: `${semilla.fechaEmision}T11:00:00Z`,
    adjuntos: ADJUNTOS_SEED.filter((a) => a.facturaId === semilla.id).map(
      metadatosDeAdjunto,
    ),
  }
}

const tablaFacturasCompra = tabla<FacturaCompra>(
  'cxp.facturas',
  segunEmpresa({ [EMPRESA_PRINCIPAL]: () => FACTURAS.map(construir) }),
)

export const facturasCompraMock: FacturaCompra[] = tablaFacturasCompra.filas

export function persistirFacturasCompra(): void {
  tablaFacturasCompra.persistir()
}

/** Folio interno consecutivo. El del proveedor lo trae su documento. */
export function siguienteFolioInterno(): string {
  const mayor = facturasCompraMock.reduce((acc, f) => {
    const numero = Number(f.folioInterno.replace(/\D/g, ''))
    return Number.isNaN(numero) ? acc : Math.max(acc, numero)
  }, 0)
  return `CXP-${String(mayor + 1).padStart(6, '0')}`
}


/* ------------------------------------------------------------------ Pagos */

/**
 * Pagos de la demo.
 *
 * Es uno solo, y no por comodidad: la semilla de pagos tiene que ser
 * exactamente el reverso de los asientos de pago que ya están en el mayor
 * (`seed/asientos.ts`), porque el auxiliar del proveedor y la cuenta de control
 * cuentan el mismo hecho. El mayor de la demo trae un único asiento con origen
 * `(cxp, pago, pag-231)`, por 508 500 contra la cuenta bancaria y contra
 * Proveedores, así que aquí hay un único pago y salda la factura 4521 entera.
 *
 * Sembrar además un pago parcial exigiría añadir su asiento al mayor, y eso
 * movería el saldo de la cuenta de control sin que nadie lo pidiera. El caso
 * parcial se recorre en `src/test/pagos.test.tsx`, que lo registra por la API
 * como lo hará el usuario.
 */
interface AplicacionSemilla {
  facturaId: string
  importe: string
}

interface PagoSemilla {
  id: string
  folio: string
  proveedorId: string
  fecha: string
  cuentaSalida: string
  /** Ficha del catálogo de bancos con la que vive en el mayor (docs/06 §1). */
  auxiliarBanco: string | null
  medioPago: MedioPago
  referencia: string | null
  aplicaciones: AplicacionSemilla[]
}

const PAGOS: PagoSemilla[] = [
  {
    id: 'pag-231',
    folio: 'PAG-000231',
    proveedorId: 'pro-014',
    fecha: '2026-08-04',
    cuentaSalida: '1.1.01.010',
    auxiliarBanco: 'bco-001',
    medioPago: 'transferencia',
    referencia: 'TRF-88214',
    aplicaciones: [{ facturaId: 'fpr-4521', importe: '508500.00' }],
  },
]

function construirPago(semilla: PagoSemilla): Pago {
  const proveedor = proveedoresMock.find((p) => p.id === semilla.proveedorId)!

  const aplicaciones: AplicacionPago[] = semilla.aplicaciones.map((a) => {
    const factura = facturasCompraMock.find((f) => f.id === a.facturaId)!
    // La factura de la demo recibe un solo pago, así que el saldo que tenía
    // antes es el que le queda más lo que este pago le aplicó. Con dos pagos
    // sobre la misma factura habría que ordenarlos por fecha; no hace falta
    // complicar la semilla para un caso que no trae.
    const saldoAnterior = new Decimal(factura.saldo).plus(new Decimal(a.importe))
    return {
      facturaId: factura.id,
      folioProveedor: factura.folioProveedor,
      folioInterno: factura.folioInterno,
      fechaVencimiento: factura.fechaVencimiento,
      tipoCambioFactura: factura.tipoCambio,
      importe: new Decimal(a.importe).toFixed(2),
      saldoAnterior: saldoAnterior.toFixed(2),
      saldoResultante: factura.saldo,
      // Todo en moneda funcional y al mismo tipo de cambio: sin diferencia.
      diferenciaCambiaria: '0.00',
    }
  })

  const aplicado = aplicaciones.reduce(
    (acc, a) => acc.plus(new Decimal(a.importe)),
    new Decimal(0),
  )

  return {
    id: semilla.id,
    folio: semilla.folio,
    proveedorId: proveedor.id,
    proveedorNombre: proveedor.razonSocial,
    fecha: semilla.fecha,
    moneda: proveedor.moneda,
    tipoCambio: '1.00',
    cuentaSalida: semilla.cuentaSalida,
    auxiliarBanco: semilla.auxiliarBanco,
    medioPago: semilla.medioPago,
    referencia: semilla.referencia,
    importe: aplicado.toFixed(2),
    aplicado: aplicado.toFixed(2),
    anticipo: '0.00',
    aplicaciones,
    diferenciaCambiaria: '0.00',
    estado: 'emitido',
    asientoId: asientoDeOrigen('cxp', 'pago', semilla.id),
    creadoEn: `${semilla.fecha}T15:30:00Z`,
    anuladoEn: null,
    motivoAnulacion: null,
    asientoAnulacionId: null,
  }
}

const tablaPagos = tabla<Pago>(
  'cxp.pagos',
  segunEmpresa({ [EMPRESA_PRINCIPAL]: () => PAGOS.map(construirPago) }),
)

export const pagosCompraMock: Pago[] = tablaPagos.filas

export function persistirPagos(): void {
  tablaPagos.persistir()
}

/**
 * Consecutivo del pago. Propio del documento, no compartido con las facturas:
 * son dos series distintas y así lo espera quien busca un pago por su folio.
 */
export function siguienteFolioPago(): { id: string; folio: string } {
  const mayor = pagosCompraMock.reduce((acc, p) => {
    const numero = Number(p.folio.replace(/\D/g, ''))
    return Number.isNaN(numero) ? acc : Math.max(acc, numero)
  }, 0)
  const numero = mayor + 1
  return {
    id: `pag-${numero}`,
    folio: `PAG-${String(numero).padStart(6, '0')}`,
  }
}
