import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

/**
 * Los handlers del mock simulan latencia de red a propósito (docs/14 §2), y
 * varias pruebas recorren un flujo completo: capturar, contabilizar y volver a
 * consultar. Con el segundo por defecto de `findBy*`, la espera se agota antes
 * de que el flujo termine y la prueba falla por reloj, no por lógica.
 */
configure({ asyncUtilTimeout: 5_000 })

/*
 * Toda prueba corre con una sesión de administrador abierta, salvo que la
 * cierre ella misma. Las pruebas de acceso (`acceso.test.tsx`) son las que
 * cambian de usuario; las demás prueban su módulo, no la autorización.
 */
import { beforeAll, beforeEach } from 'vitest'
import { iniciarSesionDePrueba } from './sesion'

// También antes de los `beforeAll` de cada archivo: algunos preparan datos
// pidiéndolos al mock, y eso ya necesita sesión.
beforeAll(() => {
  iniciarSesionDePrueba('usr-admin')
})
beforeEach(() => {
  iniciarSesionDePrueba('usr-admin')
})
