import { delay } from 'msw'

/**
 * Latencia simulada del mock.
 *
 * En el navegador la demora es útil: hace visibles los estados de carga y evita
 * construir pantallas que solo se ven bien cuando los datos llegan al instante.
 *
 * En las pruebas no aporta nada. Multiplica la duración de la suite y convierte
 * los flujos largos (capturar, contabilizar, volver a consultar) en pruebas que
 * fallan por reloj en una máquina cargada, que es la peor forma de fallar.
 */
export function latencia(ms: number): Promise<void> {
  return import.meta.env.MODE === 'test' ? Promise.resolve() : delay(ms)
}
