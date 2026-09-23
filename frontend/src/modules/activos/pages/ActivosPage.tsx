import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import Decimal from 'decimal.js'
import { Calculator, Plus, Search, TriangleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { LinkBoton } from '@/shared/ui/LinkBoton'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Field'
import { EstadoBadge } from '@/shared/ui/EstadoBadge'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatMoney } from '@/shared/money/format'
import { formatFecha } from '@/shared/format/fecha'
import type { Activo } from '@/shared/api/contracts/activos'
import { useActivos, useAltasPendientes } from '../api/queries'
import { cuotaMensual } from '../domain/activo'

/**
 * Inventario de activos (docs/07 §4).
 *
 * Marca de dónde viene cada activo: la compra registrada en CxP o el alta
 * directa. No es un detalle administrativo, es la diferencia entre un activo
 * cuyo asiento hizo otro módulo y uno que se contabilizó aquí.
 *
 * La ficha abierta vive en la URL (`?activo=`) y se guarda por id, no como
 * copia: así un refetch enseña los datos nuevos del mismo activo, nunca vuelve
 * a abrir uno que el usuario cerró, y el enlace se puede compartir.
 */
export function ActivosPage() {
  const consulta = useActivos()
  const { data: activos = [] } = consulta
  const { data: pendientes = [] } = useAltasPendientes()
  const [parametros, setParametros] = useSearchParams()
  const [filtro, setFiltro] = useState('')
  const [visibles, setVisibles] = useState(0)

  // `?activo=` es también la ida desde la línea de la factura en CxP y la
  // vuelta tras dar de alta: quien llega quiere esa ficha, no el inventario.
  const seleccionadoId = parametros.get('activo')
  const seleccionado = activos.find((a) => a.id === seleccionadoId) ?? null

  const abrirFicha = (activo: Activo) => {
    const nuevos = new URLSearchParams(parametros)
    nuevos.set('activo', activo.id)
    setParametros(nuevos, { replace: true })
  }

  const cerrarFicha = () => {
    const nuevos = new URLSearchParams(parametros)
    nuevos.delete('activo')
    setParametros(nuevos, { replace: true })
  }

  /**
   * Totales por moneda, de lo que el filtro deja ver.
   *
   * Sumar un costo en dólares con uno en colones da un número que no es de
   * ninguna moneda. Y si el buscador deja tres activos, los totales son de
   * esos tres: una cifra que no cuadra con la tabla de debajo confunde más de
   * lo que informa.
   */
  const totales = useMemo(() => {
    const porMoneda = new Map<
      string,
      { costo: Decimal; depreciacion: Decimal }
    >()
    for (const a of activos) {
      if (!coincide(a, filtro)) continue
      const previo = porMoneda.get(a.moneda) ?? {
        costo: new Decimal(0),
        depreciacion: new Decimal(0),
      }
      porMoneda.set(a.moneda, {
        costo: previo.costo.plus(new Decimal(a.costoAdquisicion)),
        depreciacion: previo.depreciacion.plus(
          new Decimal(a.depreciacionAcumulada),
        ),
      })
    }
    return [...porMoneda.entries()].map(([moneda, t]) => ({
      moneda,
      costo: t.costo.toFixed(2),
      depreciacion: t.depreciacion.toFixed(2),
      libros: t.costo.minus(t.depreciacion).toFixed(2),
    }))
  }, [activos, filtro])

  const columnas = useMemo<ColumnDef<Activo, unknown>[]>(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Código',
        meta: { ancho: '100px' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-600">
            {row.original.codigo}
          </span>
        ),
      },
      {
        // El buscador promete buscar por categoría: el valor de la columna
        // lleva las dos cosas, aunque la celda las pinte en dos renglones.
        id: 'nombre',
        header: 'Activo',
        accessorFn: textoNombre,
        cell: ({ row }) => (
          <div>
            <p className="text-slate-800">{row.original.nombre}</p>
            <p className="text-[11px] text-slate-500">
              {row.original.categoriaNombre}
            </p>
          </div>
        ),
      },
      {
        id: 'origen',
        header: 'Origen',
        meta: { ancho: '150px' },
        accessorFn: textoOrigen,
        cell: ({ row }) =>
          row.original.origen === 'cxp' ? (
            <Link
              to={`/cxp/facturas?factura=${row.original.facturaId}`}
              onClick={(e) => e.stopPropagation()}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200 hover:text-brand-700"
            >
              Factura {row.original.facturaFolio}
            </Link>
          ) : (
            <span className="text-[11px] text-slate-400">Alta directa</span>
          ),
      },
      {
        accessorKey: 'fechaAdquisicion',
        header: 'Adquisición',
        meta: { ancho: '110px' },
        cell: ({ row }) => formatFecha(row.original.fechaAdquisicion),
      },
      {
        id: 'costo',
        header: 'Costo',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (a) => a.costoAdquisicion,
        cell: ({ row }) => (
          <MoneyCell
            valor={row.original.costoAdquisicion}
            moneda={row.original.moneda}
          />
        ),
      },
      {
        id: 'depreciacion',
        header: 'Dep. acumulada',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (a) => a.depreciacionAcumulada,
        cell: ({ row }) => (
          <MoneyCell
            valor={row.original.depreciacionAcumulada}
            moneda={row.original.moneda}
            ocultarCero
          />
        ),
      },
      {
        id: 'libros',
        header: 'Valor en libros',
        meta: { numerico: true, ancho: '140px' },
        accessorFn: (a) => a.valorEnLibros,
        cell: ({ row }) => (
          <MoneyCell
            valor={row.original.valorEnLibros}
            moneda={row.original.moneda}
          />
        ),
      },
      {
        accessorKey: 'estado',
        header: 'Estado',
        meta: { ancho: '120px' },
        cell: ({ row }) => <EstadoBadge estado={row.original.estado} />,
      },
    ],
    [],
  )

  return (
    <div>
      <PageHeader
        titulo="Activos fijos"
        descripcion="Inventario de activos, su costo y su valor en libros."
        acciones={
          <>
            <LinkBoton
              to="/activos/depreciacion"
              icono={<Calculator className="size-4" />}
            >
              Depreciación
            </LinkBoton>
            <LinkBoton
              to="/activos/nuevo"
              variante="primario"
              icono={<Plus className="size-4" />}
            >
              Registrar activo
            </LinkBoton>
          </>
        }
      />

      {pendientes.length > 0 && (
        <Link
          to="/activos/nuevo?modo=factura"
          className="mb-4 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200 ring-inset hover:bg-amber-100"
        >
          <TriangleAlert className="size-4 shrink-0" />
          {pendientes.length} compra{pendientes.length === 1 ? '' : 's'} cargada
          {pendientes.length === 1 ? '' : 's'} a una cuenta de activo fijo sin
          ficha. Mientras existan, el auxiliar no cuadra contra el mayor.
        </Link>
      )}

      {totales.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3">
          <Resumen
            titulo="Costo de adquisición"
            valores={totales.map((t) => ({ moneda: t.moneda, valor: t.costo }))}
          />
          <Resumen
            titulo="Depreciación acumulada"
            valores={totales.map((t) => ({
              moneda: t.moneda,
              valor: t.depreciacion,
            }))}
          />
          <Resumen
            titulo="Valor en libros"
            valores={totales.map((t) => ({ moneda: t.moneda, valor: t.libros }))}
            destacado
          />
        </div>
      )}

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search className="size-4 text-slate-400" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por nombre, código o categoría…"
            aria-label="Buscar activo"
            className="h-8 max-w-sm border-0 px-0 focus:ring-0"
          />
          <span className="ml-auto text-xs text-slate-500">
            {filtro.trim() && visibles !== activos.length
              ? `${visibles} de ${activos.length} activos`
              : `${activos.length} activos`}
          </span>
        </div>

        <DataTable
          columns={columnas}
          data={activos}
          filtro={filtro}
          onRowClick={abrirFicha}
          esSeleccionada={(a) => a.id === seleccionadoId}
          alFiltrar={setVisibles}
          cargando={consulta.isLoading}
          error={consulta.error}
          onReintentar={() => void consulta.refetch()}
          vacio={{
            titulo: 'Sin activos registrados',
            descripcion:
              'Registre uno desde una factura de compra o como alta directa.',
          }}
        />
      </Card>

      {seleccionado && (
        <Card className="mt-4">
          <CardHeader
            titulo={`${seleccionado.codigo} · ${seleccionado.nombre}`}
            descripcion={seleccionado.descripcion ?? undefined}
            acciones={
              <Button tamano="sm" onClick={cerrarFicha}>
                Cerrar
              </Button>
            }
          />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <Dato titulo="Categoría" valor={seleccionado.categoriaNombre} />
            <Dato
              titulo="Vida útil"
              valor={`${seleccionado.vidaUtilMeses} meses`}
            />
            <Dato
              titulo="Método"
              valor={
                seleccionado.metodo === 'linea_recta'
                  ? 'Línea recta'
                  : 'Saldos decrecientes'
              }
            />
            <Dato
              titulo="Cuota mensual"
              valor={formatMoney(cuotaMensual(seleccionado))}
            />
            <Dato
              titulo="Adquisición"
              valor={formatFecha(seleccionado.fechaAdquisicion)}
            />
            <Dato
              titulo="Inicio de depreciación"
              valor={formatFecha(seleccionado.fechaInicioDepreciacion)}
            />
            <Dato
              titulo="Valor residual"
              valor={formatMoney({
                monto: new Decimal(seleccionado.valorResidual),
                moneda: seleccionado.moneda,
              })}
            />
            <Dato titulo="Ubicación" valor={seleccionado.ubicacion ?? 'Sin definir'} />
            <Dato
              titulo="Responsable"
              valor={seleccionado.responsable ?? 'Sin asignar'}
            />
            <Dato
              titulo="Número de serie"
              valor={seleccionado.numeroSerie ?? 'Sin registrar'}
            />
            <Dato
              titulo="Origen"
              valor={
                seleccionado.origen === 'cxp'
                  ? `Factura ${seleccionado.facturaFolio} de ${seleccionado.proveedorNombre}`
                  : 'Alta directa'
              }
              enlace={
                seleccionado.origen === 'cxp'
                  ? `/cxp/facturas?factura=${seleccionado.facturaId}`
                  : undefined
              }
            />
            <Dato
              titulo="Asiento propio"
              valor={
                seleccionado.origen === 'cxp'
                  ? 'No: lo contabilizó la compra en CxP'
                  : (seleccionado.asientoId ?? 'Sin asiento')
              }
              enlace={
                seleccionado.origen !== 'cxp' && seleccionado.asientoId
                  ? `/conta/asientos?asiento=${seleccionado.asientoId}`
                  : undefined
              }
            />
          </dl>
          <HistorialDepreciaciones activo={seleccionado} />
        </Card>
      )}
    </div>
  )
}

/* --------------------------------------------------------- Búsqueda */

function textoNombre(a: Activo): string {
  return `${a.nombre} ${a.categoriaNombre}`
}

function textoOrigen(a: Activo): string {
  return a.origen === 'cxp'
    ? `compra cxp factura ${a.facturaFolio ?? ''}`
    : 'alta directa'
}

/**
 * El mismo criterio que el filtro global de la tabla: el texto aparece dentro
 * del valor de alguna columna. Lo usan los totales para sumar exactamente las
 * filas que se ven.
 */
function coincide(a: Activo, filtro: string): boolean {
  const buscado = filtro.toLowerCase()
  if (!buscado) return true
  return [
    a.codigo,
    textoNombre(a),
    textoOrigen(a),
    a.fechaAdquisicion,
    a.costoAdquisicion,
    a.depreciacionAcumulada,
    a.valorEnLibros,
    a.estado,
  ].some((valor) => valor.toLowerCase().includes(buscado))
}

/**
 * Las cuotas que ya entraron al mayor sobre el activo.
 *
 * Es lo que explica la acumulada de la ficha: cada renglón es una corrida
 * contabilizada y lleva al asiento que la escribió.
 */
function HistorialDepreciaciones({ activo }: { activo: Activo }) {
  const depreciaciones = activo.depreciaciones ?? []
  return (
    <div className="border-t border-slate-200 px-4 py-3">
      <h3 className="text-xs font-semibold text-slate-600">
        Depreciaciones contabilizadas
      </h3>
      {depreciaciones.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">
          Ninguna corrida ha tocado este activo todavía.
        </p>
      ) : (
        <table className="mt-2 w-full max-w-xl text-sm" aria-label="Depreciaciones del activo">
          <thead className="text-[11px] text-slate-500">
            <tr>
              <th className="py-1 text-left font-medium">Periodo</th>
              <th className="py-1 text-left font-medium">Fecha</th>
              <th className="py-1 text-right font-medium">Cuota</th>
              <th className="py-1 pl-4 text-left font-medium">Asiento</th>
            </tr>
          </thead>
          <tbody>
            {[...depreciaciones].reverse().map((d) => (
              <tr key={d.periodoId} className="border-t border-slate-100">
                <td className="py-1 font-mono text-xs text-slate-600">{d.periodoId}</td>
                <td className="py-1 text-slate-700">{formatFecha(d.fecha)}</td>
                <td className="py-1 text-right">
                  <MoneyCell valor={d.cuota} moneda={activo.moneda} />
                </td>
                <td className="py-1 pl-4">
                  <Link
                    to={`/conta/asientos?asiento=${d.asientoId}`}
                    className="font-mono text-xs text-brand-700 hover:underline"
                  >
                    {d.asientoId}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Resumen({
  titulo,
  valores,
  destacado,
}: {
  titulo: string
  /** Un renglón por moneda: importes de monedas distintas no se suman. */
  valores: { moneda: string; valor: string }[]
  destacado?: boolean
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <p className="text-[11px] text-slate-500">{titulo}</p>
      {valores.map((v) => (
        <p
          key={v.moneda}
          className={`text-lg font-semibold ${destacado ? 'text-brand-700' : 'text-slate-900'}`}
        >
          <MoneyCell valor={v.valor} moneda={v.moneda} mostrarSimbolo />
        </p>
      ))}
    </div>
  )
}

function Dato({
  titulo,
  valor,
  enlace,
}: {
  titulo: string
  valor: string
  /** Documento del que sale el dato, cuando se puede llegar a él. */
  enlace?: string
}) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500">{titulo}</dt>
      <dd className="text-slate-800">
        {enlace ? (
          <Link to={enlace} className="text-brand-700 hover:underline">
            {valor}
          </Link>
        ) : (
          valor
        )}
      </dd>
    </div>
  )
}
