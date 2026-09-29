import Decimal from 'decimal.js'
import type { Libro } from '@/shared/api/contracts/comunes'
import type {
  Asiento,
  Balanza,
  Cuenta,
  LineaAsiento,
} from '@/shared/api/contracts/conta'
import { lineaAfecta } from '@/shared/asiento/libro'
import { CERO, aTexto } from './saldos'

/**
 * Libro diario, libro mayor y comparativo entre las dos contabilidades
 * (docs/09 §4 y §3).
 *
 * Los tres leen asientos y saldos tal como los entrega `conta`. El diario y el
 * mayor son la misma información ordenada de dos formas: por fecha, o por
 * cuenta. Los dos son de UN libro, igual que la balanza: una línea marcada solo
 * como corporativa no existe en el diario fiscal.
 */

/* ------------------------------------------------------------ Libro diario */

export interface AsientoDiario {
  readonly id: string
  readonly codigo: string
  readonly fecha: string
  readonly concepto: string
  readonly reversado: boolean
  readonly lineas: readonly LineaAsiento[]
  readonly totalCargos: string
  readonly totalAbonos: string
}

export interface LibroDiario {
  readonly asientos: readonly AsientoDiario[]
  readonly totalCargos: string
  readonly totalAbonos: string
  readonly cuadra: boolean
}

/**
 * El diario de un libro, en orden cronológico y por consecutivo.
 *
 * Un asiento que no mueve este libro no aparece: todas sus líneas son de la
 * otra contabilidad. Los reversados sí, igual que su reversa: el diario es el
 * registro de lo que pasó, y la reversa sin su original no se entiende.
 */
export function construirDiario(
  asientos: readonly Asiento[],
  libro: Libro,
): LibroDiario {
  let totalCargos = CERO
  let totalAbonos = CERO

  const lista: AsientoDiario[] = [...asientos]
    .sort(
      (a, b) =>
        a.fecha.localeCompare(b.fecha) ||
        a.ejercicio - b.ejercicio ||
        a.numero - b.numero,
    )
    .map((asiento) => {
      const lineas = asiento.lineas.filter((l) => lineaAfecta(l, libro))
      const cargos = lineas.reduce((acc, l) => acc.plus(l.cargo), CERO)
      const abonos = lineas.reduce((acc, l) => acc.plus(l.abono), CERO)
      totalCargos = totalCargos.plus(cargos)
      totalAbonos = totalAbonos.plus(abonos)
      return {
        id: asiento.id,
        codigo: asiento.codigo,
        fecha: asiento.fecha,
        concepto: asiento.concepto,
        reversado: asiento.estado === 'reversado',
        lineas,
        totalCargos: aTexto(cargos),
        totalAbonos: aTexto(abonos),
      }
    })
    .filter((a) => a.lineas.length > 0)

  return {
    asientos: lista,
    totalCargos: aTexto(totalCargos),
    totalAbonos: aTexto(totalAbonos),
    cuadra: totalCargos.equals(totalAbonos),
  }
}

/* ------------------------------------------------------------- Libro mayor */

export interface MovimientoMayor {
  readonly asientoId: string
  readonly asientoCodigo: string
  readonly fecha: string
  readonly concepto: string
  readonly auxiliar: string | null
  readonly cargo: string
  readonly abono: string
  /** Saldo después del movimiento, con el signo de la naturaleza de la cuenta. */
  readonly saldo: string
}

export interface CuentaMayor {
  readonly codigo: string
  readonly nombre: string
  readonly naturaleza: Cuenta['naturaleza']
  readonly saldoInicial: string
  readonly movimientos: readonly MovimientoMayor[]
  readonly totalCargos: string
  readonly totalAbonos: string
  readonly saldoFinal: string
}

/**
 * El mayor de un libro en un intervalo: por cuenta, sus movimientos con el
 * saldo corrido.
 *
 * El saldo inicial sale de la balanza del primer periodo del intervalo y no de
 * sumar asientos: así el mayor arranca exactamente donde la balanza dice, y su
 * saldo final tiene que coincidir con el de la balanza del último periodo. Si
 * no coincide, el problema no está aquí, y la prueba lo detecta.
 *
 * `soloCuenta` lo convierte en el auxiliar de una cuenta (docs/09 §4).
 */
export function construirMayor(
  asientos: readonly Asiento[],
  balanzaInicial: Balanza,
  cuentas: readonly Cuenta[],
  libro: Libro,
  soloCuenta?: string,
): CuentaMayor[] {
  const iniciales = new Map(
    balanzaInicial.renglones
      .filter((r) => r.esDetalle)
      .map((r) => [r.codigo, new Decimal(r.saldoInicial)]),
  )

  const porCuenta = new Map<string, { asiento: Asiento; linea: LineaAsiento }[]>()
  const ordenados = [...asientos].sort(
    (a, b) =>
      a.fecha.localeCompare(b.fecha) ||
      a.ejercicio - b.ejercicio ||
      a.numero - b.numero,
  )
  for (const asiento of ordenados) {
    for (const linea of asiento.lineas) {
      if (!lineaAfecta(linea, libro)) continue
      if (soloCuenta && linea.cuentaCodigo !== soloCuenta) continue
      const lista = porCuenta.get(linea.cuentaCodigo) ?? []
      lista.push({ asiento, linea })
      porCuenta.set(linea.cuentaCodigo, lista)
    }
  }

  const resultado: CuentaMayor[] = []
  for (const cuenta of cuentas) {
    if (!cuenta.esDetalle) continue
    if (soloCuenta && cuenta.codigo !== soloCuenta) continue
    const inicial = iniciales.get(cuenta.codigo) ?? CERO
    const lineas = porCuenta.get(cuenta.codigo) ?? []
    // En el mayor completo, una cuenta quieta y en cero no aporta nada. En el
    // auxiliar de una cuenta concreta sí se enseña: "no tuvo movimientos" es
    // la respuesta a lo que se preguntó.
    if (!soloCuenta && lineas.length === 0 && inicial.isZero()) continue

    const signo = cuenta.naturaleza === 'deudora' ? 1 : -1
    let saldo = inicial
    let cargos = CERO
    let abonos = CERO
    const movimientos: MovimientoMayor[] = lineas.map(({ asiento, linea }) => {
      cargos = cargos.plus(linea.cargo)
      abonos = abonos.plus(linea.abono)
      saldo = saldo.plus(new Decimal(linea.cargo).minus(linea.abono).times(signo))
      return {
        asientoId: asiento.id,
        asientoCodigo: asiento.codigo,
        fecha: asiento.fecha,
        concepto: linea.concepto || asiento.concepto,
        auxiliar: linea.auxiliarNombre,
        cargo: linea.cargo,
        abono: linea.abono,
        saldo: aTexto(saldo),
      }
    })

    resultado.push({
      codigo: cuenta.codigo,
      nombre: cuenta.nombre,
      naturaleza: cuenta.naturaleza,
      saldoInicial: aTexto(inicial),
      movimientos,
      totalCargos: aTexto(cargos),
      totalAbonos: aTexto(abonos),
      saldoFinal: aTexto(saldo),
    })
  }
  return resultado
}

/* ------------------------------------ Comparativo fiscal contra corporativo */

export interface RenglonComparativoLibros {
  readonly codigo: string
  readonly nombre: string
  readonly fiscal: string
  readonly corporativo: string
  /** Corporativo menos fiscal, con el signo de la naturaleza de la cuenta. */
  readonly diferencia: string
}

export interface ComparativoLibros {
  readonly renglones: readonly RenglonComparativoLibros[]
  /** Solo las cuentas donde los dos libros no dicen lo mismo. */
  readonly conDiferencia: number
}

/**
 * Las dos contabilidades lado a lado, por cuenta de detalle (docs/09 §3).
 *
 * Es el único reporte que junta los dos libros, y no los suma: los enfrenta.
 * Explica por qué la utilidad declarada no es la del negocio, y es el insumo de
 * la conciliación fiscal de la renta.
 */
export function compararLibros(
  fiscal: Balanza,
  corporativo: Balanza,
): ComparativoLibros {
  const porCodigo = (b: Balanza) =>
    new Map(b.renglones.filter((r) => r.esDetalle).map((r) => [r.codigo, r]))
  const f = porCodigo(fiscal)
  const c = porCodigo(corporativo)
  const codigos = [...new Set([...f.keys(), ...c.keys()])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )

  const renglones = codigos
    .map((codigo) => {
      const rf = f.get(codigo)
      const rc = c.get(codigo)
      const saldoF = new Decimal(rf?.saldoFinal ?? 0)
      const saldoC = new Decimal(rc?.saldoFinal ?? 0)
      return {
        codigo,
        nombre: (rf ?? rc)!.nombre,
        fiscal: aTexto(saldoF),
        corporativo: aTexto(saldoC),
        diferencia: aTexto(saldoC.minus(saldoF)),
      }
    })
    .filter((r) => !(new Decimal(r.fiscal).isZero() && new Decimal(r.corporativo).isZero()))

  return {
    renglones,
    conDiferencia: renglones.filter((r) => !new Decimal(r.diferencia).isZero())
      .length,
  }
}
