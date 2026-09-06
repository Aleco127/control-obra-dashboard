-- 062 · Correcciones de la revisión de la barra de módulos (ultrareview, 6-sep-2026)
-- 1) guardar_empresa_modulos ya no borra custom_icon (ni custom_name / orden) cuando el cliente no manda la clave:
--    Configuración › Barra de módulos sólo envía modulo_key, enabled, custom_name y orden, y el upsert ponía
--    custom_icon = EXCLUDED.custom_icon (nulo). Ahora una clave ausente conserva lo guardado; una clave presente
--    (aunque venga vacía) sí reemplaza. GRANT alineado con guardar_nav_prefs (056): anon, authenticated, service_role.
-- 2) Las novedades del portal son por obra: ultimo_visto_at vivía en portal_usuarios (una cuenta puede ver varias
--    obras, mig. 050), así que abrir la obra A dejaba en cero las fotos y documentos nuevos de la B. La marca pasa a
--    control_obra.portal_usuario_obras.ultimo_visto_at; se siembra con el valor de la cuenta para no marcar «nuevo»
--    todo el historial a quien ya venía entrando. portal_usuarios.ultimo_visto_at se sigue actualizando (última
--    visita de la cuenta, sea la obra que sea).
-- 3) eliminar_empresa_definitivo limpia los logotipos: la Edge Function subir-logo escribía empresa_<id>/... y la
--    limpieza sólo buscaba empresa/<id>/%. La función pasa a escribir empresa/<id>/... y aquí se cubren además los
--    nombres viejos del bucket `logos`.

-- ---------- 1) guardar_empresa_modulos ----------
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

    -- Clave ausente en el JSON = «no tocar»: se conserva lo que ya tenía la fila (revisión 6-sep-2026)
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
          custom_name = CASE WHEN v_item ? 'custom_name' THEN EXCLUDED.custom_name ELSE empresa_modulos.custom_name END,
          custom_icon = CASE WHEN v_item ? 'custom_icon' THEN EXCLUDED.custom_icon ELSE empresa_modulos.custom_icon END,
          orden       = CASE WHEN v_item ? 'orden'       THEN EXCLUDED.orden       ELSE empresa_modulos.orden       END,
          updated_at  = now();
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'guardados', v_n, 'empresa_id', v_emp);
END;
$function$;

REVOKE ALL ON FUNCTION public.guardar_empresa_modulos(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_empresa_modulos(jsonb) TO anon, authenticated, service_role;

-- ---------- 2) Novedades del portal por obra ----------
ALTER TABLE control_obra.portal_usuario_obras ADD COLUMN IF NOT EXISTS ultimo_visto_at timestamptz;
COMMENT ON COLUMN control_obra.portal_usuario_obras.ultimo_visto_at IS
  'Última vez que la cuenta abrió ESTA obra en el portal (portal_datos). Base de fotos y documentos nuevos.';
-- Siembra: quien ya entraba hereda la última visita de la cuenta (no se le marca todo como nuevo)
UPDATE control_obra.portal_usuario_obras puo
   SET ultimo_visto_at = u.ultimo_visto_at
  FROM control_obra.portal_usuarios u
 WHERE u.id = puo.usuario_id AND puo.ultimo_visto_at IS NULL AND u.ultimo_visto_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.portal_datos(p_token text, p_obra_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
declare v_u control_obra.portal_usuarios; v_visto timestamptz; v_res jsonb;
begin
  v_u := control_obra.portal_usuario_de_sesion(p_token);
  if v_u.id is null then return jsonb_build_object('error','sesion_invalida'); end if;
  select ultimo_visto_at into v_visto from control_obra.portal_usuario_obras where usuario_id = v_u.id and obra_id = p_obra_id;
  if not found then
    return jsonb_build_object('error','sin_acceso');
  end if;
  v_res := control_obra.portal_payload(p_obra_id)
      || jsonb_build_object('usuario', jsonb_build_object('nombre', v_u.nombre, 'usuario', v_u.usuario),
                            'novedades', control_obra.portal_novedades(p_obra_id, v_visto));
  -- La marca se mueve DESPUÉS de armar la respuesta y sólo para esta obra
  update control_obra.portal_usuario_obras set ultimo_visto_at = now() where usuario_id = v_u.id and obra_id = p_obra_id;
  update control_obra.portal_usuarios set ultimo_visto_at = now() where id = v_u.id;
  return v_res;
end; $function$;

-- ---------- 3) Limpieza de logotipos al eliminar la empresa ----------
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
  -- Archivos del Storage. Convención empresa/<id>/... (comprobantes, fotos y, desde 062, logotipos); en `logos` se
  -- limpian también los nombres viejos empresa_<id>/... y empresa_<id>_... que dejó la subida anterior.
  DELETE FROM storage.objects WHERE bucket_id IN ('comprobantes','fotos','logos') AND name LIKE 'empresa/' || p_empresa_id || '/%';
  DELETE FROM storage.objects WHERE bucket_id = 'logos'
    AND (name LIKE 'empresa\_' || p_empresa_id || '/%' OR name LIKE 'empresa\_' || p_empresa_id || '\_%');
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
