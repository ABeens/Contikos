import Decimal from 'decimal.js'
import type {
  FilaRechazada,
  FormatoImportacion,
  MovimientoEstadoCuenta,
} from '@/shared/api/contracts/bancos'

/**
 * Importación del estado de cuenta (docs/06 §2.2).
 *
 * ```
 * cargar archivo → parsear → normalizar → detectar duplicados → guardar
 * ```
 *
 * **El parser es por banco, tras una interfaz común.** Cada banco exporta
 * distinto y es trabajo que no termina nunca: lo único que se puede hacer es
 * que añadir el siguiente no toque nada de lo que ya funciona. La interfaz es
 * `ParserEstadoCuenta` y el respaldo universal es el CSV genérico, que es lo
 * que se usa cuando aparece un formato nuevo y todavía no tiene el suyo.
 *
 * La misma interfaz es la que un día podrá tener una implementación por API
 * (docs/06 §7) sin cambiar el resto del módulo: lo que cambia es de dónde sale
 * el texto, no qué se hace con las filas.
 */

/** Una línea ya leída del archivo, antes de convertirse en movimiento. */
export interface FilaEstadoCuenta {
  /** Número de línea en el archivo. Es lo que se cita al rechazar una. */
  readonly linea: number
  readonly fechaOperacion: string
  readonly fechaValor: string
  readonly descripcion: string
  readonly referencia: string | null
  /** Lo que salió. Positivo o cero. */
  readonly cargo: string
  /** Lo que entró. Positivo o cero. */
  readonly abono: string
  readonly saldo: string | null
}

export interface ResultadoParseo {
  readonly filas: readonly FilaEstadoCuenta[]
  readonly rechazadas: readonly FilaRechazada[]
  /** Líneas de datos leídas, válidas o no. No cuenta la cabecera. */
  readonly leidas: number
}

/**
 * Lo que tiene que saber hacer el lector de un banco.
 *
 * Solo dos cosas: decir si un texto se parece a lo suyo y convertirlo en filas.
 * Nada de duplicados, nada de guardar, nada de saldos: eso es igual para todos
 * los bancos y vive fuera.
 */
export interface ParserEstadoCuenta {
  readonly id: string
  readonly nombre: string
  readonly descripcion: string
  /** Reconoce su propio formato. Se usa para proponer, nunca para decidir solo. */
  reconoce(texto: string): boolean
  parsear(texto: string): ResultadoParseo
}

/* --------------------------------------------------------- Utilidades */

/**
 * Fecha del archivo a fecha contable (`yyyy-MM-dd`).
 *
 * Se aceptan las dos formas que llegan de verdad: la ISO que usan los archivos
 * generados por sistema y `dd/MM/yyyy`, que es como la exporta la banca en
 * línea de Costa Rica. `MM/dd/yyyy` NO se acepta a propósito: es
 * indistinguible de la anterior en los doce primeros días del mes, y adivinar
 * ahí produce movimientos con fecha equivocada que nadie detecta.
 */
export function normalizarFecha(texto: string): string | null {
  const limpio = texto.trim()

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(limpio)
  if (iso) return limpio

  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(limpio)
  if (local) {
    const [, dia, mes, ano] = local
    if (Number(mes) < 1 || Number(mes) > 12) return null
    if (Number(dia) < 1 || Number(dia) > 31) return null
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
  }

  return null
}

/**
 * Importe del archivo a importe canónico.
 *
 * Los bancos exportan `1.234,56` y `1,234.56` según de dónde venga la
 * plantilla, y a veces con símbolo. Se decide cuál es el separador decimal por
 * el ÚLTIMO separador que aparece, que es el único criterio que funciona con
 * las dos convenciones. Vacío es cero: en un estado de cuenta, la columna que
 * no aplica se deja en blanco.
 */
export function normalizarImporte(texto: string): string | null {
  const limpio = texto.replace(/[^\d,.-]/g, '').trim()
  // Con dos decimales como todo importe del sistema: una columna vacía es un
  // cero, no una forma distinta de escribirlo.
  if (limpio === '' || limpio === '-') return '0.00'

  const ultimaComa = limpio.lastIndexOf(',')
  const ultimoPunto = limpio.lastIndexOf('.')
  let canonico = limpio

  if (ultimaComa > ultimoPunto) {
    // La coma es el decimal: los puntos son separadores de miles.
    canonico = limpio.replace(/\./g, '').replace(',', '.')
  } else if (ultimoPunto > ultimaComa) {
    canonico = limpio.replace(/,/g, '')
  } else {
    // Ni coma ni punto: es un entero.
    canonico = limpio
  }

  try {
    return new Decimal(canonico).toFixed(2)
  } catch {
    return null
  }
}

/**
 * Separador de columnas del archivo.
 *
 * Se decide por la primera línea y por mayoría, no por configuración: el punto
 * y coma es lo que produce Excel en configuración regional española, y pedirle
 * al usuario que lo declare es pedirle que sepa algo que no tiene por qué.
 */
export function detectarSeparador(primeraLinea: string): string {
  const candidatos = [';', ',', '\t', '|']
  return candidatos.reduce((mejor, sep) =>
    primeraLinea.split(sep).length > primeraLinea.split(mejor).length
      ? sep
      : mejor,
  )
}

/** Parte una línea de CSV respetando las comillas dobles. */
export function partirLinea(linea: string, separador: string): string[] {
  const campos: string[] = []
  let actual = ''
  let entreComillas = false

  for (let i = 0; i < linea.length; i += 1) {
    const caracter = linea[i]
    if (caracter === '"') {
      // Dos comillas seguidas dentro de un campo entrecomillado son una comilla
      // literal, que es como lo escribe todo el mundo.
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"'
        i += 1
      } else {
        entreComillas = !entreComillas
      }
    } else if (caracter === separador && !entreComillas) {
      campos.push(actual)
      actual = ''
    } else {
      actual += caracter
    }
  }
  campos.push(actual)
  return campos.map((c) => c.trim())
}

/* ------------------------------------------------------ CSV genérico */

/**
 * Nombres de columna que se reconocen, por rol.
 *
 * Se comparan sin tildes ni mayúsculas y por inclusión, que es lo que aguanta
 * las variantes reales: "Fecha", "FECHA MOVIMIENTO", "Fecha de operación".
 */
const COLUMNAS: Record<string, readonly string[]> = {
  fechaOperacion: ['fecha operacion', 'fecha movimiento', 'fecha'],
  fechaValor: ['fecha valor'],
  descripcion: ['descripcion', 'concepto', 'detalle', 'referencia ampliada'],
  referencia: ['referencia', 'documento', 'numero documento'],
  cargo: ['debito', 'debe', 'cargo', 'retiro'],
  abono: ['credito', 'haber', 'abono', 'deposito'],
  /** Una sola columna con signo: es lo que exporta media banca en línea. */
  importe: ['importe', 'monto', 'valor'],
  saldo: ['saldo', 'balance'],
}

function sinTildes(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Empareja las columnas del archivo con los roles que el módulo necesita.
 *
 * El orden de los candidatos importa: "fecha valor" se comprueba antes que
 * "fecha" en su propio rol, y por eso la cabecera se recorre una vez por rol
 * buscando la coincidencia más específica primero.
 */
export function mapearColumnas(
  cabecera: readonly string[],
): Record<string, number> {
  const normalizada = cabecera.map(sinTildes)
  const mapa: Record<string, number> = {}

  for (const [rol, nombres] of Object.entries(COLUMNAS)) {
    for (const nombre of nombres) {
      const indice = normalizada.findIndex(
        (c) => c === nombre || c.includes(nombre),
      )
      // La columna de fecha de valor no puede robarle la suya a la de
      // operación, ni la de referencia a la de descripción.
      if (indice !== -1 && !Object.values(mapa).includes(indice)) {
        mapa[rol] = indice
        break
      }
    }
  }

  return mapa
}

/**
 * Lector de CSV genérico: el respaldo para cuando aparece un formato nuevo.
 *
 * Acepta cabecera con los nombres habituales y las dos disposiciones de
 * importes que se ven en la práctica: dos columnas de cargo y abono, o una
 * sola con signo. Sin cabecera reconocible no adivina el orden de las
 * columnas: rechaza el archivo entero y lo dice, que es mejor que importar
 * cuarenta movimientos con la fecha en el campo del importe.
 */
export const PARSER_CSV_GENERICO: ParserEstadoCuenta = {
  id: 'csv_generico',
  nombre: 'CSV genérico',
  descripcion:
    'Archivo separado por comas o punto y coma, con cabecera. Columnas de fecha, descripción, débito y crédito, o una sola de importe con signo.',

  reconoce(texto) {
    const primera = texto.split(/\r?\n/)[0] ?? ''
    const columnas = mapearColumnas(
      partirLinea(primera, detectarSeparador(primera)),
    )
    return columnas.fechaOperacion !== undefined
  },

  parsear(texto) {
    const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== '')
    const rechazadas: FilaRechazada[] = []
    const filas: FilaEstadoCuenta[] = []

    if (lineas.length === 0) {
      return { filas, rechazadas, leidas: 0 }
    }

    const separador = detectarSeparador(lineas[0])
    const columnas = mapearColumnas(partirLinea(lineas[0], separador))

    if (columnas.fechaOperacion === undefined) {
      return {
        filas,
        leidas: 0,
        rechazadas: [
          {
            linea: 1,
            contenido: lineas[0],
            motivo:
              'No se reconoce la cabecera: hace falta al menos una columna de fecha',
          },
        ],
      }
    }

    /*
     * Dos disposiciones posibles y ninguna configurable: o hay columnas
     * separadas de cargo y abono, o hay una sola con signo. Se decide por lo
     * que trae la cabecera, no por lo que declare el usuario.
     */
    const conSigno =
      columnas.cargo === undefined &&
      columnas.abono === undefined &&
      columnas.importe !== undefined

    if (columnas.cargo === undefined && columnas.abono === undefined && !conSigno) {
      return {
        filas,
        leidas: 0,
        rechazadas: [
          {
            linea: 1,
            contenido: lineas[0],
            motivo:
              'No se reconoce ninguna columna de importe: hacen falta débito y crédito, o una sola de importe con signo',
          },
        ],
      }
    }

    for (let i = 1; i < lineas.length; i += 1) {
      const contenido = lineas[i]
      const campos = partirLinea(contenido, separador)
      const numero = i + 1

      const valor = (rol: string): string =>
        columnas[rol] === undefined ? '' : (campos[columnas[rol]] ?? '')

      const fechaOperacion = normalizarFecha(valor('fechaOperacion'))
      if (!fechaOperacion) {
        rechazadas.push({
          linea: numero,
          contenido,
          motivo: `Fecha ilegible: "${valor('fechaOperacion')}". Se esperaba aaaa-mm-dd o dd/mm/aaaa`,
        })
        continue
      }

      let cargo: string | null
      let abono: string | null

      if (conSigno) {
        const importe = normalizarImporte(valor('importe'))
        if (importe === null) {
          rechazadas.push({ linea: numero, contenido, motivo: 'Importe ilegible' })
          continue
        }
        // El signo decide la columna: negativo es lo que el banco cargó.
        const monto = new Decimal(importe)
        cargo = monto.isNegative() ? monto.abs().toFixed(2) : '0.00'
        abono = monto.isNegative() ? '0.00' : monto.toFixed(2)
      } else {
        cargo = normalizarImporte(valor('cargo'))
        abono = normalizarImporte(valor('abono'))
        if (cargo === null || abono === null) {
          rechazadas.push({ linea: numero, contenido, motivo: 'Importe ilegible' })
          continue
        }
      }

      const movido = new Decimal(cargo).plus(abono)
      if (movido.isZero()) {
        // Una línea sin importe no es un movimiento: suele ser un separador de
        // secciones o el pie del archivo con el saldo.
        rechazadas.push({
          linea: numero,
          contenido,
          motivo: 'La línea no tiene importe',
        })
        continue
      }

      const descripcion = valor('descripcion').trim()
      const referencia = valor('referencia').trim()
      const saldo = normalizarImporte(valor('saldo'))

      filas.push({
        linea: numero,
        fechaOperacion,
        // Sin fecha de valor propia se usa la de operación, que es lo que hace
        // el banco cuando no las distingue.
        fechaValor:
          normalizarFecha(valor('fechaValor')) ?? fechaOperacion,
        descripcion: descripcion || 'Movimiento sin descripción',
        referencia: referencia || null,
        cargo,
        abono,
        saldo: valor('saldo').trim() === '' ? null : saldo,
      })
    }

    return { filas, rechazadas, leidas: lineas.length - 1 }
  },
}

/**
 * Lectores disponibles.
 *
 * Uno por ahora. Añadir el de un banco concreto es añadirlo a esta lista y
 * nada más: ni la importación, ni la deduplicación, ni la conciliación lo
 * conocen (docs/06 §2.2).
 */
export const PARSERS: readonly ParserEstadoCuenta[] = [PARSER_CSV_GENERICO]

export function parserPorId(id: string): ParserEstadoCuenta | undefined {
  return PARSERS.find((p) => p.id === id)
}

/**
 * Los lectores, en la forma que viaja por la API.
 *
 * Sin ejemplo: un archivo de muestra depende de los datos de la empresa y lo
 * pone quien los tiene, no el lector.
 */
export function formatosDisponibles(): FormatoImportacion[] {
  return PARSERS.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    ejemplo: null,
  }))
}

/* ------------------------------------------------------- Duplicados */

/**
 * Huella de una línea del estado de cuenta.
 *
 * `(cuenta, fecha de operación, importe con signo, referencia)`, que es la
 * clave que propone docs/06 §2.2. La descripción NO entra: el mismo movimiento
 * puede venir descrito distinto en dos exportaciones del mismo banco, y meterla
 * convertiría cada recarga en una tanda de duplicados.
 *
 * Cuando no hay referencia entra la descripción normalizada como último
 * recurso. Es peor huella, pero sin ella dos comisiones iguales del mismo día
 * serían indistinguibles y se perdería la segunda.
 */
export function huellaDe(
  cuentaBancariaId: string,
  fila: Pick<
    FilaEstadoCuenta,
    'fechaOperacion' | 'cargo' | 'abono' | 'referencia' | 'descripcion'
  >,
): string {
  const importe = new Decimal(fila.abono).minus(fila.cargo).toFixed(2)
  const identidad = fila.referencia?.trim()
    ? fila.referencia.trim().toLowerCase()
    : sinTildes(fila.descripcion)
  return `${cuentaBancariaId}|${fila.fechaOperacion}|${importe}|${identidad}`
}

/**
 * Reparte las filas leídas entre nuevas y ya conocidas.
 *
 * Compara contra lo ya importado y también dentro del propio archivo: un
 * archivo que repite una línea consigo mismo es tan duplicado como uno que
 * repite lo de la carga anterior.
 */
export function separarDuplicados(
  cuentaBancariaId: string,
  filas: readonly FilaEstadoCuenta[],
  existentes: readonly MovimientoEstadoCuenta[],
): { nuevas: FilaEstadoCuenta[]; duplicadas: FilaEstadoCuenta[] } {
  const conocidas = new Set(
    existentes
      .filter((m) => m.cuentaBancariaId === cuentaBancariaId)
      .map((m) => m.huella),
  )
  const nuevas: FilaEstadoCuenta[] = []
  const duplicadas: FilaEstadoCuenta[] = []

  for (const fila of filas) {
    const huella = huellaDe(cuentaBancariaId, fila)
    if (conocidas.has(huella)) {
      duplicadas.push(fila)
    } else {
      conocidas.add(huella)
      nuevas.push(fila)
    }
  }

  return { nuevas, duplicadas }
}

/**
 * Saldo que el archivo declara al final del periodo.
 *
 * Es el de la última línea por fecha que lo traiga. Nulo cuando el formato no
 * lleva columna de saldo: entonces la conciliación lo pide a mano, porque sin
 * él no hay contra qué cuadrar.
 */
export function saldoFinalDe(
  filas: readonly FilaEstadoCuenta[],
): string | null {
  const conSaldo = filas.filter((f) => f.saldo !== null)
  if (conSaldo.length === 0) return null
  return [...conSaldo].sort(
    (a, b) => a.fechaOperacion.localeCompare(b.fechaOperacion) || a.linea - b.linea,
  )[conSaldo.length - 1].saldo
}
