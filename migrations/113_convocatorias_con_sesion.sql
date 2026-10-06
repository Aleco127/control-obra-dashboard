-- 113_convocatorias_con_sesion.sql · US-855 (épica L): búsqueda en ComprasMX con la cuenta de la empresa.
--
-- * convocatorias.con_sesion: la convocatoria se trajo (alguna vez) con la cuenta de una empresa.
-- * convocatorias.origen_detalle: 'invitacion' = la trajo la sección de invitaciones del panel del licitante.
-- * convocatorias.sesion_empresa_id: empresa cuya cuenta trajo la invitación. Una invitación es un procedimiento
--   DIRIGIDO a esa empresa: sólo ella la ve en convocatorias_buscar (las demás convocatorias siguen siendo públicas).
-- * convocatoria_corridas.con_sesion: la búsqueda se hizo con la cuenta.
-- convocatorias y convocatoria_corridas NO tienen vista en public (se leen por RPC), así que no hay vistas que recrear:
-- se recrean las RPC que las exponen (convocatorias_buscar, convocatorias_estado) con sus columnas completas leídas de
-- la BD el 5-oct-2026, más las nuevas AL FINAL, y convocatoria_corrida_iniciar / convocatorias_upsert (service_role).
-- Aplicada en 4 partes: 113_convocatorias_con_sesion (columnas + corrida_iniciar), 113b (upsert), 113c (buscar), 113d (estado).
-- Aditiva: columnas nuevas con DEFAULT y parámetros nuevos opcionales al final.

ALTER TABLE control_obra.convocatorias ADD COLUMN IF NOT EXISTS con_sesion boolean NOT NULL DEFAULT false;
ALTER TABLE control_obra.convocatorias ADD COLUMN IF NOT EXISTS origen_detalle text;
ALTER TABLE control_obra.convocatorias ADD COLUMN IF NOT EXISTS sesion_empresa_id integer REFERENCES control_obra.empresas(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'convocatorias_origen_detalle_check') THEN
    ALTER TABLE control_obra.convocatorias ADD CONSTRAINT convocatorias_origen_detalle_check CHECK (origen_detalle IN ('invitacion'));
  END IF;
END $$;
ALTER TABLE control_obra.convocatoria_corridas ADD COLUMN IF NOT EXISTS con_sesion boolean NOT NULL DEFAULT false;

-- 1) Corridas: el conector declara si la búsqueda fue con la cuenta y de qué empresa ------------------------------
DROP FUNCTION IF EXISTS public.convocatoria_corrida_iniciar(text, text);
CREATE OR REPLACE FUNCTION public.convocatoria_corrida_iniciar(p_fuente text, p_origen text, p_con_sesion boolean DEFAULT false,
                                                              p_empresa integer DEFAULT NULL)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO control_obra.convocatoria_corridas (fuente, origen, con_sesion, empresa_id)
  VALUES (p_fuente, p_origen, coalesce(p_con_sesion, false), p_empresa) RETURNING id;
$$;
REVOKE ALL ON FUNCTION public.convocatoria_corrida_iniciar(text, text, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convocatoria_corrida_iniciar(text, text, boolean, integer) TO service_role;

-- 2) Upsert: con_sesion se acumula; origen_detalle y la empresa de la invitación se conservan -----------------------
CREATE OR REPLACE FUNCTION public.convocatorias_upsert(p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
      url_detalle, datos, detalle_at, descripcion, con_sesion, origen_detalle, sesion_empresa_id)
    VALUES (
      it->>'fuente', it->>'id_externo', it->>'numero_procedimiento', coalesce(it->>'titulo',''), it->>'dependencia',
      it->>'unidad_compradora', it->>'tipo_procedimiento', it->>'tipo_contratacion', it->>'entidad', it->>'municipio',
      (it->>'publicacion')::timestamptz, (it->>'junta_aclaraciones')::timestamptz, (it->>'apertura')::timestamptz,
      (it->>'fallo')::timestamptz, it->>'estatus', it->>'url_detalle', coalesce(it->'datos','{}'::jsonb),
      (it->>'detalle_at')::timestamptz, v_desc, coalesce((it->>'con_sesion')::boolean, false),
      CASE WHEN it->>'origen_detalle' = 'invitacion' THEN 'invitacion' END,
      CASE WHEN it->>'origen_detalle' = 'invitacion' THEN (it->>'sesion_empresa_id')::integer END)
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
      con_sesion           = c.con_sesion OR EXCLUDED.con_sesion,
      -- Una convocatoria que ya era pública no se vuelve privada por aparecer también entre las invitaciones.
      origen_detalle       = c.origen_detalle,
      sesion_empresa_id    = c.sesion_empresa_id,
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
REVOKE ALL ON FUNCTION public.convocatorias_upsert(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convocatorias_upsert(jsonb) TO service_role;

-- 3) Lista: dos columnas nuevas al final (con_sesion, origen_detalle), filtro p_con_sesion al final y las invitaciones
--    sólo para la empresa a la que van dirigidas ----------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.convocatorias_buscar(text, text[], text[], text[], text[], integer, boolean, boolean, integer, integer,
  bigint, text[], text, text, text[], text[], date, date, integer, date, date, text, integer);
CREATE OR REPLACE FUNCTION public.convocatorias_buscar(p_texto text DEFAULT NULL::text, p_fuentes text[] DEFAULT NULL::text[],
  p_entidades text[] DEFAULT NULL::text[], p_tipos text[] DEFAULT NULL::text[], p_estados text[] DEFAULT NULL::text[],
  p_abren_dias integer DEFAULT NULL::integer, p_mis_filtros boolean DEFAULT false, p_solo_vigentes boolean DEFAULT true,
  p_limite integer DEFAULT 200, p_offset integer DEFAULT 0, p_corrida_id bigint DEFAULT NULL::bigint,
  p_excluir text[] DEFAULT NULL::text[], p_municipio text DEFAULT NULL::text, p_dependencia text DEFAULT NULL::text,
  p_procedimientos text[] DEFAULT NULL::text[], p_estatus text[] DEFAULT NULL::text[], p_abren_desde date DEFAULT NULL::date,
  p_abren_hasta date DEFAULT NULL::date, p_pub_dias integer DEFAULT NULL::integer, p_pub_desde date DEFAULT NULL::date,
  p_pub_hasta date DEFAULT NULL::date, p_orden text DEFAULT NULL::text, p_filtro_id integer DEFAULT NULL::integer,
  p_con_sesion boolean DEFAULT NULL::boolean)
 RETURNS TABLE(id bigint, fuente text, id_externo text, numero_procedimiento text, titulo text, dependencia text,
  unidad_compradora text, tipo_procedimiento text, tipo_contratacion text, entidad text, municipio text,
  publicacion timestamp with time zone, junta_aclaraciones timestamp with time zone, apertura timestamp with time zone,
  fallo timestamp with time zone, estatus text, url_detalle text, datos jsonb, primera_vez_vista timestamp with time zone,
  ultima_vez_vista timestamp with time zone, updated_at timestamp with time zone, seguimiento_estado text,
  licitacion_id integer, nota text, seguimiento_at timestamp with time zone, total bigint, descripcion text,
  descarga_estado text, con_sesion boolean, origen_detalle text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
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
    WHERE (c.origen_detalle IS DISTINCT FROM 'invitacion' OR c.sesion_empresa_id = v_emp)
      AND (p_con_sesion IS NULL OR c.con_sesion = p_con_sesion)
      AND (v_palabras IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_palabras) w WHERE position(w IN c.texto_norm) = 0))
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
         count(*) OVER (), b.descripcion, b.d_estado, b.con_sesion, b.origen_detalle
  FROM base b
  ORDER BY CASE WHEN v_orden = 'publicacion' THEN b.publicacion END DESC NULLS LAST,
           CASE WHEN v_orden = 'dependencia' THEN control_obra.texto_norm(coalesce(b.dependencia, b.unidad_compradora, '')) END ASC NULLS LAST,
           b.apertura ASC NULLS LAST, b.primera_vez_vista DESC, b.id DESC
  LIMIT greatest(1, least(coalesce(p_limite,200), 1000)) OFFSET greatest(0, coalesce(p_offset,0));
END; $function$;
REVOKE ALL ON FUNCTION public.convocatorias_buscar(text, text[], text[], text[], text[], integer, boolean, boolean, integer, integer,
  bigint, text[], text, text, text[], text[], date, date, integer, date, date, text, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convocatorias_buscar(text, text[], text[], text[], text[], integer, boolean, boolean, integer, integer,
  bigint, text[], text, text, text[], text[], date, date, integer, date, date, text, integer, boolean) TO anon, authenticated, service_role;

-- 4) Pie: ¿la última búsqueda de cada fuente fue con la cuenta? (columna nueva al final) ---------------------------
DROP FUNCTION IF EXISTS public.convocatorias_estado();
CREATE OR REPLACE FUNCTION public.convocatorias_estado()
 RETURNS TABLE(fuente text, ultima_inicio timestamp with time zone, ultima_fin timestamp with time zone, ultima_error text,
  ultima_ok timestamp with time zone, encontradas integer, nuevas integer, vigentes bigint, ultima_id bigint,
  ultima_origen text, ultima_usuario text, ultima_mia boolean, ultima_con_sesion boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE v_emp integer := control_obra.get_session_empresa_id();
BEGIN
  IF v_emp IS NULL OR coalesce(control_obra.get_session_nivel(),0) < 80 THEN
    RAISE EXCEPTION 'No tienes permiso para ver convocatorias' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT fu.f,
         u.inicio, u.fin, u.error,
         (SELECT max(k.fin) FROM control_obra.convocatoria_corridas k WHERE k.fuente = fu.f AND k.error IS NULL AND k.fin IS NOT NULL),
         u.encontradas, u.nuevas,
         (SELECT count(*) FROM control_obra.convocatorias c WHERE c.fuente = fu.f AND c.estatus IN ('vigente','en_seguimiento')),
         u.id, u.origen,
         CASE WHEN u.usuario_id IS NULL THEN NULL
              WHEN u.empresa_id = v_emp THEN (SELECT us.nombre FROM control_obra.obra_usuarios us WHERE us.id = u.usuario_id)
              ELSE 'otra empresa' END,
         coalesce(u.empresa_id = v_emp, false),
         coalesce(u.con_sesion, false)
  FROM (VALUES ('comprasmx'),('chihuahua')) fu(f)
  LEFT JOIN LATERAL (SELECT * FROM control_obra.convocatoria_corridas k WHERE k.fuente = fu.f
                     ORDER BY k.inicio DESC LIMIT 1) u ON true;
END; $function$;
REVOKE ALL ON FUNCTION public.convocatorias_estado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convocatorias_estado() TO anon, authenticated, service_role;
