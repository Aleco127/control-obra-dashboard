-- 012: tipo de proyecto en obras (Proyecto arquitectónico | Obra | Remodelación | Otro)
-- Recordatorio: las vistas public.* enumeran columnas; hay que recrearlas al agregar una.
ALTER TABLE control_obra.obras ADD COLUMN IF NOT EXISTS tipo_proyecto text;

CREATE OR REPLACE VIEW public.obras AS
 SELECT id, codigo_obra, nombre_obra, presupuesto_total, estatus, fecha_inicio,
        fecha_fin_estimada, responsable, ubicacion, descripcion, avance_porcentaje,
        created_at, updated_at, cliente, porcentaje_iva, es_zona_frontera, subtotal,
        monto_iva, empresa_id, cliente_id, tipo_proyecto
   FROM control_obra.obras;

-- Backfill de los proyectos conocidos
UPDATE control_obra.obras SET tipo_proyecto = 'Proyecto arquitectónico' WHERE tipo_proyecto IS NULL AND codigo_obra IN ('ALTOZANO-PH');
UPDATE control_obra.obras SET tipo_proyecto = 'Remodelación' WHERE tipo_proyecto IS NULL AND codigo_obra IN ('LL-LS-01');
