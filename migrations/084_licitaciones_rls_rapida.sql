-- 084_licitaciones_rls_rapida.sql (US-803) — Rendimiento de las políticas de 080, 081 y 083 y de buscar_insumos.
--
-- Medido con 5,000 insumos: buscar_insumos tardaba ~230 ms (criterio: < 150 ms). La causa es que
-- get_session_empresa_id() y get_session_nivel() (plpgsql, leen obra_sesiones / obra_usuarios) se evaluaban POR
-- FILA dentro de la política. Envueltas en (SELECT ...) Postgres las evalúa una sola vez por consulta (InitPlan),
-- que es la recomendación del advisor de rendimiento (auth_rls_initplan).
--
-- Además buscar_insumos pasa a SECURITY DEFINER: valida nivel >= 80 y filtra por la empresa de la sesión de forma
-- explícita (sin depender de RLS), y no lee nada fuera de control_obra.insumos / insumo_precios de esa empresa.
-- Misma firma y misma salida que en 083.

-- 1) Políticas con InitPlan (mismas reglas que antes; sólo cambia la forma) -------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['licitaciones','licitacion_archivos','licitacion_requisitos',
                           'empresa_expediente','empresa_documentos','personal_tecnico','obras_ejecutadas','maquinaria',
                           'insumos','insumo_precios','conceptos_historicos','concepto_precios','matriz_componentes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON control_obra.%I', t || '_n80', t);
    EXECUTE format('CREATE POLICY %I ON control_obra.%I FOR ALL
      USING (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)
      WITH CHECK (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)',
      t || '_n80', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS licitacion_req_hist_sel ON control_obra.licitacion_requisito_historial;
CREATE POLICY licitacion_req_hist_sel ON control_obra.licitacion_requisito_historial FOR SELECT
  USING (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80);

DROP POLICY IF EXISTS perfiles_convocante_sel ON control_obra.perfiles_convocante;
CREATE POLICY perfiles_convocante_sel ON control_obra.perfiles_convocante FOR SELECT
  USING ((SELECT control_obra.get_session_nivel()) >= 80
         AND (empresa_id IS NULL OR empresa_id = (SELECT control_obra.get_session_empresa_id())));
DROP POLICY IF EXISTS perfiles_convocante_ins ON control_obra.perfiles_convocante;
CREATE POLICY perfiles_convocante_ins ON control_obra.perfiles_convocante FOR INSERT
  WITH CHECK ((SELECT control_obra.get_session_nivel()) >= 80 AND NOT es_fabrica
              AND empresa_id = (SELECT control_obra.get_session_empresa_id()));
DROP POLICY IF EXISTS perfiles_convocante_upd ON control_obra.perfiles_convocante;
CREATE POLICY perfiles_convocante_upd ON control_obra.perfiles_convocante FOR UPDATE
  USING ((SELECT control_obra.get_session_nivel()) >= 80 AND NOT es_fabrica AND empresa_id = (SELECT control_obra.get_session_empresa_id()))
  WITH CHECK ((SELECT control_obra.get_session_nivel()) >= 80 AND NOT es_fabrica AND empresa_id = (SELECT control_obra.get_session_empresa_id()));
DROP POLICY IF EXISTS perfiles_convocante_del ON control_obra.perfiles_convocante;
CREATE POLICY perfiles_convocante_del ON control_obra.perfiles_convocante FOR DELETE
  USING ((SELECT control_obra.get_session_nivel()) >= 80 AND NOT es_fabrica AND empresa_id = (SELECT control_obra.get_session_empresa_id()));

DROP POLICY IF EXISTS parametros_laborales_sel ON control_obra.parametros_laborales;
CREATE POLICY parametros_laborales_sel ON control_obra.parametros_laborales FOR SELECT
  USING ((SELECT control_obra.get_session_nivel()) >= 80
         AND (empresa_id IS NULL OR empresa_id = (SELECT control_obra.get_session_empresa_id())));
DROP POLICY IF EXISTS parametros_laborales_ins ON control_obra.parametros_laborales;
CREATE POLICY parametros_laborales_ins ON control_obra.parametros_laborales FOR INSERT
  WITH CHECK ((SELECT control_obra.get_session_nivel()) >= 80 AND NOT es_fabrica AND empresa_id = (SELECT control_obra.get_session_empresa_id()));
DROP POLICY IF EXISTS parametros_laborales_upd ON control_obra.parametros_laborales;
CREATE POLICY parametros_laborales_upd ON control_obra.parametros_laborales FOR UPDATE
  USING ((SELECT control_obra.get_session_nivel()) >= 80 AND NOT es_fabrica AND empresa_id = (SELECT control_obra.get_session_empresa_id()))
  WITH CHECK ((SELECT control_obra.get_session_nivel()) >= 80 AND NOT es_fabrica AND empresa_id = (SELECT control_obra.get_session_empresa_id()));
DROP POLICY IF EXISTS parametros_laborales_del ON control_obra.parametros_laborales;
CREATE POLICY parametros_laborales_del ON control_obra.parametros_laborales FOR DELETE
  USING ((SELECT control_obra.get_session_nivel()) >= 80 AND NOT es_fabrica AND empresa_id = (SELECT control_obra.get_session_empresa_id()));

-- 2) buscar_insumos como SECURITY DEFINER con validación explícita ------------------------------------------------------
ALTER FUNCTION public.buscar_insumos(text, text, text, integer) SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.buscar_insumos(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_insumos(text, text, text, integer) TO anon, authenticated;
