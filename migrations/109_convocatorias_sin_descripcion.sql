-- 109_convocatorias_sin_descripcion.sql (US-852) — Qué convocatorias de UNA búsqueda aún no tienen descripción.
--
-- El listado de ComprasMX no trae la descripción (sólo el nombre del procedimiento): el conector local abre el
-- detalle únicamente de las convocatorias de esa búsqueda que aún no la tienen. Esta RPC le dice cuáles, en el orden
-- en que llegaron, con tope. Sólo service_role (la llama la función convocatorias-ingesta con el secreto de servidor).
-- Aditiva.

CREATE OR REPLACE FUNCTION public.convocatorias_sin_descripcion(p_fuente text, p_ids text[], p_limite integer DEFAULT 40)
RETURNS TABLE (id_externo text, url_detalle text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT c.id_externo, c.url_detalle
  FROM unnest(coalesce(p_ids, '{}')) WITH ORDINALITY AS x(idx, ord)
  JOIN control_obra.convocatorias c ON c.fuente = p_fuente AND c.id_externo = lower(x.idx)
  WHERE coalesce(btrim(c.descripcion), '') = ''
  ORDER BY x.ord
  LIMIT greatest(0, least(coalesce(p_limite, 40), 200));
$$;
REVOKE ALL ON FUNCTION public.convocatorias_sin_descripcion(text, text[], integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convocatorias_sin_descripcion(text, text[], integer) TO service_role;
