# 17 — Plan de los módulos faltantes

Qué queda por construir, en qué orden y por qué. Escrito tras cerrar los
requerimientos de [16](16-requerimientos-2026-09.md), cuando el mapa cambió: dos
de los tres módulos pendientes dejaron de estar bloqueados. **Bancos ya se
construyó**; el documento se mantiene al día en vez de reescribirse, para que se
vea qué se planificó y qué salió de otra manera.

Este documento planifica. El diseño de cada módulo ya existe y no se repite aquí:
[06 bancos](06-modulo-bancos.md), [09 reportes](09-modulo-reportes.md),
[08 recursos humanos](08-modulo-rh.md). Inventarios es el único que todavía no
tiene diseño, y eso es parte del plan.

## 1. Punto de partida

Lo que hay hoy y que condiciona todo lo que sigue:

| Ya construido | Por qué importa aquí |
|---|---|
| Contrato de asientos y su idempotencia | Todo módulo nuevo se conecta por ahí y por nada más |
| Cobros y pagos | Lo que bancos necesitaba para tener algo que conciliar |
| Clasificación NIIF y notas, obligatorias | Los estados financieros ya tienen de dónde salir |
| Cierre de periodo con checklist | Donde se enganchan la revaluación y la nómina del mes |
| Doble libro fiscal y corporativo | El comparativo fiscal contra corporativo ya tiene datos |
| Balanza y balanza comparativa | La base del módulo de reportes ya está probada |
| Trazabilidad bidireccional | El drill-down de reportes no hay que inventarlo |
| Multiempresa | Todo lo nuevo nace aislado por empresa sin esfuerzo extra |
| Tesorería, conciliada | El Flujo de Efectivo ya tiene contra qué verificarse |

Lo que **no** hay y que sí bloquea: **autenticación y control de acceso por rol**.
Sigue en la Fase 0 del [roadmap](11-roadmap.md), sin empezar. Ver §6.

## 2. Orden recomendado

```
Bancos completo  ──►  Reportes E1-E8
   (hecho)              (lo siguiente)
        │
        ▼
Auth y RBAC  ──►  RH  ──►  Inventarios
                          (solo tras su ADR)
```

> **Nota de setiembre de 2026:** el orden se invirtió. El plan proponía empezar
> por la primera parte de reportes y dejar bancos para después; se hizo bancos
> primero, entero. La razón de fondo del orden original sigue en pie, y ahora
> juega a favor: el Estado de Flujo de Efectivo se verifica contra los saldos de
> las cuentas de efectivo, y esos saldos ya existen y ya están conciliados.

**Por qué bancos fue primero y entero.** Cerraba un agujero real: cobros y pagos
tenían el auxiliar de cuenta bancaria resuelto de forma provisional porque su
catálogo no existía. El catálogo lo eliminó. Y el Estado de Flujo de Efectivo,
que es el reporte más difícil de cuadrar, se verifica contra los saldos de las
cuentas de efectivo: construirlo antes de bancos habría sido construirlo sin
poder comprobarlo.

**Por qué reportes ahora, empezando por su primera parte.** El Balance General y
el Estado de Resultados no dependen de nada que falte: la clasificación NIIF ya
está capturada en cada cuenta de detalle y hoy no produce nada visible. Es el
trabajo con mayor valor por unidad de esfuerzo que queda en el sistema, y es de
solo lectura, así que no puede romper nada.

**Por qué las exportaciones fiscales al final.** Necesitan la interfaz de
localización fiscal, que es otro frente.

## 3. Bancos

**Estado: construido.** Se hizo entero salvo la etapa 7, el flujo de efectivo
proyectado, que consulta a CxC, CxP y RH, y RH no existe.
**Diseño:** [06-modulo-bancos](06-modulo-bancos.md), completo y sin decisiones
abiertas.

El diseño central ya está decidido y conviene no negociarlo: **dos tablas de
movimientos separadas**, lo que registra la empresa y lo que dice el banco, que
se cruzan solo en la conciliación. Meterlos en una sola tabla hace imposible
conciliar.

### Etapas

| # | Qué | Por qué en este orden |
|---|---|---|
| 1 | Catálogo de cuentas bancarias, con su cuenta de control y su moneda | Crea el auxiliar `banco` que cobros y pagos dejaron provisional |
| 2 | Movimientos propios de captura manual: comisiones, intereses, traspasos | Son los únicos que nacen aquí, y cada uno con su asiento |
| 3 | Recepción de los eventos de cobro y de pago | El depósito y el retiro que ya existen como documentos en CxC y CxP |
| 4 | Importación del estado de cuenta | Empezar por CSV, tras una interfaz por banco |
| 5 | Conciliación | El flujo más valioso del módulo |
| 6 | Revaluación de moneda extranjera al cierre | Se engancha en el checklist de cierre que ya existe |
| 7 | Flujo de efectivo proyectado | Solo lectura, consulta a CxC, CxP y RH por su API |

Las seis primeras están hechas. La séptima espera a `rh`: sin la nómina
proyectada, la posición a futuro que enseñaría estaría sistemáticamente por
encima de la real, que es la peor forma de equivocarse en una proyección de caja.

El efecto que la etapa 1 tenía fuera de bancos ya se consumó: cobros y pagos
capturan la cuenta bancaria del catálogo, y de ella salen el código contable y el
auxiliar. `auxiliarBancoDe`, que lo derivaba de la posición de la cuenta en el
plan, se borró.

### Riesgos, y qué se hizo con cada uno

- **El emparejamiento automático en cascada.** La cuarta regla sale marcada como
  `requiereConfirmacion` y el botón de aceptar en bloque solo toca las tres
  primeras. Además cada regla consume los movimientos que casa, para que la
  floja no se coma lo que la estricta habría casado bien.
- **Los parsers por banco.** Hay una interfaz, `ParserEstadoCuenta`, y un solo
  lector detrás: el CSV genérico. Añadir el de un banco concreto es añadirlo a
  una lista; ni la deduplicación ni la conciliación lo conocen.
- **La detección de duplicados.** Por huella
  `(cuenta, fecha de operación, importe, referencia)`, y también dentro del
  propio archivo. Recargar el mismo estado de cuenta no duplica nada y lo dice.

### Qué queda fuera

La integración bancaria por API, que el propio diseño declara fuera de alcance.
La importación quedó tras la misma interfaz que un día podrá tener una
implementación por API sin tocar el resto: lo que cambiaría es de dónde sale el
texto, no qué se hace con las filas.

## 4. Reportes

**Estado:** desbloqueado, y su primera parte es lo más rentable que queda.
**Diseño:** [09-modulo-reportes](09-modulo-reportes.md), completo.

La frontera que hay que defender está en el propio diseño: reportes **no hace
cálculos de negocio**. Si un número requiere lógica, esa lógica vive en el módulo
dueño y reportes solo lo presenta. Es una frontera que se degrada sola.

Y la regla que no se negocia: **todo reporte es de un libro**, fiscal o
corporativo, nunca de los dos sumados. La única excepción es el comparativo entre
ambos, que es justamente el reporte que explica por qué la utilidad declarada no
es la utilidad del negocio.

### Etapas

| # | Qué | Depende de |
|---|---|---|
| 1 | Estado de Situación Financiera y Estado de Resultados | Nada que falte. La clasificación NIIF ya está capturada |
| 2 | Auxiliar de cuenta con drill-down hasta el documento | La trazabilidad bidireccional ya existe |
| 3 | Libro diario y libro mayor | Nada |
| 4 | Estado de Cambios en el Patrimonio | Cierre de ejercicio, para el traspaso del resultado |
| 5 | Comparativo fiscal contra corporativo | Nada. El doble libro ya tiene datos |
| 6 | Estado de Flujo de Efectivo, método indirecto | Bancos, para poder verificarlo |
| 7 | Motor de plantillas configurables | Las etapas 1 y 3 |
| 8 | Exportaciones fiscales D-101 y D-104, PDF y Excel | La interfaz de localización fiscal |

Las etapas 1 y 2 son las que convierten en producto todo el trabajo de
clasificación NIIF que ya está hecho. Hoy ese trabajo está capturado y no se ve
en ninguna pantalla.

### Riesgos

- **El Flujo de Efectivo es el reporte más difícil de cuadrar**, y el que más
  revela errores de clasificación en el catálogo de cuentas. Su verificación es
  dura: la variación calculada tiene que ser exactamente la diferencia de saldos
  de las cuentas de efectivo. No lo des por terminado sin esa comprobación
  automatizada.
- **El motor de plantillas** es lo que separa un sistema contable usable de uno
  rígido, pero es fácil que se coma el tiempo de los reportes formales. Va
  después, no antes.
- **Rendimiento.** El diseño pide servir desde saldos materializados y no sumando
  movimientos. Los saldos materializados todavía no existen: hoy la balanza suma
  el detalle. Con los volúmenes de una PYME aguanta, pero es deuda consciente.

## 5. Recursos humanos

**Estado:** bloqueado por dos cosas, una de decisión y otra de construcción.
**Diseño:** [08-modulo-rh](08-modulo-rh.md).

Es el módulo de mayor riesgo del sistema, y el propio diseño lo dice en su primera
sección: un error aquí afecta a personas, genera multas y se ve de inmediato.

### Lo que hay que resolver antes

**La decisión D-06, nómina propia contra proveedor externo**, sigue abierta en
[12](12-decisiones-pendientes.md). La recomendación registrada es integrarse con
un proveedor local y quedarse con la contabilización, las provisiones y los
reportes. Mantener tablas de impuesto sobre la renta y de cargas sociales al día
es un compromiso permanente con responsabilidad legal.

**Resolver esa decisión cambia el tamaño del módulo por un factor grande.** No
tiene sentido estimarlo antes.

**Y la autenticación con roles**, que es la otra mitad del bloqueo. Ver §6.

### Etapas, suponiendo que D-06 se resuelva por el proveedor externo

| # | Qué |
|---|---|
| 1 | Empleado y catálogo de conceptos, con su cuenta contable en el concepto |
| 2 | Importación del cálculo del proveedor y generación del asiento de nómina |
| 3 | Provisiones mensuales de aguinaldo, vacaciones y cesantía |
| 4 | Dispersión, que publica su evento a bancos |
| 5 | Reportes de planilla |

Si se resolviera por el cálculo propio, se añade antes de todo eso el motor local
con las tablas de la Caja Costarricense de Seguro Social y del impuesto sobre la
renta del trabajo, más su mantenimiento permanente. Toda esa lógica va tras la
interfaz `MotorNominaLocal`, con una implementación por país.

### El error que hay que evitar

Está señalado en el diseño y vale la pena repetirlo: **las aportaciones
patronales no se descuentan al empleado pero sí son gasto de la empresa**. El
asiento contable siempre es mayor que la suma de los recibos. Confundirlo es el
error más común al modelar nómina.

La verificación que lo detecta: el saldo de sueldos por pagar tiene que quedar en
cero después de dispersar.

## 6. Autenticación y control de acceso

No es un módulo, es un prerrequisito, y es lo único de la Fase 0 que sigue sin
empezar.

Multiempresa ya está construida y funciona: cada petición lleva su empresa y los
datos no se cruzan. Lo que falta es la otra mitad, el usuario y su rol **por
empresa**.

**Recursos humanos no se puede entregar sin esto.** Los datos salariales exigen
control de acceso reforzado, y hoy cualquiera que abra la aplicación ve todo.
También lo piden la autorización de pagos y el cierre de periodo con excepciones,
que hoy registran un usuario de demostración fijo.

Conviene abordarlo entre bancos y recursos humanos, no antes: bancos no lo
necesita y retrasarlo no cuesta nada, mientras que hacerlo antes de tener claro
qué operaciones son sensibles llevaría a inventar permisos que nadie pidió.

## 7. Inventarios

**Estado:** el único que no tiene diseño, y el único declarado fuera del alcance
inicial en el [roadmap](11-roadmap.md).

Hoy la compra de inventario se registra contra una cuenta contable y no hay
control de existencias. El único gancho previsto es un comentario en el contrato
de la línea de factura de venta, que anota que esto cambia si la venta descarga
existencias.

### Lo que hay que hacer antes de planificarlo

**No se puede estimar todavía porque las decisiones de fondo no están tomadas.**
El primer entregable no es código, es una decisión registrada en
[12](12-decisiones-pendientes.md) que responda al menos a esto:

1. **¿La venta descarga existencias?** Es la pregunta que define si inventarios
   se acopla a CxC o vive aparte. Si la respuesta es sí, la emisión de factura
   pasa a generar un segundo asiento de costo de ventas, y eso toca un módulo que
   hoy funciona.
2. **¿Qué método de costeo?** Promedio ponderado, primeras entradas primeras
   salidas, o costo estándar. Cambiarlo después obliga a recostear el histórico.
3. **¿Inventario perpetuo o periódico?** Determina si el costo de ventas se
   reconoce en cada venta o solo al cierre.
4. **¿Hay producción?** Si la respuesta es sí, esto no es inventarios, es costeo
   de manufactura, y es otro proyecto.

Después de esa decisión: un documento de diseño con el formato de los demás, y
recién entonces un plan de etapas.

**Recomendación:** dejarlo para el final, y solo si el negocio lo pide de verdad.
Es el único de los cuatro que no completa nada de lo que ya existe. Los otros
tres cierran huecos del sistema actual; inventarios abre un frente nuevo.

## 8. Lo que no es un módulo pero conviene no perder de vista

Trabajo pendiente que no forma parte de ningún módulo nuevo y que aparece en
[16 §9](16-requerimientos-2026-09.md):

| Qué | Cuándo |
|---|---|
| Facturación electrónica, el ciclo completo | Es un subproyecto en sí mismo. Los datos ya están; falta clave numérica, XML, firma, envío y contingencia |
| Catálogo geográfico oficial | Antes de emitir un comprobante real. Hoy hay una muestra de demostración |
| Notas de crédito | Con reportes, para que el Estado de Resultados no ignore devoluciones |
| Cierre de ejercicio | Antes del Estado de Cambios en el Patrimonio, que lo necesita |
| Bajas y ventas de activo | Cuando toque, no bloquea nada |
| El robot de tipo de cambio | En pausa por decisión del usuario. Marcado en el código con `TODO(robot)` |

## 9. Resumen para decidir

Si hay que elegir una sola cosa por dónde seguir: **el Balance General y el Estado
de Resultados**, la primera etapa de reportes. No está bloqueada por nada, es de
solo lectura, y es lo que hace visible el trabajo de clasificación NIIF que ya
está capturado en cada cuenta.

Bancos ya está: cerró el ciclo del dinero y se llevó por delante la única
solución provisional que quedaba en el código. Lo que dejó pendiente es una sola
cosa, el flujo de efectivo proyectado, y espera a la nómina.

Y una decisión que conviene tomar pronto aunque no se vaya a construir todavía:
**D-06**, porque de ella depende que recursos humanos sea un módulo mediano o un
compromiso permanente de mantenimiento fiscal.
