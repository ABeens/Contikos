/**
 * Capa de servicios: todo lo que la aplicación le pide al servidor.
 *
 * Un servicio por módulo del dominio, y dentro un método por operación de la
 * API, con su ruta y su verbo escritos en el propio método. Leer un archivo de
 * esta carpeta es leer el contrato del módulo.
 *
 * Por qué existe, y no llamadas sueltas dentro de los hooks:
 *
 * - La API es una sola. Repartir las rutas por los hooks hace que la misma
 *   operación se escriba distinta en dos pantallas y que nadie pueda responder
 *   "qué le pedimos al servidor" sin buscar por todo el código.
 * - Un servicio se llama desde donde sea: un hook, una prueba, otro servicio.
 *   No arrastra React ni la caché.
 * - Cuando el backend exista, lo que cambia es quién contesta, no estas firmas.
 *
 * Hoy contesta el mock, que guarda en el almacenamiento local del navegador
 * (`shared/almacen`): lo capturado sobrevive a recargar la página, igual que
 * sobrevivirá cuando lo guarde una base de datos de verdad. La bandera
 * `VITE_USAR_MOCKS=false` y `VITE_API_URL` son las dos únicas cosas que hay que
 * tocar para apuntar a la API real.
 *
 * Los límites entre módulos (docs/14 §3.1) se respetan por construcción: los
 * servicios viven en `shared` y no importan nada de `modules`, así que un
 * módulo puede pedir un dato de otro (CxP necesita las categorías de activo)
 * sin importar su código.
 */

export { servicioActivos } from './activos'
export { servicioBancos } from './bancos'
export { servicioConfig } from './config'
export { servicioConta } from './conta'
export { servicioCxc } from './cxc'
export { servicioCxp } from './cxp'
export { servicioDiferidos } from './diferidos'
export { servicioEmpresas } from './empresas'
export { servicioImpuestos } from './impuestos'
export type { OpcionesLectura } from './base'
