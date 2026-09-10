# 11 — Roadmap

## 1. Orden de dependencias

No es negociable: cada fase necesita la anterior.

```
Fase 1  Núcleo            ← todo lo demás depende de esto
   │
   ├─► Fase 2  CxC        ← primero, porque valida el contrato de asientos
   │      │
   │      ├─► Fase 3  CxP
   │      │
   │      └─► Fase 4  Bancos   ← necesita cobros (cxc) y pagos (cxp)
   │
   ├─► Fase 5  Reportes   ← puede empezar en paralelo tras Fase 1
   │
   ├─► Fase 6  Activos
   │
   └─► Fase 7  RH         ← el último: mayor complejidad legal, menor acoplamiento
```

**Reportes puede arrancar en paralelo desde la Fase 2** — la balanza de
comprobación es la herramienta con la que se verifica que todo lo demás está
bien. Conviene tenerla temprano aunque sea en versión mínima.

## 2. Fases

### Fase 0 — Fundaciones

Antes de cualquier módulo:

- [x] Decidir stack y país ([12-decisiones-pendientes](12-decisiones-pendientes.md))
- [ ] Estructura del repositorio y de módulos
- [ ] Base de datos, migraciones, entorno local
- [ ] Autenticación y RBAC por empresa
- [x] Multiempresa: filtro obligatorio a nivel de repositorio (en el frontend y
      el mock: cabecera de empresa obligatoria, catálogo de empresas, cambio de
      empresa y directorio de terceros del grupo; el backend hereda el contrato)
- [ ] Tipo decimal y utilidades de redondeo por moneda
- [ ] Bitácora de auditoría transversal
- [ ] CI: pruebas, lint, migraciones

El tipo decimal y el filtro de empresa son las dos piezas que **no** se pueden
retrofitear. Vale la pena hacerlas bien aquí.

### Fase 1 — Núcleo contable (`conta`)

- [ ] Catálogo de cuentas con jerarquía, alta/baja/edición
- [ ] Periodos: apertura, cierre, bloqueo
- [ ] Servicio de asientos con las 11 validaciones del contrato
- [ ] Idempotencia por clave de origen
- [ ] Reversas
- [ ] Saldos materializados + proceso de recálculo desde detalle
- [ ] Asiento manual con permisos
- [ ] Centros de costo
- [ ] Monedas y tipos de cambio
- [ ] Motor de reglas de mapeo
- [ ] Balanza de comprobación (mínima, para verificar)
- [ ] Doble libro: mayor y balanza por contabilidad fiscal y corporativa (D-11)

**Criterio de terminado:** se puede capturar una asiento manual, aparece en la
balanza, la balanza cuadra en los dos libros, un periodo cerrado rechaza
asientos, y una reversa deja el saldo en cero.

### Fase 2 — CxC

- [ ] Clientes
- [ ] Facturas: captura, validación, contabilización
- [ ] Notas de crédito
- [ ] Cobros con aplicación N a N
- [ ] Anticipos
- [ ] Diferencia cambiaria realizada
- [ ] Cancelación con reversa
- [ ] Antigüedad de saldos
- [ ] Estado de cuenta por cliente
- [ ] Verificación auxiliar vs mayor
- [ ] Facturación electrónica (depende del país)

**Criterio de terminado:** el aging a cualquier fecha de corte cuadra exactamente
contra la cuenta de control de clientes en el mayor.

Esta fase es la que **valida el diseño del contrato de asientos**. Si aquí
aparecen fricciones, hay que corregir el contrato antes de seguir, no después de
tener cinco módulos construidos sobre él.

### Fase 3 — CxP

- [ ] Proveedores
- [ ] Facturas de proveedor con anti-duplicados
- [ ] Flujo de autorización por niveles
- [ ] Pagos con aplicación N a N
- [ ] Anticipos a proveedores
- [ ] Retenciones (depende del país)
- [ ] Provisiones de cierre con reversa automática
- [ ] Antigüedad de saldos por proveedor
- [ ] Propuesta de pago
- [ ] Órdenes de compra y three-way match *(opcional, puede diferirse)*

### Fase 4 — Bancos

- [x] Cuentas bancarias
- [x] Movimientos propios y desde otros módulos
- [x] Comisiones, intereses, traspasos
- [x] Importación de estado de cuenta (CSV genérico, tras una interfaz por banco)
- [x] Emparejamiento automático en cascada
- [x] Conciliación manual y partidas conciliatorias
- [x] Cierre de conciliación con verificación de diferencia cero
- [x] Revaluación de moneda extranjera, enganchada al checklist de cierre
- [x] Posición de tesorería
- [ ] Flujo de efectivo proyectado — su tercera pata es la nómina, que no existe

### Fase 5 — Reportes

- [ ] Balanza de comprobación completa, con niveles
- [ ] Auxiliar de cuenta con drill-down al documento origen
- [ ] Libro diario y libro mayor
- [ ] Balance General
- [ ] Estado de Resultados
- [ ] Comparativos entre periodos
- [ ] Motor de plantillas configurables
- [ ] Exportación a PDF y Excel
- [ ] Estado de Flujo de Efectivo
- [ ] Estado de Cambios en el Capital
- [ ] Exportación fiscal (depende del país)

### Fase 6 — Activos fijos

- [ ] Categorías
- [ ] Alta manual y alta desde factura de CxP
- [ ] Corrida de depreciación idempotente por periodo
- [ ] Métodos: línea recta primero, los demás después
- [ ] Mejoras y capitalización
- [ ] Bajas y ventas
- [ ] Cédula de depreciación
- [ ] Verificación auxiliar vs mayor
- [ ] Depreciación fiscal paralela *(si se decidió incluirla — ver §5 de [07](07-modulo-activos.md))*

### Fase 7 — RH / Nómina

- [ ] Empleados
- [ ] Catálogo de conceptos con cuentas
- [ ] Periodos de nómina e incidencias
- [ ] Motor de cálculo local (o integración con proveedor externo)
- [ ] Revisión comparativa contra periodo anterior
- [ ] Asiento de nómina con aportaciones patronales
- [ ] Dispersión y archivo bancario
- [ ] Provisiones de prestaciones
- [ ] Recibo electrónico (depende del país)
- [ ] Control de acceso reforzado

### Fase 8 — Cierre y consolidación

- [ ] Checklist de cierre mensual con semáforos
- [ ] Cierre de ejercicio y asiento de apertura
- [ ] Verificaciones automáticas de integridad, programadas
- [ ] Panel de control con indicadores clave

## 3. Qué queda fuera del alcance inicial

Deliberadamente, para no diluir el esfuerzo:

- Inventarios y costeo
- Punto de venta
- Presupuestos
- Proyectos / contabilidad por obra
- Consolidación multiempresa
- Aplicación móvil
- Portal de clientes y proveedores
- Integración bancaria por API

Todos son módulos satélite adicionales. Si la arquitectura del §2 de
[01-arquitectura](01-arquitectura.md) se respeta, cualquiera de ellos se conecta
después sin tocar el núcleo. Ese es precisamente el punto del diseño.

## 4. Estrategia de pruebas

En software contable, las pruebas no son opcional. Mínimos por fase:

| Nivel | Qué cubre |
|---|---|
| **Unitarias de dominio** | Cuadre de asientos, cálculo de depreciación, aging, redondeo |
| **De integración por módulo** | Documento → asiento → saldo, en transacción real |
| **De invariantes** | La balanza cuadra; el auxiliar cuadra contra el mayor; los saldos materializados coinciden con el recálculo desde detalle |
| **De regresión con casos reales** | Un juego de datos de un mes completo, con resultado esperado fijo |

Las **pruebas de invariantes** son las más valiosas: se corren sobre datos
generados aleatoriamente y detectan clases enteras de bugs que las pruebas por
caso no ven.
