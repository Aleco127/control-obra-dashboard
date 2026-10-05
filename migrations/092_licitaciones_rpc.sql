-- 092_licitaciones_rpc.sql (épica C: US-813, US-814, US-816, US-818, US-821) — Escrituras de licitaciones y
-- requisitos por RPC.
--
-- Reglas (PRD §3, D3, D8):
--   * Funciones SECURITY INVOKER: la RLS de 080/084 (empresa de la sesión y nivel >= 80) sigue mandando; además cada
--     función valida sesión y nivel para devolver un mensaje claro en español.
--   * «Clave ausente = no tocar»: en una edición sólo cambian las columnas que vienen en p_datos.
--   * Los datos de la convocante (bases.json de LicitaGen) viven en licitaciones.bases con el formato
--     licitacion-bases/v1 (docs/licitaciones/licitacion-bases.schema.json); las fechas clave y montos que se
--     consultan en listas tienen su propia columna.
--   * Columna nueva licitaciones.lecciones (pestaña Cierre, US-821), al final de la vista.
--   * cambiar_estado_requisito escribe el historial por el trigger de 080 (nota por control_obra.nota_estado) y no deja
--     pasar a «listo» o más allá si el documento del expediente ligado vence antes de la presentación (US-818).
-- Aditiva: no toca tablas, funciones ni políticas de otras épicas.

-- 1) Columna de lecciones aprendidas ------------------------------------------------------------------------------------
ALTER TABLE control_obra.licitaciones ADD COLUMN IF NOT EXISTS lecciones text NULL;

-- La vista se recrea con la lista de columnas leída de la BD el 4-oct-2026 + lecciones al final.
CREATE OR REPLACE VIEW public.licitaciones WITH (security_invoker = true) AS
  SELECT id, empresa_id, codigo, nombre, convocante, perfil_id, modalidad, ubicacion, plaza, visita,
         junta_aclaraciones, presentacion, fallo, inicio_obra, plazo_dias, anticipo_pct, presupuesto_base,
         monto_propuesto, monto_ganador, ganador, estatus, bases, opus_proyecto, obra_id, notas, created_by,
         created_at, updated_at, lecciones
  FROM control_obra.licitaciones;

-- 2) Guardas comunes ----------------------------------------------------------------------------------------------------
-- Devuelve la empresa de la sesión o lanza el error en español (sesión, nivel 80).
CREATE OR REPLACE FUNCTION control_obra.licit_sesion_n80()
RETURNS integer LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE v_emp integer;
BEGIN
  IF control_obra.get_session_user_id() IS NULL THEN
    RAISE EXCEPTION 'Tu sesión terminó: vuelve a iniciar sesión.' USING ERRCODE = '28000';
  END IF;
  IF COALESCE(control_obra.get_session_nivel(), 0) < 80 THEN
    RAISE EXCEPTION 'Sólo un administrador o un gerente de obra puede trabajar con licitaciones.' USING ERRCODE = '42501';
  END IF;
  v_emp := control_obra.get_session_empresa_id();
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Tu usuario no tiene empresa.' USING ERRCODE = '22023';
  END IF;
  RETURN v_emp;
END; $$;
REVOKE ALL ON FUNCTION control_obra.licit_sesion_n80() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control_obra.licit_sesion_n80() TO anon, authenticated;

-- 3) guardar_licitacion (US-813, US-814, US-821) ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardar_licitacion(p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  p jsonb := COALESCE(p_datos, '{}'::jsonb);
  v_id integer := NULLIF(p->>'id', '')::integer;
  v_row control_obra.licitaciones%ROWTYPE;
  v_perfil integer; v_obra integer;
BEGIN
  IF jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Se esperaba un objeto con los datos de la licitación.' USING ERRCODE = '22023';
  END IF;
  IF p ? 'bases' AND jsonb_typeof(p->'bases') <> 'object' THEN
    RAISE EXCEPTION 'Las bases deben ser un objeto.' USING ERRCODE = '22023';
  END IF;
  v_perfil := NULLIF(p->>'perfil_id', '')::integer;
  IF p ? 'perfil_id' AND v_perfil IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM control_obra.perfiles_convocante pc WHERE pc.id = v_perfil AND (pc.empresa_id IS NULL OR pc.empresa_id = v_emp)) THEN
    RAISE EXCEPTION 'El perfil de convocante no existe.' USING ERRCODE = '22023';
  END IF;
  v_obra := NULLIF(p->>'obra_id', '')::integer;
  IF p ? 'obra_id' AND v_obra IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM control_obra.obras o WHERE o.id = v_obra AND o.empresa_id = v_emp) THEN
    RAISE EXCEPTION 'La obra no pertenece a tu empresa.' USING ERRCODE = '42501';
  END IF;

  BEGIN
    IF v_id IS NULL THEN
      IF NULLIF(btrim(p->>'codigo'), '') IS NULL OR NULLIF(btrim(p->>'nombre'), '') IS NULL THEN
        RAISE EXCEPTION 'Escribe el código y el nombre de la licitación.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO control_obra.licitaciones (codigo, nombre, convocante, perfil_id, modalidad, ubicacion, plaza, visita,
        junta_aclaraciones, presentacion, fallo, inicio_obra, plazo_dias, anticipo_pct, presupuesto_base, monto_propuesto,
        monto_ganador, ganador, estatus, bases, opus_proyecto, obra_id, notas, lecciones)
      VALUES (btrim(p->>'codigo'), btrim(p->>'nombre'), NULLIF(btrim(p->>'convocante'), ''), v_perfil,
        NULLIF(p->>'modalidad', ''), NULLIF(btrim(p->>'ubicacion'), ''), NULLIF(p->>'plaza', ''),
        NULLIF(p->>'visita', '')::timestamptz, NULLIF(p->>'junta_aclaraciones', '')::timestamptz,
        NULLIF(p->>'presentacion', '')::timestamptz, NULLIF(p->>'fallo', '')::timestamptz,
        NULLIF(p->>'inicio_obra', '')::date, NULLIF(p->>'plazo_dias', '')::integer, NULLIF(p->>'anticipo_pct', '')::numeric,
        NULLIF(p->>'presupuesto_base', '')::numeric, NULLIF(p->>'monto_propuesto', '')::numeric,
        NULLIF(p->>'monto_ganador', '')::numeric, NULLIF(btrim(p->>'ganador'), ''),
        COALESCE(NULLIF(p->>'estatus', ''), 'en_preparacion'), COALESCE(p->'bases', '{}'::jsonb),
        NULLIF(btrim(p->>'opus_proyecto'), ''), v_obra, NULLIF(p->>'notas', ''), NULLIF(p->>'lecciones', ''))
      RETURNING * INTO v_row;
    ELSE
      UPDATE control_obra.licitaciones l SET
        codigo             = CASE WHEN p ? 'codigo' THEN btrim(p->>'codigo') ELSE l.codigo END,
        nombre             = CASE WHEN p ? 'nombre' THEN btrim(p->>'nombre') ELSE l.nombre END,
        convocante         = CASE WHEN p ? 'convocante' THEN NULLIF(btrim(p->>'convocante'), '') ELSE l.convocante END,
        perfil_id          = CASE WHEN p ? 'perfil_id' THEN v_perfil ELSE l.perfil_id END,
        modalidad          = CASE WHEN p ? 'modalidad' THEN NULLIF(p->>'modalidad', '') ELSE l.modalidad END,
        ubicacion          = CASE WHEN p ? 'ubicacion' THEN NULLIF(btrim(p->>'ubicacion'), '') ELSE l.ubicacion END,
        plaza              = CASE WHEN p ? 'plaza' THEN NULLIF(p->>'plaza', '') ELSE l.plaza END,
        visita             = CASE WHEN p ? 'visita' THEN NULLIF(p->>'visita', '')::timestamptz ELSE l.visita END,
        junta_aclaraciones = CASE WHEN p ? 'junta_aclaraciones' THEN NULLIF(p->>'junta_aclaraciones', '')::timestamptz ELSE l.junta_aclaraciones END,
        presentacion       = CASE WHEN p ? 'presentacion' THEN NULLIF(p->>'presentacion', '')::timestamptz ELSE l.presentacion END,
        fallo              = CASE WHEN p ? 'fallo' THEN NULLIF(p->>'fallo', '')::timestamptz ELSE l.fallo END,
        inicio_obra        = CASE WHEN p ? 'inicio_obra' THEN NULLIF(p->>'inicio_obra', '')::date ELSE l.inicio_obra END,
        plazo_dias         = CASE WHEN p ? 'plazo_dias' THEN NULLIF(p->>'plazo_dias', '')::integer ELSE l.plazo_dias END,
        anticipo_pct       = CASE WHEN p ? 'anticipo_pct' THEN NULLIF(p->>'anticipo_pct', '')::numeric ELSE l.anticipo_pct END,
        presupuesto_base   = CASE WHEN p ? 'presupuesto_base' THEN NULLIF(p->>'presupuesto_base', '')::numeric ELSE l.presupuesto_base END,
        monto_propuesto    = CASE WHEN p ? 'monto_propuesto' THEN NULLIF(p->>'monto_propuesto', '')::numeric ELSE l.monto_propuesto END,
        monto_ganador      = CASE WHEN p ? 'monto_ganador' THEN NULLIF(p->>'monto_ganador', '')::numeric ELSE l.monto_ganador END,
        ganador            = CASE WHEN p ? 'ganador' THEN NULLIF(btrim(p->>'ganador'), '') ELSE l.ganador END,
        estatus            = CASE WHEN p ? 'estatus' THEN COALESCE(NULLIF(p->>'estatus', ''), l.estatus) ELSE l.estatus END,
        bases              = CASE WHEN p ? 'bases' THEN p->'bases' ELSE l.bases END,
        opus_proyecto      = CASE WHEN p ? 'opus_proyecto' THEN NULLIF(btrim(p->>'opus_proyecto'), '') ELSE l.opus_proyecto END,
        obra_id            = CASE WHEN p ? 'obra_id' THEN v_obra ELSE l.obra_id END,
        notas              = CASE WHEN p ? 'notas' THEN NULLIF(p->>'notas', '') ELSE l.notas END,
        lecciones          = CASE WHEN p ? 'lecciones' THEN NULLIF(p->>'lecciones', '') ELSE l.lecciones END
      WHERE l.id = v_id AND l.empresa_id = v_emp
      RETURNING * INTO v_row;
      IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'La licitación no existe o no es de tu empresa.' USING ERRCODE = '42501';
      END IF;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya existe otra licitación con el código %.', btrim(p->>'codigo') USING ERRCODE = '23505';
    WHEN check_violation THEN
      RAISE EXCEPTION 'Algún dato no es válido (revisa estatus, modalidad, plaza, plazo y anticipo).' USING ERRCODE = '23514';
    WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
      RAISE EXCEPTION 'Hay una fecha o una cifra con formato no válido.' USING ERRCODE = '22007';
  END;
  RETURN jsonb_build_object('success', true, 'id', v_row.id, 'licitacion', to_jsonb(v_row) - 'empresa_id');
END; $$;

-- 4) guardar_requisito (US-816, US-818) -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardar_requisito(p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  p jsonb := COALESCE(p_datos, '{}'::jsonb);
  v_id integer := NULLIF(p->>'id', '')::integer;
  v_lic integer;
  v_doc integer := NULLIF(p->>'empresa_documento_id', '')::integer;
  v_path text := NULLIF(p->>'archivo_path', '');
  v_row control_obra.licitacion_requisitos%ROWTYPE;
BEGIN
  IF v_id IS NULL THEN
    v_lic := NULLIF(p->>'licitacion_id', '')::integer;
  ELSE
    SELECT licitacion_id INTO v_lic FROM control_obra.licitacion_requisitos WHERE id = v_id AND empresa_id = v_emp;
  END IF;
  IF v_lic IS NULL OR NOT EXISTS (SELECT 1 FROM control_obra.licitaciones WHERE id = v_lic AND empresa_id = v_emp) THEN
    RAISE EXCEPTION 'La licitación o el requisito no existen.' USING ERRCODE = '42501';
  END IF;
  IF p ? 'empresa_documento_id' AND v_doc IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM control_obra.empresa_documentos d WHERE d.id = v_doc AND d.empresa_id = v_emp) THEN
    RAISE EXCEPTION 'El documento del expediente no es de tu empresa.' USING ERRCODE = '42501';
  END IF;
  IF p ? 'archivo_path' AND v_path IS NOT NULL
     AND v_path NOT LIKE 'empresa/' || v_emp || '/licitaciones/' || v_lic || '/%' THEN
    RAISE EXCEPTION 'La ruta del archivo no corresponde a esta licitación.' USING ERRCODE = '42501';
  END IF;

  BEGIN
    IF v_id IS NULL THEN
      IF NULLIF(btrim(p->>'anexo_id'), '') IS NULL THEN
        RAISE EXCEPTION 'Escribe la clave del anexo.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO control_obra.licitacion_requisitos (licitacion_id, anexo_id, sobre, descripcion, origen, requiere_firma,
        categoria_expediente, empresa_documento_id, archivo_path, responsable, orden, notas)
      VALUES (v_lic, btrim(p->>'anexo_id'), COALESCE(NULLIF(p->>'sobre', ''), 'legal'), COALESCE(p->>'descripcion', ''),
        COALESCE(NULLIF(p->>'origen', ''), 'se_genera'), COALESCE((p->>'requiere_firma')::boolean, false),
        NULLIF(p->>'categoria_expediente', ''), v_doc, v_path, NULLIF(btrim(p->>'responsable'), ''),
        COALESCE(NULLIF(p->>'orden', '')::integer,
                 (SELECT COALESCE(max(orden), 0) + 1 FROM control_obra.licitacion_requisitos
                   WHERE licitacion_id = v_lic AND sobre = COALESCE(NULLIF(p->>'sobre', ''), 'legal'))),
        NULLIF(p->>'notas', ''))
      RETURNING * INTO v_row;
    ELSE
      UPDATE control_obra.licitacion_requisitos r SET
        anexo_id             = CASE WHEN p ? 'anexo_id' THEN btrim(p->>'anexo_id') ELSE r.anexo_id END,
        sobre                = CASE WHEN p ? 'sobre' THEN p->>'sobre' ELSE r.sobre END,
        descripcion          = CASE WHEN p ? 'descripcion' THEN COALESCE(p->>'descripcion', '') ELSE r.descripcion END,
        origen               = CASE WHEN p ? 'origen' THEN p->>'origen' ELSE r.origen END,
        requiere_firma       = CASE WHEN p ? 'requiere_firma' THEN COALESCE((p->>'requiere_firma')::boolean, false) ELSE r.requiere_firma END,
        categoria_expediente = CASE WHEN p ? 'categoria_expediente' THEN NULLIF(p->>'categoria_expediente', '') ELSE r.categoria_expediente END,
        empresa_documento_id = CASE WHEN p ? 'empresa_documento_id' THEN v_doc ELSE r.empresa_documento_id END,
        archivo_path         = CASE WHEN p ? 'archivo_path' THEN v_path ELSE r.archivo_path END,
        responsable          = CASE WHEN p ? 'responsable' THEN NULLIF(btrim(p->>'responsable'), '') ELSE r.responsable END,
        orden                = CASE WHEN p ? 'orden' THEN COALESCE(NULLIF(p->>'orden', '')::integer, r.orden) ELSE r.orden END,
        notas                = CASE WHEN p ? 'notas' THEN NULLIF(p->>'notas', '') ELSE r.notas END
      WHERE r.id = v_id AND r.empresa_id = v_emp
      RETURNING * INTO v_row;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya hay un requisito con el anexo % en esta licitación.', btrim(p->>'anexo_id') USING ERRCODE = '23505';
    WHEN check_violation THEN
      RAISE EXCEPTION 'Algún dato del requisito no es válido (sobre u origen).' USING ERRCODE = '23514';
  END;
  RETURN jsonb_build_object('success', true, 'id', v_row.id, 'requisito', to_jsonb(v_row) - 'empresa_id');
END; $$;

-- 5) Vencimiento del documento ligado contra la presentación (US-818) --------------------------------------------------------
-- NULL si no hay problema; si el documento ligado vence antes de la fecha civil de presentación (México), su fecha.
CREATE OR REPLACE FUNCTION control_obra.licit_requisito_vence(p_requisito_id integer)
RETURNS date LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
  SELECT d.fecha_vencimiento
    FROM control_obra.licitacion_requisitos r
    JOIN control_obra.licitaciones l ON l.id = r.licitacion_id
    JOIN control_obra.empresa_documentos d ON d.id = r.empresa_documento_id
   WHERE r.id = p_requisito_id
     AND d.fecha_vencimiento IS NOT NULL
     AND d.fecha_vencimiento < COALESCE((l.presentacion AT TIME ZONE 'America/Mexico_City')::date,
                                        (now() AT TIME ZONE 'America/Mexico_City')::date);
$$;
GRANT EXECUTE ON FUNCTION control_obra.licit_requisito_vence(integer) TO anon, authenticated;

-- 6) cambiar_estado_requisito (US-816, US-818) ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cambiar_estado_requisito(p_id integer, p_estado text, p_nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  v_vence date;
  v_row control_obra.licitacion_requisitos%ROWTYPE;
BEGIN
  IF p_estado IS NULL OR p_estado NOT IN ('pendiente','en_revision','listo','firmado','escaneado','foliado','validado') THEN
    RAISE EXCEPTION 'Estado no válido.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM control_obra.licitacion_requisitos WHERE id = p_id AND empresa_id = v_emp) THEN
    RAISE EXCEPTION 'El requisito no existe.' USING ERRCODE = '42501';
  END IF;
  IF p_estado IN ('listo','firmado','escaneado','foliado','validado') THEN
    v_vence := control_obra.licit_requisito_vence(p_id);
    IF v_vence IS NOT NULL THEN
      RAISE EXCEPTION 'El documento ligado del expediente vence el %, antes de la presentación: renuévalo en el Expediente antes de marcarlo como listo.',
        to_char(v_vence, 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;
  END IF;
  PERFORM set_config('control_obra.nota_estado', COALESCE(NULLIF(btrim(p_nota), ''), ''), true);
  UPDATE control_obra.licitacion_requisitos SET estado = p_estado WHERE id = p_id AND empresa_id = v_emp RETURNING * INTO v_row;
  PERFORM set_config('control_obra.nota_estado', '', true);
  RETURN jsonb_build_object('success', true, 'id', v_row.id, 'estado', v_row.estado);
END; $$;

-- 7) ordenar_requisitos (US-816): el arreglo trae los ids de un sobre en el orden nuevo ----------------------------------
CREATE OR REPLACE FUNCTION public.ordenar_requisitos(p_licitacion_id integer, p_ids integer[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE v_emp integer := control_obra.licit_sesion_n80(); v_n integer;
BEGIN
  UPDATE control_obra.licitacion_requisitos r SET orden = x.ord
    FROM unnest(p_ids) WITH ORDINALITY AS x(id, ord)
   WHERE r.id = x.id AND r.licitacion_id = p_licitacion_id AND r.empresa_id = v_emp AND r.orden IS DISTINCT FROM x.ord;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'actualizados', v_n);
END; $$;

-- 8) Privilegios -------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.guardar_licitacion(jsonb), public.guardar_requisito(jsonb),
  public.cambiar_estado_requisito(integer, text, text), public.ordenar_requisitos(integer, integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_licitacion(jsonb), public.guardar_requisito(jsonb),
  public.cambiar_estado_requisito(integer, text, text), public.ordenar_requisitos(integer, integer[]) TO anon, authenticated;
-- La vista recreada conserva sus grants; se reafirman los mínimos (sin TRUNCATE).
REVOKE ALL ON public.licitaciones FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.licitaciones TO anon, authenticated;
