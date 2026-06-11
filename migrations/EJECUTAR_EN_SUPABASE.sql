-- ============================================
-- SCRIPT COMPLETO - EJECUTAR EN SUPABASE SQL EDITOR
-- Control de Obra - Sistema de Administracion
-- Fecha: 2025-12-21
-- ============================================

-- PARTE 1: Extension pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- PARTE 2: Tabla platform_admins
CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(50) DEFAULT 'platform_admin',
  activo BOOLEAN DEFAULT true,
  ultimo_acceso TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PARTE 3: Tabla platform_sessions
CREATE TABLE IF NOT EXISTS platform_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES platform_admins(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PARTE 4: Tabla subscription_plans
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(100) NOT NULL,
  precio_mensual DECIMAL(10,2) DEFAULT 0,
  precio_anual DECIMAL(10,2) DEFAULT 0,
  max_usuarios INTEGER DEFAULT 3,
  max_obras INTEGER DEFAULT 2,
  max_storage_mb INTEGER DEFAULT 500,
  features JSONB DEFAULT '{}',
  activo BOOLEAN DEFAULT true,
  orden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PARTE 5: Tabla empresa_subscriptions
CREATE TABLE IF NOT EXISTS empresa_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES subscription_plans(id),
  estado VARCHAR(50) DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ DEFAULT NOW(),
  current_period_end TIMESTAMPTZ,
  billing_email VARCHAR(255),
  payment_method VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(empresa_id)
);

-- PARTE 6: Tabla platform_errors
CREATE TABLE IF NOT EXISTS platform_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id INTEGER,
  user_id UUID,
  error_type VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  stack_trace TEXT,
  url TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  fingerprint VARCHAR(64),
  status VARCHAR(50) DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PARTE 7: Tabla error_occurrences
CREATE TABLE IF NOT EXISTS error_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint VARCHAR(64) UNIQUE NOT NULL,
  first_error_id UUID,
  occurrence_count INTEGER DEFAULT 1,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'active',
  resolution_note TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID
);

-- PARTE 8: Indices
CREATE INDEX IF NOT EXISTS idx_platform_errors_fingerprint ON platform_errors(fingerprint);
CREATE INDEX IF NOT EXISTS idx_platform_errors_empresa_id ON platform_errors(empresa_id);
CREATE INDEX IF NOT EXISTS idx_platform_errors_created_at ON platform_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_occurrences_status ON error_occurrences(status);

-- PARTE 9: RLS en tablas
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresa_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_occurrences ENABLE ROW LEVEL SECURITY;

-- PARTE 10: Politicas RLS permisivas (para que funcione con anon key)
DROP POLICY IF EXISTS platform_admins_all ON platform_admins;
CREATE POLICY platform_admins_all ON platform_admins FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS platform_sessions_all ON platform_sessions;
CREATE POLICY platform_sessions_all ON platform_sessions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS subscription_plans_all ON subscription_plans;
CREATE POLICY subscription_plans_all ON subscription_plans FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS empresa_subscriptions_all ON empresa_subscriptions;
CREATE POLICY empresa_subscriptions_all ON empresa_subscriptions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS platform_errors_all ON platform_errors;
CREATE POLICY platform_errors_all ON platform_errors FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS error_occurrences_all ON error_occurrences;
CREATE POLICY error_occurrences_all ON error_occurrences FOR ALL USING (true) WITH CHECK (true);

-- PARTE 11: Funcion platform_admin_login
CREATE OR REPLACE FUNCTION platform_admin_login(p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin platform_admins%ROWTYPE;
  v_token TEXT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_admin
  FROM platform_admins
  WHERE email = LOWER(TRIM(p_email)) AND activo = true;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Credenciales invalidas');
  END IF;

  IF v_admin.password_hash != crypt(p_password, v_admin.password_hash) THEN
    RETURN json_build_object('success', false, 'error', 'Credenciales invalidas');
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires_at := NOW() + INTERVAL '24 hours';

  INSERT INTO platform_sessions (admin_id, token, expires_at)
  VALUES (v_admin.id, v_token, v_expires_at);

  UPDATE platform_admins SET ultimo_acceso = NOW() WHERE id = v_admin.id;

  RETURN json_build_object(
    'success', true,
    'token', v_token,
    'admin', json_build_object(
      'id', v_admin.id,
      'email', v_admin.email,
      'nombre', v_admin.nombre,
      'rol', v_admin.rol
    )
  );
END;
$$;

-- PARTE 12: Funcion validate_platform_session
CREATE OR REPLACE FUNCTION validate_platform_session(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session platform_sessions%ROWTYPE;
  v_admin platform_admins%ROWTYPE;
BEGIN
  SELECT * INTO v_session
  FROM platform_sessions
  WHERE token = p_token AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false);
  END IF;

  SELECT * INTO v_admin
  FROM platform_admins
  WHERE id = v_session.admin_id AND activo = true;

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false);
  END IF;

  RETURN json_build_object(
    'valid', true,
    'admin', json_build_object(
      'id', v_admin.id,
      'email', v_admin.email,
      'nombre', v_admin.nombre,
      'rol', v_admin.rol
    )
  );
END;
$$;

-- PARTE 13: Funcion platform_admin_logout
CREATE OR REPLACE FUNCTION platform_admin_logout(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM platform_sessions WHERE token = p_token;
  RETURN json_build_object('success', true);
END;
$$;

-- PARTE 14: Funcion log_client_error
CREATE OR REPLACE FUNCTION log_client_error(
  p_error_type TEXT,
  p_message TEXT,
  p_stack_trace TEXT DEFAULT NULL,
  p_url TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB,
  p_empresa_id INTEGER DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fingerprint TEXT;
  v_error_id UUID;
BEGIN
  v_fingerprint := encode(digest(p_error_type || ':' || split_part(p_message, E'\n', 1), 'sha256'), 'hex');

  INSERT INTO platform_errors (
    empresa_id, user_id, error_type, message, stack_trace,
    url, user_agent, metadata, fingerprint
  ) VALUES (
    p_empresa_id, p_user_id, p_error_type, p_message, p_stack_trace,
    p_url, p_user_agent, p_metadata, v_fingerprint
  )
  RETURNING id INTO v_error_id;

  INSERT INTO error_occurrences (fingerprint, first_error_id, first_seen, last_seen)
  VALUES (v_fingerprint, v_error_id, NOW(), NOW())
  ON CONFLICT (fingerprint) DO UPDATE SET
    occurrence_count = error_occurrences.occurrence_count + 1,
    last_seen = NOW();

  RETURN v_error_id;
END;
$$;

-- PARTE 15: Funcion get_platform_stats
CREATE OR REPLACE FUNCTION get_platform_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats JSON;
BEGIN
  SELECT json_build_object(
    'total_empresas', (SELECT COUNT(*) FROM empresas WHERE activo = true),
    'total_usuarios', (SELECT COUNT(*) FROM obra_usuarios WHERE activo = true),
    'total_obras', (SELECT COUNT(*) FROM obras),
    'active_sessions', (SELECT COUNT(*) FROM obra_sesiones WHERE expires_at > NOW()),
    'errors_24h', (SELECT COUNT(*) FROM platform_errors WHERE created_at > NOW() - INTERVAL '24 hours'),
    'mrr', COALESCE((
      SELECT SUM(sp.precio_mensual)
      FROM empresa_subscriptions es
      JOIN subscription_plans sp ON es.plan_id = sp.id
      WHERE es.estado = 'active'
    ), 0)
  ) INTO v_stats;

  RETURN v_stats;
END;
$$;

-- PARTE 16: Seed planes de suscripcion
INSERT INTO subscription_plans (nombre, precio_mensual, precio_anual, max_usuarios, max_obras, max_storage_mb, features, orden) VALUES
('Free', 0, 0, 3, 2, 500, '{"basic_reports": true}', 1),
('Pro', 799, 7990, 15, 10, 5120, '{"basic_reports": true, "advanced_reports": true, "pdf_export": true}', 2),
('Enterprise', 1999, 19990, -1, -1, 51200, '{"basic_reports": true, "advanced_reports": true, "pdf_export": true, "api_access": true, "priority_support": true}', 3)
ON CONFLICT DO NOTHING;

-- PARTE 17: Crear primer admin
-- Credenciales: admin@controlobra.mx / CHANGE_ME_BEFORE_RUNNING
INSERT INTO platform_admins (email, nombre, password_hash, rol)
VALUES (
  'admin@controlobra.mx',
  'Administrador Principal',
  crypt('CHANGE_ME_BEFORE_RUNNING', gen_salt('bf', 10)),
  'super_admin'
)
ON CONFLICT (email) DO NOTHING;

-- PARTE 18: Migrar empresas existentes a plan free
INSERT INTO empresa_subscriptions (empresa_id, plan_id, estado, trial_ends_at, current_period_end)
SELECT
  e.id,
  (SELECT id FROM subscription_plans WHERE nombre = 'Free' LIMIT 1),
  'active',
  NOW() + INTERVAL '30 days',
  NOW() + INTERVAL '30 days'
FROM empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM empresa_subscriptions es WHERE es.empresa_id = e.id
);

-- FIN DEL SCRIPT
SELECT 'Migracion completada exitosamente' as resultado;
