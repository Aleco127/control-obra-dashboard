-- 096_banco_precios_catalogo.sql (épica D: US-822 y US-825/826) — Catálogo de insumos del banco de precios.
--
--   1. Tipo de insumo `flete` (OPUS TipoRecurso 10; el contrato opus-insumos/v1 lo exporta).
--   2. insumos.compuesto: recurso con matriz propia (cuadrilla o auxiliar). Su precio sale de su matriz, no del
--      mercado: el banco no guarda precios suyos (contrato opus-insumos/v1, `tiene_matriz`).
--   3. insumo_componentes: la matriz de un insumo compuesto (componentes con matriz = 'auxiliar' en el JSON).
--   4. insumo_fusiones + RPC fusionar_insumos(origen, destino): «Fusionar» dos insumos duplicados mueve sus
--      precios y componentes al destino y deja constancia (reporte de duplicados de US-828).
--   5. Vistas public.insumos e insumos_resumen con `compuesto` al final; buscar_insumos acepta `flete`.
-- Aditiva. Mismas reglas que 083/084: RLS por empresa y nivel >= 80 con (SELECT ...), vistas security_invoker.

-- 1) Tipo flete --------------------------------------------------------------------------------------------------------
ALTER TABLE control_obra.insumos DROP CONSTRAINT IF EXISTS insumos_tipo_check;
ALTER TABLE control_obra.insumos ADD CONSTRAINT insumos_tipo_check
  CHECK (tipo IN ('material','mano_obra','equipo','herramienta','auxiliar','flete'));

-- 2) Insumo compuesto --------------------------------------------------------------------------------------------------
ALTER TABLE control_obra.insumos ADD COLUMN IF NOT EXISTS compuesto boolean NOT NULL DEFAULT false;

-- 3) Matriz de un insumo compuesto -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.insumo_componentes (
  id             bigserial PRIMARY KEY,
  empresa_id     integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                 REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  insumo_id      integer NOT NULL REFERENCES control_obra.insumos(id) ON DELETE CASCADE,   -- el compuesto
  componente_id  integer NOT NULL REFERENCES control_obra.insumos(id) ON DELETE CASCADE,   -- lo que lleva
  cantidad       numeric(18,6) NOT NULL,
  rendimiento    numeric(18,6) NOT NULL DEFAULT 1,
  licitacion_id  integer NULL REFERENCES control_obra.licitaciones(id) ON DELETE SET NULL,
  orden          integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insumo_componentes_no_self_ck CHECK (insumo_id <> componente_id),
  CONSTRAINT insumo_componentes_idem_uk UNIQUE NULLS NOT DISTINCT (insumo_id, componente_id, licitacion_id)
);
CREATE INDEX IF NOT EXISTS idx_insumo_componentes_padre ON control_obra.insumo_componentes (insumo_id, orden);
CREATE INDEX IF NOT EXISTS idx_insumo_componentes_comp ON control_obra.insumo_componentes (componente_id);
CREATE INDEX IF NOT EXISTS idx_insumo_componentes_lic ON control_obra.insumo_componentes (licitacion_id) WHERE licitacion_id IS NOT NULL;

CREATE OR REPLACE FUNCTION control_obra.trg_insumo_componentes_empresa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public' AS $$
DECLARE v int;
BEGIN
  SELECT empresa_id INTO v FROM control_obra.insumos WHERE id = NEW.insumo_id;
  IF v IS DISTINCT FROM NEW.empresa_id THEN RAISE EXCEPTION 'El insumo no pertenece a la empresa' USING ERRCODE = '42501'; END IF;
  SELECT empresa_id INTO v FROM control_obra.insumos WHERE id = NEW.componente_id;
  IF v IS DISTINCT FROM NEW.empresa_id THEN RAISE EXCEPTION 'El componente no pertenece a la empresa' USING ERRCODE = '42501'; END IF;
  IF NEW.licitacion_id IS NOT NULL THEN
    SELECT empresa_id INTO v FROM control_obra.licitaciones WHERE id = NEW.licitacion_id;
    IF v IS DISTINCT FROM NEW.empresa_id THEN RAISE EXCEPTION 'La licitación no pertenece a la empresa' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION control_obra.trg_insumo_componentes_empresa() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_insumo_componentes_empresa ON control_obra.insumo_componentes;
CREATE TRIGGER trg_insumo_componentes_empresa BEFORE INSERT OR UPDATE ON control_obra.insumo_componentes
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_insumo_componentes_empresa();

-- 4) Bitácora de fusiones ----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.insumo_fusiones (
  id                   bigserial PRIMARY KEY,
  empresa_id           integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                       REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  origen_id            integer NOT NULL,                 -- ya no existe: se borra al fusionar
  origen_clave         text NOT NULL,
  origen_descripcion   text NOT NULL,
  origen_unidad        text NOT NULL,
  destino_id           integer NULL REFERENCES control_obra.insumos(id) ON DELETE SET NULL,
  destino_clave        text NOT NULL,
  precios_movidos      integer NOT NULL DEFAULT 0,
  precios_descartados  integer NOT NULL DEFAULT 0,      -- mismo día, plaza, fuente y licitación que uno del destino
  componentes_movidos  integer NOT NULL DEFAULT 0,
  motivo               text NULL,
  created_by           uuid NULL DEFAULT control_obra.get_session_user_id(),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insumo_fusiones_empresa ON control_obra.insumo_fusiones (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insumo_fusiones_destino ON control_obra.insumo_fusiones (destino_id) WHERE destino_id IS NOT NULL;

-- 5) RLS ---------------------------------------------------------------------------------------------------------------
ALTER TABLE control_obra.insumo_componentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.insumo_fusiones ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['insumo_componentes','insumo_fusiones'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON control_obra.%I', t || '_n80', t);
    EXECUTE format('CREATE POLICY %I ON control_obra.%I FOR ALL
      USING (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)
      WITH CHECK (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)',
      t || '_n80', t);
  END LOOP;
END $$;

-- 6) Vistas públicas (columnas nuevas al final) ------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.insumos WITH (security_invoker = true) AS
  SELECT id, empresa_id, clave, descripcion, descripcion_norm, unidad, tipo, familia, activo, notas, created_by,
         created_at, updated_at, compuesto
  FROM control_obra.insumos;

CREATE OR REPLACE VIEW public.insumos_resumen WITH (security_invoker = true) AS
  SELECT i.id, i.empresa_id, i.clave, i.descripcion, i.unidad, i.tipo, i.familia, i.activo,
         u.precio  AS ultimo_precio,
         u.fecha   AS ultima_fecha,
         u.plaza   AS ultima_plaza,
         u.fuente  AS ultima_fuente,
         a.precio  AS precio_anterior,
         a.fecha   AS fecha_anterior,
         CASE WHEN a.precio IS NULL OR a.precio = 0 THEN NULL
              ELSE round((u.precio - a.precio) / a.precio * 100, 2) END AS variacion_pct,
         e.mediana, e.minimo, e.maximo, COALESCE(e.muestras, 0) AS muestras,
         i.compuesto
  FROM control_obra.insumos i
  LEFT JOIN LATERAL (
    SELECT p.precio, p.fecha, p.plaza, p.fuente FROM control_obra.insumo_precios p
    WHERE p.insumo_id = i.id ORDER BY p.fecha DESC, p.id DESC LIMIT 1) u ON true
  LEFT JOIN LATERAL (
    SELECT p.precio, p.fecha FROM control_obra.insumo_precios p
    WHERE p.insumo_id = i.id ORDER BY p.fecha DESC, p.id DESC OFFSET 1 LIMIT 1) a ON true
  LEFT JOIN LATERAL (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY p.precio)::numeric(16,4) AS mediana,
           min(p.precio) AS minimo, max(p.precio) AS maximo, count(*)::int AS muestras
    FROM control_obra.insumo_precios p WHERE p.insumo_id = i.id) e ON true;

CREATE OR REPLACE VIEW public.insumo_componentes WITH (security_invoker = true) AS
  SELECT id, empresa_id, insumo_id, componente_id, cantidad, rendimiento, licitacion_id, orden, created_at
  FROM control_obra.insumo_componentes;

CREATE OR REPLACE VIEW public.insumo_fusiones WITH (security_invoker = true) AS
  SELECT id, empresa_id, origen_id, origen_clave, origen_descripcion, origen_unidad, destino_id, destino_clave,
         precios_movidos, precios_descartados, componentes_movidos, motivo, created_by, created_at
  FROM control_obra.insumo_fusiones;

-- 7) buscar_insumos acepta flete (misma firma, misma salida, SECURITY DEFINER con validación como en 084) ------------
CREATE OR REPLACE FUNCTION public.buscar_insumos(
  p_texto  text,
  p_tipo   text    DEFAULT NULL,
  p_plaza  text    DEFAULT NULL,
  p_limite integer DEFAULT 50)
RETURNS TABLE (
  id integer, clave text, descripcion text, unidad text, tipo text, familia text, activo boolean,
  coincidencia text, puntaje real,
  precio_vigente numeric, fecha_vigente date, plaza_vigente text, fuente_vigente text, de_otra_plaza boolean,
  muestras integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'control_obra', 'public', 'extensions'
AS $$
#variable_conflict use_column
DECLARE
  v_q    text := control_obra.texto_norm(COALESCE(p_texto, ''));
  v_raw  text := lower(btrim(COALESCE(p_texto, '')));
  v_lim  integer := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
  v_emp  integer := control_obra.get_session_empresa_id();
BEGIN
  IF control_obra.get_session_nivel() < 80 OR v_emp IS NULL THEN
    RAISE EXCEPTION 'El banco de precios es sólo para administradores y gerentes de obra' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NOT NULL AND p_tipo NOT IN ('material','mano_obra','equipo','herramienta','auxiliar','flete') THEN
    RAISE EXCEPTION 'Tipo de insumo no válido: %', p_tipo USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH cand AS (
    SELECT i.id, i.clave, i.descripcion, i.unidad, i.tipo, i.familia, i.activo,
           CASE WHEN lower(i.clave) = v_raw THEN 'clave'
                WHEN v_raw <> '' AND left(lower(i.clave), length(v_raw)) = v_raw THEN 'clave_prefijo'
                ELSE 'descripcion' END AS coinc,
           CASE WHEN v_q = '' THEN 0::real ELSE extensions.similarity(i.descripcion_norm, v_q) END AS sim,
           CASE WHEN v_q = '' THEN 0::real ELSE extensions.word_similarity(v_q, i.descripcion_norm) END AS wsim
    FROM control_obra.insumos i
    WHERE i.empresa_id = v_emp
      AND (p_tipo IS NULL OR i.tipo = p_tipo)
      AND (
        v_raw = ''
        OR lower(i.clave) = v_raw
        OR left(lower(i.clave), length(v_raw)) = v_raw
        OR (v_q <> '' AND (i.descripcion_norm OPERATOR(extensions.%) v_q OR v_q OPERATOR(extensions.<%) i.descripcion_norm))
      )
  ), filtrados AS (
    SELECT c.id, c.clave, c.descripcion, c.unidad, c.tipo, c.familia, c.activo, c.coinc,
           GREATEST(c.sim, c.wsim)::real AS sc
    FROM cand c
    WHERE c.coinc <> 'descripcion' OR v_q = '' OR c.sim >= 0.3 OR c.wsim >= 0.6
    ORDER BY CASE c.coinc WHEN 'clave' THEN 0 WHEN 'clave_prefijo' THEN 1 ELSE 2 END, GREATEST(c.sim, c.wsim) DESC, c.clave
    LIMIT v_lim
  )
  SELECT f.id, f.clave, f.descripcion, f.unidad, f.tipo, f.familia, f.activo, f.coinc, f.sc,
         pv.precio, pv.fecha, pv.plaza, pv.fuente,
         (p_plaza IS NOT NULL AND pv.plaza IS DISTINCT FROM p_plaza),
         (SELECT count(*)::int FROM control_obra.insumo_precios x WHERE x.insumo_id = f.id)
  FROM filtrados f
  LEFT JOIN LATERAL (
    SELECT p.precio, p.fecha, p.plaza, p.fuente
    FROM control_obra.insumo_precios p
    WHERE p.insumo_id = f.id
    ORDER BY (p_plaza IS NOT NULL AND p.plaza = p_plaza) DESC, p.fecha DESC, p.id DESC
    LIMIT 1) pv ON true
  ORDER BY CASE f.coinc WHEN 'clave' THEN 0 WHEN 'clave_prefijo' THEN 1 ELSE 2 END, f.sc DESC, f.clave;
END; $$;

-- 8) RPC fusionar_insumos -----------------------------------------------------------------------------------------------
-- SECURITY INVOKER: la RLS (empresa + nivel >= 80) aplica a cada lectura y escritura. Los dos deben ser del mismo tipo.
-- Precios: se mueven al destino; los que chocan con uno del destino (misma fecha, plaza, fuente y licitación) se
-- descartan (manda el del destino). Componentes de matriz: si el destino ya está en esa matriz se SUMAN las
-- cantidades (eran dos renglones de lo mismo); si no, se mueven. El origen se borra.
CREATE OR REPLACE FUNCTION public.fusionar_insumos(p_origen integer, p_destino integer, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'control_obra', 'public' AS $$
DECLARE
  o control_obra.insumos%ROWTYPE;
  d control_obra.insumos%ROWTYPE;
  v_mov int := 0; v_desc int := 0; v_comp int := 0; n int;
BEGIN
  IF (SELECT control_obra.get_session_nivel()) < 80 THEN
    RAISE EXCEPTION 'El banco de precios es sólo para administradores y gerentes de obra' USING ERRCODE = '42501';
  END IF;
  IF p_origen IS NULL OR p_destino IS NULL OR p_origen = p_destino THEN
    RAISE EXCEPTION 'Elige dos insumos distintos para fusionar' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM control_obra.insumos WHERE id = p_origen FOR UPDATE;
  SELECT * INTO d FROM control_obra.insumos WHERE id = p_destino FOR UPDATE;
  IF o.id IS NULL OR d.id IS NULL THEN
    RAISE EXCEPTION 'No se encontró uno de los insumos' USING ERRCODE = 'P0002';
  END IF;
  IF o.tipo <> d.tipo THEN
    RAISE EXCEPTION 'Sólo se fusionan insumos del mismo tipo (% y %)', o.tipo, d.tipo USING ERRCODE = '22023';
  END IF;

  -- Precios
  DELETE FROM control_obra.insumo_precios p
   WHERE p.insumo_id = o.id
     AND EXISTS (SELECT 1 FROM control_obra.insumo_precios q
                  WHERE q.insumo_id = d.id AND q.fecha = p.fecha AND q.plaza = p.plaza AND q.fuente = p.fuente
                    AND q.licitacion_id IS NOT DISTINCT FROM p.licitacion_id);
  GET DIAGNOSTICS v_desc = ROW_COUNT;
  UPDATE control_obra.insumo_precios SET insumo_id = d.id WHERE insumo_id = o.id;
  GET DIAGNOSTICS v_mov = ROW_COUNT;

  -- Matrices de conceptos
  UPDATE control_obra.matriz_componentes m SET cantidad = m.cantidad + x.cantidad
    FROM control_obra.matriz_componentes x
   WHERE x.insumo_id = o.id AND m.insumo_id = d.id AND m.concepto_id = x.concepto_id
     AND m.licitacion_id IS NOT DISTINCT FROM x.licitacion_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_comp := v_comp + n;
  DELETE FROM control_obra.matriz_componentes x
   WHERE x.insumo_id = o.id
     AND EXISTS (SELECT 1 FROM control_obra.matriz_componentes m WHERE m.insumo_id = d.id AND m.concepto_id = x.concepto_id
                   AND m.licitacion_id IS NOT DISTINCT FROM x.licitacion_id);
  UPDATE control_obra.matriz_componentes SET insumo_id = d.id WHERE insumo_id = o.id;
  GET DIAGNOSTICS n = ROW_COUNT; v_comp := v_comp + n;

  -- Matrices de insumos compuestos: el origen como componente
  UPDATE control_obra.insumo_componentes m SET cantidad = m.cantidad + x.cantidad
    FROM control_obra.insumo_componentes x
   WHERE x.componente_id = o.id AND m.componente_id = d.id AND m.insumo_id = x.insumo_id
     AND m.licitacion_id IS NOT DISTINCT FROM x.licitacion_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_comp := v_comp + n;
  DELETE FROM control_obra.insumo_componentes x
   WHERE x.componente_id = o.id
     AND (x.insumo_id = d.id OR EXISTS (SELECT 1 FROM control_obra.insumo_componentes m WHERE m.componente_id = d.id
                   AND m.insumo_id = x.insumo_id AND m.licitacion_id IS NOT DISTINCT FROM x.licitacion_id));
  UPDATE control_obra.insumo_componentes SET componente_id = d.id WHERE componente_id = o.id;
  GET DIAGNOSTICS n = ROW_COUNT; v_comp := v_comp + n;
  -- ... y como compuesto (su propia matriz pasa al destino si éste no tiene una de esa licitación)
  DELETE FROM control_obra.insumo_componentes x
   WHERE x.insumo_id = o.id
     AND (x.componente_id = d.id OR EXISTS (SELECT 1 FROM control_obra.insumo_componentes m WHERE m.insumo_id = d.id
                   AND m.licitacion_id IS NOT DISTINCT FROM x.licitacion_id));
  UPDATE control_obra.insumo_componentes SET insumo_id = d.id WHERE insumo_id = o.id;
  GET DIAGNOSTICS n = ROW_COUNT; v_comp := v_comp + n;

  IF o.compuesto AND NOT d.compuesto THEN
    UPDATE control_obra.insumos SET compuesto = true WHERE id = d.id;
  END IF;

  INSERT INTO control_obra.insumo_fusiones (empresa_id, origen_id, origen_clave, origen_descripcion, origen_unidad,
      destino_id, destino_clave, precios_movidos, precios_descartados, componentes_movidos, motivo)
    VALUES (d.empresa_id, o.id, o.clave, o.descripcion, o.unidad, d.id, d.clave, v_mov, v_desc, v_comp, NULLIF(btrim(p_motivo), ''));
  DELETE FROM control_obra.insumos WHERE id = o.id;

  RETURN jsonb_build_object('ok', true, 'destino_id', d.id, 'precios_movidos', v_mov, 'precios_descartados', v_desc,
                            'componentes_movidos', v_comp);
END; $$;

-- 9) Privilegios mínimos -----------------------------------------------------------------------------------------------
REVOKE ALL ON control_obra.insumo_componentes, control_obra.insumo_fusiones,
  public.insumo_componentes, public.insumo_fusiones FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.insumo_componentes, public.insumo_componentes TO anon, authenticated;
GRANT SELECT, INSERT ON control_obra.insumo_fusiones, public.insumo_fusiones TO anon, authenticated;
GRANT SELECT ON public.insumos_resumen TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.insumo_componentes_id_seq, control_obra.insumo_fusiones_id_seq TO anon, authenticated;
REVOKE ALL ON FUNCTION public.buscar_insumos(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_insumos(text, text, text, integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.fusionar_insumos(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fusionar_insumos(integer, integer, text) TO anon, authenticated;
