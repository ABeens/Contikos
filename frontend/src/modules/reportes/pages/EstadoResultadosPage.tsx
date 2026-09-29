import { useMemo } from 'react'
import { Card, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { SelectorLibro } from '@/shared/asiento/Libros'
import { etiquetaLibro } from '@/shared/asiento/libro'
import { formatPeriodo } from '@/shared/format/fecha'
import { ETIQUETA_GRUPO } from '@/shared/presentacion/grupos'
import { monedaFuncional } from '@/shared/money/money'
import type { GrupoPresentacion, Periodo } from '@/shared/api/contracts/conta'
import { useCatalogosReporte } from '../api/queries'
import { construirEstadoResultados } from '../domain/estados'
import { aCsv, importeCsv, nombreArchivo, type Celda } from '../domain/csv'
import {
  AccionesReporte,
  AvisoSinClasificar,
  Calculando,
  EncabezadoReporte,
  FilaTotal,
  FilasGrupo,
  SelectorAlcance,
  SelectorComparar,
  TablaEstado,
} from '../components/Reporte'
import { descargar } from '../components/descargar'
import { useFiltrosReporte } from '../components/useFiltrosReporte'
import { descripcionIntervalo } from '../components/intervalo'
import { useMovimientos } from '../components/useMovimientos'
import { encabezadoCsv, filasGrupo } from '../components/exportar'
import { enlaceAuxiliar } from '../components/enlaces'

/**
 * Estado de Resultados (docs/09 §3.3).
 *
 * Del mes o acumulado del ejercicio, con los subtotales de la norma
 * intercalados. Cada renglón se presenta por su efecto en la utilidad: los
 * gastos en negativo, entre paréntesis.
 */
export function EstadoResultadosPage() {
  const filtros = useFiltrosReporte()
  const { periodo, periodos, libro, comparado, alcance } = filtros
  const comparando = comparado !== undefined

  const catalogos = useCatalogosReporte()
  const actual = useMovimientos(periodo, periodos, libro, alcance)
  const otro = useMovimientos(comparado, periodos, libro, alcance, comparando)

  const estado = useMemo(() => {
    if (!catalogos.catalogos || !actual.movimientos) return
    if (comparando && !otro.movimientos) return
    return construirEstadoResultados(
      actual.movimientos,
      comparando ? otro.movimientos! : null,
      catalogos.catalogos,
    )
  }, [catalogos.catalogos, actual.movimientos, otro.movimientos, comparando])

  const consultas = [...actual.consultas, ...otro.consultas]
  const error = catalogos.error ?? consultas.find((c) => c.error)?.error

  const etiqueta = (p: Periodo | undefined) =>
    p ? formatPeriodo(p.ejercicio, p.numero) : ''
  const intervalo = periodo ? descripcionIntervalo(periodo, alcance) : ''
  const enlace = (codigo: string) =>
    enlaceAuxiliar({ codigo, desde: actual.desde, hasta: periodo, libro })

  const exportar = () => {
    if (!estado) return
    const filas: Celda[][] = [
      ['Estado de Resultados'],
      [intervalo],
      [`Contabilidad ${etiquetaLibro(libro).toLowerCase()}`],
      [],
      encabezadoCsv(etiqueta(periodo), comparando ? etiqueta(comparado) : null),
    ]
    for (const bloque of estado.bloques) {
      if (bloque.tipo === 'grupo') {
        filas.push(...filasGrupo(tituloGrupo(bloque.grupo.grupo), bloque.grupo, comparando))
      } else {
        filas.push([
          bloque.etiqueta,
          '',
          '',
          importeCsv(bloque.importe),
          ...(comparando ? [importeCsv(bloque.comparado)] : []),
        ])
      }
    }
    descargar(
      aCsv(filas),
      nombreArchivo(['estado-de-resultados', alcance, etiqueta(periodo), libro]),
    )
  }

  return (
    <div>
      <PageHeader
        titulo="Estado de Resultados"
        descripcion={
          periodo
            ? `Contabilidad ${etiquetaLibro(libro).toLowerCase()} · ${intervalo} · ${monedaFuncional()}`
            : undefined
        }
        acciones={
          <>
            <SelectorLibro valor={libro} onChange={filtros.setLibro} />
            <AccionesReporte onExportar={exportar} exportable={Boolean(estado)} />
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
        <SelectorAlcance valor={alcance} onChange={filtros.setAlcance} />
        <SelectorComparar
          periodos={periodos}
          actual={periodo}
          comparado={comparado}
          onChange={filtros.setComparado}
        />
      </div>

      {estado?.haySinClasificar && (
        <div className="mb-3">
          <AvisoSinClasificar />
        </div>
      )}

      <Card>
        {error ? (
          <EstadoError
            error={error}
            onReintentar={() => {
              catalogos.reintentar()
              consultas.forEach((c) => void c.refetch())
            }}
          />
        ) : !estado || !periodo ? (
          <Calculando />
        ) : (
          <>
            <EncabezadoReporte
              titulo="Estado de Resultados"
              lineas={[
                intervalo,
                `Contabilidad ${etiquetaLibro(libro).toLowerCase()} · Cifras en ${monedaFuncional()}`,
              ]}
            />
            <TablaEstado
              comparando={comparando}
              etiquetaActual={etiqueta(periodo)}
              etiquetaComparado={etiqueta(comparado)}
            >
              {estado.bloques.map((bloque) =>
                bloque.tipo === 'grupo' ? (
                  <FilasGrupo
                    key={bloque.grupo.grupo ?? 'sin-clasificar'}
                    titulo={tituloGrupo(bloque.grupo.grupo)}
                    grupo={bloque.grupo}
                    comparando={comparando}
                    enlaceCuenta={enlace}
                  />
                ) : (
                  <FilaTotal
                    key={bloque.clave}
                    etiqueta={bloque.etiqueta}
                    importe={bloque.importe}
                    comparado={bloque.comparado}
                    comparando={comparando}
                    enfasis={bloque.final ? 'final' : 'total'}
                  />
                ),
              )}
            </TablaEstado>
          </>
        )}
      </Card>
    </div>
  )
}

function tituloGrupo(grupo: GrupoPresentacion | null): string {
  return grupo ? ETIQUETA_GRUPO[grupo] : 'Otros resultados sin clasificar'
}
