-- 094_requisitos_expediente.sql (US-818) — Ligar requisitos de licitación al expediente de la empresa (D8: apunta, no copia).
--
--   * llenar_desde_expediente(p_licitacion_id): liga en lote cada requisito con origen «expediente», con categoría y sin
--     documento, al mejor documento vigente de esa categoría: primero los que siguen vigentes en la fecha de
--     presentación, luego el más reciente (emisión y alta). Nunca toma una versión reemplazada. No toca los ya ligados.
--   * Renovar un documento (empresa_documentos.reemplaza_id = versión anterior) mueve a la versión nueva los requisitos
--     de licitaciones EN PREPARACIÓN que apuntaban a la anterior. Las ya presentadas conservan lo que se entregó.
--     Es un trigger nuevo de esta épica sobre la tabla de la épica B: no cambia sus columnas, vistas ni políticas.
--   * El bloqueo de «Listo» cuando el documento vence antes de la presentación vive en cambiar_estado_requisito (092).

CREATE OR REPLACE FUNCTION public.llenar_desde_expediente(p_licitacion_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  v_lic control_obra.licitaciones%ROWTYPE;
  v_pres date; v_n integer; v_sin jsonb;
BEGIN
  SELECT * INTO v_lic FROM control_obra.licitaciones WHERE id = p_licitacion_id AND empresa_id = v_emp;
  IF v_lic.id IS NULL THEN RAISE EXCEPTION 'La licitación no existe.' USING ERRCODE = '42501'; END IF;
  v_pres := COALESCE((v_lic.presentacion AT TIME ZONE 'America/Mexico_City')::date, (now() AT TIME ZONE 'America/Mexico_City')::date);

  WITH cand AS (
    SELECT r.id AS req_id,
           (SELECT d.id FROM control_obra.empresa_documentos d
             WHERE d.empresa_id = v_emp AND d.categoria = r.categoria_expediente
               AND NOT EXISTS (SELECT 1 FROM control_obra.empresa_documentos n WHERE n.reemplaza_id = d.id)
               AND (d.fecha_vencimiento IS NULL OR d.fecha_vencimiento >= (now() AT TIME ZONE 'America/Mexico_City')::date)
             ORDER BY (d.fecha_vencimiento IS NULL OR d.fecha_vencimiento >= v_pres) DESC,
                      d.fecha_emision DESC NULLS LAST, d.created_at DESC, d.id DESC
             LIMIT 1) AS doc_id
      FROM control_obra.licitacion_requisitos r
     WHERE r.licitacion_id = v_lic.id AND r.origen = 'expediente' AND r.categoria_expediente IS NOT NULL
       AND r.empresa_documento_id IS NULL
  )
  UPDATE control_obra.licitacion_requisitos r SET empresa_documento_id = c.doc_id
    FROM cand c WHERE r.id = c.req_id AND c.doc_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  SELECT COALESCE(jsonb_agg(DISTINCT r.categoria_expediente), '[]'::jsonb) INTO v_sin
    FROM control_obra.licitacion_requisitos r
   WHERE r.licitacion_id = v_lic.id AND r.origen = 'expediente' AND r.empresa_documento_id IS NULL;
  RETURN jsonb_build_object('success', true, 'ligados', v_n, 'sin_documento', v_sin);
END; $$;
REVOKE ALL ON FUNCTION public.llenar_desde_expediente(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.llenar_desde_expediente(integer) TO anon, authenticated;

-- Renovación: la versión nueva toma el lugar de la anterior en las licitaciones en preparación
CREATE OR REPLACE FUNCTION control_obra.trg_licit_req_sigue_renovacion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public' AS $$
BEGIN
  IF NEW.reemplaza_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.reemplaza_id IS DISTINCT FROM OLD.reemplaza_id) THEN
    UPDATE control_obra.licitacion_requisitos r SET empresa_documento_id = NEW.id
      FROM control_obra.licitaciones l
     WHERE r.empresa_documento_id = NEW.reemplaza_id AND r.empresa_id = NEW.empresa_id
       AND l.id = r.licitacion_id AND l.estatus = 'en_preparacion';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION control_obra.trg_licit_req_sigue_renovacion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_licit_req_sigue_renovacion ON control_obra.empresa_documentos;
CREATE TRIGGER trg_licit_req_sigue_renovacion AFTER INSERT OR UPDATE OF reemplaza_id ON control_obra.empresa_documentos
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_req_sigue_renovacion();
