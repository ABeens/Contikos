# 13 — Localización Costa Rica

Resuelve **D-02**. Este documento concentra todo lo específico del país; el resto
del sistema no debe contener lógica fiscal costarricense fuera de aquí.

> ⚠️ **Sobre las tasas y versiones de este documento.** Las tarifas de impuestos,
> las cuotas de seguridad social y las versiones del formato de comprobantes
> electrónicos **cambian por resolución o decreto**, a veces varias veces al año.
> Los valores citados abajo son el punto de partida y están marcados con ⚠️ donde
> conviene confirmarlos contra la fuente oficial antes de implementar.
>
> **Implicación de diseño, no negociable:** ninguna tasa va escrita en el código.
> Todas viven en tablas con **vigencia por fecha** (`vigente_desde`,
> `vigente_hasta`), y el cálculo siempre resuelve la tasa por la fecha del
> documento — no por la fecha de hoy. Recalcular un periodo anterior debe dar el
> mismo resultado que dio en su momento.

## 1. Marco general

| Concepto | Costa Rica |
|---|---|
| Autoridad fiscal | Ministerio de Hacienda — Dirección General de Tributación (DGT) |
| Portal | ATV (Administración Tributaria Virtual) |
| Moneda funcional | Colón costarricense — **CRC**, símbolo ₡, 2 decimales |
| Periodo fiscal | Año calendario (enero–diciembre) |
| Marco contable | NIIF / NIIF para PYMES |
| Catálogo de cuentas | **Libre.** No hay catálogo uniforme obligatorio |
| Facturación electrónica | Obligatoria |

### 1.1 Consecuencia importante: catálogo de cuentas libre

A diferencia de otros países de la región, Costa Rica **no impone un catálogo de
cuentas**. La empresa lo define, siguiendo NIIF.

Esto es una buena noticia para el diseño — el módulo `conta` ya soporta catálogo
jerárquico configurable ([03](03-modulo-contabilidad.md#2-catálogo-de-cuentas)) y
no requiere adaptación. Lo que sí conviene entregar es una **plantilla de
catálogo base NIIF para PYMES** que el usuario pueda cargar y ajustar al crear la
empresa.

## 2. Identificación de contribuyentes

| Tipo | Dígitos | Descripción |
|---|---|---|
| Física | 9 | Cédula de identidad nacional |
| Jurídica | 10 | Cédula jurídica de personas jurídicas |
| DIMEX | 11 o 12 | Documento de identidad migratorio para extranjeros |
| NITE | 10 | Número de identificación tributaria especial |

El sistema debe validar **formato y longitud** según el tipo, y almacenar el tipo
junto al número — el número solo no es suficiente para saber cómo validarlo ni
cómo enviarlo en el XML.

Se almacena **sin guiones ni separadores**; el formateo para pantalla es
responsabilidad de la capa de presentación.

## 3. IVA

Impuesto al Valor Agregado, vigente desde 2019 (Ley 9635, Fortalecimiento de las
Finanzas Públicas), en sustitución del anterior impuesto general sobre las ventas.

| Tarifa | Aplicación típica ⚠️ |
|---|---|
| **13%** | Tarifa general |
| **4%** | Servicios de salud privados, pasajes aéreos |
| **2%** | Medicamentos, primas de seguros, educación privada |
| **1%** | Canasta básica tributaria, insumos agropecuarios |
| **0%** | Exportaciones |
| Exento / No sujeto | Según ley |

⚠️ La asignación de bienes y servicios a cada tarifa reducida es materia de
reglamento y cambia. **El catálogo de tarifas debe ser configurable**, y cada
producto o servicio lleva su tarifa asignada.

### 3.1 Consecuencias para el módulo

- Una factura puede combinar líneas con distintas tarifas → el impuesto se
  calcula **por línea**, nunca sobre el total
- Se debe distinguir **exento** de **no sujeto** de **tarifa 0%**: contablemente
  se tratan distinto y se declaran distinto
- El **IVA acreditable** puede estar sujeto a proporcionalidad cuando la empresa
  realiza operaciones gravadas y exentas simultáneamente ⚠️ — verificar si aplica
  al alcance del producto antes de implementarlo

### 3.2 Declaración

Declaración mensual de IVA (**formulario D-104**), presentada por ATV. El
sistema debe poder generar el detalle que la sustenta desde los módulos de CxC y
CxP.

## 4. Comprobantes electrónicos

Obligatorios. El comprobante es un **XML firmado digitalmente** que se envía a
Hacienda y al receptor.

### 4.1 Tipos de documento

| Código | Documento | Módulo |
|---|---|---|
| **FE** | Factura Electrónica | cxc |
| **TE** | Tiquete Electrónico | cxc (punto de venta) |
| **NC** | Nota de Crédito Electrónica | cxc |
| **ND** | Nota de Débito Electrónica | cxc |
| **FEC** | Factura Electrónica de Compra | cxp |
| **FEE** | Factura Electrónica de Exportación | cxc |
| **REP** | Recibo Electrónico de Pago | cxc |

⚠️ **Versión del formato:** la versión vigente al momento de escribir este
documento es la **4.4**. Confirmar la versión y el esquema vigente en el portal
de Hacienda antes de implementar, y **diseñar el generador de XML de modo que la
versión sea sustituible** — este formato ha cambiado varias veces y volverá a
cambiar.

**El REP** merece atención especial: existe porque en ventas a crédito el IVA se
declara al momento del cobro, no al de la facturación. Esto significa que el
módulo de CxC debe emitir un comprobante adicional **al registrar el cobro**, no
solo al facturar. Es una particularidad que afecta el flujo descrito en
[04-modulo-cxc §2.2](04-modulo-cxc.md#22-cobro).

### 4.2 Numeración

Dos números distintos, ambos generados por el emisor:

**Consecutivo — 20 dígitos**

```
[3 casa matriz][5 terminal][2 tipo doc][10 consecutivo]
```

**Clave numérica — 50 dígitos**

```
[3 país][2 día][2 mes][2 año][12 cédula emisor]
[20 consecutivo][1 situación][8 código de seguridad]
```

El código de seguridad es un valor aleatorio de 8 dígitos generado por el
emisor. El campo *situación* distingue emisión normal, contingencia y sin
internet.

**Ambos consecutivos son sin huecos y por terminal.** Esto encaja con la regla ya
definida en [03-modulo-contabilidad §3](03-modulo-contabilidad.md#3-asientos).

**Estado (setiembre de 2026).** La clave numérica ya se genera al emitir una
factura o una nota de crédito (`generarClaveNumerica` en
`shared/fiscal/comprobante.ts`), con un código de seguridad aleatorio y
situación normal. El XML, la firma y el envío siguen pendientes (§4.3).

**Qué le falta al XML, según el esquema oficial v4.4.** Se revisó
`FacturaElectronica_V4.4.xsd` publicado por Hacienda. Además de la firma
(`ds:Signature`, obligatoria), exige datos que el sistema todavía no captura:

| Dato | Dónde falta | Obligatorio |
|---|---|---|
| Código CABYS de 13 dígitos | En cada producto o servicio del catálogo | Sí, por línea |
| Unidad de medida | En cada línea | Sí |
| Código de actividad económica del emisor (6 dígitos) | En la empresa | Sí |
| Ubicación del emisor (provincia, cantón, distrito, otras señas) | En la empresa | Sí |
| Correo del emisor | En la empresa | Sí |
| Cédula del proveedor de sistemas | Configuración | Sí |
| Impuesto asumido por el emisor o la fábrica | En cada línea | Sí (normalmente cero) |

El catálogo CABYS lo publica el Banco Central y tiene decenas de miles de
códigos; cargarlo es la primera tarea del subproyecto de facturación
electrónica.

### 4.3 Firma y envío

1. Generar el XML según el esquema vigente
2. Firmarlo con **XAdES-EPES**, usando la llave criptográfica que Hacienda emite
   al contribuyente desde ATV (archivo `.p12` + PIN)
3. Enviarlo a la API de recepción de Hacienda
4. Consultar el resultado: Hacienda responde con un **mensaje de aceptación o
   rechazo**
5. Entregar al receptor el XML y su representación gráfica en PDF, típicamente
   por correo

**Estados a modelar en el documento:**

```
generado → firmado → enviado → aceptado
                             → rechazado
                             → en contingencia
```

Un documento **rechazado por Hacienda no es una factura válida**. El asiento
contable no debe generarse hasta la aceptación — o, si se genera antes por
diseño, debe reversarse automáticamente ante el rechazo. Recomendación:
contabilizar solo tras la aceptación.

**Contingencia:** si el servicio de Hacienda no está disponible, se emite en
modo contingencia y se transmite después. El sistema debe soportar una cola de
reenvío con reintentos.

### 4.4 Recepción de comprobantes (CxP)

El receptor debe **aceptar, aceptar parcialmente o rechazar** los comprobantes
que recibe. Esto es una responsabilidad del módulo CxP que no existe en otros
países y hay que modelarla: un buzón de comprobantes recibidos, con su estado y
su respuesta enviada a Hacienda.

## 5. Retenciones e impuesto sobre la renta

| Concepto | Nota ⚠️ |
|---|---|
| Retención por tarjetas | Los procesadores de tarjeta retienen un porcentaje sobre las ventas |
| Retenciones en la fuente | Sobre ciertos pagos a terceros |
| Renta — declaración anual | Formulario **D-101** |
| Retenciones — declaración | Formulario **D-103** |

⚠️ Las tasas y los supuestos de retención deben confirmarse contra la normativa
vigente. Modelarlos como reglas configurables por tipo de proveedor y tipo de
gasto, tal como ya prevé [05-modulo-cxp §8](05-modulo-cxp.md#8-dependencia-de-la-localización-fiscal).

## 6. Nómina y seguridad social

Administrada por la **CCSS** (Caja Costarricense de Seguro Social). La planilla
se reporta mensualmente a través de **SICERE**.

Todas las cifras de esta sección son **parámetros con vigencia por fecha**, no
constantes del código: se administran dentro de la aplicación igual que la tabla
de impuestos, y el cálculo de un periodo usa los valores vigentes en su fecha.
Están en `Recursos humanos → Parámetros de ley`, cargadas con los valores de
2026 de esta sección ([08 §9](08-modulo-rh.md)).
Así, cuando cambia un decreto se captura una fila nueva y el sistema sigue
pudiendo recalcular un periodo viejo con sus valores de entonces. Ver
[12 D-06](12-decisiones-pendientes.md).

Valores verificados en setiembre de 2026 contra las fuentes de §6.5. Lo que
sigue marcado con ⚠️ no se pudo confirmar en una fuente oficial.

### 6.1 Cargas sociales, vigentes desde el 1 de enero de 2026

El único cambio respecto de 2025 es el IVM, que sube 0,16 puntos para el patrono
y 0,16 para el trabajador. Es el aumento escalonado del Transitorio XI del
Reglamento del IVM, y **estas tasas rigen hasta el 31 de diciembre de 2028**.

**Rebajo al trabajador: 10,83 % del salario bruto**

| Concepto | Tasa |
|---|---|
| SEM (Seguro de Enfermedad y Maternidad) | 5,50 % |
| IVM (Invalidez, Vejez y Muerte) | 4,33 % |
| Banco Popular | 1,00 % |

**Aporte patronal: 26,83 % del salario bruto**

| Concepto | Tasa |
|---|---|
| SEM | 9,25 % |
| IVM | 5,58 % |
| Asignaciones Familiares (FODESAF) | 5,00 % |
| IMAS | 0,50 % |
| INA | 1,50 % |
| Banco Popular, cuota patronal | 0,25 % |
| Banco Popular, Ley de Protección al Trabajador | 0,25 % |
| Fondo de Capitalización Laboral (FCL) | 1,50 % |
| Operadora de Pensiones Complementarias (ROP) | 2,00 % |
| Instituto Nacional de Seguros (INS) ⚠️ | 1,00 % |

- **INA no aplica** a patronos no agropecuarios con menos de cinco trabajadores
  permanentes. Para ellos el total patronal es 25,33 %. El sistema necesita
  saber, por empresa, su actividad y su número de trabajadores.
- ⚠️ **El 1,00 % del INS.** Las fuentes lo suman dentro del 26,83 %, pero no
  coinciden en si es un rubro fijo de la planilla o la tasa de referencia de la
  póliza de riesgos del trabajo, que en la práctica va del 1 % al 6 % según la
  actividad. Confirmar contra una factura real de la CCSS antes de implementar.
  Mientras tanto, modelar la póliza de riesgos como parámetro propio de cada
  empresa.

**Base mínima contributiva 2026** (Decreto 45303-MTSS, La Gaceta 229 del 5 de
diciembre de 2025):

| Seguro | Base mínima mensual |
|---|---|
| SEM | ₡333.328 |
| IVM | ₡311.990 |

Si el salario reportado es menor, la CCSS calcula sobre la base mínima, salvo
ingreso o salida a mitad de mes, incapacidad o permiso sin goce de más de 15
días.

> Recordatorio del diseño: el aporte patronal **es gasto de la empresa y no se
> descuenta al trabajador**. El asiento de nómina siempre es mayor que la suma de
> los recibos. Ver [08-modulo-rh §2](08-modulo-rh.md#2-entidades).

### 6.2 Impuesto sobre la renta del trabajo, vigente desde el 1 de enero de 2026

Decreto Ejecutivo 45333-H, La Gaceta 229 del 5 de diciembre de 2025. Los montos
se ajustaron por la inflación del año, que fue negativa (-0,38 %), así que los
tramos bajaron un poco respecto de 2025.

**Tramos mensuales.** Cada tasa se aplica solo a la parte del salario que cae en
su tramo, no al salario entero.

| Salario mensual | Tasa sobre el exceso |
|---|---|
| Hasta ₡918.000 | Exento |
| Más de ₡918.000 hasta ₡1.347.000 | 10 % |
| Más de ₡1.347.000 hasta ₡2.364.000 | 15 % |
| Más de ₡2.364.000 hasta ₡4.727.000 | 20 % |
| Más de ₡4.727.000 | 25 % |

**Créditos fiscales mensuales.** Se restan del impuesto ya calculado, no del
salario, y el impuesto nunca queda negativo.

| Crédito | Monto mensual |
|---|---|
| Por cada hijo | ₡1.710 |
| Por cónyuge | ₡2.590 |

El salario sobre el que se calcula el impuesto es el bruto: los rebajos de la
CCSS no lo reducen.

### 6.3 Prestaciones legales

| Prestación | Regla |
|---|---|
| **Aguinaldo** | Un doceavo de todo lo devengado entre el 1 de diciembre y el 30 de noviembre, ordinario y extraordinario. Se paga a más tardar el 20 de diciembre. Exento de cargas sociales e impuesto sobre la renta ⚠️ hasta el equivalente a un doceavo de lo devengado; confirmar el tratamiento del exceso |
| **Vacaciones** | Mínimo dos semanas por cada 50 semanas de trabajo continuo |
| **Preaviso** (art. 28) | De 3 a 6 meses de servicio, una semana; de 6 meses a un año, 15 días; más de un año, un mes. Nunca más de un mes |
| **Cesantía** (art. 29) | Ver la tabla siguiente |

**Cesantía.** Los días por año dependen de la antigüedad total, y **nunca se
reconocen más de ocho años**, aunque la persona haya trabajado más.

| Antigüedad | Días |
|---|---|
| De 3 a 6 meses | 7 días en total |
| De 6 meses a un año | 14 días en total |
| 1 año | 19,5 por año |
| 2 años | 20 por año |
| 3 años | 20,5 por año |
| 4 años | 21 por año |
| 5 años | 21,24 por año |
| 6 años | 21,5 por año |
| 7, 8 y 9 años | 22 por año |
| 10 años | 21,5 por año |
| 11 años | 21 por año |
| 12 años | 20,5 por año |
| 13 años o más | 20 por año |

El salario que se usa es el **promedio de los últimos seis meses** efectivamente
trabajados, sin los subsidios por incapacidad, y el salario diario sale de
dividir ese promedio entre **30,42**. La cesantía y el preaviso no son salario:
no pagan cargas sociales ni impuesto sobre la renta.

Ejemplo: con 5 años de antigüedad y un promedio de ₡900.000, el diario es
₡900.000 / 30,42 = ₡29.585,80, y la cesantía es 21,24 × 5 × ₡29.585,80.

**Todas se provisionan mensualmente**, según el mecanismo de
[08-modulo-rh §5](08-modulo-rh.md#5-provisiones). El aguinaldo es el caso más
claro: se devenga todo el año y se paga una vez.

### 6.4 Lo que falta confirmar antes de implementar

- ⚠️ El 1,00 % del INS dentro del 26,83 % (§6.1).
- ⚠️ El tope de la exención del aguinaldo (§6.3).
- ⚠️ La CCSS anunció una rebaja del aseguramiento para trabajadores menores de
  35 años reportados en jornada parcial. No se encontró el detalle vigente.
- Si las vacaciones pagadas al terminar la relación laboral llevan cargas
  sociales. Las fuentes consultadas no son oficiales y no coinciden.
- El formato del archivo de planilla que se sube a SICERE.

### 6.5 Fuentes

Consultadas en setiembre de 2026:

- EY, [aumento en cuotas obrero-patronales desde enero de 2026](https://www.ey.com/es_ce/technical/tax/tax-alerts/costa-rica-aumento-en-cuotas-obrero-patronales-aplicable-desde-enero-20261)
- Globalex, [ajuste en las cuotas obrero-patronales 2026](https://www.globalex.cr/post/ajuste-en-las-cuotas-obrero-patronales-2026)
- Alegra, [cargas sociales CCSS 2026](https://blog.alegra.com/costa-rica/cargas-sociales-ccss-2026-patronos-costa-rica/) y [cesantía y preaviso](https://blog.alegra.com/costa-rica/que-son-las-cesantias-calculo/)
- Globalex, [tramos del impuesto al salario 2026, Decreto 45333-H](https://www.globalex.cr/post/actualizacion-tramos-impuesto-salario-renta-creditos-fiscales-2026-costa-rica)
- BDS Asesores, [base mínima contributiva 2026](https://publicaciones.bdsasesores.com/blog/ccss-actualiza-base-minima-contributiva-a-partir-de-enero-2026)
- MTSS, [Código de Trabajo](https://www.mtss.go.cr/elministerio/marco-legal/documentos/Codigo_Trabajo_RPL.pdf)
- CCSS, [sección de patronos](https://www.ccss.sa.cr/patronos)
- Hacienda, [esquema de la factura electrónica v4.4](https://www.hacienda.go.cr/docs/FacturaElectronica_V4.4.xsd.xml) y [Anexos y estructuras v4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf)

Son fuentes secundarias, salvo el Código de Trabajo. Antes de pagar la primera
planilla real, cotejar contra el decreto publicado en La Gaceta y contra una
factura de la CCSS.

## 7. Tipo de cambio

Quien fija el tipo de cambio de referencia es el **Banco Central de Costa Rica
(BCCR)**, que publica **compra** y **venta**. Contikos lo toma del **Ministerio
de Hacienda**, que lo republica en dos endpoints abiertos, sin llave ni registro
previo:

```
GET https://api.hacienda.go.cr/indicadores/tc/dolar
GET https://api.hacienda.go.cr/indicadores/tc/euro
```

Las dos respuestas no tienen la misma forma:

```jsonc
// tc/dolar: compra y venta, cada una con su fecha
{ "venta":  { "fecha": "2026-08-27", "valor": 452.88 },
  "compra": { "fecha": "2026-08-27", "valor": 448.38 } }

// tc/euro: un solo valor en colones, y la paridad contra el dólar
{ "fecha": "2026-08-27", "dolares": 1.1653, "colones": 527.74 }
```

De esa diferencia salen tres reglas propias de esta fuente:

- **El euro se completa desde el dólar.** La fuente no publica su compra. El
  valor en colones que sí publica es la venta del dólar por la paridad
  (452,88 × 1,1653 = 527,74), así que la compra se obtiene aplicando esa misma
  paridad a la compra del dólar. La venta se guarda tal como se publica, no
  reconstruida. El par queda marcado como **derivado**: la compra del euro no es
  un dato oficial, es una deducción de dos que sí lo son
- **Por esta vía no hay serie histórica.** `tc/dolar/2026-08-20` responde 404:
  los endpoints solo dan la publicación vigente. La tabla `TipoCambio` de
  [10-modelo-datos §2](10-modelo-datos.md#2-núcleo-transversal) se puebla
  capturando día a día, no importando el pasado. Si hiciera falta historia
  (revaluación retroactiva, reproceso de un cierre), la fuente es el servicio de
  indicadores económicos del BCCR, que sí la expone
- **Los valores vienen en colones.** La tabla declara su moneda base en vez de
  darla por supuesta. Cuando la moneda funcional de la empresa no es el colón,
  el tipo sale de cruzar ambas monedas contra el colón, pata por pata (compra
  con compra, venta con venta), y ese cruce también es derivado

Y las reglas contables, que no dependen de la fuente:

- Registrar **compra y venta por separado**: el campo `tipo` de la tabla ya lo
  contempla
- El tipo de cambio se **congela en el asiento**. Corregir la tabla después no
  altera asientos históricos: traer el tipo de cambio del día actualiza la
  referencia del catálogo de monedas, nunca un asiento ya emitido
- Las operaciones en dólares son muy comunes en Costa Rica. La diferencia
  cambiaria **no es un caso de borde aquí, es el caso normal**: conviene
  probarla desde el primer día del módulo de CxC

**Quién llama a Hacienda.** El servidor, no la aplicación. Ningún módulo
consulta la fuente: llaman a `obtenerTipoCambio` de la interfaz de §8. Mientras
el backend no exista ese papel lo hace el mock
(`frontend/src/mocks/hacienda.ts`, que en pruebas responde con valores fijos y
no sale a la red), y las reglas de conversión ya viven en el dominio
(`frontend/src/shared/fiscal/tipoCambio.ts`), que es lo que el backend heredará
el día que se escriba.

## 8. Interfaz `LocalizacionFiscal`

Lo que la implementación costarricense debe proveer:

```
LocalizacionFiscalCR
├── validarIdentificacion(tipo, numero) → bool
├── tarifasImpuesto(fecha) → Tarifa[]
├── calcularImpuestos(lineas, fecha) → DesgloseImpuestos
├── retencionesAplicables(proveedor, tipoGasto, fecha) → Retencion[]
├── generarClaveNumerica(datos) → string(50)
├── generarConsecutivo(sucursal, terminal, tipoDoc) → string(20)
├── construirXml(documento) → xml
├── firmar(xml, llave, pin) → xmlFirmado
├── enviarAHacienda(xmlFirmado) → Acuse
├── consultarEstado(clave) → EstadoHacienda
├── responderComprobanteRecibido(clave, respuesta) → Acuse
├── tarifasSeguridadSocial(fecha) → TarifasCCSS
├── tablaImpuestoRenta(fecha) → TramoRenta[]
└── obtenerTipoCambio(fecha, tipo) → decimal
```

Ningún módulo llama a Hacienda ni conoce el formato del XML. Solo llama a esta
interfaz.

## 9. Impacto en el roadmap

Ajustes a [11-roadmap](11-roadmap.md) derivados de esta localización:

| Fase | Ajuste |
|---|---|
| **Fase 0** | Añadir: plantilla de catálogo NIIF para PYMES; validación de cédulas; formato es-CR y ₡ |
| **Fase 2 (CxC)** | Ampliar: el ciclo de comprobantes electrónicos (generar, firmar, enviar, consultar, contingencia) es un subproyecto en sí mismo. **El REP obliga a emitir comprobante también al cobrar** |
| **Fase 3 (CxP)** | Añadir: buzón de comprobantes recibidos con aceptación / rechazo ante Hacienda |
| **Fase 4 (Bancos)** | Elevar prioridad de multimoneda: CRC/USD es el escenario habitual, no la excepción |
| **Fase 5 (Reportes)** | Añadir: soporte a D-104 y D-101; estados financieros bajo NIIF |
| **Fase 7 (RH)** | D-06 resuelta: se calcula internamente. CCSS, SICERE, ISR salario y provisión de aguinaldo, vacaciones y cesantía, todo como parámetros con vigencia (§6) |

## 10. Fuentes a consultar antes de implementar

Este documento es un mapa, no una fuente normativa. Verificar contra:

- Ministerio de Hacienda — resoluciones de la DGT sobre comprobantes electrónicos
  (esquemas XSD, catálogos, versión vigente)
- Ley 9635 y su reglamento, para IVA
- CCSS — tarifas vigentes de la planilla
- BCCR — servicio de indicadores económicos, para el tipo de cambio histórico
- API de indicadores del Ministerio de Hacienda (`/indicadores/tc`), para el
  tipo de cambio del día
- Código de Trabajo, para prestaciones laborales
