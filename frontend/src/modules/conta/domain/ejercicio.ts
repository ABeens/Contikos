import Decimal from 'decimal.js'
import { LIBROS_TODOS, type Libro } from '@/shared/api/contracts/comunes'
import type {
  Cuenta,
  LineaSolicitud,
  Periodo,
  ResultadoLibro,
  SolicitudAsiento,
  VerificacionCierre,
} from '@/shared/api/contracts/conta'
import {
  TIPO_ORIGEN_CIERRE_EJERCICIO,
  origenCierreEjercicio,
} from '@/shared/asiento/cierre'
import { etiquetaLibro } from '@/shared/asiento/libro'
import { formatNumero } from '@/shared/money/format'
import { etiquetaPeriodo } from './periodo'

/**
 * Cierre del ejercicio (docs/03 §6).
 *
 * Tres cosas, en este orden y todas o ninguna:
 *
 * 1. Un asiento que salda las cuentas de ingresos, costos y gastos contra la
 *    cuenta de patrimonio que recibe el resultado. Es un asiento normal, con
 *    origen `conta / cierre_ejercicio`, fechado el último día del ejercicio.
 * 2. Los periodos del ejercicio pasan a `bloqueado`: ya no se reabren.
 * 3. Se abren los doce meses del ejercicio siguiente, si no existían.
 *
 * El doc 03 pide además un asiento de apertura con los saldos de balance. Aquí
 * no se genera, y no por olvido: el mayor de Contikos es continuo (la balanza
 * acumula desde el primer asiento, docs/03 §4), así que los saldos de balance
 * ya amanecen el 1 de enero donde quedaron el 31 de diciembre. Un asiento de
 * apertura los contaría dos veces.
 *
 * Los pasos 1 y 2 van juntos en una sola decisión para no dejar un año a medio
 * cerrar: con el asiento y sin el bloqueo, alguien podría registrar ventas en
 * diciembre después de haberlas trasladado a resultados acumulados.
 */

const CERO = new Decimal(0)

export type CodigoVerificacionEjercicio =
  | 'EJERCICIO_NO_EXISTE'
  | 'EJERCICIO_YA_CERRADO'
  | 'EJERCICIO_EN_CURSO'
  | 'MESES_ABIERTOS'
  | 'ULTIMO_MES_NO_ABIERTO'
  | 'CUENTA_DESTINO'
  | 'RESULTADO_DEL_EJERCICIO'
  | 'EJERCICIO_SIGUIENTE'

export interface ContextoCierreEjercicio {
  readonly periodos: readonly Periodo[]
  readonly cuentas: readonly Cuenta[]
  /**
   * Saldo de cada cuenta al último día del ejercicio, por libro, en
   * convención deudor positivo. Basta con las de resultados; las demás se
   * ignoran.
   */
  readonly saldos: Readonly<Record<Libro, ReadonlyMap<string, Decimal>>>
  readonly cuentaDestino: string | null
  /** Hoy, según quien pregunta. Parámetro por la misma razón que en el mensual. */
  readonly fechaReferencia: string
  /** Ya hay un asiento de cierre para este ejercicio. */
  readonly yaCerrado: boolean
}

export interface ResultadoVerificacionEjercicio {
  readonly verificaciones: readonly VerificacionCierre[]
  readonly puedeCerrar: boolean
  readonly fechaCierre: string
  readonly resultados: readonly ResultadoLibro[]
}

const TIPOS_RESULTADO = new Set(['ingreso', 'costo', 'gasto'])

function verificacion(
  codigo: CodigoVerificacionEjercicio,
  severidad: VerificacionCierre['severidad'],
  mensaje: string,
  detalle?: string,
): VerificacionCierre {
  return detalle === undefined
    ? { codigo, severidad, mensaje }
    : { codigo, severidad, mensaje, detalle }
}

export function periodosDelEjercicio(
  ejercicio: number,
  periodos: readonly Periodo[],
): Periodo[] {
  return periodos
    .filter((p) => p.ejercicio === ejercicio)
    .sort((a, b) => a.numero - b.numero)
}

/** Cuentas que el cierre puede usar como destino del resultado. */
export function cuentasDestinoValidas(cuentas: readonly Cuenta[]): Cuenta[] {
  return cuentas.filter(
    (c) => c.esDetalle && c.activa && c.tipo === 'capital' && !c.esCuentaControl,
  )
}

/**
 * Resultado del ejercicio en un libro, positivo si es utilidad.
 *
 * Es el saldo de todas las cuentas de resultados, incluidos los de ejercicios
 * anteriores que nunca se cerraron: el cierre los traslada todos, porque
 * después de él las cuentas de resultados tienen que quedar en cero.
 */
export function resultadoDelLibro(
  saldos: ReadonlyMap<string, Decimal>,
  cuentas: readonly Cuenta[],
): Decimal {
  let total = CERO
  for (const cuenta of cuentas) {
    if (!cuenta.esDetalle || !TIPOS_RESULTADO.has(cuenta.tipo)) continue
    total = total.plus(saldos.get(cuenta.codigo) ?? CERO)
  }
  return total.negated()
}

/** El checklist del cierre anual. Puro: no escribe nada. */
export function verificarCierreEjercicio(
  ejercicio: number,
  contexto: ContextoCierreEjercicio,
): ResultadoVerificacionEjercicio {
  const meses = periodosDelEjercicio(ejercicio, contexto.periodos)
  const resultados: ResultadoLibro[] = LIBROS_TODOS.map((libro) => ({
    libro,
    resultado: resultadoDelLibro(contexto.saldos[libro], contexto.cuentas).toFixed(2),
  }))

  if (meses.length === 0) {
    return {
      verificaciones: [
        verificacion(
          'EJERCICIO_NO_EXISTE',
          'error',
          `El ejercicio ${ejercicio} no tiene periodos`,
        ),
      ],
      puedeCerrar: false,
      fechaCierre: `${ejercicio}-12-31`,
      resultados,
    }
  }

  const ultimo = meses[meses.length - 1]
  const verificaciones: VerificacionCierre[] = []

  if (contexto.yaCerrado) {
    verificaciones.push(
      verificacion(
        'EJERCICIO_YA_CERRADO',
        'error',
        `El ejercicio ${ejercicio} ya está cerrado`,
        'Su asiento de cierre existe y sus meses están bloqueados',
      ),
    )
  }

  verificaciones.push(
    contexto.fechaReferencia < ultimo.fechaFin
      ? verificacion(
          'EJERCICIO_EN_CURSO',
          'error',
          `El ejercicio termina el ${ultimo.fechaFin} y todavía está en curso`,
          `Fecha de referencia: ${contexto.fechaReferencia}`,
        )
      : verificacion('EJERCICIO_EN_CURSO', 'ok', `El ejercicio terminó el ${ultimo.fechaFin}`),
  )

  // Todos los meses menos el último tienen que estar cerrados: el asiento de
  // cierre va en el último, y cualquier otro abierto admitiría movimientos
  // de resultados después de haberlos trasladado.
  const abiertos = meses.slice(0, -1).filter((p) => p.estado === 'abierto')
  verificaciones.push(
    abiertos.length > 0
      ? verificacion(
          'MESES_ABIERTOS',
          'error',
          `${abiertos.length} mes(es) del ejercicio siguen abiertos`,
          abiertos.map(etiquetaPeriodo).join(', '),
        )
      : verificacion(
          'MESES_ABIERTOS',
          'ok',
          `Los meses anteriores a ${etiquetaPeriodo(ultimo)} están cerrados`,
        ),
  )

  verificaciones.push(
    ultimo.estado === 'abierto'
      ? verificacion(
          'ULTIMO_MES_NO_ABIERTO',
          'ok',
          `${etiquetaPeriodo(ultimo)} está abierto para recibir el asiento de cierre`,
        )
      : verificacion(
          'ULTIMO_MES_NO_ABIERTO',
          'error',
          `${etiquetaPeriodo(ultimo)} está ${ultimo.estado}`,
          ultimo.estado === 'cerrado'
            ? 'Reábralo: el asiento de cierre va fechado el último día del ejercicio'
            : 'Un mes bloqueado no admite el asiento de cierre',
        ),
  )

  const destino = contexto.cuentaDestino
    ? contexto.cuentas.find((c) => c.codigo === contexto.cuentaDestino)
    : undefined
  if (!contexto.cuentaDestino) {
    verificaciones.push(
      verificacion(
        'CUENTA_DESTINO',
        'error',
        'Falta la cuenta de patrimonio que recibe el resultado',
      ),
    )
  } else if (!destino || !cuentasDestinoValidas(contexto.cuentas).includes(destino)) {
    verificaciones.push(
      verificacion(
        'CUENTA_DESTINO',
        'error',
        `${contexto.cuentaDestino} no puede recibir el resultado`,
        'Tiene que ser una cuenta de patrimonio, de detalle, activa y que no sea de control',
      ),
    )
  } else {
    verificaciones.push(
      verificacion(
        'CUENTA_DESTINO',
        'ok',
        `El resultado se traslada a ${destino.codigo} ${destino.nombre}`,
      ),
    )
  }

  for (const { libro, resultado } of resultados) {
    const valor = new Decimal(resultado)
    verificaciones.push(
      verificacion(
        'RESULTADO_DEL_EJERCICIO',
        'ok',
        valor.isZero()
          ? `Contabilidad ${etiquetaLibro(libro).toLowerCase()}: sin resultado que trasladar`
          : `Contabilidad ${etiquetaLibro(libro).toLowerCase()}: ${valor.isNegative() ? 'pérdida' : 'utilidad'} de ${formatNumero(valor.abs())}`,
      ),
    )
  }

  const siguiente = periodosDelEjercicio(ejercicio + 1, contexto.periodos)
  verificaciones.push(
    verificacion(
      'EJERCICIO_SIGUIENTE',
      'ok',
      siguiente.length > 0
        ? `El ejercicio ${ejercicio + 1} ya tiene sus periodos`
        : `Se abrirán los doce meses del ejercicio ${ejercicio + 1}`,
    ),
  )

  return {
    verificaciones,
    puedeCerrar: verificaciones.every((v) => v.severidad !== 'error'),
    fechaCierre: ultimo.fechaFin,
    resultados,
  }
}

/**
 * El asiento de cierre, o null si no hay nada que saldar.
 *
 * Una línea por cuenta de resultados con saldo, con el importe contrario a su
 * saldo, y la contrapartida por la suma en la cuenta destino. Por libro: si una
 * cuenta tiene el mismo saldo en las dos contabilidades, una sola línea para
 * las dos; si difiere, una línea por libro. Así cada libro cuadra por su cuenta
 * (docs/02 §3.1) y la utilidad que se traslada es la de cada uno.
 */
export function construirAsientoCierre(
  ejercicio: number,
  contexto: ContextoCierreEjercicio,
  fechaCierre: string,
  /** El mayor se lleva en moneda funcional, y el cierre salda el mayor. */
  monedaFuncional: string,
): SolicitudAsiento | null {
  const destino = contexto.cuentaDestino
  if (!destino) return null

  const lineas: LineaSolicitud[] = []
  const linea = (cuenta: string, saldo: Decimal, libros: Libro[] | undefined, concepto: string) => {
    // Saldar es cargar lo que tiene saldo acreedor y abonar lo deudor.
    lineas.push({
      cuenta,
      cargo: saldo.isNegative() ? saldo.abs().toFixed(2) : '0.00',
      abono: saldo.isPositive() ? saldo.toFixed(2) : '0.00',
      concepto,
      ...(libros ? { libros } : {}),
    })
  }

  for (const cuenta of contexto.cuentas) {
    if (!cuenta.esDetalle || !TIPOS_RESULTADO.has(cuenta.tipo)) continue
    const fiscal = contexto.saldos.fiscal.get(cuenta.codigo) ?? CERO
    const corporativo = contexto.saldos.corporativo.get(cuenta.codigo) ?? CERO
    const concepto = `Cierre ${cuenta.nombre}`
    if (fiscal.equals(corporativo)) {
      if (!fiscal.isZero()) linea(cuenta.codigo, fiscal, undefined, concepto)
      continue
    }
    if (!fiscal.isZero()) linea(cuenta.codigo, fiscal, ['fiscal'], concepto)
    if (!corporativo.isZero()) linea(cuenta.codigo, corporativo, ['corporativo'], concepto)
  }

  if (lineas.length === 0) return null

  // La contrapartida, por libro por la misma razón: cada contabilidad lleva a
  // patrimonio su propio resultado.
  const resultadoFiscal = resultadoDelLibro(contexto.saldos.fiscal, contexto.cuentas)
  const resultadoCorporativo = resultadoDelLibro(
    contexto.saldos.corporativo,
    contexto.cuentas,
  )
  const contrapartida = (resultado: Decimal, libros: Libro[] | undefined) => {
    if (resultado.isZero()) return
    // Utilidad: abono a patrimonio. Pérdida: cargo.
    lineas.push({
      cuenta: destino,
      cargo: resultado.isNegative() ? resultado.abs().toFixed(2) : '0.00',
      abono: resultado.isPositive() ? resultado.toFixed(2) : '0.00',
      concepto: `Resultado del ejercicio ${ejercicio}`,
      ...(libros ? { libros } : {}),
    })
  }
  if (resultadoFiscal.equals(resultadoCorporativo)) {
    contrapartida(resultadoFiscal, undefined)
  } else {
    contrapartida(resultadoFiscal, ['fiscal'])
    contrapartida(resultadoCorporativo, ['corporativo'])
  }

  return {
    fecha: fechaCierre,
    concepto: `Cierre del ejercicio ${ejercicio}`,
    moneda: monedaFuncional,
    tipoCambio: '1',
    origen: {
      modulo: 'conta',
      tipo: TIPO_ORIGEN_CIERRE_EJERCICIO,
      id: origenCierreEjercicio(ejercicio),
    },
    lineas,
  }
}

const dosDigitos = (n: number): string => String(n).padStart(2, '0')

/** Los doce meses de un ejercicio que empieza en enero (docs/13 §1), abiertos. */
export function construirPeriodosEjercicio(ejercicio: number): Periodo[] {
  return Array.from({ length: 12 }, (_, i) => {
    const numero = i + 1
    const ultimoDia = new Date(Date.UTC(ejercicio, numero, 0)).getUTCDate()
    return {
      id: `per-${ejercicio}-${dosDigitos(numero)}`,
      ejercicio,
      numero,
      fechaInicio: `${ejercicio}-${dosDigitos(numero)}-01`,
      fechaFin: `${ejercicio}-${dosDigitos(numero)}-${dosDigitos(ultimoDia)}`,
      estado: 'abierto',
      cerradoEn: null,
      cerradoPor: null,
      motivoCierre: null,
    }
  })
}
