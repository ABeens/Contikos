# 14 — Arquitectura del frontend

Resuelve la parte de **D-01** correspondiente al cliente: **React**.

## 1. Stack

| Pieza | Elección | Por qué |
|---|---|---|
| Build | **Vite** | Arranque instantáneo, sin acoplar el frontend a un backend |
| UI | **React 19 + TypeScript** | Decidido por el usuario |
| Ruteo | **React Router v7** | Layouts anidados; el ERP es un árbol de módulos |
| Estado de servidor | **TanStack Query** | Caché, invalidación, reintentos. El 90% del estado de un ERP es del servidor |
| Tablas | **TanStack Table** | Balanzas, auxiliares, agings: todo es tabla densa con orden, filtro y agrupación |
| Formularios | **React Hook Form + Zod** | Validación tipada compartida con el contrato de API |
| Estilos | **Tailwind CSS v4** | UI densa de datos, iteración rápida |
| Componentes | **Radix UI** (primitivos accesibles) | Accesibilidad correcta sin reimplementar diálogos y menús |
| **Decimales** | **decimal.js** | **Crítico. Nunca `number` para dinero** |
| Mocks | **MSW** | Permite construir el frontend completo antes que el backend |
| Fechas | **date-fns** + locale `es` | Ligero, tree-shakeable |

### 1.1 Por qué Vite y no Next.js

Next.js mezclaría frontend y backend en un mismo proyecto. Eso choca con la
separación de módulos que define [01-arquitectura](01-arquitectura.md), y no
aporta lo que Next hace bien: un ERP interno detrás de login no necesita SSR,
SEO ni renderizado en el borde.

Vite deja el frontend como un cliente puro contra una API — que es exactamente lo
que el backend será cuando se construya. Si más adelante se quisiera SSR, migrar
un SPA de Vite a Next es un trabajo acotado; desenredar lógica de negocio metida
en rutas de Next no lo es.

## 2. Estrategia frontend-first

El frontend se construye **antes** que el backend, contra un contrato de API
tipado y datos simulados con MSW.

```
Componentes → hooks de TanStack Query → servicios → cliente de API (tipado)
                                                          │
                                                          ├─ hoy:     MSW, con los datos
                                                          │           guardados en el navegador
                                                          └─ mañana:  API real (mismo contrato)
```

Reglas que hacen que esto no sea trabajo desechable:

1. **El contrato de API vive en `src/shared/api/contracts/`** — tipos y esquemas
   Zod, uno por módulo. Es la fuente de verdad. Cuando exista el backend, estos
   tipos se generan desde él o se comparten; hasta entonces, se escriben a mano.
2. **Los componentes nunca llaman a `fetch`.** Solo usan hooks de módulo
   (`useCuentas`, `useAsientos`). Cambiar el origen de los datos no toca la UI.
3. **Los mocks viven aparte** (`src/mocks/`) y no se importan desde `src/`. Se
   activan por variable de entorno. Borrarlos no debe romper la compilación.
4. **Los mocks no son tontos.** El handler de asientos valida el cuadre y rechaza
   los descuadrados, igual que lo hará el backend. Un mock permisivo produce una
   UI que solo funciona con datos perfectos.
5. **Los datos persisten.** El mock guarda en el almacenamiento local del
   navegador, así que lo capturado sigue ahí después de recargar. Ver §2.2.

### 2.1 La capa de servicios

Entre los hooks y el cliente HTTP hay una capa que describe la API:
`src/shared/api/servicios/`, un archivo por módulo del dominio y dentro un
método por operación, con su ruta y su verbo.

```ts
// shared/api/servicios/conta.ts
export const servicioConta = {
  /** POST /conta/asientos */
  contabilizarAsiento(solicitud: SolicitudAsiento): Promise<Asiento> { … },
}
```

El reparto queda así:

| Capa | Sabe |
|---|---|
| `shared/api/client.ts` | hablar HTTP: serializar, validar contra el contrato, convertir un error de negocio en `ApiError` |
| `shared/api/servicios/` | **qué** se le pide al servidor: ruta, verbo y esquema de cada operación |
| `modules/<m>/api/queries.ts` | **cuándo** pedirlo y qué invalidar después |

Por qué no dejar las llamadas sueltas dentro de los hooks, que es de donde se
sacaron: la API es una sola, y repartir sus rutas por los hooks hace que la
misma operación se escriba distinta en dos pantallas y que no haya dónde mirar
para responder qué le pedimos al servidor. Además, un servicio no arrastra React
ni la caché, así que se llama igual desde un hook, desde una prueba o desde otro
servicio.

Los servicios viven en `shared/` y no dentro de cada módulo a propósito: así CxP
puede pedir las categorías de activo que necesita para capitalizar una línea sin
importar nada de `modules/activos/`, que es la regla de límites de §3.1.

### 2.2 Dónde están los datos mientras no hay backend

En `localStorage`, detrás de `src/shared/almacen/`: colecciones tipadas que se
siembran la primera vez y a partir de ahí mandan sobre la semilla.

Un array en memoria no sirve. Se captura una factura, se recarga la página y el
trabajo desapareció: eso no es un backend simulado, es una demo. Con los datos
guardados, la aplicación se puede usar de verdad durante días, que es la única
forma de que salgan los problemas que un recorrido de cinco minutos no enseña.

Tres decisiones que conviene conocer:

- **Guardar es explícito.** Cada handler llama a `persistir()` después de mutar.
  La alternativa (un `Proxy` que detecte mutaciones) no ve
  `Object.assign(fila, cambios)`, que es justo como se edita una cuenta, así que
  guardaría a veces sí y a veces no.
- **El formato tiene versión.** Cuando cambia la forma de algo ya guardado se
  sube `VERSION` en `almacen.ts` y las colecciones se vuelven a sembrar. Son
  datos de demostración: arrastrar una fila con la forma vieja produce un fallo
  de contrato mucho más difícil de leer que un catálogo reiniciado.
- **Hay salida de emergencia.** `Configuración → Datos de demostración`
  restablece todo a su estado de fábrica.

Nada por encima del almacén sabe que es `localStorage`. Cuando exista la API se
borra la carpeta, y ni los servicios ni los hooks ni las pantallas cambian.

**Multiempresa.** Cada colección se guarda bajo el espacio de nombres de la
empresa activa (`contikos.v1.<empresa>.<colección>`), y cambiar de empresa
la recarga en su sitio, conservando la referencia del array que media
aplicación importa. Es el equivalente local del filtro por `empresa_id` del
repositorio: un handler no puede leer datos de otra empresa porque el array
que tiene delante ya es el de la activa. Las colecciones del grupo (hoy solo
el catálogo de empresas) se declaran con `tablaGlobal` y no se recargan. La
semilla recibe la empresa: la de demostración arranca con documentos, una
empresa recién creada con los catálogos de plantilla y nada más.

Del lado de la API, la empresa activa viaja en la cabecera `X-Empresa-Id` de
toda petición, puesta por `servicios/base.ts` y no por cada llamada, para que
no se pueda olvidar. El mock la exige: sin cabecera contesta 400, y con una
empresa distinta de la abierta, 409. Cambiar de empresa (`useEmpresa().cambiarEmpresa`)
reinicia la caché entera de TanStack Query y vuelve al inicio: un saldo de la
empresa anterior en una pantalla de la nueva es un error contable, no un
parpadeo.

### 2.3 Cómo se conecta la API real

Es un cambio de configuración, no de código:

```bash
# frontend/.env.local
VITE_API_URL=http://localhost:8080/api
```

Y ya está. Declarar dónde vive la API apaga el mock por sí solo: si se dijo
dónde está, es que se quiere hablar con ella. `VITE_USAR_MOCKS` fuerza lo
contrario cuando hace falta (trabajar contra el mock con la variable puesta, o
al revés). Las tres variables están en [`.env.example`](../frontend/.env.example)
y declaradas con tipo en `src/vite-env.d.ts`, así que una errata en el nombre no
compila en vez de valer `undefined`.

Está comprobado, no supuesto: hay una API de mentira de treinta líneas contra la
que la aplicación arranca entera, y `src/shared/api/client.test.ts` levanta un
servidor `node:http` de verdad para las ocho situaciones que MSW no puede
simular.

**Qué se lleva por delante el cambio, solo:**

- El mock deja de cargarse. Es un `import()` dinámico, así que tampoco entra en
  el bundle.
- El service worker de MSW se da de baja al arrancar. No basta con dejar de
  pedirlo: un service worker registrado sigue instalado en la máquina de todo el
  que abrió alguna vez la versión simulada, interponiéndose entre la aplicación
  y la API.
- Los datos locales se borran. Son datos de una empresa guardados en un
  navegador; al llegar el backend dejan de tener motivo para estar ahí.

**Qué tiene que cumplir el backend.** El contrato ya está escrito y es
ejecutable: `src/shared/api/contracts/` son esquemas Zod que se validan en cada
respuesta. Lo que no encaje falla con `CONTRATO_INVALIDO` y un error en consola
señalando la ruta, en vez de colarse hasta un descuadre tres pantallas después.
Tres condiciones que no se negocian:

- **Los importes viajan como texto.** `"1250.00"`, no `1250.00`. La razón está
  en §4.
- **Los errores de negocio traen `{ codigo, mensaje, detalles? }`** con los
  códigos de [02 §3](02-contrato-asientos.md). La UI reacciona al código, no al
  texto.
- **La empresa llega en `X-Empresa-Id`** y el servidor no sirve nada de otra
  (docs/01 §4.1).

**Qué queda por hacer, y cuánto cuesta.** Conviene saberlo de antemano:

| Pendiente | Dónde se toca |
|---|---|
| Autenticación: token, cabecera, 401, renovación | `client.ts`, un solo archivo. Ni servicios ni hooks ni pantallas |
| Paginación de listados largos | El servicio desenvuelve el sobre y sigue devolviendo la lista. `paginado()` ya está en `contracts/comunes.ts` |
| El endpoint de tipo de cambio sale a Hacienda desde el servidor | Ya es así en el contrato: la aplicación solo consulta su propia API (docs/13 §8) |

Lo que **no** hay que hacer, y es el motivo de que la capa de servicios exista:
renombrar hooks, mover archivos, cambiar pantallas o tocar los contratos.

## 3. Estructura de carpetas

Espeja los módulos del backend. Un módulo del frontend corresponde a un módulo
del dominio.

```
src/
├── app/
│   ├── router.tsx              rutas raíz y layouts
│   ├── providers.tsx           Query, tema, empresa activa, auth
│   └── layout/                 shell: sidebar, topbar, breadcrumbs
│
├── modules/
│   ├── config/                 transversal: monedas y parámetros de la empresa
│   ├── conta/                  catálogo, asientos, periodos, mapeos
│   ├── cxc/                    clientes, facturas, cobros, aging
│   ├── cxp/                    proveedores, facturas, pagos
│   ├── bancos/                 cuentas, movimientos, conciliación
│   ├── activos/                activos, categorías, depreciación
│   ├── rh/                     empleados, planillas
│   └── reportes/               balanza, estados financieros
│
├── shared/
│   ├── ui/                     design system: Button, Table, Dialog, Field…
│   ├── money/                  Decimal, formateo ₡/$, MoneyInput, MoneyCell
│   ├── fiscal/                 Costa Rica: cédulas, IVA, tipo de cambio
│   ├── api/
│   │   ├── client.ts           fetch tipado, errores, empresa activa
│   │   ├── servicios/          la API del servidor, un archivo por módulo
│   │   └── contracts/          tipos + Zod por módulo
│   ├── almacen/                persistencia local mientras no hay backend
│   ├── hooks/
│   └── format/                 fechas, números, es-CR
│
├── mocks/
│   ├── browser.ts              setup de MSW
│   ├── handlers/               un archivo por módulo
│   └── seed/                   datos de ejemplo coherentes entre sí
│
└── main.tsx
```

### 3.1 Anatomía de un módulo

```
modules/conta/
├── routes.tsx                  rutas del módulo, montadas por el router raíz
├── pages/                      una página por pantalla
├── components/                 componentes propios del módulo
├── api/
│   ├── queries.ts              hooks de lectura (useQuery)
│   └── mutations.ts            hooks de escritura (useMutation)
└── domain/                     reglas puras: cuadre, saldos, validaciones
```

**Regla de límites:** un módulo no importa de `modules/<otro>/`. Si necesita algo
compartido, sube a `shared/`. Es la misma regla del backend
([01-arquitectura §2](01-arquitectura.md#2-regla-de-dependencias)), aplicada al
cliente, y se hace cumplir con una regla de ESLint — no con buenas intenciones.

## 4. Dinero en el frontend

La decisión más importante de todo el cliente.

### 4.1 Reglas

1. **Todo importe se representa como `Decimal` (decimal.js) o como `string`.**
   Nunca `number`.
2. **La API transporta strings.** `"1234.5600"`, no `1234.56`. JSON convierte
   cualquier número a doble precisión IEEE-754 al parsear, y ahí ya se perdió.
3. **Las sumas en la UI se hacen con Decimal.** Un total de columna calculado con
   `reduce((a, b) => a + b)` sobre floats produce un número que no cuadra con el
   del backend, y el usuario ve un descuadre que no existe.
4. **El redondeo solo ocurre al presentar**, a los decimales de la moneda.
5. Hay una prueba automatizada que falla si un tipo de importe se declara como
   `number` en cualquier contrato de API.

### 4.2 Primitivos

| Pieza | Función |
|---|---|
| `Money` | Envoltorio de `Decimal` con moneda asociada |
| `MoneyInput` | Entrada con máscara, separador de miles configurable, sin float |
| `MoneyCell` | Celda alineada a la derecha, negativos en rojo o entre paréntesis |
| `formatMoney` | `₡1.234.567,89` / `$1,234.56` / `1.234.567,89 €` según moneda |
| `sum` | Suma segura de una colección de `Money` |
| `registrarMonedas` | Hidrata el catálogo vigente desde `GET /config/monedas` |

### 4.3 El catálogo de monedas es un dato, no un tipo

`Moneda` es un código ISO 4217 (`string`), no una unión cerrada `'CRC' | 'USD'`.
Las monedas las da de alta la empresa en `/configuracion/monedas`
([10-modelo-datos §2](10-modelo-datos.md#2-núcleo-transversal) ya modelaba la
entidad `Moneda`), y agregar el euro no debe requerir recompilar el cliente.

Consecuencia de diseño: el registro de `shared/money` es **sincrónico**.
`formatMoney`, `Money.redondear` y `Money.toApi` se llaman dentro del render y en
bucles sobre miles de renglones; un catálogo asíncrono ahí obligaría a propagar
promesas hasta la última celda. Se hidrata una vez al arrancar, antes de montar
la aplicación, y el catálogo por defecto sirve de respaldo si la petición falla.

Cada moneda define su símbolo, sus decimales, sus separadores y si el símbolo va
antes o después del importe:

- Colón: `₡` con separador de miles `.` y decimal `,` → `₡1.234.567,89`
- Dólar: `$` con formato anglosajón → `$1,234.56`
- Euro: `€` pospuesto, con convención europea → `1.234.567,89 €`
- Fecha: `dd/MM/yyyy`
- La moneda de presentación es la del documento; los totales consolidados van en
  la moneda funcional, que es la marcada como tal en el catálogo

Una moneda **inactiva** deja de ofrecerse al capturar pero sigue formateando los
documentos que ya la usan. Una moneda con movimientos no se elimina ni cambia de
decimales: los importes ya contabilizados se redondearían distinto.

## 5. Componentes transversales del ERP

Piezas que aparecen en casi todas las pantallas y conviene construir una sola vez,
antes que las pantallas:

| Componente | Uso |
|---|---|
| `DataTable` | Tabla con orden, filtro, paginación, columnas fijas, totales al pie, exportación |
| `SelectorCuenta` | Buscador de cuenta contable por código o nombre; solo cuentas de detalle |
| `SelectorEntidad` | Cliente / proveedor / empleado / activo, con búsqueda remota |
| `SelectorPeriodo` | Periodo contable, indicando si está abierto o cerrado |
| `SelectorMoneda` + `TipoCambio` | Alimentado por el catálogo configurado; propone el tipo de referencia |
| `Dialogo` | Modal del sistema: foco, Escape y pie de acciones iguales en todos los módulos |
| `EstadoBadge` | Estado de documento, con color consistente en todo el sistema |
| `PanelAsiento` | Vista del asiento generado por un documento; se reutiliza en los 5 módulos |
| `CasillaLibro` / `SelectorLibro` | Fiscal y corporativa: casillas en la captura, selector único en los reportes |
| `CedulaInput` | Entrada con validación de cédula CR según tipo |
| `FormularioDocumento` | Cascarón común: encabezado, líneas, totales, acciones por estado |

`PanelAsiento` es el que más valor tiene: hace visible el contrato de asientos en
la interfaz. Que el usuario vea el asiento antes de contabilizar es, además de
buena UX, la mejor herramienta de depuración del proyecto.

### 5.1 Los dos libros en la interfaz

El doble libro (D-11) se traduce a tres reglas de UI, y las tres importan:

1. **En la captura, las dos contabilidades vienen marcadas.** Quien captura no
   elige libro: el caso normal no requiere ninguna decisión. Desmarcar uno es un
   acto deliberado, casilla por casilla o en bloque desde el encabezado.
2. **Los totales se muestran por libro, y solo cuando difieren.** Si todas las
   líneas van a los dos, se muestra una fila de totales: repetirla dos veces
   idénticas obliga a compararlas para descubrir que no hay nada que comparar.
3. **En los reportes el libro es de selección única**, va en la URL como
   cualquier filtro y se nombra en el encabezado. Nunca se suman los dos.

El color es el mismo en todo el sistema: azul la fiscal, violeta la corporativa.
En una lista, un asiento que afecta a las dos no se colorea; lo que hay que
detectar de un vistazo es la excepción.

## 6. Estado

| Tipo de estado | Dónde vive |
|---|---|
| Datos del servidor | TanStack Query. Nunca duplicados en estado local |
| Formularios | React Hook Form |
| Empresa activa, usuario, tema | Context de React (cambia poco) |
| Filtros de una pantalla | URL (query params) |

**Los filtros van en la URL.** Un contador que quiere enviar un enlace a la
balanza de marzo filtrada por centro de costo debe poder hacerlo. En un ERP esto
se pide siempre.

No hace falta Redux ni Zustand. El estado global real de esta aplicación es
pequeño; el resto es caché de servidor, y eso lo resuelve Query.

## 7. Rendimiento

- **Un `lazy()` por módulo.** Nadie necesita descargar nómina para ver la balanza.
- **Virtualización** en tablas de más de ~200 filas. Un auxiliar de cuenta o un
  libro diario tiene decenas de miles.
- **Los reportes pesados se piden en segundo plano** y se notifica al terminar,
  como describe [09-modulo-reportes §9](09-modulo-reportes.md#9-consideraciones-de-rendimiento).
- Los datos de periodos cerrados son inmutables → `staleTime: Infinity`.

## 8. Accesibilidad y ergonomía de captura

Una pantalla de captura contable la usa alguien ocho horas al día, con teclado.
Esto no es un detalle cosmético:

- **Tab recorre los campos en el orden de captura.** En una línea de asiento:
  cuenta → concepto → cargo → abono → siguiente línea
- **Enter en la última línea crea una nueva.** Ctrl+Enter guarda
- Los campos numéricos aceptan `.` y `,` indistintamente como separador decimal
- El total de cargos, el de abonos y la diferencia son **visibles en todo momento**
  durante la captura, no solo al guardar
- Contraste suficiente para lectura prolongada, y foco siempre visible

## 9. Orden de construcción del frontend

1. **Fundaciones** — scaffold, Tailwind, router, providers, MSW
2. **Dinero** — `Decimal`, formateo es-CR, `MoneyInput`, `MoneyCell`, pruebas
3. **Design system** — `DataTable`, `Field`, `Dialog`, `EstadoBadge`, `Button`
4. **Shell** — sidebar con los 7 módulos, topbar, selector de empresa y periodo
5. **`conta`** — catálogo de cuentas, captura de asiento, balanza
6. **`cxc`** — clientes, factura, cobro, aging
7. Resto de módulos, en el orden de [11-roadmap](11-roadmap.md)

Los pasos 1–4 son la inversión que hace que los módulos 5 en adelante sean
rápidos. Saltárselos y empezar por una pantalla de facturas produce un sistema
donde cada módulo reinventa su tabla y su formato de moneda.
