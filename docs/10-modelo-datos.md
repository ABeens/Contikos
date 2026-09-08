# 10 — Modelo de datos

Vista consolidada de las entidades. Independiente del motor de base de datos y
del ORM.

## 1. Convenciones

| Regla | Razón |
|---|---|
| Todo importe es `DECIMAL(19,4)` | Punto flotante en contabilidad = descuadres |
| Toda tabla transaccional lleva `empresa_id` | Multiempresa; filtro obligatorio en repositorio |
| Toda tabla lleva `creado_en`, `creado_por`, `modificado_en`, `modificado_por` | Auditoría |
| No hay `DELETE` en tablas transaccionales | Baja lógica o reversa |
| Fechas contables sin hora; marcas de auditoría con hora y zona | La fecha contable es un día, no un instante |
| Los identificadores externos (folios) son distintos de la llave primaria | El folio es dato de negocio, la PK es técnica |

## 2. Núcleo transversal

```
Empresa                                    ← del grupo, no de una empresa
  id, codigo, nombre, nombre_comercial,
  tipo_identificacion, identificacion_fiscal,
  pais, ejercicio_inicio_mes, activa
  UNIQUE (codigo), UNIQUE (tipo_identificacion, identificacion_fiscal)
  La moneda funcional NO está aquí: es la marcada en el catálogo Moneda de
  cada empresa (docs/14 §4.3). Tenerla dos veces acaba en dos valores.

Usuario
  id, email, nombre, activo

UsuarioEmpresa
  usuario_id, empresa_id, rol_id           ← el rol es POR empresa

Rol / Permiso / RolPermiso
  RBAC estándar

CentroCosto
  id, empresa_id, codigo, nombre, padre_id, activo

DirectorioTerceros                         ← VISTA, no tabla (docs/12 D-12)
  tipo_identificacion, identificacion, razon_social, nombre_comercial, correo,
  apariciones[] { empresa_id, rol cliente|proveedor, codigo }
  Se deriva de Cliente y Proveedor de las empresas activas. Nada se guarda a
  nivel de grupo; nada se cruza. Es lo que permite dar de alta en una
  empresa un tercero que otra ya conoce sin teclear la cédula otra vez.

Moneda
  codigo (ISO 4217), nombre, decimales

TipoCambio
  empresa_id, moneda, fecha, tipo, valor
  UNIQUE (empresa_id, moneda, fecha, tipo)

Bitacora                                   ← inmutable, solo INSERT
  id, empresa_id, usuario_id, fecha_hora,
  entidad, entidad_id, accion, valor_anterior, valor_nuevo, ip
```

## 3. Contabilidad (`conta`)

```
Cuenta
  id, empresa_id, codigo, nombre, cuenta_padre_id, nivel,
  naturaleza, tipo, es_detalle, requiere_auxiliar,
  es_cuenta_control, modulo_dueno, moneda, activa,
  clasificacion_niif_id, nota_eeff_id        ← presentación; obligatorios si es_detalle,
                                               vacíos si no (docs/03 §2 bis)
  UNIQUE (empresa_id, codigo)

ClasificacionNiif                            ← renglón del estado financiero
  id, empresa_id, codigo, nombre, estado_financiero,
  tipos_cuenta[], seccion_niif, orden, activa
  UNIQUE (empresa_id, codigo)

NotaEeff                                     ← subcategoría de la anterior
  id, empresa_id, clasificacion_niif_id, numero, literal,
  titulo, descripcion, activa
  UNIQUE (empresa_id, numero, literal)       la referencia citada: 7, 1a, 16b

Periodo
  id, empresa_id, ejercicio, numero,
  fecha_inicio, fecha_fin, estado
  UNIQUE (empresa_id, ejercicio, numero)

Asiento
  id, empresa_id, periodo_id, numero, fecha, concepto,
  origen_modulo, origen_tipo, origen_id,
  moneda, tipo_cambio, estado, reversa_de_id,
  creado_por, creado_en
  UNIQUE (empresa_id, ejercicio, numero)                      ← consecutivo único
  UNIQUE (empresa_id, origen_modulo, origen_tipo, origen_id)  ← idempotencia

LineaAsiento
  id, asiento_id, orden, cuenta_id, concepto,
  cargo, abono, importe_origen,
  afecta_fiscal, afecta_corporativo,          ← al menos uno true; ambos por defecto
  centro_costo_id, auxiliar_tipo, auxiliar_id
  INDEX (cuenta_id, asiento_id)
  CHECK (afecta_fiscal OR afecta_corporativo)

  Dos banderas y no una tabla `linea_libro`: son exactamente dos libros y la
  cardinalidad no va a crecer. Una tabla puente costaría un join en la consulta
  más caliente del sistema (armar el mayor) a cambio de una flexibilidad que
  nadie va a usar.

SaldoCuenta                                ← materializado
  empresa_id, cuenta_id, periodo_id, libro, auxiliar_tipo, auxiliar_id, centro_costo_id,
  saldo_inicial, cargos, abonos, saldo_final
  UNIQUE (empresa_id, cuenta_id, periodo_id, libro, auxiliar_tipo, auxiliar_id, centro_costo_id)
                                             ↑ el saldo es por libro (docs/02 §3.1)

ReglaMapeo
  id, empresa_id, modulo, evento, rol, criterio, cuenta_id, prioridad
```

## 4. Cuentas por cobrar (`cxc`)

```
Cliente            id, empresa_id, codigo, razon_social, identificacion_fiscal,
                   regimen_fiscal, direccion, condiciones_pago, dias_credito,
                   limite_credito, moneda_default, cuenta_id, vendedor_id, activo

ProductoServicio   id, empresa_id, codigo, nombre, descripcion, tipo,
                   precio_lista, moneda, tarifa_impuesto, cuenta_ingreso_id, activo
                   UNIQUE (empresa_id, codigo)
                   ← precarga la línea de factura; la línea sigue siendo editable

Factura            id, empresa_id, serie, folio, cliente_id,
                   fecha_emision, fecha_vencimiento, moneda, tipo_cambio,
                   subtotal, descuentos, impuestos, retenciones, total,
                   saldo_pendiente, estado, asiento_id, datos_fiscales
                   UNIQUE (empresa_id, serie, folio)

FacturaConcepto    id, factura_id, orden, producto_id, producto_codigo,
                   descripcion, cantidad, precio_unitario, descuento, importe,
                   cuenta_ingreso_id
                   ← producto_codigo va copiado: renombrar el catálogo no puede
                     cambiar lo que dice un comprobante ya emitido

FacturaImpuesto    id, factura_concepto_id, tipo, tasa, base, importe, es_retencion

Cobro              id, empresa_id, folio, cliente_id, fecha, forma_pago,
                   cuenta_bancaria_id, moneda, tipo_cambio, importe,
                   importe_sin_aplicar, estado, asiento_id

CobroAplicacion    id, cobro_id, factura_id, importe_aplicado, diferencia_cambiaria
                   ← relación N a N; NO un cobro_id en Factura

NotaCredito        misma forma que Factura, con tipo y aplicaciones
```

## 5. Cuentas por pagar (`cxp`)

```
Proveedor          id, empresa_id, codigo, razon_social, identificacion_fiscal,
                   regimen_fiscal, condiciones_pago, dias_credito,
                   moneda_default, cuenta_id, datos_bancarios,
                   retenciones_aplicables, activo

OrdenCompra        id, empresa_id, folio, proveedor_id, fecha, total, estado
OrdenCompraLinea   id, orden_compra_id, descripcion, cantidad, precio_unitario
Recepcion          id, orden_compra_id, fecha
RecepcionLinea     id, recepcion_id, orden_compra_linea_id, cantidad_recibida

FacturaProveedor   id, empresa_id, folio_interno, folio_proveedor, proveedor_id,
                   fecha_emision, fecha_vencimiento, moneda, tipo_cambio,
                   subtotal, impuestos, retenciones, total, saldo_pendiente,
                   estado, orden_compra_id, asiento_id
                   UNIQUE (empresa_id, proveedor_id, folio_proveedor)  ← anti-duplicados

Pago               id, empresa_id, folio, proveedor_id, fecha, forma_pago,
                   cuenta_bancaria_id, moneda, tipo_cambio, importe,
                   importe_sin_aplicar, estado, asiento_id

PagoAplicacion     id, pago_id, factura_proveedor_id, importe_aplicado,
                   diferencia_cambiaria

Autorizacion       id, entidad, entidad_id, nivel, usuario_id, fecha, decision, comentario
```

## 6. Bancos (`bancos`)

```
CuentaBancaria     id, empresa_id, banco, numero_cuenta, clabe_iban, tipo,
                   moneda, cuenta_id, activa

MovimientoBancario id, empresa_id, cuenta_bancaria_id, fecha, tipo, concepto,
                   referencia, importe, origen_modulo, origen_tipo, origen_id,
                   estado, asiento_id, conciliacion_id

MovimientoEstadoCuenta
                   id, empresa_id, cuenta_bancaria_id, fecha_operacion, fecha_valor,
                   descripcion, referencia, cargo, abono, saldo,
                   origen_carga, hash_dedup, conciliacion_id
                   UNIQUE (cuenta_bancaria_id, hash_dedup)   ← anti-duplicados en recarga

Conciliacion       id, empresa_id, cuenta_bancaria_id, periodo_id,
                   saldo_inicial_banco, saldo_final_banco, saldo_libros,
                   diferencia, estado

PartidaConciliatoria
                   id, conciliacion_id, tipo, descripcion, importe, resuelta
```

## 7. Activos fijos (`activos`)

```
CategoriaActivo    id, empresa_id, nombre, vida_util_meses, metodo_depreciacion,
                   porcentaje_residual, cuenta_activo_id,
                   cuenta_depreciacion_acumulada_id, cuenta_gasto_id, tasa_fiscal

Activo             id, empresa_id, codigo, nombre, categoria_id,
                   fecha_adquisicion, fecha_inicio_depreciacion,
                   costo_adquisicion, valor_residual, vida_util_meses,
                   metodo_depreciacion, depreciacion_acumulada, valor_en_libros,
                   ubicacion, responsable_id, centro_costo_id,
                   proveedor_id, factura_proveedor_id, numero_serie, estado

MovimientoActivo   id, activo_id, fecha, tipo, importe,
                   depreciacion_acumulada_antes, depreciacion_acumulada_despues,
                   valor_libros_antes, valor_libros_despues, asiento_id

CorridaDepreciacion
                   id, empresa_id, periodo_id, estado, total, asiento_id
                   UNIQUE (empresa_id, periodo_id)          ← idempotencia

CorridaDepreciacionDetalle
                   id, corrida_id, activo_id, importe
```

## 8. Nómina (`rh`)

```
Empleado           id, empresa_id, codigo, nombre, apellidos,
                   identificacion_personal, identificacion_fiscal,
                   numero_seguridad_social, fecha_ingreso, fecha_baja,
                   puesto, departamento, centro_costo_id, tipo_contrato,
                   salario_base, periodicidad, forma_pago, datos_bancarios, estado

ConceptoNomina     id, empresa_id, codigo, descripcion, tipo, formula,
                   grava_impuesto, integra_seguridad_social, cuenta_id, activo

PeriodoNomina      id, empresa_id, tipo, fecha_inicio, fecha_fin, fecha_pago,
                   estado, asiento_id

Incidencia         id, empresa_id, empleado_id, periodo_nomina_id, tipo,
                   fecha_inicio, fecha_fin, cantidad, documento_soporte

ReciboNomina       id, periodo_nomina_id, empleado_id,
                   total_percepciones, total_deducciones, neto_a_pagar,
                   datos_timbrado

ReciboLinea        id, recibo_id, concepto_id, tipo, base, importe
                   ← incluye aportaciones patronales, que NO afectan el neto

ProvisionPrestacion
                   id, empresa_id, empleado_id, tipo, periodo_id,
                   importe_provisionado, importe_acumulado
```

## 9. Índices críticos

Los que hacen la diferencia entre un sistema usable y uno inutilizable a los
dos años:

```
LineaAsiento      (empresa_id, cuenta_id, asiento_id)      → auxiliares de cuenta
Asiento           (empresa_id, fecha)                     → libro diario, cierre
Asiento           (empresa_id, origen_*)  UNIQUE          → idempotencia
SaldoCuenta      (empresa_id, periodo_id, cuenta_id)     → estados financieros
Factura          (empresa_id, cliente_id, estado)        → aging, estado de cuenta
Factura          (empresa_id, fecha_vencimiento, estado) → aging
FacturaProveedor (empresa_id, proveedor_id, estado)      → aging
MovimientoBancario (cuenta_bancaria_id, fecha, estado)   → conciliación
```

## 10. Restricciones que valen la pena en la base de datos

No confiar solo en la aplicación:

```sql
CHECK (cargo >= 0 AND abono >= 0)
CHECK ((cargo > 0 AND abono = 0) OR (abono > 0 AND cargo = 0))
CHECK (tipo_cambio > 0)
CHECK (saldo_pendiente >= 0)
CHECK (fecha_vencimiento >= fecha_emision)
CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_ingreso)
```

El cuadre del asiento (`Σ cargos = Σ abonos`) no se puede expresar como CHECK de
fila; va en un trigger diferido o en la capa de aplicación dentro de la
transacción. **Recomendación:** trigger diferido — es la única garantía que
sobrevive a un script de migración mal escrito.
