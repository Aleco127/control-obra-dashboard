-- 106_resumen_correo_por_destinatario.sql — El resumen diario por correo ya no repite los avisos personales.
--
-- Problema: notificaciones_para_correo (US-239) juntaba las alertas sin leer de TODA la empresa para cada
-- administrador. Los avisos del expediente (089) y de convocatorias (105) se crean una vez POR USUARIO de nivel >= 80
-- (usuario_id puesto), así que con dos administradores cada aviso salía dos veces en el correo de cada uno, y la
-- cuenta de «nuevas» y «pendientes» se duplicaba.
-- Arreglo: cada destinatario ve las alertas de la empresa sin dueño (usuario_id NULL, las de siempre) más las suyas,
-- igual que get_notificaciones en el panel. Misma firma y mismo resultado para las alertas sin usuario; los avisos
-- del panel no cambian. La función jobs no cambia.

CREATE OR REPLACE FUNCTION public.notificaciones_para_correo()
 RETURNS TABLE(empresa_id integer, empresa text, email text, nombre text, pendientes integer, nuevas integer, titulos jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
  SELECT e.id, e.nombre, u.email, u.nombre,
         (SELECT count(*)::int FROM control_obra.notificaciones n WHERE n.empresa_id = e.id AND n.leida_at IS NULL
             AND (n.usuario_id IS NULL OR n.usuario_id = u.id)),
         (SELECT count(*)::int FROM control_obra.notificaciones n WHERE n.empresa_id = e.id AND n.leida_at IS NULL
             AND (n.usuario_id IS NULL OR n.usuario_id = u.id) AND n.created_at >= now() - interval '24 hours'),
         (SELECT coalesce(jsonb_agg(jsonb_build_object('titulo', n.titulo, 'cuerpo', n.cuerpo, 'severidad', n.severidad) ORDER BY CASE n.severidad WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, n.created_at DESC), '[]'::jsonb)
            FROM (SELECT * FROM control_obra.notificaciones n WHERE n.empresa_id = e.id AND n.leida_at IS NULL
                     AND (n.usuario_id IS NULL OR n.usuario_id = u.id)
                   ORDER BY CASE n.severidad WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, n.created_at DESC LIMIT 8) n)
  FROM control_obra.empresas e
  JOIN control_obra.obra_usuarios u ON u.empresa_id = e.id AND coalesce(u.activo,true)
  JOIN control_obra.obra_roles r ON r.id = u.rol_id AND r.nivel_acceso >= 80
  WHERE coalesce(e.activo,true) AND e.baja_programada_at IS NULL AND u.email IS NOT NULL AND u.email NOT LIKE '%@example.com'
    AND EXISTS (SELECT 1 FROM control_obra.notificaciones n WHERE n.empresa_id = e.id AND n.leida_at IS NULL
                   AND (n.usuario_id IS NULL OR n.usuario_id = u.id) AND n.created_at >= now() - interval '24 hours');
$function$;
