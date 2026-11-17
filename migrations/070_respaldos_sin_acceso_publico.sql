-- 070 · Las tablas de respaldo control_obra._bak_* quedaron sin RLS y con todos los permisos para anon/authenticated:
-- se leían (y se podían vaciar) con la llave pública vía Accept-Profile: control_obra. (17-nov-2026)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'control_obra' AND c.relkind = 'r' AND c.relname LIKE '\_bak\_%' LOOP
    EXECUTE format('REVOKE ALL ON control_obra.%I FROM anon, authenticated, PUBLIC', r.relname);
    EXECUTE format('ALTER TABLE control_obra.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;
