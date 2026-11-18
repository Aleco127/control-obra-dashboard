-- 073 · Permisos por rol en el servidor (17-nov-2026)
-- Hasta aquí la RLS separaba por empresa pero no por rol: lo que la barra de módulos ocultaba a un trabajador
-- seguía siendo legible y editable por API. Esta migración lleva al servidor la misma tabla de visibilidad
-- de src/js/nav-rules.js (VISIBILIDAD + PERMISO_DE) y la aplica con políticas RESTRICTIVE, que se suman (AND)
-- a las políticas por empresa que ya existían. Para revertir basta borrar las políticas rol_*.

-- 1. Funciones de decisión ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION control_obra.usuario_ve(p_uid uuid, VARIADIC p_mods text[])
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = control_obra, public AS $$
DECLARE v_nivel int; v_rol text; v_perm jsonb; v_fila text; v_vis text[]; m text; pm text; dec boolean;
BEGIN
  IF p_uid IS NULL THEN RETURN false; END IF;
  SELECT r.nivel_acceso, r.nombre::text, COALESCE(r.permisos, '{}'::jsonb) INTO v_nivel, v_rol, v_perm
    FROM control_obra.obra_usuarios u JOIN control_obra.obra_roles r ON r.id = u.rol_id
   WHERE u.id = p_uid AND u.activo = true;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_nivel >= 100 THEN RETURN true; END IF;
  v_fila := CASE
    WHEN v_rol IN ('gerente_obra','supervisor_general','contador','residente_obra','contador_externo','inspector_calidad','trabajador') THEN v_rol
    WHEN v_nivel >= 80 THEN 'gerente_obra' WHEN v_nivel >= 70 THEN 'supervisor_general' WHEN v_nivel >= 50 THEN 'residente_obra'
    WHEN v_nivel >= 45 THEN 'contador_externo' WHEN v_nivel >= 40 THEN 'inspector_calidad' ELSE 'trabajador' END;
  v_vis := CASE v_fila
    WHEN 'gerente_obra'       THEN ARRAY['d','o','w','b','f','k','c','r','u','y','g','pc','p','ct','es','s','m','e','n','t','v','l','cb','fc','ce','rt','dc','rp','su','q']
    WHEN 'supervisor_general' THEN ARRAY['d','o','w','b','f','k','c','r','u','y','g','pc','p','es','e','v','q']
    WHEN 'contador'           THEN ARRAY['d','o','w','k','g','pc','p','ct','es','s','m','e','n','v','l','cb','fc','ce','ci','rt','dc','rp','su','q']
    WHEN 'residente_obra'     THEN ARRAY['d','o','w','b','f','k','c','r','u','y','g','m','s','e','t']
    WHEN 'contador_externo'   THEN ARRAY['d','g','pc','cb','fc','ce','ci','rt','dc','rp','su','q']
    WHEN 'inspector_calidad'  THEN ARRAY['d','o','w','b','f','k','r','u','y']
    ELSE ARRAY['b','f','t','o'] END;
  FOREACH m IN ARRAY p_mods LOOP
    pm := CASE m WHEN 'o' THEN 'obras' WHEN 'g' THEN 'gastos' WHEN 'e' THEN 'empleados' WHEN 'n' THEN 'nomina' WHEN 'p' THEN 'presupuesto'
                 WHEN 'q' THEN 'reportes' WHEN 'z' THEN 'configuracion' WHEN 'h' THEN 'usuarios' WHEN 'r' THEN 'calidad' WHEN 'u' THEN 'calidad'
                 WHEN 'y' THEN 'seguridad' WHEN 't' THEN 'tiempo' WHEN 'so' THEN 'socios' END;
    dec := NULL;
    IF pm IS NOT NULL THEN
      IF jsonb_typeof(v_perm -> pm) = 'boolean' THEN dec := (v_perm ->> pm)::boolean;
      ELSIF jsonb_typeof(v_perm -> pm -> 'ver') = 'boolean' THEN dec := (v_perm -> pm ->> 'ver')::boolean; END IF;
    END IF;
    IF dec IS NULL THEN dec := m = ANY (v_vis); END IF;
    IF dec THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION control_obra.sesion_ve(VARIADIC p_mods text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = control_obra, public AS $$
  SELECT control_obra.usuario_ve(control_obra.get_session_user_id(), VARIADIC p_mods);
$$;

-- Escribir = ver el módulo + nivel mínimo + no ser un rol de sólo lectura (contador_externo: permisos.lectura).
CREATE OR REPLACE FUNCTION control_obra.sesion_escribe(p_min int, VARIADIC p_mods text[])
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = control_obra, public AS $$
DECLARE v_uid uuid := control_obra.get_session_user_id(); v_nivel int; v_lectura boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  SELECT r.nivel_acceso, COALESCE((r.permisos ->> 'lectura')::boolean, false) INTO v_nivel, v_lectura
    FROM control_obra.obra_usuarios u JOIN control_obra.obra_roles r ON r.id = u.rol_id
   WHERE u.id = v_uid AND u.activo = true;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_nivel >= 100 THEN RETURN true; END IF;
  IF v_nivel < p_min OR v_lectura THEN RETURN false; END IF;
  RETURN control_obra.usuario_ve(v_uid, VARIADIC p_mods);
END; $$;

CREATE OR REPLACE FUNCTION control_obra.exigir_rol(p_min int, VARIADIC p_mods text[])
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = control_obra, public AS $$
BEGIN
  IF NOT control_obra.sesion_escribe(p_min, VARIADIC p_mods) THEN
    RAISE EXCEPTION 'Tu rol no tiene permiso para hacer esto' USING ERRCODE = '42501';
  END IF;
END; $$;

REVOKE ALL ON FUNCTION control_obra.usuario_ve(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION control_obra.exigir_rol(int, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION control_obra.sesion_ve(text[]), control_obra.sesion_escribe(int, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION control_obra.usuario_ve(uuid, text[]), control_obra.exigir_rol(int, text[]) TO service_role;

-- 2. Políticas restrictivas por tabla ----------------------------------------------------------------------
-- lee: módulos que dan lectura (NULL = cualquier sesión de la empresa). esc_min/esc: nivel y módulos para insertar y
-- actualizar. bor_min: nivel para borrar. Los niveles son los que ya usa la interfaz (canEdit, canCreate, isAdmin).
DO $$
DECLARE r record; v_lee text; v_esc text; v_bor text;
  q text := '';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('obras',                  NULL::text[],                         30, ARRAY['o','b','w','p'],        80),
    ('bitacora_obra',          ARRAY['b','o'],                       30, ARRAY['b'],                    50),
    ('fotos_obra',             ARRAY['f','b','o'],                   30, ARRAY['f','b'],                30),
    ('documentos',             ARRAY['k','o','rp','su','cb'],        30, ARRAY['k','rp','su'],          50),
    ('eventos_calendario',     NULL,                                 30, ARRAY['c'],                    30),
    ('rfis',                   ARRAY['r'],                           30, ARRAY['r'],                    50),
    ('punch_list',             ARRAY['u'],                           30, ARRAY['u'],                    50),
    ('seguridad',              ARRAY['y'],                           30, ARRAY['y'],                    50),
    ('asistencia',             ARRAY['t','n','e'],                   30, ARRAY['t','n'],                50),
    ('empleados',              ARRAY['e','n'],                       80, ARRAY['e'],                    80),
    ('nomina',                 ARRAY['n','cb'],                      70, ARRAY['n'],                    80),
    ('nomina_distribucion',    ARRAY['n','cb'],                      70, ARRAY['n'],                    70),
    ('gastos',                 ARRAY['g','pc','cb','ci'],            50, ARRAY['g','pc'],               60),
    ('gastos_admin_distribucion', ARRAY['g','pc','cb','ci'],         60, ARRAY['g','pc'],               60),
    ('ordenes_compra',         ARRAY['g','pc'],                      50, ARRAY['g'],                    80),
    ('proveedores',            ARRAY['g','pc','v','s','m'],          50, ARRAY['v','g','pc'],           80),
    ('pagos_proveedores',      ARRAY['g','pc','cb','ci'],            60, ARRAY['pc','g'],               80),
    ('pagos_recibidos',        ARRAY['pc','cb','ci','es'],           60, ARRAY['pc'],                   80),
    ('cuentas_por_cobrar',     ARRAY['pc','cb','ci','es'],           60, ARRAY['pc','es','o'],          80),
    ('conciliaciones',         ARRAY['pc','cb','ci'],                60, ARRAY['pc','cb'],              60),
    ('estimaciones',           ARRAY['es','pc','cb'],                60, ARRAY['es'],                   80),
    ('estimacion_partidas',    ARRAY['es','pc','cb'],                60, ARRAY['es'],                   60),
    ('clientes',               ARRAY['l','ct','pc','es','cb','ce'],  60, ARRAY['l','ct','pc','o'],      80),
    ('cotizaciones',           ARRAY['ct'],                          60, ARRAY['ct'],                   60),
    ('cotizacion_partidas',    ARRAY['ct'],                          60, ARRAY['ct'],                   60),
    ('plantillas_cotizacion',  ARRAY['ct'],                          60, ARRAY['ct'],                   60),
    ('catalogo_conceptos_cot', ARRAY['ct'],                          60, ARRAY['ct'],                   60),
    ('materiales',             ARRAY['m','g'],                       50, ARRAY['m'],                    60),
    ('materiales_movimientos', ARRAY['m','g'],                       50, ARRAY['m'],                    60),
    ('subcontratos',           ARRAY['s','pc'],                      50, ARRAY['s'],                    80),
    ('subcontratos_pagos',     ARRAY['s','pc'],                      50, ARRAY['s','pc'],               80),
    ('catalogo_conceptos',     NULL,                                 50, ARRAY['p','w','o','es'],       60),
    ('obra_modificaciones',    NULL,                                 60, ARRAY['p','o'],                80),
    ('programas_obra',         NULL,                                 50, ARRAY['w','o'],                80),
    ('actividades_programa',   NULL,                                 30, ARRAY['w','b'],                50),
    ('lineas_base',            NULL,                                 50, ARRAY['w'],                    50),
    ('actividades_linea_base', NULL,                                 50, ARRAY['w'],                    50),
    ('recursos_proyecto',      NULL,                                 50, ARRAY['w'],                    50),
    ('asignaciones_recurso',   NULL,                                 50, ARRAY['w'],                    50),
    ('calendario_proyecto',    NULL,                                 50, ARRAY['w'],                    50),
    ('dias_no_laborales',      NULL,                                 50, ARRAY['w'],                    50),
    ('facturas_recibidas',     ARRAY['fc','cb','g','pc','ci'],       60, ARRAY['fc','cb','g','pc'],     80),
    ('cfdis_emitidos',         ARRAY['ce','cb','pc','ci','es'],      60, ARRAY['ce','cb','pc'],         80),
    ('config_pac',             ARRAY['ce','fc','cb'],                100, ARRAY['z'],                   100),
    ('retenciones',            ARRAY['rt','cb','ci'],                60, ARRAY['rt','cb'],              60),
    ('declaraciones_mensuales',ARRAY['dc','cb','ci'],                60, ARRAY['dc','cb'],              60),
    ('movimientos_fiscales',   ARRAY['cb','ci'],                     60, ARRAY['cb'],                   60),
    ('categorias_gasto',       NULL,                                 80, ARRAY['g','z'],                80),
    ('empresa_config',         NULL,                                 80, ARRAY['d'],                    80)
  ) AS t(tabla, lee, esc_min, esc, bor_min) LOOP
    v_esc := format('(SELECT control_obra.sesion_escribe(%s, %s))', r.esc_min, (SELECT string_agg(quote_literal(x), ', ') FROM unnest(r.esc) x));
    v_bor := format('(SELECT control_obra.sesion_escribe(%s, %s))', r.bor_min, (SELECT string_agg(quote_literal(x), ', ') FROM unnest(r.esc) x));
    q := format('DROP POLICY IF EXISTS rol_lee ON control_obra.%1$I; DROP POLICY IF EXISTS rol_inserta ON control_obra.%1$I; DROP POLICY IF EXISTS rol_actualiza ON control_obra.%1$I; DROP POLICY IF EXISTS rol_borra ON control_obra.%1$I;', r.tabla);
    IF r.lee IS NOT NULL THEN
      v_lee := format('(SELECT control_obra.sesion_ve(%s))', (SELECT string_agg(quote_literal(x), ', ') FROM unnest(r.lee) x));
      q := q || format('CREATE POLICY rol_lee ON control_obra.%I AS RESTRICTIVE FOR SELECT USING (%s);', r.tabla, v_lee);
    END IF;
    q := q || format('CREATE POLICY rol_inserta ON control_obra.%I AS RESTRICTIVE FOR INSERT WITH CHECK (%s);', r.tabla, v_esc);
    q := q || format('CREATE POLICY rol_actualiza ON control_obra.%I AS RESTRICTIVE FOR UPDATE USING (%s) WITH CHECK (%s);', r.tabla, v_esc, v_esc);
    q := q || format('CREATE POLICY rol_borra ON control_obra.%I AS RESTRICTIVE FOR DELETE USING (%s);', r.tabla, v_bor);
    EXECUTE q;
  END LOOP;
END $$;

-- Bitácoras de auditoría, telemetría y enlaces del portal: sólo quien administra.
DROP POLICY IF EXISTS rol_lee ON control_obra.audit_log;
CREATE POLICY rol_lee ON control_obra.audit_log AS RESTRICTIVE FOR SELECT USING ((SELECT control_obra.get_session_nivel()) >= 80);
DROP POLICY IF EXISTS rol_lee ON control_obra.ui_events;
CREATE POLICY rol_lee ON control_obra.ui_events AS RESTRICTIVE FOR SELECT USING ((SELECT control_obra.get_session_nivel()) >= 80);
DROP POLICY IF EXISTS rol_lee ON control_obra.obra_auditoria;
CREATE POLICY rol_lee ON control_obra.obra_auditoria AS RESTRICTIVE FOR SELECT USING ((SELECT control_obra.get_session_nivel()) >= 60);
DROP POLICY IF EXISTS rol_lee ON control_obra.obra_portal_tokens;
CREATE POLICY rol_lee ON control_obra.obra_portal_tokens AS RESTRICTIVE FOR SELECT USING ((SELECT control_obra.get_session_nivel()) >= 60);

-- 3. Carga de datos: mismas reglas (las funciones son SECURITY DEFINER y no pasan por la RLS) --------------
CREATE OR REPLACE FUNCTION public.load_all_data_seguro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = control_obra, public AS $$
DECLARE v_user RECORD; u uuid; e int;
BEGIN
    SELECT us.id, us.empresa_id, us.rol_id, us.nombre, COALESCE(r.nivel_acceso, 0) AS nivel, COALESCE(us.nav_prefs, '{}'::jsonb) AS nav_prefs
    INTO v_user
    FROM control_obra.obra_sesiones s
    JOIN control_obra.obra_usuarios us ON s.usuario_id = us.id
    LEFT JOIN control_obra.obra_roles r ON r.id = us.rol_id
    WHERE s.token = p_token AND s.expires_at > NOW() AND COALESCE(s.activo, true) AND us.activo = true;
    IF v_user.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sesión inválida o expirada');
    END IF;
    u := v_user.id; e := v_user.empresa_id;
    RETURN jsonb_build_object(
        'success', true, 'empresa_id', e, 'user_id', u, 'user_nombre', v_user.nombre, 'nivel', v_user.nivel, 'nav_prefs', v_user.nav_prefs,
        'obras', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.obras WHERE empresa_id = e ORDER BY created_at DESC) t), '[]'::jsonb),
        'empleados', CASE
            WHEN control_obra.usuario_ve(u,'e','n') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.empleados WHERE empresa_id = e) t), '[]'::jsonb)
            WHEN control_obra.usuario_ve(u,'t') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT id, nombre_completo, puesto, estatus, obra_asignada, obra_id, empresa_id FROM control_obra.empleados WHERE empresa_id = e) t), '[]'::jsonb)
            ELSE '[]'::jsonb END,
        'gastos', CASE WHEN control_obra.usuario_ve(u,'g','pc','cb','ci') THEN COALESCE((SELECT jsonb_agg(
            to_jsonb(g) || CASE WHEN g.destino = 'socio' AND v_user.nivel < 100
                                THEN jsonb_build_object('descripcion', 'Retiro de socio', 'comentarios', NULL, 'proveedor_id', NULL, 'comprobante_url', NULL)
                                ELSE '{}'::jsonb END
            ORDER BY g.fecha_solicitud DESC)
            FROM control_obra.gastos g
            WHERE g.empresa_id = e
              AND (v_user.nivel < 100 OR NOT control_obra.gasto_personal_ajeno(g.destino, g.socio_tipo, g.socio_id, u))), '[]'::jsonb) ELSE '[]'::jsonb END,
        -- Nunca el hash de la contraseña; el detalle de cada cuenta sólo para quien administra usuarios.
        'usuarios', CASE WHEN v_user.nivel >= 100
            THEN COALESCE((SELECT jsonb_agg(to_jsonb(t) - 'password_hash') FROM control_obra.obra_usuarios t WHERE t.empresa_id = e), '[]'::jsonb)
            ELSE COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT id, nombre, email, rol_id, activo, empresa_id, avatar_url FROM control_obra.obra_usuarios WHERE empresa_id = e) t), '[]'::jsonb) END,
        'roles', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.obra_roles ORDER BY nivel_acceso DESC) t), '[]'::jsonb),
        'ordenes_compra', CASE WHEN control_obra.usuario_ve(u,'g','pc') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.ordenes_compra WHERE empresa_id = e ORDER BY created_at DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'proveedores', CASE WHEN control_obra.usuario_ve(u,'g','pc','v','s','m') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.proveedores WHERE empresa_id = e ORDER BY nombre_proveedor) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'estimaciones', CASE WHEN control_obra.usuario_ve(u,'es','pc','cb') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.estimaciones WHERE empresa_id = e ORDER BY numero_estimacion DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'clientes', CASE WHEN control_obra.usuario_ve(u,'l','ct','pc','es','cb','ce') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.clientes WHERE empresa_id = e ORDER BY nombre) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'cotizaciones', CASE WHEN control_obra.usuario_ve(u,'ct') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.cotizaciones WHERE empresa_id = e ORDER BY created_at DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'materiales', CASE WHEN control_obra.usuario_ve(u,'m','g') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.materiales WHERE empresa_id = e ORDER BY nombre) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'subcontratos', CASE WHEN control_obra.usuario_ve(u,'s','pc') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.subcontratos WHERE empresa_id = e) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'bitacora', CASE WHEN control_obra.usuario_ve(u,'b','o') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.bitacora_obra WHERE empresa_id = e ORDER BY fecha DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'nomina', CASE WHEN control_obra.usuario_ve(u,'n','cb') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.nomina WHERE empresa_id = e) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'eventos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.eventos_calendario WHERE empresa_id = e) t), '[]'::jsonb),
        'pagos_proveedores', CASE WHEN control_obra.usuario_ve(u,'g','pc','cb','ci') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.pagos_proveedores WHERE empresa_id = e ORDER BY fecha_pago DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'pagos_recibidos', CASE WHEN control_obra.usuario_ve(u,'pc','cb','ci','es') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.pagos_recibidos WHERE empresa_id = e ORDER BY fecha_pago DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'programas_obra', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.programas_obra WHERE empresa_id = e) t), '[]'::jsonb),
        'catalogo_conceptos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.catalogo_conceptos WHERE empresa_id = e) t), '[]'::jsonb),
        'obra_modificaciones', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.obra_modificaciones WHERE empresa_id = e ORDER BY fecha DESC) t), '[]'::jsonb),
        'cuentas_por_cobrar', CASE WHEN control_obra.usuario_ve(u,'pc','cb','ci','es') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.cuentas_por_cobrar WHERE empresa_id = e) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'materiales_movimientos', CASE WHEN control_obra.usuario_ve(u,'m','g') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.materiales_movimientos WHERE empresa_id = e ORDER BY fecha DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'subcontratos_pagos', CASE WHEN control_obra.usuario_ve(u,'s','pc') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.subcontratos_pagos WHERE empresa_id = e ORDER BY fecha_pago DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'asistencia', CASE WHEN control_obra.usuario_ve(u,'t','n','e') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.asistencia WHERE empresa_id = e ORDER BY fecha DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'plantillas_cotizacion', CASE WHEN control_obra.usuario_ve(u,'ct') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.plantillas_cotizacion WHERE empresa_id = e) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'categorias_gasto', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.categorias_gasto WHERE empresa_id = e OR empresa_id IS NULL ORDER BY orden, nombre) t), '[]'::jsonb),
        'socios', CASE WHEN v_user.nivel >= 100 THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.socios WHERE empresa_id = e ORDER BY nombre) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'movimientos_socio', CASE WHEN v_user.nivel >= 100 THEN COALESCE((SELECT jsonb_agg(
            to_jsonb(m) || CASE WHEN m.tipo = 'gasto_personal'
                                 AND EXISTS (SELECT 1 FROM control_obra.socios s WHERE s.id = m.socio_id AND s.usuario_id IS NOT NULL AND s.usuario_id IS DISTINCT FROM u)
                                THEN jsonb_build_object('concepto', 'Gasto personal', 'referencia', NULL)
                                ELSE '{}'::jsonb END
            ORDER BY m.fecha DESC)
            FROM control_obra.movimientos_socio m WHERE m.empresa_id = e), '[]'::jsonb) ELSE '[]'::jsonb END,
        'loaded_at', NOW()
    );
END; $$;

CREATE OR REPLACE FUNCTION public.load_secondary_data_seguro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = control_obra, public AS $$
DECLARE u uuid; e int;
BEGIN
    SELECT us.id, us.empresa_id INTO u, e
    FROM control_obra.obra_sesiones s
    JOIN control_obra.obra_usuarios us ON s.usuario_id = us.id
    WHERE s.token = p_token AND s.expires_at > NOW() AND COALESCE(s.activo, true) AND us.activo = true;
    IF u IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sesión inválida');
    END IF;
    RETURN jsonb_build_object(
        'success', true,
        'documentos', CASE WHEN control_obra.usuario_ve(u,'k','o','rp','su','cb') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.documentos WHERE empresa_id = e ORDER BY created_at DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'fotos', CASE WHEN control_obra.usuario_ve(u,'f','b','o') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.fotos_obra WHERE empresa_id = e ORDER BY fecha_foto DESC NULLS LAST, id DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'facturas_recibidas', CASE WHEN control_obra.usuario_ve(u,'fc','cb','g','pc','ci') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.facturas_recibidas WHERE empresa_id = e ORDER BY fecha_emision DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'cfdis', CASE WHEN control_obra.usuario_ve(u,'ce','cb','pc','ci','es') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.cfdis_emitidos WHERE empresa_id = e ORDER BY fecha_emision DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'config_pac', CASE WHEN control_obra.usuario_ve(u,'ce','fc','cb') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.config_pac WHERE empresa_id = e) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'rfis', CASE WHEN control_obra.usuario_ve(u,'r') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.rfis WHERE empresa_id = e ORDER BY fecha_emision DESC NULLS LAST) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'punch_list', CASE WHEN control_obra.usuario_ve(u,'u') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.punch_list WHERE empresa_id = e) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'seguridad', CASE WHEN control_obra.usuario_ve(u,'y') THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.seguridad WHERE empresa_id = e) t), '[]'::jsonb) ELSE '[]'::jsonb END
    );
END; $$;

-- Las copias viejas en el esquema control_obra (también expuesto por la API) quedan sólo para el servidor.
REVOKE EXECUTE ON FUNCTION control_obra.load_all_data_seguro(text), control_obra.load_secondary_data_seguro(text) FROM PUBLIC, anon, authenticated;

-- 4. Funciones que escriben saltándose la RLS: mismo candado -----------------------------------------------
DO $$
DECLARE r record; def text;
BEGIN
  FOR r IN SELECT p.oid, x.guarda FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           JOIN (VALUES ('crear_obra', $g$PERFORM control_obra.exigir_rol(60, 'o');$g$),
                        ('crear_orden_compra', $g$PERFORM control_obra.exigir_rol(50, 'g', 'pc');$g$),
                        ('crear_gasto', $g$PERFORM control_obra.exigir_rol(50, 'g', 'pc');$g$)) x(nombre, guarda) ON x.nombre = p.proname
           WHERE n.nspname = 'public' LOOP
    def := pg_get_functiondef(r.oid);
    IF position('exigir_rol' IN def) = 0 AND position('PERFORM public.require_escritura();' IN def) > 0 THEN
      EXECUTE replace(def, 'PERFORM public.require_escritura();', 'PERFORM public.require_escritura(); ' || r.guarda);
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'borrar_datos_ejemplo';
  IF def IS NOT NULL AND position('get_session_nivel' IN def) = 0 THEN
    EXECUTE replace(def, $a$IF v_emp IS NULL THEN RETURN json_build_object('success', false); END IF;$a$,
      $b$IF v_emp IS NULL OR control_obra.get_session_nivel() < 80 THEN RETURN json_build_object('success', false); END IF;$b$);
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'get_email_log';
  IF def IS NOT NULL AND position('get_session_nivel' IN def) = 0 THEN
    EXECUTE replace(def, 'WHERE l.empresa_id = control_obra.get_session_empresa_id()', 'WHERE l.empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80');
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'get_mis_pagos';
  IF def IS NOT NULL AND position('get_session_nivel' IN def) = 0 THEN
    EXECUTE replace(def, 'WHERE empresa_id = public.get_session_empresa_id()', 'WHERE empresa_id = public.get_session_empresa_id() AND public.get_session_nivel() >= 80');
  END IF;
END $$;
