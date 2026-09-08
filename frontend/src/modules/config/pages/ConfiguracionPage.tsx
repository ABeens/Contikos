import { Link } from 'react-router'
import {
  Building2,
  CalendarRange,
  Coins,
  Percent,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Card, PageHeader } from '@/shared/ui/Layout'
import { hoyISO } from '@/shared/format/fecha'
import { DatosDemostracion } from '../components/DatosDemostracion'
import { useMonedas, useTarifasImpuesto } from '../api/queries'
import { useEmpresa } from '@/app/empresa'

interface Seccion {
  ruta?: string
  titulo: string
  icono: LucideIcon
  descripcion: string
  /** Marca la sección que todavía no se construye. */
  pendiente?: boolean
}

/**
 * Índice de configuración.
 *
 * Todo lo que aquí se lista es dato de la empresa, no constante del código:
 * es la diferencia entre un sistema que se instala y uno que se recompila.
 */
const SECCIONES: Seccion[] = [
  {
    ruta: '/configuracion/monedas',
    titulo: 'Monedas',
    icono: Coins,
    descripcion:
      'Catálogo, moneda funcional, decimales y formato de presentación.',
  },
  {
    ruta: '/configuracion/empresas',
    titulo: 'Empresas',
    icono: Building2,
    descripcion:
      'Las empresas del grupo: razón social, cédula jurídica y ejercicio. Cada una lleva sus propios catálogos y su propio mayor.',
  },
  {
    ruta: '/configuracion/impuestos',
    titulo: 'Impuestos',
    icono: Percent,
    descripcion:
      'Tarifas de IVA con vigencia por fecha. Ninguna tasa vive en el código: cada factura resuelve la suya por su fecha de emisión.',
  },
  {
    ruta: '/conta/periodos',
    titulo: 'Periodos contables',
    icono: CalendarRange,
    descripcion:
      'Apertura, cierre y bloqueo. También se eligen desde la barra superior.',
  },
  {
    ruta: '/configuracion/tipos-cambio',
    titulo: 'Tipos de cambio',
    icono: TrendingUp,
    descripcion:
      'Serie diaria de compra y venta, con carga automática desde el BCCR.',
  },
  {
    titulo: 'Usuarios y roles',
    icono: Users,
    descripcion:
      'Permisos por empresa: el rol se asigna por empresa y los datos no se cruzan.',
    pendiente: true,
  },
]

export function ConfiguracionPage() {
  const { data: monedas = [] } = useMonedas()
  // Las que rigen hoy, que es el resumen que interesa de un vistazo: las
  // cerradas siguen en la tabla para los documentos de su época.
  const { data: tarifas = [] } = useTarifasImpuesto(hoyISO())
  const { empresa, empresas } = useEmpresa()
  const funcional = monedas.find((m) => m.funcional)
  const activas = monedas.filter((m) => m.activa).length
  const empresasActivas = empresas.filter((e) => e.activa).length

  const resumenDe = (ruta?: string): string | undefined => {
    if (ruta === '/configuracion/monedas' && funcional) {
      return `${activas} activas · funcional ${funcional.codigo}`
    }
    if (ruta === '/configuracion/empresas') {
      return `${empresasActivas} activas · abierta ${empresa.codigo}`
    }
    if (ruta === '/configuracion/impuestos' && tarifas.length > 0) {
      return `${tarifas.length} tarifas vigentes hoy`
    }
    return undefined
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader titulo="Configuración" />

      <div className="grid gap-3 sm:grid-cols-2">
        {SECCIONES.map((seccion) => (
          <Tarjeta
            key={seccion.titulo}
            seccion={seccion}
            resumen={resumenDe(seccion.ruta)}
          />
        ))}
      </div>

      <DatosDemostracion />
    </div>
  )
}

function Tarjeta({
  seccion,
  resumen,
}: {
  seccion: Seccion
  resumen?: string
}) {
  const { icono: Icono, titulo, descripcion, pendiente, ruta } = seccion

  const contenido = (
    <Card
      className={
        ruta
          ? 'h-full transition-colors hover:border-brand-300 hover:bg-brand-50/40'
          : 'h-full bg-slate-50/60'
      }
    >
      <div className="flex gap-3 p-4">
        <div
          className={`grid size-8 shrink-0 place-items-center rounded-md ${
            ruta ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-500'
          }`}
        >
          <Icono className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            {titulo}
            {pendiente && (
              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                Pendiente
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{descripcion}</p>
          {resumen && (
            <p className="mt-1.5 text-[11px] font-medium text-brand-700">
              {resumen}
            </p>
          )}
        </div>
      </div>
    </Card>
  )

  return ruta ? <Link to={ruta}>{contenido}</Link> : contenido
}
