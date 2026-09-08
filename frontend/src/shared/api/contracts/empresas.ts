import { z } from 'zod'
import { TipoIdentificacionSchema } from './comunes'

/* --------------------------------------------------------------- Empresas */

/**
 * País de la empresa.
 *
 * Solo Costa Rica (docs/12 D-02). Es un enum y no un `z.string()` a propósito:
 * de él cuelgan la validación de la cédula, el IVA, los comprobantes y el
 * tipo de cambio, y añadir un país es una localización entera (docs/13), no
 * una fila más en un catálogo.
 */
export const PaisSchema = z.enum(['CR'])

export type Pais = z.infer<typeof PaisSchema>

/**
 * Empresa del grupo (docs/10 §2, docs/01 §4.1).
 *
 * Es el tenant: toda colección de negocio pertenece a una, y los datos de dos
 * empresas jamás se cruzan. Lo que hay aquí es lo que identifica a la empresa
 * ante Hacienda y lo que fija su ejercicio; la moneda funcional NO está,
 * porque vive en el catálogo de monedas de cada empresa y tenerla dos veces
 * acabaría en dos valores distintos.
 */
export const EmpresaSchema = z.object({
  id: z.string().min(1),
  /**
   * Siglas con las que se la nombra en el selector y en los reportes del
   * grupo. Corta a propósito: cabe en una barra superior.
   */
  codigo: z.string().min(1).max(8),
  /** Razón social, tal como aparece en la cédula jurídica. */
  nombre: z.string().min(1),
  nombreComercial: z.string().nullable(),
  tipoIdentificacion: TipoIdentificacionSchema,
  /** Sin separadores. El formato para pantalla es cosa de la vista. */
  identificacion: z.string().min(1),
  pais: PaisSchema,
  /** Mes en que empieza el ejercicio. En Costa Rica, enero (docs/13 §1). */
  ejercicioInicioMes: z.number().int().min(1).max(12),
  /** Una empresa inactiva no se abre, pero sus datos siguen guardados. */
  activa: z.boolean(),
})

export type Empresa = z.infer<typeof EmpresaSchema>

export const SolicitudEmpresaSchema = EmpresaSchema.omit({ id: true })

export type SolicitudEmpresa = z.infer<typeof SolicitudEmpresaSchema>

/* ------------------------------------------------ Directorio de terceros */

export const RolTerceroSchema = z.enum(['cliente', 'proveedor'])

export type RolTercero = z.infer<typeof RolTerceroSchema>

/** En qué empresa del grupo y con qué papel aparece un tercero. */
export const AparicionTerceroSchema = z.object({
  empresaId: z.string(),
  empresaCodigo: z.string(),
  empresaNombre: z.string(),
  rol: RolTerceroSchema,
  /** Código con el que esa empresa lo conoce. Cada una pone el suyo. */
  codigo: z.string(),
})

export type AparicionTercero = z.infer<typeof AparicionTerceroSchema>

/**
 * Entrada del directorio de terceros del grupo (docs/12 D-12).
 *
 * Solo identidad: lo que un tercero ES, no lo que cada empresa acordó con él.
 * La cédula y la razón social son un hecho del mundo y se comparten; el
 * límite de crédito, la retención, la cuenta y el saldo son de la relación
 * con cada empresa y se quedan en el cliente o proveedor de esa empresa.
 *
 * Es una vista derivada, no una colección: se calcula leyendo los catálogos de
 * las empresas del grupo. Nada se guarda a nivel de grupo y nada se cruza.
 */
export const TerceroGrupoSchema = z.object({
  tipoIdentificacion: TipoIdentificacionSchema,
  identificacion: z.string().min(1),
  razonSocial: z.string().min(1),
  nombreComercial: z.string().nullable(),
  correo: z.string().nullable(),
  apariciones: z.array(AparicionTerceroSchema).min(1),
})

export type TerceroGrupo = z.infer<typeof TerceroGrupoSchema>
