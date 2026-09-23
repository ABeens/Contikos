import { useMemo, useState } from 'react'
import { CircleAlert, CornerDownRight, Lock } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialogo } from '@/shared/ui/Dialogo'
import { Field, Input, Select } from '@/shared/ui/Field'
import { ApiError } from '@/shared/api/client'
import { monedasActivas } from '@/shared/money/money'
import type { AuxiliarTipo, Modulo } from '@/shared/api/contracts/comunes'
import type {
  ClasificacionNiif,
  Cuenta,
  Naturaleza,
  NotaEeff,
  SolicitudCuenta,
  TipoCuenta,
} from '@/shared/api/contracts/conta'
import { useGuardarCuenta } from '../api/queries'
import {
  ETIQUETA_ESTADO_FINANCIERO,
  ETIQUETA_TIPO_CUENTA,
  NATURALEZA_HABITUAL,
  notasAsignables,
  ordenarClasificaciones,
  referenciaNota,
} from '../domain/clasificacion'
import { codigoPadreDe, validarCuenta } from '../domain/cuenta'

/**
 * Alta y edición de una cuenta del catálogo (docs/03 §2).
 *
 * El código no es un identificador cualquiera: es la jerarquía. Por eso la
 * pantalla resuelve la madre mientras se escribe y enseña de quién colgará la
 * cuenta antes de guardarla: el error de teclear `1.2.02.004` cuando se quería
 * `1.2.01.004` no se ve leyendo el número, se ve leyendo el nombre de la madre.
 *
 * La presentación se captura aquí y no en una pantalla aparte porque es
 * obligatoria: una cuenta de detalle sin renglón y sin nota registra saldos que
 * no llegan a ningún estado financiero (docs/03 §2 bis). Reclasificarla después
 * sigue teniendo su propio diálogo.
 */

const AUXILIARES: readonly AuxiliarTipo[] = [
  'cliente',
  'proveedor',
  'empleado',
  'activo',
  'banco',
]

const MODULOS: readonly Modulo[] = ['cxc', 'cxp', 'bancos', 'activos', 'rh']

const TIPOS: readonly TipoCuenta[] = [
  'activo',
  'pasivo',
  'capital',
  'ingreso',
  'costo',
  'gasto',
  'orden',
]

const SIN_ASIGNAR = ''

const NUEVA: SolicitudCuenta = {
  codigo: '',
  nombre: '',
  tipo: 'activo',
  naturaleza: 'deudora',
  esDetalle: true,
  requiereAuxiliar: null,
  moduloDueno: null,
  moneda: null,
  clasificacionNiifId: null,
  notaEeffId: null,
  activa: true,
}

export interface DialogoCuentaProps {
  abierto: boolean
  onCerrar: () => void
  /** Sin cuenta, el diálogo da de alta una nueva. */
  cuenta?: Cuenta
  cuentas: readonly Cuenta[]
  /** Catálogos de presentación: la cuenta de detalle elige de ellos. */
  clasificaciones: readonly ClasificacionNiif[]
  notas: readonly NotaEeff[]
  /** Códigos que ya aparecen en algún asiento. */
  conMovimientos: ReadonlySet<string>
  /** Código sugerido al abrir, cuando se crea desde una cuenta madre. */
  codigoSugerido?: string
}

export function DialogoCuenta({
  abierto,
  onCerrar,
  cuenta,
  cuentas,
  clasificaciones,
  notas,
  conMovimientos,
  codigoSugerido,
}: DialogoCuentaProps) {
  const creando = cuenta === undefined
  const guardar = useGuardarCuenta()

  const [datos, setDatos] = useState<SolicitudCuenta>(() =>
    cuenta
      ? {
          codigo: cuenta.codigo,
          nombre: cuenta.nombre,
          tipo: cuenta.tipo,
          naturaleza: cuenta.naturaleza,
          esDetalle: cuenta.esDetalle,
          requiereAuxiliar: cuenta.requiereAuxiliar,
          moduloDueno: cuenta.moduloDueno,
          moneda: cuenta.moneda,
          clasificacionNiifId: cuenta.clasificacionNiifId,
          notaEeffId: cuenta.notaEeffId,
          activa: cuenta.activa,
        }
      : { ...NUEVA, codigo: codigoSugerido ?? '' },
  )
  const [intento, setIntento] = useState(false)

  /**
   * Cambiar el tipo tira la presentación elegida.
   *
   * Un renglón admite unos tipos de cuenta y no otros: la clasificación que
   * valía para un gasto no vale para un activo, y dejarla puesta solo serviría
   * para que el error saltara al guardar.
   */
  const cambiar = (cambios: Partial<SolicitudCuenta>) => {
    // El error del servidor era sobre los datos de antes de este cambio.
    if (guardar.isError) guardar.reset()
    setDatos((prev) => ({
      ...prev,
      ...(cambios.tipo !== undefined && cambios.tipo !== prev.tipo
        ? { clasificacionNiifId: null, notaEeffId: null }
        : {}),
      ...cambios,
    }))
  }

  const madre = (() => {
    const codigoPadre = codigoPadreDe(datos.codigo)
    return codigoPadre ? cuentas.find((c) => c.codigo === codigoPadre) : undefined
  })()

  /**
   * Escribir el código elige el tipo, porque la madre lo impone.
   *
   * Y de paso la naturaleza habitual de ese tipo, que es la que acierta en casi
   * todas las cuentas. La excepción (una depreciación acumulada dentro del
   * activo) se corrige a mano, que es justo cuando merece una decisión.
   */
  const escribirCodigo = (codigo: string) => {
    const codigoPadre = codigoPadreDe(codigo)
    const nuevaMadre = codigoPadre
      ? cuentas.find((c) => c.codigo === codigoPadre)
      : undefined

    cambiar(
      nuevaMadre && creando
        ? {
            codigo,
            tipo: nuevaMadre.tipo,
            naturaleza: NATURALEZA_HABITUAL[nuevaMadre.tipo],
          }
        : { codigo },
    )
  }

  // Lo asentado en el mayor no se reescribe cambiando la cuenta debajo.
  const definicionFija = Boolean(cuenta && conMovimientos.has(cuenta.codigo))

  const validacion = validarCuenta(datos, {
    cuentas,
    conMovimientos,
    clasificaciones,
    notas,
    cuenta,
  })
  const errorServidor = guardar.error instanceof ApiError ? guardar.error : null
  const errorDe = (campo: string) =>
    intento
      ? validacion.errores.find((e) => e.campo === campo)?.mensaje
      : undefined

  /**
   * Renglones que esta cuenta puede tomar.
   *
   * Se filtra por tipo, por activa y por tener alguna nota que asignarle: como
   * la nota es obligatoria, un renglón sin notas es un callejón sin salida y
   * ofrecerlo solo lleva al usuario a un error que no puede resolver desde aquí.
   * El que ya tiene asignado se ofrece siempre, para no perderlo al editar.
   */
  const renglonesDisponibles = useMemo(
    () =>
      ordenarClasificaciones(
        clasificaciones.filter(
          (c) =>
            c.id === cuenta?.clasificacionNiifId ||
            (c.activa &&
              c.tiposCuenta.includes(datos.tipo) &&
              notasAsignables(c.id, notas).length > 0),
        ),
      ),
    [clasificaciones, notas, datos.tipo, cuenta],
  )

  const notasDisponibles = useMemo(
    () =>
      datos.clasificacionNiifId === null
        ? []
        : notasAsignables(datos.clasificacionNiifId, notas).concat(
            notas.filter(
              (n) =>
                n.id === cuenta?.notaEeffId &&
                !n.activa &&
                n.clasificacionNiifId === datos.clasificacionNiifId,
            ),
          ),
    [datos.clasificacionNiifId, notas, cuenta],
  )

  const renglonElegido = renglonesDisponibles.find(
    (c) => c.id === datos.clasificacionNiifId,
  )

  const enviar = () => {
    setIntento(true)
    if (!validacion.valido || guardar.isPending) return
    guardar.mutate({ datos, id: cuenta?.id }, { onSuccess: onCerrar })
  }

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={guardar.isPending}
      alEnviar={enviar}
      titulo={creando ? 'Nueva cuenta' : `${cuenta.codigo} ${cuenta.nombre}`}
      descripcion="El código es la jerarquía: de él salen la cuenta madre, el nivel y el tipo."
      className="w-[min(94vw,44rem)]"
      acciones={
        <>
          <Button onClick={onCerrar} disabled={guardar.isPending}>
            Cancelar
          </Button>
          <Button
            variante="primario"
            type="submit"
            disabled={guardar.isPending}
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Código" requerido error={errorDe('codigo')}>
          {(p) => (
            <Input
              {...p}
              value={datos.codigo}
              disabled={!creando}
              autoFocus={creando}
              placeholder="1.2.01.004"
              className="font-mono"
              onChange={(e) => escribirCodigo(e.target.value.trim())}
            />
          )}
        </Field>

        <Field label="Nombre" requerido className="sm:col-span-2" error={errorDe('nombre')}>
          {(p) => (
            <Input
              {...p}
              value={datos.nombre}
              autoFocus={!creando}
              placeholder="Maquinaria y equipo de planta"
              onChange={(e) => cambiar({ nombre: e.target.value })}
            />
          )}
        </Field>
      </div>

      {/* De quién colgará: el código solo se lee bien junto al nombre de su
          madre, y es donde se ve el dedazo de un dígito. */}
      <p className="mt-2 flex items-center gap-1.5 text-xs">
        <CornerDownRight className="size-3.5 shrink-0 text-slate-400" />
        {madre ? (
          <span className="text-slate-600">
            Colgará de{' '}
            <span className="font-mono text-slate-500">{madre.codigo}</span>{' '}
            {madre.nombre}
            <span className="ml-1 text-slate-400">
              · {ETIQUETA_TIPO_CUENTA[madre.tipo]}
            </span>
          </span>
        ) : codigoPadreDe(datos.codigo) ? (
          <span className="text-red-600">
            No existe la cuenta {codigoPadreDe(datos.codigo)}, de la que
            colgaría. Créela primero
          </span>
        ) : (
          <span className="text-slate-400">
            Sin punto en el código es una cuenta de primer nivel, sin madre
          </span>
        )}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          label="Tipo"
          requerido
          ayuda={madre ? 'Lo hereda de su madre' : 'Encabeza su propio grupo'}
          error={errorDe('tipo')}
        >
          {(p) => (
            <Select
              {...p}
              value={datos.tipo}
              disabled={Boolean(madre) || definicionFija}
              onChange={(e) =>
                cambiar({
                  tipo: e.target.value as TipoCuenta,
                  naturaleza: NATURALEZA_HABITUAL[e.target.value as TipoCuenta],
                })
              }
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {ETIQUETA_TIPO_CUENTA[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Naturaleza"
          requerido
          ayuda={
            datos.naturaleza === NATURALEZA_HABITUAL[datos.tipo]
              ? 'La habitual de su tipo'
              : 'Contraria a su tipo, como una depreciación acumulada'
          }
          error={errorDe('naturaleza')}
        >
          {(p) => (
            <Select
              {...p}
              value={datos.naturaleza}
              disabled={definicionFija}
              onChange={(e) =>
                cambiar({ naturaleza: e.target.value as Naturaleza })
              }
            >
              <option value="deudora">Deudora</option>
              <option value="acreedora">Acreedora</option>
            </Select>
          )}
        </Field>

        <Field
          label="Recibe movimientos"
          ayuda="Las acumulativas solo suman lo que cuelga de ellas"
          error={errorDe('esDetalle')}
        >
          {(p) => (
            <Select
              {...p}
              value={datos.esDetalle ? 'detalle' : 'acumulativa'}
              disabled={definicionFija}
              onChange={(e) => {
                const esDetalle = e.target.value === 'detalle'
                cambiar(
                  esDetalle
                    ? { esDetalle }
                    : {
                        esDetalle,
                        requiereAuxiliar: null,
                        moduloDueno: null,
                        moneda: null,
                        // La acumulativa presenta lo que suman sus hijas.
                        clasificacionNiifId: null,
                        notaEeffId: null,
                      },
                )
              }}
            >
              <option value="detalle">Sí, cuenta de detalle</option>
              <option value="acumulativa">No, acumulativa</option>
            </Select>
          )}
        </Field>
      </div>

      {definicionFija && cuenta && (
        <p className="mt-4 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800 ring-1 ring-amber-200 ring-inset">
          <Lock className="mt-px size-3.5 shrink-0" />
          {cuenta.codigo} ya tiene movimientos en el mayor. Su definición queda
          fija: invertir la naturaleza le cambiaría el signo al saldo que ya está
          en la balanza. Se puede renombrar y desactivar.
        </p>
      )}

      <div className="mt-4 border-t border-slate-200 pt-4">
        <p className="text-xs font-semibold text-slate-700">
          Presentación en los estados financieros
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Dónde suma la cuenta y en qué nota se explica. Las dos son
          obligatorias: lo que no tiene renglón se registra en el mayor y no
          aparece en ningún estado financiero.
        </p>

        {!datos.esDetalle ? (
          <p className="mt-3 rounded-md bg-slate-50 px-2.5 py-2 text-xs text-slate-600 ring-1 ring-slate-200 ring-inset">
            Una cuenta acumulativa presenta lo que suman sus hijas: no lleva
            renglón propio. Se clasifican las cuentas de detalle que cuelgan de
            ella.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Clasificación NIIF"
              requerido
              error={errorDe('clasificacionNiifId')}
              ayuda={
                renglonElegido
                  ? ETIQUETA_ESTADO_FINANCIERO[renglonElegido.estadoFinanciero]
                  : 'Solo los renglones que admiten cuentas de este tipo'
              }
            >
              {(p) => (
                <Select
                  {...p}
                  value={datos.clasificacionNiifId ?? SIN_ASIGNAR}
                  onChange={(e) =>
                    // Cambiar de renglón invalida la nota: era del anterior.
                    cambiar({
                      clasificacionNiifId: e.target.value || null,
                      notaEeffId: null,
                    })
                  }
                >
                  <option value={SIN_ASIGNAR}>Elija el renglón…</option>
                  {renglonesDisponibles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} · {c.nombre}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Nota a los estados financieros"
              requerido
              error={errorDe('notaEeffId')}
              ayuda={
                datos.clasificacionNiifId === null
                  ? 'Primero elija el renglón: la nota cuelga de él'
                  : 'El desglose en el que se explica esta cuenta'
              }
            >
              {(p) => (
                <Select
                  {...p}
                  value={datos.notaEeffId ?? SIN_ASIGNAR}
                  disabled={datos.clasificacionNiifId === null}
                  onChange={(e) =>
                    cambiar({ notaEeffId: e.target.value || null })
                  }
                >
                  <option value={SIN_ASIGNAR}>Elija la nota…</option>
                  {notasDisponibles.map((n) => (
                    <option key={n.id} value={n.id}>
                      Nota {referenciaNota(n)} · {n.titulo}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
      </div>

      {datos.esDetalle && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="text-xs font-semibold text-slate-700">
            Cómo se mueve la cuenta
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Una cuenta de control solo la mueve su módulo dueño: nadie captura un
            asiento manual contra Clientes, porque el auxiliar de CxC dejaría de
            cuadrar contra el mayor.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Módulo dueño" ayuda="Vacío: la mueve cualquiera">
              {(p) => (
                <Select
                  {...p}
                  value={datos.moduloDueno ?? ''}
                  disabled={definicionFija}
                  onChange={(e) =>
                    cambiar({ moduloDueno: (e.target.value || null) as Modulo | null })
                  }
                >
                  <option value="">Ninguno</option>
                  {MODULOS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Auxiliar que exige"
              ayuda="Cada línea tendrá que decir a quién"
            >
              {(p) => (
                <Select
                  {...p}
                  value={datos.requiereAuxiliar ?? ''}
                  disabled={definicionFija}
                  onChange={(e) =>
                    cambiar({
                      requiereAuxiliar: (e.target.value || null) as AuxiliarTipo | null,
                    })
                  }
                >
                  <option value="">Ninguno</option>
                  {AUXILIARES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Moneda" ayuda="Vacío: la funcional de la empresa">
              {(p) => (
                <Select
                  {...p}
                  value={datos.moneda ?? ''}
                  disabled={definicionFija}
                  onChange={(e) => cambiar({ moneda: e.target.value || null })}
                >
                  <option value="">Sin fijar</option>
                  {monedasActivas().map((m) => (
                    <option key={m.codigo} value={m.codigo}>
                      {m.codigo}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>
      )}

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={datos.activa}
          onChange={(e) => cambiar({ activa: e.target.checked })}
          className="size-3.5 rounded border-slate-300 accent-brand-600"
        />
        Cuenta activa
        <span className="text-xs text-slate-400">
          Inactiva deja de admitir asientos nuevos; su historial no se toca
        </span>
      </label>

      {(intento && !validacion.valido) || errorServidor ? (
        <div
          role="alert"
          className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200 ring-inset"
        >
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <CircleAlert className="size-4" />
            {errorServidor ? errorServidor.message : 'Revise los datos'}
          </p>
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs text-red-700">
            {(errorServidor?.detalles.length
              ? errorServidor.detalles
              : validacion.errores.map((e) => e.mensaje)
            ).map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialogo>
  )
}
