-- 087_modulos_licitaciones.sql (US-805) — La barra pasa de 34 a 37 claves (grupo «Licitaciones»: lc, ex, bp).
--
-- 1) guardar_empresa_modulos: la lista fija v_validas acepta lc, ex y bp. Se partió de la definición ACTUAL en la BD
--    (pg_get_functiondef, 4-oct-2026, la de 063: conserva «clave ausente = no tocar» y la validación de custom_icon);
--    lo único que cambia es la lista. scripts/qa/nav-shell.test.mjs compara esta lista con src/js/nav-grupos.js.
-- 2) Planes: feature `licitaciones` en Estudio y Constructora (true) y en Gratis (false). Suscripcion.FEATURE_MODULO
--    pone el candado de plan a lc/ex/bp cuando la feature es false (aviso «Disponible en Estudio y Constructora»).

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
  v_icono  text;
  v_n      integer := 0;
  -- Lista fija de módulos válidos (las 37 claves de NAV_GRUPOS; 'zz' y 'x' no son módulos reales).
  -- scripts/qa/nav-shell.test.mjs comprueba que coincide con src/js/nav-grupos.js.
  v_validas text[] := ARRAY['d','o','w','b','f','k','c','lc','ex','bp','r','u','y','g','pc','p','ct','es','s','m',
                            'e','n','t','v','l','cb','fc','ce','ci','so','rt','dc','rp','su','q','z','h'];
BEGIN
  v_user := control_obra.get_session_user_id();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '28000';
  END IF;

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
    -- custom_icon: vacío o nulo limpia el ícono; con valor, sólo se admite un nombre de Remix Icon
    v_icono := NULLIF(v_item->>'custom_icon', '');
    IF v_icono IS NOT NULL AND v_icono !~ '^ri-[a-z0-9-]+$' THEN
      RAISE EXCEPTION 'Ícono no válido para %: %', v_key, v_icono USING ERRCODE = '22023';
    END IF;

    -- Clave ausente en el JSON = «no tocar»: se conserva lo que ya tenía la fila (también enabled)
    INSERT INTO public.empresa_modulos (empresa_id, modulo_key, enabled, custom_name, custom_icon, orden, updated_at)
    VALUES (
      v_emp,
      v_key,
      COALESCE((v_item->>'enabled')::boolean, true),
      NULLIF(left(COALESCE(v_item->>'custom_name', ''), 40), ''),
      v_icono,
      NULLIF(v_item->>'orden', '')::integer,
      now()
    )
    ON CONFLICT (empresa_id, modulo_key) DO UPDATE
      SET enabled     = CASE WHEN v_item ? 'enabled'     THEN EXCLUDED.enabled     ELSE empresa_modulos.enabled     END,
          custom_name = CASE WHEN v_item ? 'custom_name' THEN EXCLUDED.custom_name ELSE empresa_modulos.custom_name END,
          custom_icon = CASE WHEN v_item ? 'custom_icon' THEN EXCLUDED.custom_icon ELSE empresa_modulos.custom_icon END,
          orden       = CASE WHEN v_item ? 'orden'       THEN EXCLUDED.orden       ELSE empresa_modulos.orden       END,
          updated_at  = now();
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'guardados', v_n, 'empresa_id', v_emp);
END;
$function$;

UPDATE public.subscription_plans
   SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('licitaciones', slug IN ('estudio', 'constructora'))
 WHERE slug IN ('gratis', 'estudio', 'constructora');
