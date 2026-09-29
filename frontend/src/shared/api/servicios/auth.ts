import { z } from 'zod'
import {
  SesionSchema,
  UsuarioSchema,
  type Sesion,
  type SolicitudInicioSesion,
  type SolicitudUsuario,
  type Usuario,
} from '../contracts/auth'
import { pedir, type OpcionesLectura } from './base'

/**
 * Sesión y usuarios (docs/17 §6).
 *
 * Como las empresas, son del grupo y no de la empresa activa. La cabecera de
 * empresa viaja igual; para `/auth/usuarios` el servidor la usa para saber si
 * quien pregunta administra usuarios en la empresa desde la que pregunta.
 */

const ListaUsuarios = z.array(UsuarioSchema)
const SinContenido = z.undefined()

export const servicioAuth = {
  /** POST /auth/sesion: entra con correo y contraseña. */
  iniciarSesion(solicitud: SolicitudInicioSesion): Promise<Sesion> {
    return pedir('/auth/sesion', SesionSchema, { metodo: 'POST', cuerpo: solicitud })
  },

  /** GET /auth/sesion: comprueba que la sesión guardada sigue viva. */
  obtenerSesion(opciones: OpcionesLectura = {}): Promise<Sesion> {
    return pedir('/auth/sesion', SesionSchema, opciones)
  },

  /** DELETE /auth/sesion */
  cerrarSesion(): Promise<undefined> {
    return pedir('/auth/sesion', SinContenido, { metodo: 'DELETE' })
  },

  /** GET /auth/usuarios */
  listarUsuarios(opciones: OpcionesLectura = {}): Promise<Usuario[]> {
    return pedir('/auth/usuarios', ListaUsuarios, opciones)
  },

  /** POST /auth/usuarios */
  crearUsuario(datos: SolicitudUsuario): Promise<Usuario> {
    return pedir('/auth/usuarios', UsuarioSchema, { metodo: 'POST', cuerpo: datos })
  },

  /** PUT /auth/usuarios/:id */
  actualizarUsuario(id: string, datos: SolicitudUsuario): Promise<Usuario> {
    return pedir(`/auth/usuarios/${id}`, UsuarioSchema, { metodo: 'PUT', cuerpo: datos })
  },
}
