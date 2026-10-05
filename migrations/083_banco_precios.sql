-- 083_banco_precios.sql (US-803) — Banco de precios: insumos, precios con historia, conceptos históricos con su
-- matriz, parámetros laborales por año y la RPC buscar_insumos.
--
-- Reglas (PRD §3, D3, D5, §6):
--   * Precios SIN IVA. Un precio es un hecho con fecha, plaza y fuente; nunca se sobrescribe (D5). El «precio
--     vigente» se calcula: último de la plaza; si no hay, último general (buscar_insumos lo devuelve).
--   * insumo_precios es idempotente por (insumo_id, fecha, plaza, fuente, licitacion_id) con NULLS NOT DISTINCT:
--     reimportar la misma propuesta no duplica (upsert con on_conflict de esas 5 columnas).
--   * D3: insumos, insumo_precios, conceptos_historicos, concepto_precios y matriz_componentes exigen
--     get_session_nivel() >= 80 también para LEER. parametros_laborales igual, con filas de fábrica (empresa NULL).
--   * Plazas (decisión de Ricardo, 4-oct-2026): cuauhtemoc, chihuahua, juarez, parral, casas_grandes, otra.
--   * Tipos de insumo: material, mano_obra, equipo, herramienta, auxiliar.
-- Requiere 082 (pg_trgm en extensions) y unaccent (public).

-- 1) Normalización inmutable para columnas generadas (unaccent() es STABLE y no se admite en GENERATED) ------------
CREATE OR REPLACE FUNCTION control_obra.texto_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = '' AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, p)), '[^a-z0-9ñ]+', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;
GRANT EXECUTE ON FUNCTION control_obra.texto_norm(text) TO anon, authenticated;

-- 2) Insumos --------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.insumos (
  id                serial PRIMARY KEY,
  empresa_id        integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                    REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  clave             text NOT NULL CHECK (length(btrim(clave)) > 0),
  descripcion       text NOT NULL CHECK (length(btrim(descripcion)) > 0),
  descripcion_norm  text GENERATED ALWAYS AS (control_obra.texto_norm(descripcion)) STORED,
  unidad            text NOT NULL,
  tipo              text NOT NULL CHECK (tipo IN ('material','mano_obra','equipo','herramienta','auxiliar')),
  familia           text NULL,
  activo            boolean NOT NULL DEFAULT true,
  notas             text NULL,
  created_by        uuid NULL DEFAULT control_obra.get_session_user_id(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insumos_clave_uk UNIQUE (empresa_id, clave, unidad, tipo)
);
CREATE INDEX IF NOT EXISTS idx_insumos_desc_trgm ON control_obra.insumos USING gin (descripcion_norm extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_insumos_clave_lower ON control_obra.insumos (empresa_id, lower(clave));
CREATE INDEX IF NOT EXISTS idx_insumos_empresa_tipo ON control_obra.insumos (empresa_id, tipo);

-- 3) Precios con historia ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.insumo_precios (
  id             bigserial PRIMARY KEY,
  empresa_id     integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                 REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  insumo_id      integer NOT NULL REFERENCES control_obra.insumos(id) ON DELETE CASCADE,
  precio         numeric(16,4) NOT NULL CHECK (precio >= 0),     -- sin IVA
  fecha          date NOT NULL,
  plaza          text NOT NULL DEFAULT 'otra' CHECK (plaza IN ('cuauhtemoc','chihuahua','juarez','parral','casas_grandes','otra')),
  fuente         text NOT NULL CHECK (fuente IN ('opus','cotizacion','compra','manual','referencia')),
  licitacion_id  integer NULL REFERENCES control_obra.licitaciones(id) ON DELETE SET NULL,
  proveedor_id   integer NULL REFERENCES control_obra.proveedores(id) ON DELETE SET NULL,
  gasto_id       integer NULL REFERENCES control_obra.gastos(id) ON DELETE SET NULL,
  datos          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(datos) = 'object'),  -- MO: salario_base, sbc, fsr, costo_jornada
  notas          text NULL,
  created_by     uuid NULL DEFAULT control_obra.get_session_user_id(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insumo_precios_idem_uk UNIQUE NULLS NOT DISTINCT (insumo_id, fecha, plaza, fuente, licitacion_id)
);
CREATE INDEX IF NOT EXISTS idx_insumo_precios_insumo_fecha ON control_obra.insumo_precios (insumo_id, fecha DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_insumo_precios_plaza ON control_obra.insumo_precios (insumo_id, plaza, fecha DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_insumo_precios_lic ON control_obra.insumo_precios (licitacion_id) WHERE licitacion_id IS NOT NULL;

-- 4) Conceptos históricos, sus precios y su matriz --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.conceptos_historicos (
  id                serial PRIMARY KEY,
  empresa_id        integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                    REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  clave             text NOT NULL DEFAULT '',
  descripcion       text NOT NULL CHECK (length(btrim(descripcion)) > 0),
  descripcion_norm  text GENERATED ALWAYS AS (control_obra.texto_norm(descripcion)) STORED,
  unidad            text NOT NULL DEFAULT '',
  partida           text NULL,
  activo            boolean NOT NULL DEFAULT true,
  notas             text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- La misma clave se repite entre proyectos con conceptos distintos: la identidad es clave + unidad + descripción
CREATE UNIQUE INDEX IF NOT EXISTS conceptos_historicos_uidx
  ON control_obra.conceptos_historicos (empresa_id, clave, unidad, md5(descripcion_norm));
CREATE INDEX IF NOT EXISTS idx_conceptos_hist_desc_trgm ON control_obra.conceptos_historicos USING gin (descripcion_norm extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_conceptos_hist_clave ON control_obra.conceptos_historicos (empresa_id, lower(clave));

CREATE TABLE IF NOT EXISTS control_obra.concepto_precios (
  id              bigserial PRIMARY KEY,
  empresa_id      integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                  REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  concepto_id     integer NOT NULL REFERENCES control_obra.conceptos_historicos(id) ON DELETE CASCADE,
  licitacion_id   integer NULL REFERENCES control_obra.licitaciones(id) ON DELETE SET NULL,
  fecha           date NOT NULL,
  plaza           text NOT NULL DEFAULT 'otra' CHECK (plaza IN ('cuauhtemoc','chihuahua','juarez','parral','casas_grandes','otra')),
  pu              numeric(16,4) NOT NULL CHECK (pu >= 0),          -- precio unitario sin IVA
  costo_directo   numeric(16,4) NULL CHECK (costo_directo IS NULL OR costo_directo >= 0),
  indirectos_pct  numeric(7,4) NULL,
  utilidad_pct    numeric(7,4) NULL,
  cantidad        numeric(18,6) NULL,
  fuente          text NOT NULL DEFAULT 'opus' CHECK (fuente IN ('opus','cotizacion','manual','referencia')),
  notas           text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concepto_precios_idem_uk UNIQUE NULLS NOT DISTINCT (concepto_id, licitacion_id, fecha, plaza, fuente)
);
CREATE INDEX IF NOT EXISTS idx_concepto_precios_concepto ON control_obra.concepto_precios (concepto_id, fecha DESC);

CREATE TABLE IF NOT EXISTS control_obra.matriz_componentes (
  id             bigserial PRIMARY KEY,
  empresa_id     integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                 REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  concepto_id    integer NOT NULL REFERENCES control_obra.conceptos_historicos(id) ON DELETE CASCADE,
  insumo_id      integer NOT NULL REFERENCES control_obra.insumos(id) ON DELETE CASCADE,
  cantidad       numeric(18,6) NOT NULL,
  rendimiento    numeric(18,6) NOT NULL DEFAULT 1,      -- OPUS: Rendimiento = 1
  licitacion_id  integer NULL REFERENCES control_obra.licitaciones(id) ON DELETE SET NULL,  -- de dónde salió la matriz
  orden          integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matriz_componentes_idem_uk UNIQUE NULLS NOT DISTINCT (concepto_id, insumo_id, licitacion_id)
);
CREATE INDEX IF NOT EXISTS idx_matriz_componentes_concepto ON control_obra.matriz_componentes (concepto_id, orden);
CREATE INDEX IF NOT EXISTS idx_matriz_componentes_insumo ON control_obra.matriz_componentes (insumo_id);

-- 5) Parámetros laborales por año (filas de fábrica con empresa NULL; la empresa puede tener las suyas) -------------
CREATE TABLE IF NOT EXISTS control_obra.parametros_laborales (
  id                        serial PRIMARY KEY,
  empresa_id                integer NULL DEFAULT control_obra.get_session_empresa_id()
                            REFERENCES control_obra.empresas(id) ON DELETE CASCADE,   -- NULL = fábrica
  anio                      integer NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  uma                       numeric(10,4) NOT NULL,
  salario_minimo            numeric(10,4) NOT NULL,
  salario_minimo_frontera   numeric(10,4) NULL,
  salario_albanil           numeric(10,4) NULL,     -- salario mínimo profesional de oficial de albañilería
  dias_vacaciones           integer NULL,
  riesgo_trabajo_pct        numeric(9,5) NULL,      -- prima de riesgo (clase V 7.58875)
  isn_pct                   numeric(7,4) NULL,      -- impuesto sobre nómina estatal
  cesantia_tabla            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cesantia_tabla) = 'array'),
                            -- [{desde_uma, hasta_uma, pct}] tabla escalonada de cesantía y vejez patronal
  datos                     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(datos) = 'object'),  -- otras tasas IMSS
  es_fabrica                boolean NOT NULL DEFAULT false,
  fuente                    text NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parametros_laborales_fabrica_ck CHECK (es_fabrica = (empresa_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS parametros_laborales_anio_uidx ON control_obra.parametros_laborales (COALESCE(empresa_id, 0), anio);

-- 6) Triggers: updated_at y coherencia de empresa entre padres e hijos -----------------------------------------------
DROP TRIGGER IF EXISTS trg_insumos_touch ON control_obra.insumos;
CREATE TRIGGER trg_insumos_touch BEFORE UPDATE ON control_obra.insumos FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();
DROP TRIGGER IF EXISTS trg_conceptos_historicos_touch ON control_obra.conceptos_historicos;
CREATE TRIGGER trg_conceptos_historicos_touch BEFORE UPDATE ON control_obra.conceptos_historicos FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();
DROP TRIGGER IF EXISTS trg_parametros_laborales_touch ON control_obra.parametros_laborales;
CREATE TRIGGER trg_parametros_laborales_touch BEFORE UPDATE ON control_obra.parametros_laborales FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();

-- Un precio, un PU o un componente no pueden apuntar a insumos, conceptos o licitaciones de otra empresa
CREATE OR REPLACE FUNCTION control_obra.trg_banco_empresa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public' AS $$
DECLARE j jsonb := to_jsonb(NEW); v int;
BEGIN
  IF j ? 'insumo_id' AND (j->>'insumo_id') IS NOT NULL THEN
    SELECT empresa_id INTO v FROM control_obra.insumos WHERE id = (j->>'insumo_id')::int;
    IF v IS DISTINCT FROM NEW.empresa_id THEN RAISE EXCEPTION 'El insumo no pertenece a la empresa' USING ERRCODE = '42501'; END IF;
  END IF;
  IF j ? 'concepto_id' AND (j->>'concepto_id') IS NOT NULL THEN
    SELECT empresa_id INTO v FROM control_obra.conceptos_historicos WHERE id = (j->>'concepto_id')::int;
    IF v IS DISTINCT FROM NEW.empresa_id THEN RAISE EXCEPTION 'El concepto no pertenece a la empresa' USING ERRCODE = '42501'; END IF;
  END IF;
  IF j ? 'licitacion_id' AND (j->>'licitacion_id') IS NOT NULL THEN
    SELECT empresa_id INTO v FROM control_obra.licitaciones WHERE id = (j->>'licitacion_id')::int;
    IF v IS DISTINCT FROM NEW.empresa_id THEN RAISE EXCEPTION 'La licitación no pertenece a la empresa' USING ERRCODE = '42501'; END IF;
  END IF;
  IF j ? 'proveedor_id' AND (j->>'proveedor_id') IS NOT NULL THEN
    SELECT empresa_id INTO v FROM control_obra.proveedores WHERE id = (j->>'proveedor_id')::int;
    IF v IS DISTINCT FROM NEW.empresa_id THEN RAISE EXCEPTION 'El proveedor no pertenece a la empresa' USING ERRCODE = '42501'; END IF;
  END IF;
  IF j ? 'gasto_id' AND (j->>'gasto_id') IS NOT NULL THEN
    SELECT empresa_id INTO v FROM control_obra.gastos WHERE id = (j->>'gasto_id')::int;
    IF v IS DISTINCT FROM NEW.empresa_id THEN RAISE EXCEPTION 'El gasto no pertenece a la empresa' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION control_obra.trg_banco_empresa() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_insumo_precios_empresa ON control_obra.insumo_precios;
CREATE TRIGGER trg_insumo_precios_empresa BEFORE INSERT OR UPDATE ON control_obra.insumo_precios FOR EACH ROW EXECUTE FUNCTION control_obra.trg_banco_empresa();
DROP TRIGGER IF EXISTS trg_concepto_precios_empresa ON control_obra.concepto_precios;
CREATE TRIGGER trg_concepto_precios_empresa BEFORE INSERT OR UPDATE ON control_obra.concepto_precios FOR EACH ROW EXECUTE FUNCTION control_obra.trg_banco_empresa();
DROP TRIGGER IF EXISTS trg_matriz_componentes_empresa ON control_obra.matriz_componentes;
CREATE TRIGGER trg_matriz_componentes_empresa BEFORE INSERT OR UPDATE ON control_obra.matriz_componentes FOR EACH ROW EXECUTE FUNCTION control_obra.trg_banco_empresa();

-- 7) RLS (D3: nivel >= 80 también para leer) --------------------------------------------------------------------------
ALTER TABLE control_obra.insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.insumo_precios ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.conceptos_historicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.concepto_precios ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.matriz_componentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.parametros_laborales ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['insumos','insumo_precios','conceptos_historicos','concepto_precios','matriz_componentes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON control_obra.%I', t || '_n80', t);
    EXECUTE format('CREATE POLICY %I ON control_obra.%I FOR ALL
      USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80)
      WITH CHECK (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80)', t || '_n80', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS parametros_laborales_sel ON control_obra.parametros_laborales;
CREATE POLICY parametros_laborales_sel ON control_obra.parametros_laborales FOR SELECT
  USING (control_obra.get_session_nivel() >= 80 AND (empresa_id IS NULL OR empresa_id = control_obra.get_session_empresa_id()));
DROP POLICY IF EXISTS parametros_laborales_ins ON control_obra.parametros_laborales;
CREATE POLICY parametros_laborales_ins ON control_obra.parametros_laborales FOR INSERT
  WITH CHECK (control_obra.get_session_nivel() >= 80 AND NOT es_fabrica AND empresa_id = control_obra.get_session_empresa_id());
DROP POLICY IF EXISTS parametros_laborales_upd ON control_obra.parametros_laborales;
CREATE POLICY parametros_laborales_upd ON control_obra.parametros_laborales FOR UPDATE
  USING (control_obra.get_session_nivel() >= 80 AND NOT es_fabrica AND empresa_id = control_obra.get_session_empresa_id())
  WITH CHECK (control_obra.get_session_nivel() >= 80 AND NOT es_fabrica AND empresa_id = control_obra.get_session_empresa_id());
DROP POLICY IF EXISTS parametros_laborales_del ON control_obra.parametros_laborales;
CREATE POLICY parametros_laborales_del ON control_obra.parametros_laborales FOR DELETE
  USING (control_obra.get_session_nivel() >= 80 AND NOT es_fabrica AND empresa_id = control_obra.get_session_empresa_id());

-- 8) Vistas públicas ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.insumos WITH (security_invoker = true) AS
  SELECT id, empresa_id, clave, descripcion, descripcion_norm, unidad, tipo, familia, activo, notas, created_by,
         created_at, updated_at
  FROM control_obra.insumos;

CREATE OR REPLACE VIEW public.insumo_precios WITH (security_invoker = true) AS
  SELECT id, empresa_id, insumo_id, precio, fecha, plaza, fuente, licitacion_id, proveedor_id, gasto_id, datos, notas,
         created_by, created_at
  FROM control_obra.insumo_precios;

-- Resumen por insumo (todas las plazas). El precio vigente POR PLAZA lo da buscar_insumos(p_plaza => ...).
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
         e.mediana, e.minimo, e.maximo, COALESCE(e.muestras, 0) AS muestras
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

CREATE OR REPLACE VIEW public.conceptos_historicos WITH (security_invoker = true) AS
  SELECT id, empresa_id, clave, descripcion, descripcion_norm, unidad, partida, activo, notas, created_at, updated_at
  FROM control_obra.conceptos_historicos;

CREATE OR REPLACE VIEW public.concepto_precios WITH (security_invoker = true) AS
  SELECT id, empresa_id, concepto_id, licitacion_id, fecha, plaza, pu, costo_directo, indirectos_pct, utilidad_pct,
         cantidad, fuente, notas, created_at
  FROM control_obra.concepto_precios;

CREATE OR REPLACE VIEW public.matriz_componentes WITH (security_invoker = true) AS
  SELECT id, empresa_id, concepto_id, insumo_id, cantidad, rendimiento, licitacion_id, orden, created_at
  FROM control_obra.matriz_componentes;

CREATE OR REPLACE VIEW public.parametros_laborales WITH (security_invoker = true) AS
  SELECT id, empresa_id, anio, uma, salario_minimo, salario_minimo_frontera, salario_albanil, dias_vacaciones,
         riesgo_trabajo_pct, isn_pct, cesantia_tabla, datos, es_fabrica, fuente, created_at, updated_at
  FROM control_obra.parametros_laborales;

-- 9) RPC buscar_insumos ---------------------------------------------------------------------------------------------------
-- Orden: clave exacta (sin mayúsculas) → clave que empieza con el texto → parecido por descripción.
-- Parecido = similarity >= 0.3 (criterio del PRD) O word_similarity >= 0.6 (para que «cemento» encuentre
-- «Cemento gris portland 50 kg»: con descripciones largas la similarity de una palabra sola queda < 0.3).
-- SECURITY INVOKER: las políticas de RLS (empresa + nivel >= 80) aplican tal cual; con nivel < 80 responde error.
-- Precio vigente: el último de p_plaza; si no hay en esa plaza, el último de cualquier plaza (D5).
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
LANGUAGE plpgsql STABLE SECURITY INVOKER
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
  IF p_tipo IS NOT NULL AND p_tipo NOT IN ('material','mano_obra','equipo','herramienta','auxiliar') THEN
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

-- 10) Privilegios mínimos ----------------------------------------------------------------------------------------------
REVOKE ALL ON control_obra.insumos, control_obra.insumo_precios, control_obra.conceptos_historicos,
  control_obra.concepto_precios, control_obra.matriz_componentes, control_obra.parametros_laborales,
  public.insumos, public.insumo_precios, public.insumos_resumen, public.conceptos_historicos, public.concepto_precios,
  public.matriz_componentes, public.parametros_laborales FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.insumos, control_obra.insumo_precios,
  control_obra.conceptos_historicos, control_obra.concepto_precios, control_obra.matriz_componentes,
  control_obra.parametros_laborales,
  public.insumos, public.insumo_precios, public.conceptos_historicos, public.concepto_precios,
  public.matriz_componentes, public.parametros_laborales TO anon, authenticated;
GRANT SELECT ON public.insumos_resumen TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.insumos_id_seq, control_obra.insumo_precios_id_seq,
  control_obra.conceptos_historicos_id_seq, control_obra.concepto_precios_id_seq,
  control_obra.matriz_componentes_id_seq, control_obra.parametros_laborales_id_seq TO anon, authenticated;
REVOKE ALL ON FUNCTION public.buscar_insumos(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_insumos(text, text, text, integer) TO anon, authenticated;
