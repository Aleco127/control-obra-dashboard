-- 085_bucket_licitaciones.sql (US-804) — Bucket privado `licitaciones` para bases, anexos, planos y el expediente.
--
-- Rutas (el segundo segmento es la empresa, igual que en `comprobantes`):
--   empresa/<empresa_id>/licitaciones/<licitacion_id>/<categoria>/<archivo>
--   empresa/<empresa_id>/expediente/<categoria>/<archivo>
-- Políticas select / insert / delete copiadas del patrón de `comprobantes`, más D3 (nivel >= 80) y la carpeta de
-- tercer nivel restringida a licitaciones|expediente. Sin política UPDATE: no hay upsert (cada versión es otro
-- archivo; renovar un documento sube uno nuevo y marca reemplaza_id).
-- Se lee con createSignedUrl (bucket privado). Límite 50 MB (bases escaneadas de 30 a 80 MB: el panel pide
-- comprimir o dividir). Para .dwg el cliente debe mandar contentType 'image/vnd.dwg' (el navegador suele dar
-- application/octet-stream, que NO se admite para no abrir el bucket a cualquier tipo).
--
-- La baja definitiva de una empresa (job `bajas` → archivos_de_empresa + API de Storage → eliminar_empresa_definitivo)
-- también limpia este bucket: se agrega 'licitaciones' a la lista de buckets de esas dos funciones. Se partió de su
-- definición ACTUAL en la BD (pg_get_functiondef, 4-oct-2026); lo único que cambia es la lista de buckets.

-- 1) Bucket -----------------------------------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('licitaciones', 'licitaciones', false, 52428800, ARRAY[
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/vnd.dwg', 'application/acad', 'application/x-dwg', 'application/dwg', 'image/x-dwg',
  'application/zip', 'application/x-zip-compressed'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2) Políticas ----------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS licitaciones_select ON storage.objects;
CREATE POLICY licitaciones_select ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'licitaciones'
         AND (storage.foldername(name))[1] = 'empresa'
         AND (storage.foldername(name))[2] = (SELECT control_obra.get_session_empresa_id())::text
         AND (SELECT control_obra.get_session_nivel()) >= 80);

DROP POLICY IF EXISTS licitaciones_insert ON storage.objects;
CREATE POLICY licitaciones_insert ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'licitaciones'
              AND (storage.foldername(name))[1] = 'empresa'
              AND (storage.foldername(name))[2] = (SELECT control_obra.get_session_empresa_id())::text
              AND (storage.foldername(name))[3] IN ('licitaciones', 'expediente')
              AND (SELECT control_obra.get_session_nivel()) >= 80);

DROP POLICY IF EXISTS licitaciones_delete ON storage.objects;
CREATE POLICY licitaciones_delete ON storage.objects FOR DELETE TO anon, authenticated
  USING (bucket_id = 'licitaciones'
         AND (storage.foldername(name))[1] = 'empresa'
         AND (storage.foldername(name))[2] = (SELECT control_obra.get_session_empresa_id())::text
         AND (SELECT control_obra.get_session_nivel()) >= 80);

-- 3) Baja de empresa: también este bucket -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archivos_de_empresa(p_empresa_id integer)
 RETURNS TABLE(bucket_id text, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.bucket_id, o.name FROM storage.objects o
   WHERE o.bucket_id IN ('comprobantes','fotos','logos','licitaciones')
     AND (o.name LIKE 'empresa/' || p_empresa_id || '/%'
       OR (o.bucket_id = 'logos' AND (o.name LIKE 'empresa\_' || p_empresa_id || '/%' OR o.name LIKE 'empresa\_' || p_empresa_id || '\_%')));
$function$;

CREATE OR REPLACE FUNCTION public.eliminar_empresa_definitivo(p_empresa_id integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
DECLARE v_t record; v_pasadas int := 0; v_pend int; v_borradas jsonb := '{}'::jsonb; v_n bigint; v_emp control_obra.empresas%ROWTYPE;
BEGIN
  SELECT * INTO v_emp FROM control_obra.empresas WHERE id = p_empresa_id;
  IF v_emp.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'No existe'); END IF;
  IF v_emp.baja_programada_at IS NULL OR v_emp.baja_programada_at > now() THEN
    RETURN json_build_object('success', false, 'error', 'La baja no está vencida');
  END IF;
  -- Filas del Storage (los bytes los borra antes la Edge Function jobs con archivos_de_empresa + API de Storage)
  DELETE FROM storage.objects WHERE bucket_id IN ('comprobantes','fotos','logos','licitaciones') AND name LIKE 'empresa/' || p_empresa_id || '/%';
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
