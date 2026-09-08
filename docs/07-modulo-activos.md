# 07 — Módulo `activos` (Activos Fijos)

Ciclo de vida del activo: alta, depreciación, mejoras, baja.

Es el módulo más pequeño y el más autónomo — no depende de CxC ni de bancos, y
su interacción con el mayor es casi toda por un proceso mensual automático.

## 1. Entidades

```
CategoriaActivo
├── nombre                     "Equipo de cómputo"
├── vida_util_meses            36
├── metodo_depreciacion        linea_recta | saldos_decrecientes | unidades_produccion
├── porcentaje_residual
├── cuenta_activo              ← mapeo contable de la categoría
├── cuenta_depreciacion_acumulada
├── cuenta_gasto_depreciacion
└── tasa_fiscal                si difiere de la contable, ver §5

Activo
├── codigo / nombre / descripcion
├── categoria_id
├── fecha_adquisicion
├── fecha_inicio_depreciacion  puede diferir: se deprecia desde que está en uso
├── costo_adquisicion
├── valor_residual
├── vida_util_meses            hereda de categoría, puede sobrescribirse
├── metodo_depreciacion
├── depreciacion_acumulada     calculada
├── valor_en_libros            costo − depreciación acumulada
├── ubicacion / responsable / centro_costo
├── proveedor_id / factura_id  trazabilidad al origen en cxp
├── numero_serie / poliza_seguro
├── estado                     activo | totalmente_depreciado | dado_de_baja | vendido
└── componentes[]              ver §2

MovimientoActivo               ← historial completo, inmutable
├── activo_id / fecha
├── tipo                       alta | depreciacion | mejora | revaluacion | baja | venta | traslado
├── importe
├── depreciacion_acumulada_antes / despues
├── valor_libros_antes / despues
└── asiento_id

CorridaDepreciacion
├── empresa_id / periodo
├── estado                     calculada | contabilizada | reversada
├── total_depreciacion
├── detalle[]                  por activo
└── asiento_id
```

## 2. Componentes

Un activo puede depreciarse por partes con vidas útiles distintas (un edificio:
estructura 50 años, instalaciones 15, acabados 10). Si el alcance inicial no lo
requiere, modelar el activo con un solo componente implícito — pero dejar la
puerta abierta, porque añadirlo después obliga a migrar todo el histórico de
depreciación.

## 3. Flujos

### 3.1 Alta

Dos orígenes:

- **Desde CxP** — al capturar una factura de compra cuyo concepto va a una cuenta
  de activo fijo, se ofrece crear el activo. El asiento ya lo hizo CxP; aquí solo
  se registra la ficha del activo, sin generar asiento nuevo.
- **Alta directa** — aportación de socios, donación, activo construido. Aquí sí
  genera asiento:

| Cuenta | Cargo | Abono |
|---|---|---|
| Activo fijo (auxiliar: activo) | Costo | |
| Contrapartida (capital / donación / construcción en proceso) | | Costo |

**Regla:** el activo no empieza a depreciarse hasta `fecha_inicio_depreciacion`,
que es cuando está disponible para su uso — no cuando se compró.

### 3.2 Depreciación mensual

Proceso batch, una vez por periodo:

```
seleccionar activos depreciables → calcular → revisar → contabilizar
```

Reglas de cálculo:

- Solo activos en estado `activo` con `fecha_inicio_depreciacion` ≤ fin de periodo
- Nunca depreciar por debajo del valor residual
- El último mes ajusta el remanente para que cierre exacto contra el residual
  (evita el clásico "quedan 3 centavos por depreciar para siempre")
- Un activo dado de baja a mitad de mes deprecia la fracción según la convención
  configurada (mes completo / medio mes / prorrateo diario)

**Métodos:**

| Método | Fórmula mensual |
|---|---|
| Línea recta | `(costo − residual) / vida_util_meses` |
| Saldos decrecientes | `valor_en_libros × tasa / 12` |
| Unidades de producción | `(costo − residual) × unidades_periodo / unidades_totales` |

**Asiento** (un solo asiento por corrida, agrupado por categoría y centro de
costo):

| Cuenta | Cargo | Abono |
|---|---|---|
| Gasto por depreciación | Importe | |
| Depreciación acumulada (auxiliar: activo) | | Importe |

La corrida es **idempotente por periodo**: `origen = (activos, depreciacion,
periodo)`. Correrla dos veces no duplica el gasto.

### 3.3 Mejora / capitalización

Un desembolso posterior que extiende la vida útil o aumenta la capacidad se
capitaliza (aumenta el costo); un mantenimiento se manda a gasto. La distinción
es criterio contable y debe ser una decisión explícita del usuario, registrada.

Al capitalizar, la depreciación futura se recalcula sobre el nuevo valor en
libros y la vida útil remanente. **No se recalcula el pasado.**

### 3.4 Baja y venta

**Baja (desecho):**

| Cuenta | Cargo | Abono |
|---|---|---|
| Depreciación acumulada | Acumulada | |
| Pérdida en baja de activos | Valor en libros | |
| Activo fijo | | Costo |

**Venta:**

| Cuenta | Cargo | Abono |
|---|---|---|
| Clientes / Bancos | Precio de venta | |
| Depreciación acumulada | Acumulada | |
| Activo fijo | | Costo |
| Utilidad o pérdida en venta | según resultado | según resultado |

Antes de la baja, debe correrse la depreciación hasta la fecha de baja.

### 3.5 Traslado

Cambio de ubicación, responsable o centro de costo. No genera asiento salvo que
cambie el centro de costo, en cuyo caso la depreciación futura se carga al nuevo.

## 4. Reportes

- Inventario de activos (por categoría, ubicación, responsable, centro de costo)
- Cédula de depreciación del periodo y acumulada del ejercicio
- Activos totalmente depreciados aún en uso
- Movimientos del ejercicio: altas, bajas, traslados
- Proyección de depreciación futura (alimenta presupuesto)
- Conciliación auxiliar vs mayor: `Σ costos = saldo cuenta de activo fijo`,
  `Σ depreciación acumulada = saldo cuenta de depreciación acumulada`

## 5. Depreciación fiscal vs contable

En muchos países la tasa de depreciación fiscal difiere de la contable, y esa
diferencia genera **impuestos diferidos**.

Consecuencia de diseño: el activo lleva **dos cédulas de depreciación en
paralelo**, la corporativa (vida útil real, NIIF) y la fiscal (tasa del
reglamento del impuesto sobre la renta).

**Las dos generan asientos**, en un solo asiento mensual con las líneas marcadas
a su libro (D-11, [02 §3.1](02-contrato-asientos.md)). Antes de esa decisión
solo la contable llegaba al mayor y la fiscal vivía en una cédula aparte; ahora
la diferencia queda en el mayor corporativo, que es donde se puede auditar.

Añadir esto después es costoso: obliga a recalcular el histórico fiscal de todos
los activos. Ver **D-05** en
[12-decisiones-pendientes](12-decisiones-pendientes.md).

## 6. Reglas de mapeo contable

| Evento | Rol | Cuenta típica |
|---|---|---|
| `alta` | `activo` | Activo fijo, por categoría |
| `depreciacion` | `gasto` | Gasto por depreciación, por categoría |
| | `depreciacion_acumulada` | Depreciación acumulada, por categoría |
| `baja` | `perdida` | Pérdida en baja de activos |
| `venta` | `resultado` | Utilidad o pérdida en venta de activos |

El mapeo se resuelve **por categoría de activo**, no por activo individual.
