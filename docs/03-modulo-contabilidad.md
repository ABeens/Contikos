# 03 — Módulo `conta` (Contabilidad General)

El hub. Es el único módulo que escribe en el libro mayor y el único que no
depende de ningún otro.

## 1. Responsabilidades

- Catálogo de cuentas
- Catálogos de presentación: clasificación NIIF y notas a los estados financieros
- Recepción y validación de asientos (contrato [02](02-contrato-asientos.md))
- Libro mayor y saldos
- Periodos contables: apertura, cierre, bloqueo
- Cierre de ejercicio
- Centros de costo
- Configuración de moneda funcional y tipos de cambio

**No** hace: facturas, pagos, empleados, activos, reportes financieros
formateados. Esos son de otros módulos.

## 2. Catálogo de cuentas

Estructura jerárquica. Las cuentas **acumulativas** agrupan; solo las de
**detalle** reciben movimientos.

```
Cuenta
├── codigo              "1120-001"
├── nombre              "Clientes nacionales"
├── cuenta_padre        nullable
├── nivel               derivado de la jerarquía
├── naturaleza          "deudora" | "acreedora"
├── tipo                "activo" | "pasivo" | "capital" | "ingreso" | "costo" | "gasto" | "orden"
├── es_detalle          solo estas reciben movimientos
├── requiere_auxiliar   nullable: "cliente" | "proveedor" | "empleado" | "activo" | "banco"
├── moneda              nullable: si la cuenta es de moneda extranjera
├── clasificacion_niif  renglón del estado financiero (§2 bis); obligatorio si es_detalle
├── nota_eeff           nota que la desglosa; obligatoria y siempre de esa clasificación
├── activa              baja lógica; nunca se borra una cuenta con movimientos
└── empresa_id
```

Reglas:

- No se puede desactivar una cuenta con saldo distinto de cero
- No se puede convertir una cuenta de detalle en acumulativa si tiene movimientos
- El código debe respetar la jerarquía del padre
- Una cuenta de detalle no se da de alta sin su clasificación NIIF y su nota
  (§2 bis). Se capturan en la misma pantalla que el resto de la cuenta
- `requiere_auxiliar` fuerza que todo movimiento traiga el auxiliar → esto es lo
  que hace posible la conciliación auxiliar-mayor

### Cuentas de control

Las cuentas marcadas como **de control** solo se mueven desde su módulo dueño.
Nadie captura una asiento manual contra "Clientes"; si lo hiciera, el auxiliar de
CxC dejaría de cuadrar contra el mayor. El sistema lo bloquea.

| Cuenta de control | Módulo dueño |
|---|---|
| Clientes | cxc |
| Proveedores | cxp |
| Bancos | bancos |
| Activo fijo / Depreciación acumulada | activos |
| Sueldos y prestaciones por pagar | rh |

## 2 bis. Clasificación NIIF y notas a los EEFF

Dos catálogos encadenados, uno subcategoría del otro. El catálogo de cuentas
responde **dónde se registra** un movimiento; estos responden **dónde se
presenta**. Son preguntas distintas: dos empresas pueden numerar sus cuentas
como quieran y publicar el mismo Estado de Situación Financiera.

```
ClasificacionNiif                         ← el renglón del estado financiero
├── codigo                 "A.01"
├── nombre                 "Efectivo y equivalentes al efectivo"
├── estado_financiero      situacion | resultados | patrimonio | flujos
├── tipos_cuenta[]         qué tipos de cuenta admite
├── seccion_niif           "Sección 7", referencia y no llave
├── orden                  posición dentro de su estado financiero
└── activa
    │
    └── NotaEeff                          ← el desglose de ese renglón
        ├── clasificacion_niif_id         obligatorio: la nota es subcategoría
        ├── numero                        corrido sobre TODO el catálogo
        ├── literal                       subdivide el número: 1a, 1b; vacío si no
        ├── titulo
        ├── descripcion                   qué revela, no los importes
        └── activa
```

La cuenta gana dos campos, `clasificacion_niif_id` y `nota_eeff_id`.

### Los dos son obligatorios en la cuenta de detalle

Y por la misma razón por la que no lo son en la acumulativa. Una cuenta de
detalle sin renglón registra movimientos en el mayor que no suman en ningún
estado financiero, y sin nota no se explica en ninguno: el saldo existe, el
reporte no lo enseña y **la balanza sigue cuadrando**, así que el hueco no lo
delata nada hasta que alguien compara el balance contra el mayor. Es el peor
tipo de dato faltante, el que no rompe nada.

La consecuencia práctica es que la presentación se captura en el alta de la
cuenta, no después. Reclasificar sigue siendo otra decisión y tiene su propio
endpoint, pero es un cambio, no un relleno: **desde ahí se cambia la
presentación de una cuenta, nunca se le quita.**

Y una consecuencia sobre el catálogo de presentación: un renglón sin ninguna
nota activa no admite cuentas, porque no habría nota que asignarles. La pantalla
no lo ofrece y la regla lo dice con ese nombre — el arreglo es crear la nota, no
elegir otra.

En la acumulativa los dos campos van vacíos, y no por omisión: presenta lo que
suman sus hijas, y darle renglón propio contaría esos saldos dos veces.

### Por qué la nota cuelga de una clasificación

Porque una nota desglosa **un** renglón. Si una nota pudiera reunir cuentas de
renglones distintos, su desglose no cuadraría contra ningún importe presentado, y
la nota deja de servir para lo único que sirve: explicar una cifra del cuerpo del
estado financiero.

De ahí las reglas del enlace:

- Solo se clasifican cuentas **de detalle**. Las acumulativas presentan lo que
  suman sus hijas; clasificarlas también duplicaría el saldo en el renglón.
- El tipo de la cuenta tiene que estar entre los `tipos_cuenta` de la
  clasificación. Casi siempre es uno solo; son varios cuando el renglón se
  presenta neto (`Diferencias de cambio, netas` reúne cuentas de ingreso y de
  gasto).
- La nota asignada tiene que pertenecer a la clasificación asignada.
- Sin clasificación no hay nota: la nota es la subcategoría, no una etiqueta
  suelta.

### Numeración de las notas

Corrida sobre todo el catálogo, no por clasificación. En el cuerpo del estado
financiero "véase Nota 7" tiene que apuntar a una sola nota. Eliminar una nota no
renumera las demás: renumerar cambiaría las referencias de los estados
financieros ya emitidos.

La nota se cita por su **referencia**, que es el número y su literal juntos: `7`,
`1a`, `16b`. El literal subdivide un número cuando un renglón se explica en
varios cuadros (1a el efectivo en caja, 1b el que está en bancos) sin renumerar
lo que viene detrás. Lo que no se puede repetir es la referencia completa: el
número sí, siempre que el literal distinga las notas. Se guarda en minúscula,
son una o dos letras, y va vacío en la nota que no se subdivide.

**Las notas narrativas no viven en este catálogo.** Información general, bases de
preparación y políticas contables no desglosan saldos ni clasifican cuentas: son
texto del reporte.

### Baja

Igual que el resto de los catálogos: se desactiva, no se borra.

| Intento | Resultado |
|---|---|
| Eliminar una clasificación con cuentas | Rechazado: desactívela |
| Eliminar una clasificación con notas | Rechazado: mueva o elimine las notas |
| Desactivar una clasificación con cuentas | Rechazado: reclasifíquelas antes |
| Quitar un `tipo_cuenta` que ya tiene cuentas | Rechazado: reclasifíquelas antes |
| Dos notas con la misma referencia (`1a`) | Rechazado: el número se repite, la referencia no |
| Eliminar o desactivar una nota con cuentas | Rechazado: desactívela / vacíela |
| Mover de clasificación una nota con cuentas | Rechazado: vacíela antes |
| Alta de una cuenta de detalle sin renglón o sin nota | Rechazado: las dos son obligatorias |
| Quitarle el renglón o la nota a una cuenta de detalle | Rechazado: se cambia, no se vacía |
| Clasificar en un renglón que no tiene notas activas | Rechazado: cree antes la nota que lo desglosa |
| Renglón o nota en una cuenta acumulativa | Rechazado: presenta lo que suman sus hijas |

Costa Rica no impone un catálogo de presentación, igual que no impone uno de
cuentas ([13 §1.1](13-localizacion-costa-rica.md)). La plantilla que trae el
sistema es un arranque razonable bajo NIIF para PYMES; la empresa la ajusta.

Es el módulo de reportes ([09](09-modulo-reportes.md)) el que consume estos dos
catálogos para armar los estados financieros. `conta` solo los administra.

## 3. Asientos

**Consecutivo único por empresa y ejercicio.**

No se clasifica el asiento en ingreso / egreso / diario. Esa es una convención
**mexicana**, exigida por el SAT en su contabilidad electrónica; Costa Rica no la
pide. Aquí el marco es NIIF, que regula el contenido de los estados financieros,
no el formato del registro contable interno. Ver **D-04** en
[12-decisiones](12-decisiones-pendientes.md).

Lo que se gana al no clasificar: quien captura no tiene que decidir un tipo en
cada asiento —una decisión ambigua con frecuencia, como un pago que incluye
comisión bancaria—, y hay una sola secuencia que mantener sin huecos en lugar de
tres.

```
Asiento
├── id
├── empresa_id
├── numero              consecutivo por empresa + ejercicio
├── fecha               define el periodo
├── concepto
├── origen_modulo       null si es captura manual
├── origen_tipo
├── origen_id
├── moneda / tipo_cambio
├── estado              contabilizado | reversado
├── reversa_de          nullable
└── lineas[]
    └── libros[]        fiscal | corporativo; por omisión, los dos
```

**El consecutivo es uno solo para los dos libros.** No existe "el asiento fiscal
120" y "el corporativo 98" del mismo hecho: existe el asiento 120, que alimenta
a los dos. Numerar por libro obligaría a mantener dos secuencias sin huecos y a
explicar en una auditoría por qué el mismo pago tiene dos números.

**El consecutivo no tiene huecos.** Si un asiento se cancela, se reversa; el
número no se reutiliza ni se salta.

> **Sobre el término.** En Costa Rica se dice *asiento contable* (o *asiento de
> diario*). **No** se dice *póliza*: aquí una póliza es un seguro — póliza del
> INS, póliza de riesgos del trabajo. `Póliza` como sinónimo de asiento es
> terminología mexicana y no se usa en este proyecto.

### Asiento manual

El usuario puede capturar asientos directamente (ajustes, reclasificaciones,
asientos de auditor). Pasan por **las mismas validaciones** del contrato, más:

- No pueden mover cuentas de control (§2)
- Requieren permiso específico
- Quedan marcadas como manuales para el auditor

## 4. Libro mayor y saldos

El mayor es la agregación de líneas de asiento por cuenta, periodo **y libro**.

Una línea marcada solo como corporativa no existe para el mayor fiscal. Es el
único punto donde las dos contabilidades se separan: catálogo, periodos,
auxiliares y consecutivo son comunes ([02 §3.1](02-contrato-asientos.md)).

**Decisión de diseño:** los saldos se materializan en una tabla de saldos por
`(cuenta, periodo, auxiliar, centro_costo)` en lugar de calcularse sumando el
detalle en cada consulta. Calcular al vuelo es correcto pero se degrada a los
pocos millones de movimientos, y los reportes financieros consultan esto
constantemente.

```
SaldoCuenta
├── empresa_id
├── cuenta
├── periodo
├── libro               fiscal | corporativo
├── auxiliar            nullable
├── centro_costo        nullable
├── saldo_inicial
├── cargos              del periodo
├── abonos              del periodo
└── saldo_final         inicial + cargos - abonos (según naturaleza)
```

Se actualiza en la misma transacción del asiento. Debe existir un proceso de
**recálculo desde el detalle** para reparar cualquier inconsistencia — y una
verificación periódica que compare ambos.

## 5. Periodos

```
Periodo
├── empresa_id
├── ejercicio           2026
├── numero              1..12 (+13 de ajustes, opcional)
├── fecha_inicio / fecha_fin
└── estado              abierto | cerrado | bloqueado
```

- **abierto** — acepta asientos
- **cerrado** — no acepta asientos; reabrible con permiso de administrador
- **bloqueado** — no acepta asientos; **no** reabrible. Se usa tras presentar
  declaraciones fiscales o cerrar el ejercicio.

### Checklist de cierre mensual

El cierre no es solo cambiar un estado. Antes de permitirlo, el sistema verifica:

1. Todos los documentos de todos los módulos están contabilizados o en borrador
   (nada "validado" pendiente)
2. Los auxiliares cuadran contra sus cuentas de control
3. La depreciación del mes corrió
4. La nómina del mes está contabilizada
5. Las cuentas bancarias están conciliadas
6. La revaluación de saldos en moneda extranjera corrió

Cada punto se muestra como semáforo. El cierre con excepciones requiere
autorización explícita y queda registrado.

## 6. Cierre de ejercicio

Al cerrar el año:

1. Se saldan las cuentas de resultados (ingresos, costos, gastos) contra una
   cuenta de resultado del ejercicio
2. El resultado se traspasa a capital
3. Se genera el asiento de apertura del ejercicio siguiente con los saldos de
   balance
4. Los periodos del ejercicio pasan a `bloqueado`

El asiento de cierre es un asiento normal, con `origen.modulo = "conta"` y
`origen.tipo = "cierre_ejercicio"`.

## 7. Tipos de cambio

Tabla por `(moneda, fecha, tipo)` donde tipo distingue el uso —
publicación oficial, compra, venta. La fuente (banco central, API, captura
manual) es configuración.

El tipo de cambio usado en un asiento se **congela** en la asiento. Si después se
corrige la tabla de tipos de cambio, los asientos históricos no cambian.

## 8. Superficie pública del módulo

Lo único que otros módulos pueden invocar:

| Operación | Quién la usa |
|---|---|
| `contabilizar(SolicitudDeAsiento)` | Todos los subsidiarios |
| `reversar(asiento_id, fecha, motivo)` | Todos los subsidiarios |
| `periodoEstaAbierto(fecha)` | Validación previa en subsidiarios |
| `obtenerCuenta(codigo)` | Configuración de mapeos |
| `consultarSaldos(filtros)` | Solo reportes |
| `consultarMovimientos(filtros)` | Solo reportes |

Todo lo demás es interno.
