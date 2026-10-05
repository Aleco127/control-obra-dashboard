-- 104_convocatorias_participar.sql (US-844, US-845) — Vista previa de un filtro y «Participar» en una convocatoria.
--
-- PRD licitaciones, épica F. Aditiva sobre 100 (tablas de la épica F) y 092 (guardar_licitacion de la épica C):
--   1) convocatoria_seguimiento.fechas_aceptadas (al final; la vista public se recrea con la lista completa leída de la
--      BD el 5-oct-2026). Guarda las fechas de la convocatoria que la licitación ya tiene (junta, apertura, fallo): si
--      el portal las cambia después, la ficha de la licitación lo avisa (US-845).
--   2) Candado de «convertida»: un trigger impide sacar de «convertida» o cambiar la licitación de un seguimiento ya
--      convertido (también por PostgREST directo, no sólo por RPC). Si la licitación se borró (FK ON DELETE SET NULL) se
--      deja pasar y la convocatoria se puede volver a convertir. Índice único: una licitación nace de una sola
--      convocatoria por empresa.
--   3) get_convocatorias_conteo_filtro(...): cuántas convocatorias vigentes cumplen un filtro SIN guardarlo (vista
--      previa de US-844). Usa control_obra.convocatoria_cumple_filtro (migración 100), la ÚNICA fuente de verdad de la
--      regla; cumpleFiltro() de src/js/convocatorias.js la replica y scripts/qa/convocatorias.test.mjs compara ambas.
--      «Vigente» = la misma regla que convocatorias_buscar con p_solo_vigentes (control_obra.convocatoria_vigente).
--   4) convocatoria_participar(id, datos): crea la licitación con guardar_licitacion y deja el seguimiento en
--      «convertida» con licitacion_id y fechas_aceptadas, todo en una transacción y con la fila bloqueada (dos clics o
--      dos usuarios no crean dos licitaciones).
--   5) get_convocatoria_de_licitacion(lic) y convocatoria_fechas_resolver(lic, actualizar): aviso de cambio de fechas en
--      la ficha y «Actualizar fechas» / «Ignorar».
-- Aplicada en la BD en dos partes (por tamaño): 104_convocatorias_participar (1 a 3) y 104b_convocatorias_participar_rpc (4 y 5).
-- Prefijo get_ en las de lectura: el modo lectura de la app (wrapReadOnly) las deja pasar.

-- 1) Columna nueva + vista ---------------------------------------------------------------------------------------------
ALTER TABLE control_obra.convocatoria_seguimiento ADD COLUMN IF NOT EXISTS fechas_aceptadas jsonb NULL;
CREATE OR REPLACE VIEW public.convocatoria_seguimiento WITH (security_invoker = true) AS
  SELECT id, empresa_id, convocatoria_id, estado, licitacion_id, nota, usuario_id, created_at, updated_at, fechas_aceptadas
  FROM control_obra.convocatoria_seguimiento;
REVOKE ALL ON public.convocatoria_seguimiento FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.convocatoria_seguimiento TO anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS convocatoria_seguimiento_lic_uidx
  ON control_obra.convocatoria_seguimiento (empresa_id, licitacion_id) WHERE licitacion_id IS NOT NULL;

-- 2) Candado de «convertida» ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION control_obra.trg_convocatoria_convertida() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.estado = 'convertida' AND OLD.licitacion_id IS NOT NULL
     AND (NEW.estado <> 'convertida' OR NEW.licitacion_id IS DISTINCT FROM OLD.licitacion_id)
     AND EXISTS (SELECT 1 FROM control_obra.licitaciones l WHERE l.id = OLD.licitacion_id) THEN
    RAISE EXCEPTION 'Esta convocatoria ya se convirtió en una licitación.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_convocatoria_convertida ON control_obra.convocatoria_seguimiento;
CREATE TRIGGER trg_convocatoria_convertida BEFORE UPDATE ON control_obra.convocatoria_seguimiento
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_convocatoria_convertida();

-- 3) Vigente (misma regla que convocatorias_buscar con p_solo_vigentes) y vista previa de un filtro -----------------------
CREATE OR REPLACE FUNCTION control_obra.convocatoria_vigente(p_estatus text, p_apertura timestamptz)
RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT coalesce(p_estatus, 'vigente') IN ('vigente', 'en_seguimiento')
         AND (p_apertura IS NULL OR p_apertura >= now() - interval '1 day');
$$;

CREATE OR REPLACE FUNCTION public.get_convocatorias_conteo_filtro(
  p_claves text[] DEFAULT NULL, p_excluir text[] DEFAULT NULL, p_fuentes text[] DEFAULT NULL,
  p_entidades text[] DEFAULT NULL, p_tipos text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n bigint; v_vig bigint;
BEGIN
  IF control_obra.get_session_empresa_id() IS NULL OR coalesce(control_obra.get_session_nivel(), 0) < 80 THEN
    RAISE EXCEPTION 'No tienes permiso para ver convocatorias' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) FILTER (WHERE control_obra.convocatoria_cumple_filtro(c.texto_norm, c.fuente, c.entidad, c.tipo_contratacion,
                                coalesce(p_claves, '{}'), coalesce(p_excluir, '{}'), coalesce(p_fuentes, '{}'),
                                coalesce(p_entidades, '{}'), coalesce(p_tipos, '{}'))),
         count(*)
    INTO v_n, v_vig
    FROM control_obra.convocatorias c
   WHERE control_obra.convocatoria_vigente(c.estatus, c.apertura);
  RETURN jsonb_build_object('cumplen', v_n, 'vigentes', v_vig);
END; $$;
REVOKE ALL ON FUNCTION public.get_convocatorias_conteo_filtro(text[], text[], text[], text[], text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_convocatorias_conteo_filtro(text[], text[], text[], text[], text[]) TO anon, authenticated, service_role;

-- 4) Participar ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION control_obra.convocatoria_fechas_json(c control_obra.convocatorias)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('junta_aclaraciones', c.junta_aclaraciones, 'apertura', c.apertura, 'fallo', c.fallo);
$$;

CREATE OR REPLACE FUNCTION public.convocatoria_participar(p_convocatoria_id bigint, p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  v_conv control_obra.convocatorias;
  v_seg control_obra.convocatoria_seguimiento;
  v_r jsonb;
BEGIN
  SELECT * INTO v_conv FROM control_obra.convocatorias WHERE id = p_convocatoria_id;
  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'La convocatoria % no existe.', p_convocatoria_id USING ERRCODE = 'P0002';
  END IF;
  IF p_datos IS NULL OR jsonb_typeof(p_datos) <> 'object' THEN
    RAISE EXCEPTION 'Se esperaba un objeto con los datos de la licitación.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO control_obra.convocatoria_seguimiento (empresa_id, convocatoria_id, estado, usuario_id)
  VALUES (v_emp, p_convocatoria_id, 'nueva', control_obra.get_session_user_id())
  ON CONFLICT (empresa_id, convocatoria_id) DO NOTHING;
  SELECT * INTO v_seg FROM control_obra.convocatoria_seguimiento
   WHERE empresa_id = v_emp AND convocatoria_id = p_convocatoria_id FOR UPDATE;
  IF v_seg.estado = 'convertida' AND v_seg.licitacion_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta convocatoria ya se convirtió en una licitación.' USING ERRCODE = '55000';
  END IF;
  v_r := public.guardar_licitacion(p_datos - 'id');
  UPDATE control_obra.convocatoria_seguimiento
     SET estado = 'convertida', licitacion_id = (v_r->>'id')::integer, usuario_id = control_obra.get_session_user_id(),
         fechas_aceptadas = control_obra.convocatoria_fechas_json(v_conv)
   WHERE id = v_seg.id;
  RETURN v_r || jsonb_build_object('convocatoria_id', p_convocatoria_id);
END; $$;
REVOKE ALL ON FUNCTION public.convocatoria_participar(bigint, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.convocatoria_participar(bigint, jsonb) TO anon, authenticated, service_role;

-- 5) Cambio de fechas en la ficha ---------------------------------------------------------------------------------------
-- Devuelve NULL si la licitación no nació de una convocatoria.
CREATE OR REPLACE FUNCTION public.get_convocatoria_de_licitacion(p_licitacion_id integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_emp integer := control_obra.get_session_empresa_id(); v_out jsonb;
BEGIN
  IF v_emp IS NULL OR coalesce(control_obra.get_session_nivel(), 0) < 80 THEN
    RAISE EXCEPTION 'No tienes permiso para ver convocatorias' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
           'convocatoria_id', c.id, 'fuente', c.fuente, 'numero_procedimiento', c.numero_procedimiento,
           'titulo', c.titulo, 'url_detalle', c.url_detalle, 'estatus', c.estatus,
           'actuales', control_obra.convocatoria_fechas_json(c), 'aceptadas', s.fechas_aceptadas,
           'cambio', s.fechas_aceptadas IS NOT NULL AND (
              (s.fechas_aceptadas->>'junta_aclaraciones')::timestamptz IS DISTINCT FROM c.junta_aclaraciones
              OR (s.fechas_aceptadas->>'apertura')::timestamptz IS DISTINCT FROM c.apertura
              OR (s.fechas_aceptadas->>'fallo')::timestamptz IS DISTINCT FROM c.fallo))
    INTO v_out
    FROM control_obra.convocatoria_seguimiento s
    JOIN control_obra.convocatorias c ON c.id = s.convocatoria_id
   WHERE s.empresa_id = v_emp AND s.licitacion_id = p_licitacion_id;
  RETURN v_out;
END; $$;
REVOKE ALL ON FUNCTION public.get_convocatoria_de_licitacion(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_convocatoria_de_licitacion(integer) TO anon, authenticated, service_role;

-- p_actualizar = true: copia a la licitación las fechas actuales de la convocatoria (sólo las que la convocatoria
-- tiene; apertura → presentacion) y las da por aceptadas. false: sólo las da por aceptadas («Ignorar»).
CREATE OR REPLACE FUNCTION public.convocatoria_fechas_resolver(p_licitacion_id integer, p_actualizar boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  v_seg control_obra.convocatoria_seguimiento;
  v_conv control_obra.convocatorias;
  v_datos jsonb;
  v_r jsonb := NULL;
BEGIN
  SELECT * INTO v_seg FROM control_obra.convocatoria_seguimiento
   WHERE empresa_id = v_emp AND licitacion_id = p_licitacion_id FOR UPDATE;
  IF v_seg.id IS NULL THEN
    RAISE EXCEPTION 'Esta licitación no viene de una convocatoria.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_conv FROM control_obra.convocatorias WHERE id = v_seg.convocatoria_id;
  IF coalesce(p_actualizar, false) THEN
    v_datos := jsonb_build_object('id', p_licitacion_id);
    IF v_conv.junta_aclaraciones IS NOT NULL THEN v_datos := v_datos || jsonb_build_object('junta_aclaraciones', v_conv.junta_aclaraciones); END IF;
    IF v_conv.apertura IS NOT NULL THEN v_datos := v_datos || jsonb_build_object('presentacion', v_conv.apertura); END IF;
    IF v_conv.fallo IS NOT NULL THEN v_datos := v_datos || jsonb_build_object('fallo', v_conv.fallo); END IF;
    v_r := public.guardar_licitacion(v_datos);
  END IF;
  UPDATE control_obra.convocatoria_seguimiento SET fechas_aceptadas = control_obra.convocatoria_fechas_json(v_conv)
   WHERE id = v_seg.id;
  RETURN jsonb_build_object('success', true, 'actualizada', coalesce(p_actualizar, false),
                            'licitacion', CASE WHEN v_r IS NULL THEN NULL ELSE v_r->'licitacion' END);
END; $$;
REVOKE ALL ON FUNCTION public.convocatoria_fechas_resolver(integer, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.convocatoria_fechas_resolver(integer, boolean) TO anon, authenticated, service_role;
