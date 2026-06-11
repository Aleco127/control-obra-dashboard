-- Migration: 009_catalogo_conceptos_cot.sql
-- Description: Create catalog of reusable concepts for cotizaciones
-- Date: 2026-01-25
-- Note: Already executed via Supabase MCP

-- Create table for reusable quote concepts catalog
-- Named catalogo_conceptos_cot to distinguish from existing catalogo_conceptos (obra-specific)
CREATE TABLE control_obra.catalogo_conceptos_cot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id INTEGER NOT NULL,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('diseno', 'construccion')),
  categoria VARCHAR(100) NOT NULL,
  clave VARCHAR(50),
  nombre VARCHAR(255) NOT NULL,
  descripcion TEXT,
  unidad VARCHAR(50),
  precio_sugerido NUMERIC(15, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX idx_catalogo_conceptos_cot_empresa ON control_obra.catalogo_conceptos_cot(empresa_id);
CREATE INDEX idx_catalogo_conceptos_cot_tipo ON control_obra.catalogo_conceptos_cot(tipo);
CREATE INDEX idx_catalogo_conceptos_cot_categoria ON control_obra.catalogo_conceptos_cot(categoria);

-- Create view in public schema for app access
CREATE OR REPLACE VIEW public.catalogo_conceptos_cot AS
SELECT * FROM control_obra.catalogo_conceptos_cot;

-- Enable RLS on the base table
ALTER TABLE control_obra.catalogo_conceptos_cot ENABLE ROW LEVEL SECURITY;

-- Create RLS policies using the existing session function
CREATE POLICY "catalogo_conceptos_cot_select" ON control_obra.catalogo_conceptos_cot
  FOR SELECT USING (empresa_id = control_obra.get_session_empresa_id());

CREATE POLICY "catalogo_conceptos_cot_insert" ON control_obra.catalogo_conceptos_cot
  FOR INSERT WITH CHECK (empresa_id = control_obra.get_session_empresa_id());

CREATE POLICY "catalogo_conceptos_cot_update" ON control_obra.catalogo_conceptos_cot
  FOR UPDATE USING (empresa_id = control_obra.get_session_empresa_id());

CREATE POLICY "catalogo_conceptos_cot_delete" ON control_obra.catalogo_conceptos_cot
  FOR DELETE USING (empresa_id = control_obra.get_session_empresa_id());

-- ===========================================================================
-- SEED DATA: Design Concepts (36 items)
-- ===========================================================================

-- ARQUITECTONICO (15 items)
INSERT INTO control_obra.catalogo_conceptos_cot (empresa_id, tipo, categoria, clave, nombre, descripcion, unidad, precio_sugerido) VALUES
(1, 'diseno', 'Arquitectonico', 'ARQ-001', 'Planos Arquitectonicos', 'Conjunto de planos arquitectonicos completos', 'JGO', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-002', 'Planta de Conjunto', 'Plano de conjunto mostrando ubicacion en terreno', 'PZA', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-003', 'Plantas Arquitectonicas', 'Plantas arquitectonicas por nivel', 'PZA', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-004', 'Cortes Arquitectonicos', 'Cortes transversales y longitudinales', 'PZA', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-005', 'Fachadas', 'Alzados de fachadas principales', 'PZA', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-006', 'Planta de Azoteas', 'Plano de azoteas con pendientes y bajadas', 'PZA', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-007', 'Planos de Acabados', 'Especificacion de acabados por espacio', 'JGO', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-008', 'Detalles Constructivos', 'Detalles arquitectonicos especificos', 'JGO', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-009', 'Planos de Herreria', 'Diseno de elementos de herreria', 'JGO', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-010', 'Planos de Carpinteria', 'Diseno de elementos de carpinteria', 'JGO', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-011', 'Planos de Canceleria', 'Diseno de ventanas y puertas de aluminio', 'JGO', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-012', 'Renders 3D', 'Visualizaciones fotorrealistas del proyecto', 'PZA', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-013', 'Recorrido Virtual', 'Video de recorrido virtual del proyecto', 'PZA', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-014', 'Modelo BIM', 'Modelo tridimensional en Revit', 'PZA', 0),
(1, 'diseno', 'Arquitectonico', 'ARQ-015', 'Memoria Descriptiva', 'Documento con descripcion del proyecto', 'PZA', 0);

-- ESTRUCTURAL (5 items)
INSERT INTO control_obra.catalogo_conceptos_cot (empresa_id, tipo, categoria, clave, nombre, descripcion, unidad, precio_sugerido) VALUES
(1, 'diseno', 'Estructural', 'EST-001', 'Planos Estructurales', 'Conjunto de planos estructurales completos', 'JGO', 0),
(1, 'diseno', 'Estructural', 'EST-002', 'Plano de Cimentacion', 'Plano de cimentacion con armados', 'PZA', 0),
(1, 'diseno', 'Estructural', 'EST-003', 'Planos de Losas', 'Planos estructurales de losas por nivel', 'PZA', 0),
(1, 'diseno', 'Estructural', 'EST-004', 'Memoria de Calculo', 'Memoria de calculo estructural', 'PZA', 0),
(1, 'diseno', 'Estructural', 'EST-005', 'Detalles Estructurales', 'Detalles de conexiones y armados', 'JGO', 0);

-- ELECTRICO (5 items)
INSERT INTO control_obra.catalogo_conceptos_cot (empresa_id, tipo, categoria, clave, nombre, descripcion, unidad, precio_sugerido) VALUES
(1, 'diseno', 'Electrico', 'ELE-001', 'Planos Electricos', 'Conjunto de planos de instalacion electrica', 'JGO', 0),
(1, 'diseno', 'Electrico', 'ELE-002', 'Cuadro de Cargas', 'Calculo de cuadro de cargas', 'PZA', 0),
(1, 'diseno', 'Electrico', 'ELE-003', 'Diagrama Unifilar', 'Diagrama unifilar del sistema electrico', 'PZA', 0),
(1, 'diseno', 'Electrico', 'ELE-004', 'Plano de Iluminacion', 'Diseno de iluminacion por espacio', 'PZA', 0),
(1, 'diseno', 'Electrico', 'ELE-005', 'Plano de Contactos', 'Ubicacion de contactos y apagadores', 'PZA', 0);

-- HIDROSANITARIO (8 items)
INSERT INTO control_obra.catalogo_conceptos_cot (empresa_id, tipo, categoria, clave, nombre, descripcion, unidad, precio_sugerido) VALUES
(1, 'diseno', 'Hidrosanitario', 'HID-001', 'Planos Hidrosanitarios', 'Conjunto de planos de instalacion hidrosanitaria', 'JGO', 0),
(1, 'diseno', 'Hidrosanitario', 'HID-002', 'Plano de Agua Fria', 'Red de distribucion de agua fria', 'PZA', 0),
(1, 'diseno', 'Hidrosanitario', 'HID-003', 'Plano de Agua Caliente', 'Red de distribucion de agua caliente', 'PZA', 0),
(1, 'diseno', 'Hidrosanitario', 'HID-004', 'Plano de Drenaje', 'Red de drenaje sanitario', 'PZA', 0),
(1, 'diseno', 'Hidrosanitario', 'HID-005', 'Plano de Drenaje Pluvial', 'Sistema de captacion pluvial', 'PZA', 0),
(1, 'diseno', 'Hidrosanitario', 'HID-006', 'Isometricos', 'Isometricos de instalaciones', 'JGO', 0),
(1, 'diseno', 'Hidrosanitario', 'HID-007', 'Plano de Gas', 'Instalacion de gas LP o natural', 'PZA', 0),
(1, 'diseno', 'Hidrosanitario', 'HID-008', 'Calculo Hidraulico', 'Memoria de calculo hidraulico', 'PZA', 0);

-- AIRE ACONDICIONADO (3 items)
INSERT INTO control_obra.catalogo_conceptos_cot (empresa_id, tipo, categoria, clave, nombre, descripcion, unidad, precio_sugerido) VALUES
(1, 'diseno', 'Aire Acondicionado', 'AC-001', 'Planos de Aire Acondicionado', 'Conjunto de planos de A/C', 'JGO', 0),
(1, 'diseno', 'Aire Acondicionado', 'AC-002', 'Calculo de Cargas Termicas', 'Memoria de cargas termicas', 'PZA', 0),
(1, 'diseno', 'Aire Acondicionado', 'AC-003', 'Especificaciones de Equipos', 'Seleccion y especificacion de equipos', 'PZA', 0);

-- ===========================================================================
-- SEED DATA: Construction Concepts (25 items)
-- ===========================================================================

-- PRELIMINARES (5 items)
INSERT INTO control_obra.catalogo_conceptos_cot (empresa_id, tipo, categoria, clave, nombre, descripcion, unidad, precio_sugerido) VALUES
(1, 'construccion', 'Preliminares', 'PRE-001', 'Limpieza de Terreno', 'Limpieza, desmonte y despalme del terreno', 'M2', 0),
(1, 'construccion', 'Preliminares', 'PRE-002', 'Trazo y Nivelacion', 'Trazo y nivelacion del proyecto', 'M2', 0),
(1, 'construccion', 'Preliminares', 'PRE-003', 'Bodega y Oficina de Obra', 'Instalacion de bodega y oficina provisional', 'PZA', 0),
(1, 'construccion', 'Preliminares', 'PRE-004', 'Instalaciones Provisionales', 'Agua, luz y sanitarios provisionales', 'LOTE', 0),
(1, 'construccion', 'Preliminares', 'PRE-005', 'Demoliciones', 'Demolicion de estructuras existentes', 'M3', 0);

-- CIMENTACION (5 items)
INSERT INTO control_obra.catalogo_conceptos_cot (empresa_id, tipo, categoria, clave, nombre, descripcion, unidad, precio_sugerido) VALUES
(1, 'construccion', 'Cimentacion', 'CIM-001', 'Excavacion', 'Excavacion a cielo abierto para cimentacion', 'M3', 0),
(1, 'construccion', 'Cimentacion', 'CIM-002', 'Plantilla de Concreto', 'Plantilla de concreto pobre fc=100 kg/cm2', 'M2', 0),
(1, 'construccion', 'Cimentacion', 'CIM-003', 'Zapatas Aisladas', 'Zapatas de concreto armado', 'M3', 0),
(1, 'construccion', 'Cimentacion', 'CIM-004', 'Contratrabes', 'Contratrabes de liga de concreto armado', 'ML', 0),
(1, 'construccion', 'Cimentacion', 'CIM-005', 'Relleno Compactado', 'Relleno y compactacion con material de banco', 'M3', 0);

-- ESTRUCTURA (5 items)
INSERT INTO control_obra.catalogo_conceptos_cot (empresa_id, tipo, categoria, clave, nombre, descripcion, unidad, precio_sugerido) VALUES
(1, 'construccion', 'Estructura', 'STR-001', 'Columnas de Concreto', 'Columnas de concreto armado', 'M3', 0),
(1, 'construccion', 'Estructura', 'STR-002', 'Trabes de Concreto', 'Trabes de concreto armado', 'M3', 0),
(1, 'construccion', 'Estructura', 'STR-003', 'Losa de Entrepiso', 'Losa de concreto armado para entrepiso', 'M2', 0),
(1, 'construccion', 'Estructura', 'STR-004', 'Losa de Azotea', 'Losa de concreto armado para azotea', 'M2', 0),
(1, 'construccion', 'Estructura', 'STR-005', 'Escalera de Concreto', 'Escalera de concreto armado', 'PZA', 0);

-- ALBANILERIA (5 items)
INSERT INTO control_obra.catalogo_conceptos_cot (empresa_id, tipo, categoria, clave, nombre, descripcion, unidad, precio_sugerido) VALUES
(1, 'construccion', 'Albanileria', 'ALB-001', 'Muro de Block', 'Muro de block hueco 15x20x40 cm', 'M2', 0),
(1, 'construccion', 'Albanileria', 'ALB-002', 'Muro de Tabique', 'Muro de tabique rojo recocido', 'M2', 0),
(1, 'construccion', 'Albanileria', 'ALB-003', 'Aplanado de Mortero', 'Aplanado de mortero cemento-arena', 'M2', 0),
(1, 'construccion', 'Albanileria', 'ALB-004', 'Firme de Concreto', 'Firme de concreto fc=150 kg/cm2', 'M2', 0),
(1, 'construccion', 'Albanileria', 'ALB-005', 'Pretil de Azotea', 'Pretil perimetral en azotea', 'ML', 0);

-- INSTALACIONES (5 items)
INSERT INTO control_obra.catalogo_conceptos_cot (empresa_id, tipo, categoria, clave, nombre, descripcion, unidad, precio_sugerido) VALUES
(1, 'construccion', 'Instalaciones', 'INS-001', 'Instalacion Electrica', 'Instalacion electrica completa', 'LOTE', 0),
(1, 'construccion', 'Instalaciones', 'INS-002', 'Instalacion Hidraulica', 'Instalacion de agua fria y caliente', 'LOTE', 0),
(1, 'construccion', 'Instalaciones', 'INS-003', 'Instalacion Sanitaria', 'Instalacion de drenaje sanitario', 'LOTE', 0),
(1, 'construccion', 'Instalaciones', 'INS-004', 'Instalacion de Gas', 'Instalacion de gas LP', 'LOTE', 0),
(1, 'construccion', 'Instalaciones', 'INS-005', 'Instalacion de A/C', 'Preinstalacion de aire acondicionado', 'LOTE', 0);
