import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

/**
 * Los handlers del mock simulan latencia de red a propósito (docs/14 §2), y
 * varias pruebas recorren un flujo completo: capturar, contabilizar y volver a
 * consultar. Con el segundo por defecto de `findBy*`, la espera se agota antes
 * de que el flujo termine y la prueba falla por reloj, no por lógica.
 */
configure({ asyncUtilTimeout: 5_000 })
