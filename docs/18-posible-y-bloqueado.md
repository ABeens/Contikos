# 18. Qué se puede hacer y qué está bloqueado

Fotografía a finales de setiembre de 2026, después de construir lo que no
esperaba ninguna respuesta. Separa lo pendiente en dos grupos: lo que se puede
construir sin preguntar nada, y lo que espera una respuesta antes de empezar.

El plan de cada módulo está en [17](17-plan-modulos-faltantes.md) y las
decisiones en [12](12-decisiones-pendientes.md).

## 1. Lo que ya existe

Contabilidad general, CxC, CxP, bancos, activos fijos, diferidos, multiempresa y
configuración, más lo construido en esta tanda:

| Qué | Dónde se explica |
|---|---|
| Estados financieros: situación, resultados, flujos y cambios en el patrimonio, con comparativo, drill-down, CSV e impresión | [09 §10](09-modulo-reportes.md#10-cómo-quedó-construido-setiembre-de-2026) |
| Libro diario, libro mayor y auxiliar de cuenta | [09 §10](09-modulo-reportes.md#10-cómo-quedó-construido-setiembre-de-2026) |
| Comparativo fiscal contra corporativo | [09 §10](09-modulo-reportes.md#10-cómo-quedó-construido-setiembre-de-2026) |
| Cierre de ejercicio | [03 §6](03-modulo-contabilidad.md#6-cierre-de-ejercicio) |
| Notas de crédito | [04 §2.3](04-modulo-cxc.md#23-nota-de-crédito) |
| Clave numérica del comprobante | [13 §4.2](13-localizacion-costa-rica.md#42-numeración) |
| Autenticación y roles por empresa, con catálogo de usuarios | [17 §6](17-plan-modulos-faltantes.md#6-autenticación-y-control-de-acceso) |
| Recursos humanos con cálculo propio y parámetros de ley con vigencia | [08 §9](08-modulo-rh.md#9-cómo-quedó-construido-setiembre-de-2026) |
| Flujo de efectivo proyectado | [06 §3](06-modulo-bancos.md#3-flujo-de-efectivo-proyectado) |

## 2. Posible hoy, sin esperar respuestas

Lo que queda y no depende de nadie. Ninguno es difícil de decidir; varios son
grandes de hacer.

| # | Qué | Qué hace falta | Referencia |
|---|---|---|---|
| 1 | Catálogo geográfico oficial | Cargar la "Codificación de ubicación" que publica Hacienda con los anexos v4.4 (más de 480 distritos) | [13 §4](13-localizacion-costa-rica.md) |
| 2 | Datos del emisor y CABYS | Capturar actividad económica, ubicación y correo de la empresa, y CABYS y unidad de medida por producto. Sin ellos el XML v4.4 no se puede armar | [13 §4.2](13-localizacion-costa-rica.md#42-numeración) |
| 3 | RH: liquidaciones, aguinaldo de diciembre, incapacidades | Lo que el motor todavía no hace | [08 §9](08-modulo-rh.md#9-cómo-quedó-construido-setiembre-de-2026) |
| 4 | Recibo de planilla en PDF | Solo presentación | [08 §6](08-modulo-rh.md#6-reportes) |
| 5 | Saldos materializados | Deuda consciente: los reportes suman movimientos | [09 §9](09-modulo-reportes.md#9-consideraciones-de-rendimiento) |
| 6 | Backend real | Base de datos, migraciones y API contra los contratos de `shared/api/contracts` | [14 §2.3](14-arquitectura-frontend.md) |

## 3. Bloqueado, esperando una respuesta

### 3.1 D-06: nómina propia o proveedor externo (resuelta)

**Respuesta:** la nómina se calcula dentro de Contikos, con los parámetros de ley
administrados en la aplicación. Ya está construida (§1).

### 3.2 D-09: motor de reportes configurables

**Bloquea:** la etapa 7 de reportes. No bloquea los estados formales, que ya
existen.

**Pregunta:** ¿Hace falta que el usuario arme sus propios reportes, o bastan los
formales con su formato fijo? Ahora se puede contestar viéndolos funcionar.

### 3.3 Inventarios

**Bloquea:** el módulo entero. No tiene diseño y está fuera del alcance inicial.

**Preguntas**, las cuatro antes de diseñar nada:

1. ¿La venta descarga existencias? Si es sí, cada factura de venta genera además
   un asiento de costo de ventas, y eso toca CxC.
2. ¿Qué método de costeo: promedio ponderado, PEPS o costo estándar?
3. ¿Inventario perpetuo o periódico?
4. ¿Hay producción? Si es sí, es costeo de manufactura, otro proyecto.

**Recomendación:** no contestarlas hasta que el negocio lo pida.

### 3.4 D-07: componentes de activo

**Bloquea:** las bajas y ventas de activo, que no se construyeron por esto.

**Pregunta:** ¿Un activo puede depreciarse por partes con vidas útiles
distintas? Añadir componentes después obliga a migrar el histórico de
depreciación, y la baja parcial depende de la respuesta.

### 3.5 D-08: órdenes de compra y three-way match

**Bloquea:** nada. Es aditivo. **Recomendación registrada:** diferir.

### 3.6 Robot de tipo de cambio

**Pregunta:** ¿Se reactiva? Está en pausa por decisión propia (`TODO(robot)`).

### 3.7 Facturación electrónica: firma y envío

**Lo que falta:** el certificado de firma y las credenciales de Hacienda de cada
empresa, y decidir cómo se maneja la contingencia. Antes que eso, los datos del
§2 punto 2.

### 3.8 Lo que hay que confirmar antes de pagar una planilla real

No bloquea construir, pero sí usarlo en serio. Está en
[13 §6.4](13-localizacion-costa-rica.md#64-lo-que-falta-confirmar-antes-de-implementar):
el 1 % del INS, el tope exento del aguinaldo, la rebaja para menores de 35 años,
las cargas sobre vacaciones pagadas al salir y el formato de SICERE.

## 4. Cadena de desbloqueos

```
Posible hoy                              Espera respuesta
───────────                              ────────────────
Datos del emisor + CABYS ──┐
                           ├──► XML v4.4 ──► Firma y envío ◄── certificado y credenciales
Catálogo geográfico ───────┘
                    D-07 ──────────► Bajas y ventas de activo
                    D-09 ──────────► Motor de plantillas
                    Inventarios (4 preguntas) ──► Diseño ──► Módulo
```

## 5. Resumen

- **Para seguir sin preguntar nada:** los datos del emisor y el CABYS, que son
  la puerta de la facturación electrónica real.
- **La respuesta que más desbloquea ahora:** D-07, para cerrar activos fijos.
- **Lo que se puede dejar sin contestar:** D-08, D-09 e inventarios.
