-- 019/020: Cuentas por pagar derivadas de gastos, numeración PP-xxxxx y recálculo de monto_pagado (US-110, US-111)
INSERT INTO control_obra.categorias_gasto (nombre, color, empresa_id, naturaleza, deducible, orden)
SELECT 'Viáticos y alimentos', '#f59e0b', e.id, 'directo', true, 65
FROM (SELECT DISTINCT COALESCE(empresa_id, 1) AS id FROM control_obra.categorias_gasto UNION SELECT 1) e
WHERE NOT EXISTS (SELECT 1 FROM control_obra.categorias_gasto c WHERE lower(c.nombre) = 'viáticos y alimentos' AND (c.empresa_id = e.id OR c.empresa_id IS NULL));

ALTER TABLE control_obra.proveedores ADD COLUMN IF NOT EXISTS dias_credito integer NOT NULL DEFAULT 0;
CREATE OR REPLACE VIEW public.proveedores WITH (security_invoker = true) AS
  SELECT id, nombre_proveedor, rfc, contacto, telefono, email, direccion, tipo, estatus, created_at, updated_at,
         razon_social, regimen_fiscal, codigo_postal, uso_cfdi, banco, cuenta_bancaria, clabe, titular_cuenta, notas,
         ciudad, estado, empresa_id, dias_credito
  FROM control_obra.proveedores;

-- Vencimiento por defecto: fecha del gasto + días de crédito del proveedor (o 30)
CREATE OR REPLACE VIEW public.cuentas_por_pagar WITH (security_invoker = true) AS
  SELECT g.id AS gasto_id, g.empresa_id, g.obra_id, g.proveedor_id, g.destino, g.descripcion, g.categoria,
         g.fecha_solicitud, g.monto_neto AS total, g.monto_pagado, (g.monto_neto - g.monto_pagado) AS saldo,
         COALESCE(g.fecha_vencimiento, g.fecha_solicitud + COALESCE(p.dias_credito, 30)) AS vence,
         CASE WHEN COALESCE(g.fecha_vencimiento, g.fecha_solicitud + COALESCE(p.dias_credito, 30)) < CURRENT_DATE THEN 'vencida'
              WHEN COALESCE(g.fecha_vencimiento, g.fecha_solicitud + COALESCE(p.dias_credito, 30)) <= CURRENT_DATE + 7 THEN 'semana'
              ELSE 'por_vencer' END AS bucket
  FROM control_obra.gastos g LEFT JOIN control_obra.proveedores p ON p.id = g.proveedor_id
  WHERE g.monto_neto - g.monto_pagado > 0.005 AND g.estatus_pago <> 'Rechazado' AND g.destino <> 'socio';
GRANT SELECT ON public.cuentas_por_pagar TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_next_pago_proveedor_numero()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE next_val integer;
BEGIN
  SELECT nextval('pagos_proveedores_seq') INTO next_val;
  RETURN 'PP-' || LPAD(next_val::text, 5, '0');
END; $$;

-- Recalcular monto_pagado del gasto con cada pago (insert/update/delete)
CREATE OR REPLACE FUNCTION control_obra.trg_pagos_proveedores_recalc() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_gasto integer; v_sum numeric;
BEGIN
  v_gasto := COALESCE(NEW.gasto_id, OLD.gasto_id);
  IF v_gasto IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT COALESCE(SUM(monto), 0) INTO v_sum FROM control_obra.pagos_proveedores WHERE gasto_id = v_gasto;
  UPDATE control_obra.gastos SET monto_pagado = v_sum,
         estatus_pago = CASE WHEN v_sum <= 0 THEN 'Pendiente' WHEN v_sum + 0.005 < monto_neto THEN 'Parcial' ELSE 'Pagado' END,
         updated_at = now()
   WHERE id = v_gasto;
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS trg_pagos_proveedores_recalc ON control_obra.pagos_proveedores;
CREATE TRIGGER trg_pagos_proveedores_recalc AFTER INSERT OR UPDATE OR DELETE ON control_obra.pagos_proveedores
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_pagos_proveedores_recalc();

ALTER TABLE control_obra.pagos_proveedores ADD COLUMN IF NOT EXISTS conciliado_at timestamptz NULL;
ALTER TABLE control_obra.pagos_recibidos ADD COLUMN IF NOT EXISTS conciliado_at timestamptz NULL;
CREATE OR REPLACE VIEW public.pagos_proveedores WITH (security_invoker = true) AS
  SELECT id, empresa_id, obra_id, gasto_id, orden_compra_id, proveedor_id, numero_pago, fecha_pago, monto, metodo_pago,
         referencia, banco, concepto, notas, created_by, created_at, updated_at, conciliado_at
  FROM control_obra.pagos_proveedores;
CREATE OR REPLACE VIEW public.pagos_recibidos WITH (security_invoker = true) AS
  SELECT id, empresa_id, obra_id, estimacion_id, cuenta_cobrar_id, numero_pago, fecha_pago, monto, metodo_pago,
         referencia, banco, factura_numero, concepto, notas, created_by, created_at, updated_at, conciliado_at
  FROM control_obra.pagos_recibidos;

ALTER TABLE control_obra.pagos_proveedores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ppv_select ON control_obra.pagos_proveedores;
CREATE POLICY ppv_select ON control_obra.pagos_proveedores FOR SELECT USING (empresa_id = control_obra.get_session_empresa_id());
DROP POLICY IF EXISTS ppv_insert ON control_obra.pagos_proveedores;
CREATE POLICY ppv_insert ON control_obra.pagos_proveedores FOR INSERT WITH CHECK (empresa_id = control_obra.get_session_empresa_id());
DROP POLICY IF EXISTS ppv_update ON control_obra.pagos_proveedores;
CREATE POLICY ppv_update ON control_obra.pagos_proveedores FOR UPDATE USING (empresa_id = control_obra.get_session_empresa_id());
DROP POLICY IF EXISTS ppv_delete ON control_obra.pagos_proveedores;
CREATE POLICY ppv_delete ON control_obra.pagos_proveedores FOR DELETE USING (empresa_id = control_obra.get_session_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.pagos_proveedores TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.pagos_proveedores_id_seq TO anon, authenticated;
