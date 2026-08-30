# DNS de app.supernovarquitectos.com y correo transaccional

El dominio `supernovarquitectos.com` tiene su DNS en **GoDaddy** (ns47/ns48.domaincontrol.com); el sitio principal vive en WordPress.com. Nada de esto se administra desde Hostinger.

## Registros vigentes que usa Control de Obra

| Tipo | Nombre | Valor | Para qué |
|---|---|---|---|
| A | `app` | `213.210.13.36` | La app (Caddy en el VPS emite el certificado) |

## Correo transaccional (Resend)

La Edge Function `send-email` envía por Resend con la llave de Zook (`app_secrets.resend_api_key`, copiada desde el VPS con `secrets-sync.sh`). Esa llave es **sólo de envío**: no puede crear ni verificar dominios, así que el alta del dominio se hace a mano en el panel de Resend.

Mientras el dominio no esté verificado, el remitente es `Control de Obra <noreply@zook.mx>` (dominio ya verificado en la misma cuenta). Al terminar los pasos de abajo se cambia el remitente sin tocar código:

```sql
insert into public.app_secrets(key, value) values ('email_from', 'Control de Obra <noreply@supernovarquitectos.com>')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

### Pasos (Ricardo, 10 minutos)

1. En https://resend.com/domains → **Add domain** → `supernovarquitectos.com`, región `us-east-1`.
2. Resend muestra tres registros; agregarlos en GoDaddy → DNS del dominio:
   - **TXT** `resend._domainkey` → valor DKIM que muestra Resend (empieza con `p=MIGf...`).
   - **MX** `send` → `feedback-smtp.us-east-1.amazonses.com`, prioridad 10.
   - **TXT** `send` → `v=spf1 include:amazonses.com ~all`.
   - Recomendado: **TXT** `_dmarc` → `v=DMARC1; p=none; rua=mailto:privacidad@supernovarquitectos.com`.
3. Esperar la verificación en Resend (minutos, hasta 24 h por propagación) y correr el `insert` de arriba.
4. Probar desde la app: Configuración › Empresa › "Enviar correo de prueba" (o llamar la Edge Function con la plantilla `generico`).

No tocar los registros `@`, `www` ni los MX actuales del dominio: son del sitio y del correo corporativo.

## Referencia

- Bloque de Caddy: `/docker/clientes-caddy/control-obra-app.caddy` (ver `docs/infra/caddy.md`).
- Secretos: `public.app_secrets` (sólo `service_role`), sincronizados con `/docker/control-obra-dashboard/secrets-sync.sh`.
