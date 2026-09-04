# QA de la barra de módulos (US-601 a US-623)

Capturas, reportes de `audit-ui.py` y la forma de leer la telemetría de navegación.

## Cómo se prueba

Todo corre contra el **build local**, nunca contra `src/` a mano:

```bash
node scripts/build.mjs
node scripts/serve-dist.mjs dist 8765 &          # sirve dist/ en http://127.0.0.1:8765
export $(grep -E "^OBRA_QA_TOKEN=" .env | xargs)  # token qa-… de control_obra.obra_sesiones
```

| Script | Qué cubre |
|---|---|
| `node --test scripts/qa/*.test.mjs` | NavShell, NAV_GRUPOS, nav-rules, finanzas, gastos-rules, cfdi (sin red) |
| `node scripts/qa/design-tokens-check.mjs` | tokens y colores crudos de `styles.css` y `nav-shell.css` |
| `scripts/qa/nav-grupos-smoke.py` | US-605: los 7 grupos y el renombre a Contabilidad |
| `scripts/qa/nav-rules-smoke.py` | US-606: visibilidad por rol (necesita `OBRA_QA_TOKEN_TRABAJADOR`) |
| `scripts/qa/nav-shell-smoke.py` | US-607: la barra pintada por NavShell, prefs de grupos, colapsado, móvil |
| `scripts/qa/nav-css-smoke.py` | US-604: colores, altos, foco, flyout y reduced-motion en app y portal |
| `scripts/qa/nav-fijados-smoke.py` | US-608: «Mi trabajo» (siembra, estrella, tope de 6, editor, Ctrl+K) |
| `scripts/qa/nav-obra-smoke.py` | US-609: tarjeta de obra activa y popover de cambio |
| `scripts/qa/nav-badges-smoke.py` | US-610: contadores unificados y candados de plan |
| `scripts/qa/nav-colapsada-smoke.py` | US-611: anchos por token, flyout, preferencia sin parpadeo |
| `scripts/qa/nav-teclado-smoke.py` | US-612: roving tabindex, flechas, Alt+1..6, axe |
| `scripts/qa/nav-hoja-smoke.py` | US-613: barra inferior y hoja de módulos del móvil |
| `scripts/qa/nav-empresa-smoke.py` | US-614: personalización por empresa (necesita `OBRA_QA_TOKEN_EMP6`) |
| `scripts/qa/nav-telemetria-smoke.py` | US-615: `data-origen` por superficie y `nav_click` completo |
| `scripts/qa/nav-scroll-smoke.py` | scroll del aside: barra sólo al usarla, aviso «Ver más» y flyout con scroll |
| `python scripts/qa/audit-ui.py --url … --modules d,o,g` | consola + axe por módulo en 1440 y 390 |

Los smokes que escriben `nav_prefs` **fijan su punto de partida y restauran las preferencias al terminar**: el token
de QA es la cuenta real de Ricardo. Si un smoke se interrumpe a la mitad, revisar sus preferencias antes de seguir.

## Telemetría de navegación (US-615)

Cada clic en la barra registra `nav_click` en `control_obra.ui_events` con
`meta = {modulo, origen, colapsado, grupo}`. Orígenes posibles:

| Origen | Dónde se tocó |
|---|---|
| `fijado` | «Mi trabajo», en la barra lateral |
| `grupo` | un módulo dentro de su grupo, con la barra expandida |
| `flyout` | un módulo del menú flotante, con la barra colapsada |
| `bottom` | la barra inferior del móvil |
| `hoja` | la hoja de módulos del móvil |
| `cmdk` | la paleta Ctrl+K |
| `atajo` | Alt+1 … Alt+6 |
| `ctx_obra` | la tarjeta de obra activa |

La vista `public.v_nav_origen_30d` (migración 059, `security_invoker`, revocada a `anon`) agrupa los últimos 30 días:

```sql
-- ¿Desde dónde entran a cada módulo?
select modulo, origen, clics, usuarios, clics_movil
from public.v_nav_origen_30d
where empresa_id = 1
order by clics desc
limit 20;

-- ¿Sirve «Mi trabajo»? (criterio del §4 del PRD: al menos un tercio de los clics de navegación
-- deberían salir de los fijados, los atajos o Ctrl+K, y no de recorrer los grupos)
select round(100.0 * sum(clics) filter (where origen in ('fijado','atajo','cmdk')) / nullif(sum(clics),0), 1) as pct_directo,
       sum(clics) as total
from public.v_nav_origen_30d
where empresa_id = 1;

-- Reparto escritorio / móvil
select origen, sum(clics) clics, sum(clics_movil) movil
from public.v_nav_origen_30d
where empresa_id = 1
group by 1 order by 2 desc;
```

## Errores de interfaz antes y después (US-623)

`error_ui` es el otro evento de `ui_events`. El criterio de cierre es que **no suba más de 20 % en 48 h**
tras el despliegue; si sube, se abre un ticket con los mensajes más frecuentes.

```sql
-- Conteo por día de los últimos 14 días
select date_trunc('day', created_at)::date dia, count(*) errores
from control_obra.ui_events
where evento = 'error_ui' and created_at >= now() - interval '14 days'
group by 1 order by 1 desc;

-- Los mensajes más repetidos de las últimas 48 h
select meta->>'mensaje' mensaje, count(*) veces
from control_obra.ui_events
where evento = 'error_ui' and created_at >= now() - interval '48 hours'
group by 1 order by 2 desc limit 10;
```

### Medición antes del despliegue de la barra (4-sep-2026)

Conteo de `error_ui` por día, con la barra vieja todavía en producción:

| Día | error_ui |
|---|---|
| 2026-09-04 (parcial) | 48 |
| 2026-09-03 | 360 |
| 2026-09-02 | 58 |
| 2026-09-01 | 123 |
| 2026-08-31 | 111 |
| 2026-08-29 | 126 |

Promedio de los días completos: **156/día** (el 3 de septiembre se dispara por el trabajo de fase 2 y 3 de ese día;
sin él, **104/día**). **Umbral de alarma tras desplegar: 48 h por encima de 187/día** (156 + 20 %). Si se pasa, abrir
ticket con la consulta de los mensajes más frecuentes de arriba.

### Auditoría integral previa (build local, 4-sep-2026)

`audit-ui.py` sobre 28 módulos × 2 viewports: **0 errores de consola**, 0 `confirm(` nativos y **32 violaciones axe,
ninguna en la barra** (`grep` por `nvs`/`#sb`/`mobileBottomNav` sobre los targets da 0). Las 32 son deuda previa de
otros módulos: contraste de `.bg-teal-600`/`.bg-cyan-600`/`.bg-amber-500`, `select-name` en `#calTipoFilter`,
`#scEstatus` y `#mtCat`, botones de icono sin texto en tablas y `.overflow-x-auto` sin foco de teclado en móvil.
Reporte completo en `docs/qa/nav/2026-09-04-integral/`.
