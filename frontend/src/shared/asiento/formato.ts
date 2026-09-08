/**
 * Código de presentación del asiento: AS-2026-000012.
 *
 * El consecutivo (`numero`) es único por ejercicio y sin huecos (docs/03 §3),
 * así que el 12 de 2026 y el 12 de 2027 son asientos distintos. Lo que se
 * muestra, se imprime y se cita en una auditoría lleva el ejercicio delante
 * para que nunca haya que preguntar "el 12 de qué año".
 *
 * Seis dígitos: una empresa mediana pasa de 99.999 asientos al año con los
 * automáticos de facturación, y un código que cambia de ancho a media serie
 * deja de ordenarse como texto.
 *
 * Costa Rica no exige clasificar el asiento en ingreso/egreso/diario, que es
 * una convención mexicana del SAT. Ver D-04 en docs/12.
 */
export function codigoAsiento(ejercicio: number, numero: number): string {
  return `AS-${ejercicio}-${String(numero).padStart(6, '0')}`
}

/**
 * Número suelto con relleno: 00001.
 *
 * Se conserva para las vistas compactas que ya lo usan; donde el asiento se
 * identifique de verdad va `codigoAsiento`, que lleva el ejercicio.
 */
export function formatNumeroAsiento(numero: number): string {
  return String(numero).padStart(5, '0')
}
