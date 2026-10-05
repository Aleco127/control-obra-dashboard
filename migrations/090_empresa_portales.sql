-- 090_empresa_portales.sql (US-847, D10/D11) — Accesos a portales de contrataciones, cifrados en Supabase Vault.
--
-- Reglas:
--   * Un secreto de Vault por empresa y portal, con nombre `portal:<empresa_id>:<portal>` y valor JSON
--     {"usuario","password"}. control_obra.empresa_portales guarda sólo usuario, estado de la última prueba y el id del
--     secreto: NO hay columna de contraseña.
--   * La contraseña se escribe por RPC (nivel 100) y NUNCA regresa al navegador: ninguna vista, RPC ni política
--     accesible a anon/authenticated la devuelve. La lee sólo control_obra.portal_credencial(), ejecutable únicamente
--     por service_role (la usará la función de borde portal-credencial de US-848, que no es de esta épica).
--   * control_obra está expuesto en PostgREST (pgrst.db_schemas): por eso a anon/authenticated sólo se les da SELECT por
--     COLUMNA (sin vault_secret_id) y ninguna escritura directa; todo cambio pasa por las RPC.
--   * Adopción: el secreto `portal:1:comprasmx` ya existía (4-oct-2026). Esta migración crea la fila de cada secreto
--     `portal:<n>:<portal>` que no la tenga, tomando id y usuario de vault.decrypted_secrets DENTRO del SQL; la
--     contraseña no se lee a ningún lado ni se escribe en este archivo.
--   * Baja de la empresa: al borrarse una fila (RPC «Quitar acceso», cascada desde empresas o el bucle de
--     eliminar_empresa_definitivo) un trigger borra su secreto de Vault.
-- Aditiva: tabla, vista, trigger y funciones nuevas.

-- 1) Tabla ---------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_obra.empresa_portales (
  id               serial PRIMARY KEY,
  empresa_id       integer NOT NULL DEFAULT control_obra.get_session_empresa_id()
                   REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  portal           text NOT NULL CHECK (portal IN ('comprasmx', 'chihuahua', 'otro')),
  usuario          text NOT NULL CHECK (length(btrim(usuario)) BETWEEN 1 AND 200),
  vault_secret_id  uuid NULL,
  estado           text NOT NULL DEFAULT 'sin_probar' CHECK (estado IN ('sin_probar', 'correcto', 'fallo')),
  probado_at       timestamptz NULL,
  ultimo_error     text NULL,
  updated_by       uuid NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresa_portales_empresa_portal_uk UNIQUE (empresa_id, portal)
);
DROP TRIGGER IF EXISTS trg_empresa_portales_touch ON control_obra.empresa_portales;
CREATE TRIGGER trg_empresa_portales_touch BEFORE UPDATE ON control_obra.empresa_portales
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_licit_touch();

ALTER TABLE control_obra.empresa_portales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS empresa_portales_select_n80 ON control_obra.empresa_portales;
CREATE POLICY empresa_portales_select_n80 ON control_obra.empresa_portales FOR SELECT TO anon, authenticated
  USING (empresa_id = (SELECT control_obra.get_session_empresa_id()) AND (SELECT control_obra.get_session_nivel()) >= 80);

-- Vista sin vault_secret_id (security_invoker: aplica la RLS de arriba)
CREATE OR REPLACE VIEW public.empresa_portales WITH (security_invoker = true) AS
  SELECT id, empresa_id, portal, usuario, estado, probado_at, ultimo_error, created_at, updated_at
  FROM control_obra.empresa_portales;

REVOKE ALL ON control_obra.empresa_portales, public.empresa_portales FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE control_obra.empresa_portales_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, empresa_id, portal, usuario, estado, probado_at, ultimo_error, created_at, updated_at)
  ON control_obra.empresa_portales TO anon, authenticated;
GRANT SELECT ON public.empresa_portales TO anon, authenticated;
GRANT ALL ON control_obra.empresa_portales TO service_role;
GRANT USAGE, SELECT ON SEQUENCE control_obra.empresa_portales_id_seq TO service_role;

-- 2) Al borrar la fila se borra su secreto -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION control_obra.trg_empresa_portales_borrar_secreto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  DELETE FROM vault.secrets
   WHERE id = OLD.vault_secret_id OR name = 'portal:' || OLD.empresa_id || ':' || OLD.portal;
  RETURN OLD;
END; $$;
REVOKE ALL ON FUNCTION control_obra.trg_empresa_portales_borrar_secreto() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_empresa_portales_borrar_secreto ON control_obra.empresa_portales;
CREATE TRIGGER trg_empresa_portales_borrar_secreto AFTER DELETE ON control_obra.empresa_portales
  FOR EACH ROW EXECUTE FUNCTION control_obra.trg_empresa_portales_borrar_secreto();

-- 3) Guardar o cambiar la credencial (nivel 100) -----------------------------------------------------------------------
-- p_password vacío o null = conservar la contraseña actual (sólo se cambia el usuario); obligatorio si no hay acceso.
CREATE OR REPLACE FUNCTION public.guardar_portal_credencial(p_portal text, p_usuario text, p_password text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user   uuid;
  v_emp    integer;
  v_fila   control_obra.empresa_portales%ROWTYPE;
  v_nombre text;
  v_pass   text;
  v_sid    uuid;
  v_nueva  boolean := false;
BEGIN
  v_user := control_obra.get_session_user_id();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '28000';
  END IF;
  IF COALESCE(control_obra.get_session_nivel(), 0) < 100 THEN
    RAISE EXCEPTION 'Sólo un administrador puede guardar accesos a portales' USING ERRCODE = '42501';
  END IF;
  v_emp := control_obra.get_session_empresa_id();
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'El usuario no tiene empresa' USING ERRCODE = '22023';
  END IF;
  IF p_portal IS NULL OR p_portal NOT IN ('comprasmx', 'chihuahua', 'otro') THEN
    RAISE EXCEPTION 'Portal no admitido' USING ERRCODE = '22023';
  END IF;
  p_usuario := btrim(COALESCE(p_usuario, ''));
  IF length(p_usuario) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Escribe el usuario del portal' USING ERRCODE = '22023';
  END IF;
  IF p_password IS NOT NULL AND p_password <> '' AND length(p_password) > 200 THEN
    RAISE EXCEPTION 'La contraseña es demasiado larga' USING ERRCODE = '22023';
  END IF;

  v_nombre := 'portal:' || v_emp || ':' || p_portal;
  SELECT * INTO v_fila FROM control_obra.empresa_portales WHERE empresa_id = v_emp AND portal = p_portal FOR UPDATE;
  v_sid := v_fila.vault_secret_id;
  IF v_sid IS NULL THEN
    SELECT s.id INTO v_sid FROM vault.secrets s WHERE s.name = v_nombre;
  END IF;

  IF p_password IS NULL OR p_password = '' THEN
    -- Conservar la contraseña: se toma del secreto sin que salga de esta función
    IF v_sid IS NOT NULL THEN
      SELECT (ds.decrypted_secret::jsonb ->> 'password') INTO v_pass FROM vault.decrypted_secrets ds WHERE ds.id = v_sid;
    END IF;
    IF v_pass IS NULL OR v_pass = '' THEN
      RAISE EXCEPTION 'Escribe la contraseña del portal' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_pass := p_password;
    v_nueva := true;
  END IF;

  IF v_sid IS NULL THEN
    v_sid := vault.create_secret(jsonb_build_object('usuario', p_usuario, 'password', v_pass)::text, v_nombre,
                                 'Acceso de la empresa ' || v_emp || ' al portal ' || p_portal || ' (US-847)');
  ELSE
    PERFORM vault.update_secret(v_sid, jsonb_build_object('usuario', p_usuario, 'password', v_pass)::text, v_nombre,
                                'Acceso de la empresa ' || v_emp || ' al portal ' || p_portal || ' (US-847)');
  END IF;
  v_pass := NULL;

  INSERT INTO control_obra.empresa_portales (empresa_id, portal, usuario, vault_secret_id, estado, updated_by)
  VALUES (v_emp, p_portal, p_usuario, v_sid, 'sin_probar', v_user)
  ON CONFLICT (empresa_id, portal) DO UPDATE SET
    usuario = EXCLUDED.usuario, vault_secret_id = EXCLUDED.vault_secret_id, updated_by = v_user,
    -- Con contraseña o usuario nuevos la última prueba deja de valer (US-848 no reintenta un «falló» hasta que cambie)
    estado = CASE WHEN v_nueva OR control_obra.empresa_portales.usuario IS DISTINCT FROM EXCLUDED.usuario THEN 'sin_probar' ELSE control_obra.empresa_portales.estado END,
    probado_at = CASE WHEN v_nueva OR control_obra.empresa_portales.usuario IS DISTINCT FROM EXCLUDED.usuario THEN NULL ELSE control_obra.empresa_portales.probado_at END,
    ultimo_error = CASE WHEN v_nueva OR control_obra.empresa_portales.usuario IS DISTINCT FROM EXCLUDED.usuario THEN NULL ELSE control_obra.empresa_portales.ultimo_error END
  RETURNING * INTO v_fila;

  RETURN jsonb_build_object('id', v_fila.id, 'empresa_id', v_fila.empresa_id, 'portal', v_fila.portal, 'usuario', v_fila.usuario,
    'estado', v_fila.estado, 'probado_at', v_fila.probado_at, 'ultimo_error', v_fila.ultimo_error,
    'created_at', v_fila.created_at, 'updated_at', v_fila.updated_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.guardar_portal_credencial(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_portal_credencial(text, text, text) TO anon, authenticated, service_role;

-- 4) Quitar el acceso (borra la fila; el trigger borra el secreto) -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.quitar_portal_credencial(p_portal text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_emp integer; v_n integer;
BEGIN
  IF control_obra.get_session_user_id() IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '28000';
  END IF;
  IF COALESCE(control_obra.get_session_nivel(), 0) < 100 THEN
    RAISE EXCEPTION 'Sólo un administrador puede quitar accesos a portales' USING ERRCODE = '42501';
  END IF;
  v_emp := control_obra.get_session_empresa_id();
  DELETE FROM control_obra.empresa_portales WHERE empresa_id = v_emp AND portal = p_portal;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- Por si quedó un secreto sin fila (no debería)
  DELETE FROM vault.secrets WHERE name = 'portal:' || v_emp || ':' || p_portal;
  RETURN jsonb_build_object('quitado', v_n > 0);
END;
$function$;
REVOKE ALL ON FUNCTION public.quitar_portal_credencial(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quitar_portal_credencial(text) TO anon, authenticated, service_role;

-- 5) Lectura de la credencial: SÓLO service_role (recolector de US-848 vía la función de borde portal-credencial) -----
CREATE OR REPLACE FUNCTION control_obra.portal_credencial(p_empresa integer, p_portal text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_fila control_obra.empresa_portales%ROWTYPE; v_sec jsonb;
BEGIN
  SELECT * INTO v_fila FROM control_obra.empresa_portales WHERE empresa_id = p_empresa AND portal = p_portal;
  IF v_fila.id IS NULL OR v_fila.vault_secret_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT ds.decrypted_secret::jsonb INTO v_sec FROM vault.decrypted_secrets ds WHERE ds.id = v_fila.vault_secret_id;
  IF v_sec IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('empresa_id', p_empresa, 'portal', p_portal, 'usuario', COALESCE(v_sec ->> 'usuario', v_fila.usuario),
    'password', v_sec ->> 'password', 'estado', v_fila.estado);
END;
$function$;
REVOKE ALL ON FUNCTION control_obra.portal_credencial(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION control_obra.portal_credencial(integer, text) TO service_role;

-- 6) Adopción de los secretos que ya existen (portal:1:comprasmx, creado el 4-oct-2026) -----------------------------
-- Sólo se leen el id y el usuario; la contraseña no sale de Vault.
INSERT INTO control_obra.empresa_portales (empresa_id, portal, usuario, vault_secret_id, estado)
SELECT split_part(ds.name, ':', 2)::integer, split_part(ds.name, ':', 3), btrim(ds.decrypted_secret::jsonb ->> 'usuario'), ds.id, 'sin_probar'
  FROM vault.decrypted_secrets ds
  JOIN control_obra.empresas e ON e.id::text = split_part(ds.name, ':', 2)
 WHERE ds.name ~ '^portal:[0-9]+:(comprasmx|chihuahua|otro)$'
   AND ds.decrypted_secret IS NOT NULL AND ds.decrypted_secret::jsonb ? 'usuario'
   AND length(btrim(ds.decrypted_secret::jsonb ->> 'usuario')) BETWEEN 1 AND 200
ON CONFLICT (empresa_id, portal) DO NOTHING;
