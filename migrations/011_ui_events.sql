-- 011: telemetría de uso de la interfaz (US-029). Sin datos personales.
CREATE TABLE IF NOT EXISTS control_obra.ui_events (
  id bigserial PRIMARY KEY,
  empresa_id integer NOT NULL,
  user_id uuid,
  evento text NOT NULL,
  modulo text,
  obra_id integer,
  viewport_w integer,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ui_events_empresa_fecha ON control_obra.ui_events (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ui_events_evento ON control_obra.ui_events (evento);

-- Vista pública (PostgREST) con la lista explícita de columnas, como el resto del esquema
CREATE OR REPLACE VIEW public.ui_events AS
  SELECT id, empresa_id, user_id, evento, modulo, obra_id, viewport_w, meta, created_at
  FROM control_obra.ui_events;

ALTER TABLE control_obra.ui_events ENABLE ROW LEVEL SECURITY;
-- Inserción desde la app: cualquier sesión (anon con apikey); lectura sólo de la propia empresa vía token
DROP POLICY IF EXISTS ui_events_insert ON control_obra.ui_events;
CREATE POLICY ui_events_insert ON control_obra.ui_events FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS ui_events_select ON control_obra.ui_events;
CREATE POLICY ui_events_select ON control_obra.ui_events FOR SELECT TO anon, authenticated
  USING (empresa_id = public.get_session_empresa_id());
GRANT SELECT, INSERT ON control_obra.ui_events TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.ui_events_id_seq TO anon, authenticated;
GRANT SELECT, INSERT ON public.ui_events TO anon, authenticated;

-- Uso por módulo en los últimos 30 días: usuarios distintos, eventos y % desde móvil (< 768 px)
CREATE OR REPLACE VIEW public.v_uso_modulos_30d AS
  SELECT empresa_id,
         COALESCE(modulo, '(sin módulo)') AS modulo,
         COUNT(DISTINCT user_id) AS usuarios,
         COUNT(*) AS eventos,
         ROUND(100.0 * COUNT(*) FILTER (WHERE viewport_w < 768) / NULLIF(COUNT(*), 0), 1) AS pct_movil,
         MAX(created_at) AS ultimo_evento
  FROM control_obra.ui_events
  WHERE created_at >= now() - interval '30 days'
  GROUP BY empresa_id, COALESCE(modulo, '(sin módulo)');
GRANT SELECT ON public.v_uso_modulos_30d TO anon, authenticated;
