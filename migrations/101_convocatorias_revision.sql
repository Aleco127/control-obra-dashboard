-- 101_convocatorias_revision.sql (US-840) — Qué páginas de detalle debe volver a leer un recolector.
--
-- La búsqueda de Contrataciones Chihuahua no trae fechas (publicación, junta, apertura, fallo): están en la página de
-- detalle. Leer todas cada día cargaría al portal, así que el recolector pide aquí una lista corta y priorizada:
--   1. 'desaparecida': en la BD está vigente / en seguimiento pero hoy no salió en la búsqueda (cambió de estatus:
--      terminado o cancelado). Se relee para guardar el estatus nuevo.
--   2. 'sin_detalle': nunca se ha leído su detalle (las nuevas primero: id externo numérico descendente).
--   3. 'refrescar': vigentes cuya apertura no ha pasado y cuyo detalle tiene más de p_horas (fechas que cambian,
--      documentos nuevos).
-- Sólo service_role. Aditiva.

CREATE OR REPLACE FUNCTION public.convocatorias_por_revisar(
  p_fuente text, p_vistos text[], p_limite integer DEFAULT 30, p_horas integer DEFAULT 72)
RETURNS TABLE (id_externo text, url_detalle text, motivo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH c AS (
    SELECT c.id_externo, c.url_detalle, c.detalle_at, c.apertura,
           CASE WHEN c.estatus IN ('vigente','en_seguimiento') AND NOT (c.id_externo = ANY (coalesce(p_vistos,'{}'))) THEN 1
                WHEN c.detalle_at IS NULL AND c.id_externo = ANY (coalesce(p_vistos,'{}')) THEN 2
                WHEN c.estatus IN ('vigente','en_seguimiento') AND (c.apertura IS NULL OR c.apertura >= now())
                     AND c.detalle_at < now() - make_interval(hours => greatest(coalesce(p_horas,72),1)) THEN 3
           END AS prioridad
    FROM control_obra.convocatorias c
    WHERE c.fuente = p_fuente
  )
  SELECT c.id_externo, c.url_detalle,
         CASE c.prioridad WHEN 1 THEN 'desaparecida' WHEN 2 THEN 'sin_detalle' ELSE 'refrescar' END
  FROM c
  WHERE c.prioridad IS NOT NULL AND c.url_detalle IS NOT NULL
  ORDER BY c.prioridad,
           CASE WHEN c.id_externo ~ '^\d{1,18}$' THEN c.id_externo::bigint END DESC NULLS LAST,
           c.detalle_at NULLS FIRST
  LIMIT greatest(0, least(coalesce(p_limite,30), 500));
$$;
REVOKE ALL ON FUNCTION public.convocatorias_por_revisar(text,text[],integer,integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convocatorias_por_revisar(text,text[],integer,integer) TO service_role;
