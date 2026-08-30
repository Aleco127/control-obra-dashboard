# Monitoreo (US-228)

`scripts/vps/monitor.sh` corre cada 5 minutos por cron en el VPS (`/docker/control-obra-dashboard/monitor.sh`). Revisa:

| Servicio | Prueba |
|---|---|
| app | `GET https://app.supernovarquitectos.com/` contiene "Control de Obra" |
| admin | `GET /admin.html` 200 |
| ayuda | `GET /ayuda/index.html` 200 |
| supabase_rest | `subscription_plans?select=slug` devuelve `gratis` |
| fn_send_email, fn_auth, fn_jobs | responden 400/401 (la función vive; no se envía nada) |
| certificado | días restantes del certificado (alerta si < 10) |
| respaldo_diario | el último `.json.gz.gpg` tiene menos de 30 h |

Escribe `html/status.json` (lo lee la página pública `status.html`) y guarda el estado por servicio en `monitor/*.state`. Sólo avisa por Telegram cuando un servicio **cambia** (caído o recuperado), para no hacer ruido. Credenciales del bot en `/root/.obra_telegram.env` (copiadas del bot de mantenimiento del VPS; ver gotcha del token compartido con n8n). Bitácora de eventos en `monitor/eventos.log`.

Página pública: https://app.supernovarquitectos.com/status.html (enlazada desde Ayuda).

## Errores de la app

`log_client_error` (RPC) guarda en `platform_errors`; `admin.html › Errores` los agrupa. Pendiente (fase 4): resumen diario por Telegram desde el job `jobs`.

## Qué hacer si algo cae

1. `ssh root@213.210.13.36 'docker ps | grep -E "obra|caddy"'` y `timeout 30 docker logs --tail 50 control-obra-dashboard-web-1`.
2. Si es Supabase: https://status.supabase.com y el panel del proyecto.
3. Si es un despliegue: rollback (ver `deploy.md`).
4. Registrar en `docs/infra/incidentes.md`: fecha, causa, tiempo caído, acción.
