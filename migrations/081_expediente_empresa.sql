-- 081_expediente_empresa.sql (US-802) — Expediente de la empresa: datos legales 1:1, documentos con vigencia
-- (versionados por reemplaza_id), personal técnico, obras ejecutadas y maquinaria.
--
-- Reglas (PRD §3, D3, D8):
--   * empresa_expediente NO duplica lo que ya vive en control_obra.empresas (razon_social, rfc, direccion,
--     representante_legal, registro_patronal). El registro patronal del IMSS ES empresas.registro_patronal:
--     por eso aquí no hay columna imss_registro (decisión documentada en progress.txt).
--   * El estado de un documento (vigente / por_vencer / vencido / reemplazado / sin_vencimiento) NO se guarda:
--     lo calcula la vista public.empresa_documentos_estado con la fecha civil de America/Mexico_City.
--   * RLS: empresa de la sesión y get_session_nivel() >= 80 para leer y escribir.
--   * Cierra la FK pendiente de 080: licitacion_requisitos.empresa_documento_id -> empresa_documentos.
-- Aditiva: no toca tablas, funciones ni políticas existentes (sólo agrega la FK a la tabla nueva de 080).

-- 1) Datos legales (1:1 con empresas) ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.empresa_expediente (
  empresa_id                  integer PRIMARY KEY DEFAULT control_obra.get_session_empresa_id()
                              REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  representante_cargo         text NULL,           -- p. ej. «Administrador único»
  representante_rfc           text NULL,
  escritura_constitutiva      text NULL,           -- número, fecha, notario y lugar de la escritura
  escritura_fecha             date NULL,
  poder_notarial              text NULL,           -- número y notario del poder del representante
  capital_contable            numeric(16,2) NULL,
  capital_contable_fecha      date NULL,           -- fecha del estado financiero que lo respalda
  infonavit_registro          text NULL,
  cmic_registro               text NULL,
  padron_contratistas         text NULL,           -- número de registro en el padrón (estatal / municipal)
  padron_contratistas_vigencia date NULL,
  poliza_rc_numero            text NULL,
  poliza_rc_aseguradora       text NULL,
  poliza_rc_monto             numeric(16,2) NULL,
  poliza_rc_vigencia          date NULL,
  afianzadora                 text NULL,
  notas                       text NULL,
  updated_by                  uuid NULL DEFAULT control_obra.get_session_user_id(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- 2) Documentos con vigencia ---------------------------------------------------------------------------------------
-- Categorías: las 14 de LicitaGen + padron_contratistas y declaracion_anual.
CREATE TABLE IF NOT EXISTS control_obra.empresa_documentos (
  id                 serial PRIMARY KEY,
  empresa_id         integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                     REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  categoria          text NOT NULL CHECK (categoria IN (
                       'opinion_sat','opinion_imss','opinion_infonavit','identificacion','acta_constitutiva','poder',
                       'constancia_fiscal','comprobante_domicilio','estados_financieros','cmic','colegio','poliza_rc',
                       'curriculum','otro','padron_contratistas','declaracion_anual')),
  nombre             text NOT NULL CHECK (length(btrim(nombre)) > 0),
  archivo_path       text NULL,          -- bucket licitaciones: empresa/<id>/expediente/<categoria>/<archivo>
  tamano             bigint NULL CHECK (tamano IS NULL OR tamano >= 0),
  mime               text NULL,
  fecha_emision      date NULL,
  fecha_vencimiento  date NULL,
  reemplaza_id       integer NULL REFERENCES control_obra.empresa_documentos(id) ON DELETE SET NULL,
  hash_sha256        text NULL CHECK (hash_sha256 IS NULL OR hash_sha256 ~ '^[0-9a-f]{64}$'),
  notas              text NULL,
  created_by         uuid NULL DEFAULT control_obra.get_session_user_id(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresa_documentos_fechas_ck CHECK (fecha_vencimiento IS NULL OR fecha_emision IS NULL OR fecha_vencimiento >= fecha_emision),
  CONSTRAINT empresa_documentos_no_self_ck CHECK (reemplaza_id IS NULL OR reemplaza_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_empresa_documentos_cat ON control_obra.empresa_documentos (empresa_id, categoria);
-- Una versión sólo puede ser reemplazada una vez (la cadena de renovaciones es lineal)
CREATE UNIQUE INDEX IF NOT EXISTS empresa_documentos_reemplaza_uidx ON control_obra.empresa_documentos (reemplaza_id) WHERE reemplaza_id IS NOT NULL;

-- 3) Personal técnico ----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.personal_tecnico (
  id                   serial PRIMARY KEY,
  empresa_id           integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                       REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  empleado_id          integer NULL REFERENCES control_obra.empleados(id) ON DELETE SET NULL,
  nombre               text NOT NULL CHECK (length(btrim(nombre)) > 0),
  puesto               text NULL,
  profesion            text NULL,
  cedula_profesional   text NULL,
  anios_experiencia    integer NULL CHECK (anios_experiencia IS NULL OR anios_experiencia >= 0),
  cv_path              text NULL,
  cedula_path          text NULL,
  identificacion_path  text NULL,
  activo               boolean NOT NULL DEFAULT true,
  notas                text NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_personal_tecnico_empresa ON control_obra.personal_tecnico (empresa_id, activo);
CREATE UNIQUE INDEX IF NOT EXISTS personal_tecnico_empleado_uidx ON control_obra.personal_tecnico (empresa_id, empleado_id) WHERE empleado_id IS NOT NULL;

-- 4) Obras ejecutadas (currículum) ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.obras_ejecutadas (
  id               serial PRIMARY KEY,
  empresa_id       integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                   REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  obra_id          integer NULL REFERENCES control_obra.obras(id) ON DELETE SET NULL,
  nombre           text NOT NULL CHECK (length(btrim(nombre)) > 0),
  cliente          text NULL,
  contrato         text NULL,            -- número de contrato
  monto            numeric(16,2) NULL,   -- con IVA, como el presupuesto de la obra
  fecha_inicio     date NULL,
  fecha_fin        date NULL,
  modalidad        text NULL CHECK (modalidad IN ('licitacion_publica','invitacion','adjudicacion_directa','privada')),
  ubicacion        text NULL,
  descripcion      text NULL,
  contrato_path    text NULL,
  acta_path        text NULL,            -- acta de entrega-recepción
  evidencia_paths  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidencia_paths) = 'array'),
  notas            text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT obras_ejecutadas_fechas_ck CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio)
);
CREATE INDEX IF NOT EXISTS idx_obras_ejecutadas_empresa ON control_obra.obras_ejecutadas (empresa_id, fecha_fin DESC);
CREATE UNIQUE INDEX IF NOT EXISTS obras_ejecutadas_obra_uidx ON control_obra.obras_ejecutadas (empresa_id, obra_id) WHERE obra_id IS NOT NULL;

-- 5) Maquinaria y equipo -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.maquinaria (
  id                 serial PRIMARY KEY,
  empresa_id         integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                     REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  descripcion        text NOT NULL CHECK (length(btrim(descripcion)) > 0),
  marca              text NULL,
  modelo             text NULL,
  anio               integer NULL CHECK (anio IS NULL OR anio BETWEEN 1950 AND 2100),
  serie              text NULL,
  capacidad          text NULL,
  factura            text NULL,          -- folio o UUID de la factura
  factura_path       text NULL,
  poliza             text NULL,          -- número de póliza
  poliza_path        text NULL,
  poliza_vigencia    date NULL,          -- entra a los avisos de vencimiento (US-809/US-812)
  estado_operativo   text NOT NULL DEFAULT 'operativo' CHECK (estado_operativo IN ('operativo','en_reparacion','fuera_de_servicio','vendido')),
  propia             boolean NOT NULL DEFAULT true,   -- false = rentada
  notas              text NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maquinaria_empresa ON control_obra.maquinaria (empresa_id);

-- 6) Triggers: updated_at y FK pendiente de 080 ----------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_empresa_expediente_touch ON control_obra.empresa_expediente;
CREATE TRIGGER trg_empresa_expediente_touch BEFORE UPDATE ON control_obra.empresa_expediente
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();
DROP TRIGGER IF EXISTS trg_empresa_documentos_touch ON control_obra.empresa_documentos;
CREATE TRIGGER trg_empresa_documentos_touch BEFORE UPDATE ON control_obra.empresa_documentos
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();
DROP TRIGGER IF EXISTS trg_personal_tecnico_touch ON control_obra.personal_tecnico;
CREATE TRIGGER trg_personal_tecnico_touch BEFORE UPDATE ON control_obra.personal_tecnico
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();
DROP TRIGGER IF EXISTS trg_obras_ejecutadas_touch ON control_obra.obras_ejecutadas;
CREATE TRIGGER trg_obras_ejecutadas_touch BEFORE UPDATE ON control_obra.obras_ejecutadas
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();
DROP TRIGGER IF EXISTS trg_maquinaria_touch ON control_obra.maquinaria;
CREATE TRIGGER trg_maquinaria_touch BEFORE UPDATE ON control_obra.maquinaria
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();

-- El documento reemplazado debe ser de la misma empresa
CREATE OR REPLACE FUNCTION control_obra.trg_empresa_documentos_reemplaza()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public' AS $$
BEGIN
  IF NEW.reemplaza_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM control_obra.empresa_documentos d WHERE d.id = NEW.reemplaza_id AND d.empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'El documento que se renueva no pertenece a la empresa' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION control_obra.trg_empresa_documentos_reemplaza() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_empresa_documentos_reemplaza ON control_obra.empresa_documentos;
CREATE TRIGGER trg_empresa_documentos_reemplaza BEFORE INSERT OR UPDATE OF reemplaza_id, empresa_id ON control_obra.empresa_documentos
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_empresa_documentos_reemplaza();

ALTER TABLE control_obra.licitacion_requisitos DROP CONSTRAINT IF EXISTS licitacion_requisitos_empresa_documento_fk;
ALTER TABLE control_obra.licitacion_requisitos
  ADD CONSTRAINT licitacion_requisitos_empresa_documento_fk
  FOREIGN KEY (empresa_documento_id) REFERENCES control_obra.empresa_documentos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_licitacion_requisitos_doc ON control_obra.licitacion_requisitos (empresa_documento_id) WHERE empresa_documento_id IS NOT NULL;

-- 7) RLS (D3) -------------------------------------------------------------------------------------------------------
ALTER TABLE control_obra.empresa_expediente ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.empresa_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.personal_tecnico ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.obras_ejecutadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.maquinaria ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['empresa_expediente','empresa_documentos','personal_tecnico','obras_ejecutadas','maquinaria'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON control_obra.%I', t || '_n80', t);
    EXECUTE format('CREATE POLICY %I ON control_obra.%I FOR ALL
      USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80)
      WITH CHECK (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 80)', t || '_n80', t);
  END LOOP;
END $$;

-- 8) Vistas públicas -------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.empresa_expediente WITH (security_invoker = true) AS
  SELECT empresa_id, representante_cargo, representante_rfc, escritura_constitutiva, escritura_fecha, poder_notarial,
         capital_contable, capital_contable_fecha, infonavit_registro, cmic_registro, padron_contratistas,
         padron_contratistas_vigencia, poliza_rc_numero, poliza_rc_aseguradora, poliza_rc_monto, poliza_rc_vigencia,
         afianzadora, notas, updated_by, created_at, updated_at
  FROM control_obra.empresa_expediente;

CREATE OR REPLACE VIEW public.empresa_documentos WITH (security_invoker = true) AS
  SELECT id, empresa_id, categoria, nombre, archivo_path, tamano, mime, fecha_emision, fecha_vencimiento, reemplaza_id,
         hash_sha256, notas, created_by, created_at, updated_at
  FROM control_obra.empresa_documentos;

-- Estado calculado con la fecha civil de México (nunca se guarda). reemplazado = alguna versión posterior lo cita.
CREATE OR REPLACE VIEW public.empresa_documentos_estado WITH (security_invoker = true) AS
  SELECT d.id, d.empresa_id, d.categoria, d.nombre, d.archivo_path, d.tamano, d.mime, d.fecha_emision,
         d.fecha_vencimiento, d.reemplaza_id, d.hash_sha256, d.notas, d.created_by, d.created_at, d.updated_at,
         r.id AS reemplazado_por_id,
         CASE
           WHEN r.id IS NOT NULL THEN 'reemplazado'
           WHEN d.fecha_vencimiento IS NULL THEN 'sin_vencimiento'
           WHEN d.fecha_vencimiento < h.hoy THEN 'vencido'
           WHEN d.fecha_vencimiento <= h.hoy + 30 THEN 'por_vencer'
           ELSE 'vigente'
         END AS estado,
         CASE WHEN d.fecha_vencimiento IS NULL THEN NULL ELSE d.fecha_vencimiento - h.hoy END AS dias_restantes
  FROM control_obra.empresa_documentos d
  CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE 'America/Mexico_City')::date AS hoy) h
  LEFT JOIN control_obra.empresa_documentos r ON r.reemplaza_id = d.id;

CREATE OR REPLACE VIEW public.personal_tecnico WITH (security_invoker = true) AS
  SELECT id, empresa_id, empleado_id, nombre, puesto, profesion, cedula_profesional, anios_experiencia, cv_path,
         cedula_path, identificacion_path, activo, notas, created_at, updated_at
  FROM control_obra.personal_tecnico;

CREATE OR REPLACE VIEW public.obras_ejecutadas WITH (security_invoker = true) AS
  SELECT id, empresa_id, obra_id, nombre, cliente, contrato, monto, fecha_inicio, fecha_fin, modalidad, ubicacion,
         descripcion, contrato_path, acta_path, evidencia_paths, notas, created_at, updated_at
  FROM control_obra.obras_ejecutadas;

CREATE OR REPLACE VIEW public.maquinaria WITH (security_invoker = true) AS
  SELECT id, empresa_id, descripcion, marca, modelo, anio, serie, capacidad, factura, factura_path, poliza, poliza_path,
         poliza_vigencia, estado_operativo, propia, notas, created_at, updated_at
  FROM control_obra.maquinaria;

-- 9) Privilegios mínimos (sin TRUNCATE/REFERENCES/TRIGGER de los privilegios por defecto) -------------------------
REVOKE ALL ON control_obra.empresa_expediente, control_obra.empresa_documentos, control_obra.personal_tecnico,
  control_obra.obras_ejecutadas, control_obra.maquinaria,
  public.empresa_expediente, public.empresa_documentos, public.empresa_documentos_estado, public.personal_tecnico,
  public.obras_ejecutadas, public.maquinaria FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.empresa_expediente, control_obra.empresa_documentos,
  control_obra.personal_tecnico, control_obra.obras_ejecutadas, control_obra.maquinaria,
  public.empresa_expediente, public.empresa_documentos, public.personal_tecnico, public.obras_ejecutadas,
  public.maquinaria TO anon, authenticated;
GRANT SELECT ON public.empresa_documentos_estado TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.empresa_documentos_id_seq, control_obra.personal_tecnico_id_seq,
  control_obra.obras_ejecutadas_id_seq, control_obra.maquinaria_id_seq TO anon, authenticated;
