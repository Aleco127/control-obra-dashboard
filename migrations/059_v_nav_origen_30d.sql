-- 059_v_nav_origen_30d.sql (US-615) — Desde dónde llega la gente a cada módulo.
--
-- Lee control_obra.ui_events (evento 'nav_click', que registra irAModulo con {modulo, origen, colapsado, grupo})
-- de los últimos 30 días y agrupa por empresa, módulo y origen.
--
-- security_invoker: la vista se evalúa con los permisos de quien consulta, así que no puede cruzar empresas.
-- Se revoca a anon/authenticated: esto es para el equipo (SQL editor / service_role), no para la app.

CREATE OR REPLACE VIEW public.v_nav_origen_30d
WITH (security_invoker = true) AS
SELECT
  e.empresa_id,
  e.modulo,
  COALESCE(e.meta->>'origen', 'desconocido')                      AS origen,
  COALESCE((e.meta->>'colapsado')::boolean, false)                AS colapsado,
  COALESCE(e.meta->>'grupo', '')                                  AS grupo,
  count(*)                                                        AS clics,
  count(DISTINCT e.user_id)                                       AS usuarios,
  count(*) FILTER (WHERE e.viewport_w < 768)                      AS clics_movil,
  min(e.created_at)                                               AS primero,
  max(e.created_at)                                               AS ultimo
FROM control_obra.ui_events e
WHERE e.evento = 'nav_click'
  AND e.created_at >= now() - interval '30 days'
GROUP BY 1, 2, 3, 4, 5;

REVOKE ALL ON public.v_nav_origen_30d FROM anon, authenticated;

COMMENT ON VIEW public.v_nav_origen_30d IS
  'US-615: clics de navegación de los últimos 30 días por empresa, módulo y origen (fijado, grupo, flyout, bottom, hoja, cmdk, atajo, ctx_obra).';
