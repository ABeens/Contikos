/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // El pool 'forks' no arranca de forma fiable en Windows con esta configuración.
    pool: 'threads',
    // Las pruebas de flujo completo capturan documentos tecla a tecla contra
    // MSW. Con el límite por defecto de 5 s fallan por reloj y no por lógica,
    // que es el peor tipo de prueba: la que hay que volver a correr para saber
    // si el código estaba bien.
    testTimeout: 20_000,
    // Las suites de interfaz montan la aplicación entera contra jsdom. En
    // paralelo se pisan la CPU entre ellas y las esperas se agotan por
    // contención, no por un fallo real. En secuencia la suite tarda más y dice
    // la verdad, que es lo que se le pide a una prueba.
    fileParallelism: false,
  },
})
