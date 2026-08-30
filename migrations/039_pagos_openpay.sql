-- 039: pagos de suscripción con Openpay (US-215, US-216, US-217)
CREATE TABLE IF NOT EXISTS public.openpay_planes (
  slug text NOT NULL,
  periodicidad text NOT NULL CHECK (periodicidad IN ('mensual','anual')),
  openpay_plan_id text NOT NULL,
  monto numeric NOT NULL,
  sandbox boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slug, periodicidad, sandbox)
);
ALTER TABLE public.openpay_planes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.openpay_planes FROM anon, authenticated;
GRANT ALL ON public.openpay_planes TO service_role;

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id bigserial PRIMARY KEY,
  empresa_id integer NOT NULL,
  monto numeric NOT NULL,
  moneda text NOT NULL DEFAULT 'MXN',
  periodo_inicio date,
  periodo_fin date,
  openpay_charge_id text UNIQUE,
  openpay_subscription_id text,
  estado text NOT NULL DEFAULT 'pagado',   -- pagado | fallido | reembolsado
  descripcion text,
  cfdi_uuid text,
  cfdi_pdf_path text,
  cfdi_xml_path text,
  cfdi_error text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_payments_empresa_idx ON public.subscription_payments (empresa_id, created_at DESC);
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_payments FROM anon, authenticated;
GRANT ALL ON public.subscription_payments TO service_role;
-- La empresa lee sus pagos por RPC
CREATE OR REPLACE FUNCTION public.get_mis_pagos(p_limit integer DEFAULT 36)
RETURNS SETOF public.subscription_payments
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT * FROM public.subscription_payments WHERE empresa_id = public.get_session_empresa_id() ORDER BY created_at DESC LIMIT LEAST(COALESCE(p_limit,36),120); $$;

-- Datos fiscales de facturación de la suscripción (los edita el admin de la empresa)
CREATE OR REPLACE FUNCTION public.guardar_datos_fiscales_suscripcion(p_datos jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_emp int;
BEGIN
  v_emp := public.get_session_empresa_id();
  IF v_emp IS NULL OR coalesce(public.get_session_nivel(),0) < 100 THEN RETURN json_build_object('success', false, 'error', 'Sólo el administrador'); END IF;
  IF p_datos->>'rfc' IS NULL OR length(p_datos->>'rfc') < 12 THEN RETURN json_build_object('success', false, 'error', 'RFC inválido'); END IF;
  INSERT INTO public.empresa_subscriptions (empresa_id, plan_id, estado, payment_method, datos_fiscales)
  VALUES (v_emp, (SELECT id FROM public.subscription_plans WHERE slug='gratis'), 'activa', 'gratis', p_datos)
  ON CONFLICT (empresa_id) DO UPDATE SET datos_fiscales = EXCLUDED.datos_fiscales, billing_email = coalesce(EXCLUDED.datos_fiscales->>'email', public.empresa_subscriptions.billing_email), updated_at = now();
  RETURN json_build_object('success', true);
END; $$;

-- Aplicación de eventos de Openpay (sólo service_role desde la Edge Function openpay-webhook)
CREATE OR REPLACE FUNCTION public.aplicar_pago_suscripcion(p_empresa_id integer, p_charge_id text, p_subscription_id text, p_monto numeric, p_estado text, p_descripcion text, p_raw jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_s record; v_meses int; v_ini date; v_fin date; v_id bigint;
BEGIN
  SELECT * INTO v_s FROM public.empresa_subscriptions WHERE empresa_id = p_empresa_id;
  IF v_s.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'sin suscripción'); END IF;
  IF EXISTS (SELECT 1 FROM public.subscription_payments WHERE openpay_charge_id = p_charge_id) THEN RETURN json_build_object('success', true, 'duplicado', true); END IF;
  v_meses := CASE WHEN v_s.periodicidad = 'anual' THEN 12 ELSE 1 END;
  IF p_estado = 'pagado' THEN
    v_ini := GREATEST(coalesce(v_s.current_period_end::date, current_date), current_date - 3);
    IF v_s.current_period_end IS NULL OR v_s.current_period_end < now() - interval '3 days' THEN v_ini := current_date; END IF;
    v_fin := (v_ini + make_interval(months => v_meses))::date;
    UPDATE public.empresa_subscriptions SET estado = 'activa', current_period_start = v_ini, current_period_end = v_fin, gracia_hasta = NULL, trial_ends_at = NULL, updated_at = now() WHERE empresa_id = p_empresa_id;
  ELSE
    UPDATE public.empresa_subscriptions SET estado = 'pago_fallido', gracia_hasta = coalesce(gracia_hasta, now() + interval '7 days'), updated_at = now() WHERE empresa_id = p_empresa_id AND estado IN ('activa','pago_fallido');
  END IF;
  INSERT INTO public.subscription_payments (empresa_id, monto, periodo_inicio, periodo_fin, openpay_charge_id, openpay_subscription_id, estado, descripcion, raw)
  VALUES (p_empresa_id, p_monto, v_ini, v_fin, p_charge_id, p_subscription_id, p_estado, p_descripcion, p_raw) RETURNING id INTO v_id;
  RETURN json_build_object('success', true, 'payment_id', v_id, 'periodo_fin', v_fin);
END; $$;
REVOKE EXECUTE ON FUNCTION public.aplicar_pago_suscripcion(integer, text, text, numeric, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_pago_suscripcion(integer, text, text, numeric, text, text, jsonb) TO service_role;

-- Activar suscripción tras alta en Openpay (service_role)
CREATE OR REPLACE FUNCTION public.activar_suscripcion_openpay(p_empresa_id integer, p_plan_slug text, p_periodicidad text, p_customer_id text, p_subscription_id text, p_card_last4 text, p_card_brand text, p_datos_fiscales jsonb, p_period_end date)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.empresa_subscriptions (empresa_id, plan_id, estado, payment_method, periodicidad, openpay_customer_id, openpay_subscription_id, card_last4, card_brand, datos_fiscales, current_period_start, current_period_end)
  VALUES (p_empresa_id, (SELECT id FROM public.subscription_plans WHERE slug = p_plan_slug), 'activa', 'openpay', p_periodicidad, p_customer_id, p_subscription_id, p_card_last4, p_card_brand, p_datos_fiscales, current_date, p_period_end)
  ON CONFLICT (empresa_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, estado = 'activa', payment_method = 'openpay', periodicidad = EXCLUDED.periodicidad,
    openpay_customer_id = EXCLUDED.openpay_customer_id, openpay_subscription_id = EXCLUDED.openpay_subscription_id, card_last4 = EXCLUDED.card_last4, card_brand = EXCLUDED.card_brand,
    datos_fiscales = coalesce(EXCLUDED.datos_fiscales, public.empresa_subscriptions.datos_fiscales), current_period_start = current_date, current_period_end = EXCLUDED.current_period_end,
    trial_ends_at = NULL, gracia_hasta = NULL, cancelada_at = NULL, updated_at = now();
  RETURN json_build_object('success', true);
END; $$;
REVOKE EXECUTE ON FUNCTION public.activar_suscripcion_openpay(integer, text, text, text, text, text, text, jsonb, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activar_suscripcion_openpay(integer, text, text, text, text, text, text, jsonb, date) TO service_role;

-- Para que la Edge Function ubique la empresa por ids de Openpay
CREATE OR REPLACE FUNCTION public.suscripcion_por_openpay(p_customer_id text, p_subscription_id text)
RETURNS SETOF public.empresa_subscriptions LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT * FROM public.empresa_subscriptions WHERE (p_subscription_id IS NOT NULL AND openpay_subscription_id = p_subscription_id) OR (p_customer_id IS NOT NULL AND openpay_customer_id = p_customer_id) LIMIT 1; $$;
REVOKE EXECUTE ON FUNCTION public.suscripcion_por_openpay(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suscripcion_por_openpay(text, text) TO service_role;
