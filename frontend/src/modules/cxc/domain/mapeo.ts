import type { MapeoCxc } from '@/shared/api/contracts/cxc'

/**
 * Mapeo sin resolver: el que rige mientras `GET /cxc/mapeo` no ha contestado.
 *
 * Todos los códigos vacíos, a propósito. La pantalla puede calcular y enseñar
 * sin esperar a la configuración, y lo que sale es un asiento incompleto que la
 * validación rechaza, que es exactamente la situación. Rellenarlo con cuentas
 * de ejemplo enseñaría un asiento que nadie contabilizó nunca.
 */
export const MAPEO_VACIO: MapeoCxc = {
  cliente: '',
  ingreso: '',
  impuestoTrasladado: '',
  deposito: '',
  anticipo: '',
  diferenciaCambiariaGanada: '',
  diferenciaCambiariaPerdida: '',
}
