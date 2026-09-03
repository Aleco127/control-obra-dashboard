-- 054: honorarios / anticipo de utilidad a un socio con cargo a una obra
-- Un gasto con destino='socio' puede ser:
--   socio_tipo='personal'  → gasto personal (lo que la empresa pagó por cuenta del socio; ya existía)
--   socio_tipo='utilidad'  → honorarios o anticipo de utilidad de UNA obra (obra_id). No es costo de la obra:
--                             sale de su utilidad y se descuenta al socio en el reparto de esa obra.
-- El trigger crea en movimientos_socio un 'anticipo_utilidad' con obra_id (o 'gasto_personal' si es personal).

ALTER TABLE control_obra.gastos ADD COLUMN IF NOT EXISTS socio_tipo text NOT NULL DEFAULT 'personal';
ALTER TABLE control_obra.gastos DROP CONSTRAINT IF EXISTS gastos_socio_tipo_check;
ALTER TABLE control_obra.gastos ADD CONSTRAINT gastos_socio_tipo_check CHECK (socio_tipo IN ('personal', 'utilidad'));

ALTER TABLE control_obra.movimientos_socio ADD COLUMN IF NOT EXISTS obra_id integer REFERENCES control_obra.obras(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_movimientos_socio_obra ON control_obra.movimientos_socio(obra_id);
DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'control_obra.movimientos_socio'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%tipo%' LOOP
    EXECUTE format('ALTER TABLE control_obra.movimientos_socio DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE control_obra.movimientos_socio ADD CONSTRAINT movimientos_socio_tipo_check
  CHECK (tipo IN ('aportacion', 'retiro', 'gasto_personal', 'anticipo_utilidad', 'utilidad_asignada', 'utilidad_pagada', 'ajuste'));

-- Vistas public con lista explícita de columnas: se agregan las nuevas al final
CREATE OR REPLACE VIEW public.gastos WITH (security_invoker = true) AS
SELECT id, obra_id, fecha_solicitud, orden_compra, estatus_pago, tipo_comprobante, categoria, monto_neto, proveedor_id,
    solicitante, comentarios, estatus_entrega, factura_numero, created_at, updated_at, orden_compra_id, folio_fiscal,
    descripcion, empresa_id, destino, socio_id, subtotal, iva, comprobacion, comprobante_url, fecha_vencimiento,
    monto_pagado, partida, aprobado_por, aprobado_at, factura_solicitada_at, conciliado_at, pagado_por_socio_id, socio_tipo
FROM control_obra.gastos;

CREATE OR REPLACE VIEW public.movimientos_socio WITH (security_invoker = true) AS
SELECT id, empresa_id, socio_id, tipo, fecha, monto, gasto_id, reparto_id, concepto, referencia, metodo_pago,
    comprobante_url, notas, created_by, created_at, updated_at, obra_id
FROM control_obra.movimientos_socio;

-- Trigger: gasto de socio → movimiento en su cuenta corriente (personal o anticipo de utilidad por obra)
CREATE OR REPLACE FUNCTION control_obra.trg_gasto_socio_sync()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'control_obra', 'public' AS $function$
DECLARE v_concepto text; v_tipo text; v_obra integer;
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
END; $function$;

-- crear_gasto: nuevo parámetro p_socio_tipo. Se elimina la firma anterior para que PostgREST no vea dos sobrecargas.
DROP FUNCTION IF EXISTS public.crear_gasto(uuid,integer,date,text,text,text,text,numeric,integer,text,text,text,text,integer,text,text,text,integer,numeric,numeric,text,text,date,text,boolean);
CREATE OR REPLACE FUNCTION public.crear_gasto(p_user_id uuid, p_obra_id integer, p_fecha_solicitud date, p_orden_compra text DEFAULT NULL::text, p_estatus_pago text DEFAULT 'Pendiente'::text, p_tipo_comprobante text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text, p_monto_neto numeric DEFAULT 0, p_proveedor_id integer DEFAULT NULL::integer, p_solicitante text DEFAULT NULL::text, p_comentarios text DEFAULT NULL::text, p_estatus_entrega text DEFAULT NULL::text, p_factura_numero text DEFAULT NULL::text, p_orden_compra_id integer DEFAULT NULL::integer, p_folio_fiscal text DEFAULT NULL::text, p_descripcion text DEFAULT NULL::text, p_destino text DEFAULT NULL::text, p_socio_id integer DEFAULT NULL::integer, p_subtotal numeric DEFAULT NULL::numeric, p_iva numeric DEFAULT NULL::numeric, p_comprobacion text DEFAULT NULL::text, p_comprobante_url text DEFAULT NULL::text, p_fecha_vencimiento date DEFAULT NULL::date, p_partida text DEFAULT NULL::text, p_aprobado boolean DEFAULT NULL::boolean, p_socio_tipo text DEFAULT 'personal'::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  v_obra_id := CASE WHEN v_destino = 'obra' OR v_socio_tipo = 'utilidad' THEN p_obra_id END;
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
GRANT EXECUTE ON FUNCTION public.crear_gasto(uuid,integer,date,text,text,text,text,numeric,integer,text,text,text,text,integer,text,text,text,integer,numeric,numeric,text,text,date,text,boolean,text) TO anon, authenticated, service_role;

-- Categoría "Honorarios de socio" (naturaleza personal: no es costo) en cada empresa que ya tiene la de gasto personal
INSERT INTO control_obra.categorias_gasto (nombre, descripcion, empresa_id, naturaleza, deducible, activa, orden)
SELECT 'Honorarios de socio', 'Honorarios o anticipo de utilidad a un socio con cargo a una obra', c.empresa_id, 'personal', false, true, COALESCE(c.orden, 0) + 1
FROM control_obra.categorias_gasto c
WHERE c.nombre = 'Gasto personal de socio'
  AND NOT EXISTS (SELECT 1 FROM control_obra.categorias_gasto x WHERE x.empresa_id = c.empresa_id AND x.nombre = 'Honorarios de socio');

-- trg_gastos_estatus (BEFORE) ponía obra_id = NULL en todo gasto de socio; ahora lo conserva cuando socio_tipo = 'utilidad'
CREATE OR REPLACE FUNCTION control_obra.trg_gastos_estatus()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'control_obra', 'public' AS $function$
DECLARE v_total numeric; v_pagos numeric;
BEGIN
  v_total := COALESCE(NEW.monto_neto, 0);
  IF NEW.destino = 'obra' AND NEW.obra_id IS NULL THEN NEW.destino := 'indirecto'; END IF;
  IF NEW.destino <> 'socio' THEN NEW.socio_id := NULL; NEW.socio_tipo := 'personal'; END IF;
  -- Un gasto de socio sólo conserva obra_id cuando son honorarios con cargo a la utilidad de esa obra
  IF NEW.destino = 'socio' AND COALESCE(NEW.socio_tipo, 'personal') <> 'utilidad' THEN NEW.obra_id := NULL; END IF;
  IF NEW.subtotal IS NULL THEN
    NEW.subtotal := CASE WHEN NEW.tipo_comprobante = 'Fiscal' THEN round(v_total / 1.16, 2) ELSE v_total END;
    NEW.iva := v_total - NEW.subtotal;
  END IF;
  IF NEW.estatus_pago = 'Pagado' AND COALESCE(NEW.monto_pagado, 0) < v_total
     AND (TG_OP = 'INSERT' OR NEW.estatus_pago IS DISTINCT FROM OLD.estatus_pago) THEN
    NEW.monto_pagado := v_total;
  END IF;
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
END; $function$;

-- Dato real (3-sep-2026): honorarios de Daniel Loera $5,000 con cargo a la utilidad de ALTOZANO-PH (obra 19), capturado como personal por error
UPDATE control_obra.gastos SET socio_tipo = 'utilidad', obra_id = 19, categoria = 'Honorarios de socio', updated_at = now()
 WHERE id = 374 AND empresa_id = 1 AND destino = 'socio' AND socio_id = 2 AND monto_neto = 5000;
