-- 016: Migrar la "obra" DANIELOERA (gastos personales de un socio) a movimientos de socio (US-103)
-- Antes (29-ago-2026): obra 'Gastos personales Daniel' con 5 gastos Pendiente ($8,559); socio Daniel Loera dado de alta en 014.
-- Respaldo previo: control_obra._bak_20260829_gastos / _obras / _proveedores / _gad / _categorias_gasto
INSERT INTO control_obra.movimientos_socio (empresa_id, socio_id, tipo, fecha, monto, gasto_id, concepto, notas)
SELECT g.empresa_id, s.id, 'gasto_personal', g.fecha_solicitud, g.monto_neto, g.id,
       COALESCE(NULLIF(g.descripcion,''), NULLIF(g.comentarios,''), 'Gasto personal'),
       'Migrado desde la obra DANIELOERA (migración 016)'
FROM control_obra.gastos g
JOIN control_obra.obras o ON o.id = g.obra_id
JOIN control_obra.socios s ON s.empresa_id = g.empresa_id AND s.nombre = 'Daniel Loera'
WHERE o.codigo_obra = 'DANIELOERA'
  AND NOT EXISTS (SELECT 1 FROM control_obra.movimientos_socio m WHERE m.gasto_id = g.id);

UPDATE control_obra.gastos g
SET destino = 'socio', socio_id = s.id, obra_id = NULL, categoria = 'Gasto personal de socio', updated_at = now()
FROM control_obra.obras o, control_obra.socios s
WHERE o.id = g.obra_id AND o.codigo_obra = 'DANIELOERA'
  AND s.empresa_id = g.empresa_id AND s.nombre = 'Daniel Loera';

UPDATE control_obra.obras
SET estatus = 'Archivada',
    descripcion = COALESCE(descripcion, '') || ' [Archivada el 2026-08-29: sus gastos pasaron a la cuenta de socio de Daniel Loera]',
    updated_at = now()
WHERE codigo_obra = 'DANIELOERA' AND estatus <> 'Archivada';

-- Después: movimientos_socio tipo gasto_personal = 5; gastos destino='socio' = 5; obra DANIELOERA = Archivada
