import Decimal from 'decimal.js'
import { Money, type Moneda } from '@/shared/money/money'
import { nombreMes } from '@/shared/format/fecha'
import type {
  LineaSolicitud,
  Periodo,
  SolicitudAsiento,
} from '@/shared/api/contracts/conta'
import type {
  Activo,
  CategoriaActivo,
  CorridaDepreciacion,
  LineaCorrida,
  Verificacion,
} from '@/shared/api/contracts/activos'
import { cuotaMensual } from './activo'

/**
 * Corrida mensual de depreciación (docs/07 §3.2).
 *
 *   seleccionar activos depreciables → calcular → revisar → contabilizar
 *
 * Todo lo que hay aquí es puro: recibe el inventario, las categorías y el
 * periodo, y devuelve la corrida con sus verificaciones y el asiento que la
 * contabilizaría. Quien escribe (el mock hoy, el backend mañana) llama a esto
 * dos veces con los mismos datos, una para previsualizar y otra para
 * contabilizar, y por construcción obtiene lo mismo. Que lo que se revisó sea
 * lo que se contabiliza es la "verificación previa" del requerimiento.
 */

export type CodigoVerificacion =
  | 'PERIODO_NO_ABIERTO'
  | 'CORRIDA_YA_CONTABILIZADA'
  | 'CATEGORIA_INVALIDA'
  | 'CATEGORIA_SIN_CUENTA'
  | 'SIN_FECHA_INICIO'
  | 'MONEDA_DISTINTA'
  | 'ULTIMA_CUOTA'
  | 'CUOTA_CERO'
  | 'CORRIDA_VACIA'
  | 'PERIODO_ANTERIOR_SIN_CORRIDA'

export interface ContextoCorrida {
  /** Todos los periodos del ejercicio, para ubicar el anterior. */
  readonly periodos: readonly Periodo[]
  /** Corridas ya en el mayor: id del periodo → id del asiento. */
  readonly corridasContabilizadas: ReadonlyMap<string, string>
}

/**
 * Identificador de origen de la corrida (docs/02 §4, docs/07 §3.2).
 *
 * La terna `(activos, depreciacion, dep-<ejercicio>-<mes>)` es la llave de
 * idempotencia: correr dos veces el mismo periodo no duplica el gasto. Se
 * deriva del periodo y no se inventa por corrida a propósito, y con el prefijo
 * `dep-` en vez del `per-` del periodo porque así lo lleva la depreciación de
 * julio que ya está en el mayor de la demo.
 */
export function idOrigenCorrida(periodo: Pick<Periodo, 'id'>): string {
  return periodo.id.replace(/^per-/, 'dep-')
}

/** Inversa de `idOrigenCorrida`. `undefined` si el id no es de una corrida. */
export function periodoIdDeOrigen(origenId: string): string | undefined {
  if (origenId.startsWith('dep-')) return origenId.replace(/^dep-/, 'per-')
  if (origenId.startsWith('per-')) return origenId
  return undefined
}

export function conceptoCorrida(periodo: Periodo): string {
  return `Depreciación ${nombreMes(periodo.numero).toLowerCase()} ${periodo.ejercicio}`
}

/**
 * Número de mes de depreciación que representa el periodo para el activo:
 * 1 el mes en que empezó a depreciarse, `vidaUtilMeses` el último.
 *
 * Convención de mes completo: el mes de inicio cuenta entero aunque el activo
 * entre en uso el día 15 (docs/07 §3.2 deja la convención configurable; esta
 * es la que aplica hoy).
 */
export function mesDeDepreciacion(
  fechaInicio: string,
  periodo: Periodo,
): number {
  const anio = Number(fechaInicio.slice(0, 4))
  const mes = Number(fechaInicio.slice(5, 7))
  return (periodo.ejercicio - anio) * 12 + (periodo.numero - mes) + 1
}

/** Meses que tarda el reglamento en depreciar el bien a la tasa fiscal. */
function mesesFiscales(tasaFiscalAnual: string): Decimal {
  return new Decimal(1200).dividedBy(new Decimal(tasaFiscalAnual))
}

/**
 * true cuando la cédula fiscal y la contable no coinciden (docs/07 §5).
 *
 * Se compara contra la vida útil del activo y no la de la categoría porque es
 * la del activo la que produce la cuota NIIF: un activo con vida útil propia
 * de 48 meses en una categoría al 25% anual lleva la misma cuota en los dos
 * libros aunque la categoría diga 60.
 */
export function difiereFiscal(
  activo: Pick<Activo, 'vidaUtilMeses'>,
  categoria: Pick<CategoriaActivo, 'tasaFiscalAnual'>,
): boolean {
  if (categoria.tasaFiscalAnual === null) return false
  const tasa = new Decimal(categoria.tasaFiscalAnual)
  if (tasa.lessThanOrEqualTo(0)) return false
  return !mesesFiscales(categoria.tasaFiscalAnual).equals(activo.vidaUtilMeses)
}

/**
 * Cuota fiscal del mes: línea recta sobre el depreciable a la tasa del
 * reglamento, y cero cuando el reglamento ya lo dio por depreciado.
 *
 * La acumulada fiscal no se guarda en la ficha; se reconstruye por el número
 * de mes, que es determinista: mismos datos, misma cédula. El último mes
 * fiscal cierra contra el remanente por la misma regla de docs/07 §3.2.
 */
export function cuotaFiscalMensual(
  activo: Activo,
  categoria: CategoriaActivo,
  periodo: Periodo,
  moneda: Moneda,
): Money {
  if (categoria.tasaFiscalAnual === null) return cuotaMensual(activo, moneda)

  const depreciable = new Decimal(activo.costoAdquisicion).minus(
    new Decimal(activo.valorResidual),
  )
  if (depreciable.lessThanOrEqualTo(0)) return Money.cero(moneda)

  const bruta = depreciable
    .times(new Decimal(categoria.tasaFiscalAnual))
    .dividedBy(1200)
    .toDecimalPlaces(2)
  const mes = mesDeDepreciacion(activo.fechaInicioDepreciacion, periodo)
  const acumuladaEstimada = bruta.times(Math.max(mes - 1, 0))
  const remanente = depreciable.minus(acumuladaEstimada)
  if (remanente.lessThanOrEqualTo(0)) return Money.cero(moneda)

  return new Money(Decimal.min(bruta, remanente), moneda)
}

/** El periodo inmediatamente anterior dentro del catálogo, si existe. */
function periodoAnterior(
  periodo: Periodo,
  periodos: readonly Periodo[],
): Periodo | undefined {
  return periodos.find(
    (p) =>
      (p.ejercicio === periodo.ejercicio && p.numero === periodo.numero - 1) ||
      (periodo.numero === 1 &&
        p.ejercicio === periodo.ejercicio - 1 &&
        p.numero === 12),
  )
}

function etiquetaPeriodo(periodo: Periodo): string {
  return `${nombreMes(periodo.numero)} ${periodo.ejercicio}`
}

/**
 * Calcula la corrida del periodo con su verificación previa.
 *
 * Selección (docs/07 §3.2): solo activos en estado `activo`, con fecha de
 * inicio de depreciación dentro o antes del periodo, y con algo por depreciar.
 * La cuota nunca baja del residual y el último mes cierra el remanente exacto.
 */
export function calcularCorrida(
  activos: readonly Activo[],
  categorias: readonly CategoriaActivo[],
  periodo: Periodo,
  moneda: Moneda,
  contexto: ContextoCorrida,
): CorridaDepreciacion {
  const generales: Verificacion[] = []

  if (periodo.estado !== 'abierto') {
    generales.push({
      codigo: 'PERIODO_NO_ABIERTO',
      severidad: 'error',
      mensaje: `El periodo ${etiquetaPeriodo(periodo)} está ${periodo.estado}: no admite asientos`,
    })
  }

  const asientoExistente = contexto.corridasContabilizadas.get(periodo.id)
  if (asientoExistente) {
    generales.push({
      codigo: 'CORRIDA_YA_CONTABILIZADA',
      severidad: 'error',
      mensaje: `La depreciación de ${etiquetaPeriodo(periodo)} ya está contabilizada en el asiento ${asientoExistente}`,
    })
  }

  // Aviso, no error: la corrida de un mes no depende técnicamente de la del
  // anterior, pero saltarse un mes deja la acumulada corta y nadie lo nota
  // hasta el cierre. Se calla cuando no hay ninguna corrida anterior en el
  // mayor: esa es la primera y no tiene con qué compararse.
  const anterior = periodoAnterior(periodo, contexto.periodos)
  if (
    anterior &&
    contexto.corridasContabilizadas.size > 0 &&
    !contexto.corridasContabilizadas.has(anterior.id)
  ) {
    generales.push({
      codigo: 'PERIODO_ANTERIOR_SIN_CORRIDA',
      severidad: 'aviso',
      mensaje: `${etiquetaPeriodo(anterior)} no tiene corrida de depreciación contabilizada`,
    })
  }

  const lineas: LineaCorrida[] = []
  const porActivo: Verificacion[] = []
  const categoriasSinCuenta = new Set<string>()

  const candidatos = [...activos]
    .filter((a) => a.estado === 'activo')
    .sort((a, b) => a.codigo.localeCompare(b.codigo))

  for (const activo of candidatos) {
    if (!activo.fechaInicioDepreciacion) {
      porActivo.push({
        codigo: 'SIN_FECHA_INICIO',
        severidad: 'aviso',
        mensaje: `${activo.codigo} ${activo.nombre} no tiene fecha de inicio de depreciación: se omite`,
        activoId: activo.id,
      })
      continue
    }
    if (activo.fechaInicioDepreciacion > periodo.fechaFin) continue

    if (activo.moneda !== moneda) {
      porActivo.push({
        codigo: 'MONEDA_DISTINTA',
        severidad: 'aviso',
        mensaje: `${activo.codigo} ${activo.nombre} está en ${activo.moneda} y la corrida se contabiliza en ${moneda}: se omite`,
        activoId: activo.id,
      })
      continue
    }

    const categoria = categorias.find((c) => c.id === activo.categoriaId)
    if (!categoria) {
      porActivo.push({
        codigo: 'CATEGORIA_INVALIDA',
        severidad: 'error',
        mensaje: `${activo.codigo} ${activo.nombre} apunta a una categoría que no existe`,
        activoId: activo.id,
      })
      continue
    }
    if (
      !categoria.cuentaGastoDepreciacion.trim() ||
      !categoria.cuentaDepreciacionAcumulada.trim()
    ) {
      categoriasSinCuenta.add(categoria.id)
    }

    const costo = new Decimal(activo.costoAdquisicion)
    const residual = new Decimal(activo.valorResidual)
    const acumulada = new Decimal(activo.depreciacionAcumulada)
    const librosInicial = costo.minus(acumulada)
    const depreciable = librosInicial.minus(residual)

    if (depreciable.lessThanOrEqualTo(0)) {
      porActivo.push({
        codigo: 'CUOTA_CERO',
        severidad: 'aviso',
        mensaje: `${activo.codigo} ${activo.nombre} ya no tiene nada por depreciar: se omite`,
        activoId: activo.id,
      })
      continue
    }

    // El último mes de la vida útil cierra el remanente exacto, sea cual sea el
    // método: es lo que evita que saldos decrecientes se acerque al residual
    // sin llegar nunca, y que la línea recta deje céntimos de redondeo.
    const mes = mesDeDepreciacion(activo.fechaInicioDepreciacion, periodo)
    const cuota =
      mes >= activo.vidaUtilMeses
        ? depreciable
        : Decimal.min(cuotaMensual(activo, moneda).monto, depreciable)

    if (cuota.lessThanOrEqualTo(0)) {
      porActivo.push({
        codigo: 'CUOTA_CERO',
        severidad: 'aviso',
        mensaje: `${activo.codigo} ${activo.nombre} produce cuota cero este mes: se omite`,
        activoId: activo.id,
      })
      continue
    }

    const acumuladaResultante = acumulada.plus(cuota)
    const librosResultante = costo.minus(acumuladaResultante)
    const ultimaCuota = librosResultante.equals(residual)
    const verificaciones: Verificacion[] = []

    if (ultimaCuota) {
      verificaciones.push({
        codigo: 'ULTIMA_CUOTA',
        severidad: 'aviso',
        mensaje: `${activo.codigo} ${activo.nombre} cierra contra su valor residual con esta cuota y pasa a totalmente depreciado`,
        activoId: activo.id,
      })
    }

    const fiscal = difiereFiscal(activo, categoria)
      ? cuotaFiscalMensual(activo, categoria, periodo, moneda).toApi()
      : null

    lineas.push({
      activoId: activo.id,
      codigo: activo.codigo,
      nombre: activo.nombre,
      categoriaId: categoria.id,
      categoriaNombre: categoria.nombre,
      metodo: activo.metodo,
      valorEnLibrosInicial: new Money(librosInicial, moneda).toApi(),
      cuota: new Money(cuota, moneda).toApi(),
      cuotaFiscal: fiscal,
      depreciacionAcumuladaResultante: new Money(
        acumuladaResultante,
        moneda,
      ).toApi(),
      valorEnLibrosResultante: new Money(librosResultante, moneda).toApi(),
      ultimaCuota,
      verificaciones,
    })
    porActivo.push(...verificaciones)
  }

  for (const id of categoriasSinCuenta) {
    const categoria = categorias.find((c) => c.id === id)!
    generales.push({
      codigo: 'CATEGORIA_SIN_CUENTA',
      severidad: 'error',
      mensaje: `La categoría ${categoria.nombre} no tiene cuenta de gasto o de depreciación acumulada: sin ellas no hay asiento`,
    })
  }

  if (lineas.length === 0) {
    generales.push({
      codigo: 'CORRIDA_VACIA',
      severidad: 'aviso',
      mensaje: `Ningún activo se deprecia en ${etiquetaPeriodo(periodo)}`,
    })
  }

  const verificaciones = [...generales, ...porActivo]
  const total = lineas.reduce(
    (acc, l) => acc.plus(new Decimal(l.cuota)),
    new Decimal(0),
  )
  const totalFiscal = lineas.reduce(
    (acc, l) => acc.plus(new Decimal(l.cuotaFiscal ?? l.cuota)),
    new Decimal(0),
  )

  return {
    periodoId: periodo.id,
    moneda,
    lineas,
    total: new Money(total, moneda).toApi(),
    totalFiscal: new Money(totalFiscal, moneda).toApi(),
    verificaciones,
    puedeContabilizar:
      lineas.length > 0 && !verificaciones.some((v) => v.severidad === 'error'),
  }
}

/**
 * Asiento de la corrida (docs/07 §3.2): uno solo, agrupado por categoría.
 *
 *   Gasto por depreciación (por categoría)        cargo
 *   Depreciación acumulada (auxiliar: activo)             abono
 *
 * Cuando la tasa fiscal de la categoría difiere de la vida útil NIIF, las
 * líneas del activo van por duplicado y marcadas a su libro (docs/02 §3.1,
 * D-11): la fiscal con la cuota del reglamento y la corporativa con la NIIF.
 * Es la misma forma del asiento de julio que ya está en el mayor de la demo.
 */
export function armarAsientoCorrida(
  corrida: CorridaDepreciacion,
  activos: readonly Activo[],
  categorias: readonly CategoriaActivo[],
  periodo: Periodo,
  moneda: Moneda,
): SolicitudAsiento {
  const lineas: LineaSolicitud[] = []
  const categoriasEnOrden = [...new Set(corrida.lineas.map((l) => l.categoriaId))]

  for (const categoriaId of categoriasEnOrden) {
    const categoria = categorias.find((c) => c.id === categoriaId)!
    const delGrupo = corrida.lineas.filter((l) => l.categoriaId === categoriaId)
    const comunes = delGrupo.filter((l) => l.cuotaFiscal === null)
    const partidas = delGrupo.filter((l) => l.cuotaFiscal !== null)

    // El concepto del abono lleva el nombre de la ficha, no el que la línea
    // copió al calcular: si alguien renombró el activo entre la
    // previsualización y la contabilización, el mayor debe decir el vigente.
    const nombreDe = (linea: LineaCorrida): string =>
      activos.find((a) => a.id === linea.activoId)?.nombre ?? linea.nombre

    const abono = (
      linea: LineaCorrida,
      importe: string,
      sufijo: string,
      libros?: LineaSolicitud['libros'],
    ): LineaSolicitud => ({
      cuenta: categoria.cuentaDepreciacionAcumulada,
      concepto: `${nombreDe(linea)}${sufijo}`,
      cargo: '0',
      abono: importe,
      auxiliarTipo: 'activo',
      auxiliarId: linea.activoId,
      ...(libros ? { libros } : {}),
    })

    if (comunes.length > 0) {
      lineas.push({
        cuenta: categoria.cuentaGastoDepreciacion,
        concepto: `Depreciación ${categoria.nombre.toLowerCase()}`,
        cargo: sumar(comunes.map((l) => l.cuota), moneda),
        abono: '0',
      })
      for (const linea of comunes) {
        lineas.push(abono(linea, linea.cuota, ''))
      }
    }

    if (partidas.length > 0) {
      // El reglamento puede haber terminado antes que la NIIF: entonces al
      // libro fiscal no entra nada por ese activo y solo va la línea
      // corporativa. Una línea en cero no es un movimiento.
      const conFiscal = partidas.filter((l) =>
        new Decimal(l.cuotaFiscal!).greaterThan(0),
      )
      if (conFiscal.length > 0) {
        lineas.push({
          cuenta: categoria.cuentaGastoDepreciacion,
          concepto: `Depreciación ${categoria.nombre.toLowerCase()} (tasa fiscal ${categoria.tasaFiscalAnual}% anual)`,
          cargo: sumar(conFiscal.map((l) => l.cuotaFiscal!), moneda),
          abono: '0',
          libros: ['fiscal'],
        })
        for (const linea of conFiscal) {
          lineas.push(abono(linea, linea.cuotaFiscal!, ' (tasa fiscal)', ['fiscal']))
        }
      }

      lineas.push({
        cuenta: categoria.cuentaGastoDepreciacion,
        concepto: `Depreciación ${categoria.nombre.toLowerCase()} (vida útil NIIF)`,
        cargo: sumar(partidas.map((l) => l.cuota), moneda),
        abono: '0',
        libros: ['corporativo'],
      })
      for (const linea of partidas) {
        lineas.push(abono(linea, linea.cuota, ' (vida útil NIIF)', ['corporativo']))
      }
    }
  }

  return {
    fecha: periodo.fechaFin,
    concepto: conceptoCorrida(periodo),
    moneda,
    tipoCambio: '1',
    origen: { modulo: 'activos', tipo: 'depreciacion', id: idOrigenCorrida(periodo) },
    lineas,
  }
}

function sumar(importes: readonly string[], moneda: Moneda): string {
  return new Money(
    importes.reduce((acc, i) => acc.plus(new Decimal(i)), new Decimal(0)),
    moneda,
  ).toApi()
}
