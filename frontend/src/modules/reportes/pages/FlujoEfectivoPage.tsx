import { useMemo } from 'react'
import { Card, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { SelectorLibro } from '@/shared/asiento/Libros'
import { etiquetaLibro } from '@/shared/asiento/libro'
import { formatPeriodo } from '@/shared/format/fecha'
import { monedaFuncional } from '@/shared/money/money'
import {
  primerPeriodoDelEjercicio,
  useBalanzaReporte,
  useCatalogosReporte,
} from '../api/queries'
import { construirEstadoFlujos, type SeccionFlujo } from '../domain/flujos'
import { saldosAlCierre, saldosAlInicio } from '../domain/saldos'
import { aCsv, importeCsv, nombreArchivo, type Celda } from '../domain/csv'
import {
  AccionesReporte,
  AvisoCuadre,
  AvisoSinClasificar,
  Calculando,
  EncabezadoReporte,
  FilaRenglon,
  FilaTitulo,
  FilaTotal,
  SelectorAlcance,
  TablaEstado,
} from '../components/Reporte'
import { descargar } from '../components/descargar'
import { useFiltrosReporte } from '../components/useFiltrosReporte'
import { descripcionIntervalo } from '../components/intervalo'
import { enlaceAuxiliar } from '../components/enlaces'

/**
 * Estado de Flujos de Efectivo, método indirecto (docs/09 §3.4).
 *
 * Es el único estado que se verifica contra algo que no es él mismo: la
 * variación que calcula tiene que ser exactamente la de los saldos de caja y
 * bancos, y eso se enseña en pantalla en vez de darlo por hecho (docs/17 §4).
 */
export function FlujoEfectivoPage() {
  const filtros = useFiltrosReporte()
  const { periodo, periodos, libro, alcance } = filtros
  const desde =
    alcance === 'mes' ? periodo : primerPeriodoDelEjercicio(periodos, periodo)

  const catalogos = useCatalogosReporte()
  const balanzaDesde = useBalanzaReporte(desde?.id, libro, { excluirCierre: true })
  const balanzaHasta = useBalanzaReporte(periodo?.id, libro, { excluirCierre: true })

  const estado = useMemo(() => {
    if (!catalogos.catalogos || !balanzaDesde.data || !balanzaHasta.data) return
    return construirEstadoFlujos(
      saldosAlInicio(balanzaDesde.data),
      saldosAlCierre(balanzaHasta.data),
      catalogos.catalogos,
    )
  }, [catalogos.catalogos, balanzaDesde.data, balanzaHasta.data])

  const consultas = [balanzaDesde, balanzaHasta]
  const error = catalogos.error ?? consultas.find((c) => c.error)?.error
  const intervalo = periodo ? descripcionIntervalo(periodo, alcance) : ''
  const enlace = (codigo: string) =>
    enlaceAuxiliar({ codigo, desde, hasta: periodo, libro })

  const exportar = () => {
    if (!estado || !periodo) return
    const seccion = (s: SeccionFlujo): Celda[][] => [
      [s.titulo],
      ...s.renglones.map((r) => [r.nombre, importeCsv(r.importe)]),
    ]
    const filas: Celda[][] = [
      ['Estado de Flujos de Efectivo (método indirecto)'],
      [intervalo],
      [`Contabilidad ${etiquetaLibro(libro).toLowerCase()}`],
      [],
      ['Concepto', 'Importe'],
      ['Utilidad neta', importeCsv(estado.utilidadNeta)],
      ...seccion(estado.operacion),
      ['Efectivo neto de las actividades de operación', importeCsv(estado.totalOperacion)],
      ...seccion(estado.inversion),
      ['Efectivo neto de las actividades de inversión', importeCsv(estado.inversion.total)],
      ...seccion(estado.financiamiento),
      ['Efectivo neto de las actividades de financiamiento', importeCsv(estado.financiamiento.total)],
      ['Variación neta del efectivo', importeCsv(estado.variacionCalculada)],
      ['Efectivo al inicio', importeCsv(estado.efectivoInicial)],
      ['Efectivo al final', importeCsv(estado.efectivoFinal)],
    ]
    descargar(
      aCsv(filas),
      nombreArchivo([
        'flujos-de-efectivo',
        alcance,
        formatPeriodo(periodo.ejercicio, periodo.numero),
        libro,
      ]),
    )
  }

  return (
    <div>
      <PageHeader
        titulo="Estado de Flujos de Efectivo"
        descripcion={
          periodo
            ? `Método indirecto · contabilidad ${etiquetaLibro(libro).toLowerCase()} · ${intervalo}`
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
        {estado && (
          <span className="ml-auto">
            <AvisoCuadre
              cuadra={estado.cuadra}
              correcto="La variación calculada es la de caja y bancos"
              incorrecto={
                <>
                  <strong>El estado no cuadra con el efectivo</strong>: la
                  variación calculada es {estado.variacionCalculada} y la de los
                  saldos de caja y bancos es {estado.variacionReal}. La
                  diferencia está en una cuenta de orden con saldo.
                </>
              }
            />
          </span>
        )}
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
              titulo="Estado de Flujos de Efectivo"
              lineas={[
                intervalo,
                `Método indirecto · contabilidad ${etiquetaLibro(libro).toLowerCase()} · Cifras en ${monedaFuncional()}`,
              ]}
            />
            <TablaEstado comparando={false} etiquetaActual={formatPeriodo(periodo.ejercicio, periodo.numero)}>
              <FilaTitulo titulo={estado.operacion.titulo} comparando={false} />
              <FilaRenglon
                renglon={{
                  clave: 'utilidad',
                  codigo: null,
                  nombre: 'Utilidad neta del periodo',
                  notas: [],
                  importe: estado.utilidadNeta,
                  comparado: null,
                  cuentas: [],
                  sinClasificar: false,
                }}
                comparando={false}
                sangria={1}
              />
              <Renglones seccion={estado.operacion} enlace={enlace} />
              <FilaTotal
                etiqueta="Efectivo neto de las actividades de operación"
                importe={estado.totalOperacion}
                comparado={null}
                comparando={false}
              />

              <FilaTitulo titulo={estado.inversion.titulo} comparando={false} />
              <Renglones seccion={estado.inversion} enlace={enlace} />
              <FilaTotal
                etiqueta="Efectivo neto de las actividades de inversión"
                importe={estado.inversion.total}
                comparado={null}
                comparando={false}
              />

              <FilaTitulo titulo={estado.financiamiento.titulo} comparando={false} />
              <Renglones seccion={estado.financiamiento} enlace={enlace} />
              <FilaTotal
                etiqueta="Efectivo neto de las actividades de financiamiento"
                importe={estado.financiamiento.total}
                comparado={null}
                comparando={false}
              />

              <FilaTotal
                etiqueta="Variación neta del efectivo"
                importe={estado.variacionCalculada}
                comparado={null}
                comparando={false}
                enfasis="total"
              />
              <FilaTotal
                etiqueta="Efectivo y equivalentes al inicio"
                importe={estado.efectivoInicial}
                comparado={null}
                comparando={false}
              />
              <FilaTotal
                etiqueta="Efectivo y equivalentes al final"
                importe={estado.efectivoFinal}
                comparado={null}
                comparando={false}
                enfasis="final"
              />
            </TablaEstado>
          </>
        )}
      </Card>
    </div>
  )
}

function Renglones({
  seccion,
  enlace,
}: {
  seccion: SeccionFlujo
  enlace: (codigo: string) => string
}) {
  if (seccion.renglones.length === 0) {
    return (
      <tr>
        <td colSpan={3} className="px-8 py-1.5 text-xs text-slate-400">
          Sin movimientos en el intervalo
        </td>
      </tr>
    )
  }
  return (
    <>
      {seccion.renglones.map((renglon) => (
        <FilaRenglon
          key={renglon.clave}
          renglon={renglon}
          comparando={false}
          enlaceCuenta={enlace}
          sangria={1}
        />
      ))}
    </>
  )
}
