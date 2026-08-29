-- 018: "Pagado por el socio" en gastos + sincronización automática con movimientos_socio (US-103, US-126)
-- Hallazgo: los socios estaban dados de alta como proveedores, pero los 63 gastos ligados a ellos son
-- compras de obra que el socio pagó de su bolsa (gasolina, DRO, comida de cuadrilla): aportaciones, no honorarios.
ALTER TABLE control_obra.gastos
  ADD COLUMN IF NOT EXISTS pagado_por_socio_id integer NULL REFERENCES control_obra.socios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_gastos_pagado_por_socio ON control_obra.gastos(pagado_por_socio_id);

-- 1) Trigger: destino='socio' genera un movimiento gasto_personal; pagado_por_socio_id genera una aportación
CREATE OR REPLACE FUNCTION control_obra.trg_gasto_socio_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_concepto text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM control_obra.movimientos_socio WHERE gasto_id = OLD.id;
    RETURN OLD;
  END IF;
  v_concepto := COALESCE(NULLIF(NEW.descripcion,''), NULLIF(NEW.comentarios,''), NEW.categoria, 'Gasto');
  DELETE FROM control_obra.movimientos_socio
   WHERE gasto_id = NEW.id AND tipo = 'gasto_personal' AND (NEW.destino <> 'socio' OR NEW.socio_id IS NULL OR socio_id <> NEW.socio_id);
  IF NEW.destino = 'socio' AND NEW.socio_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM control_obra.movimientos_socio WHERE gasto_id = NEW.id AND tipo = 'gasto_personal') THEN
      UPDATE control_obra.movimientos_socio SET fecha = NEW.fecha_solicitud, monto = NEW.monto_neto, concepto = v_concepto, updated_at = now()
       WHERE gasto_id = NEW.id AND tipo = 'gasto_personal';
    ELSE
      INSERT INTO control_obra.movimientos_socio (empresa_id, socio_id, tipo, fecha, monto, gasto_id, concepto)
      VALUES (NEW.empresa_id, NEW.socio_id, 'gasto_personal', NEW.fecha_solicitud, NEW.monto_neto, NEW.id, v_concepto);
    END IF;
  END IF;
  DELETE FROM control_obra.movimientos_socio
   WHERE gasto_id = NEW.id AND tipo = 'aportacion'
     AND (NEW.pagado_por_socio_id IS NULL OR socio_id <> NEW.pagado_por_socio_id OR (NEW.destino = 'socio' AND NEW.socio_id = NEW.pagado_por_socio_id));
  IF NEW.pagado_por_socio_id IS NOT NULL AND NOT (NEW.destino = 'socio' AND NEW.socio_id = NEW.pagado_por_socio_id) THEN
    IF EXISTS (SELECT 1 FROM control_obra.movimientos_socio WHERE gasto_id = NEW.id AND tipo = 'aportacion') THEN
      UPDATE control_obra.movimientos_socio SET fecha = NEW.fecha_solicitud, monto = NEW.monto_neto, concepto = 'Pagó: ' || v_concepto, updated_at = now()
       WHERE gasto_id = NEW.id AND tipo = 'aportacion';
    ELSE
      INSERT INTO control_obra.movimientos_socio (empresa_id, socio_id, tipo, fecha, monto, gasto_id, concepto)
      VALUES (NEW.empresa_id, NEW.pagado_por_socio_id, 'aportacion', NEW.fecha_solicitud, NEW.monto_neto, NEW.id, 'Pagó: ' || v_concepto);
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_gasto_socio_sync ON control_obra.gastos;
CREATE TRIGGER trg_gasto_socio_sync AFTER INSERT OR UPDATE OR DELETE ON control_obra.gastos
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_gasto_socio_sync();

-- 2) Datos Supernova: proveedor-socio -> pagado_por_socio_id; el proveedor queda inactivo
UPDATE control_obra.gastos g
SET pagado_por_socio_id = s.id, proveedor_id = NULL, updated_at = now()
FROM control_obra.proveedores p
JOIN control_obra.socios s ON s.empresa_id = p.empresa_id
 AND ((p.nombre_proveedor ILIKE 'Ricardo Alejandro Corral%' AND s.nombre = 'Ricardo Corral')
   OR (p.nombre_proveedor ILIKE 'Daniel Fernando Loera%' AND s.nombre = 'Daniel Loera'))
WHERE g.proveedor_id = p.id AND g.pagado_por_socio_id IS NULL;

UPDATE control_obra.proveedores
SET estatus = 'Inactivo', notas = COALESCE(notas,'') || ' [Es socio: desde la migración 018 los gastos que paga se registran como "pagado por el socio"]', updated_at = now()
WHERE (nombre_proveedor ILIKE 'Ricardo Alejandro Corral%' OR nombre_proveedor ILIKE 'Daniel Fernando Loera%') AND empresa_id = 1;

-- 3) Vista pública
CREATE OR REPLACE VIEW public.gastos WITH (security_invoker = true) AS
  SELECT id, obra_id, fecha_solicitud, orden_compra, estatus_pago, tipo_comprobante, categoria, monto_neto,
         proveedor_id, solicitante, comentarios, estatus_entrega, factura_numero, created_at, updated_at,
         orden_compra_id, folio_fiscal, descripcion, empresa_id,
         destino, socio_id, subtotal, iva, comprobacion, comprobante_url, fecha_vencimiento, monto_pagado,
         partida, aprobado_por, aprobado_at, factura_solicitada_at, conciliado_at, pagado_por_socio_id
  FROM control_obra.gastos;

-- 4) load_all_data_seguro: el elemento 'gastos' pasa a to_jsonb(g) || máscara (las columnas nuevas fluyen solas).
--    Máscara para nivel < 100 cuando destino='socio': descripcion 'Retiro de socio', comentarios/proveedor_id/comprobante_url en NULL.
--    (El cuerpo completo de la función se aplicó con esta migración; ver 015 para el resto de elementos.)
