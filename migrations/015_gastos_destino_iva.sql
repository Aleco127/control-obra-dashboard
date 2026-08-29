-- 015: Destino, IVA, comprobación, pago parcial y aprobación en gastos (US-102)
-- gastos.monto_neto conserva su semántica: TOTAL efectivamente pagado o por pagar (con IVA cuando lo hay).
-- subtotal e iva son columnas normales (no generadas): un ticket sin desglose puede tener iva = 0.

-- 1) Columnas
ALTER TABLE control_obra.gastos
  ADD COLUMN IF NOT EXISTS destino text NOT NULL DEFAULT 'obra',
  ADD COLUMN IF NOT EXISTS socio_id integer NULL REFERENCES control_obra.socios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subtotal numeric(14,2) NULL,
  ADD COLUMN IF NOT EXISTS iva numeric(14,2) NULL,
  ADD COLUMN IF NOT EXISTS comprobacion text NOT NULL DEFAULT 'sin_comprobante',
  ADD COLUMN IF NOT EXISTS comprobante_url text NULL,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento date NULL,
  ADD COLUMN IF NOT EXISTS monto_pagado numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partida text NULL,
  ADD COLUMN IF NOT EXISTS aprobado_por uuid NULL,
  ADD COLUMN IF NOT EXISTS aprobado_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS factura_solicitada_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS conciliado_at timestamptz NULL;

ALTER TABLE control_obra.gastos DROP CONSTRAINT IF EXISTS gastos_destino_chk;
ALTER TABLE control_obra.gastos ADD CONSTRAINT gastos_destino_chk CHECK (destino IN ('obra','indirecto','socio'));
ALTER TABLE control_obra.gastos DROP CONSTRAINT IF EXISTS gastos_comprobacion_chk;
ALTER TABLE control_obra.gastos ADD CONSTRAINT gastos_comprobacion_chk CHECK (comprobacion IN ('sin_comprobante','ticket','factura_pendiente','facturado'));
CREATE INDEX IF NOT EXISTS idx_gastos_destino ON control_obra.gastos(empresa_id, destino);
CREATE INDEX IF NOT EXISTS idx_gastos_socio ON control_obra.gastos(socio_id);

-- 2) Backfill (suposición declarada: los gastos "Fiscal" traen 16 % de IVA incluido en el total)
UPDATE control_obra.gastos SET destino = 'indirecto' WHERE obra_id IS NULL AND destino = 'obra';
UPDATE control_obra.gastos SET
  subtotal = CASE WHEN tipo_comprobante = 'Fiscal' THEN round(monto_neto / 1.16, 2) ELSE monto_neto END,
  iva      = CASE WHEN tipo_comprobante = 'Fiscal' THEN monto_neto - round(monto_neto / 1.16, 2) ELSE 0 END
WHERE subtotal IS NULL;
UPDATE control_obra.gastos SET comprobacion =
  CASE WHEN folio_fiscal IS NOT NULL AND folio_fiscal <> '' THEN 'facturado'
       WHEN tipo_comprobante = 'Fiscal' THEN 'factura_pendiente'
       WHEN comprobante_url IS NOT NULL THEN 'ticket'
       ELSE 'sin_comprobante' END
WHERE comprobacion = 'sin_comprobante';
UPDATE control_obra.gastos SET monto_pagado = monto_neto WHERE estatus_pago = 'Pagado' AND monto_pagado = 0;
-- Todo lo histórico se considera aprobado
UPDATE control_obra.gastos SET aprobado_at = COALESCE(aprobado_at, created_at) WHERE aprobado_at IS NULL;

-- 3) Estado de pago derivado de monto_pagado, compatible con la UI que aún escribe estatus_pago
CREATE OR REPLACE FUNCTION control_obra.trg_gastos_estatus() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_total numeric; v_pagos numeric;
BEGIN
  v_total := COALESCE(NEW.monto_neto, 0);
  IF NEW.destino = 'obra' AND NEW.obra_id IS NULL THEN NEW.destino := 'indirecto'; END IF;
  IF NEW.destino <> 'socio' THEN NEW.socio_id := NULL; END IF;
  IF NEW.destino = 'socio' THEN NEW.obra_id := NULL; END IF;
  IF NEW.subtotal IS NULL THEN
    NEW.subtotal := CASE WHEN NEW.tipo_comprobante = 'Fiscal' THEN round(v_total / 1.16, 2) ELSE v_total END;
    NEW.iva := v_total - NEW.subtotal;
  END IF;
  -- La UI marcó "Pagado" sin pagos explícitos: se toma como pagado en su totalidad
  IF NEW.estatus_pago = 'Pagado' AND COALESCE(NEW.monto_pagado, 0) < v_total
     AND (TG_OP = 'INSERT' OR NEW.estatus_pago IS DISTINCT FROM OLD.estatus_pago) THEN
    NEW.monto_pagado := v_total;
  END IF;
  -- La UI regresó a "Pendiente" y no hay pagos registrados: se limpia lo pagado
  IF TG_OP = 'UPDATE' AND NEW.estatus_pago = 'Pendiente' AND OLD.estatus_pago IS DISTINCT FROM 'Pendiente' THEN
    SELECT COALESCE(SUM(monto), 0) INTO v_pagos FROM control_obra.pagos_proveedores WHERE gasto_id = NEW.id;
    IF v_pagos = 0 THEN NEW.monto_pagado := 0; END IF;
  END IF;
  IF NEW.estatus_pago IS DISTINCT FROM 'Rechazado' THEN
    NEW.estatus_pago := CASE WHEN COALESCE(NEW.monto_pagado, 0) <= 0 THEN 'Pendiente'
                             WHEN NEW.monto_pagado + 0.005 < v_total THEN 'Parcial'
                             ELSE 'Pagado' END;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_gastos_estatus ON control_obra.gastos;
CREATE TRIGGER trg_gastos_estatus BEFORE INSERT OR UPDATE ON control_obra.gastos
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_gastos_estatus();

-- 4) Vista pública con las columnas nuevas
CREATE OR REPLACE VIEW public.gastos WITH (security_invoker = true) AS
  SELECT id, obra_id, fecha_solicitud, orden_compra, estatus_pago, tipo_comprobante, categoria, monto_neto,
         proveedor_id, solicitante, comentarios, estatus_entrega, factura_numero, created_at, updated_at,
         orden_compra_id, folio_fiscal, descripcion, empresa_id,
         destino, socio_id, subtotal, iva, comprobacion, comprobante_url, fecha_vencimiento, monto_pagado,
         partida, aprobado_por, aprobado_at, factura_solicitada_at, conciliado_at
  FROM control_obra.gastos;

-- 5) crear_gasto acepta los campos nuevos (con default, la llamada actual sigue funcionando)
DROP FUNCTION IF EXISTS public.crear_gasto(uuid,integer,date,text,text,text,text,numeric,integer,text,text,text,text,integer,text,text);
CREATE OR REPLACE FUNCTION public.crear_gasto(
  p_user_id uuid, p_obra_id integer, p_fecha_solicitud date,
  p_orden_compra text DEFAULT NULL, p_estatus_pago text DEFAULT 'Pendiente', p_tipo_comprobante text DEFAULT NULL,
  p_categoria text DEFAULT NULL, p_monto_neto numeric DEFAULT 0, p_proveedor_id integer DEFAULT NULL,
  p_solicitante text DEFAULT NULL, p_comentarios text DEFAULT NULL, p_estatus_entrega text DEFAULT NULL,
  p_factura_numero text DEFAULT NULL, p_orden_compra_id integer DEFAULT NULL, p_folio_fiscal text DEFAULT NULL,
  p_descripcion text DEFAULT NULL,
  p_destino text DEFAULT NULL, p_socio_id integer DEFAULT NULL, p_subtotal numeric DEFAULT NULL, p_iva numeric DEFAULT NULL,
  p_comprobacion text DEFAULT NULL, p_comprobante_url text DEFAULT NULL, p_fecha_vencimiento date DEFAULT NULL,
  p_partida text DEFAULT NULL, p_aprobado boolean DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_empresa_id integer; v_gasto_id integer; v_nivel integer; v_destino text; v_aprobado_at timestamptz;
BEGIN
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
  -- Aprobación: explícita, o automática cuando el monto no excede el límite del rol (50k < 50, 200k < 80, sin límite >= 80)
  IF p_aprobado IS TRUE OR (p_aprobado IS NULL AND (v_nivel >= 80 OR (v_nivel >= 50 AND p_monto_neto <= 200000) OR p_monto_neto <= 50000)) THEN
    v_aprobado_at := NOW();
  END IF;
  INSERT INTO control_obra.gastos (
    obra_id, fecha_solicitud, orden_compra, estatus_pago, tipo_comprobante, categoria, monto_neto, proveedor_id,
    solicitante, comentarios, estatus_entrega, factura_numero, orden_compra_id, folio_fiscal, descripcion, empresa_id,
    destino, socio_id, subtotal, iva, comprobacion, comprobante_url, fecha_vencimiento, partida,
    aprobado_por, aprobado_at, created_at, updated_at
  ) VALUES (
    CASE WHEN v_destino = 'obra' THEN p_obra_id ELSE NULL END, p_fecha_solicitud, p_orden_compra, p_estatus_pago, p_tipo_comprobante, p_categoria, p_monto_neto, p_proveedor_id,
    p_solicitante, p_comentarios, p_estatus_entrega, p_factura_numero, p_orden_compra_id, p_folio_fiscal, p_descripcion, v_empresa_id,
    v_destino, CASE WHEN v_destino = 'socio' THEN p_socio_id END, p_subtotal, p_iva,
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

-- 6) load_all_data_seguro devuelve socios/movimientos_socio (sólo nivel >= 100) y categorias_gasto
CREATE OR REPLACE FUNCTION public.load_all_data_seguro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'control_obra', 'public', 'extensions' AS $function$
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
        'gastos', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (
            SELECT g.id, g.obra_id, g.fecha_solicitud, g.orden_compra, g.estatus_pago, g.tipo_comprobante, g.categoria, g.monto_neto,
                   CASE WHEN g.destino = 'socio' AND v_user.nivel < 100 THEN NULL ELSE g.proveedor_id END AS proveedor_id,
                   g.solicitante,
                   CASE WHEN g.destino = 'socio' AND v_user.nivel < 100 THEN NULL ELSE g.comentarios END AS comentarios,
                   g.estatus_entrega, g.factura_numero, g.created_at, g.updated_at, g.orden_compra_id, g.folio_fiscal,
                   CASE WHEN g.destino = 'socio' AND v_user.nivel < 100 THEN 'Retiro de socio' ELSE g.descripcion END AS descripcion,
                   g.empresa_id, g.destino, g.socio_id, g.subtotal, g.iva, g.comprobacion,
                   CASE WHEN g.destino = 'socio' AND v_user.nivel < 100 THEN NULL ELSE g.comprobante_url END AS comprobante_url,
                   g.fecha_vencimiento, g.monto_pagado, g.partida, g.aprobado_por, g.aprobado_at, g.factura_solicitada_at, g.conciliado_at
            FROM control_obra.gastos g WHERE g.empresa_id = v_user.empresa_id ORDER BY g.fecha_solicitud DESC) t), '[]'::jsonb),
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
        'categorias_gasto', COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.categorias_gasto WHERE empresa_id = v_user.empresa_id OR empresa_id IS NULL ORDER BY nombre) t), '[]'::jsonb),
        'socios', CASE WHEN v_user.nivel >= 100 THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.socios WHERE empresa_id = v_user.empresa_id ORDER BY nombre) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'movimientos_socio', CASE WHEN v_user.nivel >= 100 THEN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb) FROM (SELECT * FROM control_obra.movimientos_socio WHERE empresa_id = v_user.empresa_id ORDER BY fecha DESC) t), '[]'::jsonb) ELSE '[]'::jsonb END,
        'loaded_at', NOW()
    );
    RETURN v_result;
END;
$function$;

-- 7) Bucket privado de comprobantes (tickets, XML, PDF); ruta empresa/<id>/...
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('comprobantes', 'comprobantes', false, 10485760, ARRAY['image/jpeg','image/png','image/webp','application/pdf','application/xml','text/xml','application/zip'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS comprobantes_select ON storage.objects;
CREATE POLICY comprobantes_select ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'comprobantes' AND (storage.foldername(name))[2] = public.get_session_empresa_id()::text);
DROP POLICY IF EXISTS comprobantes_insert ON storage.objects;
CREATE POLICY comprobantes_insert ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'comprobantes' AND (storage.foldername(name))[2] = public.get_session_empresa_id()::text);
DROP POLICY IF EXISTS comprobantes_delete ON storage.objects;
CREATE POLICY comprobantes_delete ON storage.objects FOR DELETE TO anon, authenticated
  USING (bucket_id = 'comprobantes' AND (storage.foldername(name))[2] = public.get_session_empresa_id()::text);
