-- Migration: Create Subscription Tables
-- Date: 2025-12-21

-- Subscription Plans Table
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

-- Empresa Subscriptions Table
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

-- Enable RLS
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresa_subscriptions ENABLE ROW LEVEL SECURITY;

-- Subscription plans are readable by all (public catalog)
CREATE POLICY subscription_plans_select ON subscription_plans FOR SELECT USING (activo = true);
CREATE POLICY subscription_plans_admin ON subscription_plans FOR ALL USING (false);

-- Empresa subscriptions - access only via service role
CREATE POLICY empresa_subscriptions_select ON empresa_subscriptions FOR SELECT USING (false);
CREATE POLICY empresa_subscriptions_insert ON empresa_subscriptions FOR INSERT WITH CHECK (false);
CREATE POLICY empresa_subscriptions_update ON empresa_subscriptions FOR UPDATE USING (false);
CREATE POLICY empresa_subscriptions_delete ON empresa_subscriptions FOR DELETE USING (false);

-- Seed default plans
INSERT INTO subscription_plans (nombre, precio_mensual, precio_anual, max_usuarios, max_obras, max_storage_mb, features, orden) VALUES
('Free', 0, 0, 3, 2, 500, '{"basic_reports": true}', 1),
('Pro', 799, 7990, 15, 10, 5120, '{"basic_reports": true, "advanced_reports": true, "pdf_export": true}', 2),
('Enterprise', 1999, 19990, -1, -1, 51200, '{"basic_reports": true, "advanced_reports": true, "pdf_export": true, "api_access": true, "priority_support": true}', 3)
ON CONFLICT DO NOTHING;
