-- 080_licitaciones.sql (US-801) — Esquema de licitaciones, archivos de la convocante, requisitos por sobre,
-- historial de estados y perfiles de convocante.
--
-- PRD: PRD-control-obra-licitaciones.md §3 y D3. Reglas:
--   * Tablas en control_obra con empresa_id; vistas public.* con security_invoker y lista explícita de columnas.
--   * D3: TODO (lectura y escritura) exige control_obra.get_session_nivel() >= 80 en el servidor (RLS).
--   * perfiles_convocante admite empresa_id NULL = filas de fábrica (es_fabrica), sólo lectura.
--   * Los valores de los catálogos (modalidad, estatus, categoría, sobre, origen, estado, plaza) se guardan como
--     slugs sin acentos; la interfaz pone las etiquetas en español.
--   * licitacion_requisitos.empresa_documento_id se crea aquí sin FK: la FK a empresa_documentos la pone 081.
-- Aditiva: no toca tablas, funciones ni políticas existentes.

-- 1) Perfiles de convocante (D7) -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.perfiles_convocante (
  id              serial PRIMARY KEY,
  empresa_id      integer NULL DEFAULT control_obra.get_session_empresa_id() REFERENCES control_obra.empresas(id) ON DELETE CASCADE,  -- NULL = fábrica
  nombre          text NOT NULL,
  descripcion     text NULL,
  naming_pattern  text NULL,                               -- p. ej. '{anexo}_{descripcion}' para el paquete
  sobres_json     jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{clave:'legal', nombre:'Sobre 1 · Legal'}, ...]
  requisitos_json jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{anexo_id, sobre, descripcion, origen, requiere_firma, categoria_expediente}]
  es_fabrica      boolean NOT NULL DEFAULT false,
  activo          boolean NOT NULL DEFAULT true,
  created_by      uuid NULL DEFAULT control_obra.get_session_user_id(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT perfiles_convocante_fabrica_ck CHECK (es_fabrica = (empresa_id IS NULL)),
  CONSTRAINT perfiles_convocante_json_ck CHECK (jsonb_typeof(sobres_json) = 'array' AND jsonb_typeof(requisitos_json) = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS perfiles_convocante_nombre_uidx
  ON control_obra.perfiles_convocante (COALESCE(empresa_id, 0), lower(nombre));

-- 2) Licitaciones ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.licitaciones (
  id                  serial PRIMARY KEY,
  empresa_id          integer NOT NULL DEFAULT control_obra.get_session_empresa_id() REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  codigo              text NOT NULL CHECK (length(btrim(codigo)) > 0),
  nombre              text NOT NULL CHECK (length(btrim(nombre)) > 0),
  convocante          text NULL,
  perfil_id           integer NULL REFERENCES control_obra.perfiles_convocante(id) ON DELETE SET NULL,
  modalidad           text NULL CHECK (modalidad IN ('licitacion_publica','invitacion','adjudicacion_directa','privada')),
  ubicacion           text NULL,
  plaza               text NULL CHECK (plaza IN ('cuauhtemoc','chihuahua','juarez','parral','casas_grandes','otra')),
  visita              timestamptz NULL,
  junta_aclaraciones  timestamptz NULL,
  presentacion        timestamptz NULL,
  fallo               timestamptz NULL,
  inicio_obra         date NULL,
  plazo_dias          integer NULL CHECK (plazo_dias IS NULL OR plazo_dias >= 0),
  anticipo_pct        numeric(5,2) NULL CHECK (anticipo_pct IS NULL OR (anticipo_pct >= 0 AND anticipo_pct <= 100)),
  presupuesto_base    numeric(16,2) NULL,
  monto_propuesto     numeric(16,2) NULL,
  monto_ganador       numeric(16,2) NULL,
  ganador             text NULL,
  estatus             text NOT NULL DEFAULT 'en_preparacion'
                      CHECK (estatus IN ('en_preparacion','presentada','ganada','perdida','desierta','cancelada','no_participamos')),
  bases               jsonb NOT NULL DEFAULT '{}'::jsonb,      -- lo que hoy guarda bases.json de LicitaGen
  opus_proyecto       text NULL,                               -- nombre del .mdf / proyecto de OPUS
  obra_id             integer NULL REFERENCES control_obra.obras(id) ON DELETE SET NULL,
  notas               text NULL,
  created_by          uuid NULL DEFAULT control_obra.get_session_user_id(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licitaciones_bases_ck CHECK (jsonb_typeof(bases) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS licitaciones_empresa_codigo_uidx ON control_obra.licitaciones (empresa_id, lower(codigo));
CREATE INDEX IF NOT EXISTS idx_licitaciones_empresa_estatus ON control_obra.licitaciones (empresa_id, estatus);
CREATE INDEX IF NOT EXISTS idx_licitaciones_obra ON control_obra.licitaciones (obra_id) WHERE obra_id IS NOT NULL;

-- 3) Archivos que publica la dependencia ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.licitacion_archivos (
  id             serial PRIMARY KEY,
  empresa_id     integer NOT NULL DEFAULT control_obra.get_session_empresa_id() REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  licitacion_id  integer NOT NULL REFERENCES control_obra.licitaciones(id) ON DELETE CASCADE,
  categoria      text NOT NULL DEFAULT 'otro'
                 CHECK (categoria IN ('bases','anexo','acta_junta','plano','catalogo','circular','fallo','otro')),
  nombre         text NOT NULL,
  archivo_path   text NOT NULL,           -- bucket licitaciones: empresa/<id>/licitaciones/<lic>/<categoria>/<archivo>
  tamano         bigint NULL CHECK (tamano IS NULL OR tamano >= 0),
  hash_sha256    text NULL CHECK (hash_sha256 IS NULL OR hash_sha256 ~ '^[0-9a-f]{64}$'),
  mime           text NULL,
  notas          text NULL,
  created_by     uuid NULL DEFAULT control_obra.get_session_user_id(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_licitacion_archivos_lic ON control_obra.licitacion_archivos (licitacion_id, categoria);
CREATE INDEX IF NOT EXISTS idx_licitacion_archivos_hash ON control_obra.licitacion_archivos (licitacion_id, hash_sha256);

-- 4) Requisitos por sobre -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.licitacion_requisitos (
  id                    serial PRIMARY KEY,
  empresa_id            integer NOT NULL DEFAULT control_obra.get_session_empresa_id() REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  licitacion_id         integer NOT NULL REFERENCES control_obra.licitaciones(id) ON DELETE CASCADE,
  anexo_id              text NOT NULL CHECK (length(btrim(anexo_id)) > 0),   -- 'AL-01', 'DT-3', 'PE-5'...
  sobre                 text NOT NULL DEFAULT 'legal' CHECK (sobre IN ('legal','tecnico','economico')),
  descripcion           text NOT NULL DEFAULT '',
  origen                text NOT NULL DEFAULT 'se_genera' CHECK (origen IN ('expediente','se_genera','opus','dependencia')),
  estado                text NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente','en_revision','listo','firmado','escaneado','foliado','validado')),
  requiere_firma        boolean NOT NULL DEFAULT false,
  categoria_expediente  text NULL,        -- categoría sugerida de empresa_documentos (US-818)
  empresa_documento_id  integer NULL,     -- FK a empresa_documentos en 081 (D8: apunta, no copia)
  archivo_path          text NULL,        -- archivo final del requisito en el bucket licitaciones
  responsable           text NULL,
  orden                 integer NOT NULL DEFAULT 0,
  notas                 text NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licitacion_requisitos_anexo_uk UNIQUE (licitacion_id, anexo_id)
);
CREATE INDEX IF NOT EXISTS idx_licitacion_requisitos_lic ON control_obra.licitacion_requisitos (licitacion_id, sobre, orden);

-- 5) Historial de estados (lo escribe el trigger; nadie inserta a mano) ----------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.licitacion_requisito_historial (
  id               bigserial PRIMARY KEY,
  empresa_id       integer NOT NULL DEFAULT control_obra.get_session_empresa_id() REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  requisito_id     integer NOT NULL REFERENCES control_obra.licitacion_requisitos(id) ON DELETE CASCADE,
  licitacion_id    integer NOT NULL REFERENCES control_obra.licitaciones(id) ON DELETE CASCADE,
  estado_anterior  text NULL,
  estado_nuevo     text NOT NULL,
  usuario_id       uuid NULL,
  nota             text NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_licitacion_req_hist_req ON control_obra.licitacion_requisito_historial (requisito_id, created_at);

-- La nota del cambio llega por la variable de transacción control_obra.nota_estado (la RPC que cambie el estado
-- hace set_config('control_obra.nota_estado', p_nota, true) antes del UPDATE). Sin ella la nota queda NULL.
CREATE OR REPLACE FUNCTION control_obra.trg_licitacion_requisito_historial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'control_obra', 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO control_obra.licitacion_requisito_historial
      (empresa_id, requisito_id, licitacion_id, estado_anterior, estado_nuevo, usuario_id, nota)
    VALUES
      (NEW.empresa_id, NEW.id, NEW.licitacion_id,
       CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado END, NEW.estado,
       control_obra.get_session_user_id(),
       NULLIF(current_setting('control_obra.nota_estado', true), ''));
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION control_obra.trg_licitacion_requisito_historial() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_licitacion_requisito_historial ON control_obra.licitacion_requisitos;
CREATE TRIGGER trg_licitacion_requisito_historial
  AFTER INSERT OR UPDATE OF estado ON control_obra.licitacion_requisitos
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licitacion_requisito_historial();

-- updated_at y empresa coherente con la licitación (un hijo no puede colgar de la licitación de otra empresa)
CREATE OR REPLACE FUNCTION control_obra.trg_licit_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'control_obra', 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION control_obra.trg_licit_hijo_empresa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public' AS $$
DECLARE v_emp integer;
BEGIN
  SELECT empresa_id INTO v_emp FROM control_obra.licitaciones WHERE id = NEW.licitacion_id;
  IF v_emp IS NULL OR v_emp <> NEW.empresa_id THEN
    RAISE EXCEPTION 'La licitación % no pertenece a la empresa %', NEW.licitacion_id, NEW.empresa_id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION control_obra.trg_licit_hijo_empresa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_licitaciones_touch ON control_obra.licitaciones;
CREATE TRIGGER trg_licitaciones_touch BEFORE UPDATE ON control_obra.licitaciones
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();
DROP TRIGGER IF EXISTS trg_licitacion_requisitos_touch ON control_obra.licitacion_requisitos;
CREATE TRIGGER trg_licitacion_requisitos_touch BEFORE UPDATE ON control_obra.licitacion_requisitos
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();
DROP TRIGGER IF EXISTS trg_perfiles_convocante_touch ON control_obra.perfiles_convocante;
CREATE TRIGGER trg_perfiles_convocante_touch BEFORE UPDATE ON control_obra.perfiles_convocante
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();
DROP TRIGGER IF EXISTS trg_licitacion_archivos_empresa ON control_obra.licitacion_archivos;
CREATE TRIGGER trg_licitacion_archivos_empresa BEFORE INSERT OR UPDATE OF licitacion_id, empresa_id ON control_obra.licitacion_archivos
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_hijo_empresa();
DROP TRIGGER IF EXISTS trg_licitacion_requisitos_empresa ON control_obra.licitacion_requisitos;
CREATE TRIGGER trg_licitacion_requisitos_empresa BEFORE INSERT OR UPDATE OF licitacion_id, empresa_id ON control_obra.licitacion_requisitos
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_hijo_empresa();

-- 6) RLS (D3: nivel >= 80 para leer y escribir) ---------------------------------------------------------------
ALTER TABLE control_obra.perfiles_convocante ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.licitaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.licitacion_archivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.licitacion_requisitos ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.licitacion_requisito_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS perfiles_convocante_sel ON control_obra.perfiles_convocante;
CREATE POLICY perfiles_convocante_sel ON control_obra.perfiles_convocante FOR SELECT
  USING (control_obra.get_session_nivel() >= 80
         AND (empresa_id IS NULL OR empresa_id = control_obra.get_session_empresa_id()));
DROP POLICY IF EXISTS perfiles_convocante_ins ON control_obra.perfiles_convocante;
CREATE POLICY perfiles_convocante_ins ON control_obra.perfiles_convocante FOR INSERT
  WITH CHECK (control_obra.get_session_nivel() >= 80 AND NOT es_fabrica
              AND empresa_id = control_obra.get_session_empresa_id());
DROP POLICY IF EXISTS perfiles_convocante_upd ON control_obra.perfiles_convocante;
CREATE POLICY perfiles_convocante_upd ON control_obra.perfiles_convocante FOR UPDATE
  USING (control_obra.get_session_nivel() >= 80 AND NOT es_fabrica AND empresa_id = control_obra.get_session_empresa_id())
  WITH CHECK (control_obra.get_session_nivel() >= 80 AND NOT es_fabrica AND empresa_id = control_obra.get_session_empresa_id());
DROP POLICY IF EXISTS perfiles_convocante_del ON control_obra.perfiles_convocante;
CREATE POLICY perfiles_convocante_del ON control_obra.perfiles_convocante FOR DELETE
  USING (control_obra.get_session_nivel() >= 80 AND NOT es_fabrica AND empresa_id = control_obra.get_session_empresa_id());

DROP POLICY IF EXISTS licitaciones_n80 ON control_obra.licitaciones;
CREATE POLICY licitaciones_n80 ON control_obra.licitaciones FOR ALL
  USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80)
  WITH CHECK (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80);
DROP POLICY IF EXISTS licitacion_archivos_n80 ON control_obra.licitacion_archivos;
CREATE POLICY licitacion_archivos_n80 ON control_obra.licitacion_archivos FOR ALL
  USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80)
  WITH CHECK (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80);
DROP POLICY IF EXISTS licitacion_requisitos_n80 ON control_obra.licitacion_requisitos;
CREATE POLICY licitacion_requisitos_n80 ON control_obra.licitacion_requisitos FOR ALL
  USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80)
  WITH CHECK (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80);
-- Historial: sólo lectura para la app; lo escribe el trigger (SECURITY DEFINER, dueño de la tabla)
DROP POLICY IF EXISTS licitacion_req_hist_sel ON control_obra.licitacion_requisito_historial;
CREATE POLICY licitacion_req_hist_sel ON control_obra.licitacion_requisito_historial FOR SELECT
  USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80);

GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.perfiles_convocante, control_obra.licitaciones,
  control_obra.licitacion_archivos, control_obra.licitacion_requisitos TO anon, authenticated;
GRANT SELECT ON control_obra.licitacion_requisito_historial TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.perfiles_convocante_id_seq, control_obra.licitaciones_id_seq,
  control_obra.licitacion_archivos_id_seq, control_obra.licitacion_requisitos_id_seq TO anon, authenticated;

-- 7) Vistas públicas (security_invoker, lista explícita; columnas nuevas siempre al final) ---------------------
CREATE OR REPLACE VIEW public.perfiles_convocante WITH (security_invoker = true) AS
  SELECT id, empresa_id, nombre, descripcion, naming_pattern, sobres_json, requisitos_json, es_fabrica, activo,
         created_by, created_at, updated_at
  FROM control_obra.perfiles_convocante;

CREATE OR REPLACE VIEW public.licitaciones WITH (security_invoker = true) AS
  SELECT id, empresa_id, codigo, nombre, convocante, perfil_id, modalidad, ubicacion, plaza, visita,
         junta_aclaraciones, presentacion, fallo, inicio_obra, plazo_dias, anticipo_pct, presupuesto_base,
         monto_propuesto, monto_ganador, ganador, estatus, bases, opus_proyecto, obra_id, notas, created_by,
         created_at, updated_at
  FROM control_obra.licitaciones;

CREATE OR REPLACE VIEW public.licitacion_archivos WITH (security_invoker = true) AS
  SELECT id, empresa_id, licitacion_id, categoria, nombre, archivo_path, tamano, hash_sha256, mime, notas,
         created_by, created_at
  FROM control_obra.licitacion_archivos;

CREATE OR REPLACE VIEW public.licitacion_requisitos WITH (security_invoker = true) AS
  SELECT id, empresa_id, licitacion_id, anexo_id, sobre, descripcion, origen, estado, requiere_firma,
         categoria_expediente, empresa_documento_id, archivo_path, responsable, orden, notas, created_at, updated_at
  FROM control_obra.licitacion_requisitos;

CREATE OR REPLACE VIEW public.licitacion_requisito_historial WITH (security_invoker = true) AS
  SELECT id, empresa_id, requisito_id, licitacion_id, estado_anterior, estado_nuevo, usuario_id, nota, created_at
  FROM control_obra.licitacion_requisito_historial;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.perfiles_convocante, public.licitaciones, public.licitacion_archivos,
  public.licitacion_requisitos TO anon, authenticated;
GRANT SELECT ON public.licitacion_requisito_historial TO anon, authenticated;

-- 8) Privilegios mínimos (aplicado como 080_licitaciones_grants). Los privilegios por defecto del proyecto dan
--    ALL (incluido TRUNCATE, que no pasa por RLS) a anon/authenticated en tablas y vistas nuevas: se quitan y se
--    deja sólo lo que la app usa.
REVOKE ALL ON control_obra.perfiles_convocante, control_obra.licitaciones, control_obra.licitacion_archivos,
  control_obra.licitacion_requisitos, control_obra.licitacion_requisito_historial,
  public.perfiles_convocante, public.licitaciones, public.licitacion_archivos, public.licitacion_requisitos,
  public.licitacion_requisito_historial FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.perfiles_convocante, control_obra.licitaciones,
  control_obra.licitacion_archivos, control_obra.licitacion_requisitos,
  public.perfiles_convocante, public.licitaciones, public.licitacion_archivos, public.licitacion_requisitos
  TO anon, authenticated;
GRANT SELECT ON control_obra.licitacion_requisito_historial, public.licitacion_requisito_historial TO anon, authenticated;
