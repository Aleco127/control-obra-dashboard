-- 057 · Novedades del portal del cliente desde el servidor (PRD barra de módulos, US-602) · 3-sep-2026
-- El cliente quiere saber qué hay de nuevo desde su última visita sin recorrer toda la página.
-- Nada se calcula en el navegador: portal_datos devuelve
--   novedades = { fotos, documentos, pagos_vencidos, proximo_pago_dias, ultimo_visto_at }
-- comparando con control_obra.portal_usuarios.ultimo_visto_at, y actualiza esa marca AL FINAL de la
-- función para que las cuentas de «nuevo» usen el valor anterior. La entrada por enlace de obra
-- (portal_obra, token de 48 hex) no tiene cuenta, así que recibe novedades en ceros.
-- Además nace control_obra.portal_eventos + public.portal_evento(p_token, p_evento, p_meta) para la
-- telemetría del portal (sección abierta, «avisar que ya pagué»...), con límite de 60 eventos por
-- sesión y hora. La tabla sólo la lee service_role: el cliente nunca consulta eventos.

-- ---------- 1) Columna ----------
ALTER TABLE control_obra.portal_usuarios ADD COLUMN IF NOT EXISTS ultimo_visto_at timestamptz;
COMMENT ON COLUMN control_obra.portal_usuarios.ultimo_visto_at IS
  'Última vez que la cuenta abrió una obra en el portal (portal_datos). Base para contar fotos y documentos nuevos.';

-- ---------- 2) control_obra.portal_novedades(p_obra_id, p_visto) ----------
-- fotos / documentos: filas que el portal muestra (documentos con visible_cliente y no eliminados ni
-- archivados) con created_at posterior a p_visto; si p_visto es nulo cuentan todas.
-- pagos_vencidos: cuentas por cobrar con vencimiento pasado y saldo > 0.50.
-- proximo_pago_dias: días hasta la CxC con saldo más próxima que aún no vence (entero) o nulo.
-- «Hoy» se toma en America/Mexico_City (UTC-6 sin horario de verano) para no marcar vencido un pago
-- seis horas antes de que termine el día en México.
CREATE OR REPLACE FUNCTION control_obra.portal_novedades(p_obra_id integer, p_visto timestamptz)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
  WITH hoy AS (SELECT (now() AT TIME ZONE 'America/Mexico_City')::date AS d)
  SELECT jsonb_build_object(
    'fotos', (SELECT count(*) FROM control_obra.fotos_obra f
               WHERE f.obra_id = p_obra_id AND (p_visto IS NULL OR f.created_at > p_visto)),
    'documentos', (SELECT count(*) FROM control_obra.documentos d
               WHERE d.obra_id = p_obra_id AND d.visible_cliente = true
                 AND coalesce(d.estatus, '') NOT IN ('Eliminado', 'Archivado')
                 AND (p_visto IS NULL OR d.created_at > p_visto)),
    'pagos_vencidos', (SELECT count(*) FROM control_obra.cuentas_por_cobrar x, hoy
               WHERE x.obra_id = p_obra_id AND x.fecha_vencimiento < hoy.d
                 AND coalesce(x.monto_total, 0) - coalesce(x.monto_cobrado, 0) > 0.50),
    'proximo_pago_dias', (SELECT min(x.fecha_vencimiento) - hoy.d FROM control_obra.cuentas_por_cobrar x, hoy
               WHERE x.obra_id = p_obra_id AND x.fecha_vencimiento >= hoy.d
                 AND coalesce(x.monto_total, 0) - coalesce(x.monto_cobrado, 0) > 0.50
               GROUP BY hoy.d),
    'ultimo_visto_at', p_visto);
$function$;
REVOKE ALL ON FUNCTION control_obra.portal_novedades(integer, timestamptz) FROM PUBLIC, anon, authenticated;

-- ---------- 3) control_obra.portal_payload(p_obra_id): misma firma, novedades en ceros ----------
-- Es el contenido común de las dos entradas (cuenta y enlace de obra). Las cuentas lo sobreescriben
-- en portal_datos con jsonb ||; el enlace de obra se queda con los ceros.
CREATE OR REPLACE FUNCTION control_obra.portal_payload(p_obra_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
declare v_o record; v_e record;
begin
  select * into v_o from control_obra.obras where id = p_obra_id;
  if v_o.id is null then return jsonb_build_object('error','obra_no_encontrada'); end if;
  select * into v_e from control_obra.empresas where id = v_o.empresa_id;
  return jsonb_build_object(
    'obra', jsonb_build_object('id', v_o.id, 'nombre', v_o.nombre_obra, 'codigo', v_o.codigo_obra, 'ubicacion', v_o.ubicacion, 'estatus', v_o.estatus,
      'fecha_inicio', v_o.fecha_inicio, 'fecha_fin', v_o.fecha_fin_estimada, 'avance', v_o.avance_porcentaje,
      'cliente', coalesce((select c.nombre from control_obra.clientes c where c.id = v_o.cliente_id), v_o.cliente), 'contrato', v_o.presupuesto_total),
    'empresa', jsonb_build_object('nombre', v_e.nombre, 'telefono', v_e.telefono, 'email', v_e.email, 'logo_url', v_e.logo_url, 'sitio_web', v_e.sitio_web, 'datos_pago', v_e.datos_pago),
    'actividades', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre, 'inicio', a.fecha_inicio, 'fin', a.fecha_fin, 'avance', a.porcentaje_avance, 'peso', a.peso_porcentual, 'hito', a.es_hito, 'responsable', a.responsable) order by a.fecha_inicio, a.orden)
      from control_obra.actividades_programa a join control_obra.programas_obra p on p.id = a.programa_id where p.obra_id = v_o.id and coalesce(a.es_resumen,false) = false), '[]'::jsonb),
    'fotos', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'url', f.url_foto, 'thumb', f.url_thumbnail, 'titulo', f.titulo, 'descripcion', f.descripcion, 'fecha', coalesce(f.fecha_foto, f.created_at::date), 'etapa', f.etapa_obra, 'actividad_id', f.actividad_id, 'creada', f.created_at) order by coalesce(f.fecha_foto, f.created_at::date) desc)
      from (select * from control_obra.fotos_obra where obra_id = v_o.id order by coalesce(fecha_foto, created_at::date) desc limit 60) f), '[]'::jsonb),
    'documentos', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nombre', d.nombre, 'descripcion', d.descripcion, 'categoria', d.categoria, 'tipo', d.tipo_archivo,
        'fecha', coalesce(d.fecha_documento, d.created_at::date), 'version', d.version, 'actividad_id', d.actividad_id, 'creado', d.created_at,
        'url', case when d.url_archivo ~* '^https?://' then d.url_archivo else null end,
        'tiene_archivo', d.archivo_path is not null) order by coalesce(d.fecha_documento, d.created_at::date) desc, d.id desc)
      from control_obra.documentos d where d.obra_id = v_o.id and d.visible_cliente = true and coalesce(d.estatus,'') not in ('Eliminado','Archivado')), '[]'::jsonb),
    'estimaciones', coalesce((select jsonb_agg(jsonb_build_object('numero', e.numero_estimacion, 'fecha', coalesce(e.fecha_presentacion, e.created_at::date), 'periodo_inicio', e.periodo_inicio, 'periodo_fin', e.periodo_fin, 'avance', e.porcentaje_avance, 'total', e.total, 'neto', e.neto_a_pagar, 'estatus', e.estatus) order by e.numero_estimacion desc)
      from control_obra.estimaciones e where e.obra_id = v_o.id), '[]'::jsonb),
    'plan_pagos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'concepto', x.concepto, 'monto', x.monto_total, 'cobrado', x.monto_cobrado, 'vence', x.fecha_vencimiento, 'estatus', x.estatus) order by x.fecha_vencimiento)
      from control_obra.cuentas_por_cobrar x where x.obra_id = v_o.id), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'numero', p.numero_pago, 'fecha', p.fecha_pago, 'monto', p.monto, 'metodo', p.metodo_pago, 'concepto', p.concepto) order by p.fecha_pago desc)
      from control_obra.pagos_recibidos p where p.obra_id = v_o.id), '[]'::jsonb),
    'cfdis', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'serie', c.serie, 'folio', c.folio, 'fecha', c.fecha_emision, 'total', c.total, 'uuid', c.uuid, 'tiene_archivo', (c.archivo_path is not null or c.pdf_url is not null)) order by c.fecha_emision desc)
      from control_obra.cfdis_emitidos c where c.obra_id = v_o.id and coalesce(c.estatus,'') <> 'Cancelado'), '[]'::jsonb),
    -- Sin cuenta no hay «última visita»: el enlace de obra recibe ceros (US-602)
    'novedades', jsonb_build_object('fotos', 0, 'documentos', 0, 'pagos_vencidos', 0, 'proximo_pago_dias', null, 'ultimo_visto_at', null),
    'generado', now());
end; $function$;

-- ---------- 4) public.portal_datos(p_token, p_obra_id): novedades reales + marca de visita ----------
-- El UPDATE de ultimo_visto_at va DESPUÉS de armar la respuesta: las cuentas usan el valor anterior.
CREATE OR REPLACE FUNCTION public.portal_datos(p_token text, p_obra_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
declare v_u control_obra.portal_usuarios; v_res jsonb;
begin
  v_u := control_obra.portal_usuario_de_sesion(p_token);
  if v_u.id is null then return jsonb_build_object('error','sesion_invalida'); end if;
  if not exists (select 1 from control_obra.portal_usuario_obras where usuario_id = v_u.id and obra_id = p_obra_id) then
    return jsonb_build_object('error','sin_acceso');
  end if;
  v_res := control_obra.portal_payload(p_obra_id)
      || jsonb_build_object('usuario', jsonb_build_object('nombre', v_u.nombre, 'usuario', v_u.usuario),
                            'novedades', control_obra.portal_novedades(p_obra_id, v_u.ultimo_visto_at));
  update control_obra.portal_usuarios set ultimo_visto_at = now() where id = v_u.id;
  return v_res;
end; $function$;

-- ---------- 5) Tabla control_obra.portal_eventos ----------
-- sesion_llave identifica la sesión para el límite por hora: 'sesion:<portal_sesiones.id>' para cuentas
-- y 'token:<8 primeros hex>' para el enlace de obra. portal_usuario_id es nulo en la entrada por enlace.
CREATE TABLE IF NOT EXISTS control_obra.portal_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  portal_usuario_id bigint REFERENCES control_obra.portal_usuarios(id) ON DELETE SET NULL,
  obra_id integer REFERENCES control_obra.obras(id) ON DELETE SET NULL,
  evento text NOT NULL CHECK (evento ~ '^[a-z][a-z0-9_]{1,39}$'),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  sesion_llave text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE control_obra.portal_eventos IS
  'Telemetría del portal del cliente (US-602). Sólo la escribe public.portal_evento; sólo la lee service_role.';
CREATE INDEX IF NOT EXISTS portal_eventos_llave_idx ON control_obra.portal_eventos (sesion_llave, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_eventos_obra_idx ON control_obra.portal_eventos (obra_id, created_at DESC);

ALTER TABLE control_obra.portal_eventos ENABLE ROW LEVEL SECURITY;
-- Los privilegios por defecto del esquema dan todo a anon/authenticated: se retiran a propósito.
REVOKE ALL ON TABLE control_obra.portal_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE control_obra.portal_eventos TO service_role;
DO $$
DECLARE v_seq text := pg_get_serial_sequence('control_obra.portal_eventos', 'id');
BEGIN
  IF v_seq IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_seq);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', v_seq);
  END IF;
END $$;

-- ---------- 6) public.portal_evento(p_token, p_evento, p_meta) ----------
-- Acepta la sesión de cuenta (token de 64 hex) o el enlace de obra (48 hex). Con cuenta, meta.obra_id
-- se toma como obra del evento sólo si la cuenta tiene acceso a esa obra. Devuelve {ok:true, id} o
-- {ok:false, error: sesion_invalida | evento_invalido | meta_invalida | limite_eventos}.
CREATE OR REPLACE FUNCTION public.portal_evento(p_token text, p_evento text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
declare
  v_u control_obra.portal_usuarios;
  v_t record;
  v_meta jsonb;
  v_llave text;
  v_uid bigint;
  v_sid bigint;
  v_obra integer;
  v_n integer;
  v_id bigint;
begin
  if p_evento is null or p_evento !~ '^[a-z][a-z0-9_]{1,39}$' then
    return jsonb_build_object('ok', false, 'error', 'evento_invalido');
  end if;
  v_meta := coalesce(p_meta, '{}'::jsonb);
  if jsonb_typeof(v_meta) <> 'object' or length(v_meta::text) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'meta_invalida');
  end if;

  if p_token ~ '^[a-f0-9]{64}$' then
    v_u := control_obra.portal_usuario_de_sesion(p_token);
    if v_u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion_invalida'); end if;
    select s.id into v_sid from control_obra.portal_sesiones s where s.token = p_token;
    v_llave := 'sesion:' || v_sid::text;
    v_uid := v_u.id;
    if coalesce(v_meta->>'obra_id', '') ~ '^[0-9]{1,9}$' then
      v_obra := (v_meta->>'obra_id')::integer;
      if not exists (select 1 from control_obra.portal_usuario_obras where usuario_id = v_u.id and obra_id = v_obra) then
        v_obra := null;
      end if;
    end if;
  elsif p_token ~ '^[a-f0-9]{48}$' then
    select * into v_t from control_obra.obra_portal_tokens where token = p_token and activo;
    if v_t.id is null then return jsonb_build_object('ok', false, 'error', 'sesion_invalida'); end if;
    v_llave := 'token:' || left(p_token, 8);
    v_obra := v_t.obra_id;
  else
    return jsonb_build_object('ok', false, 'error', 'sesion_invalida');
  end if;

  -- Límite: 60 eventos por sesión en la última hora
  select count(*) into v_n from control_obra.portal_eventos
   where sesion_llave = v_llave and created_at > now() - interval '1 hour';
  if v_n >= 60 then
    return jsonb_build_object('ok', false, 'error', 'limite_eventos');
  end if;

  insert into control_obra.portal_eventos (portal_usuario_id, obra_id, evento, meta, sesion_llave)
  values (v_uid, v_obra, p_evento, v_meta, v_llave)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $function$;
REVOKE ALL ON FUNCTION public.portal_evento(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_evento(text, text, jsonb) TO anon, authenticated, service_role;

-- ---------- Prueba manual (bloque comentado; corre con el MCP contra la obra 48 de QA) ----------
-- DO $$
-- DECLARE v jsonb; t text;
-- BEGIN
--   v := control_obra.portal_novedades(48, NULL);
--   RAISE NOTICE 'novedades sin visita: %', v;           -- fotos/documentos cuentan todas; pagos_vencidos 1
--   v := control_obra.portal_novedades(48, now());
--   ASSERT (v->>'fotos')::int = 0 AND (v->>'documentos')::int = 0, 'con visita ahora no hay nuevas';
--   ASSERT jsonb_typeof(v->'proximo_pago_dias') IN ('number','null');
--   ASSERT (control_obra.portal_payload(48)->'novedades'->>'pagos_vencidos')::int = 0, 'el enlace de obra recibe ceros';
--   SELECT s.token INTO t FROM control_obra.portal_sesiones s JOIN control_obra.portal_usuarios u ON u.id = s.usuario_id
--    WHERE u.usuario = 'qa.portal' AND s.activo AND s.expires_at > now() LIMIT 1;
--   ASSERT (public.portal_evento(t, 'qa_ralph_prueba', '{"obra_id":48}'))->>'ok' = 'true';
--   ASSERT (public.portal_evento(t, 'Mal Evento', '{}'))->>'error' = 'evento_invalido';
--   ASSERT (public.portal_evento(repeat('0', 64), 'seccion', '{}'))->>'error' = 'sesion_invalida';
--   DELETE FROM control_obra.portal_eventos WHERE evento LIKE 'qa_ralph%';
--   RAISE EXCEPTION 'ROLLBACK de la prueba';
-- END $$;
