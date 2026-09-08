/**
 * Catálogo de ubicaciones de Hacienda (provincia, cantón, distrito).
 *
 * DATO DE DEMOSTRACIÓN, A COMPLETAR DESDE EL CATÁLOGO OFICIAL.
 *
 * Las siete provincias van completas. De cantones y distritos hay una
 * muestra de la zona central (San José, Alajuela, Cartago y Heredia) para que
 * el diálogo de cliente se pueda usar. El catálogo entero tiene más de 480
 * distritos y lo publica la DGT junto con los esquemas del comprobante; el
 * día que se construya el XML se carga desde ahí y esta lista se sustituye
 * sin tocar el contrato, que ya transporta códigos y no nombres.
 *
 * Códigos: 1 dígito de provincia, 2 de cantón dentro de la provincia y 2 de
 * distrito dentro del cantón (docs/13 §4).
 */

export interface Distrito {
  readonly codigo: string
  readonly nombre: string
}

export interface Canton {
  readonly codigo: string
  readonly nombre: string
  readonly distritos: readonly Distrito[]
}

export interface Provincia {
  readonly codigo: string
  readonly nombre: string
  readonly cantones: readonly Canton[]
}

const d = (codigo: string, nombre: string): Distrito => ({ codigo, nombre })

export const PROVINCIAS: readonly Provincia[] = [
  {
    codigo: '1',
    nombre: 'San José',
    cantones: [
      {
        codigo: '01',
        nombre: 'San José',
        distritos: [
          d('01', 'Carmen'),
          d('02', 'Merced'),
          d('03', 'Hospital'),
          d('04', 'Catedral'),
        ],
      },
      {
        codigo: '02',
        nombre: 'Escazú',
        distritos: [
          d('01', 'Escazú'),
          d('02', 'San Antonio'),
          d('03', 'San Rafael'),
        ],
      },
      {
        codigo: '03',
        nombre: 'Desamparados',
        distritos: [
          d('01', 'Desamparados'),
          d('02', 'San Miguel'),
          d('03', 'San Juan de Dios'),
        ],
      },
      {
        codigo: '08',
        nombre: 'Goicoechea',
        distritos: [
          d('01', 'Guadalupe'),
          d('02', 'San Francisco'),
          d('03', 'Calle Blancos'),
        ],
      },
      {
        codigo: '09',
        nombre: 'Santa Ana',
        distritos: [
          d('01', 'Santa Ana'),
          d('02', 'Salitral'),
          d('03', 'Pozos'),
        ],
      },
    ],
  },
  {
    codigo: '2',
    nombre: 'Alajuela',
    cantones: [
      {
        codigo: '01',
        nombre: 'Alajuela',
        distritos: [
          d('01', 'Alajuela'),
          d('02', 'San José'),
          d('03', 'Carrizal'),
          d('04', 'San Antonio'),
        ],
      },
      {
        codigo: '02',
        nombre: 'San Ramón',
        distritos: [
          d('01', 'San Ramón'),
          d('02', 'Santiago'),
          d('03', 'San Juan'),
        ],
      },
      {
        codigo: '03',
        nombre: 'Grecia',
        distritos: [
          d('01', 'Grecia'),
          d('02', 'San Isidro'),
          d('03', 'San José'),
        ],
      },
    ],
  },
  {
    codigo: '3',
    nombre: 'Cartago',
    cantones: [
      {
        codigo: '01',
        nombre: 'Cartago',
        distritos: [
          d('01', 'Oriental'),
          d('02', 'Occidental'),
          d('03', 'Carmen'),
          d('04', 'San Nicolás'),
        ],
      },
      {
        codigo: '02',
        nombre: 'Paraíso',
        distritos: [
          d('01', 'Paraíso'),
          d('02', 'Santiago'),
          d('03', 'Orosi'),
        ],
      },
      {
        codigo: '03',
        nombre: 'La Unión',
        distritos: [
          d('01', 'Tres Ríos'),
          d('02', 'San Diego'),
          d('03', 'San Juan'),
        ],
      },
    ],
  },
  {
    codigo: '4',
    nombre: 'Heredia',
    cantones: [
      {
        codigo: '01',
        nombre: 'Heredia',
        distritos: [
          d('01', 'Heredia'),
          d('02', 'Mercedes'),
          d('03', 'San Francisco'),
          d('04', 'Ulloa'),
        ],
      },
      {
        codigo: '02',
        nombre: 'Barva',
        distritos: [
          d('01', 'Barva'),
          d('02', 'San Pedro'),
          d('03', 'San Pablo'),
        ],
      },
      {
        codigo: '03',
        nombre: 'Santo Domingo',
        distritos: [
          d('01', 'Santo Domingo'),
          d('02', 'San Vicente'),
          d('03', 'San Miguel'),
        ],
      },
    ],
  },
  // Sin cantones de muestra: se cargan desde el catálogo oficial.
  { codigo: '5', nombre: 'Guanacaste', cantones: [] },
  { codigo: '6', nombre: 'Puntarenas', cantones: [] },
  { codigo: '7', nombre: 'Limón', cantones: [] },
]

export function provinciaPorCodigo(codigo: string): Provincia | undefined {
  return PROVINCIAS.find((p) => p.codigo === codigo)
}

export function cantonPorCodigo(
  provincia: string,
  canton: string,
): Canton | undefined {
  return provinciaPorCodigo(provincia)?.cantones.find((c) => c.codigo === canton)
}

export function distritoPorCodigo(
  provincia: string,
  canton: string,
  distrito: string,
): Distrito | undefined {
  return cantonPorCodigo(provincia, canton)?.distritos.find(
    (x) => x.codigo === distrito,
  )
}

/**
 * ¿Existe la terna en el catálogo?
 *
 * Mientras el catálogo sea de muestra, una provincia sin cantones cargados
 * acepta cualquier cantón y distrito de la forma correcta: rechazarlos
 * dejaría sin poder capturar a un cliente de Guanacaste. Cuando se cargue el
 * catálogo completo esta tolerancia sobra.
 */
export function ubicacionValida(
  provincia: string,
  canton: string,
  distrito: string,
): boolean {
  const p = provinciaPorCodigo(provincia)
  if (!p) return false
  if (p.cantones.length === 0) return /^\d{2}$/.test(canton) && /^\d{2}$/.test(distrito)
  const c = p.cantones.find((x) => x.codigo === canton)
  if (!c) return false
  return c.distritos.some((x) => x.codigo === distrito)
}

/** "Escazú, San José" para listas. Vacío si la ubicación no se conoce. */
export function nombreUbicacion(
  provincia: string,
  canton: string,
  distrito: string,
): string {
  const p = provinciaPorCodigo(provincia)
  if (!p) return ''
  const c = cantonPorCodigo(provincia, canton)
  const x = distritoPorCodigo(provincia, canton, distrito)
  return [x?.nombre, c?.nombre, p.nombre].filter(Boolean).join(', ')
}
