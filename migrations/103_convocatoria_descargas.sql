-- 103_convocatoria_descargas.sql (tablas de US-848, adelantadas en la épica F de servidor) — Cola de descarga de
-- documentos de las convocatorias marcadas «Me interesa» y los archivos ya bajados al bucket `licitaciones`.
--
-- Sólo las tablas: la lógica (encolar al marcar, recolector que descarga, función portal-credencial) es de US-848.
--   convocatoria_descargas  una fila por (empresa, convocatoria): estado pendiente / en_curso / lista / fallo,
--                           intentos, error, fechas.
--   convocatoria_archivos   nombre, tipo, tamaño, hash_sha256, archivo_path (bucket licitaciones:
--                           empresa/<id>/convocatorias/<convocatoria>/<archivo>), fecha de publicación en el portal.
--                           Único (empresa, convocatoria, hash) para no duplicar por contenido.
-- RLS n80 por empresa (lectura en la app); el recolector escribe con service_role. Vistas public con security_invoker.
-- Aditiva.

CREATE TABLE IF NOT EXISTS control_obra.convocatoria_descargas (
  id               serial PRIMARY KEY,
  empresa_id       integer NOT NULL DEFAULT control_obra.get_session_empresa_id() REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  convocatoria_id  bigint NOT NULL REFERENCES control_obra.convocatorias(id) ON DELETE CASCADE,
  estado           text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_curso','lista','fallo')),
  intentos         integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  error            text NULL,
  solicitado_por   uuid NULL DEFAULT control_obra.get_session_user_id(),
  solicitado_at    timestamptz NOT NULL DEFAULT now(),
  inicio_at        timestamptz NULL,
  fin_at           timestamptz NULL,
  revisado_at      timestamptz NULL,      -- última revisión de documentos nuevos (cada 24 h mientras siga abierta)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT convocatoria_descargas_uk UNIQUE (empresa_id, convocatoria_id)
);
CREATE INDEX IF NOT EXISTS idx_convocatoria_descargas_estado ON control_obra.convocatoria_descargas (estado, solicitado_at);
CREATE INDEX IF NOT EXISTS idx_convocatoria_descargas_conv ON control_obra.convocatoria_descargas (convocatoria_id);

CREATE TABLE IF NOT EXISTS control_obra.convocatoria_archivos (
  id                  serial PRIMARY KEY,
  empresa_id          integer NOT NULL DEFAULT control_obra.get_session_empresa_id() REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  convocatoria_id     bigint NOT NULL REFERENCES control_obra.convocatorias(id) ON DELETE CASCADE,
  nombre              text NOT NULL CHECK (length(btrim(nombre)) > 0),
  tipo                text NULL,                    -- tipo de documento según el portal (Bases, Anexo técnico, Acta...)
  tamano              bigint NULL CHECK (tamano IS NULL OR tamano >= 0),
  hash_sha256         text NOT NULL CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
  archivo_path        text NOT NULL,
  mime                text NULL,
  publicado_portal_at timestamptz NULL,
  origen_url          text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT convocatoria_archivos_hash_uk UNIQUE (empresa_id, convocatoria_id, hash_sha256)
);
CREATE INDEX IF NOT EXISTS idx_convocatoria_archivos_conv ON control_obra.convocatoria_archivos (empresa_id, convocatoria_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_convocatoria_archivos_conv_fk ON control_obra.convocatoria_archivos (convocatoria_id);

DROP TRIGGER IF EXISTS trg_convocatoria_descargas_touch ON control_obra.convocatoria_descargas;
CREATE TRIGGER trg_convocatoria_descargas_touch BEFORE UPDATE ON control_obra.convocatoria_descargas
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_convocatorias_touch();

ALTER TABLE control_obra.convocatoria_descargas ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.convocatoria_archivos ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['convocatoria_descargas','convocatoria_archivos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON control_obra.%I', t || '_n80', t);
    EXECUTE format('CREATE POLICY %I ON control_obra.%I FOR ALL
      USING (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)
      WITH CHECK (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)',
      t || '_n80', t);
    EXECUTE format('REVOKE ALL ON control_obra.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.%I TO anon, authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE control_obra.%I TO anon, authenticated', t || '_id_seq');
    EXECUTE format('GRANT ALL ON control_obra.%I TO service_role', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE control_obra.%I TO service_role', t || '_id_seq');
  END LOOP;
END $$;

CREATE OR REPLACE VIEW public.convocatoria_descargas WITH (security_invoker = true) AS
  SELECT id, empresa_id, convocatoria_id, estado, intentos, error, solicitado_por, solicitado_at, inicio_at, fin_at,
         revisado_at, created_at, updated_at
  FROM control_obra.convocatoria_descargas;
CREATE OR REPLACE VIEW public.convocatoria_archivos WITH (security_invoker = true) AS
  SELECT id, empresa_id, convocatoria_id, nombre, tipo, tamano, hash_sha256, archivo_path, mime, publicado_portal_at,
         origen_url, created_at
  FROM control_obra.convocatoria_archivos;
REVOKE ALL ON public.convocatoria_descargas, public.convocatoria_archivos FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.convocatoria_descargas TO anon, authenticated;
GRANT SELECT, DELETE ON public.convocatoria_archivos TO anon, authenticated;   -- los archivos los escribe el recolector
