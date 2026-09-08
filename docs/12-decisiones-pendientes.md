# 12 — Decisiones pendientes

Registro de decisiones. Las marcadas con ⚠️ son caras de cambiar después.

---

## D-01 ⚠️ Stack técnico

**Estado:** **frontend resuelto** — backend pendiente

### Frontend — resuelto: React + TypeScript + Vite

Detalle completo en [14-arquitectura-frontend](14-arquitectura-frontend.md).

Piezas: Vite · React 19 · TypeScript · React Router · TanStack Query ·
TanStack Table · React Hook Form + Zod · Tailwind CSS · **decimal.js** · MSW.

Se descartó Next.js: mezclaría frontend y backend en un proyecto, lo que choca
con la separación de módulos de [01-arquitectura](01-arquitectura.md), y un ERP
interno detrás de login no necesita SSR ni SEO.

Notas de la implementación:

- **TanStack Table fijado en v8.** La v9 es una reescritura con API distinta y
  entrada `./legacy` para compatibilidad; no vale la pena construir el
  `DataTable` del ERP sobre ella todavía.
- **Vitest usa el pool `threads`.** El pool `forks` por defecto no arranca de
  forma fiable en Windows con esta configuración.

### Backend — pendiente

Opciones consideradas:

| Opción | A favor | En contra |
|---|---|---|
| **NestJS + PostgreSQL + Prisma** | Estructura modular que encaja directamente con los siete módulos; TypeScript compartido con el frontend ya construido | Requiere disciplina con decimales: `Decimal` de Prisma, nunca `number` |
| **.NET + EF Core** | `decimal` nativo de primera clase, transacciones sólidas, fuerte en procesos batch | Se pierde el tipado compartido con el frontend |
| **Python + Django + DRF** | Excelente para reportes y procesamiento de datos, admin gratis | Tipado más débil; hay que forzar `DecimalField` en todo |

El frontend ya define el contrato ([`shared/api/contracts/`](../frontend/src/shared/api/contracts/)):
importes como **string**, nunca number. Cualquiera de las tres opciones debe
respetarlo.

**Consideraciones específicas de este proyecto**, independientes de preferencia:

- El manejo de **decimales de precisión fija** debe ser de primera clase. En
  TypeScript esto significa una librería (`decimal.js`, `big.js`) y disciplina
  para no dejar entrar un `number` por accidente.
- Se necesitan **transacciones de base de datos reales** con control explícito —
  el contrato de asientos depende de ello.
- Los procesos **batch** (depreciación, nómina, recálculo de saldos) requieren
  ejecución fuera del ciclo de petición HTTP.

**Pendiente de decidir.**

---

## D-02 ⚠️ Localización fiscal (país)

**Estado:** **resuelta — Costa Rica**

Detalle completo en [13-localizacion-costa-rica](13-localizacion-costa-rica.md).

Lo que determina:

- Formato y validación de identificaciones fiscales
- Catálogo de cuentas base
- Impuestos: tipos, tasas, reglas de acreditamiento
- Retenciones: qué, a quién, cuánto
- Facturación electrónica: si existe, formato, certificación, cancelación
- Recibo de nómina electrónico
- Cálculo de nómina completo (el más dependiente de todos)
- Exportación de contabilidad electrónica a la autoridad
- Declaraciones periódicas e informativas

**Decisión de diseño que acompaña a esta:** aunque solo se soporte Costa Rica,
todo lo fiscal se aísla tras una interfaz `LocalizacionFiscal`
([13 §8](13-localizacion-costa-rica.md#8-interfaz-localizacionfiscal)). El costo
es bajo y evita que las reglas fiscales se filtren por el código de CxC, CxP, RH
y reportes.

En el frontend esto ya está aplicado: `shared/fiscal/` concentra validación de
cédulas y cálculo de IVA; ningún módulo contiene una condición por país.

**Riesgo asumido y registrado:** las tarifas de IVA, las cuotas de la CCSS y la
versión del formato de comprobantes electrónicos cambian por resolución. Todo
valor de ese tipo va en tablas con vigencia por fecha, resueltas por la fecha del
documento — nunca escritas en código. Los valores del doc 13 llevan ⚠️ donde hay
que confirmarlos contra la fuente oficial antes de implementar.

---

## D-03 Modelo de tenancy

**Estado:** **resuelta — shared schema con `empresa_id`; construido en el frontend**

| Opción | A favor | En contra |
|---|---|---|
| Shared schema con `empresa_id` | Simple, barato, migraciones únicas | Riesgo de fuga entre empresas si falta un filtro |
| Schema por empresa | Aislamiento fuerte | Migraciones N veces, más operación |
| Base de datos por empresa | Aislamiento total | Costoso, complejo de operar |

**Decisión:** shared schema con `empresa_id`, con el filtro aplicado
obligatoriamente en la capa de repositorio (no en cada consulta a mano) y una
prueba automática que verifique que ninguna consulta puede omitirlo.

Lo que ya existe, del lado del cliente y del servidor simulado:

- La empresa abierta viaja en la cabecera `X-Empresa-Id` de **toda** petición.
  La pone la base de los servicios, no cada llamada, así que no hay forma de
  olvidarla en una operación nueva.
- El mock la exige con una guardia delante de todos los handlers: sin cabecera
  contesta `EMPRESA_REQUERIDA` (400); con una empresa distinta de la abierta,
  `EMPRESA_INCORRECTA` (409). Hay una prueba para cada caso.
- El almacén local guarda cada colección bajo el espacio de nombres de su
  empresa y recarga todas al cambiar ([14 §2.2](14-arquitectura-frontend.md)).
- Catálogo de empresas en `Configuración → Empresas`: alta, edición,
  activar y desactivar (nunca la abierta), y abrir. Selector en la barra
  superior. Una empresa nueva nace con los catálogos de plantilla y vacía.

Lo que hereda el backend: el mismo contrato (`/empresas`, cabecera, códigos de
error) y la obligación de que el filtro viva en el repositorio. Autenticación,
`UsuarioEmpresa` y rol por empresa siguen en Fase 0.

---

## D-04 ⚠️ Clasificación y nombre del asiento

**Estado:** **resuelta — consecutivo único, y se llama "asiento"**

### Se quita la clasificación ingreso / egreso / diario

Era una convención **mexicana**: el SAT la exige en su contabilidad electrónica,
con un consecutivo independiente por tipo. **Costa Rica no la pide** — Hacienda
regula los comprobantes electrónicos (facturas), no el formato del registro
contable interno, y el marco NIIF no impone numeración.

Se adopta un **consecutivo único por empresa y ejercicio**.

| | Con clasificación | Sin clasificación |
|---|---|---|
| Secuencias a mantener sin huecos | 3 | 1 |
| Decisión del usuario al capturar | Elegir tipo, a veces ambiguo | Ninguna |
| Identificador del asiento | `EGR-00002` | `00002` |

La ambigüedad no es teórica: un pago que incluye comisión bancaria, o un cobro en
efectivo que no pasa por banco, admiten más de una clasificación razonable. Y el
filtrado por naturaleza del movimiento se resuelve mejor por cuenta o por módulo
origen, que es más preciso.

**Costo de revertir:** si algún cliente la pidiera, añadirla obliga a renumerar el
histórico. Se asume el riesgo: es una convención de otro país y no hay motivo
para cargar con ella.

### El registro se llama "asiento", no "póliza"

En Costa Rica **una póliza es un seguro** — póliza del INS, póliza de riesgos del
trabajo (ver [13 §6.1](13-localizacion-costa-rica.md#61-cargas-sociales-)).
`Póliza` como sinónimo de asiento contable es terminología mexicana.

El término correcto es **asiento contable** (o *asiento de diario*), que además
ya era el que usaba [02-contrato-asientos](02-contrato-asientos.md) y la función
`validarAsiento`.

Aplicado en toda la documentación y en el código: `Asiento`, `LineaAsiento`,
`useAsientos`, ruta `/conta/asientos`.

---

## D-05 ⚠️ Depreciación fiscal paralela

**Estado:** **resuelta por D-11 — sí, dos cédulas**

El sistema lleva dos contabilidades (D-11), así que la pregunta ya no es si el
activo puede tener dos tasas: la respuesta es que las dos llegan al mayor, cada
una a su libro, en un solo asiento mensual.

Lo que queda por decidir en Fase 6 es de dónde sale la tasa fiscal: un campo por
categoría de activo (`tasa_fiscal`, ya previsto en el modelo) o una tabla de
tasas por tipo de bien mantenida en la localización.

Ver [07-modulo-activos §5](07-modulo-activos.md#5-depreciación-fiscal-vs-contable).

---

## D-06 Nómina propia vs proveedor externo

**Estado:** abierta — resolver antes de Fase 7

Calcular la nómina internamente implica mantener tablas fiscales y de seguridad
social de forma permanente, con responsabilidad legal si hay un error.

**Recomendación:** salvo que la nómina sea el diferenciador del producto,
integrarse con un proveedor local y quedarse solo con la contabilización, las
provisiones y los reportes. El módulo RH sigue existiendo; solo delega el
cálculo.

Ver [08-modulo-rh §1](08-modulo-rh.md#1-advertencia-de-alcance).

---

## D-07 Componentes de activo

**Estado:** abierta — resolver antes de Fase 6

¿Un activo puede depreciarse por partes con vidas útiles distintas?

Si no se necesita ahora, modelar el activo con un componente implícito
(estructura preparada, una sola fila). Añadirlo después obliga a migrar todo el
histórico de depreciación.

---

## D-08 Órdenes de compra y three-way match

**Estado:** abierta — resolver en Fase 3

¿Se implementa el ciclo completo de compras o se capturan facturas directamente?

Es aditivo: se puede diferir sin costo de rediseño, siempre que `FacturaProveedor`
lleve desde el inicio el campo `orden_compra_id` nullable.

**Recomendación:** diferir. Dejar el campo.

---

## D-09 Motor de reportes configurables

**Estado:** abierta — resolver en Fase 5

¿Se implementa el motor de plantillas o se codifican los estados financieros?

Codificarlos es más rápido al inicio, pero cada empresa querrá su propio
agrupamiento y se termina con condicionales por cliente dentro del código de
reportes.

**Recomendación:** codificar los estados financieros estándar en la primera
entrega, y construir el motor de plantillas antes de tener el segundo cliente
con requisitos distintos.

---

## D-10 Separación en servicios

**Estado:** cerrada — **monolito modular**

El contrato de asientos (§8 de [02](02-contrato-asientos.md)) asume transacción
compartida entre el módulo y `conta`. Eso requiere una sola base de datos.

Se descarta microservicios en esta etapa: la consistencia transaccional de la
contabilidad vale más que la independencia de despliegue, y el volumen esperado
no la justifica.

Si en el futuro se separa, hay que sustituir la transacción compartida por
outbox pattern y aceptar consistencia eventual, con el proceso de conciliación
auxiliar-mayor como red de seguridad. **El diseño modular actual hace esa
migración posible sin rediseñar el dominio** — que es precisamente por qué se
mantienen los límites estrictos entre módulos aunque hoy compartan proceso.

---

## D-11 ⚠️ Doble contabilidad: fiscal y corporativa

**Estado:** **resuelta — un asiento, dos libros**

### El problema

La contabilidad que se declara ante Hacienda y la que sirve para dirigir la
empresa no coinciden. La depreciación se calcula con la tasa del reglamento en
una y con la vida útil real en la otra; las provisiones de vacaciones y cesantía
se devengan bajo NIIF y se deducen al pagarse; la estimación de incobrables
tiene un tope fiscal que no tiene nada que ver con la pérdida esperada.

Llevarlo en dos sistemas es la práctica común y es la peor opción: los mismos
datos capturados dos veces, divergiendo desde el primer mes.

### Alternativas consideradas

| Opción | A favor | En contra |
|---|---|---|
| **Un asiento, líneas por libro** | Una sola captura; un consecutivo; la diferencia queda explícita y auditable en el mismo documento | La línea gana un campo y el cuadre pasa a ser por libro |
| Dos asientos enlazados | Cada libro es independiente de verdad | Dos numeraciones, dos reversas, dos cierres; el enlace se rompe en cuanto alguien reversa uno solo |
| Libro base + asientos de ajuste | Menos duplicación de líneas | El libro corporativo no existe por sí mismo: hay que recomponerlo siempre; imposible de auditar de un vistazo |

### Decisión

**Un asiento, dos libros.** Cada línea declara a qué libros afecta y **por
omisión afecta a los dos**. El asiento cuadra por libro. Contrato completo en
[02-contrato-asientos §3.1](02-contrato-asientos.md).

Que el valor por omisión sea "ambos" es la mitad de la decisión: hace que los
cinco módulos subsidiarios sigan contabilizando como si el segundo libro no
existiera, y que solo quien tiene una diferencia real que declarar tenga que
saber de esto.

### Por qué antes y no después

Es de las caras. Un mayor único no se convierte en doble sin reclasificar todo
el histórico movimiento por movimiento, con criterios que a los dos años ya
nadie recuerda. El campo cuesta poco hoy y no se puede improvisar mañana.

### Lo que NO habilita

Marcar una línea a un solo libro sirve para diferencias de **reconocimiento o
medición** entre dos marcos contables. No es un mecanismo para dejar
operaciones fuera de la contabilidad fiscal: un gasto no deducible entra en los
dos libros y se ajusta en la conciliación de la renta. Las exportaciones a
Hacienda salen siempre del libro fiscal
([09 §8](09-modulo-reportes.md#8-exportaciones-fiscales)).

---

## D-12 Catálogos de terceros en multiempresa

**Estado:** **resuelta — catálogos por empresa, identidad compartida por lectura**

### El problema

Con varias empresas en el grupo, ¿los clientes y proveedores son de cada
empresa o del grupo? El mismo despacho contable factura a las dos empresas;
un cliente grande compra a las dos. Teclear su cédula dos veces es trabajo
repetido y una fuente de errores (una cédula bien en una empresa y mal en la
otra). Pero el límite de crédito, los días de pago, la retención que se le
aplica, la cuenta contable y, sobre todo, el saldo, son distintos en cada
empresa y no pueden compartirse.

### Alternativas consideradas

| Opción | A favor | En contra |
|---|---|---|
| **Catálogos por empresa, identidad compartida por lectura** | Cumple docs/01 §4.1 al pie de la letra: nada se escribe a nivel de grupo. Cada empresa fija sus condiciones. El directorio evita reteclear la cédula | La razón social de un mismo tercero puede divergir entre empresas si alguien la edita en una sola |
| Catálogos por empresa, aislados del todo | El más simple | Todo tercero común se captura N veces; nada avisa de que ya existe en otra empresa |
| Catálogo del grupo con saldo por empresa | Una sola alta | Mezcla identidad con relación: el código, el crédito, la retención y la cuenta no son del tercero sino de cada empresa con él. Desactivar en una afecta a todas. Rompe el filtro por `empresa_id` del repositorio |
| Tabla `Tercero` del grupo + `Cliente`/`Proveedor` por empresa con `tercero_id` | Modelo más normalizado | Dos entidades donde hoy hay una, en cada pantalla y cada contrato; la relación es la que se factura, y es la que hoy existe. Es la evolución natural de la primera opción si hiciera falta, no un punto de partida |

### Decisión

**Los clientes y proveedores son de cada empresa.** Se guardan, se validan y
se listan por empresa, con su código, su crédito, su retención, su cuenta y su
saldo. Una empresa nueva arranca sin ninguno.

**La identidad se comparte por lectura, nunca por escritura**, a través del
**directorio de terceros del grupo**: una vista derivada de los clientes y
proveedores de todas las empresas activas, agrupada por tipo y número de
identificación, que dice quién es cada tercero y en qué empresas aparece con
qué papel y con qué código. Al dar de alta un cliente o un proveedor se puede
buscar en él y tomar la identificación, la razón social y el contacto. Lo
demás, las condiciones, se captura en la empresa que lo da de alta. Un tercero
que ya es cliente de la empresa abierta se enseña pero no se ofrece: el alta
fallaría por identificación duplicada, y es mejor decirlo antes.

Nada se guarda a nivel de grupo. Si el backend un día materializa `Tercero`
como tabla, el directorio es el endpoint donde encaja, y ninguna pantalla
cambia.

### Lo que NO habilita

- No sincroniza. Cambiar la razón social en una empresa no la cambia en las
  demás. El directorio enseña la primera que la conoció.
- No consolida saldos. Cuánto le debe el grupo entero a un proveedor es una
  pregunta de la consolidación multiempresa (Fase 8), no del directorio.
- No comparte productos ni cuentas. El catálogo de productos es de cada
  empresa igual que el de cuentas: dos empresas del grupo venden cosas
  distintas a precios distintos.

---

## D-10 Fuente del tipo de cambio

**Estado:** **resuelta — API de indicadores del Ministerio de Hacienda**

Detalle completo en [13-localizacion-costa-rica §7](13-localizacion-costa-rica.md).

Quien fija el tipo de cambio de referencia es el BCCR. Se toma de los endpoints
abiertos de Hacienda, que lo republican, porque no exigen llave ni registro y
devuelven compra y venta del dólar en una sola llamada.

Lo que se acepta al elegirlos:

- **No dan serie histórica.** Solo la publicación vigente. La tabla `TipoCambio`
  se puebla capturando día a día. El día que haga falta historia (revaluación
  retroactiva, reproceso de un cierre) hay que ir al servicio de indicadores
  económicos del BCCR, que sí la expone
- **Del euro no publican compra.** Se deriva de la compra del dólar por la
  paridad que la propia fuente da, y el par queda marcado como derivado para que
  nadie lo confunda con un dato oficial

Es una decisión barata de cambiar: la fuente entra por un solo sitio
(`obtenerTipoCambio` de la interfaz de [13 §8](13-localizacion-costa-rica.md)) y
ningún módulo la conoce.
