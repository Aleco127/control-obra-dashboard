# Funciones `SECURITY DEFINER` y cómo validan (29 de agosto de 2026)

Como la app llama todo como `anon` + `x-obra-token`, revocar `anon` no es opción: cada función valida por sí misma. Tipos de validación:

- **token**: recibe `p_token` y lo valida contra `obra_sesiones` (funciones `*_seguro`, `validar_sesion`, `cerrar_sesion`, `set_user_context(p_token)`, `get_current_user_id(p_token)`, `user_has_empresa_access`).
- **header**: usa `get_session_user_id()/get_session_empresa_id()/get_session_nivel()` (leen `x-obra-token`) o `require_session()`.
- **guarda 035**: se le inyectó al inicio del cuerpo (`-- GUARDA_SESION_035`) una de estas comprobaciones:
  - `user`: `p_user_id` debe ser el de la sesión.
  - `emp`: `p_empresa_id` debe ser el de la sesión (o sesión de plataforma).
  - `emp_admin`: además nivel ≥ 100.
  - `plat`: `require_platform_session()` (header `x-platform-token`).
  - `ses`: `require_session()`.
- **pública**: sin sesión por diseño.
- **revocada**: sin `EXECUTE` para `anon`/`authenticated`; sólo `service_role` o triggers.

| Función | Quién la llama | Validación |
|---|---|---|
| `verificar_login`, `registrar_usuario`, `validar_sesion`, `log_client_error`, `calcular_recargos_sua` | login, registro, arranque, monitor de errores | pública (login bloquea 5 fallos/15 min por correo o IP; registro exige términos) |
| `auth_crear_token`, `auth_consumir_token`, `platform_admin_set_password`, `eliminar_empresa_definitivo`, `bajas_pendientes`, `marcar_baja_recordatorio`, `eliminar_empresa_logos`, `sesiones_tras_cambio_password` | Edge Functions `auth`/`jobs`, VPS | revocada (sólo `service_role`) |
| `limpiar_login_attempts`, `limpiar_sesiones_expiradas`, `update_repse_estatus_vencida`, `update_sua_estatus_vencido`, `trg_pago_recibido_*`, `log_audit`, `recalcular_cuenta_cobrar`, `admin_toggle_user_admin`, `update_user_role` | mantenimiento / triggers / leftovers | revocada |
| `load_all_data_seguro`, `load_secondary_data_seguro`, `get_dashboard_seguro`, `get_gastos_seguro`, `get_obras_seguro`, `get_estimaciones_seguro`, `get_ordenes_compra_seguro`, `get_usuarios_empresa_seguro`, `crear_gasto_seguro`, `crear_obra_seguro`, `crear_usuario_seguro`, `actualizar_gasto_seguro`, `eliminar_gasto_seguro`, `cerrar_sesion`, `set_user_context(p_token)`, `get_current_user_id(p_token)`, `user_has_empresa_access` | app | token |
| `create_obra_user`, `update_user_password`, `get_obra_token`, `get_session_*`, `has_valid_session`, `is_session_admin`, `user_has_obra_access(uuid)`, `solicitar_baja_empresa`, `cancelar_baja_empresa`, `cerrar_otras_sesiones`, `get_email_log`, `require_session` | app | header |
| `crear_gasto`, `crear_obra`, `crear_orden_compra`, `cambiar_password_usuario`, `get_user_access_level`, `set_user_context(uuid)`, `user_has_obra_access(uuid,int)` | app | guarda `user` |
| `get_empresa_config` (public y control_obra), `check_plan_limit` | app | guarda `emp` |
| `save_empresa_modulos_config`, `apply_template_to_empresa` | app / admin.html | guarda `emp_admin` (o plataforma) |
| `get_platform_stats`, `get_platform_analytics`, `hash_password` | admin.html | guarda `plat` |
| `get_next_orden_codigo` (2), `get_next_cuenta_cobrar_numero`, `get_next_pago_proveedor_numero`, `get_next_pago_recibido_numero` | app | guarda `ses` |
| `platform_admin_login`, `platform_admin_logout`, `validate_platform_session`, `admin_create_user(p_token,...)` | admin.html | token de plataforma |

## Reglas para funciones nuevas

1. Si la llama la app: empezar con `PERFORM public.require_session();` o derivar todo de `get_session_*()`; nunca aceptar `p_user_id`/`p_empresa_id` sin compararlos con la sesión.
2. Si la llama `admin.html`: `PERFORM public.require_platform_session();`.
3. Si sólo la llaman Edge Functions o el VPS: `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated; GRANT ... TO service_role`.
4. Siempre `SET search_path` explícito.
5. Agregar la prueba a `scripts/qa/rpc-sesion.test.mjs`.

Consulta de apoyo:
```sql
select n.nspname, p.proname, pg_get_functiondef(p.oid) ~ 'GUARDA_SESION_035' guarda, has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','control_obra') and p.prosecdef order by 1, 2;
```
