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

### 6.1 Cargas sociales ⚠️

⚠️ **Verificar todas las tasas contra la CCSS antes de implementar.** Cambian por
acuerdo de Junta Directiva, y el IVM tiene aumentos escalonados programados.

**Aporte del trabajador — aproximadamente 10,67% del salario bruto**

| Concepto | Tasa aprox. |
|---|---|
| SEM (Seguro de Enfermedad y Maternidad) | 5,50% |
| IVM (Invalidez, Vejez y Muerte) | 4,17% |
| Banco Popular | 1,00% |

**Aporte patronal — aproximadamente 26,5% del salario bruto**, distribuido entre
SEM, IVM, Banco Popular, Asignaciones Familiares (FODESAF), IMAS, INA, Fondo de
Capitalización Laboral y Régimen Obligatorio de Pensiones.

Adicionalmente, la **póliza de riesgos del trabajo del INS** es un costo patronal
separado, con tarifa según la actividad de la empresa.

> Recordatorio del diseño: el aporte patronal **es gasto de la empresa y no se
> descuenta al trabajador**. El asiento de nómina siempre es mayor que la suma de
> los recibos. Ver [08-modulo-rh §2](08-modulo-rh.md#2-entidades).

### 6.2 Impuesto sobre la renta del trabajo ⚠️

Escala progresiva mensual en colones, con un tramo exento y tramos crecientes.
Los montos de los tramos **se actualizan anualmente por decreto**.

Modelar como tabla con vigencia por periodo. Nunca en código.

Créditos fiscales por cónyuge e hijos, también actualizables por decreto.

### 6.3 Prestaciones legales

| Prestación | Regla |
|---|---|
| **Aguinaldo** | Un doceavo de lo devengado entre el 1 de diciembre y el 30 de noviembre. Se paga dentro de los primeros 20 días de diciembre. **Exento de cargas sociales e impuesto** |
| **Vacaciones** | Dos semanas por cada 50 semanas de trabajo continuo |
| **Cesantía** | Según años de servicio, con tope legal. Se provisiona |
| **Preaviso** | Según antigüedad, en caso de terminación |

**Todas se provisionan mensualmente**, según el mecanismo de
[08-modulo-rh §5](08-modulo-rh.md#5-provisiones). El aguinaldo es el caso más
claro: se devenga todo el año y se paga una vez.

### 6.4 Recomendación sobre el alcance de nómina

Se mantiene la recomendación de **D-06**: dado el volumen de tablas a mantener
(CCSS, ISR salario, créditos, topes) y la responsabilidad legal de un error,
evaluar seriamente integrarse con un proveedor de planilla local y conservar en
Contikos la contabilización, las provisiones y los reportes.

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
| **Fase 7 (RH)** | Confirmar D-06 antes de arrancar. Si se calcula internamente: CCSS, SICERE, ISR salario y provisión de aguinaldo, vacaciones y cesantía |

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
