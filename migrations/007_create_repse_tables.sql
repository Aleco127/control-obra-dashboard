-- Migration: Create REPSE Tables for IMSS Compliance
-- Date: 2026-01-11
-- Description: Tables for managing REPSE quarterly declarations, related contracts, and documents

-- ============================================
-- REPSE Declarations Table
-- ============================================
CREATE TABLE IF NOT EXISTS repse_declaraciones (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL,
  cuatrimestre VARCHAR(20) NOT NULL CHECK (cuatrimestre IN ('Primero', 'Segundo', 'Tercero')),
  anio INTEGER NOT NULL,
  periodo_cubierto VARCHAR(50), -- e.g., 'Septiembre-Diciembre'
  fecha_limite DATE NOT NULL,
  tipo VARCHAR(20) NOT NULL DEFAULT 'Normal' CHECK (tipo IN ('Normal', 'Sin Información')),
  estatus VARCHAR(20) NOT NULL DEFAULT 'Pendiente' CHECK (estatus IN ('Pendiente', 'En Proceso', 'Presentada', 'Vencida')),
  fecha_presentacion DATE,
  folio_acuse VARCHAR(100),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(empresa_id, cuatrimestre, anio)
);

-- ============================================
-- REPSE Contracts Relation Table
-- ============================================
CREATE TABLE IF NOT EXISTS repse_contratos (
  id SERIAL PRIMARY KEY,
  declaracion_id INTEGER REFERENCES repse_declaraciones(id) ON DELETE CASCADE,
  subcontrato_id INTEGER, -- Optional reference to existing subcontratos
  tipo_servicio VARCHAR(100),
  rfc_prestador VARCHAR(13),
  razon_social_prestador VARCHAR(255),
  monto_contrato DECIMAL(14,2) DEFAULT 0,
  fecha_inicio DATE,
  fecha_fin DATE,
  incluido_declaracion BOOLEAN DEFAULT true,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- REPSE Documents Table
-- ============================================
CREATE TABLE IF NOT EXISTS repse_documentos (
  id SERIAL PRIMARY KEY,
  declaracion_id INTEGER REFERENCES repse_declaraciones(id) ON DELETE CASCADE,
  nombre VARCHAR(255) NOT NULL,
  tipo_documento VARCHAR(50) CHECK (tipo_documento IN ('Acuse', 'Constancia', 'Recibo', 'Contrato', 'Otro')),
  url_archivo TEXT,
  fecha_subida TIMESTAMPTZ DEFAULT NOW(),
  subido_por INTEGER
);

-- ============================================
-- REPSE Reminder Configuration Table
-- ============================================
CREATE TABLE IF NOT EXISTS repse_config_recordatorios (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL UNIQUE,
  dias_antes JSONB DEFAULT '[15, 7, 1]',
  notificar_email BOOLEAN DEFAULT true,
  notificar_dashboard BOOLEAN DEFAULT true,
  emails_notificacion TEXT[], -- Array of email addresses
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes for Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_repse_declaraciones_empresa ON repse_declaraciones(empresa_id);
CREATE INDEX IF NOT EXISTS idx_repse_declaraciones_fecha ON repse_declaraciones(fecha_limite);
CREATE INDEX IF NOT EXISTS idx_repse_declaraciones_estatus ON repse_declaraciones(estatus);
CREATE INDEX IF NOT EXISTS idx_repse_declaraciones_anio ON repse_declaraciones(anio);
CREATE INDEX IF NOT EXISTS idx_repse_contratos_declaracion ON repse_contratos(declaracion_id);
CREATE INDEX IF NOT EXISTS idx_repse_documentos_declaracion ON repse_documentos(declaracion_id);
CREATE INDEX IF NOT EXISTS idx_repse_config_empresa ON repse_config_recordatorios(empresa_id);

-- ============================================
-- Enable Row Level Security (Permissive)
-- ============================================
ALTER TABLE repse_declaraciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE repse_contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE repse_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE repse_config_recordatorios ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies (Permissive - matching existing pattern)
-- ============================================
DROP POLICY IF EXISTS repse_declaraciones_all ON repse_declaraciones;
CREATE POLICY repse_declaraciones_all ON repse_declaraciones FOR ALL USING (true);

DROP POLICY IF EXISTS repse_contratos_all ON repse_contratos;
CREATE POLICY repse_contratos_all ON repse_contratos FOR ALL USING (true);

DROP POLICY IF EXISTS repse_documentos_all ON repse_documentos;
CREATE POLICY repse_documentos_all ON repse_documentos FOR ALL USING (true);

DROP POLICY IF EXISTS repse_config_all ON repse_config_recordatorios;
CREATE POLICY repse_config_all ON repse_config_recordatorios FOR ALL USING (true);

-- ============================================
-- Function to Auto-Update Estatus to 'Vencida'
-- ============================================
CREATE OR REPLACE FUNCTION update_repse_estatus_vencida()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE repse_declaraciones
  SET estatus = 'Vencida', updated_at = NOW()
  WHERE fecha_limite < CURRENT_DATE
  AND estatus NOT IN ('Presentada', 'Vencida');
END;
$$;

-- ============================================
-- Grant Permissions
-- ============================================
GRANT ALL ON repse_declaraciones TO anon, authenticated;
GRANT ALL ON repse_contratos TO anon, authenticated;
GRANT ALL ON repse_documentos TO anon, authenticated;
GRANT ALL ON repse_config_recordatorios TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE repse_declaraciones_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE repse_contratos_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE repse_documentos_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE repse_config_recordatorios_id_seq TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_repse_estatus_vencida() TO anon, authenticated;

-- ============================================
-- Insert Default Calendar (Optional - for reference)
-- ============================================
-- These are the standard REPSE deadlines:
-- Tercero (Sep-Dic): ~19 Enero siguiente
-- Primero (Ene-Abr): ~18 Mayo mismo año
-- Segundo (May-Ago): ~17 Septiembre mismo año

COMMENT ON TABLE repse_declaraciones IS 'REPSE quarterly declarations for IMSS compliance. Penalties: $56,570 to $226,280 per missed period.';
COMMENT ON COLUMN repse_declaraciones.cuatrimestre IS 'Quarter: Primero (Jan-Apr), Segundo (May-Aug), Tercero (Sep-Dec)';
COMMENT ON COLUMN repse_declaraciones.tipo IS 'Normal = with contracts, Sin Información = no contracts in period';
