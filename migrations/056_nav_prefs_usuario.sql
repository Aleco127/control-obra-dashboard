-- 056 · Preferencias de navegación por usuario (PRD barra de módulos, US-601) · 3-sep-2026
-- Los módulos fijados («Mi trabajo»), los grupos colapsados y el estado de la barra siguen al usuario
-- del escritorio al celular: viven en control_obra.obra_usuarios.nav_prefs (jsonb) en vez de localStorage.
--   nav_prefs = { fijados: ['g','o',...] (máx. 6 claves de módulo),
--                 colapsados: { obra: true, dinero: false, ... } (grupo -> bool),
--                 barra_colapsada: bool }
-- El cliente manda SIEMPRE el objeto completo (no parches) para evitar carreras entre pestañas.

-- ---------- 1) Columna ----------
ALTER TABLE control_obra.obra_usuarios ADD COLUMN IF NOT EXISTS nav_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'obra_usuarios_nav_prefs_objeto') THEN
    ALTER TABLE control_obra.obra_usuarios ADD CONSTRAINT obra_usuarios_nav_prefs_objeto CHECK (jsonb_typeof(nav_prefs) = 'object');
  END IF;
END $$;

-- ---------- 2) Vista public.obra_usuarios (lista explícita de columnas + nav_prefs) ----------
DROP VIEW IF EXISTS public.obra_usuarios;
CREATE VIEW public.obra_usuarios WITH (security_invoker = true) AS
  SELECT id, email, nombre, telefono, avatar_url, rol_id, activo, ultimo_acceso, created_at, updated_at,
         password_hash, permisos_custom, empresa_id, es_admin_empresa, terminos_version, terminos_aceptados_at,
         email_verificado_at, nav_prefs
  FROM control_obra.obra_usuarios;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obra_usuarios TO anon, authenticated, service_role;

-- ---------- 3) RPC guardar_nav_prefs(p_prefs jsonb) ----------
-- Valida la sesión con el header x-obra-token (get_session_user_id), acepta sólo las llaves
-- fijados / colapsados / barra_colapsada, sanea el contenido y REEMPLAZA nav_prefs del usuario.
-- No pasa por require_escritura: es una preferencia de la persona, no un dato de negocio, y debe
-- poder guardarse aunque la empresa esté en modo lectura.
CREATE OR REPLACE FUNCTION public.guardar_nav_prefs(p_prefs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'control_obra'
AS $function$
DECLARE
  v_uid uuid;
  v_key text;
  v_val jsonb;
  v_clave text;
  v_fijados jsonb := '[]'::jsonb;
  v_colapsados jsonb := '{}'::jsonb;
  v_limpio jsonb := '{}'::jsonb;
BEGIN
  -- GUARDA_SESION_035
  v_uid := public.get_session_user_id();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado: sesión inválida o expirada' USING ERRCODE = '28000';
  END IF;
  IF p_prefs IS NULL OR jsonb_typeof(p_prefs) <> 'object' THEN
    RAISE EXCEPTION 'Preferencias inválidas: se esperaba un objeto' USING ERRCODE = '22023';
  END IF;

  -- Sólo se admiten tres llaves; cualquier otra se rechaza completa (no se guarda nada)
  FOR v_key IN SELECT jsonb_object_keys(p_prefs) LOOP
    IF v_key NOT IN ('fijados', 'colapsados', 'barra_colapsada') THEN
      RAISE EXCEPTION 'Preferencia no admitida: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- fijados: array de hasta 6 claves de módulo (texto corto en minúsculas), sin repetidos, en el orden recibido
  IF p_prefs ? 'fijados' THEN
    IF jsonb_typeof(p_prefs->'fijados') <> 'array' THEN
      RAISE EXCEPTION 'fijados debe ser una lista de claves de módulo' USING ERRCODE = '22023';
    END IF;
    FOR v_val IN SELECT value FROM jsonb_array_elements(p_prefs->'fijados') LOOP
      v_clave := v_val #>> '{}';
      IF jsonb_typeof(v_val) <> 'string' OR v_clave !~ '^[a-z][a-z0-9_]{0,15}$' THEN
        RAISE EXCEPTION 'Clave de módulo inválida en fijados: %', COALESCE(left(v_clave, 40), 'null') USING ERRCODE = '22023';
      END IF;
      IF NOT (v_fijados ? v_clave) THEN
        v_fijados := v_fijados || to_jsonb(v_clave);
      END IF;
    END LOOP;
    IF jsonb_array_length(v_fijados) > 6 THEN
      RAISE EXCEPTION 'Puedes fijar hasta 6 módulos en Mi trabajo' USING ERRCODE = '22023';
    END IF;
    v_limpio := v_limpio || jsonb_build_object('fijados', v_fijados);
  END IF;

  -- colapsados: objeto { clave_de_grupo: bool }, hasta 32 entradas
  IF p_prefs ? 'colapsados' THEN
    IF jsonb_typeof(p_prefs->'colapsados') <> 'object' THEN
      RAISE EXCEPTION 'colapsados debe ser un objeto grupo -> verdadero/falso' USING ERRCODE = '22023';
    END IF;
    FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_prefs->'colapsados') LOOP
      IF v_key !~ '^[a-z][a-z0-9_]{0,31}$' OR jsonb_typeof(v_val) <> 'boolean' THEN
        RAISE EXCEPTION 'Entrada inválida en colapsados: %', left(v_key, 40) USING ERRCODE = '22023';
      END IF;
      v_colapsados := v_colapsados || jsonb_build_object(v_key, v_val);
    END LOOP;
    IF (SELECT count(*) FROM jsonb_object_keys(v_colapsados)) > 32 THEN
      RAISE EXCEPTION 'colapsados admite hasta 32 grupos' USING ERRCODE = '22023';
    END IF;
    v_limpio := v_limpio || jsonb_build_object('colapsados', v_colapsados);
  END IF;

  -- barra_colapsada: booleano
  IF p_prefs ? 'barra_colapsada' THEN
    IF jsonb_typeof(p_prefs->'barra_colapsada') <> 'boolean' THEN
      RAISE EXCEPTION 'barra_colapsada debe ser verdadero o falso' USING ERRCODE = '22023';
    END IF;
    v_limpio := v_limpio || jsonb_build_object('barra_colapsada', p_prefs->'barra_colapsada');
  END IF;

  UPDATE control_obra.obra_usuarios SET nav_prefs = v_limpio WHERE id = v_uid AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no válido' USING ERRCODE = '28000';
  END IF;
  RETURN jsonb_build_object('success', true, 'nav_prefs', v_limpio);
END;
$function$;
REVOKE ALL ON FUNCTION public.guardar_nav_prefs(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_nav_prefs(jsonb) TO anon, authenticated, service_role;

-- ---------- 4) load_all_data_seguro devuelve nav_prefs junto a nivel ----------
CREATE OR REPLACE FUNCTION public.load_all_data_seguro(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public', 'extensions'
AS $function$
DECLARE v_user RECORD; v_result JSONB := '{}'::jsonb;
BEGIN
    SELECT u.id, u.empresa_id, u.rol_id, u.nombre, COALESCE(r.nivel_acceso, 0) AS nivel, COALESCE(u.nav_prefs, '{}'::jsonb) AS nav_prefs
    INTO v_user
    FROM control_obra.obra_sesiones s
    JOIN control_obra.obra_usuarios u ON s.usuario_id = u.id
    LEFT JOIN control_obra.obra_roles r ON r.id = u.rol_id
    WHERE s.token = p_token AND s.expires_at > NOW() AND u.activo = true;
    IF v_user.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sesión inválida o expirada');
    END IF;
    v_result := jsonb_build_object(
        'success', true,
        'empresa_id', v_user.empresa_id,
        'user_id', v_user.id,
        'user_nombre', v_user.nombre,
        'nivel', v_user.nivel,
        'nav_prefs', v_user.nav_prefs,
        'obras', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.obras WHERE empresa_id = v_user.empresa_id ORDER BY created_at DESC) t), '[]'::jsonb),
        'empleados', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.empleados WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'gastos', COALESCE((SELECT jsonb_agg(
            to_jsonb(g) || CASE WHEN g.destino = 'socio' AND v_user.nivel < 100
                                THEN jsonb_build_object('descripcion', 'Retiro de socio', 'comentarios', NULL, 'proveedor_id', NULL, 'comprobante_url', NULL)
                                ELSE '{}'::jsonb END
            ORDER BY g.fecha_solicitud DESC)
            FROM control_obra.gastos g
            WHERE g.empresa_id = v_user.empresa_id
              AND (v_user.nivel < 100 OR NOT control_obra.gasto_personal_ajeno(g.destino, g.socio_tipo, g.socio_id, v_user.id))), '[]'::jsonb),
        'usuarios', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.obra_usuarios WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'roles', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.obra_roles ORDER BY nivel_acceso DESC) t), '[]'::jsonb),
        'ordenes_compra', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.ordenes_compra WHERE empresa_id = v_user.empresa_id ORDER BY created_at DESC) t), '[]'::jsonb),
        'proveedores', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.proveedores WHERE empresa_id = v_user.empresa_id ORDER BY nombre_proveedor) t), '[]'::jsonb),
        'estimaciones', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.estimaciones WHERE empresa_id = v_user.empresa_id ORDER BY numero_estimacion DESC) t), '[]'::jsonb),
        'clientes', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.clientes WHERE empresa_id = v_user.empresa_id ORDER BY nombre) t), '[]'::jsonb),
        'cotizaciones', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.cotizaciones WHERE empresa_id = v_user.empresa_id ORDER BY created_at DESC) t), '[]'::jsonb),
        'materiales', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.materiales WHERE empresa_id = v_user.empresa_id ORDER BY nombre) t), '[]'::jsonb),
        'subcontratos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.subcontratos WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'bitacora', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.bitacora_obra WHERE empresa_id = v_user.empresa_id ORDER BY fecha DESC) t), '[]'::jsonb),
        'nomina', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.nomina WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'eventos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.eventos_calendario WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'pagos_proveedores', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.pagos_proveedores WHERE empresa_id = v_user.empresa_id ORDER BY fecha_pago DESC) t), '[]'::jsonb),
        'pagos_recibidos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.pagos_recibidos WHERE empresa_id = v_user.empresa_id ORDER BY fecha_pago DESC) t), '[]'::jsonb),
        'programas_obra', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.programas_obra WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'catalogo_conceptos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.catalogo_conceptos WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'obra_modificaciones', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.obra_modificaciones WHERE empresa_id = v_user.empresa_id ORDER BY fecha DESC) t), '[]'::jsonb),
        'cuentas_por_cobrar', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.cuentas_por_cobrar WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'materiales_movimientos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.materiales_movimientos WHERE empresa_id = v_user.empresa_id ORDER BY fecha DESC) t), '[]'::jsonb),
        'subcontratos_pagos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.subcontratos_pagos WHERE empresa_id = v_user.empresa_id ORDER BY fecha_pago DESC) t), '[]'::jsonb),
        'asistencia', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.asistencia WHERE empresa_id = v_user.empresa_id ORDER BY fecha DESC) t), '[]'::jsonb),
        'plantillas_cotizacion', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.plantillas_cotizacion WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'categorias_gasto', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.categorias_gasto WHERE empresa_id = v_user.empresa_id OR empresa_id IS NULL ORDER BY orden, nombre) t), '[]'::jsonb),
        'socios', CASE WHEN v_user.nivel >= 100 THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.socios WHERE empresa_id = v_user.empresa_id ORDER BY nombre) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'movimientos_socio', CASE WHEN v_user.nivel >= 100 THEN COALESCE((SELECT jsonb_agg(
            to_jsonb(m) || CASE WHEN m.tipo = 'gasto_personal'
                                 AND EXISTS (SELECT 1 FROM control_obra.socios s WHERE s.id = m.socio_id AND s.usuario_id IS NOT NULL AND s.usuario_id IS DISTINCT FROM v_user.id)
                                THEN jsonb_build_object('concepto', 'Gasto personal', 'referencia', NULL)
                                ELSE '{}'::jsonb END
            ORDER BY m.fecha DESC)
            FROM control_obra.movimientos_socio m WHERE m.empresa_id = v_user.empresa_id), '[]'::jsonb) ELSE '[]'::jsonb END,
        'loaded_at', NOW()
    );
    RETURN v_result;
END;
$function$;

-- ---------- 5) Prueba desde SQL (correr a mano en el editor; NO se ejecuta con la migración) ----------
-- Sustituye <token> por un token vigente de control_obra.obra_sesiones (uno qa-... de QA, no el de una persona).
-- DO $$
-- DECLARE v_uid uuid; v_r jsonb; v_prev jsonb;
-- BEGIN
--   PERFORM set_config('request.headers', '{"x-obra-token":"<token>"}', true);
--   v_uid := public.get_session_user_id();
--   ASSERT v_uid IS NOT NULL, 'el token no abre sesión';
--   SELECT nav_prefs INTO v_prev FROM control_obra.obra_usuarios WHERE id = v_uid;
--   -- guarda y sanea (repetidos fuera, orden conservado)
--   v_r := public.guardar_nav_prefs('{"fijados":["g","o","g"],"colapsados":{"dinero":true},"barra_colapsada":false}');
--   ASSERT v_r->'nav_prefs'->'fijados' = '["g","o"]'::jsonb, 'fijados: ' || v_r::text;
--   ASSERT (SELECT nav_prefs->'colapsados'->>'dinero' FROM control_obra.obra_usuarios WHERE id = v_uid) = 'true', 'no persistió';
--   -- viaja en el payload de la carga inicial
--   ASSERT (public.load_all_data_seguro('<token>')->'nav_prefs'->'fijados') = '["g","o"]'::jsonb, 'load_all_data_seguro sin nav_prefs';
--   -- rechazos: llave extra, más de 6, tipo incorrecto, clave rara
--   BEGIN PERFORM public.guardar_nav_prefs('{"tema":"oscuro"}'); RAISE EXCEPTION 'debió rechazar llave extra';
--   EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
--   BEGIN PERFORM public.guardar_nav_prefs('{"fijados":["a","b","c","d","e","f","g"]}'); RAISE EXCEPTION 'debió rechazar 7 fijados';
--   EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
--   BEGIN PERFORM public.guardar_nav_prefs('{"barra_colapsada":"sí"}'); RAISE EXCEPTION 'debió rechazar bool inválido';
--   EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
--   BEGIN PERFORM public.guardar_nav_prefs('{"fijados":["<script>"]}'); RAISE EXCEPTION 'debió rechazar clave rara';
--   EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
--   -- sin sesión
--   PERFORM set_config('request.headers', '{}', true);
--   BEGIN PERFORM public.guardar_nav_prefs('{"fijados":["g"]}'); RAISE EXCEPTION 'debió rechazar sin sesión';
--   EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;
--   -- deja al usuario como estaba
--   UPDATE control_obra.obra_usuarios SET nav_prefs = COALESCE(v_prev, '{}'::jsonb) WHERE id = v_uid;
--   RAISE NOTICE 'OK 056';
-- END $$;
