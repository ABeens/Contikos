import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

/**
 * Los mocks se activan por variable de entorno y viven fuera de `src/modules`.
 * Nada de `src/` los importa: borrar esta carpeta no debe romper la compilación
 * (docs/14 §2).
 */
export async function iniciarMocks(): Promise<void> {
  await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
    // El worker se sirve junto al resto de estáticos, y en GitHub Pages eso no
    // es la raíz del dominio. Con la ruta por defecto el registro falla y la
    // aplicación arranca sin datos.
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  })
}
