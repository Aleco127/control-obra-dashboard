-- 100_convocatorias.sql (US-839) — Convocatorias públicas (ComprasMX y Contrataciones Chihuahua), filtros por
-- empresa, seguimiento por empresa y bitácora de corridas de los recolectores.
--
-- PRD: PRD-control-obra-licitaciones.md D9, D10 y épica F. Reglas:
--   * `convocatorias` y `convocatoria_corridas` son GLOBALES (sin empresa_id): datos públicos que se guardan una
--     sola vez. Sólo `service_role` (recolectores y funciones de borde) las escribe; la app NO las lee directo:
--     lee por las RPC `convocatorias_buscar` y `convocatorias_estado` (SECURITY DEFINER, nivel >= 80).
--   * `convocatoria_filtros` y `convocatoria_seguimiento` son de cada empresa: RLS n80 como las tablas de 080/084 y
--     vistas public.* con security_invoker y lista explícita de columnas.
--   * Catálogos como slugs sin acentos:
--       fuente              comprasmx | chihuahua
--       tipo_procedimiento  licitacion_publica | invitacion | adjudicacion_directa | otro
--       tipo_contratacion   obra_publica | servicios_obra | adquisicion | arrendamiento | servicios | otro
--       estatus             vigente | en_seguimiento | terminado | cancelado | otro
--       estado (seguim.)    nueva | interesa | descartada | convertida
--     `entidad` guarda el nombre tal cual («Chihuahua»); los filtros lo comparan con control_obra.texto_norm().
--   * La regla de «cumple el filtro» vive aquí en control_obra.convocatoria_cumple_filtro() y en JS en
--     cumpleFiltro() (US-844): misma semántica, ver docs/licitaciones/fuentes.md.
-- Aditiva: no toca tablas, funciones ni políticas existentes.

-- 1) Convocatorias (global) ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.convocatorias (
  id                    bigserial PRIMARY KEY,
  fuente                text NOT NULL CHECK (fuente IN ('comprasmx','chihuahua')),
  id_externo            text NOT NULL CHECK (length(btrim(id_externo)) > 0),
  numero_procedimiento  text NULL,
  titulo                text NOT NULL DEFAULT '',
  dependencia           text NULL,
  unidad_compradora     text NULL,
  tipo_procedimiento    text NULL CHECK (tipo_procedimiento IN ('licitacion_publica','invitacion','adjudicacion_directa','otro')),
  tipo_contratacion     text NULL CHECK (tipo_contratacion IN ('obra_publica','servicios_obra','adquisicion','arrendamiento','servicios','otro')),
  entidad               text NULL,
  municipio             text NULL,
  publicacion           timestamptz NULL,
  junta_aclaraciones    timestamptz NULL,
  apertura              timestamptz NULL,
  fallo                 timestamptz NULL,
  estatus               text NULL CHECK (estatus IN ('vigente','en_seguimiento','terminado','cancelado','otro')),
  url_detalle           text NULL,
  datos                 jsonb NOT NULL DEFAULT '{}'::jsonb,       -- respuesta cruda del portal + documentos del detalle
  primera_vez_vista     timestamptz NOT NULL DEFAULT now(),
  ultima_vez_vista      timestamptz NOT NULL DEFAULT now(),
  detalle_at            timestamptz NULL,                          -- última vez que se leyó la página de detalle
  updated_at            timestamptz NOT NULL DEFAULT now(),
  texto_norm            text GENERATED ALWAYS AS (control_obra.texto_norm(
                          coalesce(numero_procedimiento,'') || ' ' || coalesce(titulo,'') || ' ' ||
                          coalesce(dependencia,'') || ' ' || coalesce(unidad_compradora,'') || ' ' ||
                          coalesce(municipio,''))) STORED,
  CONSTRAINT convocatorias_fuente_ext_uk UNIQUE (fuente, id_externo),
  CONSTRAINT convocatorias_datos_ck CHECK (jsonb_typeof(datos) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_convocatorias_apertura ON control_obra.convocatorias (apertura);
CREATE INDEX IF NOT EXISTS idx_convocatorias_estatus ON control_obra.convocatorias (estatus, tipo_contratacion);
CREATE INDEX IF NOT EXISTS idx_convocatorias_primera ON control_obra.convocatorias (primera_vez_vista DESC);
CREATE INDEX IF NOT EXISTS idx_convocatorias_texto ON control_obra.convocatorias
  USING gin (texto_norm extensions.gin_trgm_ops);

-- 2) Corridas de los recolectores (global) ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.convocatoria_corridas (
  id            bigserial PRIMARY KEY,
  fuente        text NOT NULL CHECK (fuente IN ('comprasmx','chihuahua')),
  origen        text NULL,                                 -- 'edge' | 'script-pc' | 'script-vps' | ...
  inicio        timestamptz NOT NULL DEFAULT now(),
  fin           timestamptz NULL,
  encontradas   integer NOT NULL DEFAULT 0,
  nuevas        integer NOT NULL DEFAULT 0,
  actualizadas  integer NOT NULL DEFAULT 0,
  error         text NULL,
  detalle       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_convocatoria_corridas_fuente ON control_obra.convocatoria_corridas (fuente, inicio DESC);

-- 3) Filtros por empresa ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.convocatoria_filtros (
  id                  serial PRIMARY KEY,
  empresa_id          integer NOT NULL DEFAULT control_obra.get_session_empresa_id() REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  nombre              text NOT NULL CHECK (length(btrim(nombre)) > 0),
  palabras_clave      text[] NOT NULL DEFAULT '{}',      -- cualquiera (OR); vacío = no exige
  palabras_excluir    text[] NOT NULL DEFAULT '{}',      -- ninguna debe aparecer
  fuentes             text[] NOT NULL DEFAULT '{}',      -- vacío = todas
  entidades           text[] NOT NULL DEFAULT '{}',      -- vacío = todas
  tipos_contratacion  text[] NOT NULL DEFAULT '{}',      -- vacío = todos
  activo              boolean NOT NULL DEFAULT true,
  de_fabrica          boolean NOT NULL DEFAULT false,
  created_by          uuid NULL DEFAULT control_obra.get_session_user_id(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT convocatoria_filtros_fuentes_ck CHECK (fuentes <@ ARRAY['comprasmx','chihuahua']::text[]),
  CONSTRAINT convocatoria_filtros_tipos_ck CHECK (tipos_contratacion <@
    ARRAY['obra_publica','servicios_obra','adquisicion','arrendamiento','servicios','otro']::text[])
);
CREATE UNIQUE INDEX IF NOT EXISTS convocatoria_filtros_nombre_uidx ON control_obra.convocatoria_filtros (empresa_id, lower(nombre));

-- 4) Seguimiento por empresa -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.convocatoria_seguimiento (
  id               serial PRIMARY KEY,
  empresa_id       integer NOT NULL DEFAULT control_obra.get_session_empresa_id() REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  convocatoria_id  bigint NOT NULL REFERENCES control_obra.convocatorias(id) ON DELETE CASCADE,
  estado           text NOT NULL DEFAULT 'nueva' CHECK (estado IN ('nueva','interesa','descartada','convertida')),
  licitacion_id    integer NULL REFERENCES control_obra.licitaciones(id) ON DELETE SET NULL,
  nota             text NULL,
  usuario_id       uuid NULL DEFAULT control_obra.get_session_user_id(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT convocatoria_seguimiento_uk UNIQUE (empresa_id, convocatoria_id)
);
CREATE INDEX IF NOT EXISTS idx_convocatoria_seguimiento_conv ON control_obra.convocatoria_seguimiento (convocatoria_id);
CREATE INDEX IF NOT EXISTS idx_convocatoria_seguimiento_lic ON control_obra.convocatoria_seguimiento (licitacion_id) WHERE licitacion_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_convocatoria_seguimiento_lic ON control_obra.convocatoria_seguimiento;
CREATE TRIGGER trg_convocatoria_seguimiento_lic
  BEFORE INSERT OR UPDATE OF licitacion_id, empresa_id ON control_obra.convocatoria_seguimiento
  FOR EACH ROW WHEN (NEW.licitacion_id IS NOT NULL) EXECUTE FUNCTION control_obra.trg_licit_hijo_empresa();

-- updated_at
CREATE OR REPLACE FUNCTION control_obra.trg_convocatorias_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_convocatoria_filtros_touch ON control_obra.convocatoria_filtros;
CREATE TRIGGER trg_convocatoria_filtros_touch BEFORE UPDATE ON control_obra.convocatoria_filtros
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_convocatorias_touch();
DROP TRIGGER IF EXISTS trg_convocatoria_seguimiento_touch ON control_obra.convocatoria_seguimiento;
CREATE TRIGGER trg_convocatoria_seguimiento_touch BEFORE UPDATE ON control_obra.convocatoria_seguimiento
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_convocatorias_touch();

-- 5) RLS y privilegios ------------------------------------------------------------------------------------------
ALTER TABLE control_obra.convocatorias ENABLE ROW LEVEL SECURITY;           -- sin políticas: sólo service_role
ALTER TABLE control_obra.convocatoria_corridas ENABLE ROW LEVEL SECURITY;   -- sin políticas: sólo service_role
ALTER TABLE control_obra.convocatoria_filtros ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.convocatoria_seguimiento ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON control_obra.convocatorias, control_obra.convocatoria_corridas FROM anon, authenticated;
REVOKE ALL ON SEQUENCE control_obra.convocatorias_id_seq, control_obra.convocatoria_corridas_id_seq FROM anon, authenticated;
GRANT ALL ON control_obra.convocatorias, control_obra.convocatoria_corridas TO service_role;
GRANT USAGE, SELECT ON SEQUENCE control_obra.convocatorias_id_seq, control_obra.convocatoria_corridas_id_seq TO service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['convocatoria_filtros','convocatoria_seguimiento'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON control_obra.%I', t || '_n80', t);
    EXECUTE format('CREATE POLICY %I ON control_obra.%I FOR ALL
      USING (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)
      WITH CHECK (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)',
      t || '_n80', t);
    EXECUTE format('REVOKE ALL ON control_obra.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.%I TO anon, authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE control_obra.%I TO anon, authenticated', t || '_id_seq');
    EXECUTE format('GRANT ALL ON control_obra.%I TO service_role', t);
  END LOOP;
END $$;

-- 6) Vistas public (security_invoker, columnas explícitas) ------------------------------------------------------
CREATE OR REPLACE VIEW public.convocatoria_filtros WITH (security_invoker = true) AS
  SELECT id, empresa_id, nombre, palabras_clave, palabras_excluir, fuentes, entidades, tipos_contratacion,
         activo, de_fabrica, created_by, created_at, updated_at
  FROM control_obra.convocatoria_filtros;
CREATE OR REPLACE VIEW public.convocatoria_seguimiento WITH (security_invoker = true) AS
  SELECT id, empresa_id, convocatoria_id, estado, licitacion_id, nota, usuario_id, created_at, updated_at
  FROM control_obra.convocatoria_seguimiento;
REVOKE ALL ON public.convocatoria_filtros, public.convocatoria_seguimiento FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.convocatoria_filtros, public.convocatoria_seguimiento TO anon, authenticated;

-- 7) Regla «cumple el filtro» (la misma que cumpleFiltro() en JS) -----------------------------------------------
--    * palabras_clave: basta una (texto normalizado, sin acentos ni mayúsculas, como subcadena); vacío = no exige.
--    * palabras_excluir: si aparece cualquiera, no cumple.
--    * fuentes / entidades / tipos_contratacion: vacío = todos; si no, el valor de la convocatoria debe estar en la
--      lista (entidad comparada normalizada; una convocatoria sin entidad no cumple un filtro con entidades).
CREATE OR REPLACE FUNCTION control_obra.convocatoria_cumple_filtro(
  p_texto text, p_fuente text, p_entidad text, p_tipo text,
  p_claves text[], p_excluir text[], p_fuentes text[], p_entidades text[], p_tipos text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT
    (coalesce(cardinality(p_fuentes),0) = 0 OR p_fuente = ANY (p_fuentes))
    AND (coalesce(cardinality(p_tipos),0) = 0 OR p_tipo = ANY (p_tipos))
    AND (coalesce(cardinality(p_entidades),0) = 0 OR EXISTS (
          SELECT 1 FROM unnest(p_entidades) e
          WHERE control_obra.texto_norm(e) <> '' AND control_obra.texto_norm(e) = control_obra.texto_norm(coalesce(p_entidad,''))))
    AND (NOT EXISTS (SELECT 1 FROM unnest(coalesce(p_claves,'{}')) k WHERE control_obra.texto_norm(k) <> '')
         OR EXISTS (SELECT 1 FROM unnest(p_claves) k
                    WHERE control_obra.texto_norm(k) <> ''
                      AND position(control_obra.texto_norm(k) IN coalesce(p_texto,'')) > 0))
    AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p_excluir,'{}')) x
                    WHERE control_obra.texto_norm(x) <> ''
                      AND position(control_obra.texto_norm(x) IN coalesce(p_texto,'')) > 0);
$$;

-- 8) RPC de lectura ---------------------------------------------------------------------------------------------
-- convocatorias_buscar: lista para la pestaña «Convocatorias» (US-843). Todo filtro NULL = no filtra.
--   p_texto          búsqueda libre (normalizada, subcadena)
--   p_fuentes        {comprasmx, chihuahua}
--   p_entidades      nombres de entidad (se comparan normalizados)
--   p_tipos          tipos de contratación
--   p_estados        estados de seguimiento de MI empresa ('nueva' incluye las que no tienen fila)
--   p_abren_dias     apertura entre hoy y hoy + N días
--   p_mis_filtros    sólo las que cumplen al menos un filtro activo de la empresa
--   p_solo_vigentes  estatus vigente / en_seguimiento y apertura no vencida (o desconocida)
CREATE OR REPLACE FUNCTION public.convocatorias_buscar(
  p_texto text DEFAULT NULL,
  p_fuentes text[] DEFAULT NULL,
  p_entidades text[] DEFAULT NULL,
  p_tipos text[] DEFAULT NULL,
  p_estados text[] DEFAULT NULL,
  p_abren_dias integer DEFAULT NULL,
  p_mis_filtros boolean DEFAULT false,
  p_solo_vigentes boolean DEFAULT true,
  p_limite integer DEFAULT 200,
  p_offset integer DEFAULT 0)
RETURNS TABLE (
  id bigint, fuente text, id_externo text, numero_procedimiento text, titulo text, dependencia text,
  unidad_compradora text, tipo_procedimiento text, tipo_contratacion text, entidad text, municipio text,
  publicacion timestamptz, junta_aclaraciones timestamptz, apertura timestamptz, fallo timestamptz,
  estatus text, url_detalle text, datos jsonb, primera_vez_vista timestamptz, ultima_vez_vista timestamptz,
  updated_at timestamptz, seguimiento_estado text, licitacion_id integer, nota text, seguimiento_at timestamptz,
  total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_emp integer := control_obra.get_session_empresa_id();
  v_niv integer := control_obra.get_session_nivel();
  v_txt text := nullif(control_obra.texto_norm(coalesce(p_texto,'')), '');
BEGIN
  IF v_emp IS NULL OR coalesce(v_niv,0) < 80 THEN
    RAISE EXCEPTION 'No tienes permiso para ver convocatorias' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH f AS (
    SELECT * FROM control_obra.convocatoria_filtros cf WHERE cf.empresa_id = v_emp AND cf.activo
  ), base AS (
    SELECT c.*, s.estado AS s_estado, s.licitacion_id AS s_lic, s.nota AS s_nota, s.updated_at AS s_at
    FROM control_obra.convocatorias c
    LEFT JOIN control_obra.convocatoria_seguimiento s ON s.convocatoria_id = c.id AND s.empresa_id = v_emp
    WHERE (v_txt IS NULL OR position(v_txt IN c.texto_norm) > 0)
      AND (p_fuentes IS NULL OR cardinality(p_fuentes) = 0 OR c.fuente = ANY (p_fuentes))
      AND (p_tipos IS NULL OR cardinality(p_tipos) = 0 OR c.tipo_contratacion = ANY (p_tipos))
      AND (p_entidades IS NULL OR cardinality(p_entidades) = 0 OR EXISTS (
            SELECT 1 FROM unnest(p_entidades) e
            WHERE control_obra.texto_norm(e) = control_obra.texto_norm(coalesce(c.entidad,''))))
      AND (p_estados IS NULL OR cardinality(p_estados) = 0 OR coalesce(s.estado,'nueva') = ANY (p_estados))
      AND (p_abren_dias IS NULL OR (c.apertura >= date_trunc('day', now() AT TIME ZONE 'America/Chihuahua') AT TIME ZONE 'America/Chihuahua'
                                    AND c.apertura < now() + make_interval(days => p_abren_dias + 1)))
      AND (NOT coalesce(p_solo_vigentes, true) OR (coalesce(c.estatus,'vigente') IN ('vigente','en_seguimiento')
                                                   AND (c.apertura IS NULL OR c.apertura >= now() - interval '1 day')))
      AND (NOT coalesce(p_mis_filtros, false) OR EXISTS (
            SELECT 1 FROM f WHERE control_obra.convocatoria_cumple_filtro(c.texto_norm, c.fuente, c.entidad,
              c.tipo_contratacion, f.palabras_clave, f.palabras_excluir, f.fuentes, f.entidades, f.tipos_contratacion)))
  )
  SELECT b.id, b.fuente, b.id_externo, b.numero_procedimiento, b.titulo, b.dependencia, b.unidad_compradora,
         b.tipo_procedimiento, b.tipo_contratacion, b.entidad, b.municipio, b.publicacion, b.junta_aclaraciones,
         b.apertura, b.fallo, b.estatus, b.url_detalle, b.datos, b.primera_vez_vista, b.ultima_vez_vista,
         b.updated_at, coalesce(b.s_estado,'nueva'), b.s_lic, b.s_nota, b.s_at,
         count(*) OVER ()
  FROM base b
  ORDER BY b.apertura ASC NULLS LAST, b.primera_vez_vista DESC, b.id DESC
  LIMIT greatest(1, least(coalesce(p_limite,200), 1000)) OFFSET greatest(0, coalesce(p_offset,0));
END; $$;

-- convocatorias_estado: última corrida (y última correcta) de cada fuente, para el pie de la pestaña.
CREATE OR REPLACE FUNCTION public.convocatorias_estado()
RETURNS TABLE (fuente text, ultima_inicio timestamptz, ultima_fin timestamptz, ultima_error text,
               ultima_ok timestamptz, encontradas integer, nuevas integer, vigentes bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF control_obra.get_session_empresa_id() IS NULL OR coalesce(control_obra.get_session_nivel(),0) < 80 THEN
    RAISE EXCEPTION 'No tienes permiso para ver convocatorias' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT fu.f,
         u.inicio, u.fin, u.error,
         (SELECT max(k.fin) FROM control_obra.convocatoria_corridas k WHERE k.fuente = fu.f AND k.error IS NULL AND k.fin IS NOT NULL),
         u.encontradas, u.nuevas,
         (SELECT count(*) FROM control_obra.convocatorias c WHERE c.fuente = fu.f AND c.estatus IN ('vigente','en_seguimiento'))
  FROM (VALUES ('comprasmx'),('chihuahua')) fu(f)
  LEFT JOIN LATERAL (SELECT * FROM control_obra.convocatoria_corridas k WHERE k.fuente = fu.f
                     ORDER BY k.inicio DESC LIMIT 1) u ON true;
END; $$;

-- convocatoria_marcar: crea o cambia el seguimiento de MI empresa (Me interesa / Descartar / deshacer).
-- 'convertida' sólo con licitación (la pone US-845); una convertida no vuelve a otro estado por aquí.
CREATE OR REPLACE FUNCTION public.convocatoria_marcar(p_convocatoria_id bigint, p_estado text, p_nota text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_emp integer := control_obra.get_session_empresa_id();
  v_row control_obra.convocatoria_seguimiento;
BEGIN
  IF v_emp IS NULL OR coalesce(control_obra.get_session_nivel(),0) < 80 THEN
    RAISE EXCEPTION 'No tienes permiso para dar seguimiento a convocatorias' USING ERRCODE = '42501';
  END IF;
  IF p_estado NOT IN ('nueva','interesa','descartada') THEN
    RAISE EXCEPTION 'Estado no válido: %', p_estado USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM control_obra.convocatorias WHERE id = p_convocatoria_id) THEN
    RAISE EXCEPTION 'La convocatoria % no existe', p_convocatoria_id USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO control_obra.convocatoria_seguimiento AS s (empresa_id, convocatoria_id, estado, nota, usuario_id)
  VALUES (v_emp, p_convocatoria_id, p_estado, p_nota, control_obra.get_session_user_id())
  ON CONFLICT (empresa_id, convocatoria_id) DO UPDATE
    SET estado = EXCLUDED.estado,
        nota = coalesce(EXCLUDED.nota, s.nota),
        usuario_id = EXCLUDED.usuario_id
    WHERE s.estado <> 'convertida'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'La convocatoria ya se convirtió en licitación' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('id', v_row.id, 'convocatoria_id', v_row.convocatoria_id, 'estado', v_row.estado,
                            'licitacion_id', v_row.licitacion_id, 'nota', v_row.nota, 'updated_at', v_row.updated_at);
END; $$;

REVOKE ALL ON FUNCTION public.convocatorias_buscar(text,text[],text[],text[],text[],integer,boolean,boolean,integer,integer) FROM public;
REVOKE ALL ON FUNCTION public.convocatorias_estado() FROM public;
REVOKE ALL ON FUNCTION public.convocatoria_marcar(bigint,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.convocatorias_buscar(text,text[],text[],text[],text[],integer,boolean,boolean,integer,integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convocatorias_estado() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convocatoria_marcar(bigint,text,text) TO anon, authenticated, service_role;

-- 9) Escritura de los recolectores: upsert en lote (sólo service_role) -------------------------------------------
-- PostgREST sólo expone `public`: estas RPC viven ahí pero sólo las ejecuta service_role.
-- Recibe un arreglo JSON de convocatorias normalizadas. Devuelve {encontradas, nuevas, actualizadas}.
-- Campos ausentes en el JSON NO borran lo que ya había (p. ej. fechas leídas del detalle en otra corrida).
CREATE OR REPLACE FUNCTION public.convocatorias_upsert(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  it jsonb; v_id bigint; v_new boolean;
  n_tot integer := 0; n_new integer := 0; n_upd integer := 0;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'p_items debe ser un arreglo'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    n_tot := n_tot + 1;
    INSERT INTO control_obra.convocatorias AS c (
      fuente, id_externo, numero_procedimiento, titulo, dependencia, unidad_compradora, tipo_procedimiento,
      tipo_contratacion, entidad, municipio, publicacion, junta_aclaraciones, apertura, fallo, estatus,
      url_detalle, datos, detalle_at)
    VALUES (
      it->>'fuente', it->>'id_externo', it->>'numero_procedimiento', coalesce(it->>'titulo',''), it->>'dependencia',
      it->>'unidad_compradora', it->>'tipo_procedimiento', it->>'tipo_contratacion', it->>'entidad', it->>'municipio',
      (it->>'publicacion')::timestamptz, (it->>'junta_aclaraciones')::timestamptz, (it->>'apertura')::timestamptz,
      (it->>'fallo')::timestamptz, it->>'estatus', it->>'url_detalle', coalesce(it->'datos','{}'::jsonb),
      (it->>'detalle_at')::timestamptz)
    ON CONFLICT (fuente, id_externo) DO UPDATE SET
      numero_procedimiento = coalesce(EXCLUDED.numero_procedimiento, c.numero_procedimiento),
      titulo               = CASE WHEN EXCLUDED.titulo <> '' THEN EXCLUDED.titulo ELSE c.titulo END,
      dependencia          = coalesce(EXCLUDED.dependencia, c.dependencia),
      unidad_compradora    = coalesce(EXCLUDED.unidad_compradora, c.unidad_compradora),
      tipo_procedimiento   = coalesce(EXCLUDED.tipo_procedimiento, c.tipo_procedimiento),
      tipo_contratacion    = coalesce(EXCLUDED.tipo_contratacion, c.tipo_contratacion),
      entidad              = coalesce(EXCLUDED.entidad, c.entidad),
      municipio            = coalesce(EXCLUDED.municipio, c.municipio),
      publicacion          = coalesce(EXCLUDED.publicacion, c.publicacion),
      junta_aclaraciones   = coalesce(EXCLUDED.junta_aclaraciones, c.junta_aclaraciones),
      apertura             = coalesce(EXCLUDED.apertura, c.apertura),
      fallo                = coalesce(EXCLUDED.fallo, c.fallo),
      estatus              = coalesce(EXCLUDED.estatus, c.estatus),
      url_detalle          = coalesce(EXCLUDED.url_detalle, c.url_detalle),
      datos                = c.datos || EXCLUDED.datos,
      detalle_at           = coalesce(EXCLUDED.detalle_at, c.detalle_at),
      ultima_vez_vista     = now(),
      updated_at           = CASE WHEN (c.estatus, c.apertura, c.junta_aclaraciones, c.fallo, c.titulo)
                                   IS DISTINCT FROM
                                   (coalesce(EXCLUDED.estatus, c.estatus), coalesce(EXCLUDED.apertura, c.apertura),
                                    coalesce(EXCLUDED.junta_aclaraciones, c.junta_aclaraciones),
                                    coalesce(EXCLUDED.fallo, c.fallo),
                                    CASE WHEN EXCLUDED.titulo <> '' THEN EXCLUDED.titulo ELSE c.titulo END)
                                 THEN now() ELSE c.updated_at END
    RETURNING c.id, (xmax = 0) INTO v_id, v_new;
    IF v_new THEN n_new := n_new + 1; ELSE n_upd := n_upd + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('encontradas', n_tot, 'nuevas', n_new, 'actualizadas', n_upd);
END; $$;
REVOKE ALL ON FUNCTION public.convocatorias_upsert(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convocatorias_upsert(jsonb) TO service_role;

-- Bitácora de corridas: abrir y cerrar (sólo service_role).
CREATE OR REPLACE FUNCTION public.convocatoria_corrida_iniciar(p_fuente text, p_origen text)
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO control_obra.convocatoria_corridas (fuente, origen) VALUES (p_fuente, p_origen) RETURNING id;
$$;
CREATE OR REPLACE FUNCTION public.convocatoria_corrida_cerrar(
  p_id bigint, p_encontradas integer, p_nuevas integer, p_actualizadas integer, p_error text, p_detalle jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE control_obra.convocatoria_corridas
     SET fin = now(), encontradas = coalesce(p_encontradas,0), nuevas = coalesce(p_nuevas,0),
         actualizadas = coalesce(p_actualizadas,0), error = nullif(left(p_error, 2000), ''),
         detalle = coalesce(p_detalle, '{}'::jsonb)
   WHERE id = p_id;
$$;
REVOKE ALL ON FUNCTION public.convocatoria_corrida_iniciar(text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.convocatoria_corrida_cerrar(bigint,integer,integer,integer,text,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convocatoria_corrida_iniciar(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.convocatoria_corrida_cerrar(bigint,integer,integer,integer,text,jsonb) TO service_role;

-- 10) Filtros de fábrica para la empresa 1 (Supernova) ----------------------------------------------------------
INSERT INTO control_obra.convocatoria_filtros (empresa_id, nombre, fuentes, entidades, tipos_contratacion, de_fabrica, created_by)
SELECT 1, v.nombre, v.fuentes, v.entidades, ARRAY['obra_publica','servicios_obra'], true, NULL
FROM (VALUES
  ('Obra pública en Chihuahua (estatal)', ARRAY['chihuahua']::text[], '{}'::text[]),
  ('Obra pública federal en Chihuahua',   ARRAY['comprasmx']::text[], ARRAY['Chihuahua']::text[])
) v(nombre, fuentes, entidades)
WHERE EXISTS (SELECT 1 FROM control_obra.empresas WHERE id = 1)
ON CONFLICT (empresa_id, lower(nombre)) DO NOTHING;
