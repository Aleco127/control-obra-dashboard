-- 060: logotipo cuadrado (isotipo) por empresa
--
-- `empresas.logo_url` es el logotipo completo de la marca: casi siempre horizontal, y así se usa en los PDF
-- y recibos. La barra de módulos y la del portal lo meten en un cuadro de 36 px, donde un lockup horizontal
-- se ve ilegible. `logo_iso_url` guarda la versión cuadrada (isotipo) para esos lugares; cuando falta, el
-- cliente cae a `logo_url` y, si tampoco carga, al logo genérico de NavShell.

alter table control_obra.empresas add column if not exists logo_iso_url text;

comment on column control_obra.empresas.logo_iso_url is
  'Logotipo cuadrado (isotipo) para la barra y avatares; logo_url es el completo (horizontal) de PDF y recibos.';

-- La vista de public lleva lista explícita de columnas: hay que recrearla al agregar una.
-- La columna nueva va AL FINAL: «create or replace view» sólo admite añadir columnas después de las
-- existentes (si se intercala, falla con «cannot change name of view column»), y así se conservan los grants.
create or replace view public.empresas with (security_invoker = true) as
  select id, nombre, razon_social, rfc, direccion, telefono, email, logo_url, sitio_web, plan,
         activo, max_usuarios, max_obras, fecha_vencimiento, created_at, updated_at, codigo_invitacion,
         regimen_fiscal, codigo_postal, ciudad, estado, representante_legal, giro, descripcion,
         facebook, instagram, linkedin, registro_patronal, baja_solicitada_at, baja_programada_at,
         onboarding_completado_at, activada_at, datos_pago, logo_iso_url
    from control_obra.empresas;

-- El portal del cliente necesita el isotipo para su barra (US-618).
create or replace function control_obra.portal_payload(p_obra_id integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'control_obra', 'public'
as $function$
declare v_o record; v_e record;
begin
  select * into v_o from control_obra.obras where id = p_obra_id;
  if v_o.id is null then return jsonb_build_object('error','obra_no_encontrada'); end if;
  select * into v_e from control_obra.empresas where id = v_o.empresa_id;
  return jsonb_build_object(
    'obra', jsonb_build_object('id', v_o.id, 'nombre', v_o.nombre_obra, 'codigo', v_o.codigo_obra, 'ubicacion', v_o.ubicacion, 'estatus', v_o.estatus,
      'fecha_inicio', v_o.fecha_inicio, 'fecha_fin', v_o.fecha_fin_estimada, 'avance', v_o.avance_porcentaje,
      'cliente', coalesce((select c.nombre from control_obra.clientes c where c.id = v_o.cliente_id), v_o.cliente), 'contrato', v_o.presupuesto_total),
    'empresa', jsonb_build_object('nombre', v_e.nombre, 'telefono', v_e.telefono, 'email', v_e.email, 'logo_url', v_e.logo_url,
      'logo_iso_url', v_e.logo_iso_url, 'sitio_web', v_e.sitio_web, 'datos_pago', v_e.datos_pago),
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

-- Supernova: el logotipo horizontal para PDF y recibos, el isotipo para las barras.
update control_obra.empresas
   set logo_url = 'img/marca/empresa-1-horizontal.png',
       logo_iso_url = 'img/marca/empresa-1.png'
 where id = 1;
