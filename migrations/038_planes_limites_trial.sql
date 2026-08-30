-- 038: planes definitivos, límites aplicados y prueba de 30 días (US-212, US-213, US-214)

-- ---------- Planes ----------
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS slug text, ADD COLUMN IF NOT EXISTS descripcion text;
UPDATE public.subscription_plans SET slug = 'gratis', nombre = 'Gratis', precio_mensual = 0, precio_anual = 0, max_usuarios = 2, max_obras = 1, max_storage_mb = 200, orden = 1, activo = true,
  descripcion = 'Para arquitectos independientes: 1 obra activa y 2 usuarios.',
  features = '{"socios":false,"cierres":false,"portal":false,"cfdi_emision":false,"conciliacion":false,"export_contable":false,"pdf_export":true,"basic_reports":true}'::jsonb
WHERE nombre = 'Free';
UPDATE public.subscription_plans SET activo = false, slug = lower(nombre) WHERE nombre IN ('Pro','Enterprise');
INSERT INTO public.subscription_plans (nombre, slug, precio_mensual, precio_anual, max_usuarios, max_obras, max_storage_mb, features, activo, orden, descripcion)
SELECT 'Estudio', 'estudio', 599, 5990, 5, 5, 2048,
  '{"socios":true,"cierres":true,"portal":false,"cfdi_emision":false,"conciliacion":false,"export_contable":false,"pdf_export":true,"basic_reports":true,"advanced_reports":true}'::jsonb,
  true, 2, 'Para despachos: 5 obras, 5 usuarios, resultado por obra, socios y cierre mensual.'
WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE slug = 'estudio');
INSERT INTO public.subscription_plans (nombre, slug, precio_mensual, precio_anual, max_usuarios, max_obras, max_storage_mb, features, activo, orden, descripcion)
SELECT 'Constructora', 'constructora', 1299, 12990, 15, -1, 10240,
  '{"socios":true,"cierres":true,"portal":true,"cfdi_emision":true,"conciliacion":true,"export_contable":true,"pdf_export":true,"basic_reports":true,"advanced_reports":true}'::jsonb,
  true, 3, 'Obras ilimitadas, 15 usuarios, portal del cliente, facturación, conciliación y exportación contable.'
WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE slug = 'constructora');
CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_slug_idx ON public.subscription_plans (slug);

-- ---------- Suscripciones ----------
ALTER TABLE public.empresa_subscriptions
  ADD COLUMN IF NOT EXISTS periodicidad text NOT NULL DEFAULT 'mensual',
  ADD COLUMN IF NOT EXISTS gracia_hasta timestamptz,
  ADD COLUMN IF NOT EXISTS openpay_customer_id text,
  ADD COLUMN IF NOT EXISTS openpay_subscription_id text,
  ADD COLUMN IF NOT EXISTS card_last4 text,
  ADD COLUMN IF NOT EXISTS card_brand text,
  ADD COLUMN IF NOT EXISTS cancelada_at timestamptz,
  ADD COLUMN IF NOT EXISTS datos_fiscales jsonb;
-- Una fila por empresa
DELETE FROM public.empresa_subscriptions a USING public.empresa_subscriptions b WHERE a.empresa_id = b.empresa_id AND a.created_at < b.created_at;
CREATE UNIQUE INDEX IF NOT EXISTS empresa_subscriptions_empresa_idx ON public.empresa_subscriptions (empresa_id);
UPDATE public.empresa_subscriptions SET estado = 'activa' WHERE estado = 'active';
-- Supernova: Constructora por cortesía; el resto de empresas existentes: Gratis
UPDATE public.empresa_subscriptions SET plan_id = (SELECT id FROM public.subscription_plans WHERE slug = 'constructora'), estado = 'cortesia', payment_method = 'cortesia', trial_ends_at = NULL WHERE empresa_id = 1;
INSERT INTO public.empresa_subscriptions (empresa_id, plan_id, estado, payment_method)
SELECT e.id, (SELECT id FROM public.subscription_plans WHERE slug = 'gratis'), 'activa', 'gratis'
FROM control_obra.empresas e WHERE NOT EXISTS (SELECT 1 FROM public.empresa_subscriptions s WHERE s.empresa_id = e.id);
ALTER TABLE public.empresa_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS es_sel ON public.empresa_subscriptions;
CREATE POLICY es_sel ON public.empresa_subscriptions FOR SELECT USING (empresa_id = public.get_session_empresa_id() OR public.has_platform_session());

-- ---------- Plan efectivo y uso ----------
CREATE OR REPLACE FUNCTION public.plan_efectivo(p_empresa_id integer)
RETURNS TABLE(plan_id uuid, slug text, nombre text, features jsonb, max_usuarios integer, max_obras integer, max_storage_mb integer, estado text,
              trial_ends_at timestamptz, gracia_hasta timestamptz, current_period_end timestamptz, periodicidad text, card_last4 text, card_brand text, precio_mensual numeric, precio_anual numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH s AS (SELECT * FROM public.empresa_subscriptions WHERE empresa_id = p_empresa_id),
  p AS (SELECT sp.* FROM s JOIN public.subscription_plans sp ON sp.id = s.plan_id),
  g AS (SELECT * FROM public.subscription_plans WHERE slug = 'gratis'),
  ef AS (SELECT CASE WHEN (SELECT estado FROM s) IN ('lectura','cancelada') OR NOT EXISTS (SELECT 1 FROM p) THEN (SELECT to_jsonb(g) FROM g) ELSE (SELECT to_jsonb(p) FROM p) END j)
  SELECT (j->>'id')::uuid, j->>'slug', j->>'nombre', j->'features', (j->>'max_usuarios')::int, (j->>'max_obras')::int, (j->>'max_storage_mb')::int,
         COALESCE((SELECT estado FROM s), 'sin_suscripcion'), (SELECT trial_ends_at FROM s), (SELECT gracia_hasta FROM s), (SELECT current_period_end FROM s),
         COALESCE((SELECT periodicidad FROM s), 'mensual'), (SELECT card_last4 FROM s), (SELECT card_brand FROM s), (j->>'precio_mensual')::numeric, (j->>'precio_anual')::numeric
  FROM ef;
$$;

CREATE OR REPLACE FUNCTION public.uso_empresa(p_empresa_id integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','control_obra'
AS $$
  SELECT jsonb_build_object(
    'obras_activas', (SELECT count(*) FROM control_obra.obras WHERE empresa_id = p_empresa_id AND coalesce(estatus,'') NOT IN ('Archivada','Completada','Terminada','Cancelada','Cerrada')),
    'usuarios', (SELECT count(*) FROM control_obra.obra_usuarios WHERE empresa_id = p_empresa_id AND activo = true),
    'storage_mb', (SELECT round(coalesce(sum((metadata->>'size')::bigint),0)/1048576.0, 1) FROM storage.objects WHERE name LIKE 'empresa/' || p_empresa_id || '/%' OR name LIKE 'empresa_' || p_empresa_id || '_%')
  );
$$;

-- Para la app (sesión por header)
CREATE OR REPLACE FUNCTION public.get_mi_plan()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','control_obra'
AS $$
DECLARE v_emp int; v_p record; v_planes jsonb;
BEGIN
  v_emp := public.get_session_empresa_id();
  IF v_emp IS NULL THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_p FROM public.plan_efectivo(v_emp);
  SELECT jsonb_agg(jsonb_build_object('slug', slug, 'nombre', nombre, 'precio_mensual', precio_mensual, 'precio_anual', precio_anual, 'max_usuarios', max_usuarios, 'max_obras', max_obras, 'max_storage_mb', max_storage_mb, 'features', features, 'descripcion', descripcion) ORDER BY orden)
    INTO v_planes FROM public.subscription_plans WHERE activo = true;
  RETURN jsonb_build_object(
    'plan', jsonb_build_object('slug', v_p.slug, 'nombre', v_p.nombre, 'features', v_p.features, 'max_usuarios', v_p.max_usuarios, 'max_obras', v_p.max_obras, 'max_storage_mb', v_p.max_storage_mb, 'precio_mensual', v_p.precio_mensual, 'precio_anual', v_p.precio_anual),
    'sub', jsonb_build_object('estado', v_p.estado, 'trial_ends_at', v_p.trial_ends_at, 'gracia_hasta', v_p.gracia_hasta, 'current_period_end', v_p.current_period_end, 'periodicidad', v_p.periodicidad, 'card_last4', v_p.card_last4, 'card_brand', v_p.card_brand),
    'uso', public.uso_empresa(v_emp),
    'planes', coalesce(v_planes, '[]'::jsonb));
END; $$;

-- ---------- Límites ----------
CREATE OR REPLACE FUNCTION public.check_plan_limit(p_empresa_id integer, p_resource text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','control_obra'
AS $$
DECLARE v_p record; v_uso jsonb; v_used numeric; v_limit numeric; v_feature text;
BEGIN
  -- GUARDA_SESION_035
  IF NOT public.has_platform_session() AND p_empresa_id IS DISTINCT FROM public.get_session_empresa_id() THEN RAISE EXCEPTION 'No autorizado: la empresa no coincide con la sesión' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_p FROM public.plan_efectivo(p_empresa_id);
  IF p_resource LIKE 'feature:%' THEN
    v_feature := substr(p_resource, 9);
    RETURN jsonb_build_object('allowed', coalesce((v_p.features->>v_feature)::boolean, false), 'resource', p_resource, 'plan', v_p.nombre, 'plan_slug', v_p.slug, 'estado', v_p.estado);
  END IF;
  v_uso := public.uso_empresa(p_empresa_id);
  CASE p_resource
    WHEN 'obras_activas', 'obras' THEN v_used := (v_uso->>'obras_activas')::numeric; v_limit := v_p.max_obras;
    WHEN 'usuarios' THEN v_used := (v_uso->>'usuarios')::numeric; v_limit := v_p.max_usuarios;
    WHEN 'storage_mb' THEN v_used := (v_uso->>'storage_mb')::numeric; v_limit := v_p.max_storage_mb;
    ELSE RETURN jsonb_build_object('allowed', false, 'error', 'Recurso no válido', 'resource', p_resource);
  END CASE;
  IF v_limit IS NULL OR v_limit < 0 THEN RETURN jsonb_build_object('allowed', true, 'resource', p_resource, 'used', v_used, 'limit', null, 'plan', v_p.nombre, 'plan_slug', v_p.slug, 'estado', v_p.estado); END IF;
  RETURN jsonb_build_object('allowed', v_used < v_limit, 'resource', p_resource, 'used', v_used, 'limit', v_limit, 'plan', v_p.nombre, 'plan_slug', v_p.slug, 'estado', v_p.estado);
END; $$;

-- Escritura permitida (suscripción no en lectura, sin baja programada)
CREATE OR REPLACE FUNCTION public.require_escritura() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','control_obra'
AS $$
DECLARE v_emp int; v_estado text; v_baja timestamptz;
BEGIN
  v_emp := public.get_session_empresa_id();
  IF v_emp IS NULL THEN RETURN; END IF;
  SELECT estado INTO v_estado FROM public.empresa_subscriptions WHERE empresa_id = v_emp;
  SELECT baja_programada_at INTO v_baja FROM control_obra.empresas WHERE id = v_emp;
  IF v_baja IS NOT NULL THEN RAISE EXCEPTION 'SUBSCRIPTION_INACTIVE: la empresa tiene una baja programada; cancélala en Configuración para seguir capturando' USING ERRCODE = 'P0001'; END IF;
  IF v_estado IN ('lectura','cancelada') THEN RAISE EXCEPTION 'SUBSCRIPTION_INACTIVE: la suscripción venció; elige un plan en Configuración › Plan' USING ERRCODE = 'P0001'; END IF;
END; $$;

-- Límite como excepción con detalle JSON (la UI lo intercepta)
CREATE OR REPLACE FUNCTION public.require_limite(p_resource text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','control_obra'
AS $$
DECLARE v jsonb;
BEGIN
  v := public.check_plan_limit(public.get_session_empresa_id(), p_resource);
  IF NOT coalesce((v->>'allowed')::boolean, false) THEN RAISE EXCEPTION 'PLAN_LIMIT:%', v::text USING ERRCODE = 'P0001'; END IF;
END; $$;

-- Inyectar require_escritura (y require_limite donde aplica) en las funciones de escritura
DO $do$
DECLARE r record; def text; nuevo text; extra text;
BEGIN
  FOR r IN SELECT p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
           WHERE n.nspname = 'public' AND l.lanname = 'plpgsql'
             AND p.proname IN ('crear_gasto','crear_obra','crear_orden_compra','create_obra_user','crear_usuario_seguro','crear_gasto_seguro','crear_obra_seguro')
  LOOP
    def := pg_get_functiondef(r.oid);
    CONTINUE WHEN def ~ 'GUARDA_ESCRITURA_038';
    extra := ' PERFORM public.require_escritura();';
    IF r.proname IN ('crear_obra','crear_obra_seguro') THEN extra := extra || ' PERFORM public.require_limite(''obras_activas'');'; END IF;
    IF r.proname IN ('create_obra_user','crear_usuario_seguro') THEN extra := extra || ' PERFORM public.require_limite(''usuarios'');'; END IF;
    nuevo := regexp_replace(def, '(AS \$function\$.*?)\mBEGIN\M', E'\\1BEGIN\n  -- GUARDA_ESCRITURA_038\n ' || extra || E'\n', '');
    IF nuevo = def THEN RAISE NOTICE 'sin BEGIN: %', r.proname; CONTINUE; END IF;
    EXECUTE nuevo;
    RAISE NOTICE 'escritura en %(%)', r.proname, r.args;
  END LOOP;
END $do$;

-- registrar_usuario: empresa nueva arranca con prueba de 30 días del plan Constructora
CREATE OR REPLACE FUNCTION public.registrar_usuario(
  p_nombre text, p_email text, p_password text, p_tipo_registro text,
  p_empresa_nombre text DEFAULT NULL, p_codigo_invitacion text DEFAULT NULL,
  p_acepta_terminos boolean DEFAULT false, p_terminos_version text DEFAULT '1.0')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'control_obra', 'public', 'extensions'
AS $function$
DECLARE v_empresa_id INTEGER; v_user_id UUID; v_codigo TEXT; v_rol_id INTEGER; v_lim jsonb;
BEGIN
  IF p_acepta_terminos IS DISTINCT FROM true THEN RETURN json_build_object('success', false, 'error', 'Debes aceptar los términos y el aviso de privacidad'); END IF;
  IF p_email IS NULL OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN json_build_object('success', false, 'error', 'Escribe un correo válido'); END IF;
  IF length(coalesce(p_password,'')) < 8 THEN RETURN json_build_object('success', false, 'error', 'La contraseña debe tener al menos 8 caracteres'); END IF;
  IF EXISTS (SELECT 1 FROM control_obra.obra_usuarios WHERE email = LOWER(p_email)) THEN RETURN json_build_object('success', false, 'error', 'El correo electrónico ya está registrado'); END IF;

  IF p_tipo_registro = 'nueva' THEN
    IF p_empresa_nombre IS NULL OR btrim(p_empresa_nombre) = '' THEN RETURN json_build_object('success', false, 'error', 'El nombre de la empresa es requerido'); END IF;
    v_codigo := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
    INSERT INTO control_obra.empresas (nombre, codigo_invitacion, plan, activo, max_usuarios, max_obras, created_at)
    VALUES (btrim(p_empresa_nombre), v_codigo, 'trial', true, 15, 999, NOW()) RETURNING id INTO v_empresa_id;
    INSERT INTO public.empresa_subscriptions (empresa_id, plan_id, estado, trial_ends_at, billing_email, payment_method)
    VALUES (v_empresa_id, (SELECT id FROM public.subscription_plans WHERE slug = 'constructora'), 'trial', NOW() + interval '30 days', LOWER(p_email), 'trial');
    SELECT id INTO v_rol_id FROM control_obra.obra_roles WHERE nombre = 'admin_general' LIMIT 1;
    IF v_rol_id IS NULL THEN SELECT id INTO v_rol_id FROM control_obra.obra_roles LIMIT 1; END IF;
    INSERT INTO control_obra.obra_usuarios (nombre, email, password_hash, rol_id, activo, empresa_id, es_admin_empresa, created_at, terminos_version, terminos_aceptados_at)
    VALUES (p_nombre, LOWER(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')), v_rol_id, true, v_empresa_id, true, NOW(), p_terminos_version, NOW())
    RETURNING id INTO v_user_id;
  ELSIF p_tipo_registro = 'unirse' THEN
    IF p_codigo_invitacion IS NULL OR p_codigo_invitacion = '' THEN RETURN json_build_object('success', false, 'error', 'El código de invitación es requerido'); END IF;
    SELECT id INTO v_empresa_id FROM control_obra.empresas WHERE codigo_invitacion = UPPER(p_codigo_invitacion) AND activo = true;
    IF v_empresa_id IS NULL THEN RETURN json_build_object('success', false, 'error', 'Código de invitación inválido'); END IF;
    v_lim := public.check_plan_limit_interno(v_empresa_id, 'usuarios');
    IF NOT coalesce((v_lim->>'allowed')::boolean, true) THEN RETURN json_build_object('success', false, 'error', 'La empresa alcanzó el límite de usuarios de su plan (' || (v_lim->>'limit') || '). Pide al administrador que amplíe el plan.'); END IF;
    SELECT id INTO v_rol_id FROM control_obra.obra_roles WHERE nombre = 'trabajador' LIMIT 1;
    IF v_rol_id IS NULL THEN SELECT id INTO v_rol_id FROM control_obra.obra_roles ORDER BY nivel_acceso ASC LIMIT 1; END IF;
    INSERT INTO control_obra.obra_usuarios (nombre, email, password_hash, rol_id, activo, empresa_id, es_admin_empresa, created_at, terminos_version, terminos_aceptados_at)
    VALUES (p_nombre, LOWER(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')), v_rol_id, true, v_empresa_id, false, NOW(), p_terminos_version, NOW())
    RETURNING id INTO v_user_id;
  ELSE
    RETURN json_build_object('success', false, 'error', 'Tipo de registro inválido');
  END IF;
  RETURN json_build_object('success', true, 'user_id', v_user_id, 'empresa_id', v_empresa_id, 'message', 'Usuario registrado exitosamente');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- Versión interna del límite (sin guarda de sesión) para registrar_usuario y jobs
CREATE OR REPLACE FUNCTION public.check_plan_limit_interno(p_empresa_id integer, p_resource text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','control_obra'
AS $$
DECLARE v_p record; v_uso jsonb; v_used numeric; v_limit numeric;
BEGIN
  SELECT * INTO v_p FROM public.plan_efectivo(p_empresa_id);
  v_uso := public.uso_empresa(p_empresa_id);
  CASE p_resource
    WHEN 'obras_activas', 'obras' THEN v_used := (v_uso->>'obras_activas')::numeric; v_limit := v_p.max_obras;
    WHEN 'usuarios' THEN v_used := (v_uso->>'usuarios')::numeric; v_limit := v_p.max_usuarios;
    WHEN 'storage_mb' THEN v_used := (v_uso->>'storage_mb')::numeric; v_limit := v_p.max_storage_mb;
    ELSE RETURN jsonb_build_object('allowed', true);
  END CASE;
  IF v_limit IS NULL OR v_limit < 0 THEN RETURN jsonb_build_object('allowed', true, 'used', v_used, 'limit', null); END IF;
  RETURN jsonb_build_object('allowed', v_used < v_limit, 'used', v_used, 'limit', v_limit, 'plan', v_p.nombre);
END; $$;
REVOKE EXECUTE ON FUNCTION public.check_plan_limit_interno(integer, text) FROM PUBLIC, anon, authenticated;

-- ---------- Estados de la suscripción (job diario) ----------
CREATE OR REPLACE FUNCTION public.actualizar_estados_suscripcion()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v1 int; v2 int; v3 int;
BEGIN
  UPDATE public.empresa_subscriptions SET estado = 'vencida', gracia_hasta = trial_ends_at + interval '7 days', updated_at = now()
  WHERE estado = 'trial' AND trial_ends_at < now();
  GET DIAGNOSTICS v1 = ROW_COUNT;
  UPDATE public.empresa_subscriptions SET estado = 'lectura', updated_at = now()
  WHERE estado IN ('vencida','pago_fallido') AND gracia_hasta IS NOT NULL AND gracia_hasta < now();
  GET DIAGNOSTICS v2 = ROW_COUNT;
  -- Cancelaciones al fin del periodo pagado
  UPDATE public.empresa_subscriptions SET estado = 'cancelada', updated_at = now()
  WHERE estado = 'activa' AND cancelada_at IS NOT NULL AND current_period_end IS NOT NULL AND current_period_end < now();
  GET DIAGNOSTICS v3 = ROW_COUNT;
  RETURN jsonb_build_object('a_vencida', v1, 'a_lectura', v2, 'canceladas', v3);
END; $$;
REVOKE EXECUTE ON FUNCTION public.actualizar_estados_suscripcion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_estados_suscripcion() TO service_role;

-- Listado para correos de la prueba (jobs)
CREATE OR REPLACE FUNCTION public.suscripciones_para_correos()
RETURNS TABLE(empresa_id integer, empresa text, estado text, trial_ends_at timestamptz, gracia_hasta timestamptz, dias_desde_registro integer, admin_email text, admin_nombre text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','control_obra'
AS $$
  SELECT s.empresa_id, e.nombre, s.estado, s.trial_ends_at, s.gracia_hasta, (now()::date - e.created_at::date),
         (SELECT u.email FROM control_obra.obra_usuarios u WHERE u.empresa_id = e.id AND u.es_admin_empresa ORDER BY u.created_at LIMIT 1),
         (SELECT u.nombre FROM control_obra.obra_usuarios u WHERE u.empresa_id = e.id AND u.es_admin_empresa ORDER BY u.created_at LIMIT 1)
  FROM public.empresa_subscriptions s JOIN control_obra.empresas e ON e.id = s.empresa_id
  WHERE s.estado IN ('trial','vencida','pago_fallido') AND e.baja_programada_at IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.suscripciones_para_correos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suscripciones_para_correos() TO service_role;

-- Cambiar a Gratis (aplica al fin del periodo) y cancelar suscripción (sesión de admin)
CREATE OR REPLACE FUNCTION public.cambiar_plan_gratis()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','control_obra'
AS $$
DECLARE v_emp int; v_s record;
BEGIN
  v_emp := public.get_session_empresa_id();
  IF v_emp IS NULL OR coalesce(public.get_session_nivel(),0) < 100 THEN RETURN json_build_object('success', false, 'error', 'Sólo el administrador puede cambiar de plan'); END IF;
  SELECT * INTO v_s FROM public.empresa_subscriptions WHERE empresa_id = v_emp;
  IF v_s.estado IN ('trial','vencida','lectura','pago_fallido','sin_suscripcion') OR v_s.id IS NULL THEN
    INSERT INTO public.empresa_subscriptions (empresa_id, plan_id, estado, payment_method) VALUES (v_emp, (SELECT id FROM public.subscription_plans WHERE slug='gratis'), 'activa', 'gratis')
    ON CONFLICT (empresa_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, estado = 'activa', payment_method = 'gratis', trial_ends_at = NULL, gracia_hasta = NULL, cancelada_at = NULL, updated_at = now();
    RETURN json_build_object('success', true, 'inmediato', true);
  END IF;
  UPDATE public.empresa_subscriptions SET cancelada_at = now(), updated_at = now() WHERE empresa_id = v_emp;
  RETURN json_build_object('success', true, 'inmediato', false);
END; $$;
CREATE OR REPLACE FUNCTION public.cancelar_suscripcion()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','control_obra'
AS $$
DECLARE v_emp int;
BEGIN
  v_emp := public.get_session_empresa_id();
  IF v_emp IS NULL OR coalesce(public.get_session_nivel(),0) < 100 THEN RETURN json_build_object('success', false, 'error', 'Sólo el administrador puede cancelar'); END IF;
  UPDATE public.empresa_subscriptions SET cancelada_at = now(), updated_at = now() WHERE empresa_id = v_emp AND estado = 'activa';
  RETURN json_build_object('success', true);
END; $$;
