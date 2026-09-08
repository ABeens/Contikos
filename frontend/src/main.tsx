import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { USAR_MOCKS } from './shared/api/entorno'
import { vaciarAlmacen } from './shared/almacen/almacen'
import { Providers } from './app/providers'
import { router } from './app/router'
import './index.css'

/**
 * Borra el rastro del modo demostración.
 *
 * Apagar los mocks no basta: MSW trabaja con un service worker registrado en
 * el navegador, y un service worker no se va porque la aplicación deje de
 * pedirlo. Sigue instalado en la máquina de todo el que abrió alguna vez la
 * versión con datos simulados, interponiéndose entre la aplicación y la API
 * real. Lo mismo vale para los datos: son datos de una empresa guardados en un
 * navegador, y al conectar el backend dejan de tener motivo para estar ahí.
 *
 * Se hace en el arranque y no en el despliegue porque el navegador que hay que
 * limpiar es el del usuario, y a ese solo se llega cuando abre la aplicación.
 */
async function limpiarRastroDelMock(): Promise<void> {
  vaciarAlmacen()

  if (!('serviceWorker' in navigator)) return
  try {
    const registros = await navigator.serviceWorker.getRegistrations()
    await Promise.all(
      registros
        // Solo el de MSW: el día que la aplicación registre uno propio (una
        // PWA, una caché offline), este barrido no puede llevárselo por delante.
        .filter((r) =>
          r.active?.scriptURL.includes('mockServiceWorker'),
        )
        .map((r) => r.unregister()),
    )
  } catch {
    // Sin permisos o en un contexto no seguro. No es motivo para no arrancar.
  }
}

async function arrancar() {
  // Los mocks se activan por variable de entorno y no se importan desde `src`.
  // Declarar `VITE_API_URL` ya los apaga: si se dijo dónde está la API, es que
  // se quiere hablar con ella (docs/14 §2.3).
  if (USAR_MOCKS) {
    const { iniciarMocks } = await import('./mocks/browser')
    await iniciarMocks()
  } else {
    await limpiarRastroDelMock()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </StrictMode>,
  )
}

void arrancar()
