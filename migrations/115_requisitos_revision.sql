-- 115_requisitos_revision.sql — Pestaña «Sobres» de la ficha de licitación: palomear cada requisito a mano y tener a la
-- mano los archivos de donde sale (Word, Excel y PDF generados) para corregirlos uno por uno.
--
--   * licitacion_requisitos.revisado_at / revisado_por: la palomita de revisión. Es independiente del estado del
--     requisito (pendiente → … → validado): no pasa por cambiar_estado_requisito ni deja historial de estado.
--   * licitacion_requisitos.archivos_base: arreglo [{path, nombre, tipo, tamano, hash}] con los archivos editables o
--     generados del anexo, en el bucket `licitaciones` bajo empresa/<id>/licitaciones/<lic>/base/. Un mismo objeto puede
--     servir a varios requisitos (p. ej. el «Formas O.P. OK.docx» llenado): al quitarlo de uno, la app sólo borra el
--     objeto si ningún otro requisito de la licitación lo usa.
--   * RPC marcar_requisito_revisado(p_id, p_revisado) y guardar_archivos_base_requisito(p_id, p_archivos): nivel >= 80,
--     empresa de la sesión; las rutas deben ser de esa licitación.
--   * La vista public.licitacion_requisitos se recrea con la lista de columnas leída de la BD + las tres nuevas al final.
-- Aditiva: no cambia columnas, políticas ni RPC existentes.

ALTER TABLE control_obra.licitacion_requisitos
  ADD COLUMN IF NOT EXISTS revisado_at   timestamptz NULL,
  ADD COLUMN IF NOT EXISTS revisado_por  uuid NULL,
  ADD COLUMN IF NOT EXISTS archivos_base jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  ALTER TABLE control_obra.licitacion_requisitos
    ADD CONSTRAINT licitacion_requisitos_archivos_base_ck CHECK (jsonb_typeof(archivos_base) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE VIEW public.licitacion_requisitos WITH (security_invoker = true) AS
  SELECT id, empresa_id, licitacion_id, anexo_id, sobre, descripcion, origen, estado, requiere_firma, categoria_expediente,
         empresa_documento_id, archivo_path, responsable, orden, notas, created_at, updated_at,
         revisado_at, revisado_por, archivos_base
    FROM control_obra.licitacion_requisitos;

CREATE OR REPLACE FUNCTION public.marcar_requisito_revisado(p_id integer, p_revisado boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE v_emp integer := control_obra.licit_sesion_n80(); v_row control_obra.licitacion_requisitos%ROWTYPE;
BEGIN
  UPDATE control_obra.licitacion_requisitos
     SET revisado_at = CASE WHEN p_revisado THEN now() END,
         revisado_por = CASE WHEN p_revisado THEN control_obra.get_session_user_id() END
   WHERE id = p_id AND empresa_id = v_emp
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'El requisito no existe.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('success', true, 'id', v_row.id, 'revisado_at', v_row.revisado_at, 'revisado_por', v_row.revisado_por);
END; $$;

CREATE OR REPLACE FUNCTION public.guardar_archivos_base_requisito(p_id integer, p_archivos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  v_lic integer; x jsonb; v_out jsonb := '[]'::jsonb; v_tipo text;
BEGIN
  SELECT licitacion_id INTO v_lic FROM control_obra.licitacion_requisitos WHERE id = p_id AND empresa_id = v_emp;
  IF v_lic IS NULL THEN RAISE EXCEPTION 'El requisito no existe.' USING ERRCODE = '42501'; END IF;
  IF p_archivos IS NULL OR jsonb_typeof(p_archivos) <> 'array' THEN
    RAISE EXCEPTION 'La lista de archivos debe ser un arreglo.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_archivos) > 30 THEN RAISE EXCEPTION 'Máximo 30 archivos base por requisito.' USING ERRCODE = '22023'; END IF;
  FOR x IN SELECT e FROM jsonb_array_elements(p_archivos) e LOOP
    IF COALESCE(x->>'path', '') NOT LIKE 'empresa/' || v_emp || '/licitaciones/' || v_lic || '/%' THEN
      RAISE EXCEPTION 'La ruta del archivo no corresponde a esta licitación.' USING ERRCODE = '42501';
    END IF;
    v_tipo := COALESCE(NULLIF(x->>'tipo', ''), 'otro');
    IF v_tipo NOT IN ('word', 'excel', 'pdf', 'otro') THEN v_tipo := 'otro'; END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'path', x->>'path', 'nombre', COALESCE(NULLIF(btrim(x->>'nombre'), ''), regexp_replace(x->>'path', '^.*/\d+_', '')),
      'tipo', v_tipo, 'tamano', NULLIF(x->>'tamano', '')::bigint, 'hash', NULLIF(x->>'hash', '')));
  END LOOP;
  UPDATE control_obra.licitacion_requisitos SET archivos_base = v_out WHERE id = p_id AND empresa_id = v_emp;
  RETURN jsonb_build_object('success', true, 'id', p_id, 'archivos_base', v_out);
END; $$;

REVOKE ALL ON FUNCTION public.marcar_requisito_revisado(integer, boolean), public.guardar_archivos_base_requisito(integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_requisito_revisado(integer, boolean), public.guardar_archivos_base_requisito(integer, jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
