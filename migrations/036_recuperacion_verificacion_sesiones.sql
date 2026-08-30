-- 036: recuperación de contraseña, verificación de correo y sesiones (US-209, US-210)
-- Los tokens de correo se guardan hasheados; los flujos corren en la Edge Function "auth" con service_role.

ALTER TABLE control_obra.obra_usuarios ADD COLUMN IF NOT EXISTS email_verificado_at timestamptz;
-- Usuarios existentes al 29-ago-2026 se consideran verificados (llevan meses usando la app)
UPDATE control_obra.obra_usuarios SET email_verificado_at = COALESCE(email_verificado_at, created_at, now()) WHERE email_verificado_at IS NULL;

DROP VIEW IF EXISTS public.obra_usuarios;
CREATE VIEW public.obra_usuarios WITH (security_invoker = true) AS
  SELECT id, email, nombre, telefono, avatar_url, rol_id, activo, ultimo_acceso, created_at, updated_at,
         password_hash, permisos_custom, empresa_id, es_admin_empresa, terminos_version, terminos_aceptados_at, email_verificado_at
  FROM control_obra.obra_usuarios;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obra_usuarios TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS control_obra.tokens_correo (
  id bigserial PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES control_obra.obra_usuarios(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('reset','verificar')),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  usado_at timestamptz,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tokens_correo_hash_idx ON control_obra.tokens_correo (token_hash);
CREATE INDEX IF NOT EXISTS tokens_correo_usuario_idx ON control_obra.tokens_correo (usuario_id, tipo, created_at DESC);
ALTER TABLE control_obra.tokens_correo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON control_obra.tokens_correo FROM anon, authenticated;
GRANT ALL ON control_obra.tokens_correo TO service_role;

-- Sólo service_role (Edge Function auth): crear token, aplicar reset, marcar verificado
CREATE OR REPLACE FUNCTION public.auth_crear_token(p_email text, p_tipo text, p_horas integer, p_ip text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra','public','extensions'
AS $$
DECLARE v_u record; v_token text; v_recientes int;
BEGIN
  SELECT id, nombre, email, empresa_id, email_verificado_at INTO v_u FROM control_obra.obra_usuarios WHERE email = lower(btrim(p_email)) AND activo = true;
  IF v_u.id IS NULL THEN RETURN json_build_object('ok', false, 'motivo', 'no_existe'); END IF;
  SELECT count(*) INTO v_recientes FROM control_obra.tokens_correo WHERE usuario_id = v_u.id AND tipo = p_tipo AND created_at > now() - interval '1 hour';
  IF v_recientes >= 3 THEN RETURN json_build_object('ok', false, 'motivo', 'limite'); END IF;
  IF p_tipo = 'verificar' AND v_u.email_verificado_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'motivo', 'ya_verificado'); END IF;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO control_obra.tokens_correo (usuario_id, tipo, token_hash, expires_at, ip)
  VALUES (v_u.id, p_tipo, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + make_interval(hours => p_horas), p_ip);
  RETURN json_build_object('ok', true, 'token', v_token, 'nombre', v_u.nombre, 'email', v_u.email, 'empresa_id', v_u.empresa_id);
END; $$;
REVOKE EXECUTE ON FUNCTION public.auth_crear_token(text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_crear_token(text, text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.auth_consumir_token(p_token text, p_tipo text, p_password text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra','public','extensions'
AS $$
DECLARE v_t record;
BEGIN
  SELECT t.*, u.email, u.nombre INTO v_t FROM control_obra.tokens_correo t JOIN control_obra.obra_usuarios u ON u.id = t.usuario_id
  WHERE t.token_hash = encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex') AND t.tipo = p_tipo;
  IF v_t.id IS NULL THEN RETURN json_build_object('ok', false, 'motivo', 'invalido'); END IF;
  IF v_t.usado_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'motivo', 'usado'); END IF;
  IF v_t.expires_at < now() THEN RETURN json_build_object('ok', false, 'motivo', 'expirado'); END IF;
  IF p_tipo = 'reset' THEN
    IF length(coalesce(p_password,'')) < 8 THEN RETURN json_build_object('ok', false, 'motivo', 'password_corta'); END IF;
    UPDATE control_obra.obra_usuarios SET password_hash = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now(), email_verificado_at = coalesce(email_verificado_at, now()) WHERE id = v_t.usuario_id;
    UPDATE control_obra.obra_sesiones SET activo = false, expires_at = now() WHERE usuario_id = v_t.usuario_id;
  ELSE
    UPDATE control_obra.obra_usuarios SET email_verificado_at = coalesce(email_verificado_at, now()) WHERE id = v_t.usuario_id;
  END IF;
  UPDATE control_obra.tokens_correo SET usado_at = now() WHERE id = v_t.id;
  RETURN json_build_object('ok', true, 'email', v_t.email, 'nombre', v_t.nombre);
END; $$;
REVOKE EXECUTE ON FUNCTION public.auth_consumir_token(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_consumir_token(text, text, text) TO service_role;

-- Sesiones: 30 días con renovación deslizante; validar_sesion devuelve email_verificado_at
DROP FUNCTION IF EXISTS public.validar_sesion(text);
CREATE FUNCTION public.validar_sesion(p_token text)
RETURNS TABLE(user_id uuid, nombre text, rol_nombre text, nivel_acceso integer, permisos jsonb, empresa_id integer, empresa_nombre text,
              baja_programada_at timestamptz, es_admin_empresa boolean, email text, email_verificado_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public', 'extensions'
AS $function$
BEGIN
  -- Renovación deslizante: si quedan menos de 15 días, se extiende a 30
  UPDATE control_obra.obra_sesiones s SET expires_at = now() + interval '30 days'
  WHERE s.token = p_token AND s.activo = true AND s.expires_at > now() AND s.expires_at < now() + interval '15 days';
  RETURN QUERY
  SELECT u.id, u.nombre, r.nombre::TEXT, r.nivel_acceso, r.permisos, u.empresa_id, e.nombre, e.baja_programada_at, u.es_admin_empresa, u.email, u.email_verificado_at, u.created_at
  FROM control_obra.obra_sesiones s
  JOIN control_obra.obra_usuarios u ON s.usuario_id = u.id
  JOIN control_obra.obra_roles r ON u.rol_id = r.id
  LEFT JOIN control_obra.empresas e ON u.empresa_id = e.id
  WHERE s.token = p_token AND s.expires_at > now() AND s.activo = true AND u.activo = true;
END;
$function$;

-- verificar_login: sesiones de 30 días y bloqueo por correo o IP (5 fallos en 15 min)
CREATE OR REPLACE FUNCTION public.verificar_login(p_email text, p_password text, p_ip_address text, p_user_agent text)
RETURNS TABLE(user_id uuid, nombre text, rol_nombre text, nivel_acceso integer, permisos jsonb, session_token text, empresa_id integer, empresa_nombre text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public', 'extensions'
AS $function$
DECLARE v_user RECORD; v_token TEXT; v_attempts INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_attempts FROM public.login_attempts
  WHERE (email = LOWER(p_email) OR (p_ip_address IS NOT NULL AND ip_address = p_ip_address)) AND attempted_at > NOW() - INTERVAL '15 minutes' AND success = false;
  IF v_attempts >= 5 THEN
    RAISE EXCEPTION 'Demasiados intentos. Espera 15 minutos o usa "Olvidé mi contraseña".';
  END IF;
  SELECT u.id, u.nombre, u.password_hash, u.empresa_id, r.nombre::TEXT as rol_nombre, r.nivel_acceso, r.permisos, e.nombre as empresa_nombre
  INTO v_user FROM control_obra.obra_usuarios u JOIN control_obra.obra_roles r ON u.rol_id = r.id LEFT JOIN control_obra.empresas e ON u.empresa_id = e.id
  WHERE u.email = LOWER(p_email) AND u.activo = true;
  IF NOT FOUND OR v_user.password_hash IS NULL OR v_user.password_hash <> crypt(p_password, v_user.password_hash) THEN
    INSERT INTO public.login_attempts (email, ip_address, success) VALUES (LOWER(p_email), p_ip_address, false);
    RETURN;
  END IF;
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO control_obra.obra_sesiones (usuario_id, token, ip_address, user_agent, expires_at, empresa_id)
  VALUES (v_user.id, v_token, p_ip_address, p_user_agent, NOW() + INTERVAL '30 days', v_user.empresa_id);
  UPDATE control_obra.obra_usuarios SET ultimo_acceso = NOW() WHERE id = v_user.id;
  INSERT INTO public.login_attempts (email, ip_address, success) VALUES (LOWER(p_email), p_ip_address, true);
  RETURN QUERY SELECT v_user.id, v_user.nombre, v_user.rol_nombre, v_user.nivel_acceso, v_user.permisos, v_token, v_user.empresa_id, v_user.empresa_nombre;
END;
$function$;

-- Cerrar las demás sesiones del usuario (Configuración › Mi cuenta)
CREATE OR REPLACE FUNCTION public.cerrar_otras_sesiones()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra','public'
AS $$
DECLARE v_uid uuid; v_tok text; v_n int;
BEGIN
  v_uid := public.require_session(); v_tok := public.get_obra_token();
  UPDATE control_obra.obra_sesiones SET activo = false, expires_at = now() WHERE usuario_id = v_uid AND token <> v_tok AND activo = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN json_build_object('success', true, 'cerradas', v_n);
END; $$;

-- Cambiar contraseña también cierra las demás sesiones
CREATE OR REPLACE FUNCTION public.sesiones_tras_cambio_password(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'control_obra','public'
AS $$ UPDATE control_obra.obra_sesiones SET activo = false, expires_at = now() WHERE usuario_id = p_user_id AND token <> public.get_obra_token() AND activo = true; $$;
REVOKE EXECUTE ON FUNCTION public.sesiones_tras_cambio_password(uuid) FROM PUBLIC, anon, authenticated;
