-- 108_convocatorias_filtros.sql (US-853 y la parte de BD de US-852) — Mejores filtros para la lista de convocatorias
-- y la descripción de cada convocatoria en su propia columna.
--
-- 1) convocatorias.descripcion: objeto de la contratación tal como lo publica el portal (ComprasMX: `descripcion` del
--    detalle; Contrataciones Chihuahua: «Descripción del procedimiento», que es también el texto del listado). Se llena
--    desde `datos` para lo ya cargado (sin volver a consultar los portales) y la columna generada texto_norm la incluye
--    al final, así la búsqueda por texto, los filtros guardados (convocatoria_cumple_filtro, sin cambios) y su espejo
--    en JS (cumpleFiltro / textoConvocatoria) la cubren.
-- 2) convocatorias_upsert guarda la descripción (del ítem o, si no viene, de datos.detalle).
-- 3) convocatoria_filtros.barra (jsonb): «Guardar esta búsqueda» guarda ahí la barra completa (municipio, dependencia,
--    fechas…), que no cabe en las columnas del filtro. Vista public recreada con la columna al final.
-- 4) convocatorias_buscar gana, AL FINAL y con DEFAULT NULL (los llamadores viejos siguen funcionando):
--      p_excluir text[]          palabras a excluir (ninguna debe aparecer)
--      p_municipio text          subcadena normalizada del municipio
--      p_dependencia text        subcadena normalizada de la dependencia o la unidad compradora
--      p_procedimientos text[]   tipos de procedimiento
--      p_estatus text[]          estatus del portal
--      p_abren_desde/hasta date  apertura en ese rango (días civiles de Chihuahua)
--      p_pub_dias integer        publicadas en los últimos N días
--      p_pub_desde/hasta date    publicación en ese rango
--      p_orden text              'apertura' (omisión) | 'publicacion' | 'dependencia'
--      p_filtro_id integer       sólo las que cumplen ESE filtro guardado de mi empresa
--    p_texto ahora es «todas las palabras» (cada palabra normalizada debe aparecer), no la frase exacta.
--    Devuelve además `descripcion` y `descarga_estado` (US-848) al final.
-- 5) convocatorias_opciones(): dependencias y municipios existentes (con su conteo) para el autocompletar.
-- Aditiva salvo convocatorias_buscar (se recrea con más parámetros y columnas; único llamador: convocatorias.js).

-- 1) Descripción -------------------------------------------------------------------------------------------------------
ALTER TABLE control_obra.convocatorias ADD COLUMN IF NOT EXISTS descripcion text NULL;

UPDATE control_obra.convocatorias SET descripcion = left(btrim(coalesce(
    nullif(btrim(datos->'detalle'->>'descripcion'), ''),
    nullif(btrim(datos->'detalle'->'campos'->>'Descripción del procedimiento'), ''),
    CASE WHEN fuente = 'chihuahua' THEN nullif(btrim(titulo), '') END)), 4000)
WHERE descripcion IS NULL;

ALTER TABLE control_obra.convocatorias ALTER COLUMN texto_norm SET EXPRESSION AS (control_obra.texto_norm(
  coalesce(numero_procedimiento,'') || ' ' || coalesce(titulo,'') || ' ' ||
  coalesce(dependencia,'') || ' ' || coalesce(unidad_compradora,'') || ' ' ||
  coalesce(municipio,'') || ' ' || coalesce(descripcion,'')));

CREATE INDEX IF NOT EXISTS idx_convocatorias_publicacion ON control_obra.convocatorias (publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_convocatorias_vista ON control_obra.convocatorias (fuente, ultima_vez_vista);

-- 2) Upsert con descripción ----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convocatorias_upsert(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  it jsonb; v_id bigint; v_new boolean; v_desc text;
  n_tot integer := 0; n_new integer := 0; n_upd integer := 0;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'p_items debe ser un arreglo'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    n_tot := n_tot + 1;
    v_desc := left(btrim(coalesce(
      nullif(btrim(it->>'descripcion'), ''),
      nullif(btrim(it->'datos'->'detalle'->>'descripcion'), ''),
      nullif(btrim(it->'datos'->'detalle'->'campos'->>'Descripción del procedimiento'), ''),
      CASE WHEN it->>'fuente' = 'chihuahua' THEN nullif(btrim(it->>'titulo'), '') END)), 4000);
    INSERT INTO control_obra.convocatorias AS c (
      fuente, id_externo, numero_procedimiento, titulo, dependencia, unidad_compradora, tipo_procedimiento,
      tipo_contratacion, entidad, municipio, publicacion, junta_aclaraciones, apertura, fallo, estatus,
      url_detalle, datos, detalle_at, descripcion)
    VALUES (
      it->>'fuente', it->>'id_externo', it->>'numero_procedimiento', coalesce(it->>'titulo',''), it->>'dependencia',
      it->>'unidad_compradora', it->>'tipo_procedimiento', it->>'tipo_contratacion', it->>'entidad', it->>'municipio',
      (it->>'publicacion')::timestamptz, (it->>'junta_aclaraciones')::timestamptz, (it->>'apertura')::timestamptz,
      (it->>'fallo')::timestamptz, it->>'estatus', it->>'url_detalle', coalesce(it->'datos','{}'::jsonb),
      (it->>'detalle_at')::timestamptz, v_desc)
    ON CONFLICT (fuente, id_externo) DO UPDATE SET
      numero_procedimiento = coalesce(EXCLUDED.numero_procedimiento, c.numero_procedimiento),
      titulo               = CASE WHEN EXCLUDED.titulo <> '' THEN EXCLUDED.titulo ELSE c.titulo END,
      dependencia          = coalesce(EXCLUDED.dependencia, c.dependencia),
      unidad_compradora    = coalesce(EXCLUDED.unidad_compradora, c.unidad_compradora),
      tipo_procedimiento   = coalesce(EXCLUDED.tipo_procedimiento, c.tipo_procedimiento),
      tipo_contratacion    = coalesce(EXCLUDED.tipo_contratacion, c.tipo_contratacion),
      entidad              = coalesce(EXCLUDED.entidad, c.entidad),
      municipio            = coalesce(EXCLUDED.municipio, c.municipio),
      publicacion          = coalesce(EXCLUDED.publicacion, c.publicacion),
      junta_aclaraciones   = coalesce(EXCLUDED.junta_aclaraciones, c.junta_aclaraciones),
      apertura             = coalesce(EXCLUDED.apertura, c.apertura),
      fallo                = coalesce(EXCLUDED.fallo, c.fallo),
      estatus              = coalesce(EXCLUDED.estatus, c.estatus),
      url_detalle          = coalesce(EXCLUDED.url_detalle, c.url_detalle),
      datos                = c.datos || EXCLUDED.datos,
      detalle_at           = coalesce(EXCLUDED.detalle_at, c.detalle_at),
      descripcion          = coalesce(EXCLUDED.descripcion, c.descripcion),
      ultima_vez_vista     = now(),
      updated_at           = CASE WHEN (c.estatus, c.apertura, c.junta_aclaraciones, c.fallo, c.titulo)
                                   IS DISTINCT FROM
                                   (coalesce(EXCLUDED.estatus, c.estatus), coalesce(EXCLUDED.apertura, c.apertura),
                                    coalesce(EXCLUDED.junta_aclaraciones, c.junta_aclaraciones),
                                    coalesce(EXCLUDED.fallo, c.fallo),
                                    CASE WHEN EXCLUDED.titulo <> '' THEN EXCLUDED.titulo ELSE c.titulo END)
                                 THEN now() ELSE c.updated_at END
    RETURNING c.id, (xmax = 0) INTO v_id, v_new;
    IF v_new THEN n_new := n_new + 1; ELSE n_upd := n_upd + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('encontradas', n_tot, 'nuevas', n_new, 'actualizadas', n_upd);
END; $$;
REVOKE ALL ON FUNCTION public.convocatorias_upsert(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convocatorias_upsert(jsonb) TO service_role;

-- 3) Barra completa en el filtro guardado --------------------------------------------------------------------------------
ALTER TABLE control_obra.convocatoria_filtros ADD COLUMN IF NOT EXISTS barra jsonb NULL
  CHECK (barra IS NULL OR jsonb_typeof(barra) = 'object');
CREATE OR REPLACE VIEW public.convocatoria_filtros WITH (security_invoker = true) AS
  SELECT id, empresa_id, nombre, palabras_clave, palabras_excluir, fuentes, entidades, tipos_contratacion,
         activo, de_fabrica, created_by, created_at, updated_at, barra
  FROM control_obra.convocatoria_filtros;
REVOKE ALL ON public.convocatoria_filtros FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.convocatoria_filtros TO anon, authenticated;

-- 4) convocatorias_buscar con los filtros de la barra ----------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.convocatorias_buscar(text,text[],text[],text[],text[],integer,boolean,boolean,integer,integer,bigint);
CREATE OR REPLACE FUNCTION public.convocatorias_buscar(
  p_texto text DEFAULT NULL,
  p_fuentes text[] DEFAULT NULL,
  p_entidades text[] DEFAULT NULL,
  p_tipos text[] DEFAULT NULL,
  p_estados text[] DEFAULT NULL,
  p_abren_dias integer DEFAULT NULL,
  p_mis_filtros boolean DEFAULT false,
  p_solo_vigentes boolean DEFAULT true,
  p_limite integer DEFAULT 200,
  p_offset integer DEFAULT 0,
  p_corrida_id bigint DEFAULT NULL,
  p_excluir text[] DEFAULT NULL,
  p_municipio text DEFAULT NULL,
  p_dependencia text DEFAULT NULL,
  p_procedimientos text[] DEFAULT NULL,
  p_estatus text[] DEFAULT NULL,
  p_abren_desde date DEFAULT NULL,
  p_abren_hasta date DEFAULT NULL,
  p_pub_dias integer DEFAULT NULL,
  p_pub_desde date DEFAULT NULL,
  p_pub_hasta date DEFAULT NULL,
  p_orden text DEFAULT NULL,
  p_filtro_id integer DEFAULT NULL)
RETURNS TABLE (
  id bigint, fuente text, id_externo text, numero_procedimiento text, titulo text, dependencia text,
  unidad_compradora text, tipo_procedimiento text, tipo_contratacion text, entidad text, municipio text,
  publicacion timestamptz, junta_aclaraciones timestamptz, apertura timestamptz, fallo timestamptz,
  estatus text, url_detalle text, datos jsonb, primera_vez_vista timestamptz, ultima_vez_vista timestamptz,
  updated_at timestamptz, seguimiento_estado text, licitacion_id integer, nota text, seguimiento_at timestamptz,
  total bigint, descripcion text, descarga_estado text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_emp integer := control_obra.get_session_empresa_id();
  v_niv integer := control_obra.get_session_nivel();
  v_palabras text[] := array_remove(string_to_array(nullif(control_obra.texto_norm(coalesce(p_texto,'')), ''), ' '), '');
  v_fuera text[] := (SELECT array_agg(control_obra.texto_norm(x)) FROM unnest(coalesce(p_excluir,'{}')) x
                     WHERE control_obra.texto_norm(x) <> '');
  v_mun text := nullif(control_obra.texto_norm(coalesce(p_municipio,'')), '');
  v_dep text := nullif(control_obra.texto_norm(coalesce(p_dependencia,'')), '');
  v_orden text := coalesce(nullif(p_orden,''), 'apertura');
  v_hoy timestamptz := date_trunc('day', now() AT TIME ZONE 'America/Chihuahua') AT TIME ZONE 'America/Chihuahua';
  v_k control_obra.convocatoria_corridas;
  v_f control_obra.convocatoria_filtros;
BEGIN
  IF v_emp IS NULL OR coalesce(v_niv,0) < 80 THEN
    RAISE EXCEPTION 'No tienes permiso para ver convocatorias' USING ERRCODE = '42501';
  END IF;
  IF v_orden NOT IN ('apertura','publicacion','dependencia') THEN
    RAISE EXCEPTION 'Orden no válido: %', p_orden USING ERRCODE = '22023';
  END IF;
  IF p_corrida_id IS NOT NULL THEN
    SELECT * INTO v_k FROM control_obra.convocatoria_corridas WHERE id = p_corrida_id;
    IF v_k.id IS NULL THEN RAISE EXCEPTION 'La búsqueda % no existe', p_corrida_id USING ERRCODE = 'P0002'; END IF;
  END IF;
  IF p_filtro_id IS NOT NULL THEN
    SELECT * INTO v_f FROM control_obra.convocatoria_filtros WHERE id = p_filtro_id AND empresa_id = v_emp;
    IF v_f.id IS NULL THEN RAISE EXCEPTION 'El filtro % no existe', p_filtro_id USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN QUERY
  WITH f AS (
    SELECT * FROM control_obra.convocatoria_filtros cf WHERE cf.empresa_id = v_emp AND cf.activo
  ), base AS (
    SELECT c.*, s.estado AS s_estado, s.licitacion_id AS s_lic, s.nota AS s_nota, s.updated_at AS s_at,
           dd.estado AS d_estado
    FROM control_obra.convocatorias c
    LEFT JOIN control_obra.convocatoria_seguimiento s ON s.convocatoria_id = c.id AND s.empresa_id = v_emp
    LEFT JOIN control_obra.convocatoria_descargas dd ON dd.convocatoria_id = c.id AND dd.empresa_id = v_emp
    WHERE (v_palabras IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_palabras) w WHERE position(w IN c.texto_norm) = 0))
      AND (v_fuera IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_fuera) x WHERE position(x IN c.texto_norm) > 0))
      AND (v_k.id IS NULL OR (c.fuente = v_k.fuente AND c.ultima_vez_vista >= v_k.inicio
                              AND c.ultima_vez_vista <= coalesce(v_k.fin, now())))
      AND (p_fuentes IS NULL OR cardinality(p_fuentes) = 0 OR c.fuente = ANY (p_fuentes))
      AND (p_tipos IS NULL OR cardinality(p_tipos) = 0 OR c.tipo_contratacion = ANY (p_tipos))
      AND (p_procedimientos IS NULL OR cardinality(p_procedimientos) = 0 OR c.tipo_procedimiento = ANY (p_procedimientos))
      AND (p_estatus IS NULL OR cardinality(p_estatus) = 0 OR coalesce(c.estatus,'vigente') = ANY (p_estatus))
      AND (p_entidades IS NULL OR cardinality(p_entidades) = 0 OR EXISTS (
            SELECT 1 FROM unnest(p_entidades) e
            WHERE control_obra.texto_norm(e) = control_obra.texto_norm(coalesce(c.entidad,''))))
      AND (v_mun IS NULL OR position(v_mun IN control_obra.texto_norm(coalesce(c.municipio,''))) > 0)
      AND (v_dep IS NULL OR position(v_dep IN control_obra.texto_norm(coalesce(c.dependencia,'') || ' ' || coalesce(c.unidad_compradora,''))) > 0)
      AND (p_estados IS NULL OR cardinality(p_estados) = 0 OR coalesce(s.estado,'nueva') = ANY (p_estados))
      AND (p_abren_dias IS NULL OR (c.apertura >= v_hoy AND c.apertura < now() + make_interval(days => p_abren_dias + 1)))
      AND (p_abren_desde IS NULL OR c.apertura >= (p_abren_desde::timestamp AT TIME ZONE 'America/Chihuahua'))
      AND (p_abren_hasta IS NULL OR c.apertura < ((p_abren_hasta + 1)::timestamp AT TIME ZONE 'America/Chihuahua'))
      AND (p_pub_dias IS NULL OR c.publicacion >= v_hoy - make_interval(days => p_pub_dias))
      AND (p_pub_desde IS NULL OR c.publicacion >= (p_pub_desde::timestamp AT TIME ZONE 'America/Chihuahua'))
      AND (p_pub_hasta IS NULL OR c.publicacion < ((p_pub_hasta + 1)::timestamp AT TIME ZONE 'America/Chihuahua'))
      AND (NOT coalesce(p_solo_vigentes, true) OR control_obra.convocatoria_vigente(c.estatus, c.apertura))
      AND (NOT coalesce(p_mis_filtros, false) OR EXISTS (
            SELECT 1 FROM f WHERE control_obra.convocatoria_cumple_filtro(c.texto_norm, c.fuente, c.entidad,
              c.tipo_contratacion, f.palabras_clave, f.palabras_excluir, f.fuentes, f.entidades, f.tipos_contratacion)))
      AND (v_f.id IS NULL OR control_obra.convocatoria_cumple_filtro(c.texto_norm, c.fuente, c.entidad,
              c.tipo_contratacion, v_f.palabras_clave, v_f.palabras_excluir, v_f.fuentes, v_f.entidades, v_f.tipos_contratacion))
  )
  SELECT b.id, b.fuente, b.id_externo, b.numero_procedimiento, b.titulo, b.dependencia, b.unidad_compradora,
         b.tipo_procedimiento, b.tipo_contratacion, b.entidad, b.municipio, b.publicacion, b.junta_aclaraciones,
         b.apertura, b.fallo, b.estatus, b.url_detalle, b.datos, b.primera_vez_vista, b.ultima_vez_vista,
         b.updated_at, coalesce(b.s_estado,'nueva'), b.s_lic, b.s_nota, b.s_at,
         count(*) OVER (), b.descripcion, b.d_estado
  FROM base b
  ORDER BY CASE WHEN v_orden = 'publicacion' THEN b.publicacion END DESC NULLS LAST,
           CASE WHEN v_orden = 'dependencia' THEN control_obra.texto_norm(coalesce(b.dependencia, b.unidad_compradora, '')) END ASC NULLS LAST,
           b.apertura ASC NULLS LAST, b.primera_vez_vista DESC, b.id DESC
  LIMIT greatest(1, least(coalesce(p_limite,200), 1000)) OFFSET greatest(0, coalesce(p_offset,0));
END; $$;
REVOKE ALL ON FUNCTION public.convocatorias_buscar(text,text[],text[],text[],text[],integer,boolean,boolean,integer,integer,bigint,text[],text,text,text[],text[],date,date,integer,date,date,text,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.convocatorias_buscar(text,text[],text[],text[],text[],integer,boolean,boolean,integer,integer,bigint,text[],text,text,text[],text[],date,date,integer,date,date,text,integer) TO anon, authenticated, service_role;

-- 5) Opciones para autocompletar ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convocatorias_opciones()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF control_obra.get_session_empresa_id() IS NULL OR coalesce(control_obra.get_session_nivel(),0) < 80 THEN
    RAISE EXCEPTION 'No tienes permiso para ver convocatorias' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'dependencias', coalesce((SELECT jsonb_agg(jsonb_build_object('v', d, 'n', n) ORDER BY n DESC, d)
                              FROM (SELECT dependencia d, count(*) n FROM control_obra.convocatorias
                                    WHERE coalesce(btrim(dependencia),'') <> '' GROUP BY dependencia
                                    ORDER BY count(*) DESC, dependencia LIMIT 400) x), '[]'::jsonb),
    'municipios', coalesce((SELECT jsonb_agg(jsonb_build_object('v', m, 'n', n) ORDER BY m)
                            FROM (SELECT municipio m, count(*) n FROM control_obra.convocatorias
                                  WHERE coalesce(btrim(municipio),'') <> '' GROUP BY municipio LIMIT 400) x), '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.convocatorias_opciones() FROM public;
GRANT EXECUTE ON FUNCTION public.convocatorias_opciones() TO anon, authenticated, service_role;
