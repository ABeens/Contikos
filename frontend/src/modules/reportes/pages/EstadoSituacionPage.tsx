import { useMemo } from 'react'
import { Card, EstadoError, PageHeader } from '@/shared/ui/Layout'
import { SelectorLibro } from '@/shared/asiento/Libros'
import { etiquetaLibro } from '@/shared/asiento/libro'
import { formatFechaLarga, formatPeriodo } from '@/shared/format/fecha'
import { ETIQUETA_GRUPO } from '@/shared/presentacion/grupos'
import { monedaFuncional } from '@/shared/money/money'
import {
  primerPeriodoDelEjercicio,
  useBalanzaReporte,
  useCatalogosReporte,
} from '../api/queries'
import { construirEstadoSituacion } from '../domain/estados'
import { saldosAlCierre, saldosAlInicio } from '../domain/saldos'
import { aCsv, importeCsv, nombreArchivo } from '../domain/csv'
import type { LadoSituacion } from '../domain/estados'
import {
  AccionesReporte,
  AvisoCuadre,
  AvisoSinClasificar,
  Calculando,
  EncabezadoReporte,
  FilaTitulo,
  FilaTotal,
  FilasGrupo,
  SelectorComparar,
  TablaEstado,
} from '../components/Reporte'
import { descargar } from '../components/descargar'
import { useFiltrosReporte } from '../components/useFiltrosReporte'
import { encabezadoCsv, filasGrupo } from '../components/exportar'
import { enlaceAuxiliar } from '../components/enlaces'

/**
 * Estado de Situación Financiera (docs/09 §3.2).
 *
 * Saldos al cierre del periodo, agrupados por la clasificación NIIF de cada
 * cuenta. El resultado del ejercicio entra como renglón del patrimonio mientras
 * el ejercicio no se cierra, que es lo que hace que la ecuación contable se
 * cumpla antes del cierre.
 */
export function EstadoSituacionPage() {
  const filtros = useFiltrosReporte()
  const { periodo, periodos, libro, comparado } = filtros
  const comparando = comparado !== undefined

  const catalogos = useCatalogosReporte()
  const inicio = primerPeriodoDelEjercicio(periodos, periodo)
  const inicioComparado = primerPeriodoDelEjercicio(periodos, comparado)

  const balanza = useBalanzaReporte(periodo?.id, libro)
  const balanzaInicio = useBalanzaReporte(inicio?.id, libro)
  const balanzaComparada = useBalanzaReporte(comparado?.id, libro, {
    habilitado: comparando,
  })
  const balanzaInicioComparada = useBalanzaReporte(inicioComparado?.id, libro, {
    habilitado: comparando,
  })

  const estado = useMemo(() => {
    if (!catalogos.catalogos || !balanza.data || !balanzaInicio.data) return
    const corteComparado =
      comparando && balanzaComparada.data && balanzaInicioComparada.data
        ? {
            alCierre: saldosAlCierre(balanzaComparada.data),
            alAbrirEjercicio: saldosAlInicio(balanzaInicioComparada.data),
          }
        : null
    if (comparando && !corteComparado) return
    return construirEstadoSituacion(
      {
        alCierre: saldosAlCierre(balanza.data),
        alAbrirEjercicio: saldosAlInicio(balanzaInicio.data),
      },
      corteComparado,
      catalogos.catalogos,
    )
  }, [
    catalogos.catalogos,
    balanza.data,
    balanzaInicio.data,
    balanzaComparada.data,
    balanzaInicioComparada.data,
    comparando,
  ])

  const consultas = [balanza, balanzaInicio, balanzaComparada, balanzaInicioComparada]
  const error = catalogos.error ?? consultas.find((c) => c.error)?.error

  const etiquetaActual = periodo ? formatPeriodo(periodo.ejercicio, periodo.numero) : ''
  const etiquetaComparado = comparado
    ? formatPeriodo(comparado.ejercicio, comparado.numero)
    : undefined
  const enlace = (codigo: string) =>
    enlaceAuxiliar({ codigo, desde: inicio, hasta: periodo, libro })

  const exportar = () => {
    if (!estado || !periodo) return
    const filas = [
      ['Estado de Situación Financiera'],
      [`Al ${formatFechaLarga(periodo.fechaFin)}`],
      [`Contabilidad ${etiquetaLibro(libro).toLowerCase()}`],
      [],
      encabezadoCsv(etiquetaActual, etiquetaComparado ?? null),
      ...filasLado('Activo', estado.activo, comparando),
      ['Total activo', '', '', importeCsv(estado.activo.total), ...(comparando ? [importeCsv(estado.activo.comparado)] : [])],
      ...filasLado('Pasivo', estado.pasivo, comparando),
      ...filasLado('Patrimonio', estado.patrimonio, comparando),
      [
        'Total pasivo y patrimonio',
        '',
        '',
        importeCsv(estado.totalPasivoPatrimonio),
        ...(comparando ? [importeCsv(estado.totalPasivoPatrimonioComparado)] : []),
      ],
    ]
    descargar(
      aCsv(filas),
      nombreArchivo(['estado-de-situacion', etiquetaActual, libro]),
    )
  }

  return (
    <div>
      <PageHeader
        titulo="Estado de Situación Financiera"
        descripcion={
          periodo
            ? `Contabilidad ${etiquetaLibro(libro).toLowerCase()} · al ${formatFechaLarga(periodo.fechaFin)} · ${monedaFuncional()}`
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
        <SelectorComparar
          periodos={periodos}
          actual={periodo}
          comparado={comparado}
          onChange={filtros.setComparado}
        />
        {estado && (
          <span className="ml-auto">
            <AvisoCuadre
              cuadra={estado.cuadra}
              correcto="Activo igual a pasivo más patrimonio"
              incorrecto={
                <>
                  <strong>El estado no cuadra</strong> por {estado.diferencia}.
                  Revise los saldos en cuentas de orden: todo lo demás cuadra
                  por construcción.
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
              titulo="Estado de Situación Financiera"
              lineas={[
                `Al ${formatFechaLarga(periodo.fechaFin)}`,
                `Contabilidad ${etiquetaLibro(libro).toLowerCase()} · Cifras en ${monedaFuncional()}`,
              ]}
            />
            <TablaEstado
              comparando={comparando}
              etiquetaActual={etiquetaActual}
              etiquetaComparado={etiquetaComparado}
            >
              <FilasLado titulo="Activo" lado={estado.activo} comparando={comparando} enlace={enlace} />
              <FilaTotal
                etiqueta="Total activo"
                importe={estado.activo.total}
                comparado={estado.activo.comparado}
                comparando={comparando}
                enfasis="final"
              />
              <FilasLado titulo="Pasivo" lado={estado.pasivo} comparando={comparando} enlace={enlace} />
              <FilaTotal
                etiqueta="Total pasivo"
                importe={estado.pasivo.total}
                comparado={estado.pasivo.comparado}
                comparando={comparando}
                enfasis="total"
              />
              <FilasLado titulo="Patrimonio" lado={estado.patrimonio} comparando={comparando} enlace={enlace} />
              <FilaTotal
                etiqueta="Total pasivo y patrimonio"
                importe={estado.totalPasivoPatrimonio}
                comparado={estado.totalPasivoPatrimonioComparado}
                comparando={comparando}
                enfasis="final"
              />
            </TablaEstado>
          </>
        )}
      </Card>
    </div>
  )
}

function tituloGrupo(grupo: LadoSituacion['grupos'][number]['grupo']): string {
  return grupo ? ETIQUETA_GRUPO[grupo] : 'Sin clasificar'
}

function FilasLado({
  titulo,
  lado,
  comparando,
  enlace,
}: {
  titulo: string
  lado: LadoSituacion
  comparando: boolean
  enlace: (codigo: string) => string
}) {
  return (
    <>
      <FilaTitulo titulo={titulo} comparando={comparando} />
      {lado.grupos.map((grupo) => (
        <FilasGrupo
          key={grupo.grupo ?? 'sin-clasificar'}
          titulo={
            // El patrimonio es un solo grupo: repetir "Patrimonio" como
            // subtítulo debajo del título "Patrimonio" no dice nada.
            grupo.grupo === 'patrimonio' ? 'Patrimonio atribuible a los propietarios' : tituloGrupo(grupo.grupo)
          }
          grupo={grupo}
          comparando={comparando}
          enlaceCuenta={enlace}
          etiquetaTotal={grupo.grupo === 'patrimonio' ? 'Total patrimonio' : undefined}
        />
      ))}
    </>
  )
}

function filasLado(titulo: string, lado: LadoSituacion, comparando: boolean) {
  return [
    [titulo],
    ...lado.grupos.flatMap((g) => filasGrupo(tituloGrupo(g.grupo), g, comparando)),
  ]
}
