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

## Segunda ronda (18-nov-2026): permisos por rol, sesiones y fotos

Migraciones 073 a 075, función de borde `portal-archivo` v4 y build `202611181520`.

| Tema | Antes | Ahora |
|---|---|---|
| Permisos por rol | La RLS separaba por empresa pero no por rol: lo que la barra ocultaba seguía legible y editable por API | Políticas `RESTRICTIVE` `rol_lee`, `rol_inserta`, `rol_actualiza` y `rol_borra` en 49 tablas, con la misma tabla de visibilidad de `src/js/nav-rules.js` (`control_obra.sesion_ve` / `sesion_escribe`) |
| Carga inicial | `load_all_data_seguro` y `load_secondary_data_seguro` entregaban todo a cualquier rol, incluido el hash de contraseña de los usuarios | Cada bloque se entrega sólo si el rol ve el módulo; el hash nunca viaja; el detalle de usuarios sólo a nivel 100 |
| RPC de escritura | `crear_obra`, `crear_gasto` y `crear_orden_compra` no revisaban el rol | `control_obra.exigir_rol(nivel, módulos…)` |
| Sesiones | 30 días renovables, decenas de sesiones vencidas acumuladas | 7 días, se renuevan cuando quedan menos de 3; una sesión viva por usuario tras la limpieza |
| Fotos de obra | Bucket público: la URL bastaba | Bucket privado; la app firma con su sesión (`FotoUrl`) y el portal pide los enlaces a `portal-archivo` (`{fotos:true, obra_id}`) |

### Al agregar cosas nuevas

- **Tabla nueva con datos de un módulo:** además de la política por empresa, añadir su renglón al bloque `VALUES` de la migración 073 (o crear las cuatro políticas `rol_*` a mano). Sin ellas, cualquier rol de la empresa la lee.
- **Módulo o rol nuevo en `nav-rules.js`:** repetir el cambio en `control_obra.usuario_ve` (misma tabla, en SQL).
- **Dato nuevo en `load_*_data_seguro`:** envolverlo en `CASE WHEN control_obra.usuario_ve(u, …)`.
- **Fotos:** nunca pintar `url_foto` directo; usar `FotoUrl.src(url)` en la app. `getPublicUrl` sólo sirve para guardar la forma canónica de la ruta.

### Cómo comprobar

Simular un rol dentro de una transacción que se revierte: crear un usuario temporal con ese `rol_id`, una sesión, fijar `request.headers` con su `x-obra-token`, `SET LOCAL ROLE anon` y contar filas en las vistas `public.*`. Resultado esperado para `trabajador`: 0 en gastos, nómina, cobros, clientes y empleados; no puede insertar ni actualizar.

## Tercera ronda (18-nov-2026): tokens, panel de plataforma y política de contenido

Migraciones 076 y 077, `portal-archivo` v5, build `202611181745` y bloque de Caddy actualizado.

| Tema | Antes | Ahora |
|---|---|---|
| Tokens de sesión | `obra_sesiones`, `portal_sesiones` y `platform_sessions` guardaban el token tal cual | Sólo el SHA-256 (`control_obra.tok`). El token real vive en el navegador; un hash leído de la base no sirve para entrar |
| Panel de plataforma | `admin.html` leía y escribía `empresas` y `obra_usuarios` directo, y mandaba el hash de contraseña desde el navegador | `platform_datos`, `platform_empresa_guardar`, `platform_usuario_guardar` y `platform_usuario_eliminar` validan `x-platform-token`; la contraseña se cifra en el servidor |
| Plantillas de configuración | Sin política de escritura | Alta y baja sólo con sesión de plataforma |
| Tablas de plataforma en `public` | `anon` tenía `TRUNCATE`, `TRIGGER` y `REFERENCES` | Revocados |
| CSP | `'unsafe-eval'`, scripts de cualquier `*.supabase.co` y del CDN de Tailwind, `connect-src` a cualquier proyecto de Supabase y a `127.0.0.1:8879` | Sin `'unsafe-eval'`; scripts sólo propios, jsDelivr, cdnjs y Openpay; `connect-src` sólo al proyecto propio |

### Notas para quien toque esto

- **Función nueva que busque una sesión por token:** comparar contra `control_obra.tok(p_token)`, nunca contra el token directo. Una función de borde que lea la tabla debe calcular el SHA-256 (ver `portal-archivo`).
- **Los tokens de QA** ya no se pueden leer de la base: viven en `.env`. Para uno nuevo, insertar la fila con `control_obra.tok('<token>')`.
- **Scripts de Playwright:** `wait_for_function` debe recibir una función (`"() => …"`), no una expresión suelta, porque sin `'unsafe-eval'` la expresión se rechaza.
- **CSP:** sigue con `'unsafe-inline'` porque la app usa miles de manejadores en línea; quitarlo exige reescribirlos.
- **Portal:** `src/portal.html` versiona sus scripts a mano (`?v=`); hay que subir ese valor cada vez que cambie `src/js/portal/*.js`.
