-- 058_empresa_modulos_rpc.sql (US-614) — Personalización de la barra por empresa que sí se aplica.
--
-- Contexto: public.empresa_modulos es la TABLA base (al revés que el resto del proyecto, donde la tabla vive en
-- control_obra y public tiene la vista). Sus columnas reales son enabled / custom_name / custom_icon /
-- categoria_key / categoria_custom_name / orden; el cliente leía habilitado/label_custom y por eso las 31 filas
-- de la empresa 6 nunca se aplicaron.
--
-- Aquí: RPC guardar_empresa_modulos (nivel >= 100, valida las claves contra la lista fija de módulos y hace upsert
-- por (empresa_id, modulo_key)) y RLS por empresa de la sesión.

-- 1) Índice único para el upsert (si no existe ya)
CREATE UNIQUE INDEX IF NOT EXISTS empresa_modulos_empresa_key_uidx
  ON public.empresa_modulos (empresa_id, modulo_key);

-- 2) RPC de guardado
CREATE OR REPLACE FUNCTION public.guardar_empresa_modulos(p_modulos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'control_obra', 'public', 'extensions'
AS $function$
DECLARE
  v_user   uuid;
  v_nivel  integer;
  v_emp    integer;
  v_item   jsonb;
  v_key    text;
  v_n      integer := 0;
  -- Lista fija de módulos válidos (las 34 claves de NAV_GRUPOS; 'zz' y 'x' no son módulos reales)
  v_validas text[] := ARRAY['d','o','w','b','f','k','c','r','u','y','g','pc','p','ct','es','s','m',
                            'e','n','t','v','l','cb','fc','ce','ci','so','rt','dc','rp','su','q','z','h'];
BEGIN
  v_user := control_obra.get_session_user_id();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '28000';
  END IF;

  -- El nivel no vive en obra_usuarios (está en obra_roles.nivel_acceso vía rol_id): se usan los helpers de sesión
  v_nivel := control_obra.get_session_nivel();
  v_emp   := control_obra.get_session_empresa_id();

  IF COALESCE(v_nivel, 0) < 100 THEN
    RAISE EXCEPTION 'Sólo un administrador puede configurar la barra de módulos' USING ERRCODE = '42501';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'El usuario no tiene empresa' USING ERRCODE = '22023';
  END IF;
  IF p_modulos IS NULL OR jsonb_typeof(p_modulos) <> 'array' THEN
    RAISE EXCEPTION 'Se esperaba un arreglo de módulos' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_modulos)
  LOOP
    v_key := v_item->>'modulo_key';
    IF v_key IS NULL OR NOT (v_key = ANY (v_validas)) THEN
      RAISE EXCEPTION 'Módulo desconocido: %', COALESCE(v_key, '(nulo)') USING ERRCODE = '22023';
    END IF;
    -- custom_icon sólo admite un nombre de Remix Icon; custom_name se recorta a 40 caracteres
    IF v_item ? 'custom_icon' AND v_item->>'custom_icon' IS NOT NULL
       AND v_item->>'custom_icon' !~ '^ri-[a-z0-9-]+$' THEN
      RAISE EXCEPTION 'Ícono no válido para %: %', v_key, v_item->>'custom_icon' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.empresa_modulos (empresa_id, modulo_key, enabled, custom_name, custom_icon, orden, updated_at)
    VALUES (
      v_emp,
      v_key,
      COALESCE((v_item->>'enabled')::boolean, true),
      NULLIF(left(COALESCE(v_item->>'custom_name', ''), 40), ''),
      NULLIF(v_item->>'custom_icon', ''),
      NULLIF(v_item->>'orden', '')::integer,
      now()
    )
    ON CONFLICT (empresa_id, modulo_key) DO UPDATE
      SET enabled     = EXCLUDED.enabled,
          custom_name = EXCLUDED.custom_name,
          custom_icon = EXCLUDED.custom_icon,
          orden       = EXCLUDED.orden,
          updated_at  = now();
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'guardados', v_n, 'empresa_id', v_emp);
END;
$function$;

REVOKE ALL ON FUNCTION public.guardar_empresa_modulos(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_empresa_modulos(jsonb) TO anon, authenticated;

-- 3) RLS de la tabla: cada empresa sólo ve y toca lo suyo (la lectura de la app va por get_empresa_config,
--    que es SECURITY DEFINER y valida la sesión).
ALTER TABLE public.empresa_modulos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS empresa_modulos_select_own ON public.empresa_modulos;
CREATE POLICY empresa_modulos_select_own ON public.empresa_modulos
  FOR SELECT USING (empresa_id = control_obra.get_session_empresa_id());

DROP POLICY IF EXISTS empresa_modulos_write_admin ON public.empresa_modulos;
CREATE POLICY empresa_modulos_write_admin ON public.empresa_modulos
  FOR ALL
  USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 100)
  WITH CHECK (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 100);

COMMENT ON FUNCTION public.guardar_empresa_modulos(jsonb) IS
  'US-614: guarda la personalización de la barra de módulos de la empresa de la sesión (nivel >= 100).';
