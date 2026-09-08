# 05 — Módulo `cxp` (Cuentas por Pagar)

Ciclo de egresos: del proveedor a la factura, de la factura al pago.

Es el espejo de CxC, pero con dos diferencias importantes: aquí vive el
**control interno** (autorizaciones, three-way match) y el **impuesto es
acreditable**, no trasladado.

## 1. Entidades

```
Proveedor
├── codigo / razon_social
├── identificacion_fiscal / regimen_fiscal
├── condiciones_pago / dias_credito
├── moneda_default
├── cuenta_contable                override del mapeo
├── datos_bancarios                para pagos
├── retenciones_aplicables         qué retenciones le corresponden
└── activo

OrdenDeCompra                      ← opcional, ver §3
├── folio / proveedor_id / fecha
├── conceptos[] / total
├── estado                         borrador|autorizada|recibida|facturada|cerrada
└── autorizaciones[]

Recepcion                          ← opcional, ver §3
├── orden_compra_id / fecha
└── conceptos_recibidos[]

FacturaProveedor
├── folio_proveedor                el que trae el documento del proveedor
├── folio_interno
├── proveedor_id
├── fecha_emision / fecha_vencimiento
├── moneda / tipo_cambio
├── conceptos[]
│   ├── descripcion / importe
│   ├── impuestos[]
│   └── cuenta_gasto               o cuenta de activo/inventario
├── subtotal / impuestos / retenciones / total
├── saldo_pendiente
├── estado                         recibida|en_revision|autorizada|contabilizada|pagada|cancelada
├── orden_compra_id                nullable
└── asiento_id

Pago
├── folio / proveedor_id / fecha
├── forma_pago / cuenta_bancaria_id
├── moneda / tipo_cambio / importe
├── aplicaciones[]                 N a N con facturas
│   ├── factura_id / importe
│   ├── tipo_cambio_factura        al que se reconoció el pasivo
│   ├── saldo_anterior / saldo_resultante
│   └── diferencia_cambiaria       en moneda funcional
├── anticipo                       importe menos lo aplicado
├── asiento_id
├── estado                         propuesto|autorizado|emitido|conciliado|anulado
└── autorizaciones[]
```

La aplicación guarda el tipo de cambio de la factura y no solo su id: es lo que
permite reconstruir la diferencia cambiaria de ese abono sin volver a leer la
factura, que para entonces puede tener otro saldo y otros pagos encima.

De los estados, hoy existen `emitido` y `anulado`. `propuesto` y `autorizado`
son del circuito de control interno (§7), que necesita usuarios y niveles de
autorización; la propuesta de §2.3 no se guarda, así que no hay documento que
esté en esos estados. `conciliado` lo pondrá bancos cuando el movimiento
aparezca en el estado de cuenta: ponerlo desde aquí sería afirmar una
conciliación que nadie hizo.

## 2. Flujos

### 2.1 Recepción y autorización de factura

```
recibida → en_revision → autorizada → contabilizada → programada → pagada
```

Validaciones:

- El proveedor existe y está activo
- No hay factura duplicada: `(proveedor_id, folio_proveedor)` es único
- Si hay orden de compra, el three-way match cuadra (§3)
- Las retenciones aplicables al proveedor se calcularon

**Asiento:**

| Cuenta | Cargo | Abono |
|---|---|---|
| Gasto / Inventario / Activo | Subtotal | |
| IVA/impuesto acreditable | Impuesto | |
| Proveedores (auxiliar: proveedor) | | Total |
| Impuestos retenidos por pagar | | Retención |

### 2.2 Pago

```
proponer → autorizar → emitir → aplicar a facturas → contabilizar
```

**Asiento:**

| Cuenta | Cargo | Abono |
|---|---|---|
| Proveedores (auxiliar: proveedor) | Importe aplicado | |
| Anticipos a proveedores | Sin aplicar | |
| Bancos o caja (auxiliar: cuenta bancaria) | | Importe |
| Diferencia cambiaria | según signo | según signo |

Publica `PagoEmitido` para bancos.

Validaciones:

- El proveedor existe y está activo
- La fecha cae en un periodo abierto y el importe es mayor que cero
- Cada factura aplicada es de ese proveedor, está contabilizada y tiene saldo
- Lo aplicado a una factura no excede su saldo, y la suma de aplicaciones no
  excede el importe del pago. Lo que sobra **no es un error**: es un anticipo
- **Lo que se paga es el neto.** La cuenta por pagar nació por el total menos la
  retención de renta (§2.1), porque esa retención no se le paga al proveedor
  sino que se le entera a Hacienda. El pago trabaja siempre contra el saldo

#### Moneda del pago y moneda de la factura

Una factura solo se salda con un pago **en su misma moneda**. Pagar una factura
en dólares con un egreso en colones no es una aplicación sino una compra de
divisas: tiene su propio tipo de cambio de compra y su propio asiento, y
pertenece a bancos. Sin ese dato, cruzar monedas exigiría inventar una paridad
que nadie capturó.

Lo que sí puede diferir es el **tipo de cambio**. El pasivo entró al mayor al
tipo de la factura y se cancela con colones del día del pago:

```
diferencia = importe aplicado × (tipo de cambio de la factura − tipo de cambio del pago)
```

Positiva es ganancia (el pasivo valía más colones de los que costó pagarlo) y
va a Diferencial cambiario ganado; negativa es pérdida y va al perdido.

#### El asiento va en moneda funcional

Es la única en la que la diferencia cambiaria existe: en la moneda del
documento, lo aplicado y lo pagado son el mismo número y la diferencia no
tendría dónde aparecer. Cada línea se convierte con **el tipo de cambio que le
corresponde**: el cargo a Proveedores con el de la factura y el abono a bancos
con el del pago. La diferencia entre los dos es exactamente el resultado
cambiario, y por eso el asiento cuadra sin línea de ajuste por redondeo.

Va una línea de Proveedores **por factura aplicada**, no una sola agrupada: cada
una cancela su pasivo a su propio tipo de cambio, y además deja el mayor
diciendo qué factura se saldó, que es lo que hace falta al auditar el auxiliar.

#### Anulación

Un pago contabilizado es inmutable (§7 de [doc 02](02-contrato-asientos.md)). Se
anula reversando su asiento y devolviendo el saldo a cada factura que había
abonado; el documento queda en el histórico con su motivo y el id de la reversa.

**No se exige que el periodo del pago siga abierto.** Lo que tiene que caer en
periodo abierto es la fecha de la reversa, por la regla de
[doc 02 §6](02-contrato-asientos.md): si el periodo del original ya cerró, la
reversa va en el abierto y no se reabre nada. Exigir lo contrario obligaría a
reabrir un mes ya declarado para anular un cheque devuelto.

El saldo se devuelve **sumando lo aplicado**, no restaurando el saldo anterior
que guarda la aplicación: entre medias pudo haber otro pago sobre la misma
factura, y reponer la foto vieja borraría ese abono.

### 2.3 Propuesta de pago

El flujo más usado del módulo en la práctica: el sistema propone qué pagar según
fecha de vencimiento, disponibilidad de efectivo y prioridad de proveedor;
alguien lo autoriza; se genera el lote de pagos y, si aplica, el archivo para el
banco.

Cómo se reparte:

1. Se toman las facturas contabilizadas con saldo, emitidas hasta la fecha de
   corte, ordenadas por vencimiento y con el folio interno como desempate
2. A cada una se le asigna lo que quepa del efectivo disponible. La última que
   alcanza queda propuesta **parcialmente**: es lo que hace un tesorero cuando
   el efectivo no llega para todo
3. Las que no caben se enumeran igual, con propuesto en cero. Un reporte que
   solo listara lo que alcanza escondería el dato con el que se pide efectivo

El tope de efectivo se mide en **moneda funcional**, que es la única común a
facturas de distintas monedas; lo propuesto se devuelve en las dos, porque al
proveedor se le paga en la suya. Cuando la factura cabe entera se propone su
saldo exacto sin pasar por la división: dividir y volver a multiplicar dejaría
céntimos de diferencia contra el saldo que se quiere saldar.

**La propuesta no se guarda.** Se recalcula sobre las facturas vigentes cada vez
que se pide: una propuesta almacenada envejece mal, porque las facturas que la
componen se pagan por otros caminos y el documento acabaría proponiendo pagar lo
que ya se pagó. Convertirla en pagos genera **un pago por proveedor y moneda**,
con sus facturas ya aplicadas, y se emiten en serie: cada uno consume
consecutivo y toca los mismos saldos.

## 3. Three-way match

Cuando hay orden de compra, la factura solo se autoriza si concuerdan tres
documentos:

```
Orden de compra ── qué se pidió y a qué precio
Recepción       ── qué llegó realmente
Factura         ── qué cobra el proveedor
```

Se compara cantidad y precio, con **tolerancias configurables** (ej. ±2% o ±$50).
Fuera de tolerancia, la factura entra en excepción y requiere autorización
manual de un nivel superior.

Esto es opcional. Muchas empresas pequeñas facturan sin orden de compra. Debe ser
configurable por empresa y por proveedor.

## 4. Gastos devengados y provisiones

Al cierre, servicios consumidos y no facturados deben reconocerse:

| Cuenta | Cargo | Abono |
|---|---|---|
| Gasto | Importe estimado | |
| Gastos acumulados por pagar | | Importe estimado |

La provisión se reversa automáticamente el primer día del periodo siguiente,
cuando llega la factura real. El sistema debe generar la reversa sin
intervención manual — es una fuente clásica de duplicación de gastos.

## 5. Reportes

- Antigüedad de saldos por proveedor (misma lógica y misma verificación de
  integridad que en CxC: el aging debe cuadrar contra la cuenta de control)
- Proyección de pagos por vencimiento (alimenta el flujo de efectivo)
- Compras por proveedor / por categoría de gasto
- Facturas pendientes de autorizar, por antigüedad en el flujo
- Impuestos acreditables del periodo
- Retenciones efectuadas del periodo

## 6. Reglas de mapeo contable

| Evento | Rol | Cuenta típica |
|---|---|---|
| `factura_recibida` | `proveedor` | Proveedores |
| | `gasto` | Según categoría del concepto |
| | `impuesto_acreditable` | IVA acreditable |
| | `impuesto_retenido` | Impuestos retenidos por pagar |
| `pago_emitido` | `banco` | Cuenta bancaria origen |
| | `proveedor` | Proveedores |
| | `anticipo` | Anticipos a proveedores |
| | `diferencial_ganado` / `diferencial_perdido` | Diferencial cambiario |
| `provision` | `gasto` / `acumulado` | Gasto / Gastos acumulados |

## 7. Control interno

El módulo debe soportar, como configuración:

- **Niveles de autorización por monto** (hasta X, un aprobador; arriba de X, dos)
- **Segregación de funciones**: quien captura no autoriza, quien autoriza no
  emite el pago
- **Bitácora completa** de cada autorización: quién, cuándo, desde dónde

Es la superficie con más riesgo de fraude de todo el sistema. Vale la pena
diseñarlo bien desde el inicio.

## 8. Dependencia de la localización fiscal

Igual que en CxC, aislado tras `LocalizacionFiscal`:

- Reglas de retención (qué se retiene, a quién, a qué tasa)
- Requisitos para que un gasto sea deducible
- Validación de comprobantes del proveedor contra la autoridad fiscal
- Declaraciones informativas de operaciones con terceros
