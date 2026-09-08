import { http, HttpResponse } from 'msw'
import { rutaApi } from '@/shared/api/entorno'
import { empresaActiva, leerDeEmpresa } from '@/shared/almacen/almacen'
import { SolicitudEmpresaSchema } from '@/shared/api/contracts/empresas'
import type {
  Empresa,
  RolTercero,
  TerceroGrupo,
} from '@/shared/api/contracts/empresas'
import type { ClienteBase } from '@/shared/api/contracts/cxc'
import type { ProveedorBase } from '@/shared/api/contracts/cxp'
import {
  normalizarSolicitud,
  validarEmpresa,
  type ResultadoEmpresa,
} from '@/modules/empresas/domain/empresa'
import { latencia } from '../latencia'
import {
  empresasMock,
  persistirEmpresas,
  siguienteIdEmpresa,
} from '../seed/empresas'
import { TABLA_CLIENTES } from '../seed/cxc'
import { TABLA_PROVEEDORES } from '../seed/cxp'

/**
 * Mock de las empresas del grupo y de la guardia de empresa.
 *
 * Dos cosas que en el backend serán dos piezas distintas: el catálogo de
 * tenants, y el filtro obligatorio que impide que una petición llegue a los
 * datos sin decir de qué empresa son (docs/12 D-03).
 */

/**
 * Guardia de empresa. Va delante de todos los handlers.
 *
 * Toda petición a la API lleva la cabecera de empresa, sin excepción: es lo
 * que el backend usará para aplicar el filtro por `empresa_id` en el
 * repositorio, y un mock que no la exigiera dejaría pasar exactamente la
 * omisión que hay que detectar antes de que exista la API.
 *
 * El mock sirve una sola empresa a la vez (la activa del almacén), así que
 * una cabecera con otra empresa es una incoherencia entre quien pide y quien
 * contesta, no una petición legítima: se rechaza en vez de servir datos que
 * no son los pedidos.
 *
 * Devolver `undefined` deja seguir al handler de la ruta.
 */
export const guardiaEmpresa = http.all(rutaApi('/*'), ({ request }) => {
  const empresaId = request.headers.get('X-Empresa-Id')
  if (!empresaId) {
    return HttpResponse.json(
      {
        codigo: 'EMPRESA_REQUERIDA',
        mensaje: 'Toda petición debe indicar la empresa (cabecera X-Empresa-Id)',
      },
      { status: 400 },
    )
  }
  if (empresaId !== empresaActiva()) {
    return HttpResponse.json(
      {
        codigo: 'EMPRESA_INCORRECTA',
        mensaje: `La petición es de la empresa ${empresaId}, pero la empresa abierta es ${empresaActiva()}`,
      },
      { status: 409 },
    )
  }
  return undefined
})

function solicitudInvalida(detalles: string[]) {
  return HttpResponse.json(
    {
      codigo: 'SOLICITUD_INVALIDA',
      mensaje: 'La solicitud no cumple el contrato',
      detalles,
    },
    { status: 422 },
  )
}

function rechazar(resultado: ResultadoEmpresa) {
  const principal = resultado.errores[0]
  return HttpResponse.json(
    {
      codigo: principal.codigo,
      mensaje: principal.mensaje,
      detalles: resultado.errores.map((e) => e.mensaje),
    },
    { status: principal.codigo === 'EMPRESA_NO_ENCONTRADA' ? 404 : 422 },
  )
}

function contexto() {
  return { empresas: empresasMock, empresaAbierta: empresaActiva() }
}

/* ------------------------------------------------ Directorio de terceros */

interface TerceroFuente {
  tipoIdentificacion: TerceroGrupo['tipoIdentificacion']
  identificacion: string
  razonSocial: string
  nombreComercial?: string | null
  correo: string | null
  codigo: string
}

/**
 * Directorio de terceros del grupo (docs/12 D-12).
 *
 * Se calcula al pedirlo, leyendo los clientes y proveedores de cada empresa
 * activa. Un mismo tercero (misma cédula) que aparece en varias empresas o
 * con los dos papeles sale una sola vez, con todas sus apariciones. De cada
 * uno se toma solo la identidad: las condiciones comerciales no viajan.
 */
function directorio(): TerceroGrupo[] {
  const terceros = new Map<string, TerceroGrupo>()

  const agregar = (empresa: Empresa, rol: RolTercero, fuente: TerceroFuente) => {
    const llave = `${fuente.tipoIdentificacion}:${fuente.identificacion}`
    const existente = terceros.get(llave)
    const aparicion = {
      empresaId: empresa.id,
      empresaCodigo: empresa.codigo,
      empresaNombre: empresa.nombre,
      rol,
      codigo: fuente.codigo,
    }
    if (existente) {
      existente.apariciones.push(aparicion)
      // La primera empresa que lo conoció pone el nombre; las demás solo
      // completan lo que aquella dejó vacío.
      existente.nombreComercial ??= fuente.nombreComercial ?? null
      existente.correo ??= fuente.correo
      return
    }
    terceros.set(llave, {
      tipoIdentificacion: fuente.tipoIdentificacion,
      identificacion: fuente.identificacion,
      razonSocial: fuente.razonSocial,
      nombreComercial: fuente.nombreComercial ?? null,
      correo: fuente.correo,
      apariciones: [aparicion],
    })
  }

  for (const empresa of empresasMock.filter((e) => e.activa)) {
    for (const c of leerDeEmpresa<ClienteBase>(empresa.id, TABLA_CLIENTES)) {
      agregar(empresa, 'cliente', c)
    }
    for (const p of leerDeEmpresa<ProveedorBase>(empresa.id, TABLA_PROVEEDORES)) {
      agregar(empresa, 'proveedor', p)
    }
  }

  return [...terceros.values()].sort((a, b) =>
    a.razonSocial.localeCompare(b.razonSocial, 'es'),
  )
}

export const handlersEmpresas = [
  http.get(rutaApi('/empresas'), async () => {
    await latencia(60)
    return HttpResponse.json(empresasMock)
  }),

  // Antes que `/empresas/:id` por si algún día existe: `directorio` no es un id.
  http.get(rutaApi('/empresas/directorio'), async () => {
    await latencia(120)
    return HttpResponse.json(directorio())
  }),

  http.post(rutaApi('/empresas'), async ({ request }) => {
    await latencia(250)

    const parsed = SolicitudEmpresaSchema.safeParse(await request.json())
    if (!parsed.success) {
      return solicitudInvalida(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const resultado = validarEmpresa(parsed.data, contexto())
    if (!resultado.valido) return rechazar(resultado)

    const nueva: Empresa = {
      ...normalizarSolicitud(parsed.data),
      id: siguienteIdEmpresa(),
    }
    empresasMock.push(nueva)
    persistirEmpresas()
    return HttpResponse.json(nueva, { status: 201 })
  }),

  http.put(rutaApi('/empresas/:id'), async ({ params, request }) => {
    await latencia(250)

    const id = String(params.id)
    const indice = empresasMock.findIndex((e) => e.id === id)

    const parsed = SolicitudEmpresaSchema.safeParse(await request.json())
    if (!parsed.success) {
      return solicitudInvalida(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      )
    }

    const resultado = validarEmpresa(parsed.data, contexto(), id)
    if (!resultado.valido || indice === -1) return rechazar(resultado)

    const actualizada: Empresa = { ...normalizarSolicitud(parsed.data), id }
    empresasMock[indice] = actualizada
    persistirEmpresas()
    return HttpResponse.json(actualizada)
  }),
]
