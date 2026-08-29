-- 013: Bug preexistente en load_secondary_data_seguro: ordenaba control_obra.rfis por
-- "fecha_solicitud" (columna inexistente), así que la RPC fallaba con 400 y la app nunca
-- cargaba documentos, fotos, facturas recibidas, CFDIs, RFIs, punch list ni seguridad.
-- Se corrige el ORDER BY (rfis.fecha_emision) y se ordenan documentos y fotos por fecha.
CREATE OR REPLACE FUNCTION public.load_secondary_data_seguro(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
DECLARE
    v_user RECORD;
BEGIN
    SELECT u.id, u.empresa_id INTO v_user
    FROM control_obra.obra_sesiones s
    JOIN control_obra.obra_usuarios u ON s.usuario_id = u.id
    WHERE s.token = p_token AND s.expires_at > NOW() AND u.activo = true;

    IF v_user.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sesión inválida');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'documentos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.documentos WHERE empresa_id = v_user.empresa_id ORDER BY created_at DESC) t), '[]'::jsonb),
        'fotos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.fotos_obra WHERE empresa_id = v_user.empresa_id ORDER BY fecha_foto DESC NULLS LAST, id DESC) t), '[]'::jsonb),
        'facturas_recibidas', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.facturas_recibidas WHERE empresa_id = v_user.empresa_id ORDER BY fecha_emision DESC) t), '[]'::jsonb),
        'cfdis', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.cfdis_emitidos WHERE empresa_id = v_user.empresa_id ORDER BY fecha_emision DESC) t), '[]'::jsonb),
        'config_pac', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.config_pac WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'rfis', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.rfis WHERE empresa_id = v_user.empresa_id ORDER BY fecha_emision DESC NULLS LAST) t), '[]'::jsonb),
        'punch_list', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.punch_list WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'seguridad', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.seguridad WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb)
    );
END;
$function$;
