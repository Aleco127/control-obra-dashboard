-- 017: Naturaleza contable de las categorías de gasto (US-104)
-- directo = costo de obra; indirecto = administración (se prorratea); no_deducible; personal = gasto de socio
ALTER TABLE control_obra.categorias_gasto
  ADD COLUMN IF NOT EXISTS naturaleza text NOT NULL DEFAULT 'directo',
  ADD COLUMN IF NOT EXISTS deducible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS orden integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS activa boolean NOT NULL DEFAULT true;
ALTER TABLE control_obra.categorias_gasto DROP CONSTRAINT IF EXISTS categorias_gasto_naturaleza_chk;
ALTER TABLE control_obra.categorias_gasto ADD CONSTRAINT categorias_gasto_naturaleza_chk
  CHECK (naturaleza IN ('directo','indirecto','no_deducible','personal'));

-- Semilla: categorías que faltan (para empresa 1 y para cualquier empresa que ya tenga catálogo propio)
WITH base(nombre, naturaleza, deducible, orden, color) AS (VALUES
  ('Materiales','directo',true,10,'#0ea5e9'),
  ('Mano de obra','directo',true,20,'#f59e0b'),
  ('Subcontratos','directo',true,30,'#8b5cf6'),
  ('Maquinaria y equipo','directo',true,40,'#64748b'),
  ('Herramientas','directo',true,45,'#64748b'),
  ('Renta de equipo','directo',true,46,'#64748b'),
  ('Fletes y transporte','directo',true,50,'#14b8a6'),
  ('Combustible','directo',true,60,'#f97316'),
  ('Seguridad','directo',true,70,'#ef4444'),
  ('Renta y servicios de oficina','indirecto',true,110,'#6366f1'),
  ('Telefonía e internet','indirecto',true,120,'#6366f1'),
  ('Software y suscripciones','indirecto',true,130,'#6366f1'),
  ('Publicidad','indirecto',true,140,'#ec4899'),
  ('Honorarios contables y legales','indirecto',true,150,'#6366f1'),
  ('Papelería y oficina','indirecto',true,160,'#6366f1'),
  ('Multas y recargos','no_deducible',false,200,'#991b1b'),
  ('Gasto personal de socio','personal',false,300,'#94a3b8'),
  ('Otros','directo',true,190,'#94a3b8'))
INSERT INTO control_obra.categorias_gasto (nombre, descripcion, color, empresa_id, naturaleza, deducible, orden)
SELECT b.nombre, NULL, b.color, e.id, b.naturaleza, b.deducible, b.orden
FROM base b CROSS JOIN (SELECT DISTINCT COALESCE(empresa_id, 1) AS id FROM control_obra.categorias_gasto UNION SELECT 1) e
WHERE NOT EXISTS (
  SELECT 1 FROM control_obra.categorias_gasto c
  WHERE lower(c.nombre) = lower(b.nombre) AND (c.empresa_id = e.id OR c.empresa_id IS NULL));

-- Naturaleza de las categorías ya existentes (por nombre, sin importar empresa)
UPDATE control_obra.categorias_gasto SET naturaleza = 'indirecto', orden = 115 WHERE lower(nombre) IN ('servicios','oficina','documentos');
UPDATE control_obra.categorias_gasto SET naturaleza = 'directo', orden = 41 WHERE lower(nombre) IN ('equipos');
UPDATE control_obra.categorias_gasto SET naturaleza = 'directo', orden = 51 WHERE lower(nombre) IN ('transporte');
UPDATE control_obra.categorias_gasto SET naturaleza = 'directo', orden = 10 WHERE lower(nombre) = 'materiales';
UPDATE control_obra.categorias_gasto SET naturaleza = 'directo', orden = 60 WHERE lower(nombre) = 'combustible';
UPDATE control_obra.categorias_gasto SET naturaleza = 'directo', orden = 70 WHERE lower(nombre) = 'seguridad';

CREATE OR REPLACE VIEW public.categorias_gasto WITH (security_invoker = true) AS
  SELECT id, nombre, descripcion, color, created_at, empresa_id, naturaleza, deducible, orden, activa
  FROM control_obra.categorias_gasto;

-- Complemento: viáticos y alimentos de cuadrilla (costo directo de obra)
INSERT INTO control_obra.categorias_gasto (nombre, color, empresa_id, naturaleza, deducible, orden)
SELECT 'Viáticos y alimentos', '#f59e0b', e.id, 'directo', true, 65
FROM (SELECT DISTINCT COALESCE(empresa_id, 1) AS id FROM control_obra.categorias_gasto UNION SELECT 1) e
WHERE NOT EXISTS (SELECT 1 FROM control_obra.categorias_gasto c WHERE lower(c.nombre) = 'viáticos y alimentos' AND (c.empresa_id = e.id OR c.empresa_id IS NULL));
