-- 014: Socios, historial de porcentajes y movimientos de socio (US-101, US-125, US-129)
-- Contexto: los retiros de socios se guardaban como una "obra" (DANIELOERA) y los honorarios
-- de los socios como pagos a "proveedores". Esta migración crea el modelo propio.
-- Patrón del proyecto: tablas en control_obra con RLS por empresa, vistas public.* con
-- security_invoker=true y lista explícita de columnas, grants a anon/authenticated.

-- 1) Nivel de acceso de la sesión (para RLS de socios: sólo nivel >= 100)
CREATE OR REPLACE FUNCTION control_obra.get_session_nivel()
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'control_obra', 'public' AS $$
DECLARE v_uid uuid; v_nivel integer;
BEGIN
  v_uid := control_obra.get_session_user_id();
  IF v_uid IS NULL THEN RETURN 0; END IF;
  SELECT r.nivel_acceso INTO v_nivel
  FROM control_obra.obra_usuarios u JOIN control_obra.obra_roles r ON r.id = u.rol_id
  WHERE u.id = v_uid AND u.activo = true;
  RETURN COALESCE(v_nivel, 0);
END; $$;

CREATE OR REPLACE FUNCTION public.get_session_nivel()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT control_obra.get_session_nivel();
$$;

-- 2) Tablas
CREATE TABLE IF NOT EXISTS control_obra.socios (
  id serial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  usuario_id uuid NULL REFERENCES control_obra.obra_usuarios(id) ON DELETE SET NULL,
  nombre text NOT NULL,
  rfc text NULL,
  porcentaje numeric(5,2) NULL CHECK (porcentaje IS NULL OR (porcentaje >= 0 AND porcentaje <= 100)),
  fecha_ingreso date DEFAULT CURRENT_DATE,
  activo boolean NOT NULL DEFAULT true,
  notas text NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_socios_empresa ON control_obra.socios(empresa_id);

CREATE TABLE IF NOT EXISTS control_obra.socios_historial (
  id serial PRIMARY KEY,
  socio_id integer NOT NULL REFERENCES control_obra.socios(id) ON DELETE CASCADE,
  porcentaje numeric(5,2) NULL,
  vigente_desde date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_obra.movimientos_socio (
  id serial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  socio_id integer NOT NULL REFERENCES control_obra.socios(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('aportacion','retiro','gasto_personal','utilidad_asignada','utilidad_pagada','ajuste')),
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  monto numeric(14,2) NOT NULL,
  gasto_id integer NULL REFERENCES control_obra.gastos(id) ON DELETE CASCADE,
  reparto_id integer NULL,
  concepto text NULL,
  referencia text NULL,
  metodo_pago text NULL,
  comprobante_url text NULL,
  notas text NULL,
  created_by uuid NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msoc_socio ON control_obra.movimientos_socio(socio_id, fecha);
CREATE INDEX IF NOT EXISTS idx_msoc_gasto ON control_obra.movimientos_socio(gasto_id);

-- 3) La suma de porcentajes de socios activos no excede 100; historial de cambios
CREATE OR REPLACE FUNCTION control_obra.trg_socios_pct() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COALESCE(SUM(porcentaje),0) FROM control_obra.socios WHERE empresa_id = NEW.empresa_id AND activo) > 100.005 THEN
    RAISE EXCEPTION 'La suma de porcentajes de los socios activos excede 100 %%';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.porcentaje IS DISTINCT FROM OLD.porcentaje THEN
    INSERT INTO control_obra.socios_historial(socio_id, porcentaje, vigente_desde, created_by)
    VALUES (NEW.id, NEW.porcentaje, CURRENT_DATE, control_obra.get_session_user_id());
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_socios_pct ON control_obra.socios;
CREATE CONSTRAINT TRIGGER trg_socios_pct AFTER INSERT OR UPDATE ON control_obra.socios
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION control_obra.trg_socios_pct();

-- 4) RLS: sólo socios/administradores (nivel >= 100) de la misma empresa
ALTER TABLE control_obra.socios ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.socios_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.movimientos_socio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS socios_admin ON control_obra.socios;
CREATE POLICY socios_admin ON control_obra.socios FOR ALL
  USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 100)
  WITH CHECK (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 100);

DROP POLICY IF EXISTS socios_hist_admin ON control_obra.socios_historial;
CREATE POLICY socios_hist_admin ON control_obra.socios_historial FOR ALL
  USING (control_obra.get_session_nivel() >= 100 AND EXISTS (SELECT 1 FROM control_obra.socios s WHERE s.id = socio_id AND s.empresa_id = control_obra.get_session_empresa_id()))
  WITH CHECK (control_obra.get_session_nivel() >= 100);

DROP POLICY IF EXISTS msoc_admin ON control_obra.movimientos_socio;
CREATE POLICY msoc_admin ON control_obra.movimientos_socio FOR ALL
  USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 100)
  WITH CHECK (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 100);

GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.socios, control_obra.socios_historial, control_obra.movimientos_socio TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.socios_id_seq, control_obra.socios_historial_id_seq, control_obra.movimientos_socio_id_seq TO anon, authenticated;

-- 5) Vistas públicas
CREATE OR REPLACE VIEW public.socios WITH (security_invoker = true) AS
  SELECT id, empresa_id, usuario_id, nombre, rfc, porcentaje, fecha_ingreso, activo, notas, created_at, updated_at
  FROM control_obra.socios;
CREATE OR REPLACE VIEW public.socios_historial WITH (security_invoker = true) AS
  SELECT id, socio_id, porcentaje, vigente_desde, created_by, created_at FROM control_obra.socios_historial;
CREATE OR REPLACE VIEW public.movimientos_socio WITH (security_invoker = true) AS
  SELECT id, empresa_id, socio_id, tipo, fecha, monto, gasto_id, reparto_id, concepto, referencia, metodo_pago,
         comprobante_url, notas, created_by, created_at, updated_at
  FROM control_obra.movimientos_socio;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.socios, public.socios_historial, public.movimientos_socio TO anon, authenticated;

-- 6) Semilla Supernova: los dos administradores existentes, porcentaje en blanco hasta capturarlo (US-125)
INSERT INTO control_obra.socios (empresa_id, usuario_id, nombre, rfc)
SELECT 1, u.id, u.nombre, CASE WHEN u.nombre = 'Ricardo Corral' THEN 'COGR980306RS2' END
FROM control_obra.obra_usuarios u
WHERE u.empresa_id = 1 AND u.nombre IN ('Ricardo Corral', 'Daniel Loera')
  AND NOT EXISTS (SELECT 1 FROM control_obra.socios s WHERE s.usuario_id = u.id);
