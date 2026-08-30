# Auditoría de seguridad · fase 3 (29 de agosto de 2026)

Sustituye al `SECURITY-AUDIT.md` no versionado. Proyecto Supabase `cpjdlaiarmxojiyhhpxt` (compartido con Zook, Sposa Mia y MDV: sus objetos `zook_*`, `mdv_*`, `sposa_*` no se tocan). Referencias: `rls.md` (tablas y políticas) y `funciones.md` (funciones `SECURITY DEFINER`).

## Modelo de acceso

- La app llama todo con la llave pública (`anon`) y el header `x-obra-token` (sesión propia en `control_obra.obra_sesiones`). `control_obra.get_session_*()` leen ese header. **No existe usuario `authenticated` de Supabase Auth.**
- El panel `admin.html` manda `x-platform-token` (sesión en `public.platform_sessions`); `public.has_platform_session()` / `require_platform_session()` lo validan.
- Las Edge Functions (`send-email`, `auth`, `jobs`) corren con `service_role`; los jobs externos (n8n, VPS) se autentican con `x-internal-key` (`app_secrets.internal_key`).
- Secretos de proveedores en `public.app_secrets` (RLS sin políticas: sólo `service_role`), cargados desde el VPS con `secrets-sync.sh`; nunca en el código ni en el chat.

## Resultado de los advisors de Supabase

| Nivel | Antes (29-ago, 08:00) | Después | Qué queda y por qué |
|---|---|---|---|
| ERROR `security_definer_view` | 7 (`empresas`, `obras`, `cotizaciones`, `catalogo_conceptos_cot`, `plantillas_cotizacion`, `ui_events`, `v_uso_modulos_30d`) | **0** | Todas recreadas `WITH (security_invoker = true)` con lista explícita de columnas (migraciones 034 y 035) |
| WARN `function_search_path_mutable` | 4 triggers de fase 2 | **0** | `ALTER FUNCTION ... SET search_path = control_obra, public` |
| WARN `anon_security_definer_function_executable` | 70 | 70 | **Por diseño**: la app es `anon` + token. Cada función valida sesión (ver `funciones.md`): guardas inyectadas en 21 funciones que confiaban en ids del cliente; 10 funciones de mantenimiento/trigger revocadas a `anon`/`authenticated`; las de plataforma exigen `x-platform-token` |
| WARN `extension_in_public` (`unaccent`, `vector`) | 2 | 2 | `vector` es de Zook; `unaccent` la usan búsquedas. Mover extensiones exige recrear índices: fase 4 |
| WARN `auth_leaked_password_protection` | 1 | 1 | Aplica a Supabase Auth, que no se usa |
| INFO `rls_enabled_no_policy` (propias) | 5 | 9 | Intencional (denegar todo, sólo `service_role`): `app_secrets`, `email_log`, `tokens_correo`, `login_attempts`, `platform_admins`, `platform_sessions`. `orders`, `subscriptions`, `client_instances` no son de Control de Obra |

## Pruebas que lo respaldan (corren en CI y contra producción)

- `scripts/qa/rls-aislamiento.test.mjs` (5 pruebas): con dos sesiones de empresas distintas, 14 tablas devuelven sólo lo propio; sin token nada; B no puede escribir en A ni insertar con `empresa_id` ajeno; tablas de plataforma y secretos ilegibles; la vista de uso sólo agrega la empresa propia.
- `scripts/qa/rpc-sesion.test.mjs` (6 pruebas): `crear_obra`/`crear_gasto`/`get_user_access_level` rechazan `p_user_id` ajeno; `get_empresa_config`/`save_empresa_modulos_config`/`check_plan_limit` rechazan `p_empresa_id` ajeno; funciones de plataforma sin `x-platform-token` fallan; `hash_password` y mantenimiento revocadas; registro y login públicos siguen funcionando.
- Auditoría CSP con Playwright: 0 violaciones en 34 módulos, PDF, móvil y páginas públicas antes de forzarla.

## Cambios de la épica 1 (US-205 a US-211)

1. Vistas `security_invoker` (034, 035).
2. Políticas por empresa en 16 tablas que tenían `USING (true)` y quitadas las políticas `INSERT true` de `pagos_proveedores`, `pagos_recibidos`, `ui_events` (035).
3. Guardas de sesión inyectadas programáticamente (marca `GUARDA_SESION_035` en el cuerpo) y funciones revocadas (035).
4. Headers en Caddy: HSTS, `X-Frame-Options`, `Permissions-Policy`, CSP forzada (`docs/infra/caddy.md`).
5. Recuperación de contraseña con token hasheado de un solo uso (1 h), verificación de correo (48 h, bloqueo a los 7 días sin verificar), bloqueo de login por correo o IP (5 fallos / 15 min), sesiones de 30 días con renovación deslizante, "cerrar otras sesiones" y cierre automático al cambiar contraseña (036).
6. Contraseña del admin de plataforma rotada desde el VPS (`rotate-platform-admin.sh`, función `platform_admin_set_password` sólo `service_role`) y retirada de `CLAUDE.md` (037).

## Pendientes conocidos

- Mover el alias `obra.srv1090924.hstgr.cloud` al archivo `.caddy` para que tenga los mismos headers (requiere recrear Caddy).
- `'unsafe-eval'` y `'unsafe-inline'` en la CSP hasta el build de US-224 y la salida de los scripts de `index.html` (US-227).
- Proyecto de Supabase dedicado (decisión Q2: fase 4).
- Extensiones fuera de `public` (fase 4).
- Revisión trimestral: correr `get_advisors`, las dos suites y la auditoría CSP; anotar aquí la fecha y el resultado.
