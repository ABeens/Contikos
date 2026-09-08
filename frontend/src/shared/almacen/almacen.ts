/**
 * Persistencia local de la aplicación.
 *
 * Mientras no exista el backend, los datos tienen que vivir en algún sitio que
 * sobreviva a un F5. Un array en memoria no lo hace: se captura una factura, se
 * recarga la página y el trabajo desapareció. Eso no es un backend simulado,
 * es una demo.
 *
 * Esta capa hace de base de datos: colecciones tipadas guardadas en
 * `localStorage`, sembradas la primera vez y leídas tal cual a partir de
 * entonces. Nada por encima de ella sabe que es `localStorage`; el día que la
 * API exista, los servicios cambian de origen y esto se borra sin tocar una
 * pantalla.
 *
 * Lo que NO es: un motor de consultas. No hay índices, ni transacciones, ni
 * consultas por criterio. Las colecciones son pequeñas (el catálogo de cuentas
 * de una PYME, los asientos de un ejercicio) y quien las filtra es el servicio.
 *
 * Multiempresa (docs/01 §4.1): cada colección de empresa se guarda bajo el
 * espacio de nombres de la empresa activa, y cambiar de empresa recarga todas
 * en su sitio. Es el equivalente local del filtro obligatorio por `empresa_id`
 * que tendrá el repositorio del backend (docs/12 D-03): ningún handler puede
 * leer datos de otra empresa porque el array que tiene delante ya es el de la
 * activa. Las pocas colecciones que son del grupo y no de una empresa (el
 * catálogo de empresas) se declaran aparte con `tablaGlobal`.
 */

const PREFIJO = 'contikos'

/**
 * Versión del formato almacenado.
 *
 * Se sube a mano cuando cambia la FORMA de algo que ya está guardado (un campo
 * nuevo obligatorio, un contrato que se renombra). Los datos de una versión
 * anterior se ignoran y la colección se vuelve a sembrar: en esta etapa son
 * datos de demostración, y arrastrar una fila con la forma vieja produce un
 * fallo de contrato mucho más difícil de leer que un catálogo reiniciado.
 */
const VERSION = 2

/**
 * Empresa con la que arranca un navegador que nunca eligió una.
 *
 * Es también el id de la empresa de demostración principal: la semilla la
 * toma de aquí para que exista una sola fuente del dato.
 */
export const EMPRESA_INICIAL = 'emp-001'

/** Espacio de nombres de las colecciones que son del grupo, no de una empresa. */
const ESPACIO_GRUPO = 'grupo'

/** Dónde se recuerda qué empresa quedó abierta. Fuera de toda versión y empresa. */
const CLAVE_EMPRESA_ACTIVA = `${PREFIJO}.empresa-activa`

/**
 * `localStorage` no siempre está.
 *
 * En navegación privada de algunos navegadores existe pero lanza al escribir, y
 * bajo pruebas de nodo sin jsdom no existe en absoluto. En los dos casos la
 * aplicación tiene que seguir funcionando: se degrada a memoria y se avisa una
 * vez, en lugar de romper la pantalla por no poder guardar.
 */
function almacenDisponible(): Storage | null {
  try {
    const prueba = `${PREFIJO}.prueba`
    window.localStorage.setItem(prueba, '1')
    window.localStorage.removeItem(prueba)
    return window.localStorage
  } catch {
    return null
  }
}

let avisado = false

function avisarUnaVez(mensaje: string, causa?: unknown): void {
  if (avisado) return
  avisado = true
  console.warn(`[almacen] ${mensaje} Los cambios durarán solo esta sesión.`, causa)
}

function leerEmpresaGuardada(): string {
  const almacen = almacenDisponible()
  const guardada = almacen?.getItem(CLAVE_EMPRESA_ACTIVA)?.trim()
  return guardada ? guardada : EMPRESA_INICIAL
}

/**
 * Empresa activa de esta sesión.
 *
 * Es estado de módulo y no de React a propósito: la leen los servicios para
 * poner la cabecera de empresa en cada petición y la lee el mock para saber
 * qué colecciones servir, y ninguno de los dos tiene acceso al árbol de
 * componentes. React la refleja; no la posee.
 */
let empresaActual = leerEmpresaGuardada()

export function empresaActiva(): string {
  return empresaActual
}

function clave(nombre: string, espacio: string): string {
  return `${PREFIJO}.v${VERSION}.${espacio}.${nombre}`
}

function leerCrudo(claveCompleta: string): unknown {
  const almacen = almacenDisponible()
  if (!almacen) {
    avisarUnaVez('No hay almacenamiento local disponible.')
    return undefined
  }

  const texto = almacen.getItem(claveCompleta)
  if (texto === null) return undefined

  try {
    return JSON.parse(texto)
  } catch (error) {
    // Un JSON corrupto es dato perdido, no un motivo para dejar la aplicación
    // sin arrancar: se descarta la colección y se vuelve a sembrar.
    console.warn(`[almacen] "${claveCompleta}" está corrupto y se descarta.`, error)
    almacen.removeItem(claveCompleta)
    return undefined
  }
}

function escribirCrudo(claveCompleta: string, valor: unknown): void {
  const almacen = almacenDisponible()
  if (!almacen) return

  try {
    almacen.setItem(claveCompleta, JSON.stringify(valor))
  } catch (error) {
    // Cuota agotada, casi siempre. No se pierde nada de lo que hay en pantalla:
    // el array en memoria sigue siendo la verdad de esta sesión.
    avisarUnaVez(`No se pudo guardar "${claveCompleta}".`, error)
  }
}

/**
 * Semilla de una colección.
 *
 * Recibe la empresa para la que se siembra: la de demostración arranca con
 * documentos y saldos, una empresa recién creada arranca con el catálogo de
 * cuentas de plantilla y nada más. Una semilla que no distingue empresas
 * ignora el argumento.
 */
export type Semilla<T> = (empresaId: string) => T[]

export type AmbitoTabla = 'empresa' | 'grupo'

export interface OpcionesTabla<T> {
  /**
   * Se invoca cada vez que el contenido cambia de golpe: al cambiar de empresa,
   * al reemplazarlo y al restablecer. Es el sitio para reconstruir un índice
   * derivado (un mapa por código) que de otro modo seguiría apuntando a las
   * filas de la empresa anterior.
   */
  alCambiar?: (filas: readonly T[]) => void
}

/**
 * Una colección persistente.
 *
 * `filas` es un array normal y mutable, y esa es la parte importante: quien lo
 * usa lo recorre, lo filtra y lo muta como cualquier otro array. Lo único que
 * añade la tabla es `persistir()`, que se llama después de haber cambiado algo.
 *
 * Guardar es explícito a propósito. La alternativa (un Proxy que detecte
 * mutaciones) no ve `Object.assign(fila, cambios)` sobre un elemento, que es
 * justo como se edita una cuenta, así que guardaría a veces sí y a veces no.
 * Una llamada visible es más fácil de auditar que una magia que falla callada.
 */
export interface Tabla<T> {
  readonly nombre: string
  /** De la empresa activa, o del grupo entero. */
  readonly ambito: AmbitoTabla
  readonly filas: T[]
  /** Guarda el estado actual de `filas`. Se llama tras cada mutación. */
  persistir(): void
  /** Sustituye el contenido conservando la referencia de `filas`. */
  reemplazar(nuevas: readonly T[]): void
  /** Vuelve a la semilla. */
  restablecer(): void
}

interface TablaInterna<T> extends Tabla<T> {
  readonly semilla: Semilla<T>
  /** Vuelve a leer lo guardado para la empresa activa, en su sitio. */
  recargar(): void
}

const TABLAS: TablaInterna<unknown>[] = []

function crearTabla<T>(
  nombre: string,
  semilla: Semilla<T>,
  ambito: AmbitoTabla,
  opciones: OpcionesTabla<T>,
): TablaInterna<T> {
  const espacio = () => (ambito === 'grupo' ? ESPACIO_GRUPO : empresaActual)
  const claveActual = () => clave(nombre, espacio())

  /**
   * La semilla se evalúa solo cuando no hay nada guardado: al recargar, lo que
   * mande es lo que el usuario hizo, no el dato de fábrica. La primera vez se
   * deja escrita, para que lo que se ve en pantalla y lo que hay guardado sean
   * lo mismo desde el arranque.
   *
   * No valida contra el contrato Zod al leer. Se consideró, pero el contrato es
   * lo que la API promete DEVOLVER, y varias colecciones guardan la forma
   * interna (una moneda sin sus campos derivados, por ejemplo). La validación
   * está donde corresponde: en el servicio, sobre lo que entra y lo que sale.
   */
  const cargar = (): T[] => {
    const guardado = leerCrudo(claveActual())
    if (Array.isArray(guardado)) return guardado as T[]
    const sembrado = semilla(empresaActual)
    escribirCrudo(claveActual(), sembrado)
    return sembrado
  }

  const filas: T[] = cargar()

  const instancia: TablaInterna<T> = {
    nombre,
    ambito,
    filas,
    semilla,
    persistir() {
      escribirCrudo(claveActual(), filas)
    },
    reemplazar(nuevas) {
      filas.splice(0, filas.length, ...nuevas)
      instancia.persistir()
      opciones.alCambiar?.(filas)
    },
    restablecer() {
      instancia.reemplazar(semilla(empresaActual))
    },
    recargar() {
      filas.splice(0, filas.length, ...cargar())
      opciones.alCambiar?.(filas)
    },
  }

  TABLAS.push(instancia as TablaInterna<unknown>)
  return instancia
}

/**
 * Declara una colección de la empresa activa.
 *
 * Al cambiar de empresa se recarga en su sitio con los datos de la nueva,
 * conservando la referencia de `filas`: media aplicación importa ese array.
 */
export function tabla<T>(
  nombre: string,
  semilla: Semilla<T>,
  opciones: OpcionesTabla<T> = {},
): Tabla<T> {
  return crearTabla(nombre, semilla, 'empresa', opciones)
}

/**
 * Declara una colección del grupo.
 *
 * Son pocas y se cuentan con una mano: el catálogo de empresas, y el día que
 * exista, el de usuarios. No dependen de qué empresa esté abierta y por eso no
 * se recargan al cambiar.
 */
export function tablaGlobal<T>(
  nombre: string,
  semilla: Semilla<T>,
  opciones: OpcionesTabla<T> = {},
): Tabla<T> {
  return crearTabla(nombre, semilla, 'grupo', opciones)
}

/**
 * Cambia la empresa activa y recarga sus colecciones.
 *
 * Las colecciones se recargan en el orden en que se declararon, que es el
 * orden de importación y respeta las dependencias entre semillas: las
 * facturas leen la razón social del cliente, así que los clientes van antes.
 *
 * La elección se recuerda para que al volver a abrir la aplicación se entre en
 * la misma empresa en la que se estaba trabajando.
 */
export function establecerEmpresaActiva(empresaId: string): void {
  if (empresaId === empresaActual) return
  empresaActual = empresaId

  const almacen = almacenDisponible()
  try {
    almacen?.setItem(CLAVE_EMPRESA_ACTIVA, empresaId)
  } catch (error) {
    avisarUnaVez('No se pudo recordar la empresa activa.', error)
  }

  for (const t of TABLAS) {
    if (t.ambito === 'empresa') t.recargar()
  }
}

/**
 * Lee una colección de una empresa que puede no ser la activa.
 *
 * Es la única lectura cruzada que existe, y es de solo lectura: la usa el
 * directorio de terceros del grupo para proponer la identidad de un cliente o
 * proveedor que ya existe en otra empresa (docs/12 D-12). Devuelve una copia;
 * escribir en otra empresa no es posible desde aquí, a propósito.
 *
 * De la empresa activa devuelve lo vivo, con lo que aún no se ha persistido.
 * De las demás, lo guardado; y si nunca se abrieron, lo que sembrarían.
 */
export function leerDeEmpresa<T>(empresaId: string, nombre: string): T[] {
  const t = TABLAS.find((x) => x.nombre === nombre && x.ambito === 'empresa') as
    | TablaInterna<T>
    | undefined
  if (!t) return []
  if (empresaId === empresaActual) return [...t.filas]

  const guardado = leerCrudo(clave(nombre, empresaId))
  return Array.isArray(guardado) ? (guardado as T[]) : t.semilla(empresaId)
}

/**
 * Devuelve todas las colecciones a su semilla y vuelve a la empresa inicial.
 *
 * Es la salida de emergencia de una etapa sin backend: si los datos de demo se
 * quedan en un estado incoherente, o si se quiere volver a enseñar el sistema
 * desde cero, esto lo deja como recién instalado. Las demás empresas se barren
 * por prefijo y se vuelven a sembrar la próxima vez que se abran.
 */
export function restablecerAlmacen(): void {
  empresaActual = EMPRESA_INICIAL
  for (const t of TABLAS) t.restablecer()

  // Las colecciones de versiones anteriores y de otras empresas no están en el
  // espacio activo: se barren por prefijo para que un formato viejo no ocupe
  // sitio ni reaparezca.
  vaciarAlmacen({ conservarSembradas: true })
}

/**
 * Borra del navegador todo lo que escribió esta capa.
 *
 * Lo usa el arranque cuando la aplicación va contra la API real: los datos que
 * dejó el modo demostración no tienen por qué sobrevivir al cambio. Nadie los
 * lee ya, pero son datos de una empresa guardados en un navegador, y la
 * respuesta correcta a eso es borrarlos, no ignorarlos.
 */
export function vaciarAlmacen(
  opciones: { conservarSembradas?: boolean } = {},
): void {
  const almacen = almacenDisponible()
  if (!almacen) return

  const prefijo = `${PREFIJO}.`
  const conservadas = new Set(
    opciones.conservarSembradas
      ? TABLAS.map((t) =>
          clave(t.nombre, t.ambito === 'grupo' ? ESPACIO_GRUPO : empresaActual),
        )
      : [],
  )
  const sobrantes = Object.keys(almacen).filter(
    (k) => k.startsWith(prefijo) && !conservadas.has(k),
  )
  for (const k of sobrantes) almacen.removeItem(k)
}
