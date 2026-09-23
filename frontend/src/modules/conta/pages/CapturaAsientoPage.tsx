import { useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { CircleAlert, CircleCheck, Lock, Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { useAvisoSalida } from '@/shared/ui/AvisoSalida'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatMoney } from '@/shared/money/format'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { ApiError } from '@/shared/api/client'
import {
  configuracionMoneda,
  monedaFuncional,
  monedasActivas,
  type Moneda,
} from '@/shared/money/money'
import {
  LIBROS_TODOS,
  type AuxiliarTipo,
  type Libro,
} from '@/shared/api/contracts/comunes'
import type { Cuenta, SolicitudAsiento } from '@/shared/api/contracts/conta'
import type { AuxiliaresPorTipo } from '@/shared/api/catalogos'
import { useMonedas } from '@/modules/config/api/queries'
import { useEmpresa } from '@/app/empresa'
import {
  useAuxiliares,
  useContabilizarAsiento,
  useCuentas,
  useDocumentosTrazables,
  usePeriodos,
} from '../api/queries'
import { totalesPorLibro, validarAsiento } from '../domain/asiento'
import {
  LIBROS,
  etiquetaLibro,
  ordenarLibros,
  tratamientoUniforme,
} from '@/shared/asiento/libro'
import { SelectorCuenta } from '@/shared/ui/SelectorCuenta'
import { SelectorAuxiliar } from '@/shared/ui/SelectorAuxiliar'
import {
  TIPOS_CON_CATALOGO,
  buscarAuxiliar,
  textoAuxiliar,
  tieneCatalogo,
  type Auxiliar,
  type TipoConCatalogo,
} from '@/shared/auxiliares/auxiliar'
import {
  MODULOS_CON_DOCUMENTOS,
  aDocumentoRelacionado,
  buscarDocumento,
  esModuloConDocumentos,
  textoDocumento,
  type ModuloConDocumentos,
} from '@/shared/api/trazabilidad'
import { CasillaLibro } from '@/shared/asiento/Libros'

interface LineaCaptura {
  clave: number
  cuenta: string
  concepto: string
  cargo: string
  abono: string
  /**
   * Lo tecleado en el buscador de auxiliar: código, nombre, cédula o las tres.
   * Se resuelve al id contra el catálogo al armar la solicitud, igual que la
   * cuenta viaja por código y no por id.
   */
  auxiliar: string
  /**
   * Tipo de auxiliar elegido por el usuario cuando la cuenta NO lo exige.
   *
   * Si la cuenta lo exige, manda la cuenta (docs/02 §3) y este campo se
   * ignora. Si no, capturar auxiliar es opcional: un gasto contra un proveedor
   * que no es cuenta de control igual se quiere ver por proveedor.
   */
  auxiliarTipo: TipoConCatalogo | ''
  /** Libros que mueve la línea. Arranca con los dos (docs/02 §3.1). */
  libros: Libro[]
}

let siguienteClave = 0
const lineaVacia = (libros: Libro[]): LineaCaptura => ({
  clave: siguienteClave++,
  cuenta: '',
  concepto: '',
  cargo: '',
  abono: '',
  auxiliar: '',
  auxiliarTipo: '',
  libros: [...libros],
})

/** Aviso bajo el buscador de auxiliar. Uno por estado, sin adivinar. */
const MENSAJE_AMBIGUO = 'Varios auxiliares coinciden, precisa la búsqueda'

const ETIQUETA_MODULO: Record<ModuloConDocumentos, string> = {
  cxc: 'Cuentas por cobrar',
  cxp: 'Cuentas por pagar',
}

type CuentasPorCodigo = ReadonlyMap<string, Cuenta>

/**
 * Tipo de auxiliar que aplica a la línea: el que exige la cuenta, o el que
 * eligió el usuario si la cuenta no exige ninguno.
 */
function tipoDeLinea(
  linea: LineaCaptura,
  cuentaPorCodigo: CuentasPorCodigo,
): AuxiliarTipo | null {
  return (
    cuentaPorCodigo.get(linea.cuenta)?.requiereAuxiliar ??
    (linea.auxiliarTipo || null)
  )
}

/** Qué dice el catálogo de lo tecleado en una línea. Null si no hay catálogo. */
function busquedaDeLinea(
  linea: LineaCaptura,
  cuentaPorCodigo: CuentasPorCodigo,
  auxiliaresPorTipo: AuxiliaresPorTipo,
) {
  const tipo = tipoDeLinea(linea, cuentaPorCodigo)
  if (!tipo || !tieneCatalogo(tipo)) return null
  return buscarAuxiliar(auxiliaresPorTipo.get(tipo) ?? [], linea.auxiliar)
}

export function CapturaAsientoPage() {
  const navegar = useNavigate()
  const { periodoActivo } = useEmpresa()
  const { data: cuentas = [] } = useCuentas()
  const { data: periodos = [] } = usePeriodos()
  // El selector de moneda se llena del catálogo configurado, no de una lista
  // escrita en esta pantalla.
  useMonedas()
  const contabilizar = useContabilizarAsiento()

  const funcional = monedaFuncional()
  const disponibles = monedasActivas()

  const [fecha, setFecha] = useState(hoyISO)
  const [concepto, setConcepto] = useState('')
  const [moneda, setMoneda] = useState<Moneda>(funcional)
  const [tipoCambio, setTipoCambio] = useState('1')
  const [lineas, setLineas] = useState<LineaCaptura[]>(() => [
    lineaVacia([...LIBROS_TODOS]),
    lineaVacia([...LIBROS_TODOS]),
  ])
  const [intentoEnvio, setIntentoEnvio] = useState(false)

  // Documento relacionado (trazabilidad, no origen): módulo y lo tecleado en
  // el buscador. Vacío por omisión: la mayoría de los ajustes no se refieren
  // a ningún documento.
  const [documentoModulo, setDocumentoModulo] = useState<
    ModuloConDocumentos | ''
  >('')
  const [documentoTexto, setDocumentoTexto] = useState('')
  const { documentos, cargando: cargandoDocumentos } = useDocumentosTrazables(
    documentoModulo || null,
  )
  const listaDocumentosId = useId()

  const cuentaPorCodigo = useMemo(
    () => new Map(cuentas.map((c) => [c.codigo, c])),
    [cuentas],
  )

  // Solo se piden los catálogos que el asiento usa: la cuenta de cada línea
  // dice qué auxiliar exige, y las más de las veces no exige ninguno.
  const tiposAuxiliar = useMemo(
    () => [
      ...new Set(
        lineas
          .map((l) => tipoDeLinea(l, cuentaPorCodigo))
          .filter((t) => t !== null),
      ),
    ],
    [lineas, cuentaPorCodigo],
  )
  const auxiliaresPorTipo = useAuxiliares(tiposAuxiliar)

  const busquedaDocumento = useMemo(
    () =>
      documentoModulo ? buscarDocumento(documentos, documentoTexto) : null,
    [documentoModulo, documentos, documentoTexto],
  )
  const documentoElegido =
    busquedaDocumento?.estado === 'unico' ? busquedaDocumento.documento : null

  const solicitud: SolicitudAsiento = useMemo(
    () => ({
      fecha,
      concepto,
      moneda,
      tipoCambio: tipoCambio || '0',
      documentoRelacionado: documentoElegido
        ? aDocumentoRelacionado(documentoElegido)
        : null,
      lineas: lineas.map((l) => {
        const tipo = tipoDeLinea(l, cuentaPorCodigo)
        // Al asiento va el id, no lo que se tecleó. Un texto que no resuelve
        // deja la línea sin auxiliar y la validación la rechaza: contabilizar
        // contra un cliente que no existe es peor que no contabilizar.
        const busqueda = busquedaDeLinea(l, cuentaPorCodigo, auxiliaresPorTipo)
        const ficha: Auxiliar | undefined =
          busqueda?.estado === 'unico' ? busqueda.auxiliar : undefined
        const sinCatalogo = tipo !== null && !tieneCatalogo(tipo)
        const auxiliarId =
          ficha?.id ?? (sinCatalogo ? l.auxiliar.trim() || null : null)
        return {
          cuenta: l.cuenta,
          cargo: l.cargo || '0',
          abono: l.abono || '0',
          concepto: l.concepto,
          libros: l.libros,
          auxiliarId,
          // Sin auxiliar resuelto no viaja el tipo: un tipo suelto sin id no
          // dice nada, y en una cuenta que no lo exige sería un dato falso.
          auxiliarTipo: auxiliarId ? tipo : null,
        }
      }),
    }),
    [
      fecha,
      concepto,
      moneda,
      tipoCambio,
      lineas,
      cuentaPorCodigo,
      auxiliaresPorTipo,
      documentoElegido,
    ],
  )

  const validacion = useMemo(
    () => validarAsiento(solicitud, { cuentas, periodos, esManual: true }),
    [solicitud, cuentas, periodos],
  )

  /**
   * Lo que el contrato no ve pero esta pantalla sí: texto tecleado en un
   * buscador que no resolvió a nada, o resolvió a varios. Al asiento iría sin
   * auxiliar (o sin documento) y el usuario creería que sí lo puso. No se
   * contabiliza hasta resolverlo.
   */
  const erroresCaptura = useMemo(() => {
    const errores: { linea?: number; mensaje: string }[] = []
    lineas.forEach((linea, indice) => {
      if (!linea.auxiliar.trim()) return
      const resultado = busquedaDeLinea(linea, cuentaPorCodigo, auxiliaresPorTipo)
      if (resultado?.estado === 'ambiguo') {
        errores.push({ linea: indice, mensaje: MENSAJE_AMBIGUO })
      } else if (resultado?.estado === 'ninguno') {
        errores.push({
          linea: indice,
          mensaje: `Ningún ${tipoDeLinea(linea, cuentaPorCodigo)} con ese código o nombre`,
        })
      }
    })
    if (documentoModulo && documentoTexto.trim() && !documentoElegido) {
      errores.push({
        mensaje:
          busquedaDocumento?.estado === 'ambiguo'
            ? 'Varios documentos coinciden, precisa la búsqueda'
            : 'Ningún documento con esa referencia',
      })
    }
    return errores
  }, [
    lineas,
    cuentaPorCodigo,
    auxiliaresPorTipo,
    documentoModulo,
    documentoTexto,
    documentoElegido,
    busquedaDocumento,
  ])

  const puedeContabilizar = validacion.valido && erroresCaptura.length === 0

  // Los totales se muestran SIEMPRE durante la captura, no solo al guardar, y
  // uno por libro: es la única forma de ver que el corporativo cuadra cuando el
  // tratamiento de los dos difiere.
  const totales = totalesPorLibro(lineas, moneda)
  const uniforme = tratamientoUniforme(lineas)
  // Si todas las líneas van a los mismos libros, los totales son idénticos:
  // repetir la fila dos veces solo obliga a compararlas para descubrir que no
  // hay nada que comparar.
  const filasTotales = uniforme ? totales.slice(0, 1) : totales
  const etiquetaTotales = (libro: Libro) =>
    uniforme && totales.length > 1
      ? 'ambas contabilidades'
      : etiquetaLibro(libro).toLowerCase()

  const actualizar = (clave: number, cambios: Partial<LineaCaptura>) =>
    setLineas((prev) =>
      prev.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)),
    )

  /**
   * Al salir del buscador, lo tecleado se completa con la ficha que identifica
   * si es una sola: "sabana" pasa a ser "C-002 · Comercial La Sabana S.A.", y
   * lo que queda en el campo es lo que se contabiliza, sin sorpresas.
   */
  const completarAuxiliar = (linea: LineaCaptura) => {
    const resultado = busquedaDeLinea(linea, cuentaPorCodigo, auxiliaresPorTipo)
    if (resultado?.estado !== 'unico') return
    const texto = textoAuxiliar(resultado.auxiliar)
    if (texto !== linea.auxiliar) actualizar(linea.clave, { auxiliar: texto })
  }

  const completarDocumento = () => {
    if (documentoElegido) {
      const texto = textoDocumento(documentoElegido)
      if (texto !== documentoTexto) setDocumentoTexto(texto)
    }
  }

  const alternarLibroLinea = (
    linea: LineaCaptura,
    libro: Libro,
    marcado: boolean,
  ) =>
    actualizar(linea.clave, {
      libros: marcado
        ? ordenarLibros([...linea.libros, libro])
        : linea.libros.filter((l) => l !== libro),
    })

  /** La casilla del encabezado es una acción en bloque sobre todas las líneas. */
  const alternarLibroAsiento = (libro: Libro, marcado: boolean) =>
    setLineas((prev) =>
      prev.map((l) => ({
        ...l,
        libros: marcado
          ? ordenarLibros([...l.libros, libro])
          : l.libros.filter((otro) => otro !== libro),
      })),
    )

  const agregarLinea = () =>
    setLineas((prev) => [
      ...prev,
      // La línea nueva hereda el tratamiento de la anterior: en un asiento con
      // diferencia fiscal, lo habitual es seguir capturando en el mismo libro.
      lineaVacia(prev.at(-1)?.libros ?? [...LIBROS_TODOS]),
    ])

  const eliminarLinea = (clave: number) =>
    setLineas((prev) =>
      prev.length <= 2 ? prev : prev.filter((l) => l.clave !== clave),
    )

  /** Enter en la última línea crea otra. Ctrl+Enter guarda (docs/14 §8). */
  const manejarTecla = (e: React.KeyboardEvent, esUltima: boolean) => {
    if (e.key !== 'Enter') return
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      guardar()
      return
    }
    if (esUltima) {
      e.preventDefault()
      agregarLinea()
    }
  }

  /**
   * Ctrl+Enter también desde el encabezado. Aquí Enter solo no hace nada: no
   * hay "última línea" a la que añadir otra.
   */
  const manejarTeclaEncabezado = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      guardar()
    }
  }

  /**
   * Hay algo capturado que se perdería al salir. La fecha sola no cuenta: la
   * pantalla ya la trae puesta, y cambiarla sin más no es haber empezado un
   * asiento.
   */
  const sucio =
    concepto.trim() !== '' ||
    documentoTexto.trim() !== '' ||
    lineas.some(
      (l) =>
        l.cuenta !== '' ||
        l.concepto.trim() !== '' ||
        l.cargo !== '' ||
        l.abono !== '' ||
        l.auxiliar.trim() !== '',
    )
  const { aviso, permitirSalida } = useAvisoSalida(sucio)

  /**
   * Candado contra el doble envío.
   *
   * `isPending` no basta: dos Ctrl+Enter seguidos (o la tecla que se repite al
   * dejarla pulsada) llegan antes de que React vuelva a pintar, y los dos ven
   * todavía `isPending` en falso. Dos envíos son dos asientos en el mayor.
   */
  const enviando = useRef(false)

  const guardar = () => {
    setIntentoEnvio(true)
    if (!puedeContabilizar || enviando.current || contabilizar.isPending) {
      return
    }
    enviando.current = true
    contabilizar.mutate(solicitud, {
      onSuccess: (asiento) => {
        permitirSalida()
        // Se llega con el asiento abierto: es la confirmación de lo que se
        // hizo, y se abre aunque su fecha caiga en otro periodo que el que la
        // lista tiene activo.
        void navegar(
          `/conta/asientos?asiento=${encodeURIComponent(asiento.id)}`,
        )
      },
      // Solo el error vuelve a abrir el candado. Tras el éxito la pantalla se
      // va, pero hasta que se desmonta el formulario sigue lleno y válido: un
      // Ctrl+Enter en ese intervalo contabilizaría el mismo asiento otra vez.
      onError: () => {
        enviando.current = false
      },
    })
  }

  /**
   * El error del servidor habla del asiento que se envió. En cuanto el usuario
   * toca algo ya no describe lo que hay en pantalla, y se retira.
   */
  const alEditar = () => {
    if (contabilizar.isError) contabilizar.reset()
  }

  const errorServidor =
    contabilizar.error instanceof ApiError ? contabilizar.error : null

  const periodoBloqueado = periodoActivo && periodoActivo.estado !== 'abierto'

  // Primero lo que se corrige en pantalla. El error del servidor solo tiene
  // sentido cuando lo local ya está bien: es lo único que llegó a enviarse.
  const mostrarLocales = intentoEnvio && !puedeContabilizar
  const mensajesError = mostrarLocales
    ? [
        ...validacion.errores.map((e) =>
          e.linea === undefined
            ? e.mensaje
            : `Línea ${e.linea + 1}: ${e.mensaje}`,
        ),
        ...erroresCaptura.map((e) =>
          e.linea === undefined
            ? e.mensaje
            : `Línea ${e.linea + 1}: ${e.mensaje}`,
        ),
      ]
    : (errorServidor?.detalles ?? [])

  return (
    // Cualquier edición retira el error del servidor: el evento change de los
    // campos sube hasta aquí, y así no hay que acordarse en cada campo.
    <div className="mx-auto max-w-6xl" onChange={alEditar}>
      {aviso}
      <PageHeader
        titulo="Nuevo asiento"
        descripcion="Captura manual. Las cuentas de control no están disponibles: solo las mueve su módulo dueño."
        acciones={
          <>
            <Button onClick={() => navegar('/conta/asientos')}>Cancelar</Button>
            <Button
              variante="primario"
              icono={<Save className="size-4" />}
              onClick={guardar}
              disabled={contabilizar.isPending}
            >
              {contabilizar.isPending ? 'Contabilizando…' : 'Contabilizar'}
            </Button>
          </>
        }
      />

      {periodoBloqueado && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200 ring-inset">
          <Lock className="size-4 shrink-0" />
          El periodo seleccionado en la barra superior está{' '}
          {periodoActivo.estado}. Puede capturar con una fecha de un periodo
          abierto.
        </div>
      )}

      {/* Sin barra de "Encabezado": la tarjeta ya separa el encabezado del
          detalle, y el rótulo solo añadía una franja que leer. */}
      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Fecha" requerido>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                onKeyDown={manejarTeclaEncabezado}
              />
            )}
          </Field>

          <Field label="Moneda" requerido>
            {(p) => (
              <Select
                {...p}
                value={moneda}
                onChange={(e) => {
                  const nueva = e.target.value
                  setMoneda(nueva)
                  // Se propone el tipo de referencia del catálogo; el usuario lo
                  // ajusta al del día. El que queda congelado es el del asiento.
                  setTipoCambio(
                    nueva === funcional
                      ? '1'
                      : configuracionMoneda(nueva).tipoCambio,
                  )
                }}
              >
                {disponibles.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.nombre} ({m.codigo})
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Tipo de cambio"
            requerido
            ayuda={
              moneda === funcional ? 'Moneda funcional' : 'Referencia BCCR'
            }
          >
            {(p) => (
              <Input
                {...p}
                value={tipoCambio}
                disabled={moneda === funcional}
                onChange={(e) => setTipoCambio(e.target.value)}
                className="tabular text-right"
              />
            )}
          </Field>

          {/* Los dos libros vienen marcados. Desmarcar uno es la excepción y
              tiene que ser un acto deliberado. */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">
              Contabilidades
            </span>
            <div className="flex h-9 items-center gap-4">
              {LIBROS.map((definicion) => (
                <label
                  key={definicion.codigo}
                  className="flex items-center gap-1.5 text-sm text-slate-700"
                >
                  <CasillaLibro
                    libro={definicion.codigo}
                    etiqueta={`${definicion.etiqueta}: todo el asiento`}
                    marcado={lineas.every((l) =>
                      l.libros.includes(definicion.codigo),
                    )}
                    onChange={(marcado) =>
                      alternarLibroAsiento(definicion.codigo, marcado)
                    }
                  />
                  {definicion.etiqueta}
                </label>
              ))}
            </div>
            {!uniforme && (
              <p className="text-xs text-amber-700">
                Hay líneas con tratamiento distinto entre libros.
              </p>
            )}
          </div>

          <Field label="Concepto" requerido className="lg:col-span-4">
            {(p) => (
              <Input
                {...p}
                value={concepto}
                placeholder="Descripción del asiento"
                onChange={(e) => setConcepto(e.target.value)}
                onKeyDown={manejarTeclaEncabezado}
              />
            )}
          </Field>
        </div>

        {/* Trazabilidad hacia el documento que motiva el ajuste. No es el
            origen: no da idempotencia ni abre cuentas de control. Es solo el
            hilo que un auditor sigue de la corrección a la factura. */}
        <div className="grid grid-cols-1 gap-4 border-t border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-4">
            <span className="text-xs font-medium text-slate-600">
              Documento relacionado
            </span>
            <span className="ml-1.5 text-xs text-slate-400">
              Opcional. Factura a la que se refiere este ajuste.
            </span>
          </div>
          <Field label="Módulo">
            {(p) => (
              <Select
                {...p}
                value={documentoModulo}
                onChange={(e) => {
                  const valor = e.target.value
                  setDocumentoModulo(esModuloConDocumentos(valor) ? valor : '')
                  // Lo tecleado era de otro catálogo: ya no identifica nada.
                  setDocumentoTexto('')
                }}
              >
                <option value="">Ninguno</option>
                {MODULOS_CON_DOCUMENTOS.map((modulo) => (
                  <option key={modulo} value={modulo}>
                    {ETIQUETA_MODULO[modulo]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {documentoModulo && (
            <Field
              label="Factura"
              className="lg:col-span-3"
              error={
                intentoEnvio && documentoTexto.trim() && !documentoElegido
                  ? busquedaDocumento?.estado === 'ambiguo'
                    ? 'Varios documentos coinciden, precisa la búsqueda'
                    : 'Ningún documento con esa referencia'
                  : undefined
              }
              ayuda={
                documentoElegido
                  ? `${documentoElegido.referencia} · ${documentoElegido.tercero} · ${formatFecha(documentoElegido.fecha)}`
                  : documentoTexto.trim() &&
                      busquedaDocumento?.estado === 'ambiguo'
                    ? 'Varios documentos coinciden, precisa la búsqueda'
                    : cargandoDocumentos
                      ? 'Cargando facturas…'
                      : 'Busque por consecutivo, folio o nombre del tercero'
              }
            >
              {(p) => (
                <>
                  <Input
                    {...p}
                    list={listaDocumentosId}
                    value={documentoTexto}
                    placeholder={
                      documentoModulo === 'cxc'
                        ? 'FE-00000114 o cliente'
                        : 'Folio o proveedor'
                    }
                    onChange={(e) => setDocumentoTexto(e.target.value)}
                    onBlur={completarDocumento}
                  />
                  <datalist id={listaDocumentosId}>
                    {documentos.map((d) => (
                      <option
                        key={d.id}
                        value={textoDocumento(d)}
                        label={[formatFecha(d.fecha), ...d.alias].join(' · ')}
                      />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
          )}
          {documentoElegido && (
            <p className="text-xs text-slate-500 lg:col-span-4">
              Total del documento:{' '}
              <MoneyCell
                valor={documentoElegido.total}
                moneda={documentoElegido.moneda}
              />
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          titulo="Movimientos"
          descripcion="Enter agrega línea · Ctrl+Enter contabiliza"
          acciones={
            <Button
              tamano="sm"
              icono={<Plus className="size-3.5" />}
              onClick={agregarLinea}
            >
              Agregar línea
            </Button>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="w-10 px-3 py-2 text-left">#</th>
                <th className="w-44 px-3 py-2 text-left">Cuenta</th>
                <th className="px-3 py-2 text-left">Concepto</th>
                <th className="w-48 px-3 py-2 text-left">Auxiliar</th>
                <th className="w-36 px-3 py-2 text-right">Cargo</th>
                <th className="w-36 px-3 py-2 text-right">Abono</th>
                {LIBROS.map((definicion) => (
                  <th
                    key={definicion.codigo}
                    title={`${definicion.etiqueta}: ${definicion.descripcion}`}
                    className="w-8 px-1 py-2 text-center"
                  >
                    {definicion.abreviatura}
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lineas.map((linea, indice) => {
                const cuenta = cuentaPorCodigo.get(linea.cuenta)
                const tipo = tipoDeLinea(linea, cuentaPorCodigo)
                const busqueda = busquedaDeLinea(
                  linea,
                  cuentaPorCodigo,
                  auxiliaresPorTipo,
                )
                const auxiliar =
                  busqueda?.estado === 'unico' ? busqueda.auxiliar : undefined
                const erroresLinea = intentoEnvio
                  ? validacion.errores.filter((e) => e.linea === indice)
                  : []
                const esUltima = indice === lineas.length - 1
                const sinLibro = erroresLinea.some(
                  (e) => e.codigo === 'LIBRO_REQUERIDO',
                )
                const auxiliarInvalido =
                  intentoEnvio &&
                  (erroresLinea.some((e) => e.codigo === 'AUXILIAR_REQUERIDO') ||
                    erroresCaptura.some((e) => e.linea === indice))

                return (
                  <tr
                    key={linea.clave}
                    className="border-b border-slate-100 align-top last:border-0"
                  >
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {indice + 1}
                    </td>
                    <td className="px-3 py-2">
                      <SelectorCuenta
                        value={linea.cuenta}
                        onChange={(codigo) => {
                          // El auxiliar pertenece al catálogo del tipo que
                          // aplicaba con la cuenta anterior: si el tipo
                          // cambia, lo tecleado ya no identifica a nadie.
                          const tipoNuevo =
                            cuentaPorCodigo.get(codigo)?.requiereAuxiliar ??
                            (linea.auxiliarTipo || null)
                          actualizar(linea.clave, {
                            cuenta: codigo,
                            ...(tipoNuevo !== tipo ? { auxiliar: '' } : {}),
                          })
                        }}
                        cuentas={cuentas}
                        excluirControl
                        autoFocus={indice === 0}
                        error={erroresLinea.some((e) =>
                          e.codigo.startsWith('CUENTA'),
                        )}
                        onKeyDown={(e) => manejarTecla(e, esUltima)}
                      />
                      {cuenta && (
                        <p className="mt-1 truncate text-[11px] text-slate-500">
                          {cuenta.nombre}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={linea.concepto}
                        aria-label="Concepto de la línea"
                        onChange={(e) =>
                          actualizar(linea.clave, { concepto: e.target.value })
                        }
                        onKeyDown={(e) => manejarTecla(e, esUltima)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {!cuenta ? (
                        <span className="text-xs text-slate-300">-</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {/* Si la cuenta exige auxiliar, el tipo lo fija la
                              cuenta (docs/02 §3). Si no, se ofrece elegirlo:
                              es opcional, y por omisión no hay ninguno. */}
                          {!cuenta.requiereAuxiliar && (
                            <Select
                              aria-label="Tipo de auxiliar"
                              value={linea.auxiliarTipo}
                              className="h-7 text-xs"
                              onChange={(e) =>
                                actualizar(linea.clave, {
                                  auxiliarTipo: e.target
                                    .value as TipoConCatalogo | '',
                                  auxiliar: '',
                                })
                              }
                            >
                              <option value="">Sin auxiliar</option>
                              {TIPOS_CON_CATALOGO.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </Select>
                          )}
                          {tipo && (
                            <>
                              <SelectorAuxiliar
                                tipo={tipo}
                                value={linea.auxiliar}
                                auxiliares={auxiliaresPorTipo.get(tipo) ?? []}
                                onChange={(texto) =>
                                  actualizar(linea.clave, { auxiliar: texto })
                                }
                                onBlur={() => completarAuxiliar(linea)}
                                onKeyDown={(e) => manejarTecla(e, esUltima)}
                                error={auxiliarInvalido}
                              />
                              {/* Se confirma a quién se contabiliza: en el
                                  campo puede quedar solo un código, y el
                                  nombre es lo que el usuario reconoce. */}
                              {auxiliar ? (
                                <p className="truncate text-[11px] text-slate-500">
                                  {auxiliar.nombre}
                                </p>
                              ) : linea.auxiliar.trim() &&
                                busqueda?.estado === 'ambiguo' ? (
                                <p className="text-[11px] text-amber-700">
                                  {MENSAJE_AMBIGUO}
                                </p>
                              ) : linea.auxiliar.trim() &&
                                busqueda?.estado === 'ninguno' ? (
                                <p className="text-[11px] text-amber-700">
                                  Ningún {tipo} con ese código o nombre
                                </p>
                              ) : null}
                            </>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <MoneyInput
                        value={linea.cargo}
                        moneda={moneda}
                        aria-label="Cargo"
                        onChange={(v) =>
                          actualizar(linea.clave, {
                            cargo: v,
                            abono: v ? '' : linea.abono,
                          })
                        }
                        onKeyDown={(e) => manejarTecla(e, esUltima)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MoneyInput
                        value={linea.abono}
                        moneda={moneda}
                        aria-label="Abono"
                        onChange={(v) =>
                          actualizar(linea.clave, {
                            abono: v,
                            cargo: v ? '' : linea.cargo,
                          })
                        }
                        onKeyDown={(e) => manejarTecla(e, esUltima)}
                      />
                    </td>
                    {LIBROS.map((definicion) => (
                      <td
                        key={definicion.codigo}
                        className={`px-1 py-2 text-center ${
                          sinLibro ? 'bg-red-50' : ''
                        }`}
                      >
                        <span className="inline-flex h-9 items-center">
                          <CasillaLibro
                            libro={definicion.codigo}
                            etiqueta={`${definicion.etiqueta}, línea ${indice + 1}`}
                            marcado={linea.libros.includes(definicion.codigo)}
                            onChange={(marcado) =>
                              alternarLibroLinea(
                                linea,
                                definicion.codigo,
                                marcado,
                              )
                            }
                          />
                        </span>
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => eliminarLinea(linea.clave)}
                        disabled={lineas.length <= 2}
                        title={
                          lineas.length <= 2
                            ? 'Un asiento requiere al menos dos líneas'
                            : 'Eliminar línea'
                        }
                        // Sin pointer-events-none: apagado, el botón sigue
                        // diciendo al pasar el ratón por qué lo está.
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-slate-50">
              {filasTotales.map((resumen) => (
                <tr
                  key={resumen.libro}
                  className="border-t border-slate-200 text-sm"
                >
                  <td
                    colSpan={4}
                    className="px-3 py-2 text-right font-semibold text-slate-800"
                  >
                    Totales
                    <span className="ml-1.5 font-normal text-slate-500">
                      · {etiquetaTotales(resumen.libro)}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-right font-semibold text-slate-800">
                    {formatMoney(resumen.totalCargos, { simbolo: false })}
                  </td>
                  <td className="tabular px-3 py-2 text-right font-semibold text-slate-800">
                    {formatMoney(resumen.totalAbonos, { simbolo: false })}
                  </td>
                  <td colSpan={3} className="px-3 py-2 text-right">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium ${
                        resumen.diferencia.esCero()
                          ? 'text-emerald-700'
                          : 'text-red-700'
                      }`}
                      title={
                        resumen.diferencia.esCero()
                          ? 'Cuadra'
                          : `Diferencia de ${formatMoney(resumen.diferencia)}`
                      }
                    >
                      {resumen.diferencia.esCero() ? (
                        <CircleCheck className="size-4" />
                      ) : (
                        <>
                          <CircleAlert className="size-4" />
                          {formatMoney(resumen.diferencia)}
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </Card>

      {mostrarLocales || errorServidor ? (
        <div
          role="alert"
          className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset"
        >
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {!mostrarLocales && errorServidor
              ? `${errorServidor.codigo}: ${errorServidor.message}`
              : 'El asiento no se puede contabilizar'}
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {mensajesError.map((mensaje, i) => (
              <li key={i}>{mensaje}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
