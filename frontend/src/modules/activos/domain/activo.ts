import Decimal from 'decimal.js'
import { Money, type Moneda } from '@/shared/money/money'
import type {
  Cuenta,
  LineaSolicitud,
  Periodo,
} from '@/shared/api/contracts/conta'
import type {
  Activo,
  AltaPendiente,
  CategoriaActivo,
  SolicitudActivoDesdeFactura,
  SolicitudActivoManual,
  SolicitudCategoriaActivo,
} from '@/shared/api/contracts/activos'
import {
  cuentaPorCodigo,
  esCuentaDeActivoFijo,
  esCuentaDeDepreciacionAcumulada,
  esCuentaDeResultados,
} from '@/shared/cuentas/cuenta'

/**
 * Reglas del alta de activos (docs/07 §3.1).
 *
 * Las dos puertas de entrada se validan aquí, y la diferencia entre ellas es la
 * que hay que tener presente todo el tiempo:
 *
 * - **Desde una factura de CxP** el asiento ya existe. El alta solo crea la
 *   ficha; volver a contabilizarla duplicaría el activo en el mayor.
 * - **El alta directa** sí genera asiento, porque nadie más lo hizo.
 */

export type CodigoErrorActivo =
  | 'CATEGORIA_INVALIDA'
  | 'NOMBRE_REQUERIDO'
  | 'NOMBRE_DUPLICADO'
  | 'COSTO_INVALIDO'
  | 'RESIDUAL_INVALIDO'
  | 'VIDA_UTIL_INVALIDA'
  | 'FECHA_INICIO_INVALIDA'
  | 'CUENTA_INVALIDA'
  | 'TASA_FISCAL_INVALIDA'
  | 'MAPEO_BLOQUEADO'
  | 'TIPO_CAMBIO_INVALIDO'
  | 'PERIODO_CERRADO'
  | 'ALTA_NO_DISPONIBLE'

export interface ErrorActivo {
  readonly codigo: CodigoErrorActivo
  readonly mensaje: string
}

export interface ResultadoActivo {
  readonly valido: boolean
  readonly errores: readonly ErrorActivo[]
}

export interface ContextoAltaManual {
  readonly categorias: readonly CategoriaActivo[]
  readonly cuentas: readonly Cuenta[]
  readonly periodos: readonly Periodo[]
}

export interface ContextoAltaDesdeFactura {
  readonly categorias: readonly CategoriaActivo[]
  readonly pendientes: readonly AltaPendiente[]
}

export interface ContextoCategoria {
  readonly cuentas: readonly Cuenta[]
  /** El catálogo completo, para detectar nombres repetidos. */
  readonly categorias: readonly CategoriaActivo[]
  /** La categoría que se edita. Ausente cuando se da de alta una nueva. */
  readonly categoria?: CategoriaActivo
}

/** Vida útil del activo: la propia si se sobrescribió, o la de su categoría. */
export function vidaUtilDe(
  categoria: CategoriaActivo,
  vidaUtilMeses?: number,
): number {
  return vidaUtilMeses && vidaUtilMeses > 0
    ? vidaUtilMeses
    : categoria.vidaUtilMeses
}

/**
 * Valor residual.
 *
 * Sin valor explícito se aplica el porcentaje de la categoría: es la política
 * de la empresa para ese tipo de bien, y repetirla activo por activo produce
 * cédulas de depreciación que no se pueden explicar.
 */
export function valorResidualDe(
  costo: string,
  categoria: CategoriaActivo,
  valorResidual?: string,
): Decimal {
  if (valorResidual !== undefined && valorResidual !== '') {
    return new Decimal(valorResidual)
  }
  return new Decimal(costo)
    .times(new Decimal(categoria.porcentajeResidual).dividedBy(100))
    .toDecimalPlaces(2)
}

export function valorEnLibros(
  costoAdquisicion: string,
  depreciacionAcumulada: string,
): Decimal {
  return new Decimal(costoAdquisicion).minus(new Decimal(depreciacionAcumulada))
}

/**
 * Cuota mensual de depreciación (docs/07 §3.2).
 *
 * Nunca deprecia por debajo del valor residual: el último mes ajusta el
 * remanente, que es lo que evita el clásico "quedan tres céntimos por depreciar
 * para siempre".
 */
export function cuotaMensual(activo: Activo, moneda: Moneda = activo.moneda) {
  const costo = new Decimal(activo.costoAdquisicion)
  const residual = new Decimal(activo.valorResidual)
  const acumulada = new Decimal(activo.depreciacionAcumulada)
  const libros = costo.minus(acumulada)
  const depreciable = libros.minus(residual)

  if (depreciable.lessThanOrEqualTo(0)) return Money.cero(moneda)

  const bruta =
    activo.metodo === 'linea_recta'
      ? costo.minus(residual).dividedBy(activo.vidaUtilMeses)
      : // Saldos decrecientes al doble de la tasa lineal, la convención
        // habitual cuando el reglamento no fija otra.
        libros.times(new Decimal(2).dividedBy(activo.vidaUtilMeses))

  const cuota = Decimal.min(bruta.toDecimalPlaces(2), depreciable)
  return new Money(cuota, moneda)
}

/**
 * Líneas del asiento del alta directa (docs/07 §3.1).
 *
 *   Activo fijo        cargo por el costo
 *   Contrapartida                          abono por el costo
 */
export function lineasAsientoAltaManual(
  solicitud: SolicitudActivoManual,
  categoria: CategoriaActivo,
  activo: { id: string; nombre: string },
): LineaSolicitud[] {
  const costo = new Money(solicitud.costoAdquisicion, solicitud.moneda)
    .redondear()
    .toApi()

  return [
    {
      cuenta: categoria.cuentaActivo,
      concepto: activo.nombre,
      cargo: costo,
      abono: '0',
      auxiliarTipo: 'activo',
      auxiliarId: activo.id,
    },
    {
      cuenta: solicitud.cuentaContrapartida,
      concepto: `Alta de activo ${activo.nombre}`,
      cargo: '0',
      abono: costo,
    },
  ]
}

/* --------------------------------------------------- Categorías */

/**
 * Comprueba una de las tres cuentas del mapeo de la categoría.
 *
 * Además de existir y admitir movimientos, cada una tiene que ser del papel que
 * le toca: es lo único que garantiza que la compra que cargue esa cuenta se
 * reconozca luego como activo y que la conciliación de docs/07 §4 cuadre.
 */
function validarCuentaDeMapeo(
  codigo: string,
  papel: { etiqueta: string; cumple: (c: Cuenta) => boolean; exigencia: string },
  cuentas: readonly Cuenta[],
  errores: ErrorActivo[],
): void {
  if (!codigo.trim()) {
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje: `Indique la cuenta de ${papel.etiqueta}`,
    })
    return
  }

  const cuenta = cuentaPorCodigo(cuentas, codigo)
  if (!cuenta) {
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje: `La cuenta ${codigo} no existe en el catálogo`,
    })
    return
  }
  if (!cuenta.esDetalle || !cuenta.activa) {
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje: `La cuenta ${codigo} de ${papel.etiqueta} no admite movimientos`,
    })
    return
  }
  if (!papel.cumple(cuenta)) {
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje: `${codigo} ${cuenta.nombre} no sirve como cuenta de ${papel.etiqueta}: ${papel.exigencia}`,
    })
  }
}

/**
 * Reglas de la categoría de activo (docs/07 §1 y §6).
 *
 * El mapeo contable se resuelve por categoría y nunca por activo individual, así
 * que estas tres cuentas son el contrato con el mayor: la de activo recibe el
 * costo, la de depreciación acumulada lo abate y la de gasto lleva la cuota del
 * periodo. Con una categoría mal mapeada no se rompe esta pantalla, se rompe la
 * conciliación de docs/07 §4 y nadie lo nota hasta el cierre.
 */
export function validarCategoria(
  solicitud: SolicitudCategoriaActivo,
  contexto: ContextoCategoria,
): ResultadoActivo {
  const errores: ErrorActivo[] = []
  const nombre = solicitud.nombre.trim()

  if (!nombre) {
    errores.push({
      codigo: 'NOMBRE_REQUERIDO',
      mensaje: 'La categoría requiere un nombre',
    })
  } else if (
    contexto.categorias.some(
      (c) =>
        c.id !== contexto.categoria?.id &&
        c.nombre.trim().toLocaleLowerCase() === nombre.toLocaleLowerCase(),
    )
  ) {
    errores.push({
      codigo: 'NOMBRE_DUPLICADO',
      mensaje: `Ya existe una categoría llamada ${nombre}`,
    })
  }

  if (!Number.isInteger(solicitud.vidaUtilMeses) || solicitud.vidaUtilMeses < 1) {
    errores.push({
      codigo: 'VIDA_UTIL_INVALIDA',
      mensaje: 'La vida útil debe ser de al menos un mes',
    })
  }

  const residual = decimalDe(solicitud.porcentajeResidual)
  if (!residual || residual.lessThan(0) || residual.greaterThanOrEqualTo(100)) {
    // Al 100% el activo no tendría nada que depreciar: la categoría dejaría de
    // producir cuota y la cédula saldría en cero para siempre.
    errores.push({
      codigo: 'RESIDUAL_INVALIDO',
      mensaje: 'El porcentaje residual va de 0 a menos de 100',
    })
  }

  if (solicitud.tasaFiscalAnual !== null) {
    const tasa = decimalDe(solicitud.tasaFiscalAnual)
    if (!tasa || tasa.lessThanOrEqualTo(0) || tasa.greaterThan(100)) {
      errores.push({
        codigo: 'TASA_FISCAL_INVALIDA',
        mensaje:
          'La tasa fiscal anual va de más de 0 hasta 100. Déjela vacía si coincide con la contable',
      })
    }
  }

  validarCuentaDeMapeo(
    solicitud.cuentaActivo,
    {
      etiqueta: 'activo',
      cumple: esCuentaDeActivoFijo,
      exigencia: 'tiene que ser deudora y llevar auxiliar de activo',
    },
    contexto.cuentas,
    errores,
  )
  validarCuentaDeMapeo(
    solicitud.cuentaDepreciacionAcumulada,
    {
      etiqueta: 'depreciación acumulada',
      cumple: esCuentaDeDepreciacionAcumulada,
      exigencia: 'tiene que ser acreedora y llevar auxiliar de activo',
    },
    contexto.cuentas,
    errores,
  )
  validarCuentaDeMapeo(
    solicitud.cuentaGastoDepreciacion,
    {
      etiqueta: 'gasto por depreciación',
      cumple: esCuentaDeResultados,
      exigencia: 'tiene que ser una cuenta de gasto o de costo',
    },
    contexto.cuentas,
    errores,
  )

  if (solicitud.cuentaActivo === solicitud.cuentaDepreciacionAcumulada) {
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje:
        'El costo y su depreciación acumulada no pueden ir a la misma cuenta: el activo se presentaría neto y el mayor no diría cuánto costó',
    })
  }

  // El mapeo de una categoría con inventario ya está escrito en el mayor: los
  // asientos de las compras cargaron la cuenta vieja y los de la depreciación
  // también. Cambiarla dejaría costo en una cuenta y fichas apuntando a otra,
  // que es exactamente la conciliación de docs/07 §4 rota.
  const anterior = contexto.categoria
  if (anterior && anterior.activos > 0) {
    const movidas = (
      [
        ['cuentaActivo', 'de activo'],
        ['cuentaDepreciacionAcumulada', 'de depreciación acumulada'],
        ['cuentaGastoDepreciacion', 'de gasto por depreciación'],
      ] as const
    ).filter(([campo]) => solicitud[campo] !== anterior[campo])

    for (const [campo, etiqueta] of movidas) {
      errores.push({
        codigo: 'MAPEO_BLOQUEADO',
        mensaje: `La categoría tiene ${anterior.activos} activo${anterior.activos === 1 ? '' : 's'}: la cuenta ${etiqueta} ya no se puede cambiar de ${anterior[campo]} a ${solicitud[campo]}`,
      })
    }
  }

  return { valido: errores.length === 0, errores }
}

/** `Decimal` del texto, o `undefined` si no es un número. */
function decimalDe(valor: string): Decimal | undefined {
  try {
    const numero = new Decimal(valor)
    return numero.isFinite() ? numero : undefined
  } catch {
    return undefined
  }
}

function periodoDe(
  fecha: string,
  periodos: readonly Periodo[],
): Periodo | undefined {
  return periodos.find((p) => fecha >= p.fechaInicio && fecha <= p.fechaFin)
}

function validarFicha(
  datos: {
    nombre: string
    categoriaId: string
    fechaInicioDepreciacion: string
    fechaAdquisicion: string
    costoAdquisicion: string
    valorResidual?: string
    vidaUtilMeses?: number
  },
  categorias: readonly CategoriaActivo[],
  errores: ErrorActivo[],
): CategoriaActivo | undefined {
  if (!datos.nombre.trim()) {
    errores.push({
      codigo: 'NOMBRE_REQUERIDO',
      mensaje: 'El activo requiere un nombre',
    })
  }

  const categoria = categorias.find((c) => c.id === datos.categoriaId)
  if (!categoria) {
    errores.push({
      codigo: 'CATEGORIA_INVALIDA',
      mensaje: 'Seleccione la categoría del activo',
    })
  } else if (!categoria.activa) {
    errores.push({
      codigo: 'CATEGORIA_INVALIDA',
      mensaje: `La categoría ${categoria.nombre} está inactiva`,
    })
  }

  const costo = new Decimal(datos.costoAdquisicion || '0')
  if (costo.lessThanOrEqualTo(0)) {
    errores.push({
      codigo: 'COSTO_INVALIDO',
      mensaje: 'El costo de adquisición debe ser mayor que cero',
    })
  }

  if (categoria) {
    const residual = valorResidualDe(
      datos.costoAdquisicion || '0',
      categoria,
      datos.valorResidual,
    )
    if (residual.lessThan(0)) {
      errores.push({
        codigo: 'RESIDUAL_INVALIDO',
        mensaje: 'El valor residual no puede ser negativo',
      })
    } else if (residual.greaterThanOrEqualTo(costo) && costo.greaterThan(0)) {
      errores.push({
        codigo: 'RESIDUAL_INVALIDO',
        mensaje: 'El valor residual no puede alcanzar el costo del activo',
      })
    }
    if (datos.vidaUtilMeses !== undefined && datos.vidaUtilMeses < 1) {
      errores.push({
        codigo: 'VIDA_UTIL_INVALIDA',
        mensaje: 'La vida útil debe ser de al menos un mes',
      })
    }
  }

  // El activo se deprecia desde que está disponible para su uso, que puede ser
  // después de comprarlo, pero nunca antes (docs/07 §3.1).
  if (datos.fechaInicioDepreciacion < datos.fechaAdquisicion) {
    errores.push({
      codigo: 'FECHA_INICIO_INVALIDA',
      mensaje: 'La depreciación no puede empezar antes de la adquisición',
    })
  }

  return categoria
}

export function validarAltaManual(
  solicitud: SolicitudActivoManual,
  contexto: ContextoAltaManual,
): ResultadoActivo {
  const errores: ErrorActivo[] = []

  const categoria = validarFicha(
    { ...solicitud, valorResidual: solicitud.valorResidual },
    contexto.categorias,
    errores,
  )

  let tipoCambio: Decimal
  try {
    tipoCambio = new Decimal(solicitud.tipoCambio)
  } catch {
    tipoCambio = new Decimal(0)
  }
  if (tipoCambio.lessThanOrEqualTo(0)) {
    errores.push({
      codigo: 'TIPO_CAMBIO_INVALIDO',
      mensaje: 'El tipo de cambio debe ser mayor que cero',
    })
  }

  const periodo = periodoDe(solicitud.fechaAdquisicion, contexto.periodos)
  if (!periodo) {
    errores.push({
      codigo: 'PERIODO_CERRADO',
      mensaje: `No existe un periodo contable que contenga la fecha ${solicitud.fechaAdquisicion}`,
    })
  } else if (periodo.estado !== 'abierto') {
    errores.push({
      codigo: 'PERIODO_CERRADO',
      mensaje: `El periodo ${periodo.numero}/${periodo.ejercicio} está ${periodo.estado}`,
    })
  }

  const contrapartida = contexto.cuentas.find(
    (c) => c.codigo === solicitud.cuentaContrapartida,
  )
  if (!contrapartida) {
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje: `La cuenta ${solicitud.cuentaContrapartida} no existe en el catálogo`,
    })
  } else if (!contrapartida.esDetalle || !contrapartida.activa) {
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje: `La cuenta ${solicitud.cuentaContrapartida} no admite movimientos`,
    })
  } else if (contrapartida.esCuentaControl) {
    // Una contrapartida de control mueve el auxiliar de otro módulo desde
    // fuera: el alta de un activo contra Proveedores es una compra, y esa entra
    // por CxP (docs/03 §2).
    errores.push({
      codigo: 'CUENTA_INVALIDA',
      mensaje: `${solicitud.cuentaContrapartida} es cuenta de control de ${contrapartida.moduloDueno}: registre la compra desde ese módulo`,
    })
  }

  if (categoria) {
    const cuentaActivo = contexto.cuentas.find(
      (c) => c.codigo === categoria.cuentaActivo,
    )
    if (!cuentaActivo?.esDetalle || !cuentaActivo.activa) {
      errores.push({
        codigo: 'CUENTA_INVALIDA',
        mensaje: `La cuenta de activo ${categoria.cuentaActivo} de la categoría no admite movimientos`,
      })
    }
  }

  return { valido: errores.length === 0, errores }
}

export function validarAltaDesdeFactura(
  solicitud: SolicitudActivoDesdeFactura,
  contexto: ContextoAltaDesdeFactura,
): ResultadoActivo {
  const errores: ErrorActivo[] = []

  const pendiente = contexto.pendientes.find(
    (p) => p.facturaId === solicitud.facturaId && p.lineaId === solicitud.lineaId,
  )

  if (!pendiente) {
    errores.push({
      codigo: 'ALTA_NO_DISPONIBLE',
      mensaje:
        'Esa línea de factura ya tiene su activo o no carga una cuenta de activo fijo',
    })
    return { valido: false, errores }
  }

  validarFicha(
    {
      nombre: solicitud.nombre,
      categoriaId: solicitud.categoriaId,
      fechaAdquisicion: pendiente.fecha,
      fechaInicioDepreciacion: solicitud.fechaInicioDepreciacion,
      costoAdquisicion: pendiente.importe,
      valorResidual: solicitud.valorResidual,
      vidaUtilMeses: solicitud.vidaUtilMeses,
    },
    contexto.categorias,
    errores,
  )

  return { valido: errores.length === 0, errores }
}
