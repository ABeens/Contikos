# 16 — Requerimientos de septiembre 2026

Lista de trabajo levantada con el usuario el 7 de septiembre de 2026, con el
estado real verificado contra el código, no contra la documentación.

Los veinte puntos vienen de una revisión funcional del sistema. Este documento
es su seguimiento: qué se pidió, qué se construyó, qué falta y de qué depende
cada cosa. Cuando un requerimiento se da por cerrado, su detalle vive en el
documento del módulo que le corresponde, no aquí.

## 1. Resumen

| Estado | Puntos |
|---|---|
| Construido en esta tanda | 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15 |
| Ya estaba construido | 1, 2, 8, 16 |
| En pausa por decisión del usuario | 20 |
| Fuera de esta tanda | 17, 18, 19 |

Los tres módulos que quedan fuera (bancos, recursos humanos e inventarios) no se
abordaron porque son módulos completos, no ajustes: cada uno es una fase del
[roadmap](11-roadmap.md) y dos de ellos tienen decisiones abiertas en
[12-decisiones-pendientes](12-decisiones-pendientes.md).

**Se construyó además algo que no estaba en la lista**: el cobro de cuentas por
cobrar y el pago de cuentas por pagar. Al revisar los veinte puntos se vio que
faltaban, y sin ellos una factura nunca se saldaba: el saldo del cliente y el
del proveedor solo podían crecer. Eran también lo que bloqueaba al módulo de
bancos, porque un movimiento bancario se concilia contra un cobro o un pago, y
esos documentos no existían. Ver §4.5 y §5.2.

## 2. Catálogo de cuentas y NIIF

| # | Requerimiento | Estado | Dónde |
|---|---|---|---|
| 1 | Letras en las notas de la clasificación NIIF | Ya estaba | [03 §2 bis](03-modulo-contabilidad.md) |
| 2 | Nota y categoría NIIF obligatorias en la cuenta | Ya estaba | [03 §2 bis](03-modulo-contabilidad.md) |

La nota se cita por número y literal (`1a`, `1b`, `16b`), y lo que tiene que ser
único es la referencia completa, no el número. Las dos son obligatorias en toda
cuenta de detalle, y se validan tanto en el alta como en la edición.

**Matiz que conviene saber:** el literal es opcional. Existen notas sin letra
(`12`, `13`). Si la intención era que toda nota lleve letra, ese cambio no está
hecho y es de una línea en el contrato.

## 3. Asientos contables

| # | Requerimiento | Estado | Esfuerzo | Depende de |
|---|---|---|---|---|
| 3 | Búsqueda de auxiliar por cuenta, código o cliente | Construido | Bajo | — |
| 4 | Código único por asiento | Construido | Bajo | — |
| 5 | Desaplicación (reversión) de un asiento | Construido | Medio | — |
| 6 | Asientos diferidos | Construido | Alto | Corrida de depreciación como patrón |
| 7 | Depreciación automática con verificación previa | Construido | Alto | — |

### 3.1 Búsqueda de auxiliar

El buscador filtra por código, nombre o razón social e identificación, sin
distinguir tildes ni mayúsculas. Se puede capturar auxiliar también en cuentas
que no lo exigen, eligiendo el tipo a mano; cuando la cuenta sí lo exige, el
tipo lo fija ella y no se puede cambiar. Al salir del campo, un texto que
coincide de forma única se resuelve solo; si coincide con varios, se avisa y no
se contabiliza hasta precisar.

Sigue pendiente: empleados y bancos no tienen catálogo todavía, así que en esas
cuentas el auxiliar es texto libre. Se resuelve cuando existan sus módulos.

### 3.2 Código de asiento

El consecutivo es único por ejercicio y por empresa, y se presenta con un código
estable del tipo `AS-2026-000012`. Antes era un número correlativo global de la
empresa que no reiniciaba entre ejercicios, en contra de lo que prometía el
propio contrato.

### 3.3 Reversión

Sigue [02 §6](02-contrato-asientos.md): un asiento contabilizado es inmutable y
para corregirlo se emite su reversa, con las mismas líneas y los cargos y abonos
invertidos, conservando los libros de cada línea. La reversa exige motivo, cae
en periodo abierto, y un asiento solo se reversa una vez.

**Decisión de diseño que conviene conocer:** el asiento reversado no desaparece
del mayor. Sigue sumando, y su reversa lo compensa. Excluirlo del saldo y además
contar la reversa restaría dos veces. Es también lo que exige que el consecutivo
no tenga huecos.

### 3.4 Diferidos

Módulo nuevo. Un gasto o ingreso pagado o cobrado por adelantado se reconoce mes
a mes hasta agotar el monto, con la última cuota ajustando el remanente para que
el saldo cierre exacto en cero. Su detalle está en
[15-modulo-diferidos](15-modulo-diferidos.md).

### 3.5 Depreciación

Corrida mensual con el flujo que pide [07 §3.2](07-modulo-activos.md):
seleccionar, calcular, revisar y contabilizar. La revisión previa es una pantalla
con semáforos, y la contabilización es idempotente por periodo: correrla dos
veces no duplica el gasto. Cuando la tasa fiscal difiere de la vida útil NIIF, el
asiento lleva líneas separadas por libro, que es el caso que hace visible la
doble contabilidad.

## 4. Cuentas por cobrar y facturación

| # | Requerimiento | Estado | Esfuerzo | Depende de |
|---|---|---|---|---|
| 8 | Productos con cuenta e impuesto, precarga editable | Ya estaba | — | — |
| 9 | Tabla de impuestos | Construido | Medio | — |
| 10 | Consecutivo interno y de factura independientes | Construido | Medio | — |
| 11 | Datos de facturación electrónica en el cliente | Construido | Medio | Catálogo geográfico oficial |
| 12 | Trazabilidad bidireccional | Construido | Medio | Rutas de detalle de factura |

### 4.1 Tabla de impuestos

Las tarifas dejaron de ser constantes del código y pasaron a ser un catálogo con
vigencia por fecha, administrable desde `Configuración → Impuestos`. La tarifa
se resuelve por la fecha del documento, no por la de hoy, que es lo que permite
reproducir un periodo ya cerrado. Una tarifa en uso no se puede borrar: se cierra
su vigencia.

Es el punto que más deuda quitaba. [13](13-localizacion-costa-rica.md) advierte
desde el principio que las tarifas de IVA, las cuotas de la seguridad social y la
versión de los comprobantes electrónicos tienen que vivir en tablas con vigencia,
nunca en código.

### 4.2 Doble numeración

La factura de venta lleva ahora dos números independientes: el interno del
sistema (`FV-000123`), correlativo por empresa, y el consecutivo del comprobante
electrónico con el formato de veinte dígitos de Hacienda (casa matriz, terminal,
tipo de documento y consecutivo). Queda declarado el hueco de la clave numérica
de cincuenta dígitos, todavía vacía.

### 4.3 Datos de facturación electrónica

El cliente admite teléfono con código de país, ubicación por provincia, cantón y
distrito, otras señas, actividad económica, condición de venta y medio de pago.
La lista marca quién está completo para facturar electrónicamente. El proveedor
recibió el mismo tratamiento en lo que le aplica.

**Limitación conocida:** el catálogo geográfico embebido es una muestra de
demostración, no el oficial de Hacienda. Hay que sustituirlo antes de emitir un
comprobante de verdad.

### 4.4 Trazabilidad

Del documento al asiento ya funcionaba. Lo que faltaba era el otro sentido y el
caso manual, y es lo que se construyó: el asiento enseña su documento de origen,
las facturas tienen ruta propia, y un asiento capturado a mano puede declarar a
qué documento se refiere sin que eso lo convierta en el asiento de ese documento.
La distinción importa: el origen da idempotencia y habilita cuentas de control,
el documento relacionado solo da trazabilidad.

### 4.5 Cobro (fuera de la lista de veinte)

Lo que salda la factura, y lo que no existía. Un cobro se aplica a varias
facturas y una factura admite varios cobros parciales. Lo recibido que no se
aplica queda como anticipo del cliente, y cuando el tipo de cambio del cobro no
es el de la factura se reconoce la diferencia cambiaria, que en Costa Rica es el
caso normal y no el de borde ([13 §7](13-localizacion-costa-rica.md)).

Anular un cobro no lo borra: reversa su asiento y devuelve el saldo a cada
factura **sumando lo aplicado**, no reponiendo el saldo que había antes. Entre
medias pudo haber otro cobro sobre la misma factura, y restaurar la foto vieja
lo borraría.

## 5. Cuentas por pagar

| # | Requerimiento | Estado | Esfuerzo |
|---|---|---|---|
| 13 | Adjuntar archivos PDF al documento | Construido | Medio |

Se adjuntan desde la captura, antes de emitir, y desde el detalle de una factura
ya emitida. Se limitan a PDF e imágenes, con tope de tamaño. El contenido se
guarda aparte del documento para no inflarlo.

Relacionado y todavía ausente: el buzón de comprobantes electrónicos recibidos
que exige [13 §4.4](13-localizacion-costa-rica.md), donde se aceptan o rechazan
ante Hacienda las facturas que emiten los proveedores.

### 5.2 Pago (fuera de la lista de veinte)

Simétrico del cobro, con una diferencia que conviene conocer: el asiento lleva
una línea de Proveedores **por factura aplicada** y no una sola agrupada. Cada
una cancela su pasivo a su propio tipo de cambio, y además deja escrito en el
mayor qué factura se saldó, que es lo que hace falta al auditar el auxiliar.

Incluye la **propuesta de pago** de [05 §2.3](05-modulo-cxp.md), que el propio
documento describe como el flujo más usado del módulo en la práctica: dada una
fecha de corte y el efectivo disponible, propone qué facturas pagar ordenadas por
vencimiento.

Sobre la anulación se tomó una decisión que merece la pena señalar: **no se exige
que el periodo del pago siga abierto**. Lo que tiene que caer en periodo abierto
es la fecha de la reversa, por [02 §6](02-contrato-asientos.md). Exigir lo
contrario obligaría a reabrir un mes ya declarado solo para anular un cheque
devuelto.

## 6. Periodos y reportes

| # | Requerimiento | Estado | Esfuerzo | Depende de |
|---|---|---|---|---|
| 14 | Validar fechas al cerrar un periodo | Construido | Alto | Corrida de depreciación |
| 15 | Reporte comparativo de saldos entre periodos | Construido | Medio | — |

### 6.1 Cierre de periodo

Antes no existía la acción de cerrar: los estados eran constantes de los datos de
ejemplo. Ahora el cierre es una decisión que se toma contra un checklist con
semáforos, siguiendo [03 §5](03-modulo-contabilidad.md). Un error impide cerrar;
un aviso se puede saltar, pero exige confirmación explícita que queda registrada
con su motivo.

Lo que se comprueba hoy: que el periodo esté abierto, que el anterior ya esté
cerrado, que la fecha de fin haya llegado, que ningún asiento tenga fecha fuera
del rango, que la balanza cuadre por libro, que la depreciación del mes haya
corrido y que los auxiliares cuadren contra sus cuentas de control.

Lo que queda declarado pero sin comprobar, porque el módulo no existe: nómina,
conciliación bancaria y revaluación de moneda extranjera. Aparecen en el
checklist para que el día que existan se conecten, no se olviden.

El cierre de ejercicio de [03 §6](03-modulo-contabilidad.md), que salda las
cuentas de resultados y genera el asiento de apertura del año siguiente, no es
parte de esta tanda.

### 6.2 Balanza comparativa

La balanza admite un segundo periodo y muestra saldo final de cada uno, variación
absoluta y variación porcentual. El porcentaje es nulo cuando el saldo base es
cero, y se presenta como no aplicable en lugar de dividir entre cero. Sin activar
la comparación, la pantalla se comporta igual que antes.

Los estados financieros completos siguen siendo la Fase 5 del roadmap.

## 7. Estructura y módulos nuevos

| # | Requerimiento | Estado | Por qué |
|---|---|---|---|
| 16 | Multicompañía | Ya estaba | Ver abajo |
| 17 | Módulo de bancos | Fuera de esta tanda | Fase 4 del roadmap |
| 18 | Módulo de recursos humanos | Fuera de esta tanda | Fase 7, decisión D-06 abierta |
| 19 | Módulo de inventarios | Fuera de esta tanda | Fuera del alcance inicial |

### 7.1 Multicompañía

Estaba construido antes de esta revisión: selector de empresa, cabecera de
empresa obligatoria en cada petición y datos aislados por empresa.

**La pregunta que quedaba abierta ya tiene respuesta**, y está en la decisión
D-12 de [12](12-decisiones-pendientes.md): los catálogos de clientes y
proveedores son **independientes por empresa**, porque el código, el crédito, la
retención, la cuenta y el saldo son de la relación comercial y no del tercero.
Lo que sí se comparte, solo de lectura, es la identidad: al dar de alta un
tercero se puede buscar entre los que las demás empresas ya conocen y tomar su
identificación, razón social y contacto. Nunca sus condiciones.

Falta de multicompañía la parte que depende de que exista autenticación: usuario
por empresa y rol por empresa, que siguen en la Fase 0 del roadmap.

### 7.2 Los módulos pendientes

No son ajustes sino módulos completos, cada uno con su documento de diseño ya
escrito. En orden de dependencia:

**Bancos** ([06](06-modulo-bancos.md)) **ya está construido**, después de que
los cobros y los pagos de esta misma tanda le dieran movimientos que conciliar.
Su diseño central se respetó: dos tablas separadas, lo que registra la empresa y
lo que dice el banco, que se cruzan solo en la conciliación. Con su catálogo
desapareció además la única solución provisional que quedaba en el código, la del
auxiliar bancario que cobros y pagos derivaban de la posición de la cuenta en el
plan.

**Recursos humanos** ([08](08-modulo-rh.md)) está bloqueado por la decisión D-06:
calcular la nómina internamente o integrarse con un proveedor local. El propio
documento recomienda lo segundo y advierte que es el módulo menos portable de
todos. Conviene resolver esa decisión antes de estimarlo.

**Inventarios** está declarado fuera del alcance inicial en el roadmap y no tiene
documento de diseño ni decisión registrada. La integración con cuentas por cobrar
que planteaba el requerimiento tampoco está decidida: hoy la compra de inventario
se registra contra una cuenta contable, sin control de existencias, y el único
gancho previsto es un comentario en el contrato de la línea de factura. Si el
módulo se va a hacer, el primer paso es una decisión en
[12](12-decisiones-pendientes.md) sobre si la venta descarga existencias y cómo
se costea.

## 8. Tipo de cambio

| # | Requerimiento | Estado |
|---|---|---|
| 20 | Robot de tipo de cambio diario | **En pausa por decisión del usuario** |

El requerimiento pedía un robot que obtuviera el tipo de cambio diario y que se
disparara solo al ingresar o cambiar la fecha de un documento. **El usuario
decidió dejarlo en pausa** y que, mientras tanto, el sistema tenga una plantilla
de tasas de ejemplo.

Lo que sí quedó construido, porque hacía falta de todos modos:

- La tabla de tipos de cambio con fecha, que es lo que [13 §7](13-localizacion-costa-rica.md)
  y [10 §2](10-modelo-datos.md) exigen desde el principio. Antes la moneda tenía
  un único valor sin vigencia ni historial, lo que impide contabilizar bien y
  reprocesar un cierre.
- La resolución por fecha con la regla del último valor anterior, necesaria para
  un domingo o un feriado.
- Una plantilla de tasas de demostración, marcada como tal para que nadie la
  confunda con un dato oficial.
- La pantalla para consultar la serie y capturar un tipo de cambio a mano.

Lo que queda pendiente el día que se retome, marcado en el código con la etiqueta
`TODO(robot)`:

- La consulta automática al cambiar la fecha de un documento, en los formularios
  de factura de venta, factura de compra y captura de asiento.
- El poblado diario desde la fuente oficial.

El botón manual que ya consultaba al Ministerio de Hacienda sigue donde estaba,
en la configuración de monedas. La limitación de esa fuente sigue vigente y hay
que tenerla presente: no expone serie histórica, así que para reprocesar el
pasado la fuente es el servicio de indicadores del Banco Central.

## 9. Lo que este trabajo dejó pendiente

Ordenado por lo que más bloquea:

1. **Facturación electrónica.** Los datos del cliente, la numeración y la tabla
   de impuestos ya están; falta el ciclo completo, que es un subproyecto en sí
   mismo: clave numérica, XML, firma, envío, consulta de estado y contingencia.
2. **Catálogo geográfico oficial**, para sustituir la muestra de demostración.
3. **Notas de crédito**, que son parte de Fase 2 y Fase 3. El anticipo ya existe
   como saldo, pero no como documento que se aplique después.
4. **Cierre de ejercicio**, que completa lo que el cierre mensual empezó.
5. **Bajas y ventas de activo**, que hoy no existen aunque la depreciación sí.
6. ~~**Módulo de bancos**~~, construido: catálogo de cuentas, movimientos
   propios, importación del estado de cuenta, conciliación y revaluación
   ([06](06-modulo-bancos.md)). Lo único que queda fuera es el flujo de efectivo
   proyectado, cuya tercera pata es la nómina.

## 10. Advertencia sobre los datos

Todo lo anterior corre contra el servidor simulado, que aplica las mismas
validaciones que aplicará la API real y guarda en el navegador. Los datos que se
capturen sobreviven a una recarga, pero son datos de demostración. Para volver a
los de fábrica: `Configuración → Datos de demostración → Restablecer`.

El backend sigue sin existir. Conectarlo es declarar `VITE_API_URL`, y no cambia
ni una firma de la capa de servicios ([14 §2.3](14-arquitectura-frontend.md)).
