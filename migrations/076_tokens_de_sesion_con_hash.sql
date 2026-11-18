-- 076 · Los tokens de sesión se guardan como SHA-256 (18-nov-2026)
-- Antes la columna token de obra_sesiones, portal_sesiones y platform_sessions guardaba el token tal cual: quien leyera
-- la tabla (un respaldo, una inyección SQL, un panel) podía suplantar cualquier sesión viva. Ahora la base sólo guarda
-- el hash; el token real vive únicamente en el navegador del usuario. Los enlaces de obra (obra_portal_tokens) no cambian
-- porque el administrador necesita volver a copiarlos.
-- NO ejecutar dos veces: el UPDATE volvería a hashear los hashes. El bloque DO falla (y revierte todo) si algún
-- reemplazo no encuentra su texto.

CREATE OR REPLACE FUNCTION control_obra.tok(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS
$$ SELECT encode(sha256(convert_to(coalesce(t, ''), 'UTF8')), 'hex') $$;
GRANT EXECUTE ON FUNCTION control_obra.tok(text) TO anon, authenticated, service_role;

UPDATE control_obra.obra_sesiones   SET token = control_obra.tok(token);
UPDATE control_obra.portal_sesiones SET token = control_obra.tok(token);
UPDATE public.platform_sessions     SET token = control_obra.tok(token);
DROP INDEX IF EXISTS control_obra.idx_sesiones_token;   -- duplicaba al índice único

DO $$
DECLARE r record; def text; nuevo text; par text[];
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('control_obra', 'get_session_user_id',       ARRAY[ARRAY['s.token = v_token', 's.token = control_obra.tok(v_token)']], true),
    ('control_obra', 'get_session_empresa_id',    ARRAY[ARRAY['s.token = v_token', 's.token = control_obra.tok(v_token)']], true),
    ('public',       'create_obra_user',          ARRAY[ARRAY['s.token = v_token', 's.token = control_obra.tok(v_token)']], true),
    ('public',       'update_user_password',      ARRAY[ARRAY['s.token = v_token', 's.token = control_obra.tok(v_token)']], true),
    ('public',       'validar_sesion',            ARRAY[ARRAY['s.token = p_token', 's.token = control_obra.tok(p_token)']], true),
    ('public',       'load_all_data_seguro',      ARRAY[ARRAY['s.token = p_token', 's.token = control_obra.tok(p_token)']], true),
    ('public',       'load_secondary_data_seguro',ARRAY[ARRAY['s.token = p_token', 's.token = control_obra.tok(p_token)']], true),
    ('control_obra', 'load_all_data_seguro',      ARRAY[ARRAY['s.token = p_token', 's.token = control_obra.tok(p_token)']], false),
    ('control_obra', 'load_secondary_data_seguro',ARRAY[ARRAY['s.token = p_token', 's.token = control_obra.tok(p_token)']], false),
    ('public',       'cerrar_sesion',             ARRAY[ARRAY['token = p_token', 'token = control_obra.tok(p_token)']], true),
    ('public',       'cerrar_otras_sesiones',     ARRAY[ARRAY['token <> v_tok', 'token <> control_obra.tok(v_tok)']], true),
    ('public',       'verificar_login',           ARRAY[ARRAY['VALUES (v_user.id, v_token,', 'VALUES (v_user.id, control_obra.tok(v_token),']], true),
    ('control_obra', 'verificar_login',           ARRAY[ARRAY['VALUES (v_user.id, v_token,', 'VALUES (v_user.id, control_obra.tok(v_token),']], false),
    ('public',       'has_platform_session',      ARRAY[ARRAY['s.token = public.get_platform_token()', 's.token = control_obra.tok(public.get_platform_token())']], true),
    ('public',       'validate_platform_session', ARRAY[ARRAY['token = p_token', 'token = control_obra.tok(p_token)']], true),
    ('public',       'platform_admin_logout',     ARRAY[ARRAY['token = p_token', 'token = control_obra.tok(p_token)']], true),
    ('public',       'platform_admin_login',      ARRAY[ARRAY['VALUES (v_admin.id, v_token,', 'VALUES (v_admin.id, control_obra.tok(v_token),']], true),
    ('control_obra', 'portal_usuario_de_sesion',  ARRAY[ARRAY['token = p_token', 'token = control_obra.tok(p_token)']], true),
    ('public',       'portal_evento',             ARRAY[ARRAY['s.token = p_token', 's.token = control_obra.tok(p_token)']], true),
    ('public',       'portal_logout',             ARRAY[ARRAY['token = p_token', 'token = control_obra.tok(p_token)']], true),
    ('public',       'portal_password',           ARRAY[ARRAY['token <> p_token', 'token <> control_obra.tok(p_token)']], true),
    ('public',       'portal_login',              ARRAY[ARRAY['values (v_u.id, v_tok,', 'values (v_u.id, control_obra.tok(v_tok),']], true)
  ) AS t(esquema, nombre, cambios, obligatorio) LOOP
    FOR def IN SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = r.esquema AND p.proname = r.nombre
                 AND p.prosrc ~* '(obra_sesiones|portal_sesiones|platform_sessions)' LOOP
      nuevo := def;
      FOREACH par SLICE 1 IN ARRAY r.cambios LOOP
        IF position(par[1] IN nuevo) = 0 THEN
          IF r.obligatorio THEN RAISE EXCEPTION 'No encontré «%» en %.%', par[1], r.esquema, r.nombre; END IF;
        ELSE
          nuevo := replace(nuevo, par[1], par[2]);
        END IF;
      END LOOP;
      IF nuevo <> def THEN EXECUTE nuevo; END IF;
    END LOOP;
  END LOOP;
END $$;
