-- 095_importar_requisitos.sql (US-819) — Importar requisitos de un archivo licitacion-bases/v1 sin pisar lo capturado.
--
-- La pantalla «Importar bases» de la ficha (y scripts/licitaciones/importar-bases.mjs, el camino de Claude Code con la
-- sesión del usuario) guarda los datos generales con guardar_licitacion (092) y los requisitos con esta función:
-- normaliza la lista con control_obra.licit_requisitos_json_norm (093), agrega sólo los anexos que faltan (comparación
-- sin mayúsculas, igual que generar_requisitos_perfil) y continúa el orden de cada sobre. Idempotente.

CREATE OR REPLACE FUNCTION public.importar_requisitos(p_licitacion_id integer, p_requisitos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  v_req jsonb; v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM control_obra.licitaciones WHERE id = p_licitacion_id AND empresa_id = v_emp) THEN
    RAISE EXCEPTION 'La licitación no existe.' USING ERRCODE = '42501';
  END IF;
  v_req := control_obra.licit_requisitos_json_norm(p_requisitos);
  WITH src AS (
    SELECT x, ord FROM jsonb_array_elements(v_req) WITH ORDINALITY AS t(x, ord)
     WHERE NOT EXISTS (SELECT 1 FROM control_obra.licitacion_requisitos r
                        WHERE r.licitacion_id = p_licitacion_id AND lower(r.anexo_id) = lower(t.x->>'anexo_id'))
  ), base AS (
    SELECT sobre, max(orden) AS m FROM control_obra.licitacion_requisitos WHERE licitacion_id = p_licitacion_id GROUP BY sobre
  )
  INSERT INTO control_obra.licitacion_requisitos (licitacion_id, anexo_id, sobre, descripcion, origen, requiere_firma, categoria_expediente, orden)
  SELECT p_licitacion_id, s.x->>'anexo_id', s.x->>'sobre', s.x->>'descripcion', s.x->>'origen', (s.x->>'requiere_firma')::boolean,
         NULLIF(s.x->>'categoria_expediente', ''),
         COALESCE(b.m, 0) + row_number() OVER (PARTITION BY s.x->>'sobre' ORDER BY s.ord)
    FROM src s LEFT JOIN base b ON b.sobre = s.x->>'sobre'
  ON CONFLICT (licitacion_id, anexo_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'insertados', v_n, 'recibidos', jsonb_array_length(v_req),
                            'ya_estaban', jsonb_array_length(v_req) - v_n);
END; $$;
REVOKE ALL ON FUNCTION public.importar_requisitos(integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.importar_requisitos(integer, jsonb) TO anon, authenticated;
