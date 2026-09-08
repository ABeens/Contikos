# 08 — Módulo `rh` (Recursos Humanos / Nómina)

El módulo más dependiente de la legislación local y el de mayor riesgo: un error
aquí afecta a personas, genera multas y es visible de inmediato.

## 1. Advertencia de alcance

La nómina es **el módulo menos portable de todos**. Cambian por país:

- Tablas de impuesto sobre la renta y subsidios
- Aportaciones de seguridad social (empleado y patrón), con topes y bases distintas
- Prestaciones obligatorias (aguinaldo, primas, cesantías, pagas extra)
- Cálculo de vacaciones y su prima
- Indemnizaciones por terminación
- Recibos electrónicos de nómina
- Declaraciones informativas

**Recomendación:** no implementar RH hasta que el núcleo, CxC, CxP y bancos estén
estables. Y considerar seriamente integrarse con un proveedor de nómina local en
lugar de calcular impuestos propios — el mantenimiento de tablas fiscales es
permanente y un error tiene consecuencias legales.

Si se implementa, **toda la lógica de cálculo va tras una interfaz
`MotorNominaLocal`**, con una implementación por país.

## 2. Entidades

```
Empleado
├── codigo / nombre completo
├── identificacion_personal / identificacion_fiscal
├── numero_seguridad_social
├── fecha_ingreso / fecha_baja
├── puesto / departamento / centro_costo
├── tipo_contrato              indefinido | temporal | por_obra
├── jornada                    completa | parcial
├── salario_base / periodicidad
├── forma_pago / datos_bancarios
├── beneficiarios[]
└── estado                     activo | baja | incapacidad | permiso

ConceptoNomina
├── codigo / descripcion
├── tipo                       percepcion | deduccion | provision | aportacion_patronal
├── formula                    fija | porcentaje | por_hora | calculada_por_motor
├── grava_impuesto             bool
├── integra_seguridad_social   bool
├── cuenta_contable            ← el mapeo vive aquí
└── activo

PeriodoNomina
├── tipo                       semanal | quincenal | mensual
├── fecha_inicio / fecha_fin / fecha_pago
├── estado                     abierto|calculado|autorizado|contabilizado|pagado|timbrado
└── empleados_incluidos[]

Incidencia
├── empleado_id / periodo_nomina_id
├── tipo                       falta | incapacidad | vacaciones | horas_extra | permiso | bono
├── fecha_inicio / fecha_fin / cantidad
└── documento_soporte

ReciboNomina
├── empleado_id / periodo_nomina_id
├── percepciones[]  / deducciones[]
├── total_percepciones / total_deducciones / neto_a_pagar
├── aportaciones_patronales[]  ← no van en el recibo, sí en el asiento
└── datos_timbrado             si el país lo exige
```

**Nota clave:** las aportaciones patronales **no** se descuentan al empleado pero
**sí** son gasto de la empresa. Confundir esto es el error más común al modelar
nómina: el asiento contable siempre es mayor que la suma de los recibos.

## 3. Flujo del periodo

```
abrir → capturar incidencias → calcular → revisar → autorizar
      → contabilizar → dispersar → timbrar/declarar → cerrar
```

| Paso | Qué ocurre |
|---|---|
| **Abrir** | Se determina qué empleados entran (activos en el rango) |
| **Incidencias** | Faltas, incapacidades, vacaciones, horas extra, bonos |
| **Calcular** | El motor local aplica percepciones, deducciones, impuestos, aportaciones |
| **Revisar** | Comparativo contra el periodo anterior — variaciones fuera de rango se marcan |
| **Autorizar** | Bloquea el cálculo. Requiere permiso específico |
| **Contabilizar** | Genera el asiento (§4) |
| **Dispersar** | Genera el archivo de pago para el banco; publica evento a `bancos` |
| **Timbrar** | Si el país exige recibo electrónico |

El paso de **revisión comparativa** vale mucho: el 90% de los errores de nómina
aparecen como una variación inexplicable contra el periodo anterior.

## 4. Asiento de nómina

Un solo asiento por periodo, con líneas agrupadas por concepto y centro de costo:

| Cuenta | Cargo | Abono |
|---|---|---|
| Sueldos y salarios (gasto) | Percepciones gravadas y exentas | |
| Otras percepciones (gasto) | Bonos, horas extra, primas | |
| Aportaciones patronales (gasto) | Cuota patronal | |
| Impuestos retenidos por pagar | | Retención de ISR/IRPF |
| Aportaciones de seguridad social por pagar | | Parte empleado + parte patrón |
| Otras deducciones por pagar | | Préstamos, pensiones, sindicato |
| Sueldos por pagar (auxiliar: empleado) | | Neto a pagar |

Al dispersar el pago:

| Cuenta | Cargo | Abono |
|---|---|---|
| Sueldos por pagar (auxiliar: empleado) | Neto | |
| Bancos | | Neto |

**Verificación de integridad:** el saldo de "Sueldos por pagar" debe ser cero
después de dispersar. Si no lo es, hay empleados sin pagar o una dispersión mal
aplicada.

## 5. Provisiones

Prestaciones que se devengan mes a mes aunque se paguen una vez al año
(aguinaldo, prima vacacional, cesantías, pagas extra). Se provisionan
mensualmente:

| Cuenta | Cargo | Abono |
|---|---|---|
| Gasto por prestaciones | 1/12 del estimado anual | |
| Provisión de prestaciones (pasivo) | | 1/12 del estimado anual |

Al pagar, se aplica contra la provisión, no contra gasto. Si la provisión quedó
corta o larga, la diferencia va a resultado del periodo.

El sistema debe calcular la provisión automáticamente y alertar si la provisión
acumulada se desvía del pasivo real estimado.

## 6. Reportes

- Recibo individual por empleado
- Resumen de nómina por periodo (percepciones, deducciones, neto, aportaciones)
- Costo de nómina por centro de costo / departamento
- Comparativo entre periodos con detección de variaciones
- Provisiones acumuladas vs pasivo estimado
- Impuestos y aportaciones a pagar por periodo, con fecha límite
- Antigüedad y saldo de vacaciones por empleado
- Declaraciones informativas del país

## 7. Seguridad

RH es el módulo con el control de acceso más estricto del sistema:

- El acceso a datos salariales se otorga individualmente, no por rol general
- Un empleado con acceso al módulo no debe poder ver su propio registro sin
  permiso explícito (evita autoedición de salario)
- Toda consulta a datos salariales queda en bitácora
- Los reportes de nómina se marcan como confidenciales
- Los datos personales de empleados están sujetos a la ley de protección de datos
  del país: derecho de acceso, rectificación y supresión, y política de retención

## 8. Reglas de mapeo contable

El mapeo vive en el catálogo de conceptos: cada `ConceptoNomina` lleva su cuenta.
Esto lo hace más flexible que en otros módulos — añadir un concepto nuevo no
requiere tocar reglas de mapeo, solo darlo de alta con su cuenta.

Las cuentas de contrapartida (sueldos por pagar, bancos) sí se resuelven por
regla de mapeo del módulo.
