-- 034: baja de empresa con 30 días de gracia (US-204), validar_sesion con estado de la empresa,
-- vistas empresas/obras con security_invoker (parte de US-205).

ALTER TABLE control_obra.empresas
  ADD COLUMN IF NOT EXISTS baja_solicitada_at timestamptz,
  ADD COLUMN IF NOT EXISTS baja_programada_at timestamptz,
  ADD COLUMN IF NOT EXISTS baja_solicitada_por uuid,
  ADD COLUMN IF NOT EXISTS baja_recordatorio_at timestamptz;

DROP VIEW IF EXISTS public.empresas;
CREATE VIEW public.empresas WITH (security_invoker = true) AS
  SELECT id, nombre, razon_social, rfc, direccion, telefono, email, logo_url, sitio_web, plan, activo, max_usuarios, max_obras,
         fecha_vencimiento, created_at, updated_at, codigo_invitacion, regimen_fiscal, codigo_postal, ciudad, estado,
         representante_legal, giro, descripcion, facebook, instagram, linkedin, registro_patronal,
         baja_solicitada_at, baja_programada_at
  FROM control_obra.empresas;
GRANT SELECT, UPDATE ON public.empresas TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.obras;
CREATE VIEW public.obras WITH (security_invoker = true) AS
  SELECT id, codigo_obra, nombre_obra, presupuesto_total, estatus, fecha_inicio, fecha_fin_estimada, responsable, ubicacion,
         descripcion, avance_porcentaje, created_at, updated_at, cliente, porcentaje_iva, es_zona_frontera, subtotal, monto_iva,
         empresa_id, cliente_id, tipo_proyecto
  FROM control_obra.obras;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obras TO anon, authenticated, service_role;

-- validar_sesion devuelve además el estado de baja (la app entra en modo lectura)
DROP FUNCTION IF EXISTS public.validar_sesion(text);
DROP FUNCTION IF EXISTS control_obra.validar_sesion(text);
CREATE FUNCTION public.validar_sesion(p_token text)
RETURNS TABLE(user_id uuid, nombre text, rol_nombre text, nivel_acceso integer, permisos jsonb, empresa_id integer, empresa_nombre text,
              baja_programada_at timestamptz, es_admin_empresa boolean, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT u.id, u.nombre, r.nombre::TEXT, r.nivel_acceso, r.permisos, u.empresa_id, e.nombre, e.baja_programada_at, u.es_admin_empresa, u.email
  FROM control_obra.obra_sesiones s
  JOIN control_obra.obra_usuarios u ON s.usuario_id = u.id
  JOIN control_obra.obra_roles r ON u.rol_id = r.id
  LEFT JOIN control_obra.empresas e ON u.empresa_id = e.id
  WHERE s.token = p_token AND s.expires_at > NOW() AND u.activo = true;
END;
$function$;

-- Solicitar la baja: sólo admin_general (nivel >= 100) y administrador de la empresa; confirmación con el nombre exacto
CREATE OR REPLACE FUNCTION public.solicitar_baja_empresa(p_confirmacion text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public'
AS $function$
DECLARE v_emp control_obra.empresas%ROWTYPE; v_uid uuid; v_nivel int;
BEGIN
  v_uid := control_obra.get_session_user_id(); v_nivel := control_obra.get_session_nivel();
  IF v_uid IS NULL THEN RETURN json_build_object('success', false, 'error', 'Sesión inválida'); END IF;
  SELECT * INTO v_emp FROM control_obra.empresas WHERE id = control_obra.get_session_empresa_id();
  IF v_emp.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'Empresa no encontrada'); END IF;
  IF v_nivel < 100 OR NOT EXISTS (SELECT 1 FROM control_obra.obra_usuarios WHERE id = v_uid AND es_admin_empresa) THEN
    RETURN json_build_object('success', false, 'error', 'Sólo el administrador de la empresa puede solicitar la baja');
  END IF;
  IF lower(btrim(coalesce(p_confirmacion,''))) <> lower(btrim(v_emp.nombre)) THEN
    RETURN json_build_object('success', false, 'error', 'Escribe el nombre de la empresa tal como aparece para confirmar');
  END IF;
  UPDATE control_obra.empresas SET baja_solicitada_at = now(), baja_programada_at = now() + interval '30 days', baja_solicitada_por = v_uid, baja_recordatorio_at = NULL
  WHERE id = v_emp.id;
  RETURN json_build_object('success', true, 'baja_programada_at', now() + interval '30 days');
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_baja_empresa()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public'
AS $function$
DECLARE v_uid uuid;
BEGIN
  v_uid := control_obra.get_session_user_id();
  IF v_uid IS NULL OR control_obra.get_session_nivel() < 100 THEN RETURN json_build_object('success', false, 'error', 'Sólo el administrador puede cancelar la baja'); END IF;
  UPDATE control_obra.empresas SET baja_solicitada_at = NULL, baja_programada_at = NULL, baja_solicitada_por = NULL, baja_recordatorio_at = NULL
  WHERE id = control_obra.get_session_empresa_id() AND baja_programada_at IS NOT NULL;
  RETURN json_build_object('success', true);
END;
$function$;

-- Eliminación definitiva (sólo service_role, la corre la Edge Function jobs cuando vence la fecha)
CREATE OR REPLACE FUNCTION public.eliminar_empresa_definitivo(p_empresa_id integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public'
AS $function$
DECLARE v_t record; v_pasadas int := 0; v_pend int; v_borradas jsonb := '{}'::jsonb; v_n bigint; v_emp control_obra.empresas%ROWTYPE;
BEGIN
  SELECT * INTO v_emp FROM control_obra.empresas WHERE id = p_empresa_id;
  IF v_emp.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'No existe'); END IF;
  IF v_emp.baja_programada_at IS NULL OR v_emp.baja_programada_at > now() THEN
    RETURN json_build_object('success', false, 'error', 'La baja no está vencida');
  END IF;
  -- Archivos del Storage
  DELETE FROM storage.objects WHERE bucket_id IN ('comprobantes','fotos','logos') AND name LIKE 'empresa/' || p_empresa_id || '/%';
  -- Tablas hijas sin empresa_id que cuelgan de obras / socios / cotizaciones / gastos
  DELETE FROM control_obra.actividades_programa WHERE programa_id IN (SELECT id FROM control_obra.programas_obra WHERE empresa_id = p_empresa_id);
  DELETE FROM control_obra.reparto_detalle WHERE reparto_id IN (SELECT id FROM control_obra.repartos WHERE empresa_id = p_empresa_id);
  DELETE FROM control_obra.socios_historial WHERE socio_id IN (SELECT id FROM control_obra.socios WHERE empresa_id = p_empresa_id);
  DELETE FROM control_obra.cotizacion_partidas WHERE cotizacion_id IN (SELECT id FROM control_obra.cotizaciones WHERE empresa_id = p_empresa_id);
  DELETE FROM control_obra.gastos_admin_distribucion WHERE gasto_id IN (SELECT id FROM control_obra.gastos WHERE empresa_id = p_empresa_id);
  DELETE FROM control_obra.obra_asignaciones WHERE obra_id IN (SELECT id FROM control_obra.obras WHERE empresa_id = p_empresa_id);
  DELETE FROM control_obra.obra_auditoria WHERE obra_id IN (SELECT id FROM control_obra.obras WHERE empresa_id = p_empresa_id);
  -- Tablas con empresa_id: varias pasadas para respetar llaves foráneas
  LOOP
    v_pasadas := v_pasadas + 1; v_pend := 0;
    FOR v_t IN SELECT c.table_name FROM information_schema.columns c
               JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
               WHERE c.table_schema = 'control_obra' AND c.column_name = 'empresa_id' AND c.table_name NOT IN ('empresas') AND c.table_name NOT LIKE '\_bak%'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM control_obra.%I WHERE empresa_id = $1', v_t.table_name) USING p_empresa_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN v_borradas := v_borradas || jsonb_build_object(v_t.table_name, coalesce((v_borradas->>v_t.table_name)::bigint,0) + v_n); END IF;
      EXCEPTION WHEN foreign_key_violation THEN v_pend := v_pend + 1;
      END;
    END LOOP;
    EXIT WHEN v_pend = 0 OR v_pasadas >= 6;
  END LOOP;
  DELETE FROM public.email_log WHERE empresa_id = p_empresa_id;
  DELETE FROM public.empresa_subscriptions WHERE empresa_id = p_empresa_id;
  DELETE FROM control_obra.empresas WHERE id = p_empresa_id;
  RETURN json_build_object('success', true, 'empresa', v_emp.nombre, 'tablas', v_borradas, 'pasadas', v_pasadas, 'pendientes', v_pend);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.eliminar_empresa_definitivo(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_empresa_definitivo(integer) TO service_role;

-- Bajas pendientes de recordatorio/ejecución (sólo service_role)
CREATE OR REPLACE FUNCTION public.bajas_pendientes()
RETURNS TABLE(empresa_id integer, nombre text, baja_programada_at timestamptz, baja_recordatorio_at timestamptz, admin_email text, admin_nombre text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'control_obra', 'public'
AS $$
  SELECT e.id, e.nombre, e.baja_programada_at, e.baja_recordatorio_at,
         (SELECT u.email FROM control_obra.obra_usuarios u WHERE u.empresa_id = e.id AND u.es_admin_empresa ORDER BY u.created_at LIMIT 1),
         (SELECT u.nombre FROM control_obra.obra_usuarios u WHERE u.empresa_id = e.id AND u.es_admin_empresa ORDER BY u.created_at LIMIT 1)
  FROM control_obra.empresas e WHERE e.baja_programada_at IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.bajas_pendientes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bajas_pendientes() TO service_role;
CREATE OR REPLACE FUNCTION public.marcar_baja_recordatorio(p_empresa_id integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'control_obra', 'public'
AS $$ UPDATE control_obra.empresas SET baja_recordatorio_at = now() WHERE id = p_empresa_id; $$;
REVOKE EXECUTE ON FUNCTION public.marcar_baja_recordatorio(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_baja_recordatorio(integer) TO service_role;
