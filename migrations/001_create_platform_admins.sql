-- Migration: Create Platform Admins Tables
-- Date: 2025-12-21

-- Platform Admins Table
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

-- Platform Sessions Table
CREATE TABLE IF NOT EXISTS platform_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES platform_admins(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies (restrictive - access only via service role)
CREATE POLICY platform_admins_select ON platform_admins FOR SELECT USING (false);
CREATE POLICY platform_admins_insert ON platform_admins FOR INSERT WITH CHECK (false);
CREATE POLICY platform_admins_update ON platform_admins FOR UPDATE USING (false);
CREATE POLICY platform_admins_delete ON platform_admins FOR DELETE USING (false);

CREATE POLICY platform_sessions_select ON platform_sessions FOR SELECT USING (false);
CREATE POLICY platform_sessions_insert ON platform_sessions FOR INSERT WITH CHECK (false);
CREATE POLICY platform_sessions_update ON platform_sessions FOR UPDATE USING (false);
CREATE POLICY platform_sessions_delete ON platform_sessions FOR DELETE USING (false);
