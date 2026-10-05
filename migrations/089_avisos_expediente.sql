-- 089_avisos_expediente.sql (US-809, US-812) — Avisos de vencimiento del expediente de la empresa.
--
-- 1) public.get_expediente_avisos() → jsonb {vencidos, por_vencer, items[]}
--    Lo pide la app al arrancar (contador de `ex` en navBadges() y tarjeta de Inicio). SECURITY DEFINER: valida la
--    sesión y devuelve ceros a nivel < 80 (D3). Cuenta documentos NO reemplazados de empresa_documentos con
--    vencimiento <= hoy + 30 (misma regla que la vista empresa_documentos_estado) y pólizas de maquinaria
--    (maquinaria.poliza_vigencia, US-812) de equipos que no estén vendidos. «Hoy» = fecha civil de America/Mexico_City.
--    Prefijo get_: el modo lectura de la app (wrapReadOnly) deja pasar las RPC de lectura.
--
-- 2) public.generar_avisos_expediente() → jsonb {nuevas, cerradas}  (sólo service_role)
--    La llama la acción `notificaciones` del job diario (supabase/functions/jobs). Por cada documento o póliza que
--    vence en <= 30, <= 15 o <= 3 días (umbral más chico alcanzado) y por cada vencido, inserta UNA notificación por
--    usuario activo de nivel >= 80 de la empresa (usuario_id puesto: get_notificaciones sólo se la muestra a él).
--    La clave exp_<doc|maq>_<id>_<umbral>_<usuario> + UNIQUE (empresa_id, clave) garantiza «una vez por umbral».
--    Marca como leídas las alertas pendientes de documentos que ya se renovaron o se borraron (y de pólizas que ya
--    no vencen pronto), para no avisar de algo resuelto.
-- Aditiva: sólo crea estas dos funciones; no toca generar_notificaciones_empresa ni la tabla notificaciones.

CREATE OR REPLACE FUNCTION public.get_expediente_avisos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
DECLARE
  v_emp   integer;
  v_hoy   date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_items jsonb;
BEGIN
  IF control_obra.get_session_user_id() IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '28000';
  END IF;
  v_emp := control_obra.get_session_empresa_id();
  IF v_emp IS NULL OR COALESCE(control_obra.get_session_nivel(), 0) < 80 THEN
    RETURN jsonb_build_object('vencidos', 0, 'por_vencer', 0, 'items', '[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.dias, x.nombre), '[]'::jsonb) INTO v_items FROM (
    SELECT 'documento' AS tipo, d.id, d.nombre, d.categoria, d.fecha_vencimiento, d.fecha_vencimiento - v_hoy AS dias
      FROM control_obra.empresa_documentos d
     WHERE d.empresa_id = v_emp AND d.fecha_vencimiento IS NOT NULL AND d.fecha_vencimiento <= v_hoy + 30
       AND NOT EXISTS (SELECT 1 FROM control_obra.empresa_documentos r WHERE r.reemplaza_id = d.id)
    UNION ALL
    SELECT 'poliza', m.id, m.descripcion, 'poliza_maquinaria', m.poliza_vigencia, m.poliza_vigencia - v_hoy
      FROM control_obra.maquinaria m
     WHERE m.empresa_id = v_emp AND m.poliza_vigencia IS NOT NULL AND m.poliza_vigencia <= v_hoy + 30
       AND m.estado_operativo <> 'vendido'
  ) x;
  RETURN jsonb_build_object(
    'vencidos',   (SELECT count(*) FROM jsonb_array_elements(v_items) e WHERE (e->>'dias')::int < 0),
    'por_vencer', (SELECT count(*) FROM jsonb_array_elements(v_items) e WHERE (e->>'dias')::int >= 0),
    'items', v_items);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_expediente_avisos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expediente_avisos() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.generar_avisos_expediente()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
DECLARE
  v_hoy     date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_nuevas  integer := 0;
  v_cerr    integer := 0;
  v_n       integer;
BEGIN
  WITH venc AS (
    SELECT d.empresa_id, 'doc' AS tipo, d.id, d.nombre, d.categoria AS etiqueta, d.fecha_vencimiento AS fecha,
           d.fecha_vencimiento - v_hoy AS dias
      FROM control_obra.empresa_documentos d
     WHERE d.fecha_vencimiento IS NOT NULL AND d.fecha_vencimiento <= v_hoy + 30 AND d.fecha_vencimiento >= v_hoy - 30
       AND NOT EXISTS (SELECT 1 FROM control_obra.empresa_documentos r WHERE r.reemplaza_id = d.id)
    UNION ALL
    SELECT m.empresa_id, 'maq', m.id, m.descripcion, 'poliza', m.poliza_vigencia, m.poliza_vigencia - v_hoy
      FROM control_obra.maquinaria m
     WHERE m.poliza_vigencia IS NOT NULL AND m.poliza_vigencia <= v_hoy + 30 AND m.poliza_vigencia >= v_hoy - 30
       AND m.estado_operativo <> 'vendido'
  ), umb AS (
    SELECT v.*, CASE WHEN v.dias < 0 THEN 'vencido' WHEN v.dias <= 3 THEN '3' WHEN v.dias <= 15 THEN '15' ELSE '30' END AS umbral
      FROM venc v
  )
  INSERT INTO control_obra.notificaciones (empresa_id, usuario_id, clave, tipo, severidad, titulo, cuerpo, modulo)
  SELECT u.empresa_id, us.id,
         'exp_' || u.tipo || '_' || u.id || '_' || u.umbral || '_' || us.id,
         CASE WHEN u.tipo = 'doc' THEN 'expediente_documento' ELSE 'expediente_poliza' END,
         CASE u.umbral WHEN 'vencido' THEN 'danger' WHEN '3' THEN 'danger' WHEN '15' THEN 'warning' ELSE 'info' END,
         CASE WHEN u.tipo = 'doc' THEN (CASE WHEN u.dias < 0 THEN 'Documento vencido: ' ELSE 'Documento por vencer: ' END)
              ELSE (CASE WHEN u.dias < 0 THEN 'Póliza de maquinaria vencida: ' ELSE 'Póliza de maquinaria por vencer: ' END) END
           || left(u.nombre, 120),
         CASE WHEN u.dias < 0 THEN 'Venció el ' || to_char(u.fecha, 'DD/MM/YYYY') || '. '
              WHEN u.dias = 0 THEN 'Vence hoy. '
              ELSE 'Vence el ' || to_char(u.fecha, 'DD/MM/YYYY') || ' (en ' || u.dias || ' día' || CASE WHEN u.dias = 1 THEN '' ELSE 's' END || '). ' END
           || CASE WHEN u.tipo = 'doc' THEN 'Renuévalo en Expediente de la empresa para seguir usándolo en tus concursos.'
                   ELSE 'Actualiza la póliza en Expediente › Maquinaria.' END,
         'ex'
    FROM umb u
    JOIN control_obra.empresas e ON e.id = u.empresa_id AND COALESCE(e.activo, true) AND e.baja_programada_at IS NULL
    JOIN control_obra.obra_usuarios us ON us.empresa_id = u.empresa_id AND COALESCE(us.activo, true)
    JOIN control_obra.obra_roles r ON r.id = us.rol_id AND r.nivel_acceso >= 80
  ON CONFLICT (empresa_id, clave) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_nuevas := v_n;

  -- Alertas pendientes de algo ya resuelto: documento renovado o borrado, póliza renovada o equipo vendido/borrado
  UPDATE control_obra.notificaciones n SET leida_at = now()
   WHERE n.leida_at IS NULL AND n.clave LIKE 'exp\_doc\_%'
     AND NOT EXISTS (SELECT 1 FROM control_obra.empresa_documentos d
                      WHERE d.id = split_part(n.clave, '_', 3)::int AND d.empresa_id = n.empresa_id
                        AND d.fecha_vencimiento <= v_hoy + 30
                        AND NOT EXISTS (SELECT 1 FROM control_obra.empresa_documentos r WHERE r.reemplaza_id = d.id));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_cerr := v_n;
  UPDATE control_obra.notificaciones n SET leida_at = now()
   WHERE n.leida_at IS NULL AND n.clave LIKE 'exp\_maq\_%'
     AND NOT EXISTS (SELECT 1 FROM control_obra.maquinaria m
                      WHERE m.id = split_part(n.clave, '_', 3)::int AND m.empresa_id = n.empresa_id
                        AND m.poliza_vigencia <= v_hoy + 30 AND m.estado_operativo <> 'vendido');
  GET DIAGNOSTICS v_n = ROW_COUNT; v_cerr := v_cerr + v_n;

  RETURN jsonb_build_object('nuevas', v_nuevas, 'cerradas', v_cerr);
END;
$function$;
REVOKE ALL ON FUNCTION public.generar_avisos_expediente() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generar_avisos_expediente() TO service_role;
