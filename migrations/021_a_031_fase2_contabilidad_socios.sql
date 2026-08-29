-- 021 a 031 (fase 2): conciliaciones, facturas ligadas a gastos, cierres mensuales, rol contador externo,
-- distribución de nómina por obra, configuración financiera, repartos de utilidades y vista de uso.
-- (025a, aplicada aparte por la restricción de PostgreSQL: ALTER TYPE public.obra_role ADD VALUE 'contador_externo')

-- ===== 021 Conciliaciones bancarias (US-114) =====
CREATE TABLE IF NOT EXISTS control_obra.conciliaciones (
  id serial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  archivo text, periodo text, cuenta text,
  filas integer DEFAULT 0, conciliadas integer DEFAULT 0, pendientes integer DEFAULT 0, sin_banco integer DEFAULT 0,
  resultado jsonb, created_by uuid, created_at timestamptz DEFAULT now()
);
ALTER TABLE control_obra.conciliaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conc_all ON control_obra.conciliaciones;
CREATE POLICY conc_all ON control_obra.conciliaciones FOR ALL USING (empresa_id = control_obra.get_session_empresa_id()) WITH CHECK (empresa_id = control_obra.get_session_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.conciliaciones TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.conciliaciones_id_seq TO anon, authenticated;
CREATE OR REPLACE VIEW public.conciliaciones WITH (security_invoker = true) AS
  SELECT id, empresa_id, archivo, periodo, cuenta, filas, conciliadas, pendientes, sin_banco, resultado, created_by, created_at FROM control_obra.conciliaciones;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conciliaciones TO anon, authenticated;

-- ===== 023 Facturas y CFDI emitidos ligados a gastos y cobros (US-116) =====
ALTER TABLE control_obra.facturas_recibidas
  ADD COLUMN IF NOT EXISTS gasto_id integer NULL REFERENCES control_obra.gastos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archivo_path text NULL;
CREATE INDEX IF NOT EXISTS idx_fr_gasto ON control_obra.facturas_recibidas(gasto_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fr_uuid_empresa ON control_obra.facturas_recibidas(empresa_id, uuid_cfdi) WHERE uuid_cfdi IS NOT NULL;
CREATE OR REPLACE VIEW public.facturas_recibidas WITH (security_invoker = true) AS
  SELECT id, obra_id, proveedor_id, uuid_cfdi, serie, folio, fecha_emision, fecha_timbrado, rfc_emisor, nombre_emisor, uso_cfdi,
         subtotal, descuento, iva_tasa, iva_monto, isr_retenido, iva_retenido, total, metodo_pago, forma_pago, moneda, tipo_comprobante,
         categoria, es_deducible, estatus, fecha_pago, notas, archivo_xml, archivo_pdf, created_at, updated_at, empresa_id, gasto_id, archivo_path
  FROM control_obra.facturas_recibidas;
ALTER TABLE control_obra.facturas_recibidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fr_all ON control_obra.facturas_recibidas;
CREATE POLICY fr_all ON control_obra.facturas_recibidas FOR ALL USING (empresa_id = control_obra.get_session_empresa_id()) WITH CHECK (empresa_id = control_obra.get_session_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.facturas_recibidas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facturas_recibidas TO anon, authenticated;

ALTER TABLE control_obra.cfdis_emitidos
  ADD COLUMN IF NOT EXISTS pago_recibido_id integer NULL REFERENCES control_obra.pagos_recibidos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archivo_path text NULL;
CREATE OR REPLACE VIEW public.cfdis_emitidos WITH (security_invoker = true) AS
  SELECT id, empresa_id, obra_id, cliente_id, uuid, serie, folio, fecha_emision, fecha_timbrado, tipo_comprobante, forma_pago, metodo_pago,
         uso_cfdi, receptor_rfc, receptor_nombre, receptor_regimen, receptor_domicilio_cp, receptor_uso_cfdi, subtotal, descuento, iva_tasa,
         iva_monto, isr_retenido, iva_retenido, total, moneda, tipo_cambio, conceptos, estatus, estatus_cancelacion, fecha_cancelacion,
         motivo_cancelacion, uuid_sustitucion, pac_response, cadena_original, sello_cfdi, sello_sat, certificado_sat, xml_url, pdf_url,
         xml_content, estimacion_id, cotizacion_id, notas, created_by, created_at, updated_at, pago_recibido_id, archivo_path
  FROM control_obra.cfdis_emitidos;
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.cfdis_emitidos TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cfdis_emitidos TO anon, authenticated;

-- ===== 024 Cierres mensuales (US-118) =====
CREATE TABLE IF NOT EXISTS control_obra.cierres_mensuales (
  id serial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  periodo text NOT NULL,
  estado text NOT NULL DEFAULT 'cerrado' CHECK (estado IN ('cerrado','reabierto')),
  cerrado_por uuid, cerrado_at timestamptz DEFAULT now(),
  totales jsonb, paquete_path text,
  reabierto_por uuid, reabierto_at timestamptz, motivo_reapertura text,
  UNIQUE (empresa_id, periodo)
);
ALTER TABLE control_obra.cierres_mensuales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cierres_sel ON control_obra.cierres_mensuales;
CREATE POLICY cierres_sel ON control_obra.cierres_mensuales FOR SELECT USING (empresa_id = control_obra.get_session_empresa_id());
DROP POLICY IF EXISTS cierres_write ON control_obra.cierres_mensuales;
CREATE POLICY cierres_write ON control_obra.cierres_mensuales FOR ALL USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 100) WITH CHECK (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 100);
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.cierres_mensuales TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.cierres_mensuales_id_seq TO anon, authenticated;
CREATE OR REPLACE VIEW public.cierres_mensuales WITH (security_invoker = true) AS
  SELECT id, empresa_id, periodo, estado, cerrado_por, cerrado_at, totales, paquete_path, reabierto_por, reabierto_at, motivo_reapertura FROM control_obra.cierres_mensuales;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cierres_mensuales TO anon, authenticated;

-- ===== 025b Rol contador externo (US-119): nivel 45, sólo lectura y exportación =====
INSERT INTO control_obra.obra_roles (nombre, descripcion, nivel_acceso, permisos)
SELECT 'contador_externo', 'Contador externo: consulta y exporta; no captura ni edita; no ve socios', 45,
       '{"obras":{"ver":true,"crear":false,"editar":false,"eliminar":false},"gastos":{"ver":true,"crear":false,"editar":false,"aprobar":false,"eliminar":false},"nomina":{"ver":true,"crear":false,"editar":false,"aprobar":false,"eliminar":false},"reportes":{"ver":true,"exportar":true},"usuarios":{"ver":false,"crear":false,"editar":false,"eliminar":false},"empleados":{"ver":true,"crear":false,"editar":false,"eliminar":false},"presupuesto":{"ver":true,"crear":false,"editar":false,"eliminar":false},"configuracion":{"ver":false,"editar":false},"socios":false,"lectura":true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM control_obra.obra_roles WHERE nombre = 'contador_externo');

-- ===== 026 Nómina por obra (US-120) =====
ALTER TABLE control_obra.empleados ADD COLUMN IF NOT EXISTS obra_id integer NULL REFERENCES control_obra.obras(id) ON DELETE SET NULL;
-- obra_asignada ya es un entero (id de obra)
UPDATE control_obra.empleados e SET obra_id = e.obra_asignada
WHERE e.obra_id IS NULL AND e.obra_asignada IS NOT NULL
  AND EXISTS (SELECT 1 FROM control_obra.obras o WHERE o.id = e.obra_asignada AND o.empresa_id = e.empresa_id);
CREATE OR REPLACE VIEW public.empleados WITH (security_invoker = true) AS
  SELECT id, nombre_completo, puesto, estatus, fecha_ingreso, sueldo_base, viaticos, telefono, email, obra_asignada, created_at, updated_at, notas, empresa_id, obra_id
  FROM control_obra.empleados;
CREATE TABLE IF NOT EXISTS control_obra.nomina_distribucion (
  id serial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  nomina_id integer NOT NULL REFERENCES control_obra.nomina(id) ON DELETE CASCADE,
  obra_id integer NOT NULL REFERENCES control_obra.obras(id) ON DELETE CASCADE,
  porcentaje numeric(6,2) NOT NULL DEFAULT 100,
  monto numeric(14,2) NOT NULL DEFAULT 0,
  fecha date,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nomd_obra ON control_obra.nomina_distribucion(obra_id, fecha);
ALTER TABLE control_obra.nomina_distribucion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nomd_all ON control_obra.nomina_distribucion;
CREATE POLICY nomd_all ON control_obra.nomina_distribucion FOR ALL USING (empresa_id = control_obra.get_session_empresa_id()) WITH CHECK (empresa_id = control_obra.get_session_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.nomina_distribucion TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.nomina_distribucion_id_seq TO anon, authenticated;
CREATE OR REPLACE VIEW public.nomina_distribucion WITH (security_invoker = true) AS
  SELECT id, empresa_id, nomina_id, obra_id, porcentaje, monto, fecha, created_at FROM control_obra.nomina_distribucion;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nomina_distribucion TO anon, authenticated;

-- ===== 027 Configuración financiera por empresa (US-121, US-123, US-127) =====
CREATE TABLE IF NOT EXISTS control_obra.finanzas_config (
  empresa_id integer PRIMARY KEY REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  prorrateo jsonb NOT NULL DEFAULT '{"tipo":"iguales","fijos":{}}'::jsonb,
  reservas jsonb NOT NULL DEFAULT '{"impuestos":30,"capital":10}'::jsonb,
  base_resultados text NOT NULL DEFAULT 'caja' CHECK (base_resultados IN ('caja','devengado')),
  saldo_inicial numeric(14,2) NOT NULL DEFAULT 0,
  saldo_inicial_fecha date,
  updated_by uuid, updated_at timestamptz DEFAULT now()
);
ALTER TABLE control_obra.finanzas_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fcfg_sel ON control_obra.finanzas_config;
CREATE POLICY fcfg_sel ON control_obra.finanzas_config FOR SELECT USING (empresa_id = control_obra.get_session_empresa_id());
DROP POLICY IF EXISTS fcfg_write ON control_obra.finanzas_config;
CREATE POLICY fcfg_write ON control_obra.finanzas_config FOR ALL USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 100) WITH CHECK (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 100);
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.finanzas_config TO anon, authenticated;
CREATE OR REPLACE VIEW public.finanzas_config WITH (security_invoker = true) AS
  SELECT empresa_id, prorrateo, reservas, base_resultados, saldo_inicial, saldo_inicial_fecha, updated_by, updated_at FROM control_obra.finanzas_config;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finanzas_config TO anon, authenticated;
INSERT INTO control_obra.finanzas_config (empresa_id) SELECT id FROM control_obra.empresas WHERE NOT EXISTS (SELECT 1 FROM control_obra.finanzas_config f WHERE f.empresa_id = empresas.id);

-- ===== 029 Repartos de utilidades (US-127) =====
CREATE TABLE IF NOT EXISTS control_obra.repartos (
  id serial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  periodo_desde date, periodo_hasta date, obra_id integer NULL REFERENCES control_obra.obras(id) ON DELETE SET NULL,
  base text NOT NULL DEFAULT 'caja',
  utilidad numeric(14,2) NOT NULL DEFAULT 0, reservas jsonb, distribuible numeric(14,2) NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'propuesto' CHECK (estado IN ('propuesto','aprobado','pagado','anulado')),
  aprobaciones jsonb NOT NULL DEFAULT '[]'::jsonb,
  acta_path text, notas text, anulado_motivo text,
  created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS control_obra.reparto_detalle (
  id serial PRIMARY KEY,
  reparto_id integer NOT NULL REFERENCES control_obra.repartos(id) ON DELETE CASCADE,
  socio_id integer NOT NULL REFERENCES control_obra.socios(id) ON DELETE CASCADE,
  porcentaje numeric(5,2) NOT NULL DEFAULT 0,
  asignado numeric(14,2) NOT NULL DEFAULT 0, a_cuenta numeric(14,2) NOT NULL DEFAULT 0, aportado numeric(14,2) NOT NULL DEFAULT 0,
  ajuste numeric(14,2) NOT NULL DEFAULT 0, ajuste_motivo text, a_pagar numeric(14,2) NOT NULL DEFAULT 0,
  pagado_at date, referencia text
);
ALTER TABLE control_obra.repartos ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_obra.reparto_detalle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rep_admin ON control_obra.repartos;
CREATE POLICY rep_admin ON control_obra.repartos FOR ALL USING (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 100) WITH CHECK (empresa_id = control_obra.get_session_empresa_id() AND control_obra.get_session_nivel() >= 100);
DROP POLICY IF EXISTS repd_admin ON control_obra.reparto_detalle;
CREATE POLICY repd_admin ON control_obra.reparto_detalle FOR ALL USING (control_obra.get_session_nivel() >= 100 AND EXISTS (SELECT 1 FROM control_obra.repartos r WHERE r.id = reparto_id AND r.empresa_id = control_obra.get_session_empresa_id())) WITH CHECK (control_obra.get_session_nivel() >= 100);
GRANT SELECT, INSERT, UPDATE, DELETE ON control_obra.repartos, control_obra.reparto_detalle TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE control_obra.repartos_id_seq, control_obra.reparto_detalle_id_seq TO anon, authenticated;
CREATE OR REPLACE VIEW public.repartos WITH (security_invoker = true) AS
  SELECT id, empresa_id, periodo_desde, periodo_hasta, obra_id, base, utilidad, reservas, distribuible, estado, aprobaciones, acta_path, notas, anulado_motivo, created_by, created_at, updated_at FROM control_obra.repartos;
CREATE OR REPLACE VIEW public.reparto_detalle WITH (security_invoker = true) AS
  SELECT id, reparto_id, socio_id, porcentaje, asignado, a_cuenta, aportado, ajuste, ajuste_motivo, a_pagar, pagado_at, referencia FROM control_obra.reparto_detalle;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.repartos, public.reparto_detalle TO anon, authenticated;

-- ===== 031 Vista de uso de finanzas (US-132) =====
CREATE OR REPLACE VIEW public.v_uso_finanzas_30d WITH (security_invoker = true) AS
  SELECT empresa_id, evento, count(*) AS n, count(DISTINCT user_id) AS usuarios,
         sum(CASE WHEN viewport_w < 768 THEN 1 ELSE 0 END) AS movil
  FROM control_obra.ui_events
  WHERE created_at > now() - interval '30 days'
    AND evento IN ('gasto_creado','gasto_form_abierto','compra_aprobada','compra_rechazada','pago_proveedor_registrado','xml_importado','mes_cerrado','reparto_generado','ficha_resultado_vista','gastos_reclasificados','proveedor_ficha','compras_tab','pagos_tab','cobro_registrado')
  GROUP BY 1, 2;
GRANT SELECT ON public.v_uso_finanzas_30d TO anon, authenticated;
