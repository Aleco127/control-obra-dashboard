-- 063 · Segunda ronda de la revisión de la barra de módulos (code-review high, 6-sep-2026)
-- 1) Novedades del portal: la línea base de «nuevo» es la última visita a ESA obra y, si la cuenta nunca la abrió, la
--    fecha en que se le dio el acceso (portal_usuario_obras.created_at). Así un acceso nuevo no ve todo el historial
--    como nuevo, y una obra que nunca se abrió sí muestra lo que llegó desde que hay acceso. Se deshace la siembra de
--    062 en las obras que la cuenta nunca abrió (sin eventos en portal_eventos): ahí valía la marca de la cuenta y
--    ocultaba lo anterior.
-- 2) guardar_empresa_modulos: `enabled` sigue la misma regla «clave ausente = no tocar» que las demás columnas, y el
--    ícono se puede limpiar mandando custom_icon vacío o nulo (el regex sólo se valida cuando hay valor).
-- 3) Storage: eliminar_empresa_logos (035) y uso_empresa (038) usaban `_` sin escapar en LIKE, que es comodín de un
--    carácter: 'empresa_1_%' casaba 'empresa/12/...' y 'empresa_10/...' (borrar o contar archivos de otro inquilino).
--    Se escapan, y eliminar_empresa_definitivo llama a eliminar_empresa_logos en lugar de repetir el patrón.
-- 4) archivos_de_empresa(p_empresa_id): lista bucket + nombre para que la Edge Function jobs borre los bytes por la
--    API de Storage antes de la RPC; DELETE FROM storage.objects sólo quita las filas y deja el archivo en el bucket.

-- ---------- 1) Novedades por obra con línea base ----------
UPDATE control_obra.portal_usuario_obras puo
   SET ultimo_visto_at = NULL
 WHERE puo.ultimo_visto_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM control_obra.portal_eventos e
                    WHERE e.portal_usuario_id = puo.usuario_id AND e.obra_id = puo.obra_id);

COMMENT ON COLUMN control_obra.portal_usuario_obras.ultimo_visto_at IS
  'Última vez que la cuenta abrió ESTA obra en el portal (portal_datos). Nulo = nunca; entonces la base de «nuevo» es created_at (cuando se dio el acceso).';

CREATE OR REPLACE FUNCTION public.portal_datos(p_token text, p_obra_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
declare v_u control_obra.portal_usuarios; v_acc record; v_visto timestamptz; v_res jsonb;
begin
  v_u := control_obra.portal_usuario_de_sesion(p_token);
  if v_u.id is null then return jsonb_build_object('error','sesion_invalida'); end if;
  select ultimo_visto_at, created_at into v_acc
    from control_obra.portal_usuario_obras where usuario_id = v_u.id and obra_id = p_obra_id;
  if not found then
    return jsonb_build_object('error','sin_acceso');
  end if;
  -- Base de «nuevo»: la última visita a esta obra; si nunca se abrió, desde que se dio el acceso
  v_visto := coalesce(v_acc.ultimo_visto_at, v_acc.created_at);
  v_res := control_obra.portal_payload(p_obra_id)
      || jsonb_build_object('usuario', jsonb_build_object('nombre', v_u.nombre, 'usuario', v_u.usuario),
                            'novedades', control_obra.portal_novedades(p_obra_id, v_visto));
  -- La marca se mueve DESPUÉS de armar la respuesta y sólo para esta obra
  update control_obra.portal_usuario_obras set ultimo_visto_at = now() where usuario_id = v_u.id and obra_id = p_obra_id;
  update control_obra.portal_usuarios set ultimo_visto_at = now() where id = v_u.id;
  return v_res;
end; $function$;

-- ---------- 2) guardar_empresa_modulos ----------
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
  -- Lista fija de módulos válidos (las 34 claves de NAV_GRUPOS; 'zz' y 'x' no son módulos reales).
  -- scripts/qa/nav-shell.test.mjs comprueba que coincide con src/js/nav-grupos.js.
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

REVOKE ALL ON FUNCTION public.guardar_empresa_modulos(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_empresa_modulos(jsonb) TO anon, authenticated, service_role;

-- ---------- 3) LIKE escapado en las funciones de Storage ----------
-- Nombres que ha usado el bucket logos: empresa/<id>/... (convención actual), empresa_<id>/... (subir-logo v1) y
-- empresa_<id>_... (subida vieja en la raíz). `\_` es el guion bajo literal.
CREATE OR REPLACE FUNCTION public.eliminar_empresa_logos(p_empresa_id integer) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  DELETE FROM storage.objects WHERE bucket_id = 'logos'
    AND (name LIKE 'empresa/' || p_empresa_id || '/%'
      OR name LIKE 'empresa\_' || p_empresa_id || '/%'
      OR name LIKE 'empresa\_' || p_empresa_id || '\_%');
$$;
REVOKE EXECUTE ON FUNCTION public.eliminar_empresa_logos(integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.uso_empresa(p_empresa_id integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','control_obra'
AS $$
  SELECT jsonb_build_object(
    'obras_activas', (SELECT count(*) FROM control_obra.obras WHERE empresa_id = p_empresa_id AND NOT es_ejemplo AND coalesce(estatus,'') NOT IN ('Archivada','Completada','Terminada','Cancelada','Cerrada')),
    'usuarios', (SELECT count(*) FROM control_obra.obra_usuarios WHERE empresa_id = p_empresa_id AND activo = true),
    'storage_mb', (SELECT round(coalesce(sum((metadata->>'size')::bigint),0)/1048576.0, 1) FROM storage.objects
                    WHERE name LIKE 'empresa/' || p_empresa_id || '/%'
                       OR name LIKE 'empresa\_' || p_empresa_id || '/%'
                       OR name LIKE 'empresa\_' || p_empresa_id || '\_%')
  );
$$;

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
  -- Filas del Storage (los bytes los borra antes la Edge Function jobs con archivos_de_empresa + API de Storage)
  DELETE FROM storage.objects WHERE bucket_id IN ('comprobantes','fotos','logos') AND name LIKE 'empresa/' || p_empresa_id || '/%';
  PERFORM public.eliminar_empresa_logos(p_empresa_id);   -- nombres viejos del bucket logos
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

-- ---------- 4) archivos_de_empresa: lo que jobs debe borrar por la API de Storage ----------
CREATE OR REPLACE FUNCTION public.archivos_de_empresa(p_empresa_id integer)
RETURNS TABLE (bucket_id text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT o.bucket_id, o.name FROM storage.objects o
   WHERE o.bucket_id IN ('comprobantes','fotos','logos')
     AND (o.name LIKE 'empresa/' || p_empresa_id || '/%'
       OR (o.bucket_id = 'logos' AND (o.name LIKE 'empresa\_' || p_empresa_id || '/%' OR o.name LIKE 'empresa\_' || p_empresa_id || '\_%')));
$$;
REVOKE ALL ON FUNCTION public.archivos_de_empresa(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archivos_de_empresa(integer) TO service_role;
COMMENT ON FUNCTION public.archivos_de_empresa(integer) IS
  'Sólo service_role: archivos de Storage de la empresa (comprobantes, fotos, logos) para que jobs los borre por la API antes de eliminar_empresa_definitivo.';
