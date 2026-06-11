-- Migration: Create Error Monitoring Tables
-- Date: 2025-12-21

-- Platform Errors Table - Centralized error log
CREATE TABLE IF NOT EXISTS platform_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE SET NULL,
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

-- Error Occurrences Table - Grouped errors by fingerprint
CREATE TABLE IF NOT EXISTS error_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint VARCHAR(64) UNIQUE NOT NULL,
  first_error_id UUID REFERENCES platform_errors(id),
  occurrence_count INTEGER DEFAULT 1,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'active',
  resolution_note TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES platform_admins(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_platform_errors_fingerprint ON platform_errors(fingerprint);
CREATE INDEX IF NOT EXISTS idx_platform_errors_empresa_id ON platform_errors(empresa_id);
CREATE INDEX IF NOT EXISTS idx_platform_errors_created_at ON platform_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_errors_status ON platform_errors(status);
CREATE INDEX IF NOT EXISTS idx_error_occurrences_status ON error_occurrences(status);
CREATE INDEX IF NOT EXISTS idx_error_occurrences_last_seen ON error_occurrences(last_seen DESC);

-- Enable RLS
ALTER TABLE platform_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_occurrences ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Access only via service role (admin panel)
CREATE POLICY platform_errors_select ON platform_errors FOR SELECT USING (false);
CREATE POLICY platform_errors_insert ON platform_errors FOR INSERT WITH CHECK (true); -- Allow inserts from client
CREATE POLICY platform_errors_update ON platform_errors FOR UPDATE USING (false);
CREATE POLICY platform_errors_delete ON platform_errors FOR DELETE USING (false);

CREATE POLICY error_occurrences_select ON error_occurrences FOR SELECT USING (false);
CREATE POLICY error_occurrences_insert ON error_occurrences FOR INSERT WITH CHECK (false);
CREATE POLICY error_occurrences_update ON error_occurrences FOR UPDATE USING (false);
CREATE POLICY error_occurrences_delete ON error_occurrences FOR DELETE USING (false);
