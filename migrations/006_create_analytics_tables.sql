-- Migration: Create Analytics Tables
-- Date: 2025-12-21

-- Platform Metrics Daily
CREATE TABLE IF NOT EXISTS platform_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha DATE NOT NULL UNIQUE,
  total_empresas INTEGER DEFAULT 0,
  total_usuarios INTEGER DEFAULT 0,
  active_usuarios INTEGER DEFAULT 0,
  mrr DECIMAL(12,2) DEFAULT 0,
  total_errors INTEGER DEFAULT 0,
  new_signups INTEGER DEFAULT 0,
  churned_empresas INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Empresa Activity Daily
CREATE TABLE IF NOT EXISTS empresa_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  logins INTEGER DEFAULT 0,
  gastos_created INTEGER DEFAULT 0,
  obras_created INTEGER DEFAULT 0,
  facturas_created INTEGER DEFAULT 0,
  storage_used_mb INTEGER DEFAULT 0,
  features_used JSONB DEFAULT '[]',
  UNIQUE(empresa_id, fecha)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_platform_metrics_fecha ON platform_metrics_daily(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_empresa_activity_fecha ON empresa_activity(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_empresa_activity_empresa ON empresa_activity(empresa_id);

-- Enable RLS
ALTER TABLE platform_metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresa_activity ENABLE ROW LEVEL SECURITY;

-- RLS Policies (admin only via service role)
CREATE POLICY platform_metrics_select ON platform_metrics_daily FOR SELECT USING (false);
CREATE POLICY platform_metrics_all ON platform_metrics_daily FOR ALL USING (false);

CREATE POLICY empresa_activity_select ON empresa_activity FOR SELECT USING (false);
CREATE POLICY empresa_activity_all ON empresa_activity FOR ALL USING (false);

-- Function to record daily metrics
CREATE OR REPLACE FUNCTION record_daily_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO platform_metrics_daily (
    fecha,
    total_empresas,
    total_usuarios,
    active_usuarios,
    mrr,
    total_errors,
    new_signups
  )
  SELECT
    CURRENT_DATE,
    (SELECT COUNT(*) FROM empresas WHERE activo = true),
    (SELECT COUNT(*) FROM obra_usuarios WHERE activo = true),
    (SELECT COUNT(DISTINCT user_id) FROM obra_sesiones WHERE created_at > CURRENT_DATE - INTERVAL '1 day'),
    (
      SELECT COALESCE(SUM(sp.precio_mensual), 0)
      FROM empresa_subscriptions es
      JOIN subscription_plans sp ON es.plan_id = sp.id
      WHERE es.estado = 'active'
    ),
    (SELECT COUNT(*) FROM platform_errors WHERE created_at > CURRENT_DATE - INTERVAL '1 day'),
    (SELECT COUNT(*) FROM empresas WHERE created_at > CURRENT_DATE - INTERVAL '1 day')
  ON CONFLICT (fecha) DO UPDATE SET
    total_empresas = EXCLUDED.total_empresas,
    total_usuarios = EXCLUDED.total_usuarios,
    active_usuarios = EXCLUDED.active_usuarios,
    mrr = EXCLUDED.mrr,
    total_errors = EXCLUDED.total_errors,
    new_signups = EXCLUDED.new_signups;
END;
$$;

-- Function to get analytics data
CREATE OR REPLACE FUNCTION get_platform_analytics(p_days INTEGER DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'daily_metrics', (
      SELECT json_agg(row_to_json(m) ORDER BY m.fecha DESC)
      FROM (
        SELECT fecha, total_empresas, total_usuarios, active_usuarios, mrr, total_errors, new_signups
        FROM platform_metrics_daily
        WHERE fecha > CURRENT_DATE - p_days
      ) m
    ),
    'top_empresas_by_activity', (
      SELECT json_agg(row_to_json(e))
      FROM (
        SELECT
          ea.empresa_id,
          emp.nombre as empresa_nombre,
          SUM(ea.logins) as total_logins,
          SUM(ea.gastos_created) as total_gastos
        FROM empresa_activity ea
        JOIN empresas emp ON ea.empresa_id = emp.id
        WHERE ea.fecha > CURRENT_DATE - p_days
        GROUP BY ea.empresa_id, emp.nombre
        ORDER BY total_logins DESC
        LIMIT 10
      ) e
    ),
    'subscription_breakdown', (
      SELECT json_agg(row_to_json(s))
      FROM (
        SELECT
          sp.nombre as plan,
          COUNT(*) as count,
          SUM(sp.precio_mensual) as revenue
        FROM empresa_subscriptions es
        JOIN subscription_plans sp ON es.plan_id = sp.id
        WHERE es.estado = 'active'
        GROUP BY sp.nombre
      ) s
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION record_daily_metrics TO authenticated;
GRANT EXECUTE ON FUNCTION get_platform_analytics TO anon, authenticated;
