-- 105b_convocatorias_busqueda_manual.sql (US-850, US-846, US-843) — Búsqueda de convocatorias a petición (D12, D13).
--
-- Cambio de alcance del 5-oct-2026 (Ricardo): no hay corridas programadas. Una búsqueda la lanza un usuario desde la
-- pestaña «Convocatorias»: Chihuahua por la función de borde convocatorias-chihuahua con su sesión, ComprasMX por el
-- conector local de su PC (US-851), que escribe por convocatorias-ingesta.
--
-- Aplicada en la BD en tres partes (por tamaño): 105b_convocatorias_busqueda_manual (1 a 4), ..._rpc (5 y 6) y
-- ..._resumen (7 y 8).
--
-- 1) convocatoria_corridas gana usuario_id, empresa_id y filtros (al final; la tabla no tiene vista public).
-- 2) convocatoria_busqueda_iniciar(fuente, origen, usuario, empresa, filtros) — sólo service_role: abre la corrida de
--    una búsqueda de usuario con el límite EN EL SERVIDOR: una búsqueda a la vez por usuario y fuente (una abierta de
--    hace < 5 min la bloquea) y 30 s mínimo desde su búsqueda anterior a la misma fuente. Bloqueo por usuario con
--    pg_advisory_xact_lock para que dos clics simultáneos no pasen los dos.
-- 3) convocatorias_sin_detalle(fuente, ids, horas, limite) — sólo service_role: de los ids que trajo una búsqueda,
--    cuáles necesitan leer su página de detalle (nunca leída o leída hace más de p_horas). Sustituye, en la búsqueda
--    manual, a convocatorias_por_revisar (101), que da por «desaparecidas» todas las vigentes que no vienen en la lista
--    y sólo sirve para un barrido completo.
-- 4) convocatoria_corrida_asignar(corrida, filtros) — nivel >= 80: la app firma como suya una corrida de ComprasMX
--    que abrió el conector local (que no conoce al usuario). Sólo corridas de comprasmx sin usuario y de hace < 15 min.
-- 5) convocatorias_buscar gana p_corrida_id (al final): sólo lo que vio esa corrida = convocatorias de su fuente con
--    ultima_vez_vista dentro de [inicio, fin] de la corrida (el upsert pone ultima_vez_vista = now() a todo lo que toca).
--    Si otro usuario busca en la misma fuente a la vez, sus resultados pueden colarse: aceptado (la vista sólo se usa
--    justo después de la búsqueda). Se recrea (DROP + CREATE) porque cambia la firma; mismos grants.
-- 6) convocatorias_estado se recrea con quién lanzó la última búsqueda (nombre sólo si es de MI empresa; las
--    corridas son globales) y su origen.
-- 7) get_convocatoria_corrida_resumen(corrida): resumen en pantalla tras una búsqueda (US-846): encontradas, nuevas
--    y cuántas de las nuevas cumplen los filtros guardados de la empresa (regla de convocatoria_cumple_filtro).
-- 8) generar_avisos_convocatorias (105) se reduce a los recordatorios a 5 y 2 días de las marcadas «interesa»: ya no
--    hay aviso «tras la corrida diaria» (D12).

-- 1) Columnas -------------------------------------------------------------------------------------------------------
ALTER TABLE control_obra.convocatoria_corridas ADD COLUMN IF NOT EXISTS usuario_id uuid NULL;
ALTER TABLE control_obra.convocatoria_corridas ADD COLUMN IF NOT EXISTS empresa_id integer NULL;
ALTER TABLE control_obra.convocatoria_corridas ADD COLUMN IF NOT EXISTS filtros jsonb NULL;
CREATE INDEX IF NOT EXISTS idx_convocatoria_corridas_usuario ON control_obra.convocatoria_corridas (usuario_id, fuente, inicio DESC)
  WHERE usuario_id IS NOT NULL;

-- 2) Abrir una búsqueda de usuario con límite ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convocatoria_busqueda_iniciar(
  p_fuente text, p_origen text, p_usuario uuid, p_empresa integer, p_filtros jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ult timestamptz; v_id bigint;
BEGIN
  IF p_usuario IS NULL THEN RAISE EXCEPTION 'Falta el usuario de la búsqueda.' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('conv_busqueda:' || p_usuario::text || ':' || p_fuente));
  IF EXISTS (SELECT 1 FROM control_obra.convocatoria_corridas k
              WHERE k.usuario_id = p_usuario AND k.fuente = p_fuente AND k.fin IS NULL AND k.inicio > now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Ya tienes una búsqueda en curso en este portal; espera a que termine.' USING ERRCODE = '55000';
  END IF;
  SELECT max(k.inicio) INTO v_ult FROM control_obra.convocatoria_corridas k
   WHERE k.usuario_id = p_usuario AND k.fuente = p_fuente;
  IF v_ult IS NOT NULL AND v_ult > now() - interval '30 seconds' THEN
    RAISE EXCEPTION 'Espera % s antes de buscar otra vez en este portal.',
      ceil(extract(epoch FROM (v_ult + interval '30 seconds' - now())))::int USING ERRCODE = '55000';
  END IF;
  INSERT INTO control_obra.convocatoria_corridas (fuente, origen, usuario_id, empresa_id, filtros)
  VALUES (p_fuente, left(coalesce(p_origen, 'app'), 40), p_usuario, p_empresa, coalesce(p_filtros, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.convocatoria_busqueda_iniciar(text, text, uuid, integer, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convocatoria_busqueda_iniciar(text, text, uuid, integer, jsonb) TO service_role;

-- 3) Detalles que hacen falta de lo que trajo una búsqueda -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convocatorias_sin_detalle(p_fuente text, p_ids text[], p_horas integer DEFAULT 72, p_limite integer DEFAULT 10)
RETURNS TABLE (id_externo text, url_detalle text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.id_externo, c.url_detalle
    FROM control_obra.convocatorias c
   WHERE c.fuente = p_fuente AND c.id_externo = ANY (coalesce(p_ids, '{}')) AND c.url_detalle IS NOT NULL
     AND (c.detalle_at IS NULL OR c.detalle_at < now() - make_interval(hours => greatest(coalesce(p_horas, 72), 1)))
   ORDER BY c.detalle_at NULLS FIRST,
            CASE WHEN c.id_externo ~ '^\d{1,18}$' THEN c.id_externo::bigint END DESC NULLS LAST
   LIMIT greatest(0, least(coalesce(p_limite, 10), 30));
$$;
REVOKE ALL ON FUNCTION public.convocatorias_sin_detalle(text, text[], integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convocatorias_sin_detalle(text, text[], integer, integer) TO service_role;

-- 4) La app firma la corrida que abrió el conector local de ComprasMX -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.convocatoria_corrida_asignar(p_corrida_id bigint, p_filtros jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_emp integer := control_obra.get_session_empresa_id(); v_n integer;
BEGIN
  IF v_emp IS NULL OR coalesce(control_obra.get_session_nivel(), 0) < 80 THEN
    RAISE EXCEPTION 'No tienes permiso para buscar convocatorias' USING ERRCODE = '42501';
  END IF;
  UPDATE control_obra.convocatoria_corridas k
     SET usuario_id = control_obra.get_session_user_id(), empresa_id = v_emp,
         filtros = coalesce(p_filtros, k.filtros)
   WHERE k.id = p_corrida_id AND k.fuente = 'comprasmx' AND k.usuario_id IS NULL AND k.inicio > now() - interval '15 minutes';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n = 1);
END; $$;
REVOKE ALL ON FUNCTION public.convocatoria_corrida_asignar(bigint, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.convocatoria_corrida_asignar(bigint, jsonb) TO anon, authenticated, service_role;

-- 5) convocatorias_buscar + p_corrida_id ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.convocatorias_buscar(text,text[],text[],text[],text[],integer,boolean,boolean,integer,integer);
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
  p_corrida_id bigint DEFAULT NULL)
RETURNS TABLE (
  id bigint, fuente text, id_externo text, numero_procedimiento text, titulo text, dependencia text,
  unidad_compradora text, tipo_procedimiento text, tipo_contratacion text, entidad text, municipio text,
  publicacion timestamptz, junta_aclaraciones timestamptz, apertura timestamptz, fallo timestamptz,
  estatus text, url_detalle text, datos jsonb, primera_vez_vista timestamptz, ultima_vez_vista timestamptz,
  updated_at timestamptz, seguimiento_estado text, licitacion_id integer, nota text, seguimiento_at timestamptz,
  total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_emp integer := control_obra.get_session_empresa_id();
  v_niv integer := control_obra.get_session_nivel();
  v_txt text := nullif(control_obra.texto_norm(coalesce(p_texto,'')), '');
  v_k control_obra.convocatoria_corridas;
BEGIN
  IF v_emp IS NULL OR coalesce(v_niv,0) < 80 THEN
    RAISE EXCEPTION 'No tienes permiso para ver convocatorias' USING ERRCODE = '42501';
  END IF;
  IF p_corrida_id IS NOT NULL THEN
    SELECT * INTO v_k FROM control_obra.convocatoria_corridas WHERE id = p_corrida_id;
    IF v_k.id IS NULL THEN RAISE EXCEPTION 'La búsqueda % no existe', p_corrida_id USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN QUERY
  WITH f AS (
    SELECT * FROM control_obra.convocatoria_filtros cf WHERE cf.empresa_id = v_emp AND cf.activo
  ), base AS (
    SELECT c.*, s.estado AS s_estado, s.licitacion_id AS s_lic, s.nota AS s_nota, s.updated_at AS s_at
    FROM control_obra.convocatorias c
    LEFT JOIN control_obra.convocatoria_seguimiento s ON s.convocatoria_id = c.id AND s.empresa_id = v_emp
    WHERE (v_txt IS NULL OR position(v_txt IN c.texto_norm) > 0)
      AND (v_k.id IS NULL OR (c.fuente = v_k.fuente AND c.ultima_vez_vista >= v_k.inicio
                              AND c.ultima_vez_vista <= coalesce(v_k.fin, now())))
      AND (p_fuentes IS NULL OR cardinality(p_fuentes) = 0 OR c.fuente = ANY (p_fuentes))
      AND (p_tipos IS NULL OR cardinality(p_tipos) = 0 OR c.tipo_contratacion = ANY (p_tipos))
      AND (p_entidades IS NULL OR cardinality(p_entidades) = 0 OR EXISTS (
            SELECT 1 FROM unnest(p_entidades) e
            WHERE control_obra.texto_norm(e) = control_obra.texto_norm(coalesce(c.entidad,''))))
      AND (p_estados IS NULL OR cardinality(p_estados) = 0 OR coalesce(s.estado,'nueva') = ANY (p_estados))
      AND (p_abren_dias IS NULL OR (c.apertura >= date_trunc('day', now() AT TIME ZONE 'America/Chihuahua') AT TIME ZONE 'America/Chihuahua'
                                    AND c.apertura < now() + make_interval(days => p_abren_dias + 1)))
      AND (NOT coalesce(p_solo_vigentes, true) OR control_obra.convocatoria_vigente(c.estatus, c.apertura))
      AND (NOT coalesce(p_mis_filtros, false) OR EXISTS (
            SELECT 1 FROM f WHERE control_obra.convocatoria_cumple_filtro(c.texto_norm, c.fuente, c.entidad,
              c.tipo_contratacion, f.palabras_clave, f.palabras_excluir, f.fuentes, f.entidades, f.tipos_contratacion)))
  )
  SELECT b.id, b.fuente, b.id_externo, b.numero_procedimiento, b.titulo, b.dependencia, b.unidad_compradora,
         b.tipo_procedimiento, b.tipo_contratacion, b.entidad, b.municipio, b.publicacion, b.junta_aclaraciones,
         b.apertura, b.fallo, b.estatus, b.url_detalle, b.datos, b.primera_vez_vista, b.ultima_vez_vista,
         b.updated_at, coalesce(b.s_estado,'nueva'), b.s_lic, b.s_nota, b.s_at,
         count(*) OVER ()
  FROM base b
  ORDER BY b.apertura ASC NULLS LAST, b.primera_vez_vista DESC, b.id DESC
  LIMIT greatest(1, least(coalesce(p_limite,200), 1000)) OFFSET greatest(0, coalesce(p_offset,0));
END; $$;
REVOKE ALL ON FUNCTION public.convocatorias_buscar(text,text[],text[],text[],text[],integer,boolean,boolean,integer,integer,bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.convocatorias_buscar(text,text[],text[],text[],text[],integer,boolean,boolean,integer,integer,bigint) TO anon, authenticated, service_role;

-- 6) convocatorias_estado con quién lanzó la última búsqueda -------------------------------------------------------------
DROP FUNCTION IF EXISTS public.convocatorias_estado();
CREATE OR REPLACE FUNCTION public.convocatorias_estado()
RETURNS TABLE (fuente text, ultima_inicio timestamptz, ultima_fin timestamptz, ultima_error text,
               ultima_ok timestamptz, encontradas integer, nuevas integer, vigentes bigint,
               ultima_id bigint, ultima_origen text, ultima_usuario text, ultima_mia boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
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
         coalesce(u.empresa_id = v_emp, false)
  FROM (VALUES ('comprasmx'),('chihuahua')) fu(f)
  LEFT JOIN LATERAL (SELECT * FROM control_obra.convocatoria_corridas k WHERE k.fuente = fu.f
                     ORDER BY k.inicio DESC LIMIT 1) u ON true;
END; $$;
REVOKE ALL ON FUNCTION public.convocatorias_estado() FROM public;
GRANT EXECUTE ON FUNCTION public.convocatorias_estado() TO anon, authenticated, service_role;

-- 7) Resumen de una búsqueda --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_convocatoria_corrida_resumen(p_corrida_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_emp integer := control_obra.get_session_empresa_id(); v_k control_obra.convocatoria_corridas; v_out jsonb;
BEGIN
  IF v_emp IS NULL OR coalesce(control_obra.get_session_nivel(), 0) < 80 THEN
    RAISE EXCEPTION 'No tienes permiso para ver convocatorias' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_k FROM control_obra.convocatoria_corridas WHERE id = p_corrida_id;
  IF v_k.id IS NULL THEN RETURN NULL; END IF;
  WITH vis AS (
    SELECT c.* FROM control_obra.convocatorias c
     WHERE c.fuente = v_k.fuente AND c.ultima_vez_vista >= v_k.inicio AND c.ultima_vez_vista <= coalesce(v_k.fin, now())
  ), nv AS (
    SELECT * FROM vis WHERE vis.primera_vez_vista >= v_k.inicio
  )
  SELECT jsonb_build_object(
    'corrida_id', v_k.id, 'fuente', v_k.fuente, 'inicio', v_k.inicio, 'fin', v_k.fin, 'error', v_k.error,
    'encontradas', v_k.encontradas, 'nuevas', v_k.nuevas, 'vistas', (SELECT count(*) FROM vis),
    'nuevas_cumplen', (SELECT count(*) FROM nv WHERE EXISTS (
        SELECT 1 FROM control_obra.convocatoria_filtros f WHERE f.empresa_id = v_emp AND f.activo
           AND control_obra.convocatoria_cumple_filtro(nv.texto_norm, nv.fuente, nv.entidad, nv.tipo_contratacion,
                 f.palabras_clave, f.palabras_excluir, f.fuentes, f.entidades, f.tipos_contratacion))),
    'hay_filtros', EXISTS (SELECT 1 FROM control_obra.convocatoria_filtros f WHERE f.empresa_id = v_emp AND f.activo))
  INTO v_out;
  RETURN v_out;
END; $$;
REVOKE ALL ON FUNCTION public.get_convocatoria_corrida_resumen(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.get_convocatoria_corrida_resumen(bigint) TO anon, authenticated, service_role;

-- 8) Sólo recordatorios (sin aviso «tras la corrida diaria») ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generar_avisos_convocatorias(p_simular boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_ins integer := 0; v_cerr integer := 0; v_n integer;
  v_res jsonb;
BEGIN
  DROP TABLE IF EXISTS pg_temp.conv_avisos;
  CREATE TEMP TABLE conv_avisos (empresa_id integer, usuario_id uuid, clave text, tipo text, severidad text,
                                 titulo text, cuerpo text) ON COMMIT DROP;

  WITH rec AS (
    SELECT s.empresa_id, c.id AS conv_id, c.titulo, c.numero_procedimiento, c.apertura,
           (c.apertura AT TIME ZONE 'America/Mexico_City')::date - v_hoy AS dias
      FROM control_obra.convocatoria_seguimiento s
      JOIN control_obra.convocatorias c ON c.id = s.convocatoria_id
      JOIN control_obra.empresas e ON e.id = s.empresa_id AND coalesce(e.activo, true) AND e.baja_programada_at IS NULL
     WHERE s.estado = 'interesa' AND c.apertura IS NOT NULL
       AND coalesce(c.estatus, 'vigente') IN ('vigente', 'en_seguimiento')
  ), umb AS (
    SELECT rec.*, CASE WHEN dias BETWEEN 0 AND 2 THEN '2' ELSE '5' END AS umbral
      FROM rec WHERE dias BETWEEN 0 AND 5
  )
  INSERT INTO pg_temp.conv_avisos
  SELECT u.empresa_id, us.id,
         'conv_rec_' || u.conv_id || '_' || u.umbral || '_' || us.id,
         'convocatoria_recordatorio', CASE u.umbral WHEN '2' THEN 'danger' ELSE 'warning' END,
         CASE WHEN u.dias = 0 THEN 'Abre hoy: ' WHEN u.dias = 1 THEN 'Abre mañana: '
              ELSE 'Abre en ' || u.dias || ' días: ' END || left(coalesce(u.numero_procedimiento || ' · ', '') || u.titulo, 120),
         'Apertura de propuestas el ' || to_char(u.apertura AT TIME ZONE 'America/Mexico_City', 'DD/MM/YYYY HH24:MI')
           || '. La marcaste «Me interesa» y aún no es licitación: conviértela con «Participar» en Licitaciones › Convocatorias o descártala.'
    FROM umb u
    JOIN control_obra.obra_usuarios us ON us.empresa_id = u.empresa_id AND coalesce(us.activo, true)
    JOIN control_obra.obra_roles r ON r.id = us.rol_id AND r.nivel_acceso >= 80;

  SELECT jsonb_build_object(
           'simulado', coalesce(p_simular, false),
           'recordatorios', (SELECT count(DISTINCT split_part(a.clave, '_', 3) || '_' || split_part(a.clave, '_', 4))
                               FROM pg_temp.conv_avisos a),
           'por_insertar', (SELECT count(*) FROM pg_temp.conv_avisos a
                             WHERE NOT EXISTS (SELECT 1 FROM control_obra.notificaciones n
                                                WHERE n.empresa_id = a.empresa_id AND n.clave = a.clave)),
           'avisos', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa_id', a.empresa_id, 'usuario_id', a.usuario_id,
                                 'clave', a.clave, 'titulo', a.titulo) ORDER BY a.clave)
                                 FROM pg_temp.conv_avisos a), '[]'::jsonb))
    INTO v_res;

  IF coalesce(p_simular, false) THEN
    RETURN v_res;
  END IF;

  INSERT INTO control_obra.notificaciones (empresa_id, usuario_id, clave, tipo, severidad, titulo, cuerpo, modulo)
  SELECT a.empresa_id, a.usuario_id, a.clave, a.tipo, a.severidad, a.titulo, a.cuerpo, 'lc' FROM pg_temp.conv_avisos a
  ON CONFLICT (empresa_id, clave) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_ins := v_n;

  UPDATE control_obra.notificaciones n SET leida_at = now()
   WHERE n.leida_at IS NULL AND n.tipo = 'convocatoria_recordatorio'
     AND NOT EXISTS (SELECT 1 FROM control_obra.convocatoria_seguimiento s
                      WHERE s.empresa_id = n.empresa_id AND s.estado = 'interesa'
                        AND s.convocatoria_id = split_part(n.clave, '_', 3)::bigint);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_cerr := v_n;

  RETURN (v_res - 'avisos') || jsonb_build_object('insertadas', v_ins, 'cerradas', v_cerr);
END; $$;
REVOKE ALL ON FUNCTION public.generar_avisos_convocatorias(boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generar_avisos_convocatorias(boolean) TO service_role;
