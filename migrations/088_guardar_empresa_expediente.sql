-- 088_guardar_empresa_expediente.sql (US-807) — RPC para guardar los datos legales del expediente de la empresa.
--
-- public.guardar_empresa_expediente(p_datos jsonb) → jsonb (la fila guardada)
--   * SECURITY DEFINER: la app entra como anon; la función valida la sesión (x-obra-token) y exige nivel >= 80 (D3).
--   * Upsert 1:1 sobre control_obra.empresa_expediente con la empresa de la SESIÓN (nunca la que mande el cliente).
--   * «Clave ausente = no tocar»: sólo se escriben las llaves presentes en p_datos; "" o null dejan el campo en NULL.
--   * Llaves fuera de la lista se rechazan (evita escribir updated_by, empresa_id, etc.).
--   * No duplica lo que vive en control_obra.empresas (razón social, RFC, domicilio, representante, registro patronal):
--     eso se edita en Configuración.
-- Aditiva: sólo crea esta función.

CREATE OR REPLACE FUNCTION public.guardar_empresa_expediente(p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
DECLARE
  v_user  uuid;
  v_emp   integer;
  v_key   text;
  v_txt   text[] := ARRAY['representante_cargo','representante_rfc','escritura_constitutiva','poder_notarial',
                          'infonavit_registro','cmic_registro','padron_contratistas','poliza_rc_numero',
                          'poliza_rc_aseguradora','afianzadora','notas'];
  v_num   text[] := ARRAY['capital_contable','poliza_rc_monto'];
  v_fec   text[] := ARRAY['escritura_fecha','capital_contable_fecha','padron_contratistas_vigencia','poliza_rc_vigencia'];
  v_val   text;
  v_row   control_obra.empresa_expediente%ROWTYPE;
BEGIN
  v_user := control_obra.get_session_user_id();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '28000';
  END IF;
  IF COALESCE(control_obra.get_session_nivel(), 0) < 80 THEN
    RAISE EXCEPTION 'Sólo administración y gerencia pueden editar el expediente de la empresa' USING ERRCODE = '42501';
  END IF;
  v_emp := control_obra.get_session_empresa_id();
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'El usuario no tiene empresa' USING ERRCODE = '22023';
  END IF;
  IF p_datos IS NULL OR jsonb_typeof(p_datos) <> 'object' THEN
    RAISE EXCEPTION 'Datos inválidos' USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_datos) LOOP
    IF NOT (v_key = ANY (v_txt || v_num || v_fec)) THEN
      RAISE EXCEPTION 'Campo no admitido: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO control_obra.empresa_expediente (empresa_id, updated_by) VALUES (v_emp, v_user)
  ON CONFLICT (empresa_id) DO NOTHING;

  SELECT * INTO v_row FROM control_obra.empresa_expediente WHERE empresa_id = v_emp FOR UPDATE;

  FOR v_key IN SELECT jsonb_object_keys(p_datos) LOOP
    v_val := NULLIF(btrim(p_datos->>v_key), '');
    IF v_key = ANY (v_txt) THEN
      IF v_val IS NOT NULL AND length(v_val) > 2000 THEN
        RAISE EXCEPTION 'El campo % es demasiado largo', v_key USING ERRCODE = '22023';
      END IF;
      v_row := jsonb_populate_record(v_row, jsonb_build_object(v_key, v_val));
    ELSIF v_key = ANY (v_num) THEN
      BEGIN
        IF v_val IS NOT NULL AND v_val::numeric < 0 THEN
          RAISE EXCEPTION 'El campo % no puede ser negativo', v_key USING ERRCODE = '22023';
        END IF;
        v_row := jsonb_populate_record(v_row, jsonb_build_object(v_key, v_val::numeric));
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'El campo % debe ser un número', v_key USING ERRCODE = '22023';
      END;
    ELSE
      BEGIN
        v_row := jsonb_populate_record(v_row, jsonb_build_object(v_key, v_val::date));
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION 'El campo % debe ser una fecha (AAAA-MM-DD)', v_key USING ERRCODE = '22023';
      END;
    END IF;
  END LOOP;

  UPDATE control_obra.empresa_expediente SET
    representante_cargo = v_row.representante_cargo, representante_rfc = upper(v_row.representante_rfc),
    escritura_constitutiva = v_row.escritura_constitutiva, escritura_fecha = v_row.escritura_fecha,
    poder_notarial = v_row.poder_notarial, capital_contable = v_row.capital_contable,
    capital_contable_fecha = v_row.capital_contable_fecha, infonavit_registro = v_row.infonavit_registro,
    cmic_registro = v_row.cmic_registro, padron_contratistas = v_row.padron_contratistas,
    padron_contratistas_vigencia = v_row.padron_contratistas_vigencia, poliza_rc_numero = v_row.poliza_rc_numero,
    poliza_rc_aseguradora = v_row.poliza_rc_aseguradora, poliza_rc_monto = v_row.poliza_rc_monto,
    poliza_rc_vigencia = v_row.poliza_rc_vigencia, afianzadora = v_row.afianzadora, notas = v_row.notas,
    updated_by = v_user
  WHERE empresa_id = v_emp
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.guardar_empresa_expediente(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_empresa_expediente(jsonb) TO anon, authenticated, service_role;
