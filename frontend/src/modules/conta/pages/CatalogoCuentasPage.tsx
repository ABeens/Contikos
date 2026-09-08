import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus, Search } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, PageHeader } from '@/shared/ui/Layout'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Field'
import type { Cuenta } from '@/shared/api/contracts/conta'
import { DialogoClasificarCuenta } from '../components/DialogoClasificarCuenta'
import { DialogoCuenta } from '../components/DialogoCuenta'
import {
  ETIQUETA_TIPO_CUENTA,
  NATURALEZA_HABITUAL,
  referenciaNota,
} from '../domain/clasificacion'
import {
  useAsientos,
  useClasificacionesNiif,
  useCuentas,
  useNotasEeff,
} from '../api/queries'

export function CatalogoCuentasPage() {
  const { data: cuentas = [], isLoading } = useCuentas()
  const { data: clasificaciones = [] } = useClasificacionesNiif()
  const { data: notas = [] } = useNotasEeff()
  const { data: asientos = [] } = useAsientos()

  const [filtro, setFiltro] = useState('')
  const [soloPendientes, setSoloPendientes] = useState(false)
  const [clasificando, setClasificando] = useState<Cuenta | null>(null)
  const [editando, setEditando] = useState<Cuenta | null>(null)
  const [creando, setCreando] = useState(false)

  /**
   * Cuentas que el mayor ya usa.
   *
   * Marca el límite de lo que se puede reescribir: con una línea de asiento
   * encima, la definición de la cuenta deja de ser editable (docs/03 §2).
   */
  const conMovimientos = useMemo(
    () =>
      new Set(asientos.flatMap((a) => a.lineas.map((l) => l.cuentaCodigo))),
    [asientos],
  )

  // Los renglones y las notas se resuelven una vez y no por celda: la tabla
  // pinta el catálogo entero y buscar en un array por fila se nota.
  const porId = useMemo(
    () => ({
      clasificaciones: new Map(clasificaciones.map((c) => [c.id, c])),
      notas: new Map(notas.map((n) => [n.id, n])),
    }),
    [clasificaciones, notas],
  )

  const detalle = cuentas.filter((c) => c.esDetalle)
  /**
   * Cuentas de detalle a las que les falta renglón o nota.
   *
   * Hoy ninguna nace así: las dos son obligatorias en el alta (docs/03 §2 bis).
   * El filtro se queda porque un catálogo importado de otro sistema sí puede
   * llegar incompleto, y entonces es la lista de trabajo para completarlo.
   */
  const pendientes = detalle.filter(
    (c) => c.clasificacionNiifId === null || c.notaEeffId === null,
  )

  const visibles = soloPendientes ? pendientes : cuentas

  const columnas = useMemo<ColumnDef<Cuenta, unknown>[]>(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Código',
        meta: { ancho: '150px' },
        cell: ({ row }) => (
          <span
            className="font-mono text-xs text-slate-600"
            style={{ paddingLeft: `${(row.original.nivel - 1) * 12}px` }}
          >
            {row.original.codigo}
          </span>
        ),
      },
      {
        accessorKey: 'nombre',
        header: 'Nombre',
        cell: ({ row }) => (
          <span
            className={
              row.original.esDetalle
                ? 'text-slate-700'
                : 'font-semibold text-slate-900'
            }
          >
            {row.original.nombre}
          </span>
        ),
      },
      {
        accessorKey: 'tipo',
        header: 'Tipo',
        meta: { ancho: '150px' },
        // Tipo y naturaleza iban en dos columnas que decían lo mismo en el 95%
        // de las filas. La naturaleza solo se enseña cuando es la contraria a
        // la de su tipo, que es cuando aporta algo.
        cell: ({ row }) => {
          const { tipo, naturaleza } = row.original
          return (
            <span className="text-xs text-slate-500">
              {ETIQUETA_TIPO_CUENTA[tipo]}
              {naturaleza !== NATURALEZA_HABITUAL[tipo] && (
                <span className="ml-1 text-amber-700">· {naturaleza}</span>
              )}
            </span>
          )
        },
      },
      {
        id: 'presentacion',
        header: 'Presentación',
        meta: { ancho: '260px' },
        cell: ({ row }) => {
          const cuenta = row.original
          // Las acumulativas presentan lo que suman sus hijas: no llevan
          // renglón propio y decirlo evita que alguien intente asignárselo.
          if (!cuenta.esDetalle) {
            return <span className="text-xs text-slate-300">Suma sus hijas</span>
          }
          const clasificacion = cuenta.clasificacionNiifId
            ? porId.clasificaciones.get(cuenta.clasificacionNiifId)
            : undefined
          if (!clasificacion) {
            return (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                Sin clasificar
              </span>
            )
          }
          const nota = cuenta.notaEeffId
            ? porId.notas.get(cuenta.notaEeffId)
            : undefined
          // Clasificada pero sin nota: le falta la mitad de la presentación y
          // el renglón no se puede desglosar contra ella.
          if (!nota) {
            return (
              <div className="min-w-0">
                <p className="truncate text-xs text-slate-600">
                  <span className="font-mono text-slate-500">
                    {clasificacion.codigo}
                  </span>{' '}
                  {clasificacion.nombre}
                </p>
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  Sin nota
                </span>
              </div>
            )
          }
          // La nota suele titularse igual que el renglón que explica. Repetir
          // el título debajo llenaba la columna de texto duplicado: basta con
          // su número, y solo se escribe entero cuando de verdad difiere.
          const notaRepiteRenglon = nota.titulo === clasificacion.nombre
          return (
            <div className="min-w-0">
              <p className="truncate text-xs text-slate-600">
                <span className="font-mono text-slate-500">
                  {clasificacion.codigo}
                </span>{' '}
                {clasificacion.nombre}
                {notaRepiteRenglon && (
                  <span className="ml-1.5 text-slate-400">
                    Nota {referenciaNota(nota)}
                  </span>
                )}
              </p>
              {!notaRepiteRenglon && (
                <p className="truncate text-[11px] text-slate-400">
                  Nota {referenciaNota(nota)} · {nota.titulo}
                </p>
              )}
            </div>
          )
        },
      },
      {
        id: 'editar',
        header: '',
        meta: { ancho: '44px' },
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={`Editar la cuenta ${row.original.codigo}`}
            title="Editar la cuenta"
            onClick={(e) => {
              e.stopPropagation()
              setEditando(row.original)
            }}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-700"
          >
            <Pencil className="size-3.5" />
          </button>
        ),
      },
      {
        id: 'marcas',
        header: 'Marcas',
        meta: { ancho: '230px' },
        cell: ({ row }) => {
          const c = row.original
          return (
            <div className="flex flex-wrap gap-1">
              {c.esCuentaControl && (
                <Marca tono="amber" titulo="Solo la mueve su módulo dueño">
                  Control · {c.moduloDueno}
                </Marca>
              )}
              {c.requiereAuxiliar && (
                <Marca tono="sky">Auxiliar: {c.requiereAuxiliar}</Marca>
              )}
              {c.moneda && <Marca tono="violet">{c.moneda}</Marca>}
              {!c.activa && <Marca tono="red">Inactiva</Marca>}
            </div>
          )
        },
      },
    ],
    [porId],
  )

  return (
    <div>
      <PageHeader
        titulo="Catálogo de cuentas"
        descripcion="Pulse una cuenta para reasignarle su clasificación NIIF y su nota, o el lápiz para editarla."
        acciones={
          <Button
            variante="primario"
            icono={<Plus className="size-4" />}
            onClick={() => setCreando(true)}
          >
            Nueva cuenta
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search className="size-4 text-slate-400" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por código o nombre…"
            className="h-8 max-w-sm border-0 px-0 focus:ring-0"
          />
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={soloPendientes}
              className="size-3.5 accent-brand-600"
              onChange={(e) => setSoloPendientes(e.target.checked)}
            />
            Solo sin presentación ({pendientes.length})
          </label>
          <span className="text-xs text-slate-500">
            {cuentas.length} cuentas · {detalle.length} de detalle
          </span>
        </div>

        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Cargando catálogo…
          </p>
        ) : (
          <DataTable
            columns={columnas}
            data={visibles}
            filtro={filtro}
            onRowClick={setClasificando}
            maxAltura="calc(100vh - 260px)"
            vacio={{
              titulo: soloPendientes ? 'Todo clasificado' : 'Sin resultados',
              descripcion: soloPendientes
                ? 'Todas las cuentas de detalle tienen su renglón del estado financiero y su nota.'
                : 'Ninguna cuenta coincide con la búsqueda.',
            }}
          />
        )}
      </Card>

      {clasificando && (
        <DialogoClasificarCuenta
          key={clasificando.id}
          abierto
          cuenta={clasificando}
          clasificaciones={clasificaciones}
          notas={notas}
          cuentas={cuentas}
          onCerrar={() => setClasificando(null)}
        />
      )}

      {(creando || editando) && (
        <DialogoCuenta
          key={editando?.id ?? 'nueva'}
          abierto
          cuenta={editando ?? undefined}
          cuentas={cuentas}
          clasificaciones={clasificaciones}
          notas={notas}
          conMovimientos={conMovimientos}
          onCerrar={() => {
            setCreando(false)
            setEditando(null)
          }}
        />
      )}
    </div>
  )
}

function Marca({
  tono,
  titulo,
  children,
}: {
  tono: 'slate' | 'amber' | 'sky' | 'violet' | 'red'
  titulo?: string
  children: React.ReactNode
}) {
  const tonos = {
    slate: 'bg-slate-100 text-slate-600',
    amber: 'bg-amber-50 text-amber-700',
    sky: 'bg-sky-50 text-sky-700',
    violet: 'bg-violet-50 text-violet-700',
    red: 'bg-red-50 text-red-700',
  }
  return (
    <span
      title={titulo}
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tonos[tono]}`}
    >
      {children}
    </span>
  )
}
