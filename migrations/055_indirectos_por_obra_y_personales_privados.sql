-- 055 · (3-sep-2026)
-- 1) Los gastos de oficina (destino 'indirecto') pueden ligarse a UNA obra: crear_gasto conserva obra_id
--    y ese gasto ya no se prorratea entre todas las obras (lo maneja Finanzas.indirectosDeObra).
-- 2) Los gastos personales de socio (destino 'socio', socio_tipo 'personal') sólo los ve el socio dueño
--    (socios.usuario_id = usuario de la sesión). Un administrador NO ve los personales de otro socio.
--    Se aplica en RLS (vista public.gastos) y en load_all_data_seguro. Los de socios sin usuario vinculado
--    los siguen viendo los administradores (alguien tiene que capturarlos).
--    En movimientos_socio los conceptos de gasto_personal ajenos se entregan enmascarados.

-- ---------- 1) crear_gasto: indirecto con obra ----------
CREATE OR REPLACE FUNCTION public.crear_gasto(p_user_id uuid, p_obra_id integer, p_fecha_solicitud date, p_orden_compra text DEFAULT NULL::text, p_estatus_pago text DEFAULT 'Pendiente'::text, p_tipo_comprobante text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text, p_monto_neto numeric DEFAULT 0, p_proveedor_id integer DEFAULT NULL::integer, p_solicitante text DEFAULT NULL::text, p_comentarios text DEFAULT NULL::text, p_estatus_entrega text DEFAULT NULL::text, p_factura_numero text DEFAULT NULL::text, p_orden_compra_id integer DEFAULT NULL::integer, p_folio_fiscal text DEFAULT NULL::text, p_descripcion text DEFAULT NULL::text, p_destino text DEFAULT NULL::text, p_socio_id integer DEFAULT NULL::integer, p_subtotal numeric DEFAULT NULL::numeric, p_iva numeric DEFAULT NULL::numeric, p_comprobacion text DEFAULT NULL::text, p_comprobante_url text DEFAULT NULL::text, p_fecha_vencimiento date DEFAULT NULL::date, p_partida text DEFAULT NULL::text, p_aprobado boolean DEFAULT NULL::boolean, p_socio_tipo text DEFAULT 'personal'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_empresa_id integer; v_gasto_id integer; v_nivel integer; v_destino text; v_aprobado_at timestamptz; v_socio_tipo text; v_obra_id integer;
BEGIN
  -- GUARDA_ESCRITURA_038
  PERFORM public.require_escritura();
  -- GUARDA_SESION_035
  IF p_user_id IS DISTINCT FROM public.get_session_user_id() THEN RAISE EXCEPTION 'No autorizado: el usuario no coincide con la sesión' USING ERRCODE = '28000'; END IF;

  SELECT u.empresa_id, r.nivel_acceso INTO v_empresa_id, v_nivel
  FROM control_obra.obra_usuarios u LEFT JOIN control_obra.obra_roles r ON r.id = u.rol_id
  WHERE u.id = p_user_id AND u.activo = true;
  IF v_empresa_id IS NULL THEN RETURN json_build_object('success', false, 'error', 'Usuario no válido'); END IF;
  IF p_obra_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM control_obra.obras WHERE id = p_obra_id AND empresa_id = v_empresa_id) THEN
    RETURN json_build_object('success', false, 'error', 'La obra no pertenece a su empresa');
  END IF;
  v_destino := COALESCE(p_destino, CASE WHEN p_obra_id IS NULL THEN 'indirecto' ELSE 'obra' END);
  IF v_destino = 'socio' AND COALESCE(v_nivel, 0) < 100 THEN
    RETURN json_build_object('success', false, 'error', 'Sólo un administrador puede registrar gastos de socio');
  END IF;
  v_socio_tipo := CASE WHEN v_destino = 'socio' AND p_socio_tipo = 'utilidad' THEN 'utilidad' ELSE 'personal' END;
  IF v_socio_tipo = 'utilidad' AND p_obra_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Los honorarios con cargo a la utilidad necesitan una obra');
  END IF;
  -- Obra: la conservan los gastos de obra, los de oficina ligados a una obra y los honorarios con cargo a la utilidad
  v_obra_id := CASE WHEN v_destino IN ('obra', 'indirecto') OR v_socio_tipo = 'utilidad' THEN p_obra_id END;
  IF p_aprobado IS TRUE OR (p_aprobado IS NULL AND (v_nivel >= 80 OR (v_nivel >= 50 AND p_monto_neto <= 200000) OR p_monto_neto <= 50000)) THEN
    v_aprobado_at := NOW();
  END IF;
  INSERT INTO control_obra.gastos (
    obra_id, fecha_solicitud, orden_compra, estatus_pago, tipo_comprobante, categoria, monto_neto, proveedor_id,
    solicitante, comentarios, estatus_entrega, factura_numero, orden_compra_id, folio_fiscal, descripcion, empresa_id,
    destino, socio_id, socio_tipo, subtotal, iva, comprobacion, comprobante_url, fecha_vencimiento, partida,
    aprobado_por, aprobado_at, created_at, updated_at
  ) VALUES (
    v_obra_id, p_fecha_solicitud, p_orden_compra, p_estatus_pago, p_tipo_comprobante, p_categoria, p_monto_neto, p_proveedor_id,
    p_solicitante, p_comentarios, p_estatus_entrega, p_factura_numero, p_orden_compra_id, p_folio_fiscal, p_descripcion, v_empresa_id,
    v_destino, CASE WHEN v_destino = 'socio' THEN p_socio_id END, v_socio_tipo, p_subtotal, p_iva,
    COALESCE(p_comprobacion, CASE WHEN p_folio_fiscal IS NOT NULL AND p_folio_fiscal <> '' THEN 'facturado'
                                  WHEN p_comprobante_url IS NOT NULL THEN 'ticket'
                                  WHEN p_tipo_comprobante = 'Fiscal' THEN 'factura_pendiente' ELSE 'sin_comprobante' END),
    p_comprobante_url, p_fecha_vencimiento, p_partida,
    CASE WHEN v_aprobado_at IS NOT NULL THEN p_user_id END, v_aprobado_at, NOW(), NOW()
  ) RETURNING id INTO v_gasto_id;
  RETURN json_build_object('success', true, 'gasto_id', v_gasto_id, 'aprobado', v_aprobado_at IS NOT NULL);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- Un indirecto ligado a una obra no lleva prorrateo: limpiar cualquier reparto viejo
DELETE FROM control_obra.gastos_admin_distribucion d
 USING control_obra.gastos g
 WHERE d.gasto_id = g.id AND g.destino = 'indirecto' AND g.obra_id IS NOT NULL;

-- ---------- 2) Gastos personales privados por socio ----------
-- ¿Este gasto personal pertenece a OTRO socio con usuario vinculado? (true = ocultar)
CREATE OR REPLACE FUNCTION control_obra.gasto_personal_ajeno(p_destino text, p_socio_tipo text, p_socio_id integer, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'control_obra', 'public'
AS $$
  SELECT p_destino = 'socio'
     AND COALESCE(p_socio_tipo, 'personal') = 'personal'
     AND EXISTS (SELECT 1 FROM control_obra.socios s
                  WHERE s.id = p_socio_id AND s.usuario_id IS NOT NULL AND s.usuario_id IS DISTINCT FROM p_user_id);
$$;
REVOKE ALL ON FUNCTION control_obra.gasto_personal_ajeno(text, text, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control_obra.gasto_personal_ajeno(text, text, integer, uuid) TO anon, authenticated, service_role;

-- RLS de gastos (la vista public.gastos es security_invoker): un administrador no ve, edita ni borra
-- los personales de otro socio. Los niveles < 100 conservan su comportamiento anterior.
DROP POLICY IF EXISTS gastos_select_own ON control_obra.gastos;
CREATE POLICY gastos_select_own ON control_obra.gastos FOR SELECT
  USING (empresa_id = control_obra.get_session_empresa_id()
         AND (control_obra.get_session_nivel() < 100
              OR NOT control_obra.gasto_personal_ajeno(destino, socio_tipo, socio_id, control_obra.get_session_user_id())));
DROP POLICY IF EXISTS gastos_update_own ON control_obra.gastos;
CREATE POLICY gastos_update_own ON control_obra.gastos FOR UPDATE
  USING (empresa_id = control_obra.get_session_empresa_id()
         AND (control_obra.get_session_nivel() < 100
              OR NOT control_obra.gasto_personal_ajeno(destino, socio_tipo, socio_id, control_obra.get_session_user_id())))
  -- WITH CHECK sólo por empresa: un administrador puede mover un gasto a la cuenta personal de otro socio (y deja de verlo)
  WITH CHECK (empresa_id = control_obra.get_session_empresa_id());
DROP POLICY IF EXISTS gastos_delete_own ON control_obra.gastos;
CREATE POLICY gastos_delete_own ON control_obra.gastos FOR DELETE
  USING (empresa_id = control_obra.get_session_empresa_id()
         AND (control_obra.get_session_nivel() < 100
              OR NOT control_obra.gasto_personal_ajeno(destino, socio_tipo, socio_id, control_obra.get_session_user_id())));

-- load_all_data_seguro: misma regla en la carga inicial; conceptos de gasto_personal ajenos enmascarados
CREATE OR REPLACE FUNCTION public.load_all_data_seguro(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public', 'extensions'
AS $function$
DECLARE v_user RECORD; v_result JSONB := '{}'::jsonb;
BEGIN
    SELECT u.id, u.empresa_id, u.rol_id, u.nombre, COALESCE(r.nivel_acceso, 0) AS nivel
    INTO v_user
    FROM control_obra.obra_sesiones s
    JOIN control_obra.obra_usuarios u ON s.usuario_id = u.id
    LEFT JOIN control_obra.obra_roles r ON r.id = u.rol_id
    WHERE s.token = p_token AND s.expires_at > NOW() AND u.activo = true;
    IF v_user.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sesión inválida o expirada');
    END IF;
    v_result := jsonb_build_object(
        'success', true,
        'empresa_id', v_user.empresa_id,
        'user_id', v_user.id,
        'user_nombre', v_user.nombre,
        'nivel', v_user.nivel,
        'obras', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.obras WHERE empresa_id = v_user.empresa_id ORDER BY created_at DESC) t), '[]'::jsonb),
        'empleados', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.empleados WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'gastos', COALESCE((SELECT jsonb_agg(
            to_jsonb(g) || CASE WHEN g.destino = 'socio' AND v_user.nivel < 100
                                THEN jsonb_build_object('descripcion', 'Retiro de socio', 'comentarios', NULL, 'proveedor_id', NULL, 'comprobante_url', NULL)
                                ELSE '{}'::jsonb END
            ORDER BY g.fecha_solicitud DESC)
            FROM control_obra.gastos g
            WHERE g.empresa_id = v_user.empresa_id
              AND (v_user.nivel < 100 OR NOT control_obra.gasto_personal_ajeno(g.destino, g.socio_tipo, g.socio_id, v_user.id))), '[]'::jsonb),
        'usuarios', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.obra_usuarios WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'roles', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.obra_roles ORDER BY nivel_acceso DESC) t), '[]'::jsonb),
        'ordenes_compra', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.ordenes_compra WHERE empresa_id = v_user.empresa_id ORDER BY created_at DESC) t), '[]'::jsonb),
        'proveedores', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.proveedores WHERE empresa_id = v_user.empresa_id ORDER BY nombre_proveedor) t), '[]'::jsonb),
        'estimaciones', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.estimaciones WHERE empresa_id = v_user.empresa_id ORDER BY numero_estimacion DESC) t), '[]'::jsonb),
        'clientes', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.clientes WHERE empresa_id = v_user.empresa_id ORDER BY nombre) t), '[]'::jsonb),
        'cotizaciones', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.cotizaciones WHERE empresa_id = v_user.empresa_id ORDER BY created_at DESC) t), '[]'::jsonb),
        'materiales', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.materiales WHERE empresa_id = v_user.empresa_id ORDER BY nombre) t), '[]'::jsonb),
        'subcontratos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.subcontratos WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'bitacora', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.bitacora_obra WHERE empresa_id = v_user.empresa_id ORDER BY fecha DESC) t), '[]'::jsonb),
        'nomina', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.nomina WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'eventos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.eventos_calendario WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'pagos_proveedores', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.pagos_proveedores WHERE empresa_id = v_user.empresa_id ORDER BY fecha_pago DESC) t), '[]'::jsonb),
        'pagos_recibidos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.pagos_recibidos WHERE empresa_id = v_user.empresa_id ORDER BY fecha_pago DESC) t), '[]'::jsonb),
        'programas_obra', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.programas_obra WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'catalogo_conceptos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.catalogo_conceptos WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'obra_modificaciones', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.obra_modificaciones WHERE empresa_id = v_user.empresa_id ORDER BY fecha DESC) t), '[]'::jsonb),
        'cuentas_por_cobrar', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.cuentas_por_cobrar WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'materiales_movimientos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.materiales_movimientos WHERE empresa_id = v_user.empresa_id ORDER BY fecha DESC) t), '[]'::jsonb),
        'subcontratos_pagos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.subcontratos_pagos WHERE empresa_id = v_user.empresa_id ORDER BY fecha_pago DESC) t), '[]'::jsonb),
        'asistencia', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.asistencia WHERE empresa_id = v_user.empresa_id ORDER BY fecha DESC) t), '[]'::jsonb),
        'plantillas_cotizacion', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.plantillas_cotizacion WHERE empresa_id = v_user.empresa_id) t), '[]'::jsonb),
        'categorias_gasto', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.categorias_gasto WHERE empresa_id = v_user.empresa_id OR empresa_id IS NULL ORDER BY orden, nombre) t), '[]'::jsonb),
        'socios', CASE WHEN v_user.nivel >= 100 THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.socios WHERE empresa_id = v_user.empresa_id ORDER BY nombre) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'movimientos_socio', CASE WHEN v_user.nivel >= 100 THEN COALESCE((SELECT jsonb_agg(
            to_jsonb(m) || CASE WHEN m.tipo = 'gasto_personal'
                                 AND EXISTS (SELECT 1 FROM control_obra.socios s WHERE s.id = m.socio_id AND s.usuario_id IS NOT NULL AND s.usuario_id IS DISTINCT FROM v_user.id)
                                THEN jsonb_build_object('concepto', 'Gasto personal', 'referencia', NULL)
                                ELSE '{}'::jsonb END
            ORDER BY m.fecha DESC)
            FROM control_obra.movimientos_socio m WHERE m.empresa_id = v_user.empresa_id), '[]'::jsonb) ELSE '[]'::jsonb END,
        'loaded_at', NOW()
    );
    RETURN v_result;
END;
$function$;
