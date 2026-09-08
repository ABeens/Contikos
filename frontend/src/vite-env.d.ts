/// <reference types="vite/client" />

/**
 * Variables de entorno de la aplicación.
 *
 * Declararlas las hace tipadas: `import.meta.env.VITE_API_UR` deja de
 * compilar en vez de valer `undefined` en tiempo de ejecución, que es la forma
 * más cara de descubrir una errata en el nombre de una variable.
 *
 * Todas son opcionales: sin ninguna, la aplicación arranca contra el mock. Ver
 * `.env.example` y docs/14 §2.3.
 */
interface ImportMetaEnv {
  /** Raíz de la API. Relativa (`/api`) o absoluta. Por defecto `/api`. */
  readonly VITE_API_URL?: string
  /**
   * Fuerza el origen de los datos: `'true'` el mock, `'false'` la API.
   * Sin declarar, manda `VITE_API_URL`.
   */
  readonly VITE_USAR_MOCKS?: 'true' | 'false'
  /** Tiempo máximo por petición en milisegundos. Por defecto 15000. */
  readonly VITE_API_TIMEOUT_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
