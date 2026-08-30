-- 035: seguridad multi-tenant (US-205, US-206, US-207)
-- 1) Vistas restantes con security_invoker. 2) Políticas por empresa en tablas con USING (true).
-- 3) Guardas de sesión inyectadas en funciones SECURITY DEFINER que confiaban en ids del cliente.
-- 4) Sesión de plataforma por header x-platform-token para admin.html. 5) search_path fijo en triggers.

-- ---------- 4) Sesión de plataforma (admin.html manda el header x-platform-token) ----------
CREATE OR REPLACE FUNCTION public.get_platform_token() RETURNS text
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE t text;
BEGIN
  BEGIN t := (current_setting('request.headers', true)::json)->>'x-platform-token'; EXCEPTION WHEN OTHERS THEN t := NULL; END;
  RETURN NULLIF(t, '');
END; $$;
CREATE OR REPLACE FUNCTION public.has_platform_session() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_sessions s JOIN public.platform_admins a ON a.id = s.admin_id
                 WHERE s.token = public.get_platform_token() AND s.expires_at > now() AND a.activo = true);
$$;
CREATE OR REPLACE FUNCTION public.require_session() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','control_obra' AS $$
DECLARE u uuid;
BEGIN
  u := public.get_session_user_id();
  IF u IS NULL THEN RAISE EXCEPTION 'No autorizado: inicia sesión de nuevo' USING ERRCODE = '28000'; END IF;
  RETURN u;
END; $$;
CREATE OR REPLACE FUNCTION public.require_platform_session() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_platform_session() THEN RAISE EXCEPTION 'No autorizado: sesión de plataforma requerida' USING ERRCODE = '28000'; END IF;
END; $$;

-- ---------- 1) Vistas con security_invoker ----------
DROP VIEW IF EXISTS public.v_uso_modulos_30d;
DROP VIEW IF EXISTS public.ui_events;
CREATE VIEW public.ui_events WITH (security_invoker = true) AS
  SELECT id, empresa_id, user_id, evento, modulo, obra_id, viewport_w, meta, created_at FROM control_obra.ui_events;
GRANT SELECT, INSERT ON public.ui_events TO anon, authenticated, service_role;
CREATE VIEW public.v_uso_modulos_30d WITH (security_invoker = true) AS
  SELECT empresa_id, COALESCE(modulo, '(sin módulo)') AS modulo, count(DISTINCT user_id) AS usuarios, count(*) AS eventos,
         round(100.0 * count(*) FILTER (WHERE viewport_w < 768)::numeric / NULLIF(count(*), 0)::numeric, 1) AS pct_movil, max(created_at) AS ultimo_evento
  FROM control_obra.ui_events WHERE created_at >= now() - interval '30 days' GROUP BY empresa_id, COALESCE(modulo, '(sin módulo)');
GRANT SELECT ON public.v_uso_modulos_30d TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.cotizaciones;
CREATE VIEW public.cotizaciones WITH (security_invoker = true) AS
  SELECT id, empresa_id, obra_id, numero_cotizacion, cliente, contacto, email, telefono, fecha, vigencia_dias, tiempo_entrega, estatus, introduccion,
         condiciones_pago, notas, subtotal, porcentaje_iva, monto_iva, total, plan_trabajo, plan_pagos, firma_nombre, firma_cargo, tipo, ubicacion,
         m2_terreno, m2_construccion, descripcion_proyecto, alcance_propuesto, desglose_construccion, created_at, updated_at
  FROM control_obra.cotizaciones;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cotizaciones TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.catalogo_conceptos_cot;
CREATE VIEW public.catalogo_conceptos_cot WITH (security_invoker = true) AS
  SELECT id, empresa_id, tipo, categoria, clave, nombre, descripcion, unidad, precio_sugerido, created_at FROM control_obra.catalogo_conceptos_cot;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalogo_conceptos_cot TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.plantillas_cotizacion;
CREATE VIEW public.plantillas_cotizacion WITH (security_invoker = true) AS
  SELECT id, empresa_id, nombre, descripcion, introduccion_default, plan_trabajo_default, condiciones_pago_default, notas_default, tiempo_entrega_default,
         vigencia_dias_default, porcentaje_iva_default, plan_pagos_default, partidas_default, mostrar_logo, mostrar_firma, color_primario, activo,
         created_at, updated_at, tipo, alcance_default
  FROM control_obra.plantillas_cotizacion;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plantillas_cotizacion TO anon, authenticated, service_role;

-- ---------- 2) Políticas por empresa (sustituyen USING (true)) ----------
DO $do$
DECLARE r record;
BEGIN
  -- Quitar todas las políticas de las tablas que se reescriben
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
           WHERE (schemaname = 'control_obra' AND tablename IN ('cotizaciones','cotizacion_partidas','actividades_programa','lineas_base','actividades_linea_base',
                 'recursos_proyecto','asignaciones_recurso','calendario_proyecto','movimientos_fiscales','retenciones','gastos_admin_distribucion','obra_auditoria',
                 'dias_no_laborales','categorias_deduccion','obra_roles','ui_events'))
              OR (schemaname = 'public' AND tablename IN ('error_occurrences','platform_errors'))
              OR (schemaname = 'control_obra' AND tablename = 'pagos_proveedores' AND policyname = 'pagos_proveedores_insert')
              OR (schemaname = 'control_obra' AND tablename = 'pagos_recibidos' AND policyname = 'pagos_recibidos_insert')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $do$;

-- Por empresa_id directo
CREATE POLICY cot_sel ON control_obra.cotizaciones FOR SELECT USING (empresa_id = control_obra.get_session_empresa_id());
CREATE POLICY cot_ins ON control_obra.cotizaciones FOR INSERT WITH CHECK (empresa_id = control_obra.get_session_empresa_id());
CREATE POLICY cot_upd ON control_obra.cotizaciones FOR UPDATE USING (empresa_id = control_obra.get_session_empresa_id());
CREATE POLICY cot_del ON control_obra.cotizaciones FOR DELETE USING (empresa_id = control_obra.get_session_empresa_id());
CREATE POLICY uie_sel ON control_obra.ui_events FOR SELECT USING (empresa_id = control_obra.get_session_empresa_id());
CREATE POLICY uie_ins ON control_obra.ui_events FOR INSERT WITH CHECK (empresa_id = control_obra.get_session_empresa_id());

-- Hijas por cotización
CREATE POLICY cotp_all ON control_obra.cotizacion_partidas FOR ALL
  USING (EXISTS (SELECT 1 FROM control_obra.cotizaciones c WHERE c.id = cotizacion_id AND c.empresa_id = control_obra.get_session_empresa_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM control_obra.cotizaciones c WHERE c.id = cotizacion_id AND c.empresa_id = control_obra.get_session_empresa_id()));
-- Hijas por programa
CREATE POLICY actp_all ON control_obra.actividades_programa FOR ALL
  USING (EXISTS (SELECT 1 FROM control_obra.programas_obra p WHERE p.id = programa_id AND p.empresa_id = control_obra.get_session_empresa_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM control_obra.programas_obra p WHERE p.id = programa_id AND p.empresa_id = control_obra.get_session_empresa_id()));
CREATE POLICY lb_all ON control_obra.lineas_base FOR ALL
  USING (EXISTS (SELECT 1 FROM control_obra.programas_obra p WHERE p.id = programa_id AND p.empresa_id = control_obra.get_session_empresa_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM control_obra.programas_obra p WHERE p.id = programa_id AND p.empresa_id = control_obra.get_session_empresa_id()));
CREATE POLICY alb_all ON control_obra.actividades_linea_base FOR ALL
  USING (EXISTS (SELECT 1 FROM control_obra.lineas_base l JOIN control_obra.programas_obra p ON p.id = l.programa_id WHERE l.id = linea_base_id AND p.empresa_id = control_obra.get_session_empresa_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM control_obra.lineas_base l JOIN control_obra.programas_obra p ON p.id = l.programa_id WHERE l.id = linea_base_id AND p.empresa_id = control_obra.get_session_empresa_id()));
-- Hijas por obra
CREATE POLICY rp_all ON control_obra.recursos_proyecto FOR ALL
  USING (EXISTS (SELECT 1 FROM control_obra.obras o WHERE o.id = obra_id AND o.empresa_id = control_obra.get_session_empresa_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM control_obra.obras o WHERE o.id = obra_id AND o.empresa_id = control_obra.get_session_empresa_id()));
CREATE POLICY ar_all ON control_obra.asignaciones_recurso FOR ALL
  USING (EXISTS (SELECT 1 FROM control_obra.recursos_proyecto r JOIN control_obra.obras o ON o.id = r.obra_id WHERE r.id = recurso_id AND o.empresa_id = control_obra.get_session_empresa_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM control_obra.recursos_proyecto r JOIN control_obra.obras o ON o.id = r.obra_id WHERE r.id = recurso_id AND o.empresa_id = control_obra.get_session_empresa_id()));
CREATE POLICY calp_all ON control_obra.calendario_proyecto FOR ALL
  USING (EXISTS (SELECT 1 FROM control_obra.obras o WHERE o.id = obra_id AND o.empresa_id = control_obra.get_session_empresa_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM control_obra.obras o WHERE o.id = obra_id AND o.empresa_id = control_obra.get_session_empresa_id()));
CREATE POLICY mf_all ON control_obra.movimientos_fiscales FOR ALL
  USING (EXISTS (SELECT 1 FROM control_obra.obras o WHERE o.id = obra_id AND o.empresa_id = control_obra.get_session_empresa_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM control_obra.obras o WHERE o.id = obra_id AND o.empresa_id = control_obra.get_session_empresa_id()));
CREATE POLICY ret_all ON control_obra.retenciones FOR ALL
  USING (EXISTS (SELECT 1 FROM control_obra.obras o WHERE o.id = obra_id AND o.empresa_id = control_obra.get_session_empresa_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM control_obra.obras o WHERE o.id = obra_id AND o.empresa_id = control_obra.get_session_empresa_id()));
-- Hijas por gasto
CREATE POLICY gad_all ON control_obra.gastos_admin_distribucion FOR ALL
  USING (EXISTS (SELECT 1 FROM control_obra.gastos g WHERE g.id = gasto_id AND g.empresa_id = control_obra.get_session_empresa_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM control_obra.gastos g WHERE g.id = gasto_id AND g.empresa_id = control_obra.get_session_empresa_id()));
-- Auditoría: se lee por empresa, se escribe sólo por trigger (definer)
CREATE POLICY oa_sel ON control_obra.obra_auditoria FOR SELECT
  USING (EXISTS (SELECT 1 FROM control_obra.obra_usuarios u WHERE u.id = usuario_id AND u.empresa_id = control_obra.get_session_empresa_id()));
-- Catálogos compartidos: lectura pública, escritura sólo con sesión de administrador
CREATE POLICY dnl_sel ON control_obra.dias_no_laborales FOR SELECT USING (true);
CREATE POLICY dnl_wr ON control_obra.dias_no_laborales FOR ALL USING (coalesce(control_obra.get_session_nivel(),0) >= 100) WITH CHECK (coalesce(control_obra.get_session_nivel(),0) >= 100);
CREATE POLICY cded_sel ON control_obra.categorias_deduccion FOR SELECT USING (true);
CREATE POLICY cded_wr ON control_obra.categorias_deduccion FOR ALL USING (coalesce(control_obra.get_session_nivel(),0) >= 100) WITH CHECK (coalesce(control_obra.get_session_nivel(),0) >= 100);
CREATE POLICY roles_sel ON control_obra.obra_roles FOR SELECT USING (true);
-- Errores de plataforma: el cliente inserta por RPC (definer); sólo la plataforma lee y actualiza
CREATE POLICY pe_sel ON public.platform_errors FOR SELECT USING (public.has_platform_session());
CREATE POLICY pe_upd ON public.platform_errors FOR UPDATE USING (public.has_platform_session());
CREATE POLICY eo_sel ON public.error_occurrences FOR SELECT USING (public.has_platform_session());
CREATE POLICY eo_upd ON public.error_occurrences FOR UPDATE USING (public.has_platform_session());

-- ---------- 3) Guardas en funciones SECURITY DEFINER ----------
DO $do$
DECLARE
  r record; def text; guard text; nuevo text;
  g_user text := $g$ IF p_user_id IS DISTINCT FROM public.get_session_user_id() THEN RAISE EXCEPTION 'No autorizado: el usuario no coincide con la sesión' USING ERRCODE = '28000'; END IF; $g$;
  g_emp  text := $g$ IF NOT public.has_platform_session() AND p_empresa_id IS DISTINCT FROM public.get_session_empresa_id() THEN RAISE EXCEPTION 'No autorizado: la empresa no coincide con la sesión' USING ERRCODE = '28000'; END IF; $g$;
  g_emp_admin text := $g$ IF NOT public.has_platform_session() AND (p_empresa_id IS DISTINCT FROM public.get_session_empresa_id() OR coalesce(public.get_session_nivel(),0) < 100) THEN RAISE EXCEPTION 'No autorizado: sólo el administrador de la empresa' USING ERRCODE = '28000'; END IF; $g$;
  g_plat text := $g$ PERFORM public.require_platform_session(); $g$;
  g_ses  text := $g$ PERFORM public.require_session(); $g$;
BEGIN
  FOR r IN
    SELECT p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args,
      CASE
        WHEN p.proname IN ('crear_gasto','crear_obra','crear_orden_compra','cambiar_password_usuario','get_user_access_level','set_user_context') AND pg_get_function_identity_arguments(p.oid) LIKE 'p_user_id uuid%' THEN 'user'
        WHEN p.proname = 'user_has_obra_access' AND pg_get_function_identity_arguments(p.oid) LIKE 'p_user_id uuid, p_obra_id integer' THEN 'user'
        WHEN p.proname IN ('get_empresa_config','check_plan_limit') THEN 'emp'
        WHEN p.proname IN ('save_empresa_modulos_config','apply_template_to_empresa') THEN 'emp_admin'
        WHEN p.proname IN ('get_platform_stats','get_platform_analytics','hash_password') THEN 'plat'
        WHEN p.proname IN ('get_next_orden_codigo','get_next_cuenta_cobrar_numero','get_next_pago_proveedor_numero','get_next_pago_recibido_numero') THEN 'ses'
      END tipo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname IN ('public','control_obra') AND p.prosecdef AND l.lanname = 'plpgsql'
  LOOP
    CONTINUE WHEN r.tipo IS NULL;
    def := pg_get_functiondef(r.oid);
    IF def ~ 'GUARDA_SESION_035' THEN CONTINUE; END IF;
    guard := CASE r.tipo WHEN 'user' THEN g_user WHEN 'emp' THEN g_emp WHEN 'emp_admin' THEN g_emp_admin WHEN 'plat' THEN g_plat ELSE g_ses END;
    -- Inyectar tras el primer BEGIN del cuerpo (después de AS $function$ ... DECLARE ...)
    nuevo := regexp_replace(def, '(AS \$function\$.*?)\mBEGIN\M', E'\\1BEGIN\n  -- GUARDA_SESION_035\n ' || guard || E'\n', '');
    IF nuevo = def THEN RAISE NOTICE 'sin BEGIN: %.%', r.nspname, r.proname; CONTINUE; END IF;
    EXECUTE nuevo;
    RAISE NOTICE 'guarda % en %.%(%)', r.tipo, r.nspname, r.proname, r.args;
  END LOOP;
END $do$;

-- Funciones que no debe ejecutar el cliente (mantenimiento, triggers, leftovers)
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname IN ('public','control_obra') AND p.proname IN ('limpiar_login_attempts','limpiar_sesiones_expiradas','update_repse_estatus_vencida','update_sua_estatus_vencido',
                 'trg_pago_recibido_delete','trg_pago_recibido_upsert','log_audit','admin_toggle_user_admin','update_user_role','recalcular_cuenta_cobrar')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated', r.nspname, r.proname, r.args);
  END LOOP;
END $do$;

-- ---------- 5) search_path fijo en triggers de fase 2 ----------
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE p.proname IN ('trg_gasto_socio_sync','trg_gastos_estatus','trg_pagos_proveedores_recalc','trg_socios_pct')
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = control_obra, public', r.nspname, r.proname, r.args);
  END LOOP;
END $do$;

-- Eliminación definitiva: también los logos guardados en la raíz del bucket como empresa_<id>_*
CREATE OR REPLACE FUNCTION public.eliminar_empresa_logos(p_empresa_id integer) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  DELETE FROM storage.objects WHERE bucket_id = 'logos' AND (name LIKE 'empresa_' || p_empresa_id || '_%' OR name LIKE 'empresa/' || p_empresa_id || '/%');
$$;
REVOKE EXECUTE ON FUNCTION public.eliminar_empresa_logos(integer) FROM PUBLIC, anon, authenticated;
