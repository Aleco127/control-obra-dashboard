-- 010: Vincular obras con clientes (obras.cliente_id)
-- Contexto: obras.cliente era texto libre; la tabla clientes existía sin relación.
-- Las tablas reales viven en el esquema control_obra y se exponen como vistas en public
-- con lista explícita de columnas, por eso hay que recrear la vista.

-- 1) Columna + FK
ALTER TABLE control_obra.obras
  ADD COLUMN IF NOT EXISTS cliente_id bigint REFERENCES control_obra.clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_obras_cliente_id ON control_obra.obras(cliente_id);

-- 2) Backfill: empareja obras.cliente con clientes.nombre por igualdad normalizada
--    (sin acentos, minúsculas, espacios colapsados) dentro de la misma empresa.
CREATE EXTENSION IF NOT EXISTS unaccent;

UPDATE control_obra.obras o
SET cliente_id = c.id
FROM control_obra.clientes c
WHERE o.cliente_id IS NULL
  AND o.cliente IS NOT NULL
  AND c.empresa_id = o.empresa_id
  AND regexp_replace(lower(unaccent(split_part(o.cliente, ' — ', 1))), '\s+', ' ', 'g')
    = regexp_replace(lower(unaccent(c.nombre)), '\s+', ' ', 'g');

-- 3) Vista pública con la nueva columna (la vista original enumeraba columnas)
CREATE OR REPLACE VIEW public.obras AS
 SELECT id, codigo_obra, nombre_obra, presupuesto_total, estatus, fecha_inicio,
        fecha_fin_estimada, responsable, ubicacion, descripcion, avance_porcentaje,
        created_at, updated_at, cliente, porcentaje_iva, es_zona_frontera, subtotal,
        monto_iva, empresa_id, cliente_id
   FROM control_obra.obras;

-- 4) crear_obra acepta p_cliente_id (se reemplaza para evitar sobrecargas ambiguas en PostgREST)
DROP FUNCTION IF EXISTS public.crear_obra(uuid, text, text, numeric, text, date, date, text, text, text, text, numeric, boolean);

CREATE OR REPLACE FUNCTION public.crear_obra(
  p_user_id uuid, p_codigo_obra text, p_nombre_obra text,
  p_presupuesto_total numeric DEFAULT 0, p_estatus text DEFAULT 'En Proceso',
  p_fecha_inicio date DEFAULT NULL, p_fecha_fin_estimada date DEFAULT NULL,
  p_responsable text DEFAULT NULL, p_ubicacion text DEFAULT NULL, p_descripcion text DEFAULT NULL,
  p_cliente text DEFAULT NULL, p_porcentaje_iva numeric DEFAULT 16, p_es_zona_frontera boolean DEFAULT false,
  p_cliente_id bigint DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id INTEGER;
  v_obra_id INTEGER;
  v_cliente text := p_cliente;
BEGIN
  SELECT empresa_id INTO v_empresa_id FROM obra_usuarios WHERE id = p_user_id AND activo = true;
  IF v_empresa_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Usuario no válido o sin empresa asignada');
  END IF;
  -- Si viene cliente_id y no viene nombre, se toma del catálogo (misma empresa)
  IF p_cliente_id IS NOT NULL THEN
    SELECT COALESCE(v_cliente, nombre) INTO v_cliente FROM control_obra.clientes WHERE id = p_cliente_id AND empresa_id = v_empresa_id;
  END IF;
  INSERT INTO control_obra.obras (
    codigo_obra, nombre_obra, presupuesto_total, estatus, fecha_inicio, fecha_fin_estimada,
    responsable, ubicacion, descripcion, cliente, cliente_id, porcentaje_iva, es_zona_frontera,
    empresa_id, avance_porcentaje, created_at, updated_at
  ) VALUES (
    p_codigo_obra, p_nombre_obra, p_presupuesto_total, p_estatus, p_fecha_inicio, p_fecha_fin_estimada,
    p_responsable, p_ubicacion, p_descripcion, v_cliente, p_cliente_id, p_porcentaje_iva, p_es_zona_frontera,
    v_empresa_id, 0, NOW(), NOW()
  ) RETURNING id INTO v_obra_id;
  RETURN json_build_object('success', true, 'obra_id', v_obra_id, 'empresa_id', v_empresa_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.crear_obra(uuid, text, text, numeric, text, date, date, text, text, text, text, numeric, boolean, bigint) TO anon, authenticated;
