# RLS por tabla (estado al 29 de agosto de 2026)

Regla general: toda tabla de Control de Obra con `empresa_id` tiene políticas `SELECT/INSERT/UPDATE/DELETE` con `empresa_id = control_obra.get_session_empresa_id()`. Las tablas hijas sin `empresa_id` heredan por `EXISTS` sobre su padre. Las vistas `public.*` son `security_invoker`, así que las políticas de `control_obra.*` aplican también a través de PostgREST.

## Tablas con política por empresa directa (ya existían, verificadas)

`obras`, `gastos`, `obra_usuarios`, `empresas` (`id = get_session_empresa_id()`), `clientes`, `proveedores`, `empleados`, `catalogo_conceptos`, `programas_obra`, `cuentas_por_cobrar`, `pagos_recibidos`, `pagos_proveedores`, `estimaciones`, `estimacion_partidas`, `ordenes_compra`, `facturas_recibidas`, `cfdis_emitidos`, `documentos`, `fotos_obra`, `bitacora_obra`, `rfis`, `punch_list`, `seguridad`, `materiales`, `materiales_movimientos`, `subcontratos`, `subcontratos_pagos`, `asistencia`, `nomina`, `nomina_distribucion`, `eventos_calendario`, `socios`, `movimientos_socio`, `repartos`, `finanzas_config`, `categorias_gasto`, `conciliaciones`, `cierres_mensuales`, `obra_modificaciones`, `declaraciones_mensuales`, `config_pac`, `empresa_modulos`, `empresa_config`, `audit_log`, `obra_sesiones`, `ui_events` (035), `cotizaciones` (035), `catalogo_conceptos_cot`, `plantillas_cotizacion`.

## Tablas hijas (035)

| Tabla | Padre | Política |
|---|---|---|
| `cotizacion_partidas` | `cotizaciones.empresa_id` | `cotp_all` |
| `actividades_programa`, `lineas_base` | `programas_obra.empresa_id` | `actp_all`, `lb_all` |
| `actividades_linea_base` | `lineas_base` → `programas_obra` | `alb_all` |
| `recursos_proyecto`, `calendario_proyecto`, `movimientos_fiscales`, `retenciones` | `obras.empresa_id` | `rp_all`, `calp_all`, `mf_all`, `ret_all` |
| `asignaciones_recurso` | `recursos_proyecto` → `obras` | `ar_all` |
| `gastos_admin_distribucion` | `gastos.empresa_id` | `gad_all` |
| `reparto_detalle`, `socios_historial` | `repartos` / `socios` (fase 2) | existentes |
| `obra_auditoria` | `obra_usuarios.empresa_id` | `oa_sel` (sólo lectura; escribe el trigger `log_audit`) |

## Catálogos compartidos (lectura pública, escritura de administrador)

`obra_roles` (sólo lectura), `dias_no_laborales`, `categorias_deduccion` (escritura con nivel ≥ 100), `subscription_plans` (`activo = true`), `config_templates` (`is_active`), catálogos de nómina en `public` (`cat_*`, `tasas_*`, `tablas_isr`, `catalogo_bancos`, `config_subsidio_empleo`): políticas `SELECT` únicamente.

## Denegar todo (sin políticas; sólo `service_role` desde Edge Functions o el VPS)

`public.app_secrets`, `public.email_log` (lectura por RPC `get_email_log`), `control_obra.tokens_correo`, `public.login_attempts` (escriben funciones definer), `public.platform_admins`, `public.platform_sessions`.

## Plataforma

`platform_errors`, `error_occurrences`: `INSERT` por RPC `log_client_error` (definer); `SELECT`/`UPDATE` sólo con `has_platform_session()`.

## Fuera de alcance (otros proyectos en el mismo Supabase)

`zook_*`, `mdv_*`, `sposa_products`, `ab_profiles`, `assistants`, `niche_templates`, `assistant_analytics`, `knowledge_entries`, `orders`, `subscriptions`, `client_instances`. No se modifican desde este repositorio.

## Cómo verificar

```
node --test scripts/qa/rls-aislamiento.test.mjs     # dos sesiones de QA (A = Supernova, B = "QA Aislamiento")
```
Consulta de apoyo: tablas con RLS y políticas `true` o sin políticas:
```sql
select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies
where schemaname in ('public','control_obra') and (qual = 'true' or with_check = 'true');
```
