-- Migration: Create Platform RPC Functions
-- Date: 2025-12-21

-- Function to hash password (using pgcrypto)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Platform Admin Login Function
CREATE OR REPLACE FUNCTION platform_admin_login(
  p_email TEXT,
  p_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin platform_admins%ROWTYPE;
  v_token TEXT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Find admin by email
  SELECT * INTO v_admin
  FROM platform_admins
  WHERE email = LOWER(TRIM(p_email)) AND activo = true;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Credenciales invalidas');
  END IF;

  -- Verify password
  IF v_admin.password_hash != crypt(p_password, v_admin.password_hash) THEN
    RETURN json_build_object('success', false, 'error', 'Credenciales invalidas');
  END IF;

  -- Generate session token
  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires_at := NOW() + INTERVAL '24 hours';

  -- Create session
  INSERT INTO platform_sessions (admin_id, token, expires_at)
  VALUES (v_admin.id, v_token, v_expires_at);

  -- Update last access
  UPDATE platform_admins SET ultimo_acceso = NOW() WHERE id = v_admin.id;

  RETURN json_build_object(
    'success', true,
    'token', v_token,
    'admin', json_build_object(
      'id', v_admin.id,
      'email', v_admin.email,
      'nombre', v_admin.nombre,
      'rol', v_admin.rol
    )
  );
END;
$$;

-- Validate Platform Session
CREATE OR REPLACE FUNCTION validate_platform_session(
  p_token TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session platform_sessions%ROWTYPE;
  v_admin platform_admins%ROWTYPE;
BEGIN
  -- Find valid session
  SELECT * INTO v_session
  FROM platform_sessions
  WHERE token = p_token AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false);
  END IF;

  -- Get admin info
  SELECT * INTO v_admin
  FROM platform_admins
  WHERE id = v_session.admin_id AND activo = true;

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false);
  END IF;

  RETURN json_build_object(
    'valid', true,
    'admin', json_build_object(
      'id', v_admin.id,
      'email', v_admin.email,
      'nombre', v_admin.nombre,
      'rol', v_admin.rol
    )
  );
END;
$$;

-- Platform Admin Logout
CREATE OR REPLACE FUNCTION platform_admin_logout(
  p_token TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM platform_sessions WHERE token = p_token;
  RETURN json_build_object('success', true);
END;
$$;

-- Log Client Error Function
CREATE OR REPLACE FUNCTION log_client_error(
  p_error_type TEXT,
  p_message TEXT,
  p_stack_trace TEXT DEFAULT NULL,
  p_url TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB,
  p_empresa_id INTEGER DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fingerprint TEXT;
  v_error_id UUID;
BEGIN
  -- Generate fingerprint from error type + first line of message
  v_fingerprint := encode(digest(p_error_type || ':' || split_part(p_message, E'\n', 1), 'sha256'), 'hex');

  -- Insert error
  INSERT INTO platform_errors (
    empresa_id, user_id, error_type, message, stack_trace,
    url, user_agent, metadata, fingerprint
  ) VALUES (
    p_empresa_id, p_user_id, p_error_type, p_message, p_stack_trace,
    p_url, p_user_agent, p_metadata, v_fingerprint
  )
  RETURNING id INTO v_error_id;

  -- Update or insert occurrence
  INSERT INTO error_occurrences (fingerprint, first_error_id, first_seen, last_seen)
  VALUES (v_fingerprint, v_error_id, NOW(), NOW())
  ON CONFLICT (fingerprint) DO UPDATE SET
    occurrence_count = error_occurrences.occurrence_count + 1,
    last_seen = NOW();

  RETURN v_error_id;
END;
$$;

-- Get Platform Dashboard Stats
CREATE OR REPLACE FUNCTION get_platform_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats JSON;
BEGIN
  SELECT json_build_object(
    'total_empresas', (SELECT COUNT(*) FROM empresas WHERE activo = true),
    'total_usuarios', (SELECT COUNT(*) FROM obra_usuarios WHERE activo = true),
    'total_obras', (SELECT COUNT(*) FROM obras),
    'active_sessions', (SELECT COUNT(*) FROM obra_sesiones WHERE expires_at > NOW()),
    'errors_24h', (SELECT COUNT(*) FROM platform_errors WHERE created_at > NOW() - INTERVAL '24 hours'),
    'errors_by_type', (
      SELECT json_agg(json_build_object('type', error_type, 'count', cnt))
      FROM (
        SELECT error_type, COUNT(*) as cnt
        FROM platform_errors
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY error_type
        ORDER BY cnt DESC
        LIMIT 5
      ) sub
    ),
    'recent_signups', (
      SELECT COUNT(*) FROM empresas WHERE created_at > NOW() - INTERVAL '7 days'
    ),
    'mrr', (
      SELECT COALESCE(SUM(sp.precio_mensual), 0)
      FROM empresa_subscriptions es
      JOIN subscription_plans sp ON es.plan_id = sp.id
      WHERE es.estado = 'active'
    )
  ) INTO v_stats;

  RETURN v_stats;
END;
$$;

-- Resolve Error Occurrence
CREATE OR REPLACE FUNCTION resolve_error(
  p_fingerprint TEXT,
  p_resolution_note TEXT DEFAULT NULL,
  p_admin_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE error_occurrences SET
    status = 'resolved',
    resolution_note = p_resolution_note,
    resolved_at = NOW(),
    resolved_by = p_admin_id
  WHERE fingerprint = p_fingerprint;

  UPDATE platform_errors SET
    status = 'resolved'
  WHERE fingerprint = p_fingerprint;

  RETURN json_build_object('success', true);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION platform_admin_login TO anon, authenticated;
GRANT EXECUTE ON FUNCTION validate_platform_session TO anon, authenticated;
GRANT EXECUTE ON FUNCTION platform_admin_logout TO anon, authenticated;
GRANT EXECUTE ON FUNCTION log_client_error TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_platform_stats TO anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_error TO anon, authenticated;
