# 01 — Arquitectura

## 1. Forma general

Hub-and-spoke. Un núcleo contable, seis módulos alrededor.

```
        RH            reportes
          \             ^
           v            |  (lee)
activos --> [ CONTA ] <-- cxp
           ^        ^
          /          \
      bancos         cxc
```

- **Escriben en `conta`:** RH, activos, bancos, cxc, cxp
- **Lee de `conta`:** reportes
- **`conta` no llama a nadie.** Es una dependencia, no un orquestador.

## 2. Regla de dependencias

```
reportes  ──lee──►  conta  ◄──escribe──  módulos subsidiarios
```

Tres reglas que no se rompen:

1. **Un módulo nunca lee las tablas de otro módulo.** Si CxC necesita saber si
   una factura fue cobrada, no consulta `bancos.movimiento`; el módulo de bancos
   le notifica el cobro por el canal de aplicación de pagos.
2. **Un módulo nunca escribe en `mayor` ni en `asiento`.** Solo emite un asiento
   por el contrato del §2 de [02-contrato-asientos](02-contrato-asientos.md).
3. **`conta` no importa código de ningún módulo.** No conoce el concepto de
   "factura", "empleado" ni "activo". Solo conoce cuentas, cargos y abonos.

Esto es lo que permite añadir un módulo nuevo sin refactorizar el núcleo.

## 3. Capas dentro de cada módulo

Cada módulo tiene la misma estructura interna:

| Capa | Responsabilidad |
|---|---|
| **Dominio** | Entidades y reglas de negocio puras. Sin BD, sin HTTP. Aquí vive "una factura no puede tener importe negativo" y "un asiento debe cuadrar". |
| **Aplicación** | Casos de uso. Orquesta dominio + repositorios + emisión de asientos. Aquí vive "timbrar factura" o "correr depreciación del mes". |
| **Infraestructura** | Repositorios, acceso a BD, clientes de servicios externos (PAC, banco, correo). |
| **Interfaz** | API HTTP / UI. Traduce peticiones a casos de uso. |

La regla de dependencia dentro del módulo apunta hacia adentro: infraestructura
e interfaz dependen de aplicación, aplicación depende de dominio, dominio no
depende de nada.

## 4. Conceptos transversales

Estos atraviesan todos los módulos y hay que resolverlos **antes** de escribir el
primer módulo, porque retrofitear cualquiera de ellos es caro.

### 4.1 Multiempresa (tenancy)

Toda entidad transaccional lleva `empresa_id`. Un usuario puede tener acceso a
varias empresas; los datos jamás se cruzan entre ellas.

Resuelto en [12 D-03](12-decisiones-pendientes.md#d-03-modelo-de-tenancy):
shared schema con `empresa_id` y filtro obligatorio en el repositorio. En el
frontend ya está construido: la empresa abierta viaja en la cabecera
`X-Empresa-Id` de toda petición, el servidor simulado rechaza la que no la
trae, y cambiar de empresa descarta todo lo cargado de la anterior
([14 §2.2](14-arquitectura-frontend.md)).

**Qué es de cada empresa y qué es del grupo.** Casi todo es de la empresa: el
catálogo de cuentas, las monedas y la funcional, los periodos, los clientes,
los proveedores, los productos, los activos y el mayor. Una empresa nueva
arranca con los catálogos de plantilla y sin un solo documento. Del grupo solo
es el catálogo de empresas (y, cuando exista, el de usuarios).

Los clientes y proveedores son deliberadamente **por empresa**: la relación
comercial (código, crédito, retención, cuenta, saldo) es de cada una. Lo único
que se comparte es la identidad del tercero, y se comparte por lectura, a
través del directorio del grupo
([12 D-12](12-decisiones-pendientes.md#d-12-catálogos-de-terceros-en-multiempresa)).

### 4.2 Multimoneda

Tres monedas conviven en cada transacción:

- **Moneda de la transacción** — en la que se emitió el documento
- **Moneda funcional** — en la que la empresa lleva su contabilidad
- **Tipo de cambio** — el del día de la operación, congelado en el asiento

El libro mayor se lleva **siempre en moneda funcional**. Cada línea de asiento
guarda además el importe original y la moneda, para poder revaluar.

La **diferencia cambiaria** (realizada al cobrar/pagar, no realizada al cierre)
se calcula en el módulo subsidiario y se envía como líneas adicionales del
asiento.

### 4.3 Periodos contables

Un periodo (normalmente mes) tiene estados: `abierto` → `cerrado` → `bloqueado`.
Ningún módulo puede contabilizar en un periodo cerrado. La validación vive en
`conta` y es la última línea de defensa: el módulo debe verificarla antes, pero
`conta` la rechaza igual.

### 4.4 Auditoría

Nada se borra. Nada se edita después de contabilizado.

- Corrección de un documento contabilizado = **asiento de reversa** + documento nuevo
- Toda tabla transaccional lleva `creado_por`, `creado_en`, `modificado_por`, `modificado_en`
- Bitácora inmutable de eventos: quién, qué, cuándo, valor anterior y nuevo

Esto no es opcional en software contable; es requisito de cualquier auditoría
fiscal.

### 4.5 Doble libro: fiscal y corporativa

La empresa lleva dos contabilidades sobre el mismo catálogo de cuentas: la
**fiscal**, que se declara ante Hacienda, y la **corporativa**, que sigue NIIF y
mide el negocio.

No son dos sistemas ni dos juegos de asientos. Es **un asiento cuyas líneas
declaran a qué libros van**, y por omisión van a los dos. Lo que se separa es el
mayor: cada libro acumula sus saldos y produce sus propios estados financieros.

Esto es transversal y caro de retrofitear: cambiar un mayor de único a doble
obliga a reclasificar todo el histórico, con criterios que ya nadie recuerda.
Ver [02-contrato-asientos §3.1](02-contrato-asientos.md) y **D-11** en
[12-decisiones](12-decisiones-pendientes.md).

### 4.6 Idempotencia

Cada asiento lleva una clave de origen única (`origen_modulo` + `origen_tipo` +
`origen_id`). Reintentar la contabilización del mismo documento **no** genera un
segundo asiento. Ver §4 del contrato.

## 5. Comunicación entre módulos

Dos canales, y solo dos:

### 5.1 Contabilización (síncrona, transaccional)

El módulo llama al servicio de asientos de `conta` dentro de la misma
transacción de base de datos que su propio documento. O se guardan ambos, o
ninguno. Esto evita el escenario clásico de "factura existe pero no está
contabilizada".

### 5.2 Eventos de dominio (asíncrona, entre subsidiarios)

Para lo que no es contabilización. Ejemplo: bancos publica `PagoAplicado`, y CxP
lo consume para marcar la factura del proveedor como pagada.

Los eventos son **hechos pasados**, nunca órdenes. `FacturaEmitida`, no
`EmitirFactura`.

## 6. Conciliación de auxiliares con el mayor

Cada módulo subsidiario mantiene un auxiliar (subledger) que **debe** cuadrar
contra su cuenta de control en el mayor:

| Módulo | Auxiliar | Cuenta de control |
|---|---|---|
| CxC | Saldos por cliente | Clientes |
| CxP | Saldos por proveedor | Proveedores |
| Bancos | Saldo por cuenta bancaria | Bancos |
| Activos | Costo y depreciación acumulada por activo | Activo fijo / Dep. acumulada |
| RH | Saldos por empleado | Sueldos por pagar |

La conciliación se hace contra el **libro fiscal**: el saldo de un cliente es lo
que debe, y eso no cambia según el marco contable (§4.5).

Un proceso de verificación compara auxiliar vs mayor por periodo y reporta
diferencias. Si algo se descuadró, hay un bug y hay que saberlo el mismo día,
no en el cierre anual.

## 7. Seguridad y permisos

- **RBAC por empresa.** El rol se asigna por empresa, no global.
- **Segregación de funciones.** Quien captura una factura no debería ser quien la
  autoriza ni quien emite el pago. El sistema debe permitir configurarlo.
- **Datos sensibles.** Nómina (sueldos) y datos personales de empleados exigen
  permisos más estrictos que el resto. RH es el módulo con el control de acceso
  más restrictivo.
