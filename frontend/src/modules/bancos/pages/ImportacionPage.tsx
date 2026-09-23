import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { CircleAlert, CircleCheck, FileUp, TriangleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader, PageHeader } from '@/shared/ui/Layout'
import { Field, Select } from '@/shared/ui/Field'
import { MoneyCell } from '@/shared/money/MoneyCell'
import { formatFecha } from '@/shared/format/fecha'
import { ApiError } from '@/shared/api/client'
import type { ResultadoImportacion } from '@/shared/api/contracts/bancos'
import {
  useCuentasBancarias,
  useFormatosImportacion,
  useImportarEstadoCuenta,
} from '../api/queries'

/**
 * Importación del estado de cuenta (docs/06 §2.2).
 *
 * Lo que esta pantalla no hace es tan importante como lo que hace: **no
 * contabiliza nada**. Lo que entra aquí es la versión del banco, y ninguna
 * línea suya llega al mayor por el hecho de haberse importado. Lo que el banco
 * movió y la empresa no registró se resuelve capturando el movimiento propio
 * que falta, que sí emite su asiento, y hasta entonces aparece como una
 * partida conciliatoria que exige acción.
 *
 * El contenido se pega o se sube. Las dos formas acaban en el mismo sitio: un
 * texto que el lector del banco convierte en filas.
 */
export function ImportacionPage() {
  const navegar = useNavigate()
  const { data: cuentas = [] } = useCuentasBancarias(true)
  const { data: formatos = [] } = useFormatosImportacion()
  const importar = useImportarEstadoCuenta()
  const entradaArchivo = useRef<HTMLInputElement>(null)

  const [cuentaId, setCuentaId] = useState('')
  const [formato, setFormato] = useState('csv_generico')
  const [contenido, setContenido] = useState('')
  const [archivo, setArchivo] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null)

  const cuenta = cuentas.find((c) => c.id === cuentaId)
  const ejemplo = formatos.find((f) => f.id === formato)?.ejemplo ?? null
  const errorServidor =
    importar.error instanceof ApiError ? importar.error : null

  const lineas = contenido.trim() === '' ? 0 : contenido.trim().split(/\r?\n/).length

  const [errorLectura, setErrorLectura] = useState<string | null>(null)

  /**
   * Cualquier cambio del contenido invalida lo anterior: el resultado de otra
   * importación y el error del servidor sobre otro texto ya no describen lo
   * que hay en pantalla.
   */
  const reemplazarContenido = (texto: string, nombre: string | null) => {
    setContenido(texto)
    setArchivo(nombre)
    setResultado(null)
    setErrorLectura(null)
    importar.reset()
  }

  const leerArchivo = async (fichero: File) => {
    try {
      reemplazarContenido(decodificar(await fichero.arrayBuffer()), fichero.name)
    } catch {
      setErrorLectura(`No se pudo leer ${fichero.name}.`)
    }
  }

  const enviar = () => {
    if (!cuentaId || contenido.trim() === '') return
    importar.mutate(
      { cuentaBancariaId: cuentaId, formato, contenido, archivo },
      { onSuccess: setResultado },
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        titulo="Importar estado de cuenta"
        descripcion="Lo que dice el banco. No se contabiliza nada al importarlo: entra en su propia tabla para poder conciliarlo."
      />

      <Card className="mb-4">
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          <Field label="Cuenta bancaria" requerido>
            {(p) => (
              <Select
                {...p}
                value={cuentaId}
                onChange={(e) => {
                  setCuentaId(e.target.value)
                  setResultado(null)
                  importar.reset()
                }}
              >
                <option value="">Seleccione…</option>
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} · {c.nombre} ({c.moneda})
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Formato del archivo"
            requerido
            ayuda={formatos.find((f) => f.id === formato)?.descripcion}
          >
            {(p) => (
              <Select
                {...p}
                value={formato}
                onChange={(e) => setFormato(e.target.value)}
              >
                {formatos.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="border-t border-slate-200 px-4 py-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              ref={entradaArchivo}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const fichero = e.target.files?.[0]
                // Se vacía el campo para que elegir otra vez el MISMO archivo
                // (corregido fuera, por ejemplo) vuelva a disparar el cambio.
                e.target.value = ''
                if (fichero) void leerArchivo(fichero)
              }}
            />
            <Button
              tamano="sm"
              icono={<FileUp className="size-3.5" />}
              onClick={() => entradaArchivo.current?.click()}
            >
              Elegir archivo
            </Button>
            {ejemplo && (
              <Button
                tamano="sm"
                variante="fantasma"
                onClick={() => reemplazarContenido(ejemplo, null)}
              >
                Usar el ejemplo de demostración
              </Button>
            )}
            <span className="text-xs text-slate-500">
              {archivo
                ? `${archivo} · ${lineas} líneas`
                : lineas > 0
                  ? `${lineas} líneas pegadas`
                  : 'O pegue el contenido abajo'}
            </span>
          </div>

          <textarea
            value={contenido}
            onChange={(e) => reemplazarContenido(e.target.value, null)}
            rows={10}
            spellCheck={false}
            aria-label="Contenido del estado de cuenta"
            placeholder="Fecha;Descripcion;Referencia;Debito;Credito;Saldo"
            className="w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
          />
        </div>
      </Card>

      {errorLectura && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200 ring-inset"
        >
          {errorLectura}
        </p>
      )}

      {errorServidor && (
        <div className="mb-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor.codigo}: {errorServidor.message}
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {errorServidor.detalles.map((mensaje, i) => (
              <li key={i}>{mensaje}</li>
            ))}
          </ul>
        </div>
      )}

      {resultado && (
        <Card className="mb-4">
          <CardHeader
            titulo="Resultado de la importación"
            descripcion={
              resultado.desde
                ? `Del ${formatFecha(resultado.desde)} al ${formatFecha(resultado.hasta)}`
                : 'No se importó ninguna línea nueva'
            }
          />
          <div className="grid gap-px bg-slate-200 sm:grid-cols-4">
            <Cifra titulo="Leídas" valor={resultado.leidas} />
            <Cifra titulo="Importadas" valor={resultado.importadas} exito />
            <Cifra
              titulo="Ya conocidas"
              valor={resultado.duplicadas}
              ayuda="Los duplicados se cuentan, no se ocultan: traslapar fechas entre cargas es normal"
            />
            <Cifra
              titulo="Rechazadas"
              valor={resultado.rechazadas.length}
              alerta={resultado.rechazadas.length > 0}
            />
          </div>

          {resultado.saldoFinal !== null && (
            <p className="border-t border-slate-200 px-4 py-2.5 text-sm text-slate-700">
              Saldo del banco al {formatFecha(resultado.hasta)}:{' '}
              <MoneyCell
                valor={resultado.saldoFinal}
                moneda={cuenta?.moneda ?? 'CRC'}
                mostrarSimbolo
              />
            </p>
          )}

          {resultado.rechazadas.length > 0 && (
            <div className="border-t border-slate-200 px-4 py-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-amber-800">
                <TriangleAlert className="size-4" />
                Estas líneas no se pudieron leer
              </p>
              <ul className="space-y-1 text-xs text-slate-600">
                {resultado.rechazadas.map((r) => (
                  <li key={r.linea}>
                    <span className="font-mono text-slate-400">
                      Línea {r.linea}
                    </span>{' '}
                    {r.motivo}
                    <p className="truncate font-mono text-[11px] text-slate-400">
                      {r.contenido}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {resultado.importadas > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-emerald-50/60 px-4 py-3">
              <p className="flex items-center gap-1.5 text-sm text-emerald-800">
                <CircleCheck className="size-4" />
                El estado de cuenta ya se puede conciliar.
              </p>
              <Button
                variante="primario"
                tamano="sm"
                onClick={() =>
                  navegar(`/bancos/conciliacion?cuenta=${resultado.cuentaBancariaId}`)
                }
              >
                Ir a la conciliación
              </Button>
            </div>
          )}
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button onClick={() => navegar('/bancos')}>Volver</Button>
        <Button
          variante="primario"
          onClick={enviar}
          disabled={!cuentaId || contenido.trim() === '' || importar.isPending}
        >
          {importar.isPending ? 'Importando…' : 'Importar'}
        </Button>
      </div>
    </div>
  )
}

/**
 * Texto del archivo en la codificación en la que venga.
 *
 * Muchos bancos siguen exportando en Latin-1 (Windows-1252): leído como
 * UTF-8, cada tilde y cada eñe se convierte en el carácter de reemplazo y las
 * descripciones dejan de coincidir con lo registrado. Si UTF-8 produce alguno,
 * se lee otra vez como Windows-1252, que es superconjunto de Latin-1.
 */
function decodificar(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (!utf8.includes('\uFFFD')) return utf8
  return new TextDecoder('windows-1252').decode(bytes)
}

function Cifra({
  titulo,
  valor,
  ayuda,
  exito,
  alerta,
}: {
  titulo: string
  valor: number
  ayuda?: string
  exito?: boolean
  alerta?: boolean
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p
        className={
          alerta
            ? 'text-lg font-semibold text-amber-700'
            : exito
              ? 'text-lg font-semibold text-emerald-700'
              : 'text-lg font-semibold text-slate-900'
        }
      >
        {valor}
      </p>
      {ayuda && <p className="text-[11px] text-slate-400">{ayuda}</p>}
    </div>
  )
}
