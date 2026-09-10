# 06 — Módulo `bancos` (Tesorería)

Efectivo y equivalentes: dónde está el dinero, qué se movió y si el mayor
coincide con lo que dice el banco.

> **Estado: construido**, salvo el flujo de efectivo proyectado del §3, cuya
> tercera pata es la nómina proyectada y espera a que exista `rh`. La
> integración bancaria directa del §7 sigue fuera de alcance por decisión, no
> por falta de tiempo.
>
> Con el catálogo de cuentas bancarias desapareció la solución provisional que
> cobros y pagos usaban para el auxiliar `banco`: lo derivaban de la posición de
> la cuenta entre las bancarias del plan. Ahora la ficha del catálogo trae las
> dos cosas que el asiento necesita, el código contable y el auxiliar, y elegir
> de dónde entra o sale el dinero volvió a ser una sola decisión.

## 1. Entidades

```
CuentaBancaria
├── banco / numero_cuenta / clabe_iban
├── tipo                   cheques | ahorro | inversion | caja_chica
├── moneda
├── cuenta_contable        ← la cuenta de control en el mayor
├── saldo_libros           calculado desde movimientos
├── saldo_banco            del último estado de cuenta
└── activa

MovimientoBancario         ← lo que registra la empresa
├── cuenta_bancaria_id / fecha
├── tipo                   deposito | retiro | transferencia | comision | interes
├── concepto / referencia
├── importe                con signo
├── origen                 modulo + tipo + id (cobro de cxc, pago de cxp, manual)
├── estado                 registrado | conciliado
├── asiento_id
└── conciliacion_id        nullable

MovimientoEstadoCuenta     ← lo que dice el banco
├── cuenta_bancaria_id / fecha_operacion / fecha_valor
├── descripcion / referencia
├── cargo / abono / saldo
├── origen_carga           archivo importado | API | captura manual
└── conciliacion_id        nullable

Conciliacion
├── cuenta_bancaria_id / periodo
├── saldo_inicial_banco / saldo_final_banco
├── saldo_libros
├── partidas_conciliatorias[]
├── diferencia             debe terminar en 0
└── estado                 en_proceso | cerrada
```

**La distinción entre las dos tablas de movimientos es el diseño central del
módulo.** Son universos separados que se cruzan en la conciliación. Meterlos en
una sola tabla hace imposible conciliar.

## 2. Flujos

### 2.1 Movimientos propios

La mayoría **no se capturan aquí**: llegan de otros módulos.

| Origen | Movimiento |
|---|---|
| `cxc` — cobro registrado | Depósito |
| `cxp` — pago emitido | Retiro |
| `rh` — dispersión de nómina | Retiro |
| Captura manual | Comisiones, intereses, traspasos |

Los que sí nacen aquí (comisiones, intereses, traspasos entre cuentas propias)
generan su propio asiento:

**Comisión bancaria:**

| Cuenta | Cargo | Abono |
|---|---|---|
| Gastos financieros | Importe | |
| IVA acreditable | Impuesto | |
| Bancos | | Total |

**Traspaso entre cuentas propias:**

| Cuenta | Cargo | Abono |
|---|---|---|
| Bancos (destino) | Importe | |
| Bancos (origen) | | Importe |

Si las cuentas son de distinta moneda, se añade la línea de diferencia
cambiaria.

### 2.2 Importación del estado de cuenta

```
cargar archivo → parsear → normalizar → detectar duplicados → guardar
```

Formatos a soportar: CSV, Excel, y los estándares bancarios del país (MT940,
BAI2, CAMT.053 según región). El parser es **por banco**, tras una interfaz
común — cada banco exporta distinto.

Detección de duplicados: si se recarga el mismo archivo o hay traslape de
fechas entre cargas, no se duplican movimientos. La clave suele ser
`(cuenta, fecha_operacion, importe, referencia)`.

### 2.3 Conciliación bancaria

El flujo más valioso del módulo.

```
1. Cargar estado de cuenta del periodo
2. Emparejar automáticamente
3. Resolver manualmente lo no emparejado
4. Registrar partidas conciliatorias
5. Verificar que la diferencia sea 0
6. Cerrar conciliación
```

**Emparejamiento automático** por reglas en cascada, de más a menos estricta:

1. Referencia exacta + importe exacto
2. Importe exacto + fecha dentro de ±N días
3. Importe exacto + coincidencia parcial de descripción
4. Suma de varios movimientos propios contra uno del banco (depósitos agrupados)

Todo lo que empareja automáticamente queda marcado como tal y es reversible. La
regla 4 es la que más falsos positivos genera; conviene que requiera
confirmación.

**Partidas conciliatorias** — lo que explica la diferencia entre ambos saldos:

| Tipo | Descripción | Acción |
|---|---|---|
| Cheques en tránsito | Emitidos, no cobrados | Solo informativo |
| Depósitos en tránsito | Registrados, no acreditados | Solo informativo |
| Cargos del banco no registrados | Comisiones, intereses | **Generar movimiento y asiento** |
| Abonos del banco no registrados | Intereses ganados, cobros directos | **Generar movimiento y asiento** |
| Errores | De cualquiera de los dos lados | Corregir donde corresponda |

La ecuación que debe cerrar:

```
saldo_banco
  − cheques_en_tránsito
  + depósitos_en_tránsito
  ± errores_del_banco
= saldo_libros
```

Si no cierra, la conciliación no se puede cerrar.

## 3. Flujo de efectivo proyectado

Combina información de tres módulos para proyectar la posición de caja:

```
saldo actual (bancos)
  + cobranza esperada (cxc: facturas por vencer)
  − pagos programados (cxp: facturas por vencer)
  − nómina proyectada (rh)
= posición proyectada por semana / mes
```

Es un reporte de **lectura**: consulta a los otros módulos por su API pública,
no por sus tablas.

## 4. Reportes

- Posición de tesorería (saldo por cuenta, por moneda, consolidado)
- Estado de conciliación por cuenta y periodo
- Movimientos no conciliados con antigüedad
- Flujo de efectivo proyectado
- Auxiliar de bancos vs mayor (verificación de integridad)

## 5. Reglas de mapeo contable

| Evento | Rol | Cuenta típica |
|---|---|---|
| `comision_bancaria` | `gasto` | Gastos financieros |
| | `impuesto_acreditable` | IVA acreditable |
| | `banco` | Cuenta bancaria |
| `interes_ganado` | `banco` / `ingreso` | Cuenta bancaria / Productos financieros |
| `traspaso` | `banco_origen` / `banco_destino` | Ambas cuentas bancarias |
| `revaluacion` | `banco` / `diferencia_cambiaria` | Cuenta / Utilidad o pérdida cambiaria |

## 6. Revaluación de moneda extranjera

Al cierre de cada periodo, las cuentas bancarias en moneda extranjera se
revalúan al tipo de cambio de cierre. La diferencia va a resultado cambiario **no
realizado**.

Es parte del checklist de cierre de [03-modulo-contabilidad](03-modulo-contabilidad.md#5-periodos).

## 7. Integración bancaria directa

Fuera del alcance inicial. Cuando se aborde, considerar: consulta de saldos y
movimientos por API, y emisión de pagos (con requisitos de seguridad muy
superiores — firma, doble autorización, límites). Diseñar la importación de
estados de cuenta tras una interfaz que después pueda tener implementación por
API sin cambiar el resto del módulo.
