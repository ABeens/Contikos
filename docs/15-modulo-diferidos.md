# 15 — Módulo `diferidos` (Gastos e ingresos diferidos)

Lo que ya se pagó o se cobró y todavía no se ha consumido: la póliza anual que
se paga en enero y protege los doce meses, el alquiler de un semestre pagado por
adelantado, el mantenimiento que se cobra al firmar y se presta durante un año.

El principio es uno solo: **el desembolso no es el gasto, y el cobro no es el
ingreso**. El importe descansa en una cuenta de balance y se traslada a
resultados mes a mes, hasta agotarse.

## 1. Entidades

```
Diferido
├── empresa_id
├── codigo                 DIF-0001, correlativo por empresa
├── tipo                   gasto | ingreso
├── descripcion
├── tercero                nullable: el asegurador, el arrendante, el cliente
├── monto / moneda         lo pagado o cobrado por adelantado
├── cuenta_diferido        ← la de BALANCE donde descansa el saldo
├── cuenta_destino         ← la de RESULTADOS que lo recibe mes a mes
├── fecha_inicio           desde cuándo se consume
├── plazo_meses
├── cuota_mensual          derivada: monto / plazo
├── monto_amortizado       lo ya llevado a resultados
├── saldo_por_amortizar    monto − monto_amortizado
├── estado                 vigente | agotado | cancelado
├── origen                 nullable: la factura de CxP o CxC que lo originó
├── amortizaciones[]       periodo, fecha, cuota, asiento
└── cancelacion            nullable: fecha, motivo, saldo reconocido, asiento

AmortizacionDiferido       ← una cuota ya contabilizada
├── periodo_id / fecha
├── cuota
└── asiento_id
```

**Las dos formas son simétricas y por eso viven en la misma entidad**, no en
dos:

| | Gasto diferido | Ingreso diferido |
|---|---|---|
| Qué pasó | Se pagó por adelantado | Se cobró por adelantado |
| Saldo por amortizar | **Activo** | **Pasivo** |
| Cada mes | Carga a resultados contra el activo | Abona a resultados contra el pasivo |

Modelarlos por separado duplicaría la corrida, la validación y la pantalla para
cambiar dos signos.

## 2. Componentes

```
Auxiliar de diferidos       listado con saldo y avance, ficha con historial
Registrar diferido          alta, con la tabla de amortización antes de guardar
Amortización                la corrida mensual: verificar y contabilizar
```

## 3. Flujos

### 3.1 Alta

```
factura de CxP/CxC ──► diferido ──► corrida mensual ──► resultados
       (ya contabilizó)      (no contabiliza)
```

**El alta no genera asiento.** Es la regla que más se malinterpreta del módulo,
y por eso está aquí arriba: la factura que pagó la póliza ya hizo su asiento y
ya dejó el importe en la cuenta de balance. Crear el diferido solo declara cómo
va a salir de ahí. Contabilizar otra vez duplicaría el saldo.

El diferido puede nacer sin factura (un saldo que ya venía de antes, una
regularización), y entonces `origen` es nulo. El origen es trazabilidad, no
condición.

Validaciones del alta:

- Monto mayor que cero y plazo de al menos un mes
- Las dos cuentas existen, son de detalle y están activas
- La cuenta de diferido es de balance con el signo correcto: **activo** si es
  gasto, **pasivo** si es ingreso
- La cuenta de destino es de resultados con el signo correcto: **gasto** si es
  gasto, **ingreso** si es ingreso
- Si la cuenta de balance exige auxiliar, el tercero es obligatorio: sin él, el
  asiento de la corrida no se podría escribir contra esa cuenta
- La fecha de inicio cae dentro de un periodo que exista

Un diferido con amortizaciones ya corridas **no se edita**. Lo que ya se llevó a
resultados no se cambia retroactivamente cambiando el plazo; para eso está la
cancelación.

### 3.2 Amortización mensual

Proceso batch, una vez por periodo, con la misma forma que la depreciación de
[07 §3.2](07-modulo-activos.md):

```
seleccionar diferidos vigentes → calcular → revisar → contabilizar
```

Entran los diferidos en estado `vigente` cuya `fecha_inicio` ya llegó y que
conservan saldo por amortizar.

**La última cuota ajusta el remanente** para que el saldo cierre exacto en cero.
Es lo que garantiza que el diferido se agote de verdad y no quede arrastrando
céntimos para siempre, el mismo problema que resuelve el valor residual en la
depreciación.

**Asiento** (uno por corrida, agrupado por par de cuentas):

| | Cuenta | Cargo | Abono |
|---|---|---|---|
| Gasto diferido | Resultados (destino) | Cuota | |
| | Balance (diferido) | | Cuota |
| Ingreso diferido | Balance (diferido) | Cuota | |
| | Resultados (destino) | | Cuota |

La corrida es **idempotente por periodo**: `origen = (conta,
amortizacion_diferidos, periodo)`. Correrla dos veces no duplica el gasto.

### 3.3 Verificación previa

Como en la depreciación, lo que se revisa es lo que se aplica: el mismo cálculo
puro alimenta la pantalla y la decisión de contabilizar.

| Severidad | Qué detecta |
|---|---|
| **error** | Periodo no abierto |
| **error** | Corrida ya contabilizada para ese periodo |
| **error** | Cuenta faltante, inactiva o con naturaleza incorrecta |
| **aviso** | Un diferido se agota este mes |
| **aviso** | La corrida quedó vacía |
| **aviso** | El periodo anterior no tiene corrida |
| **aviso** | Moneda distinta de la funcional: se omite |

Un error impide contabilizar. Un aviso no, pero exige confirmación explícita.

### 3.4 Cancelación anticipada

Cuando el hecho que sostenía el diferido desaparece: la póliza se rescinde, el
contrato se rompe, el servicio no se va a prestar.

**El saldo remanente se reconoce de golpe** contra la cuenta de destino, en un
asiento propio con `origen = (conta, cancelacion_diferido, diferido)`. No se
deja un saldo colgando en balance sin nada que lo respalde: si ya no hay
servicio pendiente, el activo dejó de existir y el gasto es de este mes.

El diferido queda en estado `cancelado` y no vuelve a entrar en ninguna corrida.
No se borra: su historial es parte del rastro contable.

## 4. Reportes

- **Auxiliar de diferidos** a una fecha: monto original, amortizado, saldo y
  avance por ficha. Su total tiene que cuadrar contra las cuentas de balance que
  los sostienen, igual que el aging cuadra contra su cuenta de control
- **Historial de corridas**: qué periodos ya se amortizaron, por cuánto y con
  qué asiento

## 5. Reglas de mapeo contable

Las cuentas viven en la ficha del diferido, no en el código. Es la misma regla
que en el resto de los módulos: cambiar el catálogo de cuentas no debería
requerir tocar el módulo.

La validación no se limita a que la cuenta exista: comprueba su **naturaleza**
contra el tipo de diferido, porque una cuenta de gasto en el lugar del balance
produce un asiento que cuadra y que dice una mentira.

**Advertencia sobre los datos de demostración.** La plantilla de catálogo de
`seed/cuentas.ts` no trae una cuenta de gastos pagados por anticipado ni una de
seguros, así que las fichas de ejemplo usan las más cercanas que sí existen
(`1.1.05.001 Anticipos a proveedores`, `2.1.04.001 Anticipos de clientes`, y
`6.1.02.003 Servicios profesionales` para la póliza). El mapeo de la póliza es
el único que no es exacto. Una empresa real crea sus propias cuentas de
diferidos, y entonces el mapeo es directo.

## 6. Integración

`diferidos` es un módulo satélite más: no conoce el mayor, le manda asientos por
el contrato de [02](02-contrato-asientos.md), y nadie escribe en sus tablas
desde fuera.

Su relación con los demás:

- **CxP** origina los gastos diferidos. La factura que paga la póliza es la que
  deja el saldo en balance
- **CxC** origina los ingresos diferidos, por la misma vía
- **conta** recibe la corrida mensual y la de cancelación, y su cierre de
  periodo debería avisar cuando la amortización del mes no ha corrido, igual que
  avisa de la depreciación ([03 §5](03-modulo-contabilidad.md))

## 7. Qué queda fuera

- **Amortización por días** en lugar de por meses completos. Hoy la convención
  es mes completo desde la fecha de inicio, como en la depreciación
- **Reversión de una corrida** ya contabilizada. Se corrige reversando su asiento
  desde contabilidad, pero eso hoy no devuelve el saldo a la ficha del diferido:
  es la principal deuda del módulo
- **Impuestos diferidos**, que son otra cosa pese al nombre parecido: nacen de la
  diferencia entre el tratamiento fiscal y el contable
  ([07 §5](07-modulo-activos.md)), no de un pago por adelantado
