-- 099_insumo_sugerencias.sql (épica D: US-832) — Precios reales de compra desde las facturas (CFDI recibidos).
--
-- Al importar un CFDI recibido (cfdi.js › confirmar), la app llama a proponer_precios_cfdi() con sus conceptos: cada
-- concepto queda como SUGERENCIA en la bandeja «Por clasificar» del banco. Nada entra al banco sin pasar por ella
-- (US-832): clasificar_sugerencia() es la única que convierte una sugerencia en precio (fuente 'compra', con gasto y
-- proveedor). La decisión se recuerda por proveedor + descripción normalizada en insumo_sugerencia_reglas y la
-- siguiente factura del mismo proveedor llega ya PRE-LLENADA (sugerencia_accion / insumo_id), pero sigue pendiente
-- hasta que el usuario la confirme.
-- Precios SIN IVA: valorUnitario del CFDI ya viene sin impuestos (PRD §6). Sólo MXN.

CREATE TABLE IF NOT EXISTS control_obra.insumo_sugerencias (
  id                 bigserial PRIMARY KEY,
  empresa_id         integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                     REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  factura_id         integer NULL REFERENCES control_obra.facturas_recibidas(id) ON DELETE SET NULL,
  gasto_id           integer NULL REFERENCES control_obra.gastos(id) ON DELETE SET NULL,
  proveedor_id       integer NULL REFERENCES control_obra.proveedores(id) ON DELETE SET NULL,
  rfc_emisor         text NULL,
  nombre_emisor      text NULL,
  uuid_cfdi          text NOT NULL,
  indice             integer NOT NULL,                       -- posición del concepto en el CFDI
  fecha              date NOT NULL,
  clave_sat          text NULL,
  descripcion        text NOT NULL CHECK (length(btrim(descripcion)) > 0),
  descripcion_norm   text GENERATED ALWAYS AS (control_obra.texto_norm(descripcion)) STORED,
  unidad             text NULL,
  cantidad           numeric(18,6) NULL,
  valor_unitario     numeric(16,4) NOT NULL CHECK (valor_unitario >= 0),   -- sin IVA
  importe            numeric(16,2) NULL,
  estado             text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','ligada','creada','descartada')),
  sugerencia_accion  text NULL CHECK (sugerencia_accion IN ('ligar','descartar')),  -- de una regla recordada
  insumo_id          integer NULL REFERENCES control_obra.insumos(id) ON DELETE SET NULL,
  precio_id          bigint NULL REFERENCES control_obra.insumo_precios(id) ON DELETE SET NULL,
  resuelto_por       uuid NULL,
  resuelto_at        timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insumo_sugerencias_cfdi_uk UNIQUE (empresa_id, uuid_cfdi, indice)
);
CREATE INDEX IF NOT EXISTS idx_insumo_sugerencias_estado ON control_obra.insumo_sugerencias (empresa_id, estado, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_insumo_sugerencias_insumo ON control_obra.insumo_sugerencias (insumo_id) WHERE insumo_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS control_obra.insumo_sugerencia_reglas (
  id                bigserial PRIMARY KEY,
  empresa_id        integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                    REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  proveedor_clave   text NOT NULL,          -- 'p:<proveedor_id>' o 'rfc:<RFC>'
  descripcion_norm  text NOT NULL,
  accion            text NOT NULL CHECK (accion IN ('ligar','descartar')),
  insumo_id         integer NULL REFERENCES control_obra.insumos(id) ON DELETE CASCADE,
  created_by        uuid NULL DEFAULT control_obra.get_session_user_id(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insumo_sugerencia_reglas_uk UNIQUE (empresa_id, proveedor_clave, descripcion_norm),
  CONSTRAINT insumo_sugerencia_reglas_ck CHECK ((accion = 'ligar') = (insumo_id IS NOT NULL))
);

DROP TRIGGER IF EXISTS trg_insumo_sugerencias_empresa ON control_obra.insumo_sugerencias;
CREATE TRIGGER trg_insumo_sugerencias_empresa BEFORE INSERT OR UPDATE ON control_obra.insumo_sugerencias
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_banco_empresa();
DROP TRIGGER IF EXISTS trg_insumo_sugerencia_reglas_empresa ON control_obra.insumo_sugerencia_reglas;
CREATE TRIGGER trg_insumo_sugerencia_reglas_empresa BEFORE INSERT OR UPDATE ON control_obra.insumo_sugerencia_reglas
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_banco_empresa();

-- Al fusionar dos insumos (096), las sugerencias y reglas del origen pasan al destino antes de que se borre.
CREATE OR REPLACE FUNCTION control_obra.trg_insumo_fusion_sugerencias()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
BEGIN
  IF NEW.destino_id IS NOT NULL THEN
    UPDATE control_obra.insumo_sugerencias SET insumo_id = NEW.destino_id WHERE insumo_id = NEW.origen_id;
    UPDATE control_obra.insumo_sugerencia_reglas SET insumo_id = NEW.destino_id WHERE insumo_id = NEW.origen_id;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION control_obra.trg_insumo_fusion_sugerencias() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_insumo_fusion_sugerencias ON control_obra.insumo_fusiones;
CREATE TRIGGER trg_insumo_fusion_sugerencias AFTER INSERT ON control_obra.insumo_fusiones
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_insumo_fusion_sugerencias();

ALTER TABLE control_obra.insumo_sugerencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.insumo_sugerencia_reglas ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['insumo_sugerencias','insumo_sugerencia_reglas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON control_obra.%I', t || '_n80', t);
    EXECUTE format('CREATE POLICY %I ON control_obra.%I FOR ALL
      USING (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)
      WITH CHECK (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)',
      t || '_n80', t);
  END LOOP;
END $$;

CREATE OR REPLACE VIEW public.insumo_sugerencias WITH (security_invoker = true) AS
  SELECT id, empresa_id, factura_id, gasto_id, proveedor_id, rfc_emisor, nombre_emisor, uuid_cfdi, indice, fecha,
         clave_sat, descripcion, descripcion_norm, unidad, cantidad, valor_unitario, importe, estado, sugerencia_accion,
         insumo_id, precio_id, resuelto_por, resuelto_at, created_at
  FROM control_obra.insumo_sugerencias;

CREATE OR REPLACE VIEW public.insumo_sugerencia_reglas WITH (security_invoker = true) AS
  SELECT id, empresa_id, proveedor_clave, descripcion_norm, accion, insumo_id, created_by, updated_at
  FROM control_obra.insumo_sugerencia_reglas;

-- Proponer: lo llama cfdi.js tras guardar la factura recibida. Con nivel < 80 no hace nada (no es error: el
-- capturista de compras no ve el banco). Idempotente por (uuid, índice del concepto).
CREATE OR REPLACE FUNCTION public.proponer_precios_cfdi(
  p_uuid text, p_fecha date, p_conceptos jsonb,
  p_gasto_id integer DEFAULT NULL, p_proveedor_id integer DEFAULT NULL, p_factura_id integer DEFAULT NULL,
  p_rfc text DEFAULT NULL, p_nombre text DEFAULT NULL, p_moneda text DEFAULT 'MXN')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'control_obra', 'public' AS $$
DECLARE v_n int := 0; v_prov text;
BEGIN
  IF COALESCE((SELECT control_obra.get_session_nivel()), 0) < 80 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'nivel');
  END IF;
  IF COALESCE(upper(p_moneda), 'MXN') NOT IN ('MXN', '') THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'moneda');
  END IF;
  IF p_uuid IS NULL OR btrim(p_uuid) = '' OR jsonb_typeof(p_conceptos) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'datos');
  END IF;
  v_prov := CASE WHEN p_proveedor_id IS NOT NULL THEN 'p:' || p_proveedor_id
                 WHEN NULLIF(btrim(p_rfc), '') IS NOT NULL THEN 'rfc:' || upper(btrim(p_rfc)) END;

  INSERT INTO control_obra.insumo_sugerencias (factura_id, gasto_id, proveedor_id, rfc_emisor, nombre_emisor, uuid_cfdi,
      indice, fecha, clave_sat, descripcion, unidad, cantidad, valor_unitario, importe, sugerencia_accion, insumo_id)
  SELECT p_factura_id, p_gasto_id, p_proveedor_id, NULLIF(upper(btrim(p_rfc)), ''), NULLIF(btrim(p_nombre), ''),
         upper(btrim(p_uuid)), o::int, COALESCE(p_fecha, current_date), NULLIF(x->>'clave', ''), btrim(x->>'descripcion'),
         NULLIF(x->>'unidad', ''), (x->>'cantidad')::numeric, (x->>'valorUnitario')::numeric, (x->>'importe')::numeric,
         r.accion, r.insumo_id
    FROM jsonb_array_elements(p_conceptos) WITH ORDINALITY AS t(x, o)
    LEFT JOIN control_obra.insumo_sugerencia_reglas r
           ON v_prov IS NOT NULL AND r.proveedor_clave = v_prov
          AND r.descripcion_norm = control_obra.texto_norm(x->>'descripcion')
   WHERE COALESCE(btrim(x->>'descripcion'), '') <> ''
     AND jsonb_typeof(x->'valorUnitario') = 'number' AND (x->>'valorUnitario')::numeric > 0
  ON CONFLICT ON CONSTRAINT insumo_sugerencias_cfdi_uk DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'propuestas', v_n);
END; $$;

-- Clasificar: ligar a un insumo existente, crear uno nuevo con la sugerencia o descartar. Ligar o crear guarda el
-- precio (fuente 'compra', fecha de la factura, plaza elegida, proveedor y gasto). p_factor divide el valor unitario
-- cuando la unidad de la factura no es la del insumo (p. ej. caja de 10 piezas → factor 10).
CREATE OR REPLACE FUNCTION public.clasificar_sugerencia(
  p_id bigint, p_accion text, p_insumo_id integer DEFAULT NULL, p_plaza text DEFAULT 'otra',
  p_recordar boolean DEFAULT true, p_nuevo jsonb DEFAULT NULL, p_factor numeric DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'control_obra', 'public' AS $$
DECLARE
  s control_obra.insumo_sugerencias%ROWTYPE;
  v_ins int := p_insumo_id; v_precio_id bigint; v_prov text; v_factor numeric := COALESCE(NULLIF(p_factor, 0), 1);
BEGIN
  IF (SELECT control_obra.get_session_nivel()) < 80 THEN
    RAISE EXCEPTION 'El banco de precios es sólo para administradores y gerentes de obra' USING ERRCODE = '42501';
  END IF;
  IF p_accion NOT IN ('ligar','crear','descartar') THEN
    RAISE EXCEPTION 'Acción no válida: %', p_accion USING ERRCODE = '22023';
  END IF;
  IF p_plaza NOT IN ('cuauhtemoc','chihuahua','juarez','parral','casas_grandes','otra') THEN
    RAISE EXCEPTION 'Plaza no válida: %', p_plaza USING ERRCODE = '22023';
  END IF;
  IF v_factor < 0 THEN RAISE EXCEPTION 'El factor de unidad debe ser positivo' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM control_obra.insumo_sugerencias WHERE id = p_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'No se encontró la sugerencia' USING ERRCODE = 'P0002'; END IF;
  v_prov := CASE WHEN s.proveedor_id IS NOT NULL THEN 'p:' || s.proveedor_id
                 WHEN s.rfc_emisor IS NOT NULL THEN 'rfc:' || s.rfc_emisor END;

  IF p_accion = 'crear' THEN
    INSERT INTO control_obra.insumos (clave, descripcion, unidad, tipo, familia)
    VALUES (COALESCE(NULLIF(btrim(p_nuevo->>'clave'), ''), 'CFDI-' || s.id),
            COALESCE(NULLIF(btrim(p_nuevo->>'descripcion'), ''), s.descripcion),
            COALESCE(NULLIF(btrim(p_nuevo->>'unidad'), ''), s.unidad, ''),
            COALESCE(NULLIF(p_nuevo->>'tipo', ''), 'material'),
            NULLIF(btrim(p_nuevo->>'familia'), ''))
    RETURNING id INTO v_ins;
  END IF;

  IF p_accion IN ('ligar','crear') THEN
    IF v_ins IS NULL OR NOT EXISTS (SELECT 1 FROM control_obra.insumos WHERE id = v_ins) THEN
      RAISE EXCEPTION 'Elige el insumo al que corresponde este concepto' USING ERRCODE = '22023';
    END IF;
    INSERT INTO control_obra.insumo_precios (insumo_id, precio, fecha, plaza, fuente, proveedor_id, gasto_id, datos, notas)
    VALUES (v_ins, round(s.valor_unitario / v_factor, 4), s.fecha, p_plaza, 'compra', s.proveedor_id, s.gasto_id,
            jsonb_strip_nulls(jsonb_build_object('uuid_cfdi', s.uuid_cfdi, 'concepto_cfdi', s.descripcion,
              'unidad_cfdi', s.unidad, 'cantidad', s.cantidad, 'valor_unitario_cfdi', s.valor_unitario,
              'factor_unidad', CASE WHEN v_factor <> 1 THEN v_factor END, 'sugerencia_id', s.id)),
            'Factura ' || s.uuid_cfdi)
    ON CONFLICT ON CONSTRAINT insumo_precios_idem_uk DO UPDATE SET
      precio = EXCLUDED.precio, proveedor_id = EXCLUDED.proveedor_id, gasto_id = EXCLUDED.gasto_id,
      datos = EXCLUDED.datos, notas = EXCLUDED.notas
    RETURNING id INTO v_precio_id;
  END IF;

  UPDATE control_obra.insumo_sugerencias SET
    estado = CASE p_accion WHEN 'ligar' THEN 'ligada' WHEN 'crear' THEN 'creada' ELSE 'descartada' END,
    insumo_id = CASE WHEN p_accion = 'descartar' THEN insumo_id ELSE v_ins END,
    precio_id = v_precio_id, resuelto_por = control_obra.get_session_user_id(), resuelto_at = now()
  WHERE id = s.id;

  IF COALESCE(p_recordar, true) AND v_prov IS NOT NULL THEN
    INSERT INTO control_obra.insumo_sugerencia_reglas (proveedor_clave, descripcion_norm, accion, insumo_id)
    VALUES (v_prov, s.descripcion_norm, CASE WHEN p_accion = 'descartar' THEN 'descartar' ELSE 'ligar' END,
            CASE WHEN p_accion = 'descartar' THEN NULL ELSE v_ins END)
    ON CONFLICT ON CONSTRAINT insumo_sugerencia_reglas_uk DO UPDATE SET
      accion = EXCLUDED.accion, insumo_id = EXCLUDED.insumo_id, updated_at = now();
    -- Las pendientes del mismo proveedor y descripción quedan pre-llenadas (no se aplican solas)
    UPDATE control_obra.insumo_sugerencias SET
      sugerencia_accion = CASE WHEN p_accion = 'descartar' THEN 'descartar' ELSE 'ligar' END,
      insumo_id = CASE WHEN p_accion = 'descartar' THEN NULL ELSE v_ins END
    WHERE estado = 'pendiente' AND id <> s.id AND descripcion_norm = s.descripcion_norm
      AND (('p:' || proveedor_id) = v_prov OR ('rfc:' || rfc_emisor) = v_prov);
  END IF;

  RETURN jsonb_build_object('ok', true, 'insumo_id', v_ins, 'precio_id', v_precio_id);
END; $$;

REVOKE ALL ON control_obra.insumo_sugerencias, control_obra.insumo_sugerencia_reglas,
  public.insumo_sugerencias, public.insumo_sugerencia_reglas FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.insumo_sugerencias, control_obra.insumo_sugerencia_reglas,
  public.insumo_sugerencias, public.insumo_sugerencia_reglas TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.insumo_sugerencias_id_seq, control_obra.insumo_sugerencia_reglas_id_seq TO anon, authenticated;
REVOKE ALL ON FUNCTION public.proponer_precios_cfdi(text, date, jsonb, integer, integer, integer, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proponer_precios_cfdi(text, date, jsonb, integer, integer, integer, text, text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.clasificar_sugerencia(bigint, text, integer, text, boolean, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clasificar_sugerencia(bigint, text, integer, text, boolean, jsonb, numeric) TO anon, authenticated;

-- Aplicada aparte como 099_banco_grants_limpieza: la bitácora de fusiones también se puede borrar (limpieza de pruebas
-- y de fusiones registradas por error); sigue protegida por la RLS de empresa y nivel >= 80.
GRANT DELETE ON control_obra.insumo_fusiones, public.insumo_fusiones TO anon, authenticated;
