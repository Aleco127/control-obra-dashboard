-- 066: la reposición de un gasto que un socio pagó de su bolsa compensa su aportación.
-- Movimiento nuevo `reposicion` (signo −1 en la cuenta corriente), uno por gasto, con monto = lo ya repuesto
-- (monto_pagado, tope monto_neto). Lo mantiene trg_gasto_socio_sync, así que cubre el abono parcial
-- (pagos_proveedores → monto_pagado), el viejo «Marcar repuesto» y el cambio de estado a mano.
-- Fecha: el último pago registrado; sin pagos, la que ya tenía o hoy (hora de México).

ALTER TABLE control_obra.movimientos_socio DROP CONSTRAINT movimientos_socio_tipo_check;
ALTER TABLE control_obra.movimientos_socio ADD CONSTRAINT movimientos_socio_tipo_check
  CHECK (tipo = ANY (ARRAY['aportacion', 'retiro', 'gasto_personal', 'anticipo_utilidad', 'utilidad_asignada', 'utilidad_pagada', 'ajuste', 'reposicion']));

CREATE OR REPLACE FUNCTION control_obra.trg_gasto_socio_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'control_obra', 'public'
AS $function$
DECLARE v_concepto text; v_tipo text; v_obra integer; v_aporta boolean; v_repuesto numeric; v_fecha date; v_metodo text; v_ref text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM control_obra.movimientos_socio WHERE gasto_id = OLD.id;
    RETURN OLD;
  END IF;
  v_concepto := COALESCE(NULLIF(NEW.descripcion,''), NULLIF(NEW.comentarios,''), NEW.categoria, 'Gasto');
  v_tipo := CASE WHEN NEW.socio_tipo = 'utilidad' THEN 'anticipo_utilidad' ELSE 'gasto_personal' END;
  v_obra := CASE WHEN NEW.socio_tipo = 'utilidad' THEN NEW.obra_id END;
  DELETE FROM control_obra.movimientos_socio
   WHERE gasto_id = NEW.id AND tipo IN ('gasto_personal', 'anticipo_utilidad')
     AND (NEW.destino <> 'socio' OR NEW.socio_id IS NULL OR socio_id <> NEW.socio_id OR tipo <> v_tipo);
  IF NEW.destino = 'socio' AND NEW.socio_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM control_obra.movimientos_socio WHERE gasto_id = NEW.id AND tipo = v_tipo) THEN
      UPDATE control_obra.movimientos_socio SET fecha = NEW.fecha_solicitud, monto = NEW.monto_neto, concepto = v_concepto, obra_id = v_obra, updated_at = now()
       WHERE gasto_id = NEW.id AND tipo = v_tipo;
    ELSE
      INSERT INTO control_obra.movimientos_socio (empresa_id, socio_id, tipo, fecha, monto, gasto_id, concepto, obra_id)
      VALUES (NEW.empresa_id, NEW.socio_id, v_tipo, NEW.fecha_solicitud, NEW.monto_neto, NEW.id, v_concepto, v_obra);
    END IF;
  END IF;
  v_aporta := NEW.pagado_por_socio_id IS NOT NULL AND NOT (NEW.destino = 'socio' AND NEW.socio_id = NEW.pagado_por_socio_id);
  DELETE FROM control_obra.movimientos_socio
   WHERE gasto_id = NEW.id AND tipo = 'aportacion'
     AND (NEW.pagado_por_socio_id IS NULL OR socio_id <> NEW.pagado_por_socio_id OR (NEW.destino = 'socio' AND NEW.socio_id = NEW.pagado_por_socio_id));
  IF v_aporta THEN
    IF EXISTS (SELECT 1 FROM control_obra.movimientos_socio WHERE gasto_id = NEW.id AND tipo = 'aportacion') THEN
      UPDATE control_obra.movimientos_socio SET fecha = NEW.fecha_solicitud, monto = NEW.monto_neto, concepto = 'Pagó: ' || v_concepto, updated_at = now()
       WHERE gasto_id = NEW.id AND tipo = 'aportacion';
    ELSE
      INSERT INTO control_obra.movimientos_socio (empresa_id, socio_id, tipo, fecha, monto, gasto_id, concepto)
      VALUES (NEW.empresa_id, NEW.pagado_por_socio_id, 'aportacion', NEW.fecha_solicitud, NEW.monto_neto, NEW.id, 'Pagó: ' || v_concepto);
    END IF;
  END IF;
  -- Reposición: lo que la empresa ya le devolvió al socio por este gasto
  v_repuesto := CASE WHEN v_aporta AND NEW.estatus_pago IS DISTINCT FROM 'Rechazado'
                     THEN LEAST(COALESCE(NEW.monto_pagado, 0), COALESCE(NEW.monto_neto, 0)) ELSE 0 END;
  IF v_repuesto <= 0.005 THEN
    DELETE FROM control_obra.movimientos_socio WHERE gasto_id = NEW.id AND tipo = 'reposicion';
  ELSE
    SELECT p.fecha_pago, p.metodo_pago, COALESCE(p.referencia, p.numero_pago) INTO v_fecha, v_metodo, v_ref
      FROM control_obra.pagos_proveedores p WHERE p.gasto_id = NEW.id ORDER BY p.fecha_pago DESC, p.id DESC LIMIT 1;
    IF EXISTS (SELECT 1 FROM control_obra.movimientos_socio WHERE gasto_id = NEW.id AND tipo = 'reposicion') THEN
      UPDATE control_obra.movimientos_socio
         SET socio_id = NEW.pagado_por_socio_id, monto = v_repuesto, fecha = COALESCE(v_fecha, fecha),
             metodo_pago = COALESCE(v_metodo, metodo_pago), referencia = COALESCE(v_ref, referencia),
             concepto = 'Reposición: ' || v_concepto, updated_at = now()
       WHERE gasto_id = NEW.id AND tipo = 'reposicion'
         AND (socio_id, monto, fecha, concepto) IS DISTINCT FROM (NEW.pagado_por_socio_id, v_repuesto, COALESCE(v_fecha, fecha), 'Reposición: ' || v_concepto);
    ELSE
      INSERT INTO control_obra.movimientos_socio (empresa_id, socio_id, tipo, fecha, monto, gasto_id, concepto, metodo_pago, referencia)
      VALUES (NEW.empresa_id, NEW.pagado_por_socio_id, 'reposicion', COALESCE(v_fecha, (now() AT TIME ZONE 'America/Mexico_City')::date),
              v_repuesto, NEW.id, 'Reposición: ' || v_concepto, v_metodo, v_ref);
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- Respaldo histórico: gastos ya repuestos antes de esta migración (casi todos con el viejo «Marcar repuesto»).
-- Fecha = último pago; si no hay, el momento en que pasó a Pagado según audit_log; si tampoco, la fecha del gasto.
INSERT INTO control_obra.movimientos_socio (empresa_id, socio_id, tipo, fecha, monto, gasto_id, concepto, metodo_pago, referencia, notas)
SELECT g.empresa_id, g.pagado_por_socio_id, 'reposicion',
       COALESCE(
         (SELECT max(p.fecha_pago) FROM control_obra.pagos_proveedores p WHERE p.gasto_id = g.id),
         (SELECT (max(a.created_at) AT TIME ZONE 'America/Mexico_City')::date FROM control_obra.audit_log a
           WHERE a.table_name = 'gastos' AND a.action = 'UPDATE' AND a.record_id = g.id::text
             AND a.new_data->>'estatus_pago' = 'Pagado' AND a.old_data->>'estatus_pago' IS DISTINCT FROM 'Pagado'),
         g.fecha_solicitud),
       LEAST(g.monto_pagado, g.monto_neto), g.id,
       'Reposición: ' || COALESCE(NULLIF(g.descripcion,''), NULLIF(g.comentarios,''), g.categoria, 'Gasto'),
       NULL, NULL, 'Reposición anterior a la migración 066'
  FROM control_obra.gastos g
 WHERE g.pagado_por_socio_id IS NOT NULL
   AND NOT (g.destino = 'socio' AND g.socio_id = g.pagado_por_socio_id)
   AND g.estatus_pago IS DISTINCT FROM 'Rechazado'
   AND COALESCE(g.monto_pagado, 0) > 0.005
   AND NOT EXISTS (SELECT 1 FROM control_obra.movimientos_socio m WHERE m.gasto_id = g.id AND m.tipo = 'reposicion');
