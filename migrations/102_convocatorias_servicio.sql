-- 102_convocatorias_servicio.sql (US-842) — RPC de servicio para convocatorias-ingesta y el vigilante de 48 h.
--   convocatorias_config_servicio(p_fuente): entidades que piden los filtros activos que incluyen esa fuente
--     (un filtro sin entidades = todo el país → todas_las_entidades = true).
--   convocatorias_estado_servicio(): última corrida correcta por fuente y horas sin una (alerta si > 48).
-- Sólo service_role. Aditiva.

CREATE OR REPLACE FUNCTION public.convocatorias_config_servicio(p_fuente text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH f AS (
    SELECT entidades FROM control_obra.convocatoria_filtros
    WHERE activo AND (cardinality(fuentes) = 0 OR p_fuente = ANY (fuentes))
  )
  SELECT jsonb_build_object(
    'entidades', coalesce((SELECT jsonb_agg(DISTINCT e ORDER BY e) FROM f, unnest(f.entidades) e WHERE btrim(e) <> ''), '[]'::jsonb),
    'todas_las_entidades', EXISTS (SELECT 1 FROM f WHERE cardinality(f.entidades) = 0),
    'filtros_activos', (SELECT count(*) FROM f));
$$;

CREATE OR REPLACE FUNCTION public.convocatorias_estado_servicio()
RETURNS TABLE (fuente text, ultima_ok timestamptz, horas_sin_ok numeric, ultima_inicio timestamptz, ultima_error text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT fu.f,
         ok.fin,
         round(extract(epoch FROM now() - ok.fin) / 3600.0, 1),
         u.inicio, u.error
  FROM (VALUES ('comprasmx'),('chihuahua')) fu(f)
  LEFT JOIN LATERAL (SELECT max(k.fin) AS fin FROM control_obra.convocatoria_corridas k
                     WHERE k.fuente = fu.f AND k.error IS NULL AND k.fin IS NOT NULL) ok ON true
  LEFT JOIN LATERAL (SELECT k.inicio, k.error FROM control_obra.convocatoria_corridas k
                     WHERE k.fuente = fu.f ORDER BY k.inicio DESC LIMIT 1) u ON true;
$$;

REVOKE ALL ON FUNCTION public.convocatorias_config_servicio(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.convocatorias_estado_servicio() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convocatorias_config_servicio(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.convocatorias_estado_servicio() TO service_role;
