# 09 — Módulo `reportes`

El único módulo que **lee** del mayor y no escribe en él.

> **Corrección al diagrama de referencia:** en el boceto la flecha de `reportes`
> apunta hacia `conta`, igual que los demás módulos. Es al revés: reportes no
> genera asientos, los consume. Mantener esa dirección invertida en la
> implementación es lo que evita que reportes contamine el mayor.

## 1. Responsabilidades

- Estados financieros formales
- Reportes de gestión y análisis
- Exportaciones fiscales
- Motor de reportes configurables por el usuario

**No** hace: cálculos de negocio. Si un número requiere lógica, esa lógica vive
en el módulo dueño y reportes solo lo presenta. Esta frontera se degrada
fácilmente y hay que defenderla.

## 2. Acceso a datos

Reportes consulta `conta` por su API pública (saldos y movimientos) y a los
módulos subsidiarios por la suya (aging, inventario de activos, resumen de
nómina). **Nunca** consulta tablas de otro módulo directamente.

Para reportes pesados sobre volúmenes grandes, considerar réplica de lectura o
vistas materializadas. Es una decisión de infraestructura, no de arquitectura —
la interfaz no cambia.

## 3. Estados financieros

> **Todo reporte de este documento es de un libro.** Balanza, Balance General,
> Estado de Resultados y Flujo se emiten para la contabilidad fiscal o para la
> corporativa, nunca para las dos sumadas: sumar dos marcos contables daría un
> estado que no existe. El libro es un parámetro obligatorio del reporte, y debe
> quedar impreso en la cabecera del PDF. Ver
> [02 §3.1](02-contrato-asientos.md).
>
> La excepción es el **comparativo fiscal vs corporativo**, que los pone lado a
> lado con su diferencia por cuenta. Es el reporte que explica por qué la
> utilidad declarada no es la utilidad del negocio, y el insumo natural de la
> conciliación fiscal de la renta.

### 3.1 Balanza de comprobación

El reporte de control por excelencia. Por cuenta:

| Saldo inicial | Cargos | Abonos | Saldo final |
|---|---|---|---|

- Debe cuadrar: `Σ cargos = Σ abonos` y `Σ saldos deudores = Σ saldos acreedores`
- Si no cuadra, **hay un bug en el núcleo**. La balanza es la prueba diaria de
  que el sistema es correcto.
- Niveles: por cuenta de detalle, o consolidada por nivel jerárquico

### 3.2 Balance General / Estado de Situación Financiera

```
ACTIVO                          PASIVO
  Circulante                      Corto plazo
  No circulante                   Largo plazo
                                CAPITAL
                                  Contribuido
                                  Ganado (incluye resultado del ejercicio)
────────────────────────        ────────────────────────
Total activo              =     Total pasivo + capital
```

La clasificación circulante / no circulante se deriva del tipo y nivel de la
cuenta en el catálogo, configurable por plantilla.

Comparativos: contra el mismo periodo del año anterior, contra el cierre
anterior, con variación absoluta y porcentual.

### 3.3 Estado de Resultados

```
  Ingresos
− Costo de ventas
= Utilidad bruta
− Gastos de operación
= Utilidad de operación
± Resultado integral de financiamiento   (incluye diferencia cambiaria)
= Utilidad antes de impuestos
− Impuestos
= Utilidad neta
```

Dimensiones: consolidado, por centro de costo, por sucursal, por línea de
negocio. Comparativo contra periodo anterior y contra presupuesto.

### 3.4 Estado de Flujo de Efectivo

Por método indirecto (partiendo de la utilidad neta):

```
Actividades de operación
  Utilidad neta
  + Partidas que no requieren efectivo (depreciación, provisiones)
  ± Cambios en capital de trabajo (CxC, CxP, inventarios)
Actividades de inversión
  ± Compra y venta de activos fijos
Actividades de financiamiento
  ± Préstamos, aportaciones, dividendos
─────────────────
= Variación neta de efectivo
```

**Verificación:** la variación calculada debe ser exactamente igual a la
diferencia de saldos de las cuentas de efectivo entre inicio y fin del periodo.
Es el reporte más difícil de cuadrar y el que más revela errores de
clasificación en el catálogo de cuentas.

### 3.5 Estado de Cambios en el Capital Contable

Movimientos del periodo por cada cuenta de capital: saldo inicial, aportaciones,
resultado del ejercicio, dividendos, saldo final.

## 4. Reportes de gestión

- **Auxiliar de cuenta** — todos los movimientos de una cuenta en un rango, con
  drill-down hasta el documento origen en su módulo
- **Libro diario** — todas las asientos en orden cronológico
- **Libro mayor** — movimientos agrupados por cuenta
- **Comparativo mensual** — 12 columnas, una por mes, para detectar tendencias y
  anomalías
- **Análisis vertical y horizontal** — porcentajes sobre ventas o sobre activo
  total; variación entre periodos
- **Razones financieras** — liquidez, apalancamiento, rentabilidad, rotación
- **Presupuesto vs real** — requiere módulo de presupuestos (fuera del alcance
  inicial)

## 5. Drill-down

Cada cifra de un reporte debe poder rastrearse hasta su origen:

```
Estado de Resultados
  → renglón "Ventas"
    → cuentas que lo componen
      → movimientos del mayor
        → asiento
          → documento origen (factura en cxc)
```

Es lo que convierte un reporte en una herramienta de trabajo en lugar de una
foto. Y es lo que hace posible auditar el sistema.

## 6. Motor de reportes configurables

Los estados financieros formales no son suficientes: cada empresa quiere sus
propios agrupamientos. Un motor de plantillas permite definir:

```
PlantillaReporte
├── nombre / tipo
└── renglones[]
    ├── etiqueta
    ├── tipo            titulo | detalle | subtotal | formula | separador
    ├── cuentas[]       rangos o lista
    ├── formula         referencia a otros renglones: "R10 - R20"
    ├── signo           natural | invertido
    └── nivel_sangria
```

Con esto, el usuario define su Balance General o su Estado de Resultados sin
tocar código. Es una de las funciones que más diferencia a un sistema contable
usable de uno rígido.

## 7. Exportación

| Formato | Uso |
|---|---|
| PDF | Estados financieros formales, firmados |
| Excel | Análisis del usuario, con fórmulas vivas |
| CSV | Integración con terceros |
| XML / formato de la autoridad | Contabilidad electrónica, ver §8 |

## 8. Exportaciones fiscales

Depende del país. Habitualmente incluye catálogo de cuentas, balanza de
comprobación y detalle de asientos en el formato que exija la autoridad, con
periodicidad definida.

**Toda exportación a la autoridad sale del libro fiscal.** Que el selector de
libro pueda apuntar al corporativo no lo hace una opción aquí: en la exportación
el libro no se elige.

Se implementa tras la misma interfaz `LocalizacionFiscal` que usan CxC y CxP.
Ver [12-decisiones-pendientes](12-decisiones-pendientes.md).

## 9. Consideraciones de rendimiento

- Los reportes se sirven desde la tabla de saldos materializados, no sumando
  movimientos ([03-modulo-contabilidad §4](03-modulo-contabilidad.md#4-libro-mayor-y-saldos))
- Los reportes de periodos **cerrados** son inmutables y se pueden cachear
  indefinidamente
- Los reportes pesados se generan de forma asíncrona con notificación al terminar
- Todo reporte lleva su fecha y hora de generación impresa; sin eso, dos copias
  del mismo reporte con cifras distintas son imposibles de explicar
