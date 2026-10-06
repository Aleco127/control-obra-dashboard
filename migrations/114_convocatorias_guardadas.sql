-- 114_convocatorias_guardadas.sql — Pestaña «Guardadas» de Licitaciones (5-oct-2026, pedido de Ricardo).
-- «Guardar» es una marca independiente del seguimiento: no cambia el estado (nueva/interesa/descartada/convertida) y,
-- a diferencia de «Me interesa», NO dispara la descarga de documentos (D14). Aditiva: columna nueva, vista recreada con la
-- lista completa, RPC convocatoria_guardar y convocatorias_buscar con p_guardadas (al final) y guardada_at (al final).

ALTER TABLE control_obra.convocatoria_seguimiento ADD COLUMN IF NOT EXISTS guardada_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS convocatoria_seguimiento_guardadas_idx
  ON control_obra.convocatoria_seguimiento (empresa_id, guardada_at DESC) WHERE guardada_at IS NOT NULL;

CREATE OR REPLACE VIEW public.convocatoria_seguimiento WITH (security_invoker = true) AS
  SELECT id, empresa_id, convocatoria_id, estado, licitacion_id, nota, usuario_id, created_at, updated_at,
         fechas_aceptadas, guardada_at
  FROM control_obra.convocatoria_seguimiento;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.convocatoria_seguimiento TO anon, authenticated;

-- Guardar / quitar de guardadas (nivel >= 80). Crea la fila de seguimiento en «nueva» si no existía.
CREATE OR REPLACE FUNCTION public.convocatoria_guardar(p_convocatoria_id bigint, p_guardar boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_emp integer := control_obra.get_session_empresa_id();
  v_row control_obra.convocatoria_seguimiento;
BEGIN
  IF v_emp IS NULL OR coalesce(control_obra.get_session_nivel(),0) < 80 THEN
    RAISE EXCEPTION 'No tienes permiso para guardar convocatorias' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM control_obra.convocatorias c WHERE c.id = p_convocatoria_id
                 AND (c.origen_detalle IS DISTINCT FROM 'invitacion' OR c.sesion_empresa_id = v_emp)) THEN
    RAISE EXCEPTION 'La convocatoria % no existe', p_convocatoria_id USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO control_obra.convocatoria_seguimiento AS s (empresa_id, convocatoria_id, estado, usuario_id, guardada_at)
  VALUES (v_emp, p_convocatoria_id, 'nueva', control_obra.get_session_user_id(),
          CASE WHEN coalesce(p_guardar, true) THEN now() END)
  ON CONFLICT (empresa_id, convocatoria_id) DO UPDATE
    SET guardada_at = CASE WHEN coalesce(p_guardar, true) THEN coalesce(s.guardada_at, now()) END
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('convocatoria_id', v_row.convocatoria_id, 'estado', v_row.estado, 'guardada_at', v_row.guardada_at);
END; $function$;
REVOKE ALL ON FUNCTION public.convocatoria_guardar(bigint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convocatoria_guardar(bigint, boolean) TO anon, authenticated, service_role;

-- Lista: igual que en 113 más p_guardadas / guardada_at / orden «guardada».
DROP FUNCTION IF EXISTS public.convocatorias_buscar(text, text[], text[], text[], text[], integer, boolean, boolean, integer, integer,
  bigint, text[], text, text, text[], text[], date, date, integer, date, date, text, integer, boolean);
CREATE OR REPLACE FUNCTION public.convocatorias_buscar(p_texto text DEFAULT NULL::text, p_fuentes text[] DEFAULT NULL::text[],
  p_entidades text[] DEFAULT NULL::text[], p_tipos text[] DEFAULT NULL::text[], p_estados text[] DEFAULT NULL::text[],
  p_abren_dias integer DEFAULT NULL::integer, p_mis_filtros boolean DEFAULT false, p_solo_vigentes boolean DEFAULT true,
  p_limite integer DEFAULT 200, p_offset integer DEFAULT 0, p_corrida_id bigint DEFAULT NULL::bigint,
  p_excluir text[] DEFAULT NULL::text[], p_municipio text DEFAULT NULL::text, p_dependencia text DEFAULT NULL::text,
  p_procedimientos text[] DEFAULT NULL::text[], p_estatus text[] DEFAULT NULL::text[], p_abren_desde date DEFAULT NULL::date,
  p_abren_hasta date DEFAULT NULL::date, p_pub_dias integer DEFAULT NULL::integer, p_pub_desde date DEFAULT NULL::date,
  p_pub_hasta date DEFAULT NULL::date, p_orden text DEFAULT NULL::text, p_filtro_id integer DEFAULT NULL::integer,
  p_con_sesion boolean DEFAULT NULL::boolean, p_guardadas boolean DEFAULT NULL::boolean)
 RETURNS TABLE(id bigint, fuente text, id_externo text, numero_procedimiento text, titulo text, dependencia text,
  unidad_compradora text, tipo_procedimiento text, tipo_contratacion text, entidad text, municipio text,
  publicacion timestamp with time zone, junta_aclaraciones timestamp with time zone, apertura timestamp with time zone,
  fallo timestamp with time zone, estatus text, url_detalle text, datos jsonb, primera_vez_vista timestamp with time zone,
  ultima_vez_vista timestamp with time zone, updated_at timestamp with time zone, seguimiento_estado text,
  licitacion_id integer, nota text, seguimiento_at timestamp with time zone, total bigint, descripcion text,
  descarga_estado text, con_sesion boolean, origen_detalle text, guardada_at timestamp with time zone)
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
  IF v_orden NOT IN ('apertura','publicacion','dependencia','guardada') THEN
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
    SELECT c.*, s.estado AS s_estado, s.licitacion_id AS s_lic, s.nota AS s_nota, s.updated_at AS s_at, s.guardada_at AS s_guardada,
           dd.estado AS d_estado
    FROM control_obra.convocatorias c
    LEFT JOIN control_obra.convocatoria_seguimiento s ON s.convocatoria_id = c.id AND s.empresa_id = v_emp
    LEFT JOIN control_obra.convocatoria_descargas dd ON dd.convocatoria_id = c.id AND dd.empresa_id = v_emp
    WHERE (c.origen_detalle IS DISTINCT FROM 'invitacion' OR c.sesion_empresa_id = v_emp)
      AND (p_con_sesion IS NULL OR c.con_sesion = p_con_sesion)
      AND (p_guardadas IS NULL OR (s.guardada_at IS NOT NULL) = p_guardadas)
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
         count(*) OVER (), b.descripcion, b.d_estado, b.con_sesion, b.origen_detalle, b.s_guardada
  FROM base b
  ORDER BY CASE WHEN v_orden = 'guardada' THEN b.s_guardada END DESC NULLS LAST,
           CASE WHEN v_orden = 'publicacion' THEN b.publicacion END DESC NULLS LAST,
           CASE WHEN v_orden = 'dependencia' THEN control_obra.texto_norm(coalesce(b.dependencia, b.unidad_compradora, '')) END ASC NULLS LAST,
           b.apertura ASC NULLS LAST, b.primera_vez_vista DESC, b.id DESC
  LIMIT greatest(1, least(coalesce(p_limite,200), 1000)) OFFSET greatest(0, coalesce(p_offset,0));
END; $function$;
REVOKE ALL ON FUNCTION public.convocatorias_buscar(text, text[], text[], text[], text[], integer, boolean, boolean, integer, integer,
  bigint, text[], text, text, text[], text[], date, date, integer, date, date, text, integer, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convocatorias_buscar(text, text[], text[], text[], text[], integer, boolean, boolean, integer, integer,
  bigint, text[], text, text, text[], text[], date, date, integer, date, date, text, integer, boolean, boolean) TO anon, authenticated, service_role;

