-- 067: gastos.estatus_pago admite 'Parcial' y 'Rechazado'.
-- trg_pagos_proveedores_recalc / trg_gastos_estatus (fase 2) y la app (Compras.rechazar, abonos) ya escriben
-- esos valores, pero el CHECK original sólo permitía Pagado/Pendiente/Cancelado: todo pago parcial y todo
-- rechazo fallaban con gastos_estatus_pago_check (se detectó al probar la migración 066).
ALTER TABLE control_obra.gastos DROP CONSTRAINT gastos_estatus_pago_check;
ALTER TABLE control_obra.gastos ADD CONSTRAINT gastos_estatus_pago_check
  CHECK (estatus_pago = ANY (ARRAY['Pagado', 'Pendiente', 'Parcial', 'Rechazado', 'Cancelado']));
