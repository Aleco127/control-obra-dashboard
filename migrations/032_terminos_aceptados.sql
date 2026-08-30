-- 032: consentimiento de términos y aviso de privacidad al registrarse (US-203)
-- Guarda la versión aceptada y la fecha en obra_usuarios; registrar_usuario exige p_acepta_terminos.

ALTER TABLE control_obra.obra_usuarios
  ADD COLUMN IF NOT EXISTS terminos_version text,
  ADD COLUMN IF NOT EXISTS terminos_aceptados_at timestamptz;

-- Recrear la vista pública con las columnas nuevas (lista explícita)
DROP VIEW IF EXISTS public.obra_usuarios;
CREATE VIEW public.obra_usuarios WITH (security_invoker = true) AS
  SELECT id, email, nombre, telefono, avatar_url, rol_id, activo, ultimo_acceso, created_at, updated_at,
         password_hash, permisos_custom, empresa_id, es_admin_empresa, terminos_version, terminos_aceptados_at
  FROM control_obra.obra_usuarios;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obra_usuarios TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.registrar_usuario(
  p_nombre text, p_email text, p_password text, p_tipo_registro text,
  p_empresa_nombre text DEFAULT NULL, p_codigo_invitacion text DEFAULT NULL,
  p_acepta_terminos boolean DEFAULT false, p_terminos_version text DEFAULT '1.0')
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'control_obra', 'public', 'extensions'
AS $function$
DECLARE
  v_empresa_id INTEGER;
  v_user_id UUID;
  v_codigo TEXT;
  v_rol_id INTEGER;
BEGIN
  IF p_acepta_terminos IS DISTINCT FROM true THEN
    RETURN json_build_object('success', false, 'error', 'Debes aceptar los términos y el aviso de privacidad');
  END IF;
  IF p_email IS NULL OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN json_build_object('success', false, 'error', 'Escribe un correo válido');
  END IF;
  IF length(coalesce(p_password,'')) < 8 THEN
    RETURN json_build_object('success', false, 'error', 'La contraseña debe tener al menos 8 caracteres');
  END IF;
  IF EXISTS (SELECT 1 FROM control_obra.obra_usuarios WHERE email = LOWER(p_email)) THEN
    RETURN json_build_object('success', false, 'error', 'El correo electrónico ya está registrado');
  END IF;

  IF p_tipo_registro = 'nueva' THEN
    IF p_empresa_nombre IS NULL OR btrim(p_empresa_nombre) = '' THEN
      RETURN json_build_object('success', false, 'error', 'El nombre de la empresa es requerido');
    END IF;
    v_codigo := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
    INSERT INTO control_obra.empresas (nombre, codigo_invitacion, plan, activo, max_usuarios, max_obras, created_at)
    VALUES (btrim(p_empresa_nombre), v_codigo, 'basico', true, 5, 3, NOW())
    RETURNING id INTO v_empresa_id;

    SELECT id INTO v_rol_id FROM control_obra.obra_roles WHERE nombre = 'admin_general' LIMIT 1;
    IF v_rol_id IS NULL THEN SELECT id INTO v_rol_id FROM control_obra.obra_roles LIMIT 1; END IF;

    INSERT INTO control_obra.obra_usuarios (nombre, email, password_hash, rol_id, activo, empresa_id, es_admin_empresa, created_at, terminos_version, terminos_aceptados_at)
    VALUES (p_nombre, LOWER(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')), v_rol_id, true, v_empresa_id, true, NOW(), p_terminos_version, NOW())
    RETURNING id INTO v_user_id;

  ELSIF p_tipo_registro = 'unirse' THEN
    IF p_codigo_invitacion IS NULL OR p_codigo_invitacion = '' THEN
      RETURN json_build_object('success', false, 'error', 'El código de invitación es requerido');
    END IF;
    SELECT id INTO v_empresa_id FROM control_obra.empresas WHERE codigo_invitacion = UPPER(p_codigo_invitacion) AND activo = true;
    IF v_empresa_id IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Código de invitación inválido');
    END IF;
    IF (SELECT COUNT(*) FROM control_obra.obra_usuarios WHERE empresa_id = v_empresa_id) >=
       (SELECT COALESCE(max_usuarios, 999) FROM control_obra.empresas WHERE id = v_empresa_id) THEN
      RETURN json_build_object('success', false, 'error', 'La empresa ha alcanzado el límite de usuarios');
    END IF;
    SELECT id INTO v_rol_id FROM control_obra.obra_roles WHERE nombre = 'trabajador' LIMIT 1;
    IF v_rol_id IS NULL THEN SELECT id INTO v_rol_id FROM control_obra.obra_roles ORDER BY nivel_acceso ASC LIMIT 1; END IF;

    INSERT INTO control_obra.obra_usuarios (nombre, email, password_hash, rol_id, activo, empresa_id, es_admin_empresa, created_at, terminos_version, terminos_aceptados_at)
    VALUES (p_nombre, LOWER(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')), v_rol_id, true, v_empresa_id, false, NOW(), p_terminos_version, NOW())
    RETURNING id INTO v_user_id;
  ELSE
    RETURN json_build_object('success', false, 'error', 'Tipo de registro inválido');
  END IF;

  RETURN json_build_object('success', true, 'user_id', v_user_id, 'empresa_id', v_empresa_id, 'message', 'Usuario registrado exitosamente');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- Usuarios existentes: se les pedirá aceptar en su siguiente ingreso (terminos_version NULL)
