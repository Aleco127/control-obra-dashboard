# Auditoría de seguridad · 17 de noviembre de 2026

Alcance: base de datos (funciones, RLS, permisos, buckets), Edge Functions, API pública con la llave publicable y XSS del cliente. Todo lo de esta lista quedó corregido y verificado desde fuera; migraciones 070, 071 y 072.

## Corregido en el servidor

| # | Hallazgo | Corrección |
|---|---|---|
| 1 | Las tablas `control_obra._bak_20260829_*` se leían y se podían vaciar sin sesión | Sin permisos para `anon`/`authenticated`, con RLS (070) |
| 2 | Un usuario podía reescribir su propia fila de `obra_sesiones` (`empresa_id`) y entrar a otra empresa | La empresa de la sesión sale siempre del usuario; sin `INSERT`/`UPDATE` de sesiones desde el cliente |
| 3 | `password_hash` visible y editable para cualquier usuario de la empresa; cualquiera podía cambiarse el rol | La vista entrega nulo, permisos por columna, editar o borrar usuarios exige nivel 90 |
| 4 | Cualquier usuario podía editar la empresa (datos bancarios incluidos), su plan y sus límites | Edición con nivel 80 y sólo columnas de perfil; `empresa_subscriptions` sin escritura desde el cliente |
| 5 | Políticas de `obra_asignaciones` y `obra_modificaciones` leían una variable que quedaba pegada a la conexión del pool | Políticas por sesión; `set_user_context` ya sólo escribe variables locales a la transacción |
| 6 | Funciones internas o heredadas ejecutables sin sesión (`plan_efectivo`, `uso_empresa`, `*_seguro`, registro antiguo…) | `EXECUTE` revocado a los roles públicos |
| 7 | `platform_admin_login` sin límite de intentos; registro e invitaciones sin tope | 5 intentos / 15 min; 10 registros / hora por IP; código de invitación de 12 caracteres aleatorios |
| 8 | Bucket `fotos`: cualquiera podía listarlo y cualquier sesión borrar o subir en carpetas ajenas | Listar, subir y borrar sólo en la carpeta de la propia empresa |
| 9 | Sesiones de usuarios desactivados seguían pasando RLS | `get_session_*` exige usuario activo |
| 10 | `TRUNCATE`, `TRIGGER` y `REFERENCES` concedidos a roles públicos | Revocados en todo `control_obra` |
| 11 | `log_client_error` aceptaba textos sin límite | Tamaños acotados y tope de volumen (072) |

## Corregido en el cliente

- `Toast` pinta el mensaje con `textContent`.
- Unas 230 interpolaciones sin escapar en `index.html`, `admin.html` y `js/*` pasan por `S()` / `esc()`.
- `SA()` para datos dentro de handlers inline y `safeUrl()` para `href`/`src` que vienen de la base.

## Cómo comprobarlo

Con sólo la llave publicable: `Accept-Profile: control_obra` sobre `_bak_20260829_gastos` responde 42501; `rpc/plan_efectivo` responde 42501; listar el bucket `fotos` devuelve vacío. Con una sesión: `PATCH obra_sesiones`, `PATCH empresa_subscriptions` y `PATCH empresas {max_obras}` responden 42501.
