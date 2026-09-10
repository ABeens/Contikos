import { handlersConfig } from './config'
import { handlersImpuestos } from './impuestos'
import { handlersConta } from './conta'
import { handlersCxc } from './cxc'
import { handlersCxp } from './cxp'
import { handlersActivos } from './activos'
import { handlersBancos } from './bancos'
import { handlersBancosConciliacion } from './bancosConciliacion'
import { handlersBancosRevaluacion } from './bancosRevaluacion'
import { handlersDiferidos } from './diferidos'
import { guardiaEmpresa, handlersEmpresas } from './empresas'

/**
 * Todos los handlers del mock.
 *
 * Un único punto de registro: el navegador y las pruebas montan exactamente el
 * mismo conjunto. Cuando difieren, la prueba pasa contra una API que no existe.
 */
export const handlers = [
  // La guardia va primero: ninguna ruta se sirve sin cabecera de empresa.
  guardiaEmpresa,
  ...handlersEmpresas,
  ...handlersConfig,
  ...handlersImpuestos,
  ...handlersConta,
  ...handlersCxc,
  ...handlersCxp,
  ...handlersActivos,
  ...handlersBancos,
  ...handlersBancosConciliacion,
  ...handlersBancosRevaluacion,
  ...handlersDiferidos,
]

export {
  guardiaEmpresa,
  handlersEmpresas,
  handlersConfig,
  handlersImpuestos,
  handlersConta,
  handlersCxc,
  handlersCxp,
  handlersActivos,
  handlersBancos,
  handlersBancosConciliacion,
  handlersBancosRevaluacion,
  handlersDiferidos,
}
