import { z } from 'zod'
import {
  EmpresaSchema,
  TerceroGrupoSchema,
  type Empresa,
  type SolicitudEmpresa,
  type TerceroGrupo,
} from '../contracts/empresas'
import { pedir, type OpcionesLectura } from './base'

/**
 * Empresas del grupo.
 *
 * Es el único servicio cuyos datos no son de la empresa activa sino del grupo:
 * la lista de empresas a las que se puede entrar y el directorio de terceros
 * que esas empresas conocen (docs/01 §4.1, docs/12 D-12).
 *
 * La cabecera de empresa viaja igual que en cualquier otra petición: el
 * servidor la exige siempre, y para estas rutas la usa solo para saber quién
 * pregunta.
 */

const ListaEmpresas = z.array(EmpresaSchema)
const Directorio = z.array(TerceroGrupoSchema)

export const servicioEmpresas = {
  /** GET /empresas */
  listar(opciones: OpcionesLectura = {}): Promise<Empresa[]> {
    return pedir('/empresas', ListaEmpresas, opciones)
  },

  /** POST /empresas */
  crear(empresa: SolicitudEmpresa): Promise<Empresa> {
    return pedir('/empresas', EmpresaSchema, {
      metodo: 'POST',
      cuerpo: empresa,
    })
  },

  /** PUT /empresas/:id */
  actualizar(id: string, empresa: SolicitudEmpresa): Promise<Empresa> {
    return pedir(`/empresas/${id}`, EmpresaSchema, {
      metodo: 'PUT',
      cuerpo: empresa,
    })
  },

  /**
   * GET /empresas/directorio
   *
   * Terceros conocidos por cualquier empresa activa del grupo, con su
   * identidad y en qué empresas aparecen. Sirve para dar de alta en una
   * empresa un cliente o proveedor que otra ya tiene, sin teclear la cédula
   * otra vez ni arrastrar sus condiciones comerciales.
   */
  directorioTerceros(opciones: OpcionesLectura = {}): Promise<TerceroGrupo[]> {
    return pedir('/empresas/directorio', Directorio, opciones)
  },
}
