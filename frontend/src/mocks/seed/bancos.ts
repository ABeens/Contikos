import Decimal from 'decimal.js'
import type {
  Conciliacion,
  CuentaBancariaBase,
  MapeoBancos,
  MovimientoBancario,
  MovimientoEstadoCuenta,
  TipoMovimientoBancario,
} from '@/shared/api/contracts/bancos'
import type { Asiento, LineaAsiento } from '@/shared/api/contracts/conta'
import { tabla } from '@/shared/almacen/almacen'
import { EMPRESA_PRINCIPAL, segunEmpresa } from './empresas'
import { ASIENTOS } from './asientos'
import { cobrosMock } from './cxc'
import { pagosCompraMock } from './cxp'

/**
 * Tesorería de la empresa demo (docs/06).
 *
 * Las dos cuentas bancarias son las que el catálogo de cuentas ya traía como
 * cuentas de control de `bancos`: `1.1.01.010` en colones y `1.1.01.011` en
 * dólares. Sus identificadores, `bco-001` y `bco-002`, no son nuevos: son los
 * que el mayor de la demostración ya usaba como auxiliar antes de que este
 * catálogo existiera, y los que cobros y pagos derivaban de la posición de la
 * cuenta en el plan. Conservarlos es lo que hace que el módulo nazca cuadrado
 * contra el mayor que ya está escrito.
 *
 * **Los movimientos no se escriben a mano: se derivan del mayor.** Es la única
 * forma de que el auxiliar de bancos y el libro digan lo mismo desde el primer
 * arranque, que es justo la verificación de integridad de docs/06 §4. Cada
 * línea de asiento con auxiliar `banco` es un movimiento propio, y su importe
 * con signo es el cargo menos el abono de esa línea.
 *
 * Esa derivación funciona porque todo el mayor de la demostración está en
 * colones y las líneas bancarias que trae son de la cuenta en colones: el
 * importe del mayor y el de la cuenta bancaria son el mismo número. Con una
 * cuenta en dólares habría que dividir por el tipo de cambio del asiento, y por
 * eso los movimientos que nazcan de aquí en adelante guardan su importe en la
 * moneda de la cuenta y no en la del libro.
 */

/**
 * Cuentas de los roles que mueve el módulo (docs/06 §5).
 *
 * Es un dato de la empresa y vive con los demás datos de la empresa, igual que
 * el mapeo de CxC y el de CxP. Los cinco códigos existen en el catálogo de
 * plantilla y son de detalle: es lo que la validación comprueba antes de emitir
 * cualquier asiento.
 *
 * El rol `banco` no está: no es una cuenta fija de configuración, sino la
 * cuenta de control de cada cuenta bancaria, que vive en su propia ficha.
 */
export const MAPEO_BANCOS: MapeoBancos = {
  comision: '6.2.01.001',
  impuestoAcreditable: '1.1.03.001',
  interesGanado: '4.2.01.002',
  diferencialGanado: '4.2.01.001',
  diferencialPerdido: '6.2.01.002',
}

const construirCuentas = (): CuentaBancariaBase[] => [
  {
    id: 'bco-001',
    codigo: 'BCO-001',
    banco: 'Banco Nacional de Costa Rica',
    nombre: 'BN, corriente colones',
    numeroCuenta: '100-01-000-123456-7',
    iban: 'CR05015100010012345678',
    tipo: 'cheques',
    moneda: 'CRC',
    cuentaContable: '1.1.01.010',
    // Nace sin estado de cuenta importado: el saldo del banco no es un dato
    // que la empresa pueda inventar, y hasta que se importe uno la
    // conciliación no tiene contra qué cruzar.
    saldoBanco: null,
    saldoBancoAl: null,
    activa: true,
  },
  {
    id: 'bco-002',
    codigo: 'BCO-002',
    banco: 'BAC San José',
    nombre: 'BAC, corriente dólares',
    numeroCuenta: '900-22-334455',
    iban: 'CR21010200009003344556',
    tipo: 'cheques',
    moneda: 'USD',
    cuentaContable: '1.1.01.011',
    saldoBanco: null,
    saldoBancoAl: null,
    activa: true,
  },
]

/**
 * Qué clase de movimiento es, leído del origen del asiento que lo escribió.
 *
 * Cuando el asiento no tiene origen (una captura manual antigua) solo queda el
 * signo, que distingue lo que entró de lo que salió y no se equivoca aunque no
 * sepa por qué.
 */
function tipoDeMovimiento(
  asiento: Asiento,
  importe: Decimal,
): TipoMovimientoBancario {
  if (asiento.origenModulo === 'cxc' && asiento.origenTipo === 'cobro') {
    return 'deposito'
  }
  if (asiento.origenModulo === 'cxp' && asiento.origenTipo === 'pago') {
    return 'retiro'
  }
  if (asiento.origenModulo === 'bancos') {
    if (asiento.origenTipo === 'comision') return 'comision'
    if (asiento.origenTipo === 'interes') return 'interes'
    if (asiento.origenTipo === 'traspaso') return 'transferencia'
  }
  return importe.isNegative() ? 'retiro' : 'deposito'
}

/**
 * Referencia del documento que originó el movimiento.
 *
 * El número de transferencia o de cheque no está en el asiento: está en el
 * documento que lo emitió. Se copia aquí porque es lo que el banco imprime en
 * su estado de cuenta, y por lo tanto lo que la primera regla del motor de
 * emparejamiento compara (docs/06 §2.3). Sin ella, todo se tendría que casar
 * por importe y fecha, que es una regla más floja.
 */
function referenciaDeOrigen(asiento: Asiento): string | null {
  if (asiento.origenModulo === 'cxc' && asiento.origenTipo === 'cobro') {
    return cobrosMock.find((c) => c.id === asiento.origenId)?.referencia ?? null
  }
  if (asiento.origenModulo === 'cxp' && asiento.origenTipo === 'pago') {
    return (
      pagosCompraMock.find((p) => p.id === asiento.origenId)?.referencia ?? null
    )
  }
  return null
}

function lineasBancarias(asiento: Asiento): LineaAsiento[] {
  return asiento.lineas.filter(
    (l) => l.auxiliarTipo === 'banco' && l.auxiliarId !== null,
  )
}

const construirMovimientos = (): MovimientoBancario[] => {
  const movimientos: MovimientoBancario[] = []
  let secuencia = 0

  const consecutivo = () => {
    secuencia += 1
    return `mov-${String(secuencia).padStart(5, '0')}`
  }

  for (const asiento of [...ASIENTOS].sort((a, b) =>
    a.fecha.localeCompare(b.fecha),
  )) {
    for (const linea of lineasBancarias(asiento)) {
      const importe = new Decimal(linea.cargo).minus(linea.abono)

      /*
       * El identificador del movimiento es un consecutivo propio y no el de la
       * terna de origen del asiento. Lo que hace idempotente la recepción de un
       * evento es la terna, que se copia entera unas líneas más abajo: quien
       * pregunte si el cobro `cob-088` ya se registró lo hace por ahí, no por
       * el nombre del movimiento.
       */
      movimientos.push({
        id: consecutivo(),
        cuentaBancariaId: linea.auxiliarId!,
        fecha: asiento.fecha,
        tipo: tipoDeMovimiento(asiento, importe),
        concepto: linea.concepto || asiento.concepto,
        referencia: referenciaDeOrigen(asiento),
        importe: importe.toFixed(2),
        origen:
          asiento.origenModulo && asiento.origenTipo && asiento.origenId
            ? {
                modulo: asiento.origenModulo,
                tipo: asiento.origenTipo,
                id: asiento.origenId,
              }
            : null,
        // Nacen sin conciliar, que es la verdad: nadie ha cruzado todavía este
        // auxiliar contra un estado de cuenta del banco.
        estado: 'registrado',
        asientoId: asiento.id,
        conciliacionId: null,
        creadoEn: `${asiento.fecha}T09:00:00Z`,
      })
    }
  }

  return movimientos
}

const tablaCuentas = tabla<CuentaBancariaBase>(
  'bancos.cuentas',
  // Toda empresa nace con su tesorería vacía: una cuenta bancaria es un dato
  // de la empresa, no una plantilla que se pueda copiar como el catálogo de
  // cuentas. La demo principal es la única que trae las suyas.
  segunEmpresa({ [EMPRESA_PRINCIPAL]: construirCuentas }),
)

const tablaMovimientos = tabla<MovimientoBancario>(
  'bancos.movimientos',
  segunEmpresa({ [EMPRESA_PRINCIPAL]: construirMovimientos }),
)

export const cuentasBancariasMock: CuentaBancariaBase[] = tablaCuentas.filas
export const movimientosBancariosMock: MovimientoBancario[] =
  tablaMovimientos.filas

export function persistirCuentasBancarias(): void {
  tablaCuentas.persistir()
}

export function persistirMovimientosBancarios(): void {
  tablaMovimientos.persistir()
}

/* ------------------------------------------------ Estado de cuenta */

/**
 * Las dos colecciones de la conciliación, vacías de fábrica.
 *
 * El estado de cuenta no se siembra a propósito: es lo que dice el banco, y la
 * empresa no puede inventarlo. Nace vacío y se llena importando un archivo,
 * que es exactamente lo que pasa el primer día de uso (docs/06 §2.2).
 */
const tablaEstadoCuenta = tabla<MovimientoEstadoCuenta>(
  'bancos.estado-cuenta',
  () => [],
)

const tablaConciliaciones = tabla<Conciliacion>('bancos.conciliaciones', () => [])

export const estadoCuentaMock: MovimientoEstadoCuenta[] = tablaEstadoCuenta.filas
export const conciliacionesMock: Conciliacion[] = tablaConciliaciones.filas

export function persistirEstadoCuenta(): void {
  tablaEstadoCuenta.persistir()
}

export function persistirConciliaciones(): void {
  tablaConciliaciones.persistir()
}

/**
 * Estado de cuenta de demostración, en CSV.
 *
 * No se importa solo: se ofrece en la pantalla de importación para poder
 * recorrer la conciliación entera sin tener a mano un archivo del banco, y va
 * marcado como dato de demostración igual que la plantilla de tipos de cambio.
 *
 * Está construido para que se vea cada rama del motor de emparejamiento
 * (docs/06 §2.3):
 *
 * - El cobro de julio trae la misma referencia que el movimiento propio: lo
 *   casa la regla 1, que es la única que no se equivoca casi nunca.
 * - El pago de agosto llega al banco un día después de emitirse, y su
 *   referencia no viaja en el estado de cuenta: lo casa la regla 2, la de la
 *   ventana de días.
 * - La comisión no trae referencia y llega el mismo día: la casa la regla 2
 *   por importe y fecha.
 * - Y hay un cargo por servicio que la empresa NO registró. Ese no se empareja
 *   con nada, y es el que impide cerrar hasta capturarlo y contabilizarlo, que
 *   es justo lo que la conciliación existe para descubrir.
 */
export const EJEMPLO_ESTADO_CUENTA = [
  'Fecha;Fecha valor;Descripcion;Referencia;Debito;Credito;Saldo',
  '15/07/2026;15/07/2026;TRANSFERENCIA RECIBIDA;TRF-4471209;;3.390.000,00;3.390.000,00',
  '05/08/2026;05/08/2026;TRANSFERENCIA EMITIDA A PROVEEDOR;;508.500,00;;2.881.500,00',
  '05/08/2026;05/08/2026;COMISION MANEJO DE CUENTA;;14.125,00;;2.867.375,00',
  '31/08/2026;31/08/2026;SERVICIO DE BANCA EN LINEA;;5.650,00;;2.861.725,00',
].join('\n')
