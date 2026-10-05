-- 105_convocatorias_avisos.sql (US-846) — Contador de la barra y aviso diario de convocatorias.
--
-- ⚠ SUSTITUIDA EN PARTE por 105b_convocatorias_busqueda_manual.sql (cambio de alcance D12 del 5-oct-2026): ya no hay
--   corridas diarias, así que generar_avisos_convocatorias quedó sólo con los recordatorios (b) y el aviso de
--   «nuevas tras la corrida» (a) se quitó. get_convocatorias_avisos (contador de la barra) sigue igual.
--
-- 1) public.get_convocatorias_avisos(p_desde) → jsonb {nuevas, desde}
--    Contador de `lc` en navBadges(): convocatorias vigentes que cumplen algún filtro activo de la empresa, sin
--    seguimiento (o en «nueva») y vistas por primera vez después de p_desde (la última vez que el usuario abrió la
--    pestaña Convocatorias, que la app recuerda en localStorage); sin p_desde, las del último día. Ceros a nivel < 80.
--
-- 2) public.generar_avisos_convocatorias(p_simular boolean DEFAULT false) → jsonb  (sólo service_role)
--    La llama la acción `convocatorias_avisos` de supabase/functions/jobs, que corre dentro de `all` (14:00 UTC, una
--    hora después de la corrida de Contrataciones Chihuahua de las 13:00 UTC) ANTES de `notificaciones`, para que el
--    aviso entre al resumen diario por correo.
--    a) Nuevas: por empresa con filtros activos, las convocatorias vistas por primera vez desde el último aviso de
--       ese tipo (o en las últimas 24 h si nunca hubo uno), vigentes, que cumplen algún filtro y que la empresa no ha
--       marcado. Si hay al menos una: UNA notificación por usuario activo de nivel >= 80 (usuario_id puesto, como los
--       avisos del expediente de 089) con el conteo, modulo 'lc', tipo 'convocatorias_nuevas'. Sin nuevas no se
--       inserta nada. Clave conv_nuevas_<AAAAMMDD>_<usuario>: una al día como máximo.
--    b) Recordatorios: seguimiento «interesa» (no convertido) cuya apertura cae en 3 a 5 días (umbral 5) o en 0 a 2
--       días (umbral 2), en fecha civil de México. Clave conv_rec_<convocatoria>_<umbral>_<usuario>: una vez por umbral.
--       Los recordatorios pendientes de convocatorias que ya no están en «interesa» se marcan leídos.
--    p_simular = true calcula lo mismo y lo devuelve SIN insertar ni marcar nada (para probar en producción sin
--    mandar correos: el resumen diario lee la tabla notificaciones).
-- Aditiva: no toca la tabla notificaciones ni las funciones de otros avisos.

CREATE OR REPLACE FUNCTION public.get_convocatorias_avisos(p_desde timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_emp integer := control_obra.get_session_empresa_id();
  v_desde timestamptz := coalesce(p_desde, now() - interval '1 day');
  v_n bigint;
BEGIN
  IF control_obra.get_session_user_id() IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '28000';
  END IF;
  IF v_emp IS NULL OR coalesce(control_obra.get_session_nivel(), 0) < 80 THEN
    RETURN jsonb_build_object('nuevas', 0, 'desde', v_desde);
  END IF;
  SELECT count(*) INTO v_n
    FROM control_obra.convocatorias c
   WHERE c.primera_vez_vista > v_desde
     AND control_obra.convocatoria_vigente(c.estatus, c.apertura)
     AND NOT EXISTS (SELECT 1 FROM control_obra.convocatoria_seguimiento s
                      WHERE s.empresa_id = v_emp AND s.convocatoria_id = c.id AND s.estado <> 'nueva')
     AND EXISTS (SELECT 1 FROM control_obra.convocatoria_filtros f
                  WHERE f.empresa_id = v_emp AND f.activo
                    AND control_obra.convocatoria_cumple_filtro(c.texto_norm, c.fuente, c.entidad, c.tipo_contratacion,
                          f.palabras_clave, f.palabras_excluir, f.fuentes, f.entidades, f.tipos_contratacion));
  RETURN jsonb_build_object('nuevas', v_n, 'desde', v_desde);
END; $$;
REVOKE ALL ON FUNCTION public.get_convocatorias_avisos(timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.get_convocatorias_avisos(timestamptz) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.generar_avisos_convocatorias(p_simular boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_ins integer := 0; v_cerr integer := 0; v_n integer;
  v_res jsonb;
BEGIN
  DROP TABLE IF EXISTS pg_temp.conv_avisos;
  CREATE TEMP TABLE conv_avisos (empresa_id integer, usuario_id uuid, clave text, tipo text, severidad text,
                                 titulo text, cuerpo text, conteo integer) ON COMMIT DROP;

  -- a) Nuevas que cumplen los filtros, una notificación por usuario n80 con el conteo
  WITH emp AS (
    SELECT e.id AS empresa_id,
           coalesce((SELECT max(n.created_at) FROM control_obra.notificaciones n
                      WHERE n.empresa_id = e.id AND n.tipo = 'convocatorias_nuevas'), now() - interval '1 day') AS desde
      FROM control_obra.empresas e
     WHERE coalesce(e.activo, true) AND e.baja_programada_at IS NULL
       AND EXISTS (SELECT 1 FROM control_obra.convocatoria_filtros f WHERE f.empresa_id = e.id AND f.activo)
  ), nuevas AS (
    SELECT emp.empresa_id, count(*)::int AS n,
           (array_agg(c.titulo ORDER BY c.apertura NULLS LAST, c.id))[1:3] AS ejemplos
      FROM emp
      JOIN control_obra.convocatorias c ON c.primera_vez_vista > emp.desde
     WHERE control_obra.convocatoria_vigente(c.estatus, c.apertura)
       AND NOT EXISTS (SELECT 1 FROM control_obra.convocatoria_seguimiento s
                        WHERE s.empresa_id = emp.empresa_id AND s.convocatoria_id = c.id AND s.estado <> 'nueva')
       AND EXISTS (SELECT 1 FROM control_obra.convocatoria_filtros f
                    WHERE f.empresa_id = emp.empresa_id AND f.activo
                      AND control_obra.convocatoria_cumple_filtro(c.texto_norm, c.fuente, c.entidad, c.tipo_contratacion,
                            f.palabras_clave, f.palabras_excluir, f.fuentes, f.entidades, f.tipos_contratacion))
     GROUP BY emp.empresa_id
  )
  INSERT INTO pg_temp.conv_avisos
  SELECT nv.empresa_id, us.id,
         'conv_nuevas_' || to_char(v_hoy, 'YYYYMMDD') || '_' || us.id,
         'convocatorias_nuevas', 'info',
         CASE WHEN nv.n = 1 THEN '1 convocatoria nueva cumple tus filtros'
              ELSE nv.n || ' convocatorias nuevas cumplen tus filtros' END,
         'Revísalas en Licitaciones › Convocatorias: '
           || array_to_string(ARRAY(SELECT left(x, 90) FROM unnest(nv.ejemplos) x), '; ')
           || CASE WHEN nv.n > 3 THEN ' y ' || (nv.n - 3) || ' más.' ELSE '.' END,
         nv.n
    FROM nuevas nv
    JOIN control_obra.obra_usuarios us ON us.empresa_id = nv.empresa_id AND coalesce(us.activo, true)
    JOIN control_obra.obra_roles r ON r.id = us.rol_id AND r.nivel_acceso >= 80
   WHERE nv.n > 0;

  -- b) Recordatorios a 5 y 2 días de la apertura de las marcadas «interesa»
  WITH rec AS (
    SELECT s.empresa_id, c.id AS conv_id, c.titulo, c.numero_procedimiento, c.apertura,
           (c.apertura AT TIME ZONE 'America/Mexico_City')::date - v_hoy AS dias
      FROM control_obra.convocatoria_seguimiento s
      JOIN control_obra.convocatorias c ON c.id = s.convocatoria_id
      JOIN control_obra.empresas e ON e.id = s.empresa_id AND coalesce(e.activo, true) AND e.baja_programada_at IS NULL
     WHERE s.estado = 'interesa' AND c.apertura IS NOT NULL
       AND coalesce(c.estatus, 'vigente') IN ('vigente', 'en_seguimiento')
  ), umb AS (
    SELECT rec.*, CASE WHEN dias BETWEEN 0 AND 2 THEN '2' ELSE '5' END AS umbral
      FROM rec WHERE dias BETWEEN 0 AND 5
  )
  INSERT INTO pg_temp.conv_avisos
  SELECT u.empresa_id, us.id,
         'conv_rec_' || u.conv_id || '_' || u.umbral || '_' || us.id,
         'convocatoria_recordatorio', CASE u.umbral WHEN '2' THEN 'danger' ELSE 'warning' END,
         CASE WHEN u.dias = 0 THEN 'Abre hoy: ' WHEN u.dias = 1 THEN 'Abre mañana: '
              ELSE 'Abre en ' || u.dias || ' días: ' END || left(coalesce(u.numero_procedimiento || ' · ', '') || u.titulo, 120),
         'Apertura de propuestas el ' || to_char(u.apertura AT TIME ZONE 'America/Mexico_City', 'DD/MM/YYYY HH24:MI')
           || '. La marcaste «Me interesa» y aún no es licitación: conviértela con «Participar» en Licitaciones › Convocatorias o descártala.',
         1
    FROM umb u
    JOIN control_obra.obra_usuarios us ON us.empresa_id = u.empresa_id AND coalesce(us.activo, true)
    JOIN control_obra.obra_roles r ON r.id = us.rol_id AND r.nivel_acceso >= 80;

  SELECT jsonb_build_object(
           'simulado', coalesce(p_simular, false),
           'nuevas', coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('empresa_id', a.empresa_id, 'conteo', a.conteo))
                                 FROM pg_temp.conv_avisos a WHERE a.tipo = 'convocatorias_nuevas'), '[]'::jsonb),
           'recordatorios', (SELECT count(DISTINCT split_part(a.clave, '_', 3) || '_' || split_part(a.clave, '_', 4))
                               FROM pg_temp.conv_avisos a WHERE a.tipo = 'convocatoria_recordatorio'),
           'por_insertar', (SELECT count(*) FROM pg_temp.conv_avisos a
                             WHERE NOT EXISTS (SELECT 1 FROM control_obra.notificaciones n
                                                WHERE n.empresa_id = a.empresa_id AND n.clave = a.clave)),
           'avisos', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa_id', a.empresa_id, 'usuario_id', a.usuario_id,
                                 'clave', a.clave, 'titulo', a.titulo, 'cuerpo', a.cuerpo) ORDER BY a.clave)
                                 FROM pg_temp.conv_avisos a), '[]'::jsonb))
    INTO v_res;

  IF coalesce(p_simular, false) THEN
    RETURN v_res;
  END IF;

  INSERT INTO control_obra.notificaciones (empresa_id, usuario_id, clave, tipo, severidad, titulo, cuerpo, modulo)
  SELECT a.empresa_id, a.usuario_id, a.clave, a.tipo, a.severidad, a.titulo, a.cuerpo, 'lc' FROM pg_temp.conv_avisos a
  ON CONFLICT (empresa_id, clave) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_ins := v_n;

  -- Recordatorios pendientes de convocatorias que ya no están en «interesa» (convertidas, descartadas o borradas)
  UPDATE control_obra.notificaciones n SET leida_at = now()
   WHERE n.leida_at IS NULL AND n.tipo = 'convocatoria_recordatorio'
     AND NOT EXISTS (SELECT 1 FROM control_obra.convocatoria_seguimiento s
                      WHERE s.empresa_id = n.empresa_id AND s.estado = 'interesa'
                        AND s.convocatoria_id = split_part(n.clave, '_', 3)::bigint);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_cerr := v_n;

  RETURN (v_res - 'avisos') || jsonb_build_object('insertadas', v_ins, 'cerradas', v_cerr);
END; $$;
REVOKE ALL ON FUNCTION public.generar_avisos_convocatorias(boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generar_avisos_convocatorias(boolean) TO service_role;
