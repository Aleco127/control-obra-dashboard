-- 111_convocatoria_revision.sql (US-849) — Revisar los documentos de una convocatoria.
--
-- 1) convocatoria_notas: notas de revisión por convocatoria y empresa (texto libre, autor y fecha). El autor se llena
--    en el servidor (nombre del usuario de la sesión), no lo manda la app. RLS n80 por empresa; vista public.
-- 2) convocatoria_vistas + RPC convocatoria_visitar(p_id): última vez que CADA usuario abrió el detalle de una
--    convocatoria. Devuelve la visita anterior (para la etiqueta «Nuevo» de los archivos llegados desde entonces) y
--    guarda la de ahora.
-- 3) control_obra.categoria_archivo_convocatoria(tipo, nombre): categoría de licitacion_archivos para un documento del
--    portal (bases, anexo, acta_junta, plano, catalogo, circular, fallo, otro).
-- 4) convocatoria_participar: al crear la licitación, los archivos ya bajados de la convocatoria pasan a
--    licitacion_archivos con su categoría y la MISMA ruta del bucket (no se vuelven a subir). Responde además
--    `archivos` (cuántos pasaron). licitaciones.js ya no borra del bucket un archivo que vive en /convocatorias/ al
--    quitarlo de una licitación (lo comparte con la convocatoria).
-- Aditiva salvo convocatoria_participar (se recrea con la misma firma).

-- 1) Notas -----------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.convocatoria_notas (
  id               serial PRIMARY KEY,
  empresa_id       integer NOT NULL DEFAULT control_obra.get_session_empresa_id() REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  convocatoria_id  bigint NOT NULL REFERENCES control_obra.convocatorias(id) ON DELETE CASCADE,
  texto            text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 4000),
  usuario_id       uuid NULL DEFAULT control_obra.get_session_user_id(),
  autor            text NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_convocatoria_notas_conv ON control_obra.convocatoria_notas (empresa_id, convocatoria_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_convocatoria_notas_conv_fk ON control_obra.convocatoria_notas (convocatoria_id);

CREATE OR REPLACE FUNCTION control_obra.trg_convocatoria_nota_autor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  NEW.usuario_id := control_obra.get_session_user_id();
  NEW.autor := (SELECT u.nombre FROM control_obra.obra_usuarios u WHERE u.id = NEW.usuario_id);
  NEW.created_at := now();
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_convocatoria_nota_autor ON control_obra.convocatoria_notas;
CREATE TRIGGER trg_convocatoria_nota_autor BEFORE INSERT ON control_obra.convocatoria_notas
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_convocatoria_nota_autor();

ALTER TABLE control_obra.convocatoria_notas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS convocatoria_notas_n80 ON control_obra.convocatoria_notas;
CREATE POLICY convocatoria_notas_n80 ON control_obra.convocatoria_notas FOR ALL
  USING (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80)
  WITH CHECK (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80);
REVOKE ALL ON control_obra.convocatoria_notas FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON control_obra.convocatoria_notas TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.convocatoria_notas_id_seq TO anon, authenticated;
GRANT ALL ON control_obra.convocatoria_notas TO service_role;

CREATE OR REPLACE VIEW public.convocatoria_notas WITH (security_invoker = true) AS
  SELECT id, empresa_id, convocatoria_id, texto, usuario_id, autor, created_at FROM control_obra.convocatoria_notas;
REVOKE ALL ON public.convocatoria_notas FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.convocatoria_notas TO anon, authenticated;

-- 2) Visitas por usuario -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.convocatoria_vistas (
  empresa_id       integer NOT NULL REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  usuario_id       uuid NOT NULL,
  convocatoria_id  bigint NOT NULL REFERENCES control_obra.convocatorias(id) ON DELETE CASCADE,
  visto_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, usuario_id, convocatoria_id)
);
CREATE INDEX IF NOT EXISTS idx_convocatoria_vistas_conv ON control_obra.convocatoria_vistas (convocatoria_id);
ALTER TABLE control_obra.convocatoria_vistas ENABLE ROW LEVEL SECURITY;   -- sin políticas: sólo por la RPC
REVOKE ALL ON control_obra.convocatoria_vistas FROM anon, authenticated;
GRANT ALL ON control_obra.convocatoria_vistas TO service_role;

CREATE OR REPLACE FUNCTION public.convocatoria_visitar(p_convocatoria_id bigint)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  v_usr uuid := control_obra.get_session_user_id();
  v_prev timestamptz;
BEGIN
  IF v_usr IS NULL THEN RAISE EXCEPTION 'Sin sesión' USING ERRCODE = '42501'; END IF;
  SELECT visto_at INTO v_prev FROM control_obra.convocatoria_vistas
   WHERE empresa_id = v_emp AND usuario_id = v_usr AND convocatoria_id = p_convocatoria_id;
  INSERT INTO control_obra.convocatoria_vistas (empresa_id, usuario_id, convocatoria_id, visto_at)
  VALUES (v_emp, v_usr, p_convocatoria_id, now())
  ON CONFLICT (empresa_id, usuario_id, convocatoria_id) DO UPDATE SET visto_at = now();
  RETURN v_prev;
END; $$;
REVOKE ALL ON FUNCTION public.convocatoria_visitar(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.convocatoria_visitar(bigint) TO anon, authenticated, service_role;

-- 3) Categoría de licitacion_archivos para un documento del portal -------------------------------------------------------
CREATE OR REPLACE FUNCTION control_obra.categoria_archivo_convocatoria(p_tipo text, p_nombre text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT CASE
    WHEN t ~ '(acta).*(junta|aclaracion)|junta de aclaraciones' THEN 'acta_junta'
    WHEN t ~ 'fallo' THEN 'fallo'
    WHEN t ~ 'circular|aviso|modificacion|addendum|adenda' THEN 'circular'
    WHEN t ~ 'plano' OR n ~ '(^|[^a-z])plano' OR n ~ '\.dwg$' THEN 'plano'
    WHEN t ~ 'catalogo' OR n ~ 'catalogo|catyprog|catalog' THEN 'catalogo'
    WHEN t ~ 'bases|convocatoria|invitacion' THEN 'bases'
    WHEN t ~ 'anexo|tecnic|formato|modelo|contrato' THEN 'anexo'
    ELSE 'otro' END
  FROM (SELECT control_obra.texto_norm(coalesce(p_tipo,'')) AS t, lower(coalesce(p_nombre,'')) AS n) x;
$$;

-- 4) «Participar» pasa los archivos a la licitación sin volver a subirlos ------------------------------------------------
CREATE OR REPLACE FUNCTION public.convocatoria_participar(p_convocatoria_id bigint, p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  v_conv control_obra.convocatorias;
  v_seg control_obra.convocatoria_seguimiento;
  v_r jsonb;
  v_n integer := 0;
BEGIN
  SELECT * INTO v_conv FROM control_obra.convocatorias WHERE id = p_convocatoria_id;
  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'La convocatoria % no existe.', p_convocatoria_id USING ERRCODE = 'P0002';
  END IF;
  IF p_datos IS NULL OR jsonb_typeof(p_datos) <> 'object' THEN
    RAISE EXCEPTION 'Se esperaba un objeto con los datos de la licitación.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO control_obra.convocatoria_seguimiento (empresa_id, convocatoria_id, estado, usuario_id)
  VALUES (v_emp, p_convocatoria_id, 'nueva', control_obra.get_session_user_id())
  ON CONFLICT (empresa_id, convocatoria_id) DO NOTHING;
  SELECT * INTO v_seg FROM control_obra.convocatoria_seguimiento
   WHERE empresa_id = v_emp AND convocatoria_id = p_convocatoria_id FOR UPDATE;
  IF v_seg.estado = 'convertida' AND v_seg.licitacion_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta convocatoria ya se convirtió en una licitación.' USING ERRCODE = '55000';
  END IF;
  v_r := public.guardar_licitacion(p_datos - 'id');
  UPDATE control_obra.convocatoria_seguimiento
     SET estado = 'convertida', licitacion_id = (v_r->>'id')::integer, usuario_id = control_obra.get_session_user_id(),
         fechas_aceptadas = control_obra.convocatoria_fechas_json(v_conv)
   WHERE id = v_seg.id;
  -- US-849: los documentos ya bajados pasan a la licitación con su categoría y la misma ruta del bucket.
  INSERT INTO control_obra.licitacion_archivos (empresa_id, licitacion_id, categoria, nombre, archivo_path, tamano,
                                                hash_sha256, mime, notas, created_by)
  SELECT v_emp, (v_r->>'id')::integer, control_obra.categoria_archivo_convocatoria(coalesce(a.tipo, a.anexo), a.nombre),
         a.nombre, a.archivo_path, a.tamano, a.hash_sha256, a.mime,
         left('De la convocatoria ' || coalesce(v_conv.numero_procedimiento, v_conv.id_externo) ||
              CASE WHEN a.anexo IS NOT NULL THEN ' · ' || a.anexo ELSE '' END, 500),
         control_obra.get_session_user_id()
    FROM control_obra.convocatoria_archivos a
   WHERE a.empresa_id = v_emp AND a.convocatoria_id = p_convocatoria_id
   ORDER BY a.created_at, a.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_r || jsonb_build_object('convocatoria_id', p_convocatoria_id, 'archivos', v_n);
END; $$;
