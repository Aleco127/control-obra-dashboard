-- 077 · Panel de plataforma (admin.html) por funciones (18-nov-2026)
-- admin.html leía y escribía empresas y usuarios directo en las tablas con la llave pública; tras el blindaje (071) esas
-- llamadas ya no pasan, y volver a abrir las tablas no es opción (el hash de contraseña no debe salir nunca).
-- Estas funciones validan la sesión de plataforma (x-platform-token) y hacen el trabajo con privilegios del servidor.

CREATE OR REPLACE FUNCTION public.platform_datos() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = control_obra, public AS $$
BEGIN
  PERFORM public.require_platform_session();
  RETURN jsonb_build_object(
    'empresas', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC) FROM control_obra.empresas e), '[]'::jsonb),
    'usuarios', COALESCE((SELECT jsonb_agg((to_jsonb(u) - 'password_hash') || jsonb_build_object('obra_roles', jsonb_build_object('nombre', r.nombre)) ORDER BY u.created_at DESC)
                            FROM control_obra.obra_usuarios u LEFT JOIN control_obra.obra_roles r ON r.id = u.rol_id), '[]'::jsonb),
    'empresa_configs', COALESCE((SELECT jsonb_agg(to_jsonb(c) || jsonb_build_object('empresa_modulos',
                            COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM control_obra.empresa_modulos m WHERE m.empresa_id = c.empresa_id), '[]'::jsonb)))
                            FROM control_obra.empresa_config c), '[]'::jsonb));
END; $$;

-- Alta (p_id NULL) o edición de una empresa. Sólo toca las llaves presentes en p_datos.
CREATE OR REPLACE FUNCTION public.platform_empresa_guardar(p_id integer, p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = control_obra, public AS $$
DECLARE v_e control_obra.empresas; d jsonb := COALESCE(p_datos, '{}'::jsonb);
BEGIN
  PERFORM public.require_platform_session();
  IF d ? 'nombre' AND btrim(COALESCE(d->>'nombre', '')) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio'); END IF;
  IF p_id IS NULL THEN
    IF NOT d ? 'nombre' THEN RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio'); END IF;
    INSERT INTO control_obra.empresas (nombre, rfc, direccion, telefono, email, activo)
    VALUES (btrim(d->>'nombre'), NULLIF(d->>'rfc', ''), NULLIF(d->>'direccion', ''), NULLIF(d->>'telefono', ''), NULLIF(d->>'email', ''), COALESCE((d->>'activo')::boolean, true))
    RETURNING * INTO v_e;
  ELSE
    UPDATE control_obra.empresas e SET
      nombre    = CASE WHEN d ? 'nombre'    THEN btrim(d->>'nombre')        ELSE e.nombre END,
      rfc       = CASE WHEN d ? 'rfc'       THEN NULLIF(d->>'rfc', '')       ELSE e.rfc END,
      direccion = CASE WHEN d ? 'direccion' THEN NULLIF(d->>'direccion', '') ELSE e.direccion END,
      telefono  = CASE WHEN d ? 'telefono'  THEN NULLIF(d->>'telefono', '')  ELSE e.telefono END,
      email     = CASE WHEN d ? 'email'     THEN NULLIF(d->>'email', '')     ELSE e.email END,
      activo    = CASE WHEN d ? 'activo'    THEN (d->>'activo')::boolean     ELSE e.activo END,
      updated_at = now()
    WHERE e.id = p_id RETURNING * INTO v_e;
    IF v_e.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Empresa no encontrada'); END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'empresa', to_jsonb(v_e));
END; $$;

-- Edición de un usuario. La contraseña (llave «password») se cifra aquí; al cambiarla o desactivar la cuenta se cierran sus sesiones.
CREATE OR REPLACE FUNCTION public.platform_usuario_guardar(p_id uuid, p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = control_obra, public, extensions AS $$
DECLARE d jsonb := COALESCE(p_datos, '{}'::jsonb); v_pw text := NULLIF(d->>'password', ''); v_email text := lower(btrim(COALESCE(d->>'email', ''))); v_emp int;
BEGIN
  PERFORM public.require_platform_session();
  SELECT empresa_id INTO v_emp FROM control_obra.obra_usuarios WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Usuario no encontrado'); END IF;
  IF d ? 'email' THEN
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN jsonb_build_object('success', false, 'error', 'Correo no válido'); END IF;
    IF EXISTS (SELECT 1 FROM control_obra.obra_usuarios WHERE email = v_email AND id <> p_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Ya existe otro usuario con este correo'); END IF;
  END IF;
  IF v_pw IS NOT NULL AND (length(v_pw) < 8 OR v_pw !~ '[A-Z]' OR v_pw !~ '[a-z]' OR v_pw !~ '[0-9]') THEN
    RETURN jsonb_build_object('success', false, 'error', 'La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número');
  END IF;
  IF d ? 'empresa_id' AND NOT EXISTS (SELECT 1 FROM control_obra.empresas WHERE id = (d->>'empresa_id')::int) THEN RETURN jsonb_build_object('success', false, 'error', 'Empresa no encontrada'); END IF;
  IF d ? 'rol_id' AND NOT EXISTS (SELECT 1 FROM control_obra.obra_roles WHERE id = (d->>'rol_id')::int) THEN RETURN jsonb_build_object('success', false, 'error', 'Rol no encontrado'); END IF;
  UPDATE control_obra.obra_usuarios u SET
    empresa_id = CASE WHEN d ? 'empresa_id' THEN (d->>'empresa_id')::int     ELSE u.empresa_id END,
    nombre     = CASE WHEN d ? 'nombre'     THEN btrim(d->>'nombre')         ELSE u.nombre END,
    email      = CASE WHEN d ? 'email'      THEN v_email                     ELSE u.email END,
    rol_id     = CASE WHEN d ? 'rol_id'     THEN (d->>'rol_id')::int         ELSE u.rol_id END,
    telefono   = CASE WHEN d ? 'telefono'   THEN NULLIF(d->>'telefono', '')  ELSE u.telefono END,
    activo     = CASE WHEN d ? 'activo'     THEN (d->>'activo')::boolean     ELSE u.activo END,
    password_hash = CASE WHEN v_pw IS NOT NULL THEN crypt(v_pw, gen_salt('bf')) ELSE u.password_hash END,
    updated_at = now()
  WHERE u.id = p_id;
  IF v_pw IS NOT NULL OR (d ? 'activo' AND NOT (d->>'activo')::boolean) OR (d ? 'empresa_id' AND (d->>'empresa_id')::int IS DISTINCT FROM v_emp) THEN
    DELETE FROM control_obra.obra_sesiones WHERE usuario_id = p_id;
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;

CREATE OR REPLACE FUNCTION public.platform_usuario_eliminar(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = control_obra, public AS $$
BEGIN
  PERFORM public.require_platform_session();
  DELETE FROM control_obra.obra_sesiones WHERE usuario_id = p_id;
  DELETE FROM control_obra.obra_usuarios WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Usuario no encontrado'); END IF;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN foreign_key_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'El usuario tiene registros ligados; desactívalo en lugar de borrarlo');
END; $$;

REVOKE ALL ON FUNCTION public.platform_datos(), public.platform_empresa_guardar(integer, jsonb), public.platform_usuario_guardar(uuid, jsonb), public.platform_usuario_eliminar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_datos(), public.platform_empresa_guardar(integer, jsonb), public.platform_usuario_guardar(uuid, jsonb), public.platform_usuario_eliminar(uuid) TO anon, authenticated, service_role;

-- Plantillas de configuración: sólo la sesión de plataforma las crea o borra.
ALTER TABLE public.config_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ct_plat_ins ON public.config_templates;
CREATE POLICY ct_plat_ins ON public.config_templates FOR INSERT WITH CHECK (public.has_platform_session());
DROP POLICY IF EXISTS ct_plat_del ON public.config_templates;
CREATE POLICY ct_plat_del ON public.config_templates FOR DELETE USING (public.has_platform_session());

-- Privilegios que la API no necesita en las tablas de plataforma (TRUNCATE no pasa por la RLS).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_errors','error_occurrences','config_templates','subscription_plans','empresa_subscriptions','platform_sessions','platform_admins','login_attempts','email_log','subscription_payments'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM PUBLIC, anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
