-- 110_convocatoria_descargas_app.sql (US-848) — Los documentos de UNA convocatoria se bajan a petición desde la app.
--
-- D14 (Ricardo, 5-oct-2026): nada se descarga a volumen. Los documentos se bajan sólo de la convocatoria que el
-- usuario marca «Me interesa» o en la que pulsa «Descargar documentos», una a la vez, sin revisión automática.
-- ComprasMX: el conector local de la PC baja los anexos del sitio público (sin iniciar sesión) y se los entrega a la
-- app; Contrataciones Chihuahua: la función de borde convocatorias-documentos baja los enlaces públicos del detalle
-- (el portal no manda CORS). En los dos casos la APP sube cada archivo al bucket `licitaciones` con la sesión del
-- usuario y registra la fila en convocatoria_archivos. Las credenciales del portal NO se usan.
--
-- 1) Bucket: la política de INSERT acepta también empresa/<id>/convocatorias/<convocatoria>/… (antes sólo
--    licitaciones/ y expediente/). Se suman tipos que publican los portales (.doc, .xls, .rar, .7z, .txt, .tif).
-- 2) convocatoria_archivos: la app inserta (RLS n80 por empresa ya existía); columnas nuevas origen_id (id del
--    documento en el portal: uuid_pa de ComprasMX o «tipo|fecha|n» de Chihuahua, para no volver a bajar lo mismo),
--    anexo (a qué anexo pertenece) y descarga_id. Único (empresa, convocatoria, origen_id) además del de hash.
-- 3) convocatoria_descargas: avance (total, bajados, omitidos, bytes), avisos y fin; RPC convocatoria_descarga_iniciar
--    (una a la vez por empresa: otra «en_curso» de menos de 20 min → error) y convocatoria_descarga_cerrar.
--    revisado_at = última vez que el usuario pidió «Buscar documentos nuevos» (no hay revisión cada 24 h).
-- 4) convocatoria_documentos_actualizar (service_role): la función de Chihuahua guarda la lista de documentos que
--    acaba de leer del detalle sin pisar el resto de `datos`.
-- Aditiva. (Aplicada en 5 partes: 110, 110b, 110c, 110d, 110e.)

-- 1) Bucket --------------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS licitaciones_insert ON storage.objects;
CREATE POLICY licitaciones_insert ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'licitaciones'
    AND (storage.foldername(name))[1] = 'empresa'
    AND (storage.foldername(name))[2] = (SELECT control_obra.get_session_empresa_id())::text
    AND (storage.foldername(name))[3] = ANY (ARRAY['licitaciones','expediente','convocatorias'])
    AND (SELECT control_obra.get_session_nivel()) >= 80);

UPDATE storage.buckets SET allowed_mime_types = (
  SELECT array_agg(DISTINCT m) FROM unnest(allowed_mime_types || ARRAY[
    'application/msword','application/vnd.ms-excel','application/vnd.rar','application/x-rar-compressed',
    'application/x-7z-compressed','text/plain','image/tiff']) m)
WHERE id = 'licitaciones';

-- 2) Archivos ------------------------------------------------------------------------------------------------------------
ALTER TABLE control_obra.convocatoria_archivos ADD COLUMN IF NOT EXISTS origen_id text NULL;
ALTER TABLE control_obra.convocatoria_archivos ADD COLUMN IF NOT EXISTS anexo text NULL;
ALTER TABLE control_obra.convocatoria_archivos ADD COLUMN IF NOT EXISTS descarga_id integer NULL
  REFERENCES control_obra.convocatoria_descargas(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS convocatoria_archivos_origen_uidx
  ON control_obra.convocatoria_archivos (empresa_id, convocatoria_id, origen_id) WHERE origen_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_convocatoria_archivos_descarga ON control_obra.convocatoria_archivos (descarga_id) WHERE descarga_id IS NOT NULL;

CREATE OR REPLACE VIEW public.convocatoria_archivos WITH (security_invoker = true) AS
  SELECT id, empresa_id, convocatoria_id, nombre, tipo, tamano, hash_sha256, archivo_path, mime, publicado_portal_at,
         origen_url, created_at, origen_id, anexo, descarga_id
  FROM control_obra.convocatoria_archivos;
REVOKE ALL ON public.convocatoria_archivos FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.convocatoria_archivos TO anon, authenticated;

-- 3) Descargas ----------------------------------------------------------------------------------------------------------
ALTER TABLE control_obra.convocatoria_descargas ADD COLUMN IF NOT EXISTS total integer NOT NULL DEFAULT 0;
ALTER TABLE control_obra.convocatoria_descargas ADD COLUMN IF NOT EXISTS bajados integer NOT NULL DEFAULT 0;
ALTER TABLE control_obra.convocatoria_descargas ADD COLUMN IF NOT EXISTS omitidos integer NOT NULL DEFAULT 0;
ALTER TABLE control_obra.convocatoria_descargas ADD COLUMN IF NOT EXISTS bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE control_obra.convocatoria_descargas ADD COLUMN IF NOT EXISTS avisos jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE control_obra.convocatoria_descargas ADD COLUMN IF NOT EXISTS motivo text NULL
  CHECK (motivo IS NULL OR motivo IN ('interesa','manual','nuevos'));

CREATE OR REPLACE VIEW public.convocatoria_descargas WITH (security_invoker = true) AS
  SELECT id, empresa_id, convocatoria_id, estado, intentos, error, solicitado_por, solicitado_at, inicio_at, fin_at,
         revisado_at, created_at, updated_at, total, bajados, omitidos, bytes, avisos, motivo
  FROM control_obra.convocatoria_descargas;
REVOKE ALL ON public.convocatoria_descargas FROM anon, authenticated;
GRANT SELECT, DELETE ON public.convocatoria_descargas TO anon, authenticated;   -- se escribe por las RPC de abajo (110e: DELETE)

-- Inicia la descarga de UNA convocatoria. Una a la vez por empresa: si hay otra «en_curso» de hace menos de 20 min,
-- error (una pestaña cerrada a medias deja la suya «en_curso»: pasados 20 min se considera abandonada).
CREATE OR REPLACE FUNCTION public.convocatoria_descarga_iniciar(p_convocatoria_id bigint, p_motivo text DEFAULT 'manual')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  v_otra control_obra.convocatoria_descargas;
  v_row control_obra.convocatoria_descargas;
BEGIN
  IF p_motivo NOT IN ('interesa','manual','nuevos') THEN
    RAISE EXCEPTION 'Motivo no válido: %', p_motivo USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM control_obra.convocatorias WHERE id = p_convocatoria_id) THEN
    RAISE EXCEPTION 'La convocatoria % no existe', p_convocatoria_id USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('convocatoria_descarga'), v_emp);
  SELECT * INTO v_otra FROM control_obra.convocatoria_descargas
   WHERE empresa_id = v_emp AND estado = 'en_curso' AND convocatoria_id <> p_convocatoria_id
     AND coalesce(inicio_at, updated_at) > now() - interval '20 minutes'
   LIMIT 1;
  IF v_otra.id IS NOT NULL THEN
    RAISE EXCEPTION 'Ya se están bajando los documentos de otra convocatoria; espera a que termine (una a la vez).' USING ERRCODE = '55P03';
  END IF;
  INSERT INTO control_obra.convocatoria_descargas AS d (empresa_id, convocatoria_id, estado, intentos, solicitado_por,
                                                        solicitado_at, inicio_at, fin_at, error, total, bajados, omitidos,
                                                        bytes, avisos, motivo, revisado_at)
  VALUES (v_emp, p_convocatoria_id, 'en_curso', 1, control_obra.get_session_user_id(), now(), now(), NULL, NULL, 0, 0, 0,
          0, '[]'::jsonb, p_motivo, CASE WHEN p_motivo = 'nuevos' THEN now() END)
  ON CONFLICT (empresa_id, convocatoria_id) DO UPDATE
    SET estado = 'en_curso', intentos = d.intentos + 1, solicitado_por = EXCLUDED.solicitado_por, solicitado_at = now(),
        inicio_at = now(), fin_at = NULL, error = NULL, total = 0, bajados = 0, omitidos = 0, bytes = 0,
        avisos = '[]'::jsonb, motivo = EXCLUDED.motivo,
        revisado_at = CASE WHEN EXCLUDED.motivo = 'nuevos' THEN now() ELSE d.revisado_at END
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END; $$;

-- Avance y cierre (la app lo llama tras cada archivo y al terminar). p_estado: en_curso | lista | fallo.
CREATE OR REPLACE FUNCTION public.convocatoria_descarga_avance(p_id integer, p_estado text, p_total integer,
  p_bajados integer, p_omitidos integer, p_bytes bigint, p_avisos jsonb DEFAULT '[]'::jsonb, p_error text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  v_row control_obra.convocatoria_descargas;
BEGIN
  IF p_estado NOT IN ('en_curso','lista','fallo') THEN
    RAISE EXCEPTION 'Estado no válido: %', p_estado USING ERRCODE = '22023';
  END IF;
  UPDATE control_obra.convocatoria_descargas
     SET estado = p_estado, total = greatest(0, coalesce(p_total, 0)), bajados = greatest(0, coalesce(p_bajados, 0)),
         omitidos = greatest(0, coalesce(p_omitidos, 0)), bytes = greatest(0, coalesce(p_bytes, 0)),
         avisos = CASE WHEN jsonb_typeof(p_avisos) = 'array' THEN p_avisos ELSE '[]'::jsonb END,
         error = left(p_error, 2000), fin_at = CASE WHEN p_estado = 'en_curso' THEN NULL ELSE now() END
   WHERE id = p_id AND empresa_id = v_emp
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'La descarga % no existe', p_id USING ERRCODE = 'P0002'; END IF;
  RETURN to_jsonb(v_row);
END; $$;

REVOKE ALL ON FUNCTION public.convocatoria_descarga_iniciar(bigint, text) FROM public;
REVOKE ALL ON FUNCTION public.convocatoria_descarga_avance(integer, text, integer, integer, integer, bigint, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.convocatoria_descarga_iniciar(bigint, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convocatoria_descarga_avance(integer, text, integer, integer, integer, bigint, jsonb, text) TO anon, authenticated, service_role;

-- 4) Lista de documentos del detalle de Chihuahua (sólo service_role) ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.convocatoria_documentos_actualizar(p_id bigint, p_documentos jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE control_obra.convocatorias
     SET datos = jsonb_set(CASE WHEN jsonb_typeof(datos->'detalle') = 'object' THEN datos
                                ELSE jsonb_set(datos, '{detalle}', '{}'::jsonb) END,
                           '{detalle,documentos}', CASE WHEN jsonb_typeof(p_documentos) = 'array' THEN p_documentos ELSE '[]'::jsonb END),
         ultima_vez_vista = ultima_vez_vista
   WHERE id = p_id;
$$;
REVOKE ALL ON FUNCTION public.convocatoria_documentos_actualizar(bigint, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convocatoria_documentos_actualizar(bigint, jsonb) TO service_role;

-- 5) Datos mínimos de una convocatoria para la función convocatorias-documentos (sólo service_role) --------------------
CREATE OR REPLACE FUNCTION public.convocatoria_para_documentos(p_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', c.id, 'fuente', c.fuente, 'id_externo', c.id_externo, 'url_detalle', c.url_detalle,
                            'documentos', coalesce(c.datos->'detalle'->'documentos', '[]'::jsonb))
  FROM control_obra.convocatorias c WHERE c.id = p_id;
$$;
REVOKE ALL ON FUNCTION public.convocatoria_para_documentos(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convocatoria_para_documentos(bigint) TO service_role;
