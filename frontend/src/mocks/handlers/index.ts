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
import { handlersRh } from './rh'
import { guardiaEmpresa, handlersEmpresas } from './empresas'
import {
  guardiaPermisos,
  guardiaSesion,
  handlersAuthSinEmpresa,
  handlersUsuarios,
} from './auth'

/**
 * Todos los handlers del mock.
 *
 * Un único punto de registro: el navegador y las pruebas montan exactamente el
 * mismo conjunto. Cuando difieren, la prueba pasa contra una API que no existe.
 */
export const handlers = [
  // Las guardias van primero, en este orden: quién pide (401), de qué empresa
  // (400, 409) y si puede (403). `/auth` va después de la de sesión y antes de
  // la de empresa, salvo `/auth/usuarios`, que sí es por empresa: el que
  // administra usuarios lo hace desde una empresa donde tiene ese permiso.
  guardiaSesion,
  ...handlersAuthSinEmpresa,
  guardiaEmpresa,
  guardiaPermisos,
  ...handlersUsuarios,
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
  ...handlersRh,
]

export {
  guardiaSesion,
  guardiaPermisos,
  handlersAuthSinEmpresa,
  handlersUsuarios,
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
  handlersRh,
}
