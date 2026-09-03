-- 053: avance manual de obra
-- Cuando avance_manual = true, la app NO recalcula obras.avance_porcentaje a partir de las
-- actividades del programa (autoSyncAllAvances / recalcAvanceObra). Se activa desde el botón
-- "Avance" del listado de obras.

ALTER TABLE control_obra.obras
  ADD COLUMN IF NOT EXISTS avance_manual boolean NOT NULL DEFAULT false;

-- La vista public.obras tiene lista explícita de columnas: se recrea agregando la nueva al final.
CREATE OR REPLACE VIEW public.obras WITH (security_invoker = true) AS
SELECT id,
    codigo_obra,
    nombre_obra,
    presupuesto_total,
    estatus,
    fecha_inicio,
    fecha_fin_estimada,
    responsable,
    ubicacion,
    descripcion,
    avance_porcentaje,
    created_at,
    updated_at,
    cliente,
    porcentaje_iva,
    es_zona_frontera,
    subtotal,
    monto_iva,
    empresa_id,
    cliente_id,
    tipo_proyecto,
    es_ejemplo,
    avance_manual
FROM control_obra.obras;
