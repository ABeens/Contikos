import { describe, expect, it } from 'vitest'
import type { MovimientoEstadoCuenta } from '@/shared/api/contracts/bancos'
import {
  PARSER_CSV_GENERICO,
  detectarSeparador,
  huellaDe,
  mapearColumnas,
  normalizarFecha,
  normalizarImporte,
  partirLinea,
  saldoFinalDe,
  separarDuplicados,
} from './importacion'

/**
 * Lo que se prueba aquí es que un archivo del banco entre entero y una sola
 * vez. Un parser flojo no da error: importa cuarenta movimientos con la fecha
 * en el campo del importe, y eso se descubre semanas después, al conciliar.
 */

const CABECERA = 'Fecha;Fecha valor;Descripcion;Referencia;Debito;Credito;Saldo'

function csv(...lineas: string[]): string {
  return [CABECERA, ...lineas].join('\n')
}

describe('Normalización de fechas', () => {
  it('acepta la ISO y la local de Costa Rica', () => {
    expect(normalizarFecha('2026-08-05')).toBe('2026-08-05')
    expect(normalizarFecha('5/8/2026')).toBe('2026-08-05')
    expect(normalizarFecha('05/08/2026')).toBe('2026-08-05')
  })

  it('rechaza lo que no reconoce en vez de adivinar', () => {
    // Adivinar aquí produce movimientos con fecha equivocada que nadie detecta.
    expect(normalizarFecha('agosto 5')).toBeNull()
    expect(normalizarFecha('2026/13/05')).toBeNull()
    expect(normalizarFecha('')).toBeNull()
  })
})

describe('Normalización de importes', () => {
  it('lee las dos convenciones decimales por el último separador', () => {
    expect(normalizarImporte('1.234,56')).toBe('1234.56')
    expect(normalizarImporte('1,234.56')).toBe('1234.56')
    expect(normalizarImporte('3.390.000,00')).toBe('3390000.00')
  })

  it('descarta el símbolo y trata el vacío como cero', () => {
    expect(normalizarImporte('₡ 14.125,00')).toBe('14125.00')
    expect(normalizarImporte('')).toBe('0.00')
    expect(normalizarImporte('   ')).toBe('0.00')
  })

  it('conserva el signo, que es lo que decide la columna', () => {
    expect(normalizarImporte('-508500.00')).toBe('-508500.00')
  })
})

describe('Estructura del archivo', () => {
  it('detecta el separador por mayoría en la cabecera', () => {
    expect(detectarSeparador('a;b;c;d')).toBe(';')
    expect(detectarSeparador('a,b,c,d')).toBe(',')
  })

  it('respeta las comillas al partir una línea', () => {
    expect(
      partirLinea('05/08/2026;"COMISION; MANEJO";14125,00', ';'),
    ).toEqual(['05/08/2026', 'COMISION; MANEJO', '14125,00'])
  })

  it('reconoce los nombres de columna habituales sin tildes', () => {
    const columnas = mapearColumnas([
      'Fecha de operación',
      'Descripción',
      'Débito',
      'Crédito',
    ])
    expect(columnas.fechaOperacion).toBe(0)
    expect(columnas.descripcion).toBe(1)
    expect(columnas.cargo).toBe(2)
    expect(columnas.abono).toBe(3)
  })

  it('no deja que la fecha de valor le robe la columna a la de operación', () => {
    const columnas = mapearColumnas(['Fecha', 'Fecha valor', 'Concepto'])
    expect(columnas.fechaOperacion).toBe(0)
    expect(columnas.fechaValor).toBe(1)
  })
})

describe('Lector de CSV genérico', () => {
  it('lee un archivo con débito y crédito en columnas separadas', () => {
    const { filas, rechazadas } = PARSER_CSV_GENERICO.parsear(
      csv(
        '15/07/2026;15/07/2026;TRANSFERENCIA RECIBIDA;TRF-4471209;;3.390.000,00;3.390.000,00',
        '05/08/2026;05/08/2026;COMISION MANEJO;;14.125,00;;3.375.875,00',
      ),
    )

    expect(rechazadas).toHaveLength(0)
    expect(filas).toHaveLength(2)
    expect(filas[0]).toMatchObject({
      fechaOperacion: '2026-07-15',
      referencia: 'TRF-4471209',
      cargo: '0.00',
      abono: '3390000.00',
      saldo: '3390000.00',
    })
    expect(filas[1].cargo).toBe('14125.00')
  })

  it('lee una sola columna de importe con signo', () => {
    // Es lo que exporta media banca en línea, y el signo decide la columna.
    const { filas } = PARSER_CSV_GENERICO.parsear(
      ['Fecha;Concepto;Importe', '05/08/2026;COMISION;-14125,00'].join('\n'),
    )
    expect(filas[0].cargo).toBe('14125.00')
    expect(filas[0].abono).toBe('0.00')
  })

  it('rechaza la línea ilegible y sigue con el resto', () => {
    // Un archivo con una línea mala no se pierde entero: se importa lo que se
    // puede y se dice exactamente qué línea no se pudo.
    const { filas, rechazadas } = PARSER_CSV_GENERICO.parsear(
      csv(
        'ayer;;ALGO;;100,00;;',
        '05/08/2026;05/08/2026;COMISION;;14.125,00;;100,00',
      ),
    )
    expect(filas).toHaveLength(1)
    expect(rechazadas).toHaveLength(1)
    expect(rechazadas[0].linea).toBe(2)
    expect(rechazadas[0].motivo).toMatch(/Fecha ilegible/)
  })

  it('descarta las líneas sin importe, que son pies y separadores', () => {
    const { filas, rechazadas } = PARSER_CSV_GENERICO.parsear(
      csv('05/08/2026;;SALDO FINAL DEL PERIODO;;;;100,00'),
    )
    expect(filas).toHaveLength(0)
    expect(rechazadas[0].motivo).toMatch(/no tiene importe/)
  })

  it('rechaza el archivo entero cuando no reconoce la cabecera', () => {
    // Sin cabecera no se puede saber qué columna es cuál, y adivinar el orden
    // es peor que no importar nada.
    const resultado = PARSER_CSV_GENERICO.parsear(
      'una;cosa;cualquiera\n1;2;3',
    )
    expect(resultado.filas).toHaveLength(0)
    expect(resultado.rechazadas[0].motivo).toMatch(/cabecera/)
  })

  it('reconoce su formato por la cabecera', () => {
    expect(PARSER_CSV_GENERICO.reconoce(csv())).toBe(true)
    expect(PARSER_CSV_GENERICO.reconoce('hola mundo')).toBe(false)
  })

  it('usa la fecha de operación cuando no hay fecha de valor', () => {
    const { filas } = PARSER_CSV_GENERICO.parsear(
      ['Fecha;Concepto;Debito;Credito', '05/08/2026;COMISION;14125,00;'].join(
        '\n',
      ),
    )
    expect(filas[0].fechaValor).toBe('2026-08-05')
  })
})

describe('Detección de duplicados', () => {
  const fila = (cambios: Record<string, unknown> = {}) => ({
    linea: 2,
    fechaOperacion: '2026-08-05',
    fechaValor: '2026-08-05',
    descripcion: 'COMISION MANEJO',
    referencia: 'REF-1',
    cargo: '14125.00',
    abono: '0.00',
    saldo: null,
    ...cambios,
  })

  const yaImportado = (huella: string): MovimientoEstadoCuenta => ({
    id: 'ecu-000001',
    cuentaBancariaId: 'bco-001',
    fechaOperacion: '2026-08-05',
    fechaValor: '2026-08-05',
    descripcion: 'COMISION MANEJO',
    referencia: 'REF-1',
    cargo: '14125.00',
    abono: '0.00',
    saldo: null,
    origenCarga: 'archivo',
    conciliacionId: null,
    huella,
    importadoEn: '2026-08-06T09:00:00Z',
  })

  it('reconoce lo ya importado por su huella', () => {
    // Recargar el mismo archivo o traslapar fechas es normal: lo que no puede
    // pasar es que produzca movimientos repetidos.
    const huella = huellaDe('bco-001', fila())
    const { nuevas, duplicadas } = separarDuplicados(
      'bco-001',
      [fila()],
      [yaImportado(huella)],
    )
    expect(nuevas).toHaveLength(0)
    expect(duplicadas).toHaveLength(1)
  })

  it('detecta también los duplicados dentro del propio archivo', () => {
    const { nuevas, duplicadas } = separarDuplicados(
      'bco-001',
      [fila(), fila({ linea: 3 })],
      [],
    )
    expect(nuevas).toHaveLength(1)
    expect(duplicadas).toHaveLength(1)
  })

  it('no confunde el mismo importe en cuentas distintas', () => {
    const huella = huellaDe('bco-002', fila())
    const { nuevas } = separarDuplicados(
      'bco-001',
      [fila()],
      [{ ...yaImportado(huella), cuentaBancariaId: 'bco-002' }],
    )
    expect(nuevas).toHaveLength(1)
  })

  it('ignora la descripción cuando hay referencia', () => {
    // El mismo movimiento puede venir descrito distinto en dos exportaciones
    // del mismo banco; la referencia no cambia.
    expect(huellaDe('bco-001', fila())).toBe(
      huellaDe('bco-001', fila({ descripcion: 'COMISION POR MANEJO CUENTA' })),
    )
  })

  it('cae en la descripción cuando no hay referencia', () => {
    // Sin ella, dos comisiones iguales del mismo día serían indistinguibles y
    // se perdería la segunda.
    const sinRef = fila({ referencia: null })
    expect(huellaDe('bco-001', sinRef)).not.toBe(
      huellaDe('bco-001', { ...sinRef, descripcion: 'OTRA COSA' }),
    )
  })
})

describe('Saldo del archivo', () => {
  it('toma el de la última línea que lo traiga', () => {
    const filas = PARSER_CSV_GENERICO.parsear(
      csv(
        '15/07/2026;;UNO;;;1.000,00;1.000,00',
        '05/08/2026;;DOS;;500,00;;500,00',
      ),
    ).filas
    expect(saldoFinalDe(filas)).toBe('500.00')
  })

  it('devuelve nulo cuando el formato no lleva saldo', () => {
    const filas = PARSER_CSV_GENERICO.parsear(
      ['Fecha;Concepto;Debito;Credito', '05/08/2026;COMISION;14125,00;'].join(
        '\n',
      ),
    ).filas
    expect(saldoFinalDe(filas)).toBeNull()
  })
})
