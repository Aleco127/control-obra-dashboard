-- 107_licitacion_precios.sql (épica H: US-829) — Lista de precios de una licitación.
--
-- Cada renglón es un insumo del banco elegido para un concurso, con el precio que se cargará a OPUS (sin IVA). Guarda
-- también de dónde salió la propuesta (precio vigente del banco al agregarlo: precio, fecha, plaza y fuente) para
-- poder marcar en ámbar lo viejo o de otra plaza y saber si el usuario lo ajustó a mano o con un porcentaje.
-- `datos` copia del precio de origen lo que OPUS necesita además del costo (mano de obra: salario_base, sbc, fsr,
-- factor_salario_base). `cantidad` es la cantidad estimada que sale de explotar el catálogo del concurso con las
-- matrices históricas (informativa).
-- Mismo patrón que el banco: empresa_id por sesión, RLS nivel >= 80 en lectura y escritura, vista public con lista
-- explícita de columnas y security_invoker, trigger trg_banco_empresa (insumo y licitación de la misma empresa).
-- Las escrituras van por PostgREST (la RLS manda), como los requisitos de la épica C.

CREATE TABLE IF NOT EXISTS control_obra.licitacion_precios (
  id              bigserial PRIMARY KEY,
  empresa_id      integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                  REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  licitacion_id   integer NOT NULL REFERENCES control_obra.licitaciones(id) ON DELETE CASCADE,
  insumo_id       integer NOT NULL REFERENCES control_obra.insumos(id) ON DELETE CASCADE,
  precio          numeric(16,4) NOT NULL CHECK (precio >= 0),          -- sin IVA, el que va a OPUS
  precio_banco    numeric(16,4) NULL CHECK (precio_banco >= 0),        -- precio vigente propuesto por el banco
  fecha_banco     date NULL,
  plaza_banco     text NULL CHECK (plaza_banco IN ('cuauhtemoc','chihuahua','juarez','parral','casas_grandes','otra')),
  fuente_banco    text NULL,
  ajuste_pct      numeric(9,4) NULL,                                   -- último ajuste en lote sobre precio_banco
  manual          boolean NOT NULL DEFAULT false,                      -- el precio se capturó a mano
  cantidad        numeric(18,6) NULL,                                  -- estimada desde el catálogo del concurso
  origen          text NOT NULL DEFAULT 'busqueda' CHECK (origen IN ('busqueda','catalogo')),
  datos           jsonb NOT NULL DEFAULT '{}'::jsonb,
  orden           integer NOT NULL DEFAULT 0,
  notas           text NULL,
  created_by      uuid NULL DEFAULT control_obra.get_session_user_id(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licitacion_precios_uk UNIQUE (licitacion_id, insumo_id)
);
CREATE INDEX IF NOT EXISTS idx_licitacion_precios_insumo ON control_obra.licitacion_precios (insumo_id);
CREATE INDEX IF NOT EXISTS idx_licitacion_precios_empresa ON control_obra.licitacion_precios (empresa_id);

DROP TRIGGER IF EXISTS trg_licitacion_precios_empresa ON control_obra.licitacion_precios;
CREATE TRIGGER trg_licitacion_precios_empresa BEFORE INSERT OR UPDATE ON control_obra.licitacion_precios
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_banco_empresa();
DROP TRIGGER IF EXISTS trg_licitacion_precios_touch ON control_obra.licitacion_precios;
CREATE TRIGGER trg_licitacion_precios_touch BEFORE UPDATE ON control_obra.licitacion_precios
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();

-- Al fusionar dos insumos (096), los renglones del origen pasan al destino; si el destino ya estaba en esa misma
-- licitación se queda el del destino. Corre AFTER INSERT en insumo_fusiones, antes de que fusionar_insumos borre el
-- origen (si no, el ON DELETE CASCADE se llevaría el renglón).
CREATE OR REPLACE FUNCTION control_obra.trg_insumo_fusion_licitacion_precios()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
BEGIN
  IF NEW.destino_id IS NOT NULL THEN
    DELETE FROM control_obra.licitacion_precios o
     WHERE o.insumo_id = NEW.origen_id
       AND EXISTS (SELECT 1 FROM control_obra.licitacion_precios d
                    WHERE d.insumo_id = NEW.destino_id AND d.licitacion_id = o.licitacion_id);
    UPDATE control_obra.licitacion_precios SET insumo_id = NEW.destino_id WHERE insumo_id = NEW.origen_id;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION control_obra.trg_insumo_fusion_licitacion_precios() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_insumo_fusion_licitacion_precios ON control_obra.insumo_fusiones;
CREATE TRIGGER trg_insumo_fusion_licitacion_precios AFTER INSERT ON control_obra.insumo_fusiones
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_insumo_fusion_licitacion_precios();

ALTER TABLE control_obra.licitacion_precios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS licitacion_precios_n80 ON control_obra.licitacion_precios;
CREATE POLICY licitacion_precios_n80 ON control_obra.licitacion_precios FOR ALL
  USING (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)
  WITH CHECK (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80);

CREATE OR REPLACE VIEW public.licitacion_precios WITH (security_invoker = true) AS
  SELECT id, empresa_id, licitacion_id, insumo_id, precio, precio_banco, fecha_banco, plaza_banco, fuente_banco,
         ajuste_pct, manual, cantidad, origen, datos, orden, notas, created_by, created_at, updated_at
  FROM control_obra.licitacion_precios;

REVOKE ALL ON control_obra.licitacion_precios, public.licitacion_precios FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.licitacion_precios, public.licitacion_precios TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.licitacion_precios_id_seq TO anon, authenticated;
