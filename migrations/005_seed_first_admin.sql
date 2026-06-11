-- Migration: Seed First Platform Admin
-- Date: 2025-12-21
-- IMPORTANT: Change the password hash before running in production!

-- Create first platform admin
-- Default credentials: admin@controlobra.mx / CHANGE_ME_BEFORE_RUNNING
INSERT INTO platform_admins (email, nombre, password_hash, rol)
VALUES (
  'admin@controlobra.mx',
  'Administrador Principal',
  crypt('CHANGE_ME_BEFORE_RUNNING', gen_salt('bf', 10)),
  'super_admin'
)
ON CONFLICT (email) DO NOTHING;

-- Migrate existing empresas to free plan
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
