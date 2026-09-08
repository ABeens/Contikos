import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { CircleAlert, FileText, PenLine, Save } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, EstadoVacio, PageHeader } from '@/shared/ui/Layout'
import { Field, Input, Select } from '@/shared/ui/Field'
import { SelectorCuenta } from '@/shared/ui/SelectorCuenta'
import { MoneyInput } from '@/shared/money/MoneyInput'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha, hoyISO } from '@/shared/format/fecha'
import { ApiError } from '@/shared/api/client'
import {
  configuracionMoneda,
  monedaFuncional,
  monedasActivas,
  type Moneda,
} from '@/shared/money/money'
import { cn } from '@/shared/ui/cn'
import { useCuentas, usePeriodos } from '@/shared/api/catalogos'
import type {
  AltaPendiente,
  SolicitudActivoDesdeFactura,
  SolicitudActivoManual,
} from '@/shared/api/contracts/activos'
import {
  useAltaDesdeFactura,
  useAltaManual,
  useAltasPendientes,
  useCategorias,
} from '../api/queries'
import {
  lineasAsientoAltaManual,
  validarAltaDesdeFactura,
  validarAltaManual,
} from '../domain/activo'

/**
 * Alta de activo por sus dos puertas (docs/07 §3.1).
 *
 * La diferencia entre ellas es contable y la pantalla la dice en voz alta: la
 * que viene de una factura no genera asiento, porque la compra ya reconoció el
 * activo en el mayor; el alta directa sí, porque nadie más lo hizo.
 */

type Modo = 'factura' | 'manual'

export function AltaActivoPage() {
  const [parametros, setParametros] = useSearchParams()
  const modo: Modo = parametros.get('modo') === 'manual' ? 'manual' : 'factura'

  const setModo = (nuevo: Modo) => {
    const nuevos = new URLSearchParams(parametros)
    nuevos.set('modo', nuevo)
    setParametros(nuevos, { replace: true })
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        titulo="Registrar activo fijo"
        descripcion="Desde la factura de compra que ya se contabilizó, o como alta directa."
      />

      <div
        role="radiogroup"
        aria-label="Origen del activo"
        className="mb-4 inline-flex rounded-md bg-slate-100 p-0.5"
      >
        <BotonModo
          activo={modo === 'factura'}
          onClick={() => setModo('factura')}
          icono={<FileText className="size-4" />}
          etiqueta="Desde factura de compra"
        />
        <BotonModo
          activo={modo === 'manual'}
          onClick={() => setModo('manual')}
          icono={<PenLine className="size-4" />}
          etiqueta="Registro manual"
        />
      </div>

      {modo === 'factura' ? <AltaDesdeFactura /> : <AltaManual />}
    </div>
  )
}

function BotonModo({
  activo,
  onClick,
  icono,
  etiqueta,
}: {
  activo: boolean
  onClick: () => void
  icono: React.ReactNode
  etiqueta: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activo}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors',
        activo ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900',
      )}
    >
      {icono}
      {etiqueta}
    </button>
  )
}

/* ------------------------------------------------ Desde factura de CxP */

function AltaDesdeFactura() {
  const navegar = useNavigate()
  const [parametros] = useSearchParams()
  const { data: pendientes = [], isLoading } = useAltasPendientes()
  const { data: categorias = [] } = useCategorias()
  const alta = useAltaDesdeFactura()

  const [seleccion, setSeleccion] = useState<AltaPendiente | null>(null)
  const [datos, setDatos] = useState({
    nombre: '',
    categoriaId: '',
    fechaInicioDepreciacion: hoyISO(),
    ubicacion: '',
    responsable: '',
    numeroSerie: '',
  })
  const [intento, setIntento] = useState(false)

  const elegir = useCallback((pendiente: AltaPendiente) => {
    setSeleccion(pendiente)
    setDatos({
      nombre: pendiente.descripcion,
      categoriaId: pendiente.categoriaSugeridaId ?? '',
      fechaInicioDepreciacion: pendiente.fecha,
      ubicacion: '',
      responsable: '',
      numeroSerie: '',
    })
    setIntento(false)
  }, [])

  /**
   * Línea que pide la URL, cuando se llega desde la factura en CxP.
   *
   * Quien viene de allí ya eligió qué capitalizar: repetir la elección en esta
   * tabla sería pedirle dos veces lo mismo.
   */
  const facturaPedida = parametros.get('factura')
  const lineaPedida = parametros.get('linea')
  const pedidaResuelta =
    facturaPedida && lineaPedida
      ? pendientes.find(
          (p) => p.facturaId === facturaPedida && p.lineaId === lineaPedida,
        )
      : undefined

  useEffect(() => {
    if (pedidaResuelta && !seleccion) elegir(pedidaResuelta)
  }, [pedidaResuelta, seleccion, elegir])

  const solicitud: SolicitudActivoDesdeFactura | null = useMemo(
    () =>
      seleccion
        ? {
            facturaId: seleccion.facturaId,
            lineaId: seleccion.lineaId,
            nombre: datos.nombre,
            categoriaId: datos.categoriaId,
            fechaInicioDepreciacion: datos.fechaInicioDepreciacion,
            ubicacion: datos.ubicacion || null,
            responsable: datos.responsable || null,
            numeroSerie: datos.numeroSerie || null,
          }
        : null,
    [seleccion, datos],
  )

  const validacion = useMemo(
    () =>
      solicitud
        ? validarAltaDesdeFactura(solicitud, { categorias, pendientes })
        : { valido: false, errores: [] },
    [solicitud, categorias, pendientes],
  )

  const errorServidor = alta.error instanceof ApiError ? alta.error : null

  const guardar = async () => {
    setIntento(true)
    if (!solicitud || !validacion.valido) return
    await alta.mutateAsync(solicitud)
    navegar('/activos')
  }

  return (
    <>
      <Card className="mb-4">
        <CardHeader
          titulo="Compras pendientes de ficha"
          descripcion="Líneas de factura que cargaron una cuenta de activo fijo y todavía no tienen activo. Mientras existan, el auxiliar no cuadra contra el mayor."
        />

        {/* El enlace llegó apuntando a una línea que ya no está en la lista:
            alguien la registró antes, y callarlo dejaría la pantalla en blanco
            sin explicar por qué. */}
        {!isLoading && facturaPedida && lineaPedida && !pedidaResuelta && (
          <p className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            La línea que traía el enlace ya tiene su ficha de activo o dejó de
            cargar una cuenta de activo fijo.
          </p>
        )}

        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Buscando compras pendientes…
          </p>
        ) : pendientes.length === 0 ? (
          <EstadoVacio
            titulo="No hay compras pendientes de registrar"
            descripcion="Cada línea de activo capturada en CxP ya tiene su ficha."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="w-28 px-3 py-2 text-left">Factura</th>
                <th className="px-3 py-2 text-left">Descripción</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="w-36 px-3 py-2 text-left">Cuenta</th>
                <th className="w-36 px-4 py-2 text-right">Costo</th>
              </tr>
            </thead>
            <tbody>
              {pendientes.map((pendiente) => {
                const elegido =
                  seleccion?.facturaId === pendiente.facturaId &&
                  seleccion?.lineaId === pendiente.lineaId
                return (
                  <tr
                    key={`${pendiente.facturaId}-${pendiente.lineaId}`}
                    onClick={() => elegir(pendiente)}
                    className={cn(
                      'cursor-pointer border-b border-slate-100 last:border-0',
                      elegido ? 'bg-brand-50' : 'hover:bg-slate-50',
                    )}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="radio"
                        checked={elegido}
                        aria-label={`Registrar ${pendiente.descripcion}`}
                        onChange={() => elegir(pendiente)}
                        className="size-3.5 accent-brand-600"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {pendiente.facturaFolio}
                      <p className="text-[11px] text-slate-400">
                        {formatFecha(pendiente.fecha)}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {pendiente.descripcion}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {pendiente.proveedorNombre}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">
                      {pendiente.cuenta}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <MoneyCell
                        valor={pendiente.importe}
                        moneda={pendiente.moneda}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {seleccion && (
        <Card>
          <CardHeader
            titulo="Ficha del activo"
            descripcion="No genera asiento: el de la compra ya reconoció el activo en el mayor."
            acciones={
              <Button
                variante="primario"
                icono={<Save className="size-4" />}
                onClick={() => void guardar()}
                disabled={alta.isPending}
              >
                {alta.isPending ? 'Registrando…' : 'Registrar activo'}
              </Button>
            }
          />
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Nombre" requerido className="lg:col-span-2">
              {(p) => (
                <Input
                  {...p}
                  value={datos.nombre}
                  onChange={(e) =>
                    setDatos((prev) => ({ ...prev, nombre: e.target.value }))
                  }
                />
              )}
            </Field>

            <Field label="Categoría" requerido>
              {(p) => (
                <Select
                  {...p}
                  value={datos.categoriaId}
                  onChange={(e) =>
                    setDatos((prev) => ({ ...prev, categoriaId: e.target.value }))
                  }
                >
                  <option value="">Seleccione</option>
                  {categorias
                    .filter((c) => c.activa)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre} ({c.vidaUtilMeses} meses)
                      </option>
                    ))}
                </Select>
              )}
            </Field>

            <Field
              label="Inicio de depreciación"
              requerido
              ayuda="Cuando queda disponible para su uso"
            >
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={datos.fechaInicioDepreciacion}
                  onChange={(e) =>
                    setDatos((prev) => ({
                      ...prev,
                      fechaInicioDepreciacion: e.target.value,
                    }))
                  }
                />
              )}
            </Field>

            <Field label="Ubicación">
              {(p) => (
                <Input
                  {...p}
                  value={datos.ubicacion}
                  onChange={(e) =>
                    setDatos((prev) => ({ ...prev, ubicacion: e.target.value }))
                  }
                />
              )}
            </Field>

            <Field label="Responsable">
              {(p) => (
                <Input
                  {...p}
                  value={datos.responsable}
                  onChange={(e) =>
                    setDatos((prev) => ({ ...prev, responsable: e.target.value }))
                  }
                />
              )}
            </Field>

            <Field label="Número de serie">
              {(p) => (
                <Input
                  {...p}
                  value={datos.numeroSerie}
                  onChange={(e) =>
                    setDatos((prev) => ({ ...prev, numeroSerie: e.target.value }))
                  }
                />
              )}
            </Field>
          </div>

          <ResumenErrores
            visible={(intento && !validacion.valido) || Boolean(errorServidor)}
            titulo={
              errorServidor
                ? `${errorServidor.codigo}: ${errorServidor.message}`
                : 'El activo no se puede registrar'
            }
            mensajes={
              errorServidor?.detalles.length
                ? errorServidor.detalles
                : validacion.errores.map((e) => e.mensaje)
            }
          />
        </Card>
      )}
    </>
  )
}

/* ------------------------------------------------------- Alta directa */

function AltaManual() {
  const navegar = useNavigate()
  const { data: categorias = [] } = useCategorias()
  const { data: cuentas = [] } = useCuentas()
  const { data: periodos = [] } = usePeriodos()
  const alta = useAltaManual()

  const funcional = monedaFuncional()

  const [datos, setDatos] = useState({
    nombre: '',
    descripcion: '',
    categoriaId: '',
    fechaAdquisicion: hoyISO(),
    fechaInicioDepreciacion: hoyISO(),
    costoAdquisicion: '',
    valorResidual: '',
    cuentaContrapartida: '',
    ubicacion: '',
    responsable: '',
    numeroSerie: '',
  })
  const [moneda, setMoneda] = useState<Moneda>(funcional)
  const [tipoCambio, setTipoCambio] = useState('1')
  const [intento, setIntento] = useState(false)

  const cambiar = (cambios: Partial<typeof datos>) =>
    setDatos((prev) => ({ ...prev, ...cambios }))

  const solicitud: SolicitudActivoManual = useMemo(
    () => ({
      nombre: datos.nombre,
      descripcion: datos.descripcion || null,
      categoriaId: datos.categoriaId,
      fechaAdquisicion: datos.fechaAdquisicion,
      fechaInicioDepreciacion: datos.fechaInicioDepreciacion,
      moneda,
      tipoCambio: tipoCambio || '0',
      costoAdquisicion: datos.costoAdquisicion || '0',
      valorResidual: datos.valorResidual || undefined,
      cuentaContrapartida: datos.cuentaContrapartida,
      ubicacion: datos.ubicacion || null,
      responsable: datos.responsable || null,
      numeroSerie: datos.numeroSerie || null,
    }),
    [datos, moneda, tipoCambio],
  )

  const categoria = categorias.find((c) => c.id === datos.categoriaId)

  const validacion = useMemo(
    () => validarAltaManual(solicitud, { categorias, cuentas, periodos }),
    [solicitud, categorias, cuentas, periodos],
  )

  const lineasAsiento = useMemo(
    () =>
      categoria && datos.cuentaContrapartida
        ? lineasAsientoAltaManual(solicitud, categoria, {
            id: 'nuevo',
            nombre: datos.nombre || 'Activo por registrar',
          })
        : [],
    [categoria, datos.cuentaContrapartida, datos.nombre, solicitud],
  )

  const nombreCuenta = (codigo: string) =>
    cuentas.find((c) => c.codigo === codigo)?.nombre ?? ''

  const errorServidor = alta.error instanceof ApiError ? alta.error : null

  const guardar = async () => {
    setIntento(true)
    if (!validacion.valido) return
    await alta.mutateAsync(solicitud)
    navegar('/activos')
  }

  return (
    <>
      <Card className="mb-4">
        <CardHeader
          titulo="Datos del activo"
          acciones={
            <Button
              variante="primario"
              icono={<Save className="size-4" />}
              onClick={() => void guardar()}
              disabled={alta.isPending}
            >
              {alta.isPending ? 'Contabilizando…' : 'Dar de alta y contabilizar'}
            </Button>
          }
        />
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Nombre" requerido className="lg:col-span-2">
            {(p) => (
              <Input
                {...p}
                value={datos.nombre}
                onChange={(e) => cambiar({ nombre: e.target.value })}
              />
            )}
          </Field>

          <Field label="Categoría" requerido>
            {(p) => (
              <Select
                {...p}
                value={datos.categoriaId}
                onChange={(e) => cambiar({ categoriaId: e.target.value })}
              >
                <option value="">Seleccione</option>
                {categorias
                  .filter((c) => c.activa)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} ({c.vidaUtilMeses} meses)
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          <Field label="Descripción" className="lg:col-span-3">
            {(p) => (
              <Input
                {...p}
                value={datos.descripcion}
                onChange={(e) => cambiar({ descripcion: e.target.value })}
              />
            )}
          </Field>

          <Field label="Fecha de adquisición" requerido>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={datos.fechaAdquisicion}
                onChange={(e) =>
                  cambiar({
                    fechaAdquisicion: e.target.value,
                    fechaInicioDepreciacion:
                      datos.fechaInicioDepreciacion < e.target.value
                        ? e.target.value
                        : datos.fechaInicioDepreciacion,
                  })
                }
              />
            )}
          </Field>

          <Field
            label="Inicio de depreciación"
            requerido
            ayuda="Cuando queda disponible para su uso"
          >
            {(p) => (
              <Input
                {...p}
                type="date"
                value={datos.fechaInicioDepreciacion}
                onChange={(e) =>
                  cambiar({ fechaInicioDepreciacion: e.target.value })
                }
              />
            )}
          </Field>

          <Field label="Costo de adquisición" requerido>
            {(p) => (
              <MoneyInput
                {...p}
                value={datos.costoAdquisicion}
                moneda={moneda}
                onChange={(v) => cambiar({ costoAdquisicion: v })}
              />
            )}
          </Field>

          <Field
            label="Valor residual"
            ayuda={
              categoria
                ? `Vacío: ${categoria.porcentajeResidual}% del costo`
                : 'Vacío: el porcentaje de la categoría'
            }
          >
            {(p) => (
              <MoneyInput
                {...p}
                value={datos.valorResidual}
                moneda={moneda}
                onChange={(v) => cambiar({ valorResidual: v })}
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
                  setTipoCambio(
                    nueva === funcional
                      ? '1'
                      : configuracionMoneda(nueva).tipoCambio,
                  )
                }}
              >
                {monedasActivas().map((m) => (
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
            ayuda={moneda === funcional ? 'Moneda funcional' : 'Referencia BCCR'}
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

          <Field
            label="Cuenta de contrapartida"
            requerido
            ayuda="Capital, donación o construcción en proceso"
          >
            {() => (
              <SelectorCuenta
                value={datos.cuentaContrapartida}
                onChange={(codigo) => cambiar({ cuentaContrapartida: codigo })}
                cuentas={cuentas}
                excluirControl
              />
            )}
          </Field>

        </div>

        {/* Ubicación, responsable y serie son control de inventario: no entran
            en el asiento y no hacen falta para dar de alta. Van plegados para
            que el formulario enseñe solo lo que hay que contestar. */}
        <details className="border-t border-slate-200">
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-slate-600 hover:text-brand-700">
            Datos de inventario (opcional)
          </summary>
          <div className="grid grid-cols-1 gap-4 px-4 pt-1 pb-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Ubicación">
              {(p) => (
                <Input
                  {...p}
                  value={datos.ubicacion}
                  onChange={(e) => cambiar({ ubicacion: e.target.value })}
                />
              )}
            </Field>

            <Field label="Responsable">
              {(p) => (
                <Input
                  {...p}
                  value={datos.responsable}
                  onChange={(e) => cambiar({ responsable: e.target.value })}
                />
              )}
            </Field>

            <Field label="Número de serie">
              {(p) => (
                <Input
                  {...p}
                  value={datos.numeroSerie}
                  onChange={(e) => cambiar({ numeroSerie: e.target.value })}
                />
              )}
            </Field>
          </div>
        </details>
      </Card>

      <Card>
        <CardHeader titulo="Asiento que se generará" />
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Cuenta</th>
              <th className="px-3 py-2 text-left">Concepto</th>
              <th className="w-36 px-3 py-2 text-right">Cargo</th>
              <th className="w-36 px-4 py-2 text-right">Abono</th>
            </tr>
          </thead>
          <tbody>
            {lineasAsiento.map((linea, indice) => (
              <tr
                key={`${linea.cuenta}-${indice}`}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="px-4 py-1.5 text-slate-700">
                  {nombreCuenta(linea.cuenta)}{' '}
                  <span className="font-mono text-xs text-slate-400">
                    {linea.cuenta}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-500">
                  {linea.concepto}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <MoneyCell valor={linea.cargo} moneda={moneda} ocultarCero />
                </td>
                <td className="px-4 py-1.5 text-right">
                  <MoneyCell valor={linea.abono} moneda={moneda} ocultarCero />
                </td>
              </tr>
            ))}
            {lineasAsiento.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  Elija la categoría y la contrapartida para ver el asiento.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <ResumenErrores
        visible={(intento && !validacion.valido) || Boolean(errorServidor)}
        titulo={
          errorServidor
            ? `${errorServidor.codigo}: ${errorServidor.message}`
            : 'El activo no se puede dar de alta'
        }
        mensajes={
          errorServidor?.detalles.length
            ? errorServidor.detalles
            : validacion.errores.map((e) => e.mensaje)
        }
      />
    </>
  )
}

function ResumenErrores({
  visible,
  titulo,
  mensajes,
}: {
  visible: boolean
  titulo: string
  mensajes: readonly string[]
}) {
  if (!visible) return null
  return (
    <div className="m-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
      <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
        <CircleAlert className="size-4" />
        {titulo}
      </p>
      <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
        {mensajes.map((mensaje, i) => (
          <li key={i}>{mensaje}</li>
        ))}
      </ul>
    </div>
  )
}
