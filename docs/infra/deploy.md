# Build y despliegue (US-224, US-230)

## Flujo

```
node scripts/build-ayuda.mjs        # centro de ayuda desde docs/manual-de-usuario.md
node scripts/build.mjs              # dist/: Tailwind compilado, JS minificado con hash, service worker
bash scripts/deploy.sh              # build + tar a /docker/control-obra-dashboard/html + verificación (meta build y sw.js)
```

`src/` es la fuente; `dist/` no se versiona. El build:

1. Compila Tailwind con `tailwind.config.js` (extraída de la configuración inline; `safelist` sólo para clases armadas con variables) → `css/tw.<hash>.css` (~82 KB). La app ya no carga `cdn.tailwindcss.com`.
2. Minifica `src/js/*.js` con esbuild → `js/<nombre>.<hash>.js`; reescribe los `<script src>` de `index.html`.
3. Minifica los scripts inline de `index.html` (el principal baja ~10 %; la reducción grande viene de US-227).
4. Copia `manifest.json`, legales, `img/`, `ayuda/`, `docs/img/`, `status.html`.
5. Genera `sw.js` (precache del app shell, red primero para navegación y Supabase, caché para activos con hash y CDN) y `js/sw-register.js` (aviso "Hay una versión nueva" y banner de instalación).
6. Escribe `build.json` y `<meta name="build">` con el identificador (fecha-hora UTC).

## Verificación

`deploy.sh` conserva `html-anterior/` para rollback, comprueba que la página publicada traiga el `build` recién generado y que `sw.js` responda 200. Con `--audit` corre `scripts/qa/audit-ui.py` contra producción.

Rollback: `ssh root@213.210.13.36 'rm -rf /docker/control-obra-dashboard/html && mv /docker/control-obra-dashboard/html-anterior /docker/control-obra-dashboard/html'`.

## CI (GitHub Actions, `.github/workflows/ci.yml`)

En cada push a `master` y en PR: pruebas de lógica, tokens de diseño, build con presupuesto de peso (index.html < 1.4 MB) y, en push, las suites contra producción (`rls-aislamiento`, `rpc-sesion`, `planes`) con los secretos `QA_TOKEN_A` / `QA_TOKEN_B` (crear en Settings › Secrets; los tokens de QA vencen el 12-sep-2026). El artefacto `dist` se guarda 7 días. CI no despliega.

## nginx y Caddy

- Caddy (`/docker/clientes-caddy/control-obra-app.caddy`) comprime (`zstd`, `gzip`) y pone los headers de seguridad.
- nginx (`docker/nginx.conf`, montado en `/docker/control-obra-dashboard/nginx.conf`): `index.html` sin caché; `sw.js`, `manifest.json`, `status.json`, `build.json` con `no-cache`; el resto de `.js/.css/imágenes` con `immutable` a 1 año (los nombres llevan hash). Recargar con `docker exec control-obra-dashboard-web-1 nginx -s reload`.
