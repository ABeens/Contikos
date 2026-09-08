import type {
  ClasificacionNiifBase,
  Cuenta,
  NotaEeffBase,
  SolicitudCuenta,
} from '@/shared/api/contracts/conta'
import {
  type CodigoErrorClasificacion,
  validarPresentacion,
} from './clasificacion'

/**
 * Reglas del catálogo de cuentas (docs/03 §2).
 *
 * El catálogo es el hub del sistema: todo asiento apunta a una cuenta y todo
 * módulo mapea sus hechos económicos contra ella. Por eso el alta valida más de
 * lo que parece necesario y la edición prohíbe casi todo en cuanto la cuenta
 * tiene movimientos: lo que ya está asentado en el mayor no se puede reescribir
 * cambiando la definición de la cuenta debajo.
 *
 * El alta incluye la presentación —el renglón del estado financiero y la nota—
 * porque en una cuenta de detalle es obligatoria: sin ella el saldo se registra
 * en el mayor y no aparece en ningún reporte, y la balanza sigue cuadrando
 * mientras tanto (docs/03 §2 bis).
 */

export type CodigoErrorCuenta =
  | 'CODIGO_REQUERIDO'
  | 'CODIGO_INVALIDO'
  | 'CODIGO_DUPLICADO'
  | 'CODIGO_INMUTABLE'
  | 'NOMBRE_REQUERIDO'
  | 'PADRE_NO_ENCONTRADO'
  | 'PADRE_DE_DETALLE'
  | 'TIPO_DISTINTO_DEL_PADRE'
  | 'MARCA_SOLO_DE_DETALLE'
  | 'CUENTA_CON_MOVIMIENTOS'
  | 'CUENTA_CON_HIJAS'
  // La presentación se valida con las mismas reglas que la reclasifican
  // después, así que trae sus propios códigos (docs/03 §2 bis).
  | CodigoErrorClasificacion

export interface ErrorCuenta {
  readonly codigo: CodigoErrorCuenta
  readonly campo: string
  readonly mensaje: string
}

export interface ResultadoCuenta {
  readonly valido: boolean
  readonly errores: readonly ErrorCuenta[]
}

export interface ContextoCuenta {
  readonly cuentas: readonly Cuenta[]
  /**
   * Códigos de cuenta que ya aparecen en algún asiento.
   *
   * Se pasa resuelto en vez de los asientos enteros: lo único que la regla
   * necesita saber es si el mayor ya depende de esta cuenta.
   */
  readonly conMovimientos: ReadonlySet<string>
  /**
   * Catálogos de presentación, para validar el renglón y la nota que la cuenta
   * declara. Son parte del alta: una cuenta de detalle no nace sin ellos.
   */
  readonly clasificaciones: readonly ClasificacionNiifBase[]
  readonly notas: readonly NotaEeffBase[]
  /** La cuenta que se edita. Ausente cuando se da de alta una nueva. */
  readonly cuenta?: Cuenta
}

/** Código de la cuenta madre, o `null` si el código es de primer nivel. */
export function codigoPadreDe(codigo: string): string | null {
  const partes = codigo.split('.')
  return partes.length === 1 ? null : partes.slice(0, -1).join('.')
}

/** Nivel del código: `1.2.01.004` está en el cuarto. */
export function nivelDe(codigo: string): number {
  return codigo.split('.').length
}

/**
 * Ordena dos códigos como los lee un contador.
 *
 * Segmento a segmento y por número, no por texto: `1.1.01.010` va después de
 * `1.1.01.002`, que es lo contrario de lo que diría un `localeCompare`. La
 * madre va siempre antes que sus hijas porque es prefijo de todas.
 */
export function compararCodigos(a: string, b: string): number {
  const izquierda = a.split('.')
  const derecha = b.split('.')

  for (let i = 0; i < Math.min(izquierda.length, derecha.length); i += 1) {
    const diferencia = Number(izquierda[i]) - Number(derecha[i])
    if (diferencia !== 0) return diferencia
  }
  return izquierda.length - derecha.length
}

/** Cuentas que cuelgan directamente de un código. */
export function hijasDe(
  cuentas: readonly Cuenta[],
  codigo: string,
): readonly Cuenta[] {
  return cuentas.filter((c) => codigoPadreDe(c.codigo) === codigo)
}

function validarAlta(
  solicitud: SolicitudCuenta,
  contexto: ContextoCuenta,
  errores: ErrorCuenta[],
): void {
  if (contexto.cuentas.some((c) => c.codigo === solicitud.codigo)) {
    errores.push({
      codigo: 'CODIGO_DUPLICADO',
      campo: 'codigo',
      mensaje: `El código ${solicitud.codigo} ya está en el catálogo`,
    })
  }
}

/**
 * Comprueba la cuenta contra su madre.
 *
 * Dos reglas, y las dos son del mayor y no de la pantalla: una cuenta no puede
 * colgar de otra que recibe movimientos, porque entonces el saldo de la madre
 * sería a la vez suyo y de sus hijas y la balanza contaría el importe dos
 * veces; y no puede ser de un tipo distinto del de su madre, porque la
 * acumulativa suma lo que cuelga de ella y un gasto dentro del activo movería
 * el balance con lo que gastó la empresa.
 */
function validarContraLaMadre(
  solicitud: SolicitudCuenta,
  contexto: ContextoCuenta,
  errores: ErrorCuenta[],
): void {
  const codigoPadre = codigoPadreDe(solicitud.codigo)
  if (!codigoPadre) return

  const madre = contexto.cuentas.find((c) => c.codigo === codigoPadre)
  if (!madre) {
    errores.push({
      codigo: 'PADRE_NO_ENCONTRADO',
      campo: 'codigo',
      mensaje: `No existe la cuenta ${codigoPadre}, de la que colgaría ${solicitud.codigo}. Créela primero`,
    })
    return
  }

  if (madre.esDetalle) {
    errores.push({
      codigo: 'PADRE_DE_DETALLE',
      campo: 'codigo',
      mensaje: `${madre.codigo} ${madre.nombre} es cuenta de detalle y recibe movimientos: no puede tener cuentas por debajo`,
    })
  }

  if (madre.tipo !== solicitud.tipo) {
    errores.push({
      codigo: 'TIPO_DISTINTO_DEL_PADRE',
      campo: 'tipo',
      mensaje: `${solicitud.codigo} cuelga de ${madre.codigo}, que es de tipo ${madre.tipo}: hereda su tipo`,
    })
  }
}

/**
 * Marcas que solo tienen sentido en una cuenta de detalle.
 *
 * Una acumulativa nunca recibe una línea de asiento, así que exigirle auxiliar,
 * declararla de control o fijarle moneda no cambia nada: son promesas que
 * ninguna validación va a comprobar jamás.
 */
function validarMarcas(
  solicitud: SolicitudCuenta,
  errores: ErrorCuenta[],
): void {
  if (solicitud.esDetalle) return

  const marcas: [valor: unknown, campo: string, texto: string][] = [
    [solicitud.requiereAuxiliar, 'requiereAuxiliar', 'exigir auxiliar'],
    [solicitud.moduloDueno, 'moduloDueno', 'ser cuenta de control'],
    [solicitud.moneda, 'moneda', 'fijar moneda'],
  ]

  for (const [valor, campo, texto] of marcas) {
    if (valor) {
      errores.push({
        codigo: 'MARCA_SOLO_DE_DETALLE',
        campo,
        mensaje: `Una cuenta acumulativa no recibe movimientos: no puede ${texto}`,
      })
    }
  }
}

/**
 * Comprueba una edición contra lo que el mayor ya escribió.
 *
 * Con movimientos asentados, la definición de la cuenta deja de ser editable:
 * invertir la naturaleza le cambia el signo al saldo que ya está en la balanza,
 * y volverla acumulativa o de control retroactivamente dejaría en el mayor
 * líneas que ninguna regla vigente habría aceptado. Lo que sí se puede es
 * renombrarla y desactivarla, que no tocan nada de lo asentado.
 */
function validarEdicion(
  solicitud: SolicitudCuenta,
  anterior: Cuenta,
  contexto: ContextoCuenta,
  errores: ErrorCuenta[],
): void {
  if (solicitud.codigo !== anterior.codigo) {
    // Cada línea de asiento guarda el código: cambiarlo dejaría al mayor
    // apuntando a una cuenta que ya no existe.
    errores.push({
      codigo: 'CODIGO_INMUTABLE',
      campo: 'codigo',
      mensaje: `El código de una cuenta no se cambia. Desactive ${anterior.codigo} y cree la nueva`,
    })
  }

  const tieneMovimientos = contexto.conMovimientos.has(anterior.codigo)
  if (tieneMovimientos) {
    const bloqueadas: [campo: keyof SolicitudCuenta, etiqueta: string][] = [
      ['tipo', 'el tipo'],
      ['naturaleza', 'la naturaleza'],
      ['esDetalle', 'si es cuenta de detalle'],
      ['requiereAuxiliar', 'el auxiliar que exige'],
      ['moduloDueno', 'el módulo dueño'],
      ['moneda', 'la moneda'],
    ]

    for (const [campo, etiqueta] of bloqueadas) {
      if (solicitud[campo] !== anterior[campo]) {
        errores.push({
          codigo: 'CUENTA_CON_MOVIMIENTOS',
          campo,
          mensaje: `${anterior.codigo} ya tiene movimientos en el mayor: ${etiqueta} no se puede cambiar`,
        })
      }
    }
  }

  // Volverla de detalle con cuentas colgando la convertiría en madre y en
  // receptora de movimientos a la vez, y su saldo contaría dos veces.
  if (solicitud.esDetalle && !anterior.esDetalle) {
    const hijas = hijasDe(contexto.cuentas, anterior.codigo)
    if (hijas.length > 0) {
      errores.push({
        codigo: 'CUENTA_CON_HIJAS',
        campo: 'esDetalle',
        mensaje: `${anterior.codigo} tiene ${hijas.length} cuenta(s) por debajo: no puede recibir movimientos mientras las tenga`,
      })
    }
  }
}

/**
 * Valida el alta o la edición de una cuenta.
 *
 * Sin `contexto.cuenta` es un alta; con ella, la edición de esa cuenta.
 */
export function validarCuenta(
  solicitud: SolicitudCuenta,
  contexto: ContextoCuenta,
): ResultadoCuenta {
  const errores: ErrorCuenta[] = []

  if (!solicitud.codigo.trim()) {
    errores.push({
      codigo: 'CODIGO_REQUERIDO',
      campo: 'codigo',
      mensaje: 'La cuenta requiere un código',
    })
  } else if (!/^\d+(\.\d+)*$/.test(solicitud.codigo)) {
    errores.push({
      codigo: 'CODIGO_INVALIDO',
      campo: 'codigo',
      mensaje: 'El código son números separados por puntos, como 1.2.01.004',
    })
  } else if (contexto.cuenta) {
    validarEdicion(solicitud, contexto.cuenta, contexto, errores)
  } else {
    validarAlta(solicitud, contexto, errores)
  }

  if (!solicitud.nombre.trim()) {
    errores.push({
      codigo: 'NOMBRE_REQUERIDO',
      campo: 'nombre',
      mensaje: 'La cuenta requiere un nombre',
    })
  }

  validarContraLaMadre(solicitud, contexto, errores)
  validarMarcas(solicitud, errores)

  // La presentación se comprueba con la misma función que usa el endpoint de
  // reclasificación: la regla es una sola y no dos que se parecen.
  for (const error of validarPresentacion(solicitud, solicitud, contexto)) {
    errores.push({ ...error, campo: error.campo ?? 'clasificacionNiifId' })
  }

  return { valido: errores.length === 0, errores }
}
