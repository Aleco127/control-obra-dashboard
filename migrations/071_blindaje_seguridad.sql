-- 071 · Blindaje de seguridad (17-nov-2026)
-- Auditoría completa: docs/seguridad/auditoria-2026-11.md
-- (La 070 cerró las tablas control_obra._bak_* que estaban abiertas a anon.)

-- ───────────────────────── 1. Sesión: la empresa sale SIEMPRE del usuario ─────────────────────────
-- Antes get_session_empresa_id() confiaba en obra_sesiones.empresa_id y la política obra_sesiones_update_own
-- dejaba al usuario reescribir su propia sesión: cambiar empresa_id = entrar a los datos de otra empresa.
CREATE OR REPLACE FUNCTION control_obra.get_session_user_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'control_obra', 'public' AS $$
DECLARE v_token text; v_user uuid;
BEGIN
  v_token := current_setting('request.headers', true)::json->>'x-obra-token';
  IF v_token IS NULL OR v_token = '' THEN RETURN NULL; END IF;
  SELECT u.id INTO v_user
  FROM control_obra.obra_sesiones s JOIN control_obra.obra_usuarios u ON u.id = s.usuario_id
  WHERE s.token = v_token AND s.activo = true AND (s.expires_at IS NULL OR s.expires_at > now()) AND u.activo = true
  LIMIT 1;
  RETURN v_user;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION control_obra.get_session_empresa_id() RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'control_obra', 'public' AS $$
DECLARE v_token text; v_emp integer;
BEGIN
  v_token := current_setting('request.headers', true)::json->>'x-obra-token';
  IF v_token IS NULL OR v_token = '' THEN RETURN NULL; END IF;
  SELECT u.empresa_id INTO v_emp
  FROM control_obra.obra_sesiones s JOIN control_obra.obra_usuarios u ON u.id = s.usuario_id
  WHERE s.token = v_token AND s.activo = true AND (s.expires_at IS NULL OR s.expires_at > now()) AND u.activo = true
  LIMIT 1;
  RETURN v_emp;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.get_session_user_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN RETURN control_obra.get_session_user_id(); END $$;

CREATE OR REPLACE FUNCTION public.get_session_empresa_id() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN RETURN control_obra.get_session_empresa_id(); END $$;

DROP POLICY IF EXISTS obra_sesiones_update_own ON control_obra.obra_sesiones;
REVOKE INSERT, UPDATE ON control_obra.obra_sesiones FROM anon, authenticated;
REVOKE INSERT, UPDATE ON public.obra_sesiones FROM anon, authenticated;

-- ───────────────────────── 2. Usuarios: sin hash a la vista y sin autoascenso ─────────────────────────
-- La vista ya no entrega password_hash (misma columna, valor nulo, para no romper select('*')).
ALTER FUNCTION public.cambiar_password_usuario(uuid, text, text) SET search_path TO 'control_obra', 'public', 'extensions';

CREATE OR REPLACE VIEW public.obra_usuarios WITH (security_invoker = true) AS
SELECT id, email, nombre, telefono, avatar_url, rol_id, activo, ultimo_acceso, created_at, updated_at,
       NULL::text AS password_hash, permisos_custom, empresa_id, es_admin_empresa, terminos_version,
       terminos_aceptados_at, email_verificado_at, nav_prefs
FROM control_obra.obra_usuarios;

REVOKE SELECT, INSERT, UPDATE ON control_obra.obra_usuarios FROM anon, authenticated;
GRANT SELECT (id, email, nombre, telefono, avatar_url, rol_id, activo, ultimo_acceso, created_at, updated_at,
              permisos_custom, empresa_id, es_admin_empresa, terminos_version, terminos_aceptados_at,
              email_verificado_at, nav_prefs),
      UPDATE (email, nombre, telefono, avatar_url, rol_id, activo, updated_at, permisos_custom)
  ON control_obra.obra_usuarios TO anon, authenticated;

-- Altas sólo por RPC (create_obra_user / registrar_usuario); editar y borrar usuarios exige administrador.
DROP POLICY IF EXISTS obra_usuarios_insert_own ON control_obra.obra_usuarios;
DROP POLICY IF EXISTS obra_usuarios_update_own ON control_obra.obra_usuarios;
DROP POLICY IF EXISTS obra_usuarios_delete_own ON control_obra.obra_usuarios;
CREATE POLICY obra_usuarios_update_admin ON control_obra.obra_usuarios FOR UPDATE
  USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 90)
  WITH CHECK (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 90);
CREATE POLICY obra_usuarios_delete_admin ON control_obra.obra_usuarios FOR DELETE
  USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 90
         AND id <> control_obra.get_session_user_id());

-- ───────────────────────── 3. Empresa: sólo dirección edita, y nunca plan ni límites ─────────────────────────
DROP POLICY IF EXISTS empresas_update_own ON control_obra.empresas;
CREATE POLICY empresas_update_admin ON control_obra.empresas FOR UPDATE
  USING (id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80)
  WITH CHECK (id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80);
REVOKE INSERT, UPDATE, DELETE ON control_obra.empresas FROM anon, authenticated;
GRANT UPDATE (nombre, razon_social, rfc, direccion, telefono, email, logo_url, sitio_web, updated_at, regimen_fiscal,
              codigo_postal, ciudad, estado, representante_legal, giro, descripcion, facebook, instagram, linkedin,
              registro_patronal, datos_pago, logo_iso_url)
  ON control_obra.empresas TO anon, authenticated;

-- La suscripción y los módulos no se escriben desde el cliente (lo hacen RPC, el webhook de pagos y la plataforma).
DROP POLICY IF EXISTS empresa_subscriptions_by_empresa ON public.empresa_subscriptions;
REVOKE INSERT, UPDATE, DELETE ON public.empresa_subscriptions FROM anon, authenticated;
DROP POLICY IF EXISTS empresa_modulos_by_empresa ON public.empresa_modulos;

-- ───────────────────────── 4. Políticas heredadas que dependían de variables de conexión ─────────────────────────
-- set_user_context dejaba app.current_empresa_id pegado a la conexión del pool y estas políticas lo leían.
DROP POLICY IF EXISTS obra_mod_select ON control_obra.obra_modificaciones;
DROP POLICY IF EXISTS obra_mod_insert ON control_obra.obra_modificaciones;
DROP POLICY IF EXISTS obra_mod_update ON control_obra.obra_modificaciones;
DROP POLICY IF EXISTS obra_mod_delete ON control_obra.obra_modificaciones;

DROP POLICY IF EXISTS asignaciones_select ON control_obra.obra_asignaciones;
DROP POLICY IF EXISTS asignaciones_insert ON control_obra.obra_asignaciones;
DROP POLICY IF EXISTS asignaciones_update ON control_obra.obra_asignaciones;
DROP POLICY IF EXISTS asignaciones_delete ON control_obra.obra_asignaciones;
CREATE POLICY asignaciones_select ON control_obra.obra_asignaciones FOR SELECT
  USING (EXISTS (SELECT 1 FROM control_obra.obras o WHERE o.id = obra_asignaciones.obra_id
                 AND o.empresa_id = control_obra.get_session_empresa_id()));
CREATE POLICY asignaciones_insert ON control_obra.obra_asignaciones FOR INSERT
  WITH CHECK (control_obra.get_session_nivel() >= 90
              AND EXISTS (SELECT 1 FROM control_obra.obras o WHERE o.id = obra_asignaciones.obra_id
                          AND o.empresa_id = control_obra.get_session_empresa_id())
              AND EXISTS (SELECT 1 FROM control_obra.obra_usuarios u WHERE u.id = obra_asignaciones.usuario_id
                          AND u.empresa_id = control_obra.get_session_empresa_id()));
CREATE POLICY asignaciones_delete ON control_obra.obra_asignaciones FOR DELETE
  USING (control_obra.get_session_nivel() >= 90
         AND EXISTS (SELECT 1 FROM control_obra.obras o WHERE o.id = obra_asignaciones.obra_id
                     AND o.empresa_id = control_obra.get_session_empresa_id()));

CREATE OR REPLACE FUNCTION public.set_user_context(p_user_id uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_empresa_id integer;
BEGIN
  IF p_user_id IS DISTINCT FROM public.get_session_user_id() THEN
    RAISE EXCEPTION 'No autorizado: el usuario no coincide con la sesión' USING ERRCODE = '28000';
  END IF;
  SELECT empresa_id INTO v_empresa_id FROM control_obra.obra_usuarios WHERE id = p_user_id AND activo = true;
  IF v_empresa_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Usuario no encontrado o inactivo');
  END IF;
  -- Sólo dentro de la transacción: nunca queda pegado a la conexión del pool.
  PERFORM set_config('app.current_user_id', p_user_id::text, true);
  PERFORM set_config('app.current_empresa_id', v_empresa_id::text, true);
  RETURN json_build_object('success', true, 'empresa_id', v_empresa_id);
END $$;

-- ───────────────────────── 5. Funciones internas o heredadas: fuera del alcance público ─────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'public' AND p.proname IN (
             'plan_efectivo', 'uso_empresa', 'get_current_empresa_id', 'get_current_user_id',
             'validate_session_get_user', 'user_has_empresa_access',
             'actualizar_gasto_seguro', 'eliminar_gasto_seguro', 'crear_gasto_seguro', 'crear_obra_seguro',
             'crear_usuario_seguro', 'get_dashboard_seguro', 'get_estimaciones_seguro', 'get_gastos_seguro',
             'get_obras_seguro', 'get_ordenes_compra_seguro', 'get_usuarios_empresa_seguro'))
       OR (n.nspname = 'control_obra' AND p.proname IN ('generar_notificaciones_empresa'))
       OR (n.nspname IN ('public', 'control_obra') AND p.proname = 'set_user_context'
           AND pg_get_function_identity_arguments(p.oid) = 'p_token text')
       OR (n.nspname = 'public' AND p.proname = 'registrar_usuario' AND p.pronargs = 6)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- TRUNCATE se salta RLS: ningún rol público debe tenerlo (tampoco TRIGGER ni REFERENCES).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'control_obra' AND c.relkind IN ('r', 'p') LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON control_obra.%I FROM anon, authenticated', r.relname);
  END LOOP;
END $$;

-- ───────────────────────── 6. Límite de intentos ─────────────────────────
CREATE OR REPLACE FUNCTION control_obra.cliente_ip() RETURNS text
LANGUAGE plpgsql STABLE SET search_path TO '' AS $$
DECLARE h json; v text;
BEGIN
  BEGIN h := current_setting('request.headers', true)::json; EXCEPTION WHEN OTHERS THEN RETURN '?'; END;
  v := coalesce(nullif(h->>'cf-connecting-ip', ''), nullif(h->>'x-real-ip', ''),
                nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''));
  RETURN left(coalesce(v, '?'), 64);
END $$;

-- Panel de plataforma: antes aceptaba intentos ilimitados.
CREATE OR REPLACE FUNCTION public.platform_admin_login(p_email text, p_password text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE
  v_admin platform_admins%ROWTYPE;
  v_token text;
  v_key text := 'platform:' || lower(btrim(coalesce(p_email, '')));
  v_ip text := control_obra.cliente_ip();
  v_fallos integer;
BEGIN
  SELECT count(*) INTO v_fallos FROM public.login_attempts
   WHERE success = false AND attempted_at > now() - interval '15 minutes'
     AND (email = v_key OR (email LIKE 'platform:%' AND ip_address = v_ip AND v_ip <> '?'));
  IF v_fallos >= 5 THEN
    RETURN json_build_object('success', false, 'error', 'Demasiados intentos. Espera 15 minutos.');
  END IF;

  SELECT * INTO v_admin FROM platform_admins WHERE email = lower(btrim(p_email)) AND activo = true;
  IF NOT FOUND OR v_admin.password_hash IS NULL
     OR v_admin.password_hash <> extensions.crypt(coalesce(p_password, ''), v_admin.password_hash) THEN
    INSERT INTO public.login_attempts (email, ip_address, success) VALUES (v_key, v_ip, false);
    RETURN json_build_object('success', false, 'error', 'Credenciales invalidas');
  END IF;

  INSERT INTO public.login_attempts (email, ip_address, success) VALUES (v_key, v_ip, true);
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO platform_sessions (admin_id, token, expires_at) VALUES (v_admin.id, v_token, now() + interval '24 hours');
  UPDATE platform_admins SET ultimo_acceso = now() WHERE id = v_admin.id;
  RETURN json_build_object('success', true, 'token', v_token,
    'admin', json_build_object('id', v_admin.id, 'email', v_admin.email, 'nombre', v_admin.nombre, 'rol', v_admin.rol));
END $$;

-- Registro: tope de altas por IP y de intentos de código de invitación (8 caracteres, antes sin límite).
CREATE OR REPLACE FUNCTION public.registrar_usuario(p_nombre text, p_email text, p_password text, p_tipo_registro text,
  p_empresa_nombre text DEFAULT NULL::text, p_codigo_invitacion text DEFAULT NULL::text,
  p_acepta_terminos boolean DEFAULT false, p_terminos_version text DEFAULT '1.0'::text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public', 'extensions' AS $$
DECLARE v_empresa_id INTEGER; v_user_id UUID; v_codigo TEXT; v_rol_id INTEGER; v_lim jsonb;
        v_ip text := control_obra.cliente_ip(); v_n integer;
BEGIN
  IF p_acepta_terminos IS DISTINCT FROM true THEN RETURN json_build_object('success', false, 'error', 'Debes aceptar los términos y el aviso de privacidad'); END IF;
  IF p_email IS NULL OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(p_email) > 254 THEN RETURN json_build_object('success', false, 'error', 'Escribe un correo válido'); END IF;
  IF length(coalesce(p_password,'')) < 8 OR length(p_password) > 200 THEN RETURN json_build_object('success', false, 'error', 'La contraseña debe tener al menos 8 caracteres'); END IF;
  IF length(coalesce(btrim(p_nombre),'')) NOT BETWEEN 1 AND 120 THEN RETURN json_build_object('success', false, 'error', 'Escribe tu nombre'); END IF;

  SELECT count(*) INTO v_n FROM public.login_attempts
   WHERE email = 'registro:' || v_ip AND attempted_at > now() - interval '1 hour';
  IF v_n >= 10 THEN RETURN json_build_object('success', false, 'error', 'Demasiados intentos de registro. Inténtalo más tarde.'); END IF;
  INSERT INTO public.login_attempts (email, ip_address, success) VALUES ('registro:' || v_ip, v_ip, true);

  IF EXISTS (SELECT 1 FROM control_obra.obra_usuarios WHERE email = LOWER(p_email)) THEN RETURN json_build_object('success', false, 'error', 'El correo electrónico ya está registrado'); END IF;

  IF p_tipo_registro = 'nueva' THEN
    IF p_empresa_nombre IS NULL OR btrim(p_empresa_nombre) = '' OR length(p_empresa_nombre) > 160 THEN RETURN json_build_object('success', false, 'error', 'El nombre de la empresa es requerido'); END IF;
    v_codigo := UPPER(encode(gen_random_bytes(6), 'hex'));
    INSERT INTO control_obra.empresas (nombre, codigo_invitacion, plan, activo, max_usuarios, max_obras, created_at)
    VALUES (btrim(p_empresa_nombre), v_codigo, 'trial', true, 15, 999, NOW()) RETURNING id INTO v_empresa_id;
    INSERT INTO public.empresa_subscriptions (empresa_id, plan_id, estado, trial_ends_at, billing_email, payment_method)
    VALUES (v_empresa_id, (SELECT id FROM public.subscription_plans WHERE slug = 'constructora'), 'trial', NOW() + interval '30 days', LOWER(p_email), 'trial');
    SELECT id INTO v_rol_id FROM control_obra.obra_roles WHERE nombre = 'admin_general' LIMIT 1;
    IF v_rol_id IS NULL THEN SELECT id INTO v_rol_id FROM control_obra.obra_roles LIMIT 1; END IF;
    INSERT INTO control_obra.obra_usuarios (nombre, email, password_hash, rol_id, activo, empresa_id, es_admin_empresa, created_at, terminos_version, terminos_aceptados_at)
    VALUES (btrim(p_nombre), LOWER(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')), v_rol_id, true, v_empresa_id, true, NOW(), p_terminos_version, NOW())
    RETURNING id INTO v_user_id;
  ELSIF p_tipo_registro = 'unirse' THEN
    IF p_codigo_invitacion IS NULL OR p_codigo_invitacion = '' THEN RETURN json_build_object('success', false, 'error', 'El código de invitación es requerido'); END IF;
    SELECT count(*) INTO v_n FROM public.login_attempts
     WHERE email = 'invitacion:' || v_ip AND success = false AND attempted_at > now() - interval '15 minutes';
    IF v_n >= 5 THEN RETURN json_build_object('success', false, 'error', 'Demasiados intentos. Espera 15 minutos.'); END IF;
    SELECT id INTO v_empresa_id FROM control_obra.empresas WHERE codigo_invitacion = UPPER(btrim(p_codigo_invitacion)) AND activo = true;
    IF v_empresa_id IS NULL THEN
      INSERT INTO public.login_attempts (email, ip_address, success) VALUES ('invitacion:' || v_ip, v_ip, false);
      RETURN json_build_object('success', false, 'error', 'Código de invitación inválido');
    END IF;
    v_lim := public.check_plan_limit_interno(v_empresa_id, 'usuarios');
    IF NOT coalesce((v_lim->>'allowed')::boolean, true) THEN RETURN json_build_object('success', false, 'error', 'La empresa alcanzó el límite de usuarios de su plan (' || (v_lim->>'limit') || '). Pide al administrador que amplíe el plan.'); END IF;
    SELECT id INTO v_rol_id FROM control_obra.obra_roles WHERE nombre = 'trabajador' LIMIT 1;
    IF v_rol_id IS NULL THEN SELECT id INTO v_rol_id FROM control_obra.obra_roles ORDER BY nivel_acceso ASC LIMIT 1; END IF;
    INSERT INTO control_obra.obra_usuarios (nombre, email, password_hash, rol_id, activo, empresa_id, es_admin_empresa, created_at, terminos_version, terminos_aceptados_at)
    VALUES (btrim(p_nombre), LOWER(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')), v_rol_id, true, v_empresa_id, false, NOW(), p_terminos_version, NOW())
    RETURNING id INTO v_user_id;
  ELSE
    RETURN json_build_object('success', false, 'error', 'Tipo de registro inválido');
  END IF;
  RETURN json_build_object('success', true, 'user_id', v_user_id, 'empresa_id', v_empresa_id, 'message', 'Usuario registrado exitosamente');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', 'No se pudo completar el registro. Inténtalo de nuevo.');
END $$;

-- ───────────────────────── 7. Bucket fotos: cada empresa sólo toca su carpeta ─────────────────────────
-- Antes cualquier sesión válida podía subir o borrar fotos de cualquier empresa y cualquiera podía listar el bucket.
DROP POLICY IF EXISTS "Obra fotos lectura" ON storage.objects;
DROP POLICY IF EXISTS "Obra fotos subida con sesion" ON storage.objects;
DROP POLICY IF EXISTS "Obra fotos borrado con sesion" ON storage.objects;
CREATE POLICY "Obra fotos lectura" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'fotos' AND (storage.foldername(name))[1] = (control_obra.get_session_empresa_id())::text);
CREATE POLICY "Obra fotos subida con sesion" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'fotos' AND (storage.foldername(name))[1] = (control_obra.get_session_empresa_id())::text);
CREATE POLICY "Obra fotos borrado con sesion" ON storage.objects FOR DELETE TO anon, authenticated
  USING (bucket_id = 'fotos' AND (storage.foldername(name))[1] = (control_obra.get_session_empresa_id())::text);
