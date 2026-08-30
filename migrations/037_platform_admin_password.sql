-- 037: cambio de contraseña del admin de plataforma sólo con service_role.
-- La corre /docker/control-obra-dashboard/rotate-platform-admin.sh desde el VPS (genera la contraseña, la aplica por
-- PostgREST con la service key y la envía por correo con send-email). Nunca pasa por el chat ni por el repo.
CREATE OR REPLACE FUNCTION public.platform_admin_set_password(p_email text, p_password text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE v_n int;
BEGIN
  IF length(coalesce(p_password,'')) < 12 THEN RETURN json_build_object('success', false, 'error', 'mínimo 12 caracteres'); END IF;
  UPDATE public.platform_admins SET password_hash = extensions.crypt(p_password, extensions.gen_salt('bf')) WHERE lower(email) = lower(p_email);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.platform_sessions WHERE admin_id IN (SELECT id FROM public.platform_admins WHERE lower(email) = lower(p_email));
  RETURN json_build_object('success', v_n = 1, 'actualizados', v_n);
END; $$;
REVOKE EXECUTE ON FUNCTION public.platform_admin_set_password(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_set_password(text, text) TO service_role;
