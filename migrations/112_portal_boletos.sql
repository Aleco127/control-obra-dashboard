-- 112_portal_boletos.sql · US-854 (épica L): boleto de un solo uso para que el conector local obtenga la credencial
-- de un portal sin que la contraseña pase por el navegador (D11, D15).
--
-- Flujo: la app pide un boleto (función de borde portal-credencial, acción `emitir`, sesión nivel >= 80) → se lo da
-- al conector de la PC → el conector lo canjea (`canjear`, con el secreto de ingesta que ya tiene) por {usuario,
-- password} → inicia sesión en el portal UNA vez → informa el resultado (`resultado`). El boleto son 256 bits
-- aleatorios generados en la función de borde; aquí sólo se guarda su SHA-256. Vive 120 s, sirve una vez y está ligado
-- a empresa y portal.
--
-- Reglas que viven aquí (no en el cliente):
--   * No se emite boleto si el acceso no existe o si su estado es «fallo» (no se reintenta hasta que un administrador
--     cambie la contraseña: guardar_portal_credencial regresa el estado a «sin_probar»).
--   * Emitir uno nuevo anula los boletos de esa empresa y portal que aún no se canjearon; si hay uno canjeado sin
--     resultado en los últimos 5 min (un inicio de sesión en curso) no se emite otro.
--   * Tope de 20 boletos por empresa en 10 min. Los boletos de más de 1 día se borran al emitir.
-- Tabla y funciones SÓLO para service_role: sin vista pública ni permisos a anon/authenticated.

CREATE TABLE IF NOT EXISTS control_obra.portal_boletos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    integer NOT NULL REFERENCES control_obra.empresas(id) ON DELETE CASCADE,
  portal        text NOT NULL CHECK (portal IN ('comprasmx', 'chihuahua', 'otro')),
  user_id       uuid NOT NULL,
  boleto_sha256 text NOT NULL UNIQUE CHECK (boleto_sha256 ~ '^[0-9a-f]{64}$'),
  proposito     text NOT NULL DEFAULT 'probar' CHECK (proposito IN ('probar', 'buscar')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expira_at     timestamptz NOT NULL DEFAULT now() + interval '120 seconds',
  usado_at      timestamptz,
  resultado     text CHECK (resultado IN ('correcto', 'fallo')),
  resultado_at  timestamptz
);
CREATE INDEX IF NOT EXISTS portal_boletos_empresa_idx ON control_obra.portal_boletos (empresa_id, portal, created_at DESC);

ALTER TABLE control_obra.portal_boletos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON control_obra.portal_boletos FROM PUBLIC, anon, authenticated;
GRANT ALL ON control_obra.portal_boletos TO service_role;

-- Emitir: la función de borde ya validó la sesión (nivel >= 80) y generó el boleto; aquí sólo llega su hash.
CREATE OR REPLACE FUNCTION control_obra.portal_boleto_emitir(p_empresa integer, p_portal text, p_user uuid,
                                                            p_sha256 text, p_proposito text DEFAULT 'probar')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_acc control_obra.empresa_portales; v_b control_obra.portal_boletos;
BEGIN
  SELECT * INTO v_acc FROM control_obra.empresa_portales WHERE empresa_id = p_empresa AND portal = p_portal FOR UPDATE;
  IF v_acc.id IS NULL THEN
    RAISE EXCEPTION 'No hay un acceso guardado para ese portal. Agrégalo en Expediente › Portales.' USING ERRCODE = 'P0002';
  END IF;
  IF v_acc.estado = 'fallo' THEN
    RAISE EXCEPTION 'El portal rechazó el último inicio de sesión. Un administrador debe cambiar la contraseña en Expediente › Portales antes de volver a intentarlo.' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM control_obra.portal_boletos b WHERE b.empresa_id = p_empresa AND b.portal = p_portal
              AND b.usado_at > now() - interval '5 minutes' AND b.resultado IS NULL) THEN
    RAISE EXCEPTION 'Ya hay un inicio de sesión en curso en ese portal; espera a que termine.' USING ERRCODE = '55006';
  END IF;
  IF (SELECT count(*) FROM control_obra.portal_boletos b WHERE b.empresa_id = p_empresa
       AND b.created_at > now() - interval '10 minutes') >= 20 THEN
    RAISE EXCEPTION 'Demasiados intentos seguidos; espera unos minutos.' USING ERRCODE = '54000';
  END IF;
  DELETE FROM control_obra.portal_boletos WHERE created_at < now() - interval '1 day';
  UPDATE control_obra.portal_boletos SET expira_at = least(expira_at, now())
   WHERE empresa_id = p_empresa AND portal = p_portal AND usado_at IS NULL AND expira_at > now();
  INSERT INTO control_obra.portal_boletos (empresa_id, portal, user_id, boleto_sha256, proposito)
  VALUES (p_empresa, p_portal, p_user, lower(p_sha256), coalesce(p_proposito, 'probar'))
  RETURNING * INTO v_b;
  RETURN jsonb_build_object('id', v_b.id, 'expira_at', v_b.expira_at, 'portal', v_b.portal, 'usuario', v_acc.usuario);
END $$;

-- Canjear: marca el boleto usado (una sola vez, atómico) y devuelve la credencial. NULL = boleto usado, vencido o
-- desconocido (la función de borde responde 401 sin detalle).
CREATE OR REPLACE FUNCTION control_obra.portal_boleto_canjear(p_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_b control_obra.portal_boletos; v_estado text;
BEGIN
  UPDATE control_obra.portal_boletos SET usado_at = now()
   WHERE boleto_sha256 = lower(p_sha256) AND usado_at IS NULL AND expira_at > now()
  RETURNING * INTO v_b;
  IF v_b.id IS NULL THEN RETURN NULL; END IF;
  SELECT estado INTO v_estado FROM control_obra.empresa_portales WHERE empresa_id = v_b.empresa_id AND portal = v_b.portal;
  IF v_estado IS NULL OR v_estado = 'fallo' THEN RETURN NULL; END IF;
  RETURN control_obra.portal_credencial(v_b.empresa_id, v_b.portal)
         || jsonb_build_object('proposito', v_b.proposito, 'boleto_id', v_b.id);
END $$;

-- Resultado: sólo con un boleto ya canjeado, sin resultado y canjeado hace menos de 30 min.
CREATE OR REPLACE FUNCTION control_obra.portal_boleto_resultado(p_sha256 text, p_estado text, p_mensaje text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_b control_obra.portal_boletos; v_fila control_obra.empresa_portales;
BEGIN
  IF p_estado NOT IN ('correcto', 'fallo') THEN RAISE EXCEPTION 'estado no válido' USING ERRCODE = '22023'; END IF;
  UPDATE control_obra.portal_boletos SET resultado = p_estado, resultado_at = now()
   WHERE boleto_sha256 = lower(p_sha256) AND usado_at IS NOT NULL AND resultado IS NULL
     AND usado_at > now() - interval '30 minutes'
  RETURNING * INTO v_b;
  IF v_b.id IS NULL THEN RETURN NULL; END IF;
  UPDATE control_obra.empresa_portales
     SET estado = p_estado, probado_at = now(),
         ultimo_error = CASE WHEN p_estado = 'fallo' THEN left(coalesce(nullif(btrim(p_mensaje), ''), 'El portal no aceptó el acceso.'), 500) END
   WHERE empresa_id = v_b.empresa_id AND portal = v_b.portal
  RETURNING * INTO v_fila;
  RETURN jsonb_build_object('empresa_id', v_b.empresa_id, 'portal', v_b.portal, 'estado', v_fila.estado,
                            'probado_at', v_fila.probado_at, 'ultimo_error', v_fila.ultimo_error);
END $$;

REVOKE ALL ON FUNCTION control_obra.portal_boleto_emitir(integer, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION control_obra.portal_boleto_canjear(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION control_obra.portal_boleto_resultado(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION control_obra.portal_boleto_emitir(integer, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION control_obra.portal_boleto_canjear(text) TO service_role;
GRANT EXECUTE ON FUNCTION control_obra.portal_boleto_resultado(text, text, text) TO service_role;

-- 112b (aplicada como 112b_portal_boleto_resultado_obsoleto): si la credencial cambió en Vault DESPUÉS del canje, el
-- resultado corresponde a la contraseña anterior y NO se aplica (responde obsoleto:true). Lo destapó la prueba real del
-- 5-oct-2026: el canje fue con la contraseña vieja, el coordinador guardó la nueva 0.2 s antes del informe «fallo» y ese
-- informe dejó en «fallo» una contraseña que nadie había probado.
CREATE OR REPLACE FUNCTION control_obra.portal_boleto_resultado(p_sha256 text, p_estado text, p_mensaje text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_b control_obra.portal_boletos; v_fila control_obra.empresa_portales; v_cambio timestamptz;
BEGIN
  IF p_estado NOT IN ('correcto', 'fallo') THEN RAISE EXCEPTION 'estado no válido' USING ERRCODE = '22023'; END IF;
  UPDATE control_obra.portal_boletos SET resultado = p_estado, resultado_at = now()
   WHERE boleto_sha256 = lower(p_sha256) AND usado_at IS NOT NULL AND resultado IS NULL
     AND usado_at > now() - interval '30 minutes'
  RETURNING * INTO v_b;
  IF v_b.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_fila FROM control_obra.empresa_portales WHERE empresa_id = v_b.empresa_id AND portal = v_b.portal FOR UPDATE;
  SELECT s.updated_at INTO v_cambio FROM vault.secrets s
   WHERE s.id = v_fila.vault_secret_id OR s.name = 'portal:' || v_b.empresa_id || ':' || v_b.portal
   ORDER BY s.updated_at DESC LIMIT 1;
  IF v_fila.id IS NULL OR (v_cambio IS NOT NULL AND v_cambio > v_b.usado_at) THEN
    RETURN jsonb_build_object('empresa_id', v_b.empresa_id, 'portal', v_b.portal, 'estado', v_fila.estado,
                              'probado_at', v_fila.probado_at, 'ultimo_error', v_fila.ultimo_error, 'obsoleto', true);
  END IF;
  UPDATE control_obra.empresa_portales
     SET estado = p_estado, probado_at = now(),
         ultimo_error = CASE WHEN p_estado = 'fallo' THEN left(coalesce(nullif(btrim(p_mensaje), ''), 'El portal no aceptó el acceso.'), 500) END
   WHERE id = v_fila.id
  RETURNING * INTO v_fila;
  RETURN jsonb_build_object('empresa_id', v_b.empresa_id, 'portal', v_b.portal, 'estado', v_fila.estado,
                            'probado_at', v_fila.probado_at, 'ultimo_error', v_fila.ultimo_error);
END $$;
REVOKE ALL ON FUNCTION control_obra.portal_boleto_resultado(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION control_obra.portal_boleto_resultado(text, text, text) TO service_role;
