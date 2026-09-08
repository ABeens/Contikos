import Decimal from 'decimal.js'
import type { IdTarifaIva } from '@/shared/fiscal/iva'
import { calcularImpuestoLinea } from '@/shared/fiscal/iva'
import {
  descomponerConsecutivo,
  formatearConsecutivoHacienda,
  formatearNumeroInterno,
  TIPO_DOCUMENTO_HACIENDA,
} from '@/shared/fiscal/comprobante'
import type {
  AplicacionCobro,
  ClienteBase,
  Cobro,
  FacturaVenta,
  ItemCatalogo,
  LineaFacturaVenta,
  MapeoCxc,
} from '@/shared/api/contracts/cxc'
import type { EstadoDocumento } from '@/shared/api/contracts/comunes'
import type { MedioPago } from '@/shared/api/contracts/terceros'
import { tabla } from '@/shared/almacen/almacen'
import {
  EMPRESA_PRINCIPAL,
  EMPRESA_SECUNDARIA,
  segunEmpresa,
} from './empresas'
import { asientoDeOrigen } from './asientos'
import { resolutorImpuestos } from './impuestos'

/**
 * Clientes y facturas de la empresa demo.
 *
 * Los documentos son los mismos que ya están contabilizados en el mayor
 * (`seed/asientos.ts`): las facturas de aquí y sus asientos de allá son el
 * mismo hecho visto desde los dos lados. Es lo que permite que la antigüedad de
 * saldos cuadre contra la cuenta de control, que es la verificación de
 * integridad del módulo (docs/04 §3).
 */

/** Mapeo contable del módulo (docs/02 §5). Es configuración, no código. */
export const MAPEO_CXC: MapeoCxc = {
  cliente: '1.1.02.001',
  ingreso: '4.1.01.001',
  impuestoTrasladado: '2.1.02.001',
  // Cobro (docs/04 §5). El depósito por defecto es la cuenta bancaria en
  // colones, que es por donde entra casi todo; el cobro puede cambiarla.
  deposito: '1.1.01.010',
  anticipo: '2.1.04.001',
  diferenciaCambiariaGanada: '4.2.01.001',
  diferenciaCambiariaPerdida: '6.2.01.002',
}

/**
 * Datos de facturación electrónica del receptor (docs/13 §4).
 *
 * Los tres primeros clientes van completos: son los que se podrán facturar
 * electrónicamente. Al cuarto le falta todo, a propósito, para que la lista
 * enseñe la marca de "falta completar".
 */
const CLIENTES_SEED: readonly ClienteBase[] = [
  {
    id: 'cli-001',
    codigo: 'C-001',
    razonSocial: 'Inversiones Tecnológicas del Valle S.A.',
    nombreComercial: 'Valle Tech',
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101456789',
    correo: 'pagos@valletech.cr',
    diasCredito: 30,
    limiteCredito: '15000000.00',
    moneda: 'CRC',
    cuentaIngreso: null,
    activo: true,
    telefono: { codigoPais: '506', numero: '22015500' },
    ubicacion: {
      provincia: '1',
      canton: '09',
      distrito: '03',
      barrio: 'Lindora',
      otrasSenas: 'Centro Corporativo Lindora, torre B, piso 4',
    },
    // Programación informática y consultoría (CIIU 6201).
    actividadEconomica: '620100',
    condicionVenta: '02',
    medioPago: '04',
  },
  {
    id: 'cli-002',
    codigo: 'C-002',
    razonSocial: 'Comercial La Sabana S.A.',
    nombreComercial: null,
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101223344',
    correo: 'compras@lasabana.cr',
    diasCredito: 30,
    limiteCredito: '8000000.00',
    moneda: 'CRC',
    // Vende mercancía, no servicios: su ingreso va a otra cuenta que la del
    // mapeo general. Es el caso que justifica el override de docs/04 §1.
    cuentaIngreso: '4.1.01.002',
    activo: true,
    telefono: { codigoPais: '506', numero: '22322323' },
    ubicacion: {
      provincia: '1',
      canton: '01',
      distrito: '02',
      barrio: null,
      otrasSenas: 'Sabana Sur, 300 m este de la Contraloría',
    },
    // Venta al por mayor de otros productos (CIIU 4690).
    actividadEconomica: '469000',
    condicionVenta: '02',
    medioPago: '04',
  },
  {
    id: 'cli-003',
    codigo: 'C-003',
    razonSocial: 'Servicios Médicos Escazú S.A.',
    nombreComercial: 'Clínica Escazú',
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101778899',
    correo: 'administracion@clinicaescazu.cr',
    diasCredito: 30,
    limiteCredito: '5000000.00',
    moneda: 'CRC',
    cuentaIngreso: null,
    activo: true,
    telefono: { codigoPais: '506', numero: '22889900' },
    ubicacion: {
      provincia: '1',
      canton: '02',
      distrito: '02',
      barrio: null,
      otrasSenas: 'San Antonio de Escazú, frente al parque',
    },
    // Actividades de médicos y odontólogos (CIIU 8620).
    actividadEconomica: '862000',
    condicionVenta: '02',
    medioPago: '04',
  },
  {
    id: 'cli-004',
    codigo: 'C-004',
    razonSocial: 'Mauricio Vargas Rojas',
    nombreComercial: null,
    tipoIdentificacion: 'FISICA',
    identificacion: '108930456',
    correo: null,
    // Contado: vence el mismo día que se emite y no consume crédito.
    diasCredito: 0,
    limiteCredito: '0.00',
    moneda: 'CRC',
    cuentaIngreso: null,
    activo: true,
    // Sin datos de facturación electrónica: es al que la lista marca como
    // pendiente de completar.
    telefono: null,
    ubicacion: null,
    actividadEconomica: null,
    condicionVenta: '01',
    medioPago: '01',
  },
]

/**
 * Clientes de la segunda empresa del grupo.
 *
 * Comercial La Sabana le compra a las dos empresas: misma cédula, misma razón
 * social, y un código, un límite y una moneda distintos en cada una. Lo que
 * se comparte es quién es; lo que se acordó con él es de cada empresa
 * (docs/12 D-12).
 */
const CLIENTES_PACIFICO_SEED: readonly ClienteBase[] = [
  {
    id: 'cli-001',
    codigo: 'C-001',
    razonSocial: 'Hotel Bahía Ballena S.A.',
    nombreComercial: 'Bahía Ballena Resort',
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101112233',
    correo: 'proveeduria@bahiaballena.cr',
    diasCredito: 30,
    limiteCredito: '10000000.00',
    moneda: 'CRC',
    cuentaIngreso: null,
    activo: true,
    telefono: { codigoPais: '506', numero: '27865000' },
    // Puntarenas: la muestra del catálogo no trae sus cantones, así que va
    // con los códigos oficiales de Osa / Bahía Ballena sin nombre resuelto.
    ubicacion: {
      provincia: '6',
      canton: '05',
      distrito: '04',
      barrio: null,
      otrasSenas: 'Uvita, 500 m sur de la entrada al parque',
    },
    // Actividades de alojamiento para estancias cortas (CIIU 5510).
    actividadEconomica: '551000',
    condicionVenta: '02',
    medioPago: '04',
  },
  {
    id: 'cli-002',
    codigo: 'C-002',
    razonSocial: 'Comercial La Sabana S.A.',
    nombreComercial: null,
    tipoIdentificacion: 'JURIDICA',
    identificacion: '3101223344',
    correo: 'compras@lasabana.cr',
    diasCredito: 15,
    limiteCredito: '3000000.00',
    moneda: 'USD',
    cuentaIngreso: '4.1.01.002',
    activo: true,
    telefono: { codigoPais: '506', numero: '22322323' },
    ubicacion: {
      provincia: '1',
      canton: '01',
      distrito: '02',
      barrio: null,
      otrasSenas: 'Sabana Sur, 300 m este de la Contraloría',
    },
    actividadEconomica: '469000',
    condicionVenta: '02',
    medioPago: '04',
  },
]

/** Nombre de la colección. Lo lee también el directorio de terceros del grupo. */
export const TABLA_CLIENTES = 'cxc.clientes'

/**
 * Los clientes vivos, persistidos.
 *
 * Se declara antes que las facturas porque la semilla de facturas lee de aquí:
 * la factura copia el nombre del cliente en el momento de emitirse.
 */
const tablaClientes = tabla<ClienteBase>(
  TABLA_CLIENTES,
  segunEmpresa({
    [EMPRESA_PRINCIPAL]: () => CLIENTES_SEED.map((c) => ({ ...c })),
    [EMPRESA_SECUNDARIA]: () => CLIENTES_PACIFICO_SEED.map((c) => ({ ...c })),
  }),
)

export const clientesMock: ClienteBase[] = tablaClientes.filas

export function persistirClientes(): void {
  tablaClientes.persistir()
}


/* ------------------------------------ Catálogo de productos y servicios */

/**
 * Lo que la empresa demo vende.
 *
 * Cada item trae ya resuelto lo que si no habría que decidir factura a factura:
 * su cuenta de ingreso y su tarifa. El de salud lleva la reducida del 4% y el
 * de exportación la tarifa 0 (docs/13 §3): son justo los casos en los que quien
 * factura se equivocaría si tuviera que recordarlos.
 */
const ITEMS_SEED: readonly ItemCatalogo[] = [
  {
    id: 'itm-srv-001',
    codigo: 'SRV-001',
    nombre: 'Consultoría en tecnología (hora)',
    descripcion: null,
    tipo: 'servicio',
    precioUnitario: '35000.00',
    moneda: 'CRC',
    tarifa: 'GENERAL',
    cuentaIngreso: '4.1.01.001',
    activo: true,
  },
  {
    id: 'itm-srv-002',
    codigo: 'SRV-002',
    nombre: 'Mantenimiento mensual de sistemas',
    descripcion: 'Mantenimiento preventivo y correctivo, cuota mensual',
    tipo: 'servicio',
    precioUnitario: '250000.00',
    moneda: 'CRC',
    tarifa: 'GENERAL',
    cuentaIngreso: '4.1.01.001',
    activo: true,
  },
  {
    id: 'itm-srv-010',
    codigo: 'SRV-010',
    nombre: 'Consulta médica general',
    descripcion: 'Servicios de salud, consulta general',
    tipo: 'servicio',
    precioUnitario: '25000.00',
    moneda: 'CRC',
    // Salud privada: 4% y no 13%. Es la clase de dato que el catálogo existe
    // para recordar.
    tarifa: 'REDUCIDA_4',
    cuentaIngreso: '4.1.01.001',
    activo: true,
  },
  {
    id: 'itm-srv-020',
    codigo: 'SRV-020',
    nombre: 'Desarrollo de software para el exterior',
    descripcion: 'Servicios de desarrollo exportados',
    tipo: 'servicio',
    // Precio a convenir: cada contrato se cotiza aparte y el cero deja el
    // campo vacío en la factura en lugar de proponer un importe falso.
    precioUnitario: '0.00',
    moneda: 'CRC',
    // Exportación: tarifa 0, que no es lo mismo que exento (docs/13 §3).
    tarifa: 'CERO',
    cuentaIngreso: '4.1.01.001',
    activo: true,
  },
  {
    id: 'itm-srv-030',
    codigo: 'SRV-030',
    nombre: 'Soporte remoto (hora)',
    descripcion: null,
    tipo: 'servicio',
    // Cotizado en dólares: en una factura en colones el precio no se precarga,
    // porque convertirlo daría una tarifa que nadie pactó.
    precioUnitario: '45.00',
    moneda: 'USD',
    tarifa: 'GENERAL',
    cuentaIngreso: '4.1.01.001',
    activo: true,
  },
  {
    id: 'itm-prd-001',
    codigo: 'PRD-001',
    nombre: 'Licencia anual de software',
    descripcion: null,
    tipo: 'producto',
    precioUnitario: '180000.00',
    moneda: 'CRC',
    tarifa: 'GENERAL',
    // Mercancías y no servicios: otra cuenta de ingreso.
    cuentaIngreso: '4.1.01.002',
    activo: true,
  },
  {
    id: 'itm-prd-002',
    codigo: 'PRD-002',
    nombre: 'Cable de red categoría 6 (metro)',
    descripcion: null,
    tipo: 'producto',
    precioUnitario: '3000.00',
    moneda: 'CRC',
    tarifa: 'GENERAL',
    cuentaIngreso: '4.1.01.002',
    activo: true,
  },
]

/** La distribuidora vende fletes, no horas de desarrollo. */
const ITEMS_PACIFICO_SEED: readonly ItemCatalogo[] = [
  {
    id: 'itm-srv-flete',
    codigo: 'SRV-001',
    nombre: 'Flete Golfito a San José',
    descripcion: 'Transporte de mercadería por camión, tarifa por viaje',
    tipo: 'servicio',
    precioUnitario: '85000.00',
    moneda: 'CRC',
    tarifa: 'GENERAL',
    cuentaIngreso: '4.1.01.001',
    activo: true,
  },
]

const tablaItems = tabla<ItemCatalogo>(
  'cxc.items',
  segunEmpresa({
    [EMPRESA_PRINCIPAL]: () => ITEMS_SEED.map((i) => ({ ...i })),
    [EMPRESA_SECUNDARIA]: () => ITEMS_PACIFICO_SEED.map((i) => ({ ...i })),
  }),
)

export const itemsMock: ItemCatalogo[] = tablaItems.filas

export function persistirItems(): void {
  tablaItems.persistir()
}

/** Id estable a partir del código. El código es la llave que se teclea. */
export function siguienteIdItem(codigo: string): string {
  const raiz =
    codigo
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'item'

  let candidato = `itm-${raiz}`
  let sufijo = 2
  while (itemsMock.some((i) => i.id === candidato)) {
    candidato = `itm-${raiz}-${sufijo}`
    sufijo += 1
  }
  return candidato
}


interface LineaSemilla {
  descripcion: string
  cantidad: string
  precioUnitario: string
  tarifa: IdTarifaIva
  cuentaIngreso: string
  /** Item del catálogo del que salió. Ausente = se capturó a mano. */
  itemId?: string
}

/**
 * Casa matriz y terminal desde las que emite la empresa demo (docs/13 §4.2).
 *
 * Constantes por ahora: el día que haya varias sucursales o varios puntos de
 * venta serán configuración de la empresa, y el consecutivo se llevará por
 * terminal. Mientras tanto hay una y el contador es uno.
 */
export const SUCURSAL_EMISORA = '001'
export const TERMINAL_EMISORA = '00001'

/** Prefijo de la serie interna: FV-000123. */
export const PREFIJO_NUMERO_INTERNO = 'FV'

interface FacturaSemilla {
  id: string
  /**
   * Correlativo compartido por el número interno y el consecutivo del
   * comprobante. En la semilla coinciden porque la empresa demo nunca emitió
   * nada fuera del sistema; en una empresa real son dos contadores.
   */
  numero: number
  clienteId: string
  fechaEmision: string
  fechaVencimiento: string
  /**
   * Cobrada = saldo cero.
   *
   * Lo decide la semilla de cobros de más abajo, no un dato suelto: la factura
   * marcada aquí es exactamente la que `COBROS` salda, y su asiento de cobro ya
   * está en el mayor. Si dejaran de coincidir, el auxiliar y la cuenta de
   * control dirían cosas distintas.
   */
  cobrada?: boolean
  lineas: LineaSemilla[]
}

const FACTURAS: FacturaSemilla[] = [
  {
    id: 'fac-114',
    numero: 114,
    clienteId: 'cli-003',
    fechaEmision: '2026-06-20',
    fechaVencimiento: '2026-07-20',
    lineas: [
      {
        descripcion: 'Servicios de salud, consultas de junio',
        cantidad: '1',
        precioUnitario: '800000',
        // Tarifa reducida del 4%: servicios de salud privados (docs/13 §3).
        tarifa: 'REDUCIDA_4',
        cuentaIngreso: '4.1.01.001',
      },
    ],
  },
  {
    id: 'fac-112',
    numero: 112,
    clienteId: 'cli-001',
    fechaEmision: '2026-07-03',
    fechaVencimiento: '2026-08-02',
    cobrada: true,
    lineas: [
      {
        descripcion: 'Servicios de consultoría, julio 2026',
        cantidad: '1',
        precioUnitario: '3000000',
        tarifa: 'GENERAL',
        cuentaIngreso: '4.1.01.001',
      },
    ],
  },
  {
    id: 'fac-113',
    numero: 113,
    clienteId: 'cli-002',
    fechaEmision: '2026-08-05',
    fechaVencimiento: '2026-09-04',
    lineas: [
      {
        descripcion: 'Venta de mercancías, pedido 4471',
        cantidad: '400',
        precioUnitario: '3000',
        tarifa: 'GENERAL',
        cuentaIngreso: '4.1.01.002',
        // Salió del catálogo: la línea conserva de qué item, y con él la
        // trazabilidad de qué se vendió y no solo cuánto.
        itemId: 'itm-prd-002',
      },
    ],
  },
]

function construir(semilla: FacturaSemilla): FacturaVenta {
  const cliente = clientesMock.find((c) => c.id === semilla.clienteId)!
  const moneda = cliente.moneda
  // La tarifa se resuelve por la fecha de emisión, como hará el servidor.
  const resolver = resolutorImpuestos(semilla.fechaEmision)

  const lineas: LineaFacturaVenta[] = semilla.lineas.map((l, i) => {
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
      itemId: l.itemId ?? null,
      itemCodigo: itemsMock.find((it) => it.id === l.itemId)?.codigo ?? null,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      descuento: '0.00',
      tarifa: l.tarifa,
      cuentaIngreso: l.cuentaIngreso,
      base: calculada.base.toApi(),
      impuesto: calculada.impuesto.toApi(),
      total: calculada.total.toApi(),
    }
  })

  const suma = (campo: 'base' | 'impuesto' | 'total') =>
    lineas
      .reduce((acc, l) => acc.plus(new Decimal(l[campo])), new Decimal(0))
      .toFixed(2)

  const total = suma('total')
  const estado: EstadoDocumento = semilla.cobrada ? 'pagada' : 'contabilizada'

  return {
    id: semilla.id,
    numeroInterno: formatearNumeroInterno(PREFIJO_NUMERO_INTERNO, semilla.numero),
    consecutivo: formatearConsecutivoHacienda(
      SUCURSAL_EMISORA,
      TERMINAL_EMISORA,
      TIPO_DOCUMENTO_HACIENDA.FE,
      semilla.numero,
    ),
    claveNumerica: null,
    clienteId: cliente.id,
    clienteNombre: cliente.razonSocial,
    fechaEmision: semilla.fechaEmision,
    fechaVencimiento: semilla.fechaVencimiento,
    moneda,
    tipoCambio: '1.00',
    lineas,
    subtotal: suma('base'),
    descuentos: '0.00',
    impuesto: suma('impuesto'),
    total,
    saldo: semilla.cobrada ? '0.00' : total,
    estado,
    asientoId: asientoDeOrigen('cxc', 'factura', semilla.id),
    creadoEn: `${semilla.fechaEmision}T10:00:00Z`,
  }
}

const tablaFacturasVenta = tabla<FacturaVenta>(
  'cxc.facturas',
  segunEmpresa({ [EMPRESA_PRINCIPAL]: () => FACTURAS.map(construir) }),
)

export const facturasVentaMock: FacturaVenta[] = tablaFacturasVenta.filas

export function persistirFacturasVenta(): void {
  tablaFacturasVenta.persistir()
}

/**
 * Siguiente número interno: FV-000115.
 *
 * A partir del mayor emitido y no del tamaño de la colección: la colección
 * persiste y un día tendrá huecos por anulaciones.
 */
export function siguienteNumeroInterno(): string {
  const mayor = facturasVentaMock.reduce((acc, f) => {
    const numero = Number(f.numeroInterno.replace(/\D/g, ''))
    return Number.isNaN(numero) ? acc : Math.max(acc, numero)
  }, 0)
  return formatearNumeroInterno(PREFIJO_NUMERO_INTERNO, mayor + 1)
}

/**
 * Siguiente consecutivo del comprobante electrónico (docs/13 §4.2).
 *
 * Contador independiente del interno y por terminal: solo cuentan los
 * comprobantes emitidos desde esta casa matriz y esta terminal, con este
 * tipo de documento.
 */
export function siguienteConsecutivoComprobante(
  tipoDoc: string = TIPO_DOCUMENTO_HACIENDA.FE,
): string {
  const mayor = facturasVentaMock.reduce((acc, f) => {
    const partes = descomponerConsecutivo(f.consecutivo)
    if (
      !partes ||
      partes.sucursal !== SUCURSAL_EMISORA ||
      partes.terminal !== TERMINAL_EMISORA ||
      partes.tipoDoc !== tipoDoc
    ) {
      return acc
    }
    return Math.max(acc, partes.numero)
  }, 0)
  return formatearConsecutivoHacienda(
    SUCURSAL_EMISORA,
    TERMINAL_EMISORA,
    tipoDoc,
    mayor + 1,
  )
}

/* ----------------------------------------------------------------- Cobros */

/** Prefijo del consecutivo propio del cobro: COB-000089. */
export const PREFIJO_NUMERO_COBRO = 'COB'

interface CobroSemilla {
  id: string
  numero: number
  clienteId: string
  fecha: string
  medio: MedioPago
  referencia: string | null
  cuentaDeposito: string
  /** Solo cuando la cuenta de depósito es bancaria (ver el contrato). */
  auxiliarBanco: string | null
  /** Facturas que salda por completo. */
  aplicaA: string[]
}

/**
 * Cobros de la empresa demo.
 *
 * Es uno solo, y no por comodidad: la semilla de cobros tiene que ser
 * exactamente el reverso de los asientos de cobro que ya están en el mayor
 * (`seed/asientos.ts`), porque el auxiliar y la cuenta de control cuentan el
 * mismo hecho. El mayor de la demo trae un único asiento con origen
 * `(cxc, cobro, cob-088)`, por 3 390 000 contra la cuenta bancaria y contra
 * Clientes, así que aquí hay un único cobro y salda FE-00000112 entera.
 *
 * Sembrar además un cobro parcial exigiría añadir su asiento al mayor, y eso
 * movería el saldo de la cuenta de control sin que nadie lo pidiera. El caso
 * parcial se recorre en `src/test/cobros.test.tsx`, que lo registra por la API
 * como lo hará el usuario.
 */
const COBROS: CobroSemilla[] = [
  {
    id: 'cob-088',
    numero: 88,
    clienteId: 'cli-001',
    fecha: '2026-07-15',
    // Transferencia, según el catálogo de medios de pago de Hacienda.
    medio: '04',
    referencia: 'TRF-4471209',
    cuentaDeposito: '1.1.01.010',
    auxiliarBanco: 'bco-001',
    aplicaA: ['fac-112'],
  },
]

function construirCobro(semilla: CobroSemilla): Cobro {
  const cliente = clientesMock.find((c) => c.id === semilla.clienteId)!
  const facturas = semilla.aplicaA.map(
    (id) => facturasVentaMock.find((f) => f.id === id)!,
  )

  const aplicaciones: AplicacionCobro[] = facturas.map((factura) => ({
    facturaId: factura.id,
    facturaNumero: factura.numeroInterno,
    // La semilla salda: lo aplicado es el total de la factura y no queda nada.
    importeAplicado: factura.total,
    saldoResultante: '0.00',
    tipoCambioFactura: factura.tipoCambio,
    // Mismo tipo de cambio que la factura: no hay diferencia que reconocer.
    diferenciaCambiaria: '0.00',
  }))

  const total = aplicaciones
    .reduce((acc, a) => acc.plus(new Decimal(a.importeAplicado)), new Decimal(0))
    .toFixed(2)

  return {
    id: semilla.id,
    numero: formatearNumeroInterno(PREFIJO_NUMERO_COBRO, semilla.numero),
    clienteId: cliente.id,
    clienteNombre: cliente.razonSocial,
    fecha: semilla.fecha,
    moneda: cliente.moneda,
    tipoCambio: '1.00',
    medio: semilla.medio,
    referencia: semilla.referencia,
    cuentaDeposito: semilla.cuentaDeposito,
    auxiliarBanco: semilla.auxiliarBanco,
    importeRecibido: total,
    aplicaciones,
    importeAplicado: total,
    importeSinAplicar: '0.00',
    abonoClientesFuncional: total,
    diferenciaCambiaria: '0.00',
    estado: 'contabilizado',
    asientoId: asientoDeOrigen('cxc', 'cobro', semilla.id),
    asientoReversaId: null,
    anuladoEn: null,
    motivoAnulacion: null,
    creadoEn: `${semilla.fecha}T11:00:00Z`,
  }
}

const tablaCobros = tabla<Cobro>(
  'cxc.cobros',
  segunEmpresa({ [EMPRESA_PRINCIPAL]: () => COBROS.map(construirCobro) }),
)

export const cobrosMock: Cobro[] = tablaCobros.filas

export function persistirCobros(): void {
  tablaCobros.persistir()
}

/**
 * Siguiente consecutivo de cobro: COB-000089.
 *
 * Contador propio, independiente del de facturas (docs/04 §1: el cobro tiene
 * su propio folio). Sale del mayor ya emitido y no del tamaño de la colección,
 * por la misma razón que el de facturas: la colección tendrá huecos.
 */
export function siguienteNumeroCobro(): string {
  const mayor = cobrosMock.reduce((acc, c) => {
    const numero = Number(c.numero.replace(/\D/g, ''))
    return Number.isNaN(numero) ? acc : Math.max(acc, numero)
  }, 0)
  return formatearNumeroInterno(PREFIJO_NUMERO_COBRO, mayor + 1)
}

/** El id sale del consecutivo: es el que nunca cambia. */
export function idDeNumeroCobro(numero: string): string {
  return `cob-${String(Number(numero.replace(/\D/g, ''))).padStart(3, '0')}`
}
