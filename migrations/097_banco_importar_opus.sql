-- 097_banco_importar_opus.sql (épica D: US-825, US-826, US-828) — Importar al banco un archivo opus-insumos/v1.
--
-- La conciliación la hace el navegador con la función pura BancoPrecios.conciliarInsumos() (tres cubetas:
-- coincide por clave + unidad + tipo · parecido por descripción ≥ 0.6, a revisar · nuevo). El usuario confirma los
-- parecidos y la app manda aquí el documento completo y el mapa de lo que confirmó: {clave_en_minúsculas: insumo_id}.
-- Nada se fusiona solo: un recurso sin entrada en el mapa sólo se liga a un insumo existente si coincide exacto por
-- clave + unidad + tipo (sin distinguir mayúsculas); si no, se crea.
--
-- Qué escribe (todo en la transacción del RPC, en sentencias por conjunto para no rebasar el statement_timeout de anon):
--   * insumos nuevos (compuesto = true si el recurso tiene matriz propia: cuadrilla o auxiliar);
--   * un precio por insumo con fuente 'opus', la fecha de la propuesta, la plaza y la licitación (idempotente por
--     insumo_precios_idem_uk). Sin precio: los compuestos (su precio sale de su matriz), la herramienta nativa (%)mo
--     con costo 0 y cualquier recurso con precio 0 o nulo (se reportan en `sin_precio`);
--   * conceptos_historicos (identidad = clave + unidad + descripción normalizada) y su PU en concepto_precios cuando
--     el PU es > 0 (un catálogo sin precios, como BanRegio CR 152, deja sólo los conceptos);
--   * matriz_componentes (matriz = 'concepto') e insumo_componentes (matriz = 'auxiliar') de ESA licitación: se borran
--     y se vuelven a escribir, así reimportar no duplica;
--   * banco_importaciones: una fila por licitación con el resumen y el mapa clave → insumo (reporte y verificación).
-- SECURITY INVOKER: la RLS (empresa + nivel >= 80) aplica a todo. Precios SIN IVA.

CREATE TABLE IF NOT EXISTS control_obra.banco_importaciones (
  id             bigserial PRIMARY KEY,
  empresa_id     integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                 REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  licitacion_id  integer NOT NULL REFERENCES control_obra.licitaciones(id) ON DELETE CASCADE,
  formato        text NOT NULL DEFAULT 'opus-insumos/v1',
  archivo        text NULL,
  proyecto       text NULL,
  fecha          date NOT NULL,
  plaza          text NOT NULL CHECK (plaza IN ('cuauhtemoc','chihuahua','juarez','parral','casas_grandes','otra')),
  resumen        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(resumen) = 'object'),
  mapa           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(mapa) = 'object'),   -- clave (minúsculas) → insumo_id
  created_by     uuid NULL DEFAULT control_obra.get_session_user_id(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT banco_importaciones_lic_uk UNIQUE (licitacion_id)
);
DROP TRIGGER IF EXISTS trg_banco_importaciones_touch ON control_obra.banco_importaciones;
CREATE TRIGGER trg_banco_importaciones_touch BEFORE UPDATE ON control_obra.banco_importaciones
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();
DROP TRIGGER IF EXISTS trg_banco_importaciones_empresa ON control_obra.banco_importaciones;
CREATE TRIGGER trg_banco_importaciones_empresa BEFORE INSERT OR UPDATE ON control_obra.banco_importaciones
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_banco_empresa();

ALTER TABLE control_obra.banco_importaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banco_importaciones_n80 ON control_obra.banco_importaciones;
CREATE POLICY banco_importaciones_n80 ON control_obra.banco_importaciones FOR ALL
  USING (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)
  WITH CHECK (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80);

CREATE OR REPLACE VIEW public.banco_importaciones WITH (security_invoker = true) AS
  SELECT id, empresa_id, licitacion_id, formato, archivo, proyecto, fecha, plaza, resumen, mapa, created_by,
         created_at, updated_at
  FROM control_obra.banco_importaciones;

CREATE OR REPLACE FUNCTION public.importar_opus_insumos(
  p_licitacion_id integer,
  p_plaza         text,
  p_fecha         date,
  p_doc           jsonb,
  p_mapa          jsonb DEFAULT '{}'::jsonb,
  p_archivo       text  DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'control_obra', 'public' AS $$
DECLARE
  v_emp   integer := (SELECT control_obra.get_session_empresa_id());
  v_mapa  jsonb   := COALESCE(p_mapa, '{}'::jsonb);
  v_res   jsonb;
  v_map   jsonb;
  n_rec int; n_omit int; n_nuevos int; n_prec int; n_conc int; n_conc_nuevos int; n_pu int;
  n_comp int; n_aux int; n_comp_omit int; v_sin_precio jsonb; v_omitidos jsonb;
BEGIN
  IF (SELECT control_obra.get_session_nivel()) < 80 OR v_emp IS NULL THEN
    RAISE EXCEPTION 'El banco de precios es sólo para administradores y gerentes de obra' USING ERRCODE = '42501';
  END IF;
  IF p_doc IS NULL OR p_doc->>'formato' IS DISTINCT FROM 'opus-insumos/v1' THEN
    RAISE EXCEPTION 'El archivo no es opus-insumos/v1' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_doc->'recursos') IS DISTINCT FROM 'array' OR jsonb_typeof(p_doc->'conceptos') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_doc->'componentes') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Al archivo le faltan recursos, conceptos o componentes' USING ERRCODE = '22023';
  END IF;
  IF p_plaza IS NULL OR p_plaza NOT IN ('cuauhtemoc','chihuahua','juarez','parral','casas_grandes','otra') THEN
    RAISE EXCEPTION 'Plaza no válida: %', p_plaza USING ERRCODE = '22023';
  END IF;
  IF p_fecha IS NULL THEN RAISE EXCEPTION 'Falta la fecha de la propuesta' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM control_obra.licitaciones WHERE id = p_licitacion_id) THEN
    RAISE EXCEPTION 'La licitación no existe o no es de tu empresa' USING ERRCODE = 'P0002';
  END IF;

  -- 1) Recursos del archivo -------------------------------------------------------------------------------------------
  CREATE TEMP TABLE _rec ON COMMIT DROP AS
  SELECT o AS orden,
         btrim(x->>'clave')                                              AS clave,
         lower(btrim(x->>'clave'))                                       AS k,
         COALESCE(NULLIF(btrim(x->>'descripcion'), ''), btrim(x->>'clave')) AS descripcion,
         COALESCE(btrim(x->>'unidad'), '')                               AS unidad,
         x->>'tipo'                                                      AS tipo,
         NULLIF(btrim(x->>'familia'), '')                                AS familia,
         CASE WHEN jsonb_typeof(x->'precio') = 'number' THEN (x->>'precio')::numeric END AS precio,
         COALESCE((x->>'tiene_matriz')::boolean, false)                  AS compuesto,
         x                                                               AS j,
         CASE WHEN v_mapa ? lower(btrim(x->>'clave')) THEN (v_mapa->>lower(btrim(x->>'clave')))::int END AS mapa_id,
         NULL::int                                                       AS insumo_id,
         false                                                           AS nuevo
  FROM jsonb_array_elements(p_doc->'recursos') WITH ORDINALITY AS t(x, o);

  SELECT count(*) INTO n_rec FROM _rec;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('clave', clave, 'tipo', tipo) ORDER BY orden), '[]'::jsonb) INTO v_omitidos
    FROM _rec WHERE COALESCE(clave, '') = '' OR tipo IS NULL
      OR tipo NOT IN ('material','mano_obra','equipo','herramienta','auxiliar','flete');
  DELETE FROM _rec WHERE COALESCE(clave, '') = '' OR tipo IS NULL
      OR tipo NOT IN ('material','mano_obra','equipo','herramienta','auxiliar','flete');
  n_omit := jsonb_array_length(v_omitidos);

  -- Lo que el usuario confirmó (sólo si existe y es del mismo tipo)
  UPDATE _rec r SET insumo_id = i.id FROM control_obra.insumos i WHERE i.id = r.mapa_id AND i.tipo = r.tipo;
  -- Coincidencia exacta por clave + unidad + tipo
  UPDATE _rec r SET insumo_id = i.id FROM control_obra.insumos i
   WHERE r.insumo_id IS NULL AND i.empresa_id = v_emp AND lower(btrim(i.clave)) = r.k
     AND lower(i.unidad) = lower(r.unidad) AND i.tipo = r.tipo;
  -- Nuevos
  WITH ins AS (
    INSERT INTO control_obra.insumos (clave, descripcion, unidad, tipo, familia, compuesto)
    SELECT DISTINCT ON (r.k, lower(r.unidad), r.tipo) r.clave, r.descripcion, r.unidad, r.tipo, r.familia, r.compuesto
      FROM _rec r WHERE r.insumo_id IS NULL
     ORDER BY r.k, lower(r.unidad), r.tipo, r.orden
    ON CONFLICT (empresa_id, clave, unidad, tipo) DO NOTHING
    RETURNING id, clave, unidad, tipo)
  UPDATE _rec r SET insumo_id = ins.id, nuevo = true FROM ins
   WHERE r.insumo_id IS NULL AND lower(btrim(ins.clave)) = r.k AND lower(ins.unidad) = lower(r.unidad) AND ins.tipo = r.tipo;
  UPDATE _rec r SET insumo_id = i.id FROM control_obra.insumos i
   WHERE r.insumo_id IS NULL AND i.empresa_id = v_emp AND lower(btrim(i.clave)) = r.k
     AND lower(i.unidad) = lower(r.unidad) AND i.tipo = r.tipo;
  SELECT count(DISTINCT insumo_id) INTO n_nuevos FROM _rec WHERE nuevo;
  UPDATE control_obra.insumos i SET compuesto = true FROM _rec r WHERE r.insumo_id = i.id AND r.compuesto AND NOT i.compuesto;

  -- Precios
  SELECT COALESCE(jsonb_agg(jsonb_build_object('clave', clave, 'motivo',
           CASE WHEN compuesto THEN 'compuesto' WHEN lower(unidad) = '(%)mo' THEN 'herramienta_pct_mo' ELSE 'sin_precio' END)
           ORDER BY orden), '[]'::jsonb)
    INTO v_sin_precio FROM _rec WHERE compuesto OR precio IS NULL OR precio <= 0;
  INSERT INTO control_obra.insumo_precios (insumo_id, precio, fecha, plaza, fuente, licitacion_id, datos)
  SELECT DISTINCT ON (r.insumo_id) r.insumo_id, r.precio, p_fecha, p_plaza, 'opus', p_licitacion_id,
         jsonb_strip_nulls(jsonb_build_object(
           'clave_opus', r.clave, 'unidad_opus', r.unidad, 'proyecto', p_doc#>>'{proyecto,nombre}',
           'salario_base', r.j#>'{mano_obra,salario_base}', 'sbc', r.j#>'{mano_obra,sbc}', 'fsr', r.j#>'{mano_obra,fsr}',
           'mano_obra', r.j->'mano_obra', 'material', r.j->'material', 'equipo', r.j->'equipo', 'herramienta', r.j->'herramienta'))
    FROM _rec r
   WHERE NOT r.compuesto AND r.precio > 0
   ORDER BY r.insumo_id, r.orden DESC
  ON CONFLICT ON CONSTRAINT insumo_precios_idem_uk DO UPDATE SET precio = EXCLUDED.precio, datos = EXCLUDED.datos;
  GET DIAGNOSTICS n_prec = ROW_COUNT;

  SELECT COALESCE(jsonb_object_agg(k, insumo_id), '{}'::jsonb) INTO v_map FROM (SELECT DISTINCT ON (k) k, insumo_id FROM _rec ORDER BY k, orden) s;

  -- 2) Conceptos -------------------------------------------------------------------------------------------------------
  CREATE TEMP TABLE _con ON COMMIT DROP AS
  SELECT o AS orden,
         COALESCE(NULLIF(btrim(x->>'clave'), ''), NULLIF(btrim(x->>'clave_matriz'), ''), '') AS clave,
         lower(NULLIF(btrim(x->>'clave_matriz'), ''))                    AS km,
         COALESCE(NULLIF(btrim(x->>'descripcion'), ''), NULLIF(btrim(x->>'clave'), ''), NULLIF(btrim(x->>'clave_matriz'), ''), 'Concepto sin descripción') AS descripcion,
         COALESCE(btrim(x->>'unidad'), '')                               AS unidad,
         NULLIF(btrim(x->>'grupo_descripcion'), '')                      AS partida,
         CASE WHEN jsonb_typeof(x->'pu') = 'number' THEN (x->>'pu')::numeric END AS pu,
         CASE WHEN jsonb_typeof(x->'costo_directo') = 'number' THEN (x->>'costo_directo')::numeric END AS cd,
         CASE WHEN jsonb_typeof(x->'cantidad') = 'number' THEN (x->>'cantidad')::numeric END AS cantidad,
         NULL::int AS concepto_id, false AS nuevo
  FROM jsonb_array_elements(p_doc->'conceptos') WITH ORDINALITY AS t(x, o);
  SELECT count(*) INTO n_conc FROM _con;

  UPDATE _con c SET concepto_id = h.id FROM control_obra.conceptos_historicos h
   WHERE h.empresa_id = v_emp AND h.clave = c.clave AND h.unidad = c.unidad
     AND md5(h.descripcion_norm) = md5(control_obra.texto_norm(c.descripcion));
  WITH nuevos AS (
    SELECT DISTINCT ON (c.clave, c.unidad, control_obra.texto_norm(c.descripcion)) c.clave, c.unidad, c.descripcion, c.partida
      FROM _con c WHERE c.concepto_id IS NULL
     ORDER BY c.clave, c.unidad, control_obra.texto_norm(c.descripcion), c.orden),
  ins AS (
    INSERT INTO control_obra.conceptos_historicos (clave, descripcion, unidad, partida)
    SELECT clave, descripcion, unidad, partida FROM nuevos
    RETURNING id, clave, unidad, descripcion_norm)
  UPDATE _con c SET concepto_id = ins.id, nuevo = true FROM ins
   WHERE c.concepto_id IS NULL AND ins.clave = c.clave AND ins.unidad = c.unidad
     AND ins.descripcion_norm = control_obra.texto_norm(c.descripcion);
  SELECT count(DISTINCT concepto_id) INTO n_conc_nuevos FROM _con WHERE nuevo;

  INSERT INTO control_obra.concepto_precios (concepto_id, licitacion_id, fecha, plaza, pu, costo_directo, cantidad, fuente)
  SELECT DISTINCT ON (c.concepto_id) c.concepto_id, p_licitacion_id, p_fecha, p_plaza, c.pu,
         CASE WHEN c.cd > 0 THEN c.cd END, c.cantidad, 'opus'
    FROM _con c WHERE c.pu > 0
   ORDER BY c.concepto_id, c.orden
  ON CONFLICT ON CONSTRAINT concepto_precios_idem_uk
  DO UPDATE SET pu = EXCLUDED.pu, costo_directo = EXCLUDED.costo_directo, cantidad = EXCLUDED.cantidad;
  GET DIAGNOSTICS n_pu = ROW_COUNT;

  -- 3) Componentes (se reescriben los de esta licitación) ---------------------------------------------------------------
  DELETE FROM control_obra.matriz_componentes WHERE licitacion_id = p_licitacion_id;
  DELETE FROM control_obra.insumo_componentes WHERE licitacion_id = p_licitacion_id;

  CREATE TEMP TABLE _cmp ON COMMIT DROP AS
  SELECT o AS orden,
         COALESCE(x->>'matriz', 'concepto')                              AS matriz,
         lower(btrim(x->>'concepto_clave'))                              AS kc,
         lower(btrim(x->>'insumo_clave'))                                AS ki,
         CASE WHEN jsonb_typeof(x->'cantidad') = 'number' THEN (x->>'cantidad')::numeric ELSE 0 END AS cantidad,
         CASE WHEN jsonb_typeof(x->'rendimiento') = 'number' AND (x->>'rendimiento')::numeric > 0
              THEN (x->>'rendimiento')::numeric ELSE 1 END              AS rendimiento,
         COALESCE((x->>'indice')::int, o::int)                           AS indice
  FROM jsonb_array_elements(p_doc->'componentes') WITH ORDINALITY AS t(x, o);

  INSERT INTO control_obra.matriz_componentes (concepto_id, insumo_id, cantidad, rendimiento, licitacion_id, orden)
  SELECT c.concepto_id, (v_map->>m.ki)::int, sum(m.cantidad), max(m.rendimiento), p_licitacion_id, min(m.indice)
    FROM _cmp m
    JOIN (SELECT DISTINCT ON (km) km, concepto_id FROM _con WHERE km IS NOT NULL ORDER BY km, orden) c ON c.km = m.kc
   WHERE m.matriz <> 'auxiliar' AND v_map ? m.ki
   GROUP BY c.concepto_id, (v_map->>m.ki)::int;
  SELECT count(*) INTO n_comp FROM _cmp m
   WHERE m.matriz <> 'auxiliar' AND v_map ? m.ki AND EXISTS (SELECT 1 FROM _con c WHERE c.km = m.kc);

  INSERT INTO control_obra.insumo_componentes (insumo_id, componente_id, cantidad, rendimiento, licitacion_id, orden)
  SELECT (v_map->>m.kc)::int, (v_map->>m.ki)::int, sum(m.cantidad), max(m.rendimiento), p_licitacion_id, min(m.indice)
    FROM _cmp m
   WHERE m.matriz = 'auxiliar' AND v_map ? m.kc AND v_map ? m.ki AND (v_map->>m.kc) <> (v_map->>m.ki)
   GROUP BY (v_map->>m.kc)::int, (v_map->>m.ki)::int;
  SELECT count(*) INTO n_aux FROM _cmp m
   WHERE m.matriz = 'auxiliar' AND v_map ? m.kc AND v_map ? m.ki AND (v_map->>m.kc) <> (v_map->>m.ki);
  SELECT count(*) INTO n_comp_omit FROM _cmp;
  n_comp_omit := n_comp_omit - n_comp - n_aux;

  v_res := jsonb_build_object(
    'proyecto', p_doc#>>'{proyecto,nombre}',
    'recursos', n_rec, 'recursos_importados', (SELECT count(*) FROM jsonb_object_keys(v_map)),
    'insumos_nuevos', n_nuevos, 'insumos_existentes', (SELECT count(DISTINCT insumo_id) FROM _rec WHERE NOT nuevo),
    'precios', n_prec, 'sin_precio', v_sin_precio, 'omitidos', v_omitidos,
    'conceptos', n_conc, 'conceptos_nuevos', n_conc_nuevos, 'conceptos_con_pu', n_pu,
    'conceptos_distintos', (SELECT count(DISTINCT concepto_id) FROM _con),
    'componentes', n_comp, 'componentes_auxiliares', n_aux, 'componentes_omitidos', n_comp_omit);

  INSERT INTO control_obra.banco_importaciones (licitacion_id, archivo, proyecto, fecha, plaza, resumen, mapa)
  VALUES (p_licitacion_id, NULLIF(btrim(p_archivo), ''), p_doc#>>'{proyecto,nombre}', p_fecha, p_plaza, v_res, v_map)
  ON CONFLICT ON CONSTRAINT banco_importaciones_lic_uk DO UPDATE SET
    archivo = EXCLUDED.archivo, proyecto = EXCLUDED.proyecto, fecha = EXCLUDED.fecha, plaza = EXCLUDED.plaza,
    resumen = EXCLUDED.resumen, mapa = EXCLUDED.mapa;

  DROP TABLE IF EXISTS _rec; DROP TABLE IF EXISTS _con; DROP TABLE IF EXISTS _cmp;
  RETURN v_res;
END; $$;

REVOKE ALL ON control_obra.banco_importaciones, public.banco_importaciones FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.banco_importaciones, public.banco_importaciones TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.banco_importaciones_id_seq TO anon, authenticated;
REVOKE ALL ON FUNCTION public.importar_opus_insumos(integer, text, date, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.importar_opus_insumos(integer, text, date, jsonb, jsonb, text) TO anon, authenticated;
