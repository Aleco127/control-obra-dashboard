# Caddy: cómo se sirve app.supernovarquitectos.com

## Dónde vive la configuración real

El contenedor `caddy` (compose `/docker/n8n-app/docker-compose.yml`) genera `/etc/caddy/Caddyfile` desde un heredoc en su `command:` y al inicio hace `import /etc/caddy/clientes/*.caddy`, montado desde `/docker/clientes-caddy/`.

- `/docker/n8n-app/Caddyfile` **está huérfano** (nadie lo monta). No editarlo.
- El alias `obra.srv1090924.hstgr.cloud` sigue definido en el heredoc del compose (sin headers). Para moverlo al archivo `.caddy` hay que quitarlo del compose y recrear el contenedor (`docker compose up -d caddy`), lo cual reinicia todos los sitios del VPS; se deja para una ventana de mantenimiento.
- El admin API de Caddy (puerto 2019) está apagado.

## Bloque de la app

`/docker/clientes-caddy/control-obra-app.caddy`:

- `encode zstd gzip`
- `reverse_proxy control-obra-dashboard-web-1:80` (nginx con `/docker/control-obra-dashboard/html`)
- Headers: `X-Frame-Options SAMEORIGIN`, `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, `Strict-Transport-Security max-age=31536000`, `Permissions-Policy` (geolocalización sólo propia; micrófono, pago y USB apagados), `-Server`.
- `Content-Security-Policy` forzada desde el 29 de agosto de 2026:

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://cdn.tailwindcss.com https://*.supabase.co;
style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com;
font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com;
img-src 'self' data: blob: https:;
media-src 'self' blob:;
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cdn.jsdelivr.net https://cdnjs.cloudflare.com;
worker-src 'self' blob:; frame-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'
```

`'unsafe-eval'` y `cdn.tailwindcss.com` existen porque Tailwind se carga por CDN; desaparecen con el build de US-224. `'unsafe-inline'` en scripts permanece mientras el código viva dentro de `index.html`.

## Cambiar algo

1. Editar el archivo `.caddy`.
2. `cd /docker/n8n-app && docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`
3. `docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile` (nunca `up -d --force-recreate`).
4. `curl -sD - -o /dev/null https://app.supernovarquitectos.com/ | grep -i content-security` y correr `scripts/qa/audit-ui.py` contra producción.

Para un host nuevo: crear otro archivo en `/docker/clientes-caddy/` y recargar. Un mismo host no puede aparecer en dos archivos ("ambiguous site definition"). Los certificados los pide Caddy solo; el DNS debe apuntar al VPS antes de recargar (límite de Let's Encrypt).
