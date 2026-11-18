-- 074 · Sesiones: limpieza y vigencia de 7 días renovable (17-nov-2026)
-- Antes una sesión duraba 30 días y se renovaba sola; quedaban acumuladas decenas de sesiones vencidas por usuario.
-- Las sesiones de QA (token que no es de 64 hex) no se tocan.
DELETE FROM control_obra.obra_sesiones WHERE expires_at <= now() AND token ~ '^[a-f0-9]{64}$';
DELETE FROM control_obra.obra_sesiones s
 WHERE s.token ~ '^[a-f0-9]{64}$'
   AND EXISTS (SELECT 1 FROM control_obra.obra_sesiones m WHERE m.usuario_id = s.usuario_id AND m.token ~ '^[a-f0-9]{64}$'
               AND (m.created_at, m.id) > (s.created_at, s.id));
UPDATE control_obra.obra_sesiones SET expires_at = LEAST(expires_at, now() + interval '7 days') WHERE token ~ '^[a-f0-9]{64}$';

-- verificar_login crea la sesión con 7 días; validar_sesion la renueva a 7 días cuando le quedan menos de 3.
DO $$
DECLARE r record; def text;
BEGIN
  FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN ('public','control_obra') AND p.proname IN ('verificar_login','validar_sesion') LOOP
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, 'INTERVAL ''30 days''', 'INTERVAL ''7 days''', 'gi');
    def := regexp_replace(def, 'interval ''15 days''', 'interval ''3 days''', 'gi');
    EXECUTE def;
  END LOOP;
END $$;

-- La copia vieja del login en el esquema control_obra no debe ser alcanzable por la API.
REVOKE EXECUTE ON FUNCTION control_obra.verificar_login(text, text, text, text) FROM PUBLIC, anon, authenticated;
