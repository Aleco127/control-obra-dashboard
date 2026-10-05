-- 086_licitaciones_indices_fk.sql (US-803, cierre de advisors) — Índices que cubren las llaves foráneas de las tablas
-- nuevas de 080, 081 y 083 que el advisor de rendimiento marcó (unindexed_foreign_keys). Sirven sobre todo al borrado
-- en cascada de una empresa y al ON DELETE SET NULL de obras, gastos, proveedores, empleados y licitaciones.
CREATE INDEX IF NOT EXISTS idx_concepto_precios_empresa ON control_obra.concepto_precios (empresa_id);
CREATE INDEX IF NOT EXISTS idx_concepto_precios_lic ON control_obra.concepto_precios (licitacion_id) WHERE licitacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_insumo_precios_empresa ON control_obra.insumo_precios (empresa_id);
CREATE INDEX IF NOT EXISTS idx_insumo_precios_gasto ON control_obra.insumo_precios (gasto_id) WHERE gasto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_insumo_precios_proveedor ON control_obra.insumo_precios (proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_licitacion_archivos_empresa ON control_obra.licitacion_archivos (empresa_id);
CREATE INDEX IF NOT EXISTS idx_licitacion_req_hist_empresa ON control_obra.licitacion_requisito_historial (empresa_id);
CREATE INDEX IF NOT EXISTS idx_licitacion_req_hist_lic ON control_obra.licitacion_requisito_historial (licitacion_id);
CREATE INDEX IF NOT EXISTS idx_licitacion_requisitos_empresa ON control_obra.licitacion_requisitos (empresa_id);
CREATE INDEX IF NOT EXISTS idx_licitaciones_perfil ON control_obra.licitaciones (perfil_id) WHERE perfil_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matriz_componentes_empresa ON control_obra.matriz_componentes (empresa_id);
CREATE INDEX IF NOT EXISTS idx_matriz_componentes_lic ON control_obra.matriz_componentes (licitacion_id) WHERE licitacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obras_ejecutadas_obra ON control_obra.obras_ejecutadas (obra_id) WHERE obra_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parametros_laborales_empresa ON control_obra.parametros_laborales (empresa_id) WHERE empresa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_perfiles_convocante_empresa ON control_obra.perfiles_convocante (empresa_id) WHERE empresa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_personal_tecnico_empleado ON control_obra.personal_tecnico (empleado_id) WHERE empleado_id IS NOT NULL;
