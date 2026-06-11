-- Migration: Create SUA Tables for IMSS/Infonavit Payment Tracking
-- Date: 2026-01-11
-- Description: Tables for managing IMSS monthly payments and Infonavit bimonthly payments with surcharge calculation

-- ============================================
-- SUA Declarations Table (IMSS + Infonavit)
-- ============================================
CREATE TABLE IF NOT EXISTS sua_declaraciones (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('IMSS', 'Infonavit')),
  periodo VARCHAR(30) NOT NULL,
  mes INTEGER CHECK (mes >= 1 AND mes <= 12),
  bimestre INTEGER CHECK (bimestre >= 1 AND bimestre <= 6),
  anio INTEGER NOT NULL,
  fecha_limite DATE NOT NULL,
  estatus VARCHAR(30) NOT NULL DEFAULT 'Pendiente' CHECK (estatus IN ('Pendiente', 'Pagado', 'Pagado con Recargos', 'Vencido')),

  -- Montos
  num_trabajadores INTEGER DEFAULT 0,
  monto_cuotas DECIMAL(14,2) DEFAULT 0,
  monto_aportaciones DECIMAL(14,2) DEFAULT 0,
  monto_amortizaciones DECIMAL(14,2) DEFAULT 0,
  monto_total DECIMAL(14,2) DEFAULT 0,

  -- Pago
  fecha_pago DATE,
  monto_pagado DECIMAL(14,2),
  monto_recargos DECIMAL(14,2) DEFAULT 0,
  monto_actualizacion DECIMAL(14,2) DEFAULT 0,
  folio_pago VARCHAR(100),
  banco VARCHAR(100),

  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SUA Concepts/Breakdown Table
-- ============================================
CREATE TABLE IF NOT EXISTS sua_conceptos (
  id SERIAL PRIMARY KEY,
  declaracion_id INTEGER REFERENCES sua_declaraciones(id) ON DELETE CASCADE,
  concepto VARCHAR(100) NOT NULL,
  monto DECIMAL(14,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SUA Documents Table
-- ============================================
CREATE TABLE IF NOT EXISTS sua_documentos (
  id SERIAL PRIMARY KEY,
  declaracion_id INTEGER REFERENCES sua_declaraciones(id) ON DELETE CASCADE,
  nombre VARCHAR(255) NOT NULL,
  tipo_documento VARCHAR(50) CHECK (tipo_documento IN ('Comprobante Pago', 'Archivo SUA', 'SIPARE', 'Acuse', 'Otro')),
  url_archivo TEXT,
  fecha_subida TIMESTAMPTZ DEFAULT NOW(),
  subido_por INTEGER
);

-- ============================================
-- SUA Parameters Table (Surcharge rates, reminders)
-- ============================================
CREATE TABLE IF NOT EXISTS sua_parametros (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL UNIQUE,
  tasa_recargos_mensual DECIMAL(6,4) DEFAULT 0.0147,
  dias_gracia INTEGER DEFAULT 0,
  notificar_email BOOLEAN DEFAULT true,
  notificar_dashboard BOOLEAN DEFAULT true,
  dias_recordatorio JSONB DEFAULT '[15, 7, 1]',
  emails_notificacion TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes for Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_sua_declaraciones_empresa ON sua_declaraciones(empresa_id);
CREATE INDEX IF NOT EXISTS idx_sua_declaraciones_fecha ON sua_declaraciones(fecha_limite);
CREATE INDEX IF NOT EXISTS idx_sua_declaraciones_estatus ON sua_declaraciones(estatus);
CREATE INDEX IF NOT EXISTS idx_sua_declaraciones_tipo ON sua_declaraciones(tipo);
CREATE INDEX IF NOT EXISTS idx_sua_declaraciones_anio ON sua_declaraciones(anio);
CREATE INDEX IF NOT EXISTS idx_sua_conceptos_declaracion ON sua_conceptos(declaracion_id);
CREATE INDEX IF NOT EXISTS idx_sua_documentos_declaracion ON sua_documentos(declaracion_id);
CREATE INDEX IF NOT EXISTS idx_sua_parametros_empresa ON sua_parametros(empresa_id);

-- ============================================
-- Enable Row Level Security (Permissive)
-- ============================================
ALTER TABLE sua_declaraciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE sua_conceptos ENABLE ROW LEVEL SECURITY;
ALTER TABLE sua_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE sua_parametros ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies (Permissive - matching existing pattern)
-- ============================================
DROP POLICY IF EXISTS sua_declaraciones_all ON sua_declaraciones;
CREATE POLICY sua_declaraciones_all ON sua_declaraciones FOR ALL USING (true);

DROP POLICY IF EXISTS sua_conceptos_all ON sua_conceptos;
CREATE POLICY sua_conceptos_all ON sua_conceptos FOR ALL USING (true);

DROP POLICY IF EXISTS sua_documentos_all ON sua_documentos;
CREATE POLICY sua_documentos_all ON sua_documentos FOR ALL USING (true);

DROP POLICY IF EXISTS sua_parametros_all ON sua_parametros;
CREATE POLICY sua_parametros_all ON sua_parametros FOR ALL USING (true);

-- ============================================
-- Function to Auto-Update Estatus to 'Vencido'
-- ============================================
CREATE OR REPLACE FUNCTION update_sua_estatus_vencido()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE sua_declaraciones
  SET estatus = 'Vencido', updated_at = NOW()
  WHERE fecha_limite < CURRENT_DATE
  AND estatus = 'Pendiente';
END;
$$;

-- ============================================
-- Function to Calculate Surcharges
-- ============================================
CREATE OR REPLACE FUNCTION calcular_recargos_sua(
  p_monto_original DECIMAL(14,2),
  p_fecha_limite DATE,
  p_fecha_pago DATE,
  p_tasa_mensual DECIMAL(6,4) DEFAULT 0.0147
)
RETURNS TABLE(
  dias_atraso INTEGER,
  meses_atraso DECIMAL(10,2),
  monto_recargos DECIMAL(14,2),
  monto_total DECIMAL(14,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dias INTEGER;
  v_meses DECIMAL(10,2);
  v_recargos DECIMAL(14,2);
BEGIN
  -- Calculate days late
  v_dias := GREATEST(0, p_fecha_pago - p_fecha_limite);

  -- Calculate months (partial)
  v_meses := v_dias / 30.0;

  -- Calculate surcharges
  v_recargos := ROUND(p_monto_original * p_tasa_mensual * v_meses, 2);

  RETURN QUERY SELECT
    v_dias,
    ROUND(v_meses, 2),
    v_recargos,
    p_monto_original + v_recargos;
END;
$$;

-- ============================================
-- Grant Permissions
-- ============================================
GRANT ALL ON sua_declaraciones TO anon, authenticated;
GRANT ALL ON sua_conceptos TO anon, authenticated;
GRANT ALL ON sua_documentos TO anon, authenticated;
GRANT ALL ON sua_parametros TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE sua_declaraciones_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE sua_conceptos_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE sua_documentos_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE sua_parametros_id_seq TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_sua_estatus_vencido() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION calcular_recargos_sua(DECIMAL, DATE, DATE, DECIMAL) TO anon, authenticated;

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE sua_declaraciones IS 'SUA declarations for IMSS (monthly) and Infonavit (bimonthly) payments. Late payments incur ~1.47% monthly surcharge.';
COMMENT ON COLUMN sua_declaraciones.tipo IS 'IMSS = monthly payment, Infonavit = bimonthly payment';
COMMENT ON COLUMN sua_declaraciones.mes IS 'Month number (1-12) for IMSS declarations';
COMMENT ON COLUMN sua_declaraciones.bimestre IS 'Bimonth number (1-6) for Infonavit declarations';
COMMENT ON COLUMN sua_parametros.tasa_recargos_mensual IS 'Monthly surcharge rate (default 1.47% = 0.0147)';
COMMENT ON FUNCTION calcular_recargos_sua IS 'Calculate surcharges for late SUA payments based on days late and monthly rate';
