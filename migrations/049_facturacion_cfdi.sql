-- 049 · Facturación CFDI 4.0 con PAC multiemisor (US-231, US-232).
--
-- 1) Ningún secreto vive en la base. La versión anterior guardaba el .cer, el .key, la contraseña del CSD y la
--    contraseña de la cuenta del PAC en control_obra.config_pac, y la vista public.config_pac los exponía con
--    GRANT a anon: cualquier usuario de la empresa (incluido el rol contador_externo, sólo lectura) podía leer
--    la llave privada del sello digital. Se borran los valores y se quitan las columnas.
-- 2) El alta del CSD y el timbrado pasan por las Edge Functions pac-config y cfdi-emitir, que usan la cuenta
--    del PAC guardada en app_secrets. Por eso la vista queda de sólo lectura para la app.
-- 3) Folio consecutivo por empresa reservado en la base, no calculado en el navegador.

-- ===== config_pac =====
UPDATE control_obra.config_pac
   SET csd_cer_base64 = NULL, csd_key_base64 = NULL, csd_password_encrypted = NULL, pac_password_encrypted = NULL;

DROP VIEW IF EXISTS public.config_pac;

ALTER TABLE control_obra.config_pac
  DROP COLUMN IF EXISTS csd_cer_base64,
  DROP COLUMN IF EXISTS csd_key_base64,
  DROP COLUMN IF EXISTS csd_password_encrypted,
  DROP COLUMN IF EXISTS pac_password_encrypted,
  DROP COLUMN IF EXISTS pac_usuario,
  DROP COLUMN IF EXISTS pac_url_sandbox,
  DROP COLUMN IF EXISTS pac_url_produccion;

ALTER TABLE control_obra.config_pac
  ADD COLUMN IF NOT EXISTS csd_no_certificado text,
  ADD COLUMN IF NOT EXISTS csd_vigencia_ini date,
  ADD COLUMN IF NOT EXISTS csd_registrado_at timestamptz,
  ADD COLUMN IF NOT EXISTS concepto_default text,
  ADD COLUMN IF NOT EXISTS clave_prodserv_default text,
  ADD COLUMN IF NOT EXISTS clave_unidad_default text,
  ADD COLUMN IF NOT EXISTS uso_cfdi_default text;

UPDATE control_obra.config_pac SET
  clave_prodserv_default = COALESCE(clave_prodserv_default, '72141500'),   -- Servicios de construcción de edificaciones
  clave_unidad_default   = COALESCE(clave_unidad_default, 'E48'),          -- Unidad de servicio
  uso_cfdi_default       = COALESCE(uso_cfdi_default, 'G03'),
  concepto_default       = COALESCE(concepto_default, 'Servicios de construcción'),
  folio_actual           = COALESCE(folio_actual, 0);

ALTER TABLE control_obra.config_pac ALTER COLUMN pac_modo SET DEFAULT 'sandbox';
CREATE UNIQUE INDEX IF NOT EXISTS config_pac_empresa_uk ON control_obra.config_pac (empresa_id);

CREATE OR REPLACE VIEW public.config_pac WITH (security_invoker = true) AS
  SELECT id, empresa_id, pac_nombre, pac_modo, rfc_emisor, razon_social, nombre_comercial, regimen_fiscal,
         codigo_postal, lugar_expedicion, csd_no_certificado, csd_vigencia_ini, csd_vigencia_fin, csd_registrado_at,
         serie_default, folio_actual, concepto_default, clave_prodserv_default, clave_unidad_default, uso_cfdi_default,
         logo_url, activo, created_at, updated_at
    FROM control_obra.config_pac;

REVOKE ALL ON public.config_pac FROM anon, authenticated;
GRANT SELECT ON public.config_pac TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON control_obra.config_pac FROM anon, authenticated;
GRANT SELECT ON control_obra.config_pac TO anon, authenticated;

-- ===== cfdis_emitidos: rastro del timbrado =====
ALTER TABLE control_obra.cfdis_emitidos
  ADD COLUMN IF NOT EXISTS pac_cfdi_id text,
  ADD COLUMN IF NOT EXISTS pac_modo text,
  ADD COLUMN IF NOT EXISTS pdf_path text,
  ADD COLUMN IF NOT EXISTS cuenta_cobrar_id integer;

CREATE INDEX IF NOT EXISTS cfdis_emitidos_estimacion_ix ON control_obra.cfdis_emitidos (empresa_id, estimacion_id);
CREATE INDEX IF NOT EXISTS cfdis_emitidos_pago_ix ON control_obra.cfdis_emitidos (empresa_id, pago_recibido_id);

CREATE OR REPLACE VIEW public.cfdis_emitidos WITH (security_invoker = true) AS
  SELECT id, empresa_id, obra_id, cliente_id, uuid, serie, folio, fecha_emision, fecha_timbrado, tipo_comprobante, forma_pago, metodo_pago,
         uso_cfdi, receptor_rfc, receptor_nombre, receptor_regimen, receptor_domicilio_cp, receptor_uso_cfdi, subtotal, descuento, iva_tasa,
         iva_monto, isr_retenido, iva_retenido, total, moneda, tipo_cambio, conceptos, estatus, estatus_cancelacion, fecha_cancelacion,
         motivo_cancelacion, uuid_sustitucion, pac_response, cadena_original, sello_cfdi, sello_sat, certificado_sat, xml_url, pdf_url,
         xml_content, estimacion_id, cotizacion_id, notas, created_by, created_at, updated_at, pago_recibido_id, archivo_path,
         pac_cfdi_id, pac_modo, pdf_path, cuenta_cobrar_id
    FROM control_obra.cfdis_emitidos;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cfdis_emitidos TO anon, authenticated;

-- ===== Folio consecutivo: sólo la Edge Function (service_role) lo reserva =====
CREATE OR REPLACE FUNCTION control_obra.reservar_folio_cfdi(p_empresa_id bigint, p_serie text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra','public' AS $$
DECLARE v_folio integer;
BEGIN
  UPDATE control_obra.config_pac
     SET folio_actual = COALESCE(folio_actual, 0) + 1, updated_at = now()
   WHERE empresa_id = p_empresa_id
  RETURNING folio_actual INTO v_folio;
  IF v_folio IS NULL THEN
    RAISE EXCEPTION 'La empresa no tiene configurada la facturación';
  END IF;
  RETURN v_folio;
END; $$;
REVOKE ALL ON FUNCTION control_obra.reservar_folio_cfdi(bigint, text) FROM PUBLIC, anon, authenticated;

-- ===== Aviso 30 días antes de que venza el CSD (US-231) =====
CREATE OR REPLACE FUNCTION control_obra.notificar_csd_por_vencer(p_empresa integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra','public' AS $$
DECLARE v_ins integer;
BEGIN
  INSERT INTO control_obra.notificaciones(empresa_id, clave, tipo, severidad, titulo, cuerpo, modulo)
  SELECT c.empresa_id, 'csd_vence_'||c.id||'_'||to_char(c.csd_vigencia_fin,'YYYYMM'), 'csd_por_vencer',
         CASE WHEN c.csd_vigencia_fin < CURRENT_DATE THEN 'danger' ELSE 'warning' END,
         CASE WHEN c.csd_vigencia_fin < CURRENT_DATE THEN 'Tu sello digital venció' ELSE 'Tu sello digital está por vencer' END,
         'El CSD de '||c.rfc_emisor||' '||CASE WHEN c.csd_vigencia_fin < CURRENT_DATE THEN 'venció el ' ELSE 'vence el ' END||
         to_char(c.csd_vigencia_fin,'DD/MM/YYYY')||'. Renuévalo en el SAT y súbelo en Configuración › Facturación para poder seguir facturando.',
         'ce'
    FROM control_obra.config_pac c
   WHERE c.empresa_id = p_empresa AND c.activo AND c.csd_vigencia_fin IS NOT NULL
     AND c.csd_vigencia_fin <= CURRENT_DATE + 30
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  RETURN v_ins;
END; $$;
REVOKE ALL ON FUNCTION control_obra.notificar_csd_por_vencer(integer) FROM PUBLIC, anon, authenticated;

-- El aviso se engancha al generador diario: se agregó
--   v_n := v_n + control_obra.notificar_csd_por_vencer(p_empresa);
-- justo antes del DELETE de notificaciones leídas dentro de control_obra.generar_notificaciones_empresa
-- (aplicado como 049b_notificaciones_csd; el cuerpo completo vive en el historial de migraciones).
