# 04 — Módulo `cxc` (Cuentas por Cobrar)

Ciclo de ingresos: del cliente a la factura, de la factura al cobro.

## 1. Entidades

```
Cliente
├── codigo / razon_social / nombre_comercial
├── identificacion_fiscal          ← formato depende del país
├── direccion_fiscal
├── regimen_fiscal                 ← depende del país
├── condiciones_pago               contado | 15 | 30 | 60 días
├── limite_credito
├── moneda_default
├── cuenta_contable                override del mapeo default
├── vendedor / lista_precios
└── activo

ProductoServicio
├── codigo                         llave visible: es lo que se teclea al facturar
├── nombre / descripcion
├── tipo                           producto | servicio
├── precio_lista / moneda
├── tarifa_impuesto                default de la línea
├── cuenta_ingreso                 default de la línea
└── activo

Factura
├── serie / folio                  consecutivo, sin huecos
├── cliente_id
├── fecha_emision / fecha_vencimiento
├── moneda / tipo_cambio
├── conceptos[]
│   ├── producto_servicio / descripcion
│   ├── cantidad / precio_unitario
│   ├── descuento
│   ├── impuestos[]                trasladados y retenidos
│   └── cuenta_ingreso             override del mapeo
├── subtotal / descuentos / impuestos / total
├── saldo_pendiente
├── estado                         borrador|validada|contabilizada|pagada|cancelada
├── asiento_id                      nullable hasta contabilizar
└── datos_fiscales                 ← específicos del país (ver §6)

Cobro
├── folio / cliente_id / fecha
├── forma_pago                     transferencia | efectivo | cheque | tarjeta
├── cuenta_bancaria_id             destino
├── moneda / tipo_cambio
├── importe
├── aplicaciones[]                 ← a qué facturas se aplica
│   ├── factura_id
│   ├── importe_aplicado
│   └── diferencia_cambiaria       si la factura era en otra moneda
└── importe_sin_aplicar            anticipo
```

**Nota de diseño sobre `Cobro`:** un cobro puede aplicarse a varias facturas y
una factura puede recibir varios cobros parciales. La relación es N a N, no
un campo `cobro_id` en la factura. Modelarlo mal aquí obliga a rehacer el módulo
después.

### 1.1 Catálogo de productos y servicios

Es lo que se vende, con **su cuenta de ingreso y su tarifa de impuesto ya
decididas**. Existe para que esa pareja se decida una vez, al dar de alta el
producto o el servicio, y no en cada factura: quien factura no tiene por qué
saber que la consultoría acredita `4.1.01.001` al 13% y la consulta médica al
4%, ni que la exportación va a tarifa 0 y no a exenta.

Al elegir un item, la línea de la factura se precarga con cuatro datos:

| Campo de la línea | De dónde sale |
|---|---|
| Descripción | La descripción de factura del item, o su nombre |
| Precio unitario | El precio de lista, **solo si el item está cotizado en la moneda de la factura** |
| Tarifa de impuesto | La del item |
| Cuenta de ingreso | La del item |

**Precarga, no impone.** Los cuatro campos siguen siendo editables y lo que se
contabiliza es lo que quedó en la línea. Hay ventas que salen de la lista de
precios y facturas que acreditan una cuenta distinta de la habitual; obligar a
respetar el catálogo forzaría a inventar un item por cada excepción.

El precio no se convierte de una moneda a otra: un item cotizado en dólares en
una factura en colones deja el campo como esté y lo avisa. Convertirlo por el
tipo de cambio del día daría un precio de lista que nadie pactó.

La línea emitida guarda de qué item salió (`item_id`) y **con qué código se
vendió** (`item_codigo`, copiado como se copia el nombre del cliente). Renombrar
o reprecificar el catálogo después no cambia lo que dice un comprobante ya
emitido, ni su asiento.

Orden de resolución de la cuenta de ingreso, del más específico al más general
(docs/02 §5): lo que quedó en la línea → el `override` del cliente → el mapeo
del módulo. El catálogo actúa **antes** de esa cadena, escribiendo en la línea
al capturar; no es un cuarto nivel que se resuelva al contabilizar.

Pendiente: el código CABYS de Hacienda, obligatorio en el comprobante
electrónico (docs/13 §4). Se añadirá al item cuando se construya el XML, contra
el catálogo vigente de la DGT y no de memoria.

## 2. Flujos

### 2.1 Emisión de factura

```
borrador → validar → contabilizar → [timbrar/enviar al fisco] → entregar al cliente
```

Validaciones antes de contabilizar:

- Cliente activo
- El total no excede el límite de crédito disponible (bloquea o advierte, según configuración)
- Todos los conceptos tienen cuenta de ingreso resoluble
- El item que cita una línea existe en el catálogo (§1.1)
- Periodo abierto
- Impuestos calculados y cuadrados contra el total

**Asiento:**

| Cuenta | Cargo | Abono |
|---|---|---|
| Clientes (auxiliar: cliente) | Total | |
| Ventas | | Subtotal |
| IVA/impuesto trasladado | | Impuesto |
| Impuestos retenidos por el cliente | Retención | |

### 2.2 Cobro

```
capturar → aplicar a facturas → contabilizar → notificar a bancos
```

Validaciones antes de contabilizar:

- Cliente activo
- Periodo abierto
- Importe recibido mayor que cero
- Cada factura aplicada es de ese cliente, está contabilizada y tiene saldo
- Lo aplicado a una factura no excede su saldo, y la suma de las aplicaciones no
  excede lo recibido
- La cuenta de depósito admite movimientos y trae su auxiliar si lo exige

**Asiento:**

| Cuenta | Cargo | Abono |
|---|---|---|
| Bancos o caja (auxiliar: cuenta bancaria) | Importe recibido | |
| Clientes (auxiliar: cliente) | | Importe aplicado |
| Anticipos de clientes (auxiliar: cliente) | | Importe sin aplicar |
| Diferencia cambiaria | según signo | según signo |

El módulo publica el evento `CobroRegistrado` para que `bancos` lo tenga
disponible en la conciliación.

#### Decisiones de implementación

Siete puntos que esta sección dejaba abiertos y que el código tuvo que resolver.
Se documentan aquí porque son reglas contables, no detalles.

**Moneda.** Un cobro solo se aplica a facturas de su misma moneda. Aplicar un
cobro en colones a una factura en dólares obligaría a elegir a qué tipo de
cambio se convierte el abono, y esa decisión no la puede tomar el sistema por
nadie: se registra un cobro por moneda. Lo que sí se admite, y es el caso normal
del comercio exterior, es cobrar en la moneda de la factura a **otro** tipo de
cambio, y de ahí sale la diferencia cambiaria.

**De dónde sale la diferencia cambiaria.** La cuenta de clientes se abona al
tipo de cambio con el que la factura entró al mayor, no al del cobro: es lo que
mantiene el auxiliar cuadrado contra la cuenta de control. Lo que entra al banco
va al tipo del cobro. La diferencia entre las dos conversiones es la ganancia o
la pérdida cambiaria, y por eso tiene línea propia. Se calcula como el residuo
del asiento y no como suma de las diferencias por factura: así absorbe además
los céntimos del redondeo de cada conversión, que es donde
[doc 02 §3](02-contrato-asientos.md) pide que el módulo origen los ponga.

**Moneda del asiento.** El asiento del cobro se expresa en **moneda funcional**.
Es la única en la que puede cuadrar cuando el cobro y la factura llevan tipos de
cambio distintos: en la moneda del cobro, el cargo al banco y el abono a
clientes serían el mismo número y la diferencia cambiaria no tendría dónde
aparecer.

**Exceso.** Lo recibido de más no se rechaza ni se reparte solo: queda como
anticipo del cliente, que es un pasivo con auxiliar. Devolverlo o aplicarlo a
una factura futura es otra operación.

**Anulación.** Anular un cobro reversa su asiento y devuelve el saldo a las
facturas que había bajado; una factura que había llegado a `pagada` vuelve a
`contabilizada`. Se permite aunque el periodo del cobro ya esté cerrado: la
reversa va en el periodo abierto y no se reabre nada para corregir
([doc 02 §6](02-contrato-asientos.md)). Lo que sí se exige es que la fecha de la
anulación caiga en periodo abierto. El documento no se borra: queda en el
histórico con su motivo y la fecha contable de la anulación, que es lo que hace
reproducible la antigüedad de un cierre pasado (§3).

**Cuenta bancaria.** Las cuentas bancarias del catálogo son de control del
módulo `bancos` y exigen auxiliar de tipo `banco`. Mientras ese módulo no exista
no hay catálogo al que preguntarle, así que el auxiliar se **captura a mano** en
el cobro; quien cobre en efectivo usa la cuenta de caja, que no lo exige. El día
que exista `bancos`, ese campo pasa a ser el id de una cuenta bancaria de su
catálogo y deja de teclearse; la forma del contrato no cambia.

**Imputación automática.** La pantalla ofrece repartir lo recibido entre las
facturas pendientes de la más vieja a la más nueva. Es la imputación habitual en
cobranza y la que vacía las cubetas de la derecha del reporte de antigüedad;
sigue siendo un punto de partida editable, no una imposición.

### 2.3 Nota de crédito

Devoluciones, descuentos posteriores, correcciones. Es el inverso de la factura
y se aplica contra una o varias facturas, reduciendo su saldo.

### 2.4 Cancelación

Solo con factura **no cobrada** (o cancelando antes los cobros). Genera reversa
del asiento. Si el país exige un proceso de cancelación ante la autoridad fiscal,
el estado local no cambia hasta que la autoridad confirma.

## 3. Antigüedad de saldos (aging)

El reporte central del módulo. Distribuye el saldo pendiente de cada cliente en
cubetas según días vencidos:

| Por vencer | 1–30 | 31–60 | 61–90 | +90 |
|---|---|---|---|---|

Se calcula **a una fecha de corte**, no solo a hoy — un aging al cierre del mes
pasado debe seguir siendo reproducible.

La suma del aging a fecha de corte debe ser **exactamente igual** al saldo de la
cuenta de control "Clientes" en el mayor a esa fecha. Esa igualdad es la
verificación de integridad del módulo.

Que sea reproducible obliga a **no usar el saldo de hoy de la factura**: se
reconstruye desde su total menos las aplicaciones de los cobros vigentes a esa
fecha. Un cobro de julio anulado en octubre sí bajaba el saldo en agosto, y el
mayor dice lo mismo, porque el asiento del cobro está en julio y el de su
reversa en octubre. De ahí que el cobro guarde la **fecha contable** de su
anulación y no solo el hecho de estar anulado (§2.2).

## 4. Otros reportes

- Estado de cuenta por cliente (movimientos y saldo)
- Facturas por cobrar por vendedor
- Cobranza del periodo por forma de pago
- Clientes que exceden límite de crédito
- Estimación de cuentas incobrables por antigüedad

## 5. Reglas de mapeo contable

| Evento | Rol | Cuenta típica |
|---|---|---|
| `factura_emitida` | `cliente` | Clientes |
| | `ingreso` | Ventas (por producto/servicio o categoría) |
| | `impuesto_trasladado` | IVA trasladado |
| | `impuesto_retenido` | Impuestos retenidos por cobrar |
| `cobro_registrado` | `banco` | Cuenta bancaria destino |
| | `cliente` | Clientes |
| | `anticipo` | Anticipos de clientes |
| | `diferencia_cambiaria` | Utilidad/pérdida cambiaria |
| `nota_credito` | inverso de `factura_emitida` | |

## 6. Dependencia de la localización fiscal

Esta parte **no se puede escribir** hasta decidir el país. Lo que cambia:

- Formato y validación de la identificación fiscal
- Catálogo de impuestos, tasas y reglas de retención
- Facturación electrónica: si existe, con qué formato, si requiere
  certificación por un tercero, cómo se cancela
- Campos obligatorios del comprobante
- Reglas de exportación contable para la autoridad

**Recomendación de diseño:** aislar todo esto tras una interfaz
`LocalizacionFiscal` con implementación por país. El resto del módulo CxC no
debe contener ni una condición `if (pais == ...)`.
