# 02 — Contrato de asientos

> **Este es el documento más importante del proyecto.** Es la única superficie de
> integración entre los módulos y el núcleo contable. Si este contrato está bien
> definido, los módulos se pueden construir en paralelo y de forma independiente.

## 1. Qué es

Un **asiento** (asiento) es la representación contable de un hecho económico:
una cabecera y N líneas de cargo/abono que suman cero.

Los módulos subsidiarios no saben de cuentas contables en su lógica de negocio.
Saben de facturas, pagos, empleados y activos. La **traducción** de "factura de
venta por 1,160" a "cargo a Clientes 1,160 / abono a Ventas 1,000 / abono a IVA
trasladado 160" ocurre en el borde del módulo, mediante reglas de mapeo
configurables (§5).

## 2. Forma del contrato

```
SolicitudDeAsiento
├── empresa_id           obligatorio
├── fecha                fecha contable (define el periodo)
├── concepto             descripción legible
├── origen               ← clave de idempotencia, ver §4
│   ├── modulo           "cxc" | "cxp" | "bancos" | "activos" | "rh"
│   ├── tipo             "factura" | "pago" | "depreciacion" | "nomina" | ...
│   └── id               id del documento en el módulo origen
├── moneda               moneda del documento
├── tipo_cambio          a moneda funcional; 1 si ya es funcional
└── lineas[]             mínimo 2
    ├── cuenta           código de cuenta contable (debe ser de detalle)
    ├── cargo            ≥ 0
    ├── abono            ≥ 0
    ├── libros           opcional: a qué libros afecta. Omitir = ambos (§3.1)
    ├── concepto         opcional, descripción de la línea
    ├── importe_origen   importe en moneda de la transacción
    ├── centro_costo     opcional
    └── auxiliar         opcional: id de cliente/proveedor/empleado/activo
```

Respuesta:

```
ResultadoAsiento
├── asiento_id
├── numero               consecutivo único por empresa/ejercicio
└── estado               "contabilizado"
```

## 3. Validaciones que aplica `conta`

Se aplican **todas** en el núcleo, sin importar qué módulo llame. El módulo puede
validar antes para dar mejor mensaje de error, pero nunca se confía en él.

| # | Validación | Error si falla |
|---|---|---|
| 1 | `Σ cargos == Σ abonos` **en cada libro** (en moneda funcional) | `ASIENTO_DESCUADRADO` |
| 2 | Al menos 2 líneas, y al menos 2 en cada libro que se mueve | `ASIENTO_INSUFICIENTE` |
| 3 | Cada línea tiene cargo **o** abono, no ambos, no ninguno | `LINEA_INVALIDA` |
| 4 | Ningún importe negativo | `IMPORTE_NEGATIVO` |
| 5 | La cuenta existe, está activa y es de **detalle** (no acumulativa) | `CUENTA_INVALIDA` |
| 6 | La cuenta pertenece a la empresa | `CUENTA_OTRA_EMPRESA` |
| 7 | La fecha cae en un periodo **abierto** | `PERIODO_CERRADO` |
| 8 | Si la cuenta exige auxiliar, la línea lo trae | `AUXILIAR_REQUERIDO` |
| 9 | `origen` no fue contabilizado antes | ver §4 |
| 10 | El tipo de cambio es > 0 | `TIPO_CAMBIO_INVALIDO` |
| 11 | Cada línea afecta al menos un libro | `LIBRO_REQUERIDO` |

**Sobre el cuadre y el redondeo:** el cuadre se valida sobre importes ya
redondeados a la precisión de la moneda funcional. Nunca se compara con
tolerancia — o cuadra exacto, o se rechaza. Si la conversión de moneda produce
un descuadre de centavos, el módulo origen es responsable de añadir una línea de
ajuste por redondeo antes de enviar.

**Sobre decimales:** todos los importes son decimales de precisión fija
(`DECIMAL(19,4)` o equivalente). Nunca punto flotante. Un `float` en un sistema
contable es un bug esperando su turno.

### 3.1 Los dos libros

La empresa lleva **dos contabilidades sobre el mismo catálogo de cuentas**:

| Libro | Qué es | Marco |
|---|---|---|
| `fiscal` | Lo que se declara ante Hacienda | Reglas tributarias de Costa Rica |
| `corporativo` | Lo que mide el negocio | NIIF para PYMES |

**Un hecho económico es un solo asiento.** No hay dos asientos hermanos ni dos
numeraciones: hay un asiento, un consecutivo, y cada línea declara a qué libros
va. Lo que se separa es el **mayor**, que se acumula por libro.

**Por omisión una línea afecta a los dos.** Un módulo subsidiario que no sabe
nada de libros contabiliza igual que siempre y su asiento entra en ambos. Solo
quien tiene una diferencia que declarar toca el campo `libros`. Esto no es una
comodidad de la UI: es lo que hace que añadir el segundo libro no obligue a
tocar CxC, CxP, bancos ni RH.

Cuidado con la diferencia entre omitir y vaciar:

- `libros` ausente → las dos contabilidades
- `libros: ["fiscal"]` → solo la fiscal
- `libros: []` → error `LIBRO_REQUERIDO`, nunca "ninguna de las dos"

#### Cada libro cuadra por separado

La validación 1 se aplica **por libro**, no al asiento completo. Cuadrar el
total no significaría nada: las líneas que solo tocan un libro no tienen
contrapartida en el otro.

Si un libro descuadra, se rechaza el asiento entero. No se contabiliza "la
mitad buena" dejando el otro libro roto.

#### Cómo se expresa una diferencia

Duplicando las líneas que difieren, cada juego marcado a su libro. Ejemplo real:
la depreciación de un equipo con tasa fiscal del 25% y vida útil NIIF de 5 años.

| Cuenta | Cargo | Abono | Libros |
|---|---|---|---|
| Gasto por depreciación | 187 500 | | `["fiscal"]` |
| Dep. acumulada equipo de cómputo | | 187 500 | `["fiscal"]` |
| Gasto por depreciación | 150 000 | | `["corporativo"]` |
| Dep. acumulada equipo de cómputo | | 150 000 | `["corporativo"]` |

Fiscal cuadra en 187 500 y corporativo en 150 000. El mismo asiento, dos
mayores distintos.

Casos típicos en Costa Rica:

| Caso | Fiscal | Corporativo |
|---|---|---|
| Depreciación | Tasa del reglamento del impuesto sobre la renta | Vida útil real del activo |
| Provisiones (vacaciones, aguinaldo, cesantía) | Al pagarse | Al devengarse |
| Estimación de incobrables | Límite deducible | Pérdida esperada |
| Gastos no deducibles | Entra igual: lo no deducible se ajusta en la declaración, no se esconde del libro | Igual |

La última fila importa: **un gasto no deducible sí entra en el libro fiscal.**
La deducibilidad se resuelve en la conciliación fiscal de la renta, no borrando
movimientos. Marcar una línea a un solo libro es para diferencias de
*reconocimiento o medición*, no para maquillar la declaración.

#### Qué comparten y qué no

| Comparten | Por libro |
|---|---|
| Catálogo de cuentas | Mayor y saldos |
| Periodos y su estado | Balanza y estados financieros |
| Consecutivo de asientos | Resultado del ejercicio |
| Auxiliares (clientes, proveedores, activos) | |

Los auxiliares se concilian contra la cuenta de control **del libro fiscal**
([01 §6](01-arquitectura.md)): el saldo de un cliente es lo que debe, y eso no
cambia según el marco contable.

---

## 4. Idempotencia

La terna `(empresa_id, origen.modulo, origen.tipo, origen.id)` tiene **índice
único**.

Comportamiento al reintentar:

- Si el asiento ya existe con **el mismo contenido** → devuelve el asiento
  existente. Éxito, sin duplicar.
- Si el asiento ya existe con **contenido distinto** → error
  `ORIGEN_YA_CONTABILIZADO`. No se sobrescribe nada.

Esto hace que reintentos por timeout, doble clic o reproceso de una cola sean
seguros por construcción.

## 5. Mapeo de cuentas

Cada módulo necesita saber a qué cuenta va cada cosa. Ese mapeo **es
configuración, no código**.

```
ReglaDeMapeo
├── empresa_id
├── modulo           "cxc"
├── evento           "factura_emitida"
├── rol              "cliente" | "ingreso" | "impuesto_trasladado"
├── criterio         opcional: por tipo de cliente, producto, sucursal...
└── cuenta           código de cuenta destino
```

Ejemplo — `cxc` / `factura_emitida`:

| Rol | Cuenta | Movimiento |
|---|---|---|
| `cliente` | Clientes | Cargo por el total |
| `ingreso` | Ventas | Abono por el subtotal |
| `impuesto_trasladado` | IVA trasladado | Abono por el impuesto |

Cambiar el catálogo de cuentas o el país no debería requerir tocar el código de
CxC. Solo estas reglas.

## 6. Reversas y correcciones

Un asiento contabilizado **es inmutable**. Nunca se edita ni se borra.

Para corregir: se genera un **asiento de reversa** — mismas líneas con cargos y
abonos invertidos — y luego el asiento correcto.

La reversa **conserva los libros de cada línea**: si el original solo tocaba la
contabilidad corporativa, su reversa tampoco entra en la fiscal. Reversar en los
dos libros lo que solo entró en uno dejaría el otro descuadrado.

```
ReversaDeAsiento
├── asiento_id       el que se reversa
├── fecha            debe caer en periodo abierto
└── motivo           obligatorio, queda en bitácora
```

Reglas:

- La reversa lleva su propio `origen`, derivado del original
  (`origen.tipo = "reversa"`, `origen.id = asiento_id`)
- Un asiento solo se puede reversar **una vez**
- Si el periodo original ya está cerrado, la reversa va en el periodo abierto
  actual. No se reabre un periodo cerrado para corregir.

## 7. Ciclo de vida de un documento

Todo documento subsidiario sigue el mismo ciclo:

```
borrador ──► validado ──► contabilizado ──► [cancelado]
    │            │                              ▲
    └── editable └── editable                   │
                     no editable ───────────────┘
                     (solo reversa)
```

- **borrador** — se edita y se borra libremente. No toca el mayor.
- **validado** — pasó reglas de negocio; aún no contabilizado. Editable.
- **contabilizado** — generó asiento. Inmutable.
- **cancelado** — se generó reversa. El documento queda en el histórico.

## 8. Transaccionalidad

La creación del documento y su asiento ocurren en **la misma transacción de base
de datos**:

```
BEGIN
  guardar documento en el módulo
  emitir asiento en conta        ← si falla, todo revierte
COMMIT
```

No hay estado intermedio observable donde el documento existe sin su asiento.
Esta decisión implica que `conta` y los módulos comparten la misma base de datos.
Si en el futuro se separan en servicios distintos, hay que sustituir esto por
outbox pattern — y asumir consistencia eventual, con el proceso de conciliación
del §6 de [01-arquitectura](01-arquitectura.md) como red de seguridad.
