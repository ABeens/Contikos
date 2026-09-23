import { useId } from 'react'

/**
 * Diagrama hub-and-spoke de la arquitectura.
 *
 * Cinco módulos subsidiarios alimentan asientos al núcleo contable; reportes es
 * el único que lee del mayor en lugar de escribir en él; de ahí la flecha
 * punteada y en sentido inverso.
 */

interface Caja {
  cx: number
  cy: number
  titulo: string
  subtitulo: string
}

const FEEDERS: Caja[] = [
  { cx: 90, cy: 52, titulo: 'RH', subtitulo: 'planilla' },
  { cx: 280, cy: 44, titulo: 'activos', subtitulo: 'depreciación' },
  { cx: 470, cy: 52, titulo: 'bancos', subtitulo: 'movimientos' },
  { cx: 72, cy: 190, titulo: 'cxc', subtitulo: 'ventas y cobros' },
  { cx: 488, cy: 190, titulo: 'cxp', subtitulo: 'compras y pagos' },
]

/** Trazos desde cada módulo hasta el borde del hub. */
const FLECHAS: [x1: number, y1: number, x2: number, y2: number][] = [
  [143, 74, 201, 149],
  [280, 69, 280, 145],
  [417, 74, 359, 149],
  [129, 190, 188, 190],
  [431, 190, 372, 190],
]

export function DiagramaArquitectura() {
  const marcadorId = useId()
  const marcadorLectura = `${marcadorId}-lectura`

  return (
    <svg
      viewBox="0 0 560 380"
      className="h-auto w-full"
      role="img"
      aria-label="Cinco módulos (RH, activos, bancos, cuentas por cobrar y cuentas por pagar) envían asientos al núcleo de contabilidad general, del que reportes lee para producir los estados financieros."
    >
      <defs>
        <marker
          id={marcadorId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-slate-400" />
        </marker>
        <marker
          id={marcadorLectura}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-brand-400" />
        </marker>
      </defs>

      {FLECHAS.map(([x1, y1, x2, y2]) => (
        <line
          key={`${x1}-${y1}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          className="stroke-slate-300"
          strokeWidth={1.5}
          markerEnd={`url(#${marcadorId})`}
        />
      ))}

      {/* Reportes LEE del mayor: sentido inverso y trazo punteado */}
      <line
        x1={280}
        y1={230}
        x2={280}
        y2={304}
        className="stroke-brand-300"
        strokeWidth={1.5}
        strokeDasharray="4 3"
        markerEnd={`url(#${marcadorLectura})`}
      />
      <text
        x={292}
        y={270}
        className="fill-brand-500 text-[10px]"
        dominantBaseline="middle"
      >
        lee
      </text>

      <text
        x={280}
        y={112}
        textAnchor="middle"
        className="fill-slate-400 text-[10px]"
      >
        asientos de partida doble
      </text>

      {FEEDERS.map((caja) => (
        <CajaModulo key={caja.titulo} {...caja} />
      ))}

      {/* Hub */}
      <g>
        <rect
          x={195}
          y={152}
          width={170}
          height={76}
          rx={10}
          className="fill-brand-600"
        />
        <text
          x={280}
          y={181}
          textAnchor="middle"
          className="fill-white text-[15px] font-semibold"
        >
          conta
        </text>
        <text
          x={280}
          y={201}
          textAnchor="middle"
          className="fill-brand-100 text-[10px]"
        >
          libro mayor
        </text>
      </g>

      <CajaModulo
        cx={280}
        cy={332}
        titulo="reportes"
        subtitulo="estados financieros"
        ancho={140}
        punteada
      />
    </svg>
  )
}

function CajaModulo({
  cx,
  cy,
  titulo,
  subtitulo,
  ancho = 112,
  punteada = false,
}: Caja & { ancho?: number; punteada?: boolean }) {
  const alto = 48
  return (
    <g>
      <rect
        x={cx - ancho / 2}
        y={cy - alto / 2}
        width={ancho}
        height={alto}
        rx={8}
        className={
          punteada
            ? 'fill-white stroke-brand-200'
            : 'fill-white stroke-slate-200'
        }
        strokeWidth={1.5}
        strokeDasharray={punteada ? '4 3' : undefined}
      />
      <text
        x={cx}
        y={cy - 3}
        textAnchor="middle"
        className="fill-slate-800 text-[13px] font-medium"
      >
        {titulo}
      </text>
      <text
        x={cx}
        y={cy + 12}
        textAnchor="middle"
        className="fill-slate-400 text-[9.5px]"
      >
        {subtitulo}
      </text>
    </g>
  )
}
