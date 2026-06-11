# API Documentation - Control de Obra

## Supabase Tables

### obras
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| id | integer | ID unico |
| codigo_obra | text | Codigo identificador |
| nombre_obra | text | Nombre del proyecto |
| presupuesto_total | numeric | Presupuesto asignado |
| estatus | text | Estado: Activa, En Proceso, Pausada, Completada |
| fecha_inicio | date | Fecha de inicio |
| fecha_fin_estimada | date | Fecha estimada de fin |
| responsable | text | Responsable del proyecto |
| ubicacion | text | Ubicacion de la obra |
| avance_porcentaje | numeric | Porcentaje de avance |
| empresa_id | integer | ID de la empresa |

### gastos
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| id | integer | ID unico |
| obra_id | integer | FK a obras |
| fecha_solicitud | date | Fecha del gasto |
| monto_neto | numeric | Monto total |
| categoria | text | Categoria del gasto |
| estatus_pago | text | Pagado, Pendiente, Cancelado |
| proveedor_id | integer | FK a proveedores |
| descripcion | text | Descripcion del gasto |
| empresa_id | integer | ID de la empresa |

### ordenes_compra
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| id | integer | ID unico |
| codigo_orden | text | Codigo de la orden |
| obra_id | integer | FK a obras |
| proveedor_id | integer | FK a proveedores |
| monto_estimado | numeric | Monto estimado |
| estatus | text | Pendiente, Aprobada, En Proceso, Completada |
| fecha_orden | date | Fecha de la orden |
| empresa_id | integer | ID de la empresa |

### estimaciones
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| id | integer | ID unico |
| obra_id | integer | FK a obras |
| numero_estimacion | integer | Numero secuencial |
| periodo_inicio | date | Inicio del periodo |
| periodo_fin | date | Fin del periodo |
| monto_periodo | numeric | Monto del periodo |
| monto_acumulado | numeric | Monto acumulado |
| porcentaje_avance | numeric | Porcentaje de avance |
| estatus | text | Borrador, Presentada, Aprobada, Rechazada |
| empresa_id | integer | ID de la empresa |

### empleados
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| id | integer | ID unico |
| nombre_completo | text | Nombre del empleado |
| puesto | text | Puesto/cargo |
| estatus | text | Activo, Inactivo, Vacaciones, Baja |
| sueldo_base | numeric | Sueldo base |
| obra_asignada | integer | FK a obras |
| empresa_id | integer | ID de la empresa |

### proveedores
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| id | integer | ID unico |
| nombre_proveedor | text | Nombre comercial |
| rfc | text | RFC fiscal |
| tipo | text | Materiales, Servicios, Maquinaria, Subcontratista |
| estatus | text | Activo, Inactivo, Suspendido |
| empresa_id | integer | ID de la empresa |

## Autenticacion

El sistema usa autenticacion personalizada con la tabla `obra_usuarios`:

```javascript
// Login
const { data } = await supabase
  .from('obra_usuarios')
  .select('*, obra_roles(*)')
  .eq('email', email)
  .single();

// Verificar password con bcrypt
const valid = await bcrypt.compare(password, data.password_hash);
```

## Roles y Permisos

### Niveles de acceso
- 100: Admin General
- 90: Gerente de Obra
- 80: Supervisor General
- 70: Contador
- 60: Residente de Obra
- 50: Inspector de Calidad
- 30: Trabajador

## Endpoints Supabase

Base URL: `https://[PROJECT_REF].supabase.co`

### Consultas comunes

```javascript
// Obtener obras de una empresa
const { data } = await supabase
  .from('obras')
  .select('*')
  .eq('empresa_id', empresaId)
  .order('created_at', { ascending: false });

// Obtener gastos con filtro
const { data } = await supabase
  .from('gastos')
  .select('*, obras(nombre_obra), proveedores(nombre_proveedor)')
  .eq('obra_id', obraId)
  .order('fecha_solicitud', { ascending: false });
```
