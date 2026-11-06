-- 069: carpetas de documentos para el portal del cliente (6-nov-2026)
-- El cliente ve sus entregables ordenados por carpeta (p. ej. «00 Trámites y gestión», «01 Anteproyecto»,
-- «02 Proyecto ejecutivo»); el prefijo numérico sólo ordena y el portal lo oculta. La entrega del programa
-- (actividad_id) se conserva como dato secundario de cada documento.

alter table control_obra.documentos add column if not exists carpeta text;

create or replace view public.documentos with (security_invoker = true) as
 select id, obra_id, nombre, descripcion, categoria, tipo_archivo, tamano_bytes, url_archivo, version,
        fecha_documento, fecha_vencimiento, estatus, subido_por, etiquetas, notas, created_at, updated_at,
        empresa_id, visible_cliente, archivo_path, actividad_id, carpeta
   from control_obra.documentos;

-- portal_payload: igual que en la 068, más 'carpeta' en cada documento
CREATE OR REPLACE FUNCTION control_obra.portal_payload(p_obra_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control_obra', 'public'
AS $function$
declare
  v_o record; v_e record;
  v_extras numeric := 0; v_deductivas numeric := 0; v_entrega date;
begin
  select * into v_o from control_obra.obras where id = p_obra_id;
  if v_o.id is null then return jsonb_build_object('error','obra_no_encontrada'); end if;
  select * into v_e from control_obra.empresas where id = v_o.empresa_id;

  -- Modificaciones vigentes: misma regla que presupuestoObraActual() en la app
  select coalesce(sum(case when m.tipo = 'Adicional' then abs(coalesce(m.monto_modificacion,0)) else 0 end),0),
         coalesce(sum(case when m.tipo = 'Deductiva' then abs(coalesce(m.monto_modificacion,0)) else 0 end),0),
         max(m.nueva_fecha_fin)
    into v_extras, v_deductivas, v_entrega
    from control_obra.obra_modificaciones m
   where m.obra_id = v_o.id and m.estatus in ('Aprobada','Ejecutada');

  return jsonb_build_object(
    'obra', jsonb_build_object('id', v_o.id, 'nombre', v_o.nombre_obra, 'codigo', v_o.codigo_obra, 'ubicacion', v_o.ubicacion, 'estatus', v_o.estatus,
      'fecha_inicio', v_o.fecha_inicio, 'fecha_fin', v_o.fecha_fin_estimada, 'avance', v_o.avance_porcentaje, 'avance_manual', coalesce(v_o.avance_manual,false),
      'cliente', coalesce((select c.nombre from control_obra.clientes c where c.id = v_o.cliente_id), v_o.cliente),
      'contrato_original', v_o.presupuesto_total, 'extras', v_extras, 'deductivas', v_deductivas,
      'contrato', coalesce(v_o.presupuesto_total,0) + v_extras - v_deductivas,
      'fecha_entrega_vigente', coalesce(v_entrega, v_o.fecha_fin_estimada)),
    'empresa', jsonb_build_object('nombre', v_e.nombre, 'telefono', v_e.telefono, 'email', v_e.email, 'logo_url', v_e.logo_url, 'logo_iso_url', v_e.logo_iso_url, 'sitio_web', v_e.sitio_web, 'datos_pago', v_e.datos_pago),
    'cambios', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'numero', m.numero_modificacion, 'fecha', m.fecha, 'tipo', m.tipo, 'descripcion', m.descripcion,
        'monto', abs(coalesce(m.monto_modificacion,0)), 'dias', coalesce(m.dias_adicionales,0), 'nueva_fecha_fin', m.nueva_fecha_fin, 'fecha_aprobacion', m.fecha_aprobacion) order by m.fecha, m.id)
      from control_obra.obra_modificaciones m where m.obra_id = v_o.id and m.estatus in ('Aprobada','Ejecutada')), '[]'::jsonb),
    'actividades', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre, 'inicio', a.fecha_inicio, 'fin', a.fecha_fin, 'avance', a.porcentaje_avance, 'peso', a.peso_porcentual, 'hito', a.es_hito, 'responsable', a.responsable,
        'partida', cc.partida, 'estatus', a.estatus, 'inicio_real', a.fecha_inicio_real, 'fin_real', a.fecha_fin_real) order by a.fecha_inicio, a.orden)
      from control_obra.actividades_programa a join control_obra.programas_obra p on p.id = a.programa_id
      left join control_obra.catalogo_conceptos cc on cc.id = a.concepto_id
      where p.obra_id = v_o.id and coalesce(a.es_resumen,false) = false), '[]'::jsonb),
    'fotos', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'url', f.url_foto, 'thumb', f.url_thumbnail, 'titulo', f.titulo, 'descripcion', f.descripcion, 'fecha', coalesce(f.fecha_foto, f.created_at::date), 'etapa', f.etapa_obra, 'actividad_id', f.actividad_id, 'creada', f.created_at) order by coalesce(f.fecha_foto, f.created_at::date) desc, f.id desc)
      from (select * from control_obra.fotos_obra where obra_id = v_o.id and visible_cliente = true order by coalesce(fecha_foto, created_at::date) desc, id desc limit 300) f), '[]'::jsonb),
    'documentos', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nombre', d.nombre, 'descripcion', d.descripcion, 'categoria', d.categoria, 'carpeta', d.carpeta, 'tipo', d.tipo_archivo,
        'fecha', coalesce(d.fecha_documento, d.created_at::date), 'version', d.version, 'actividad_id', d.actividad_id, 'creado', d.created_at,
        'url', case when d.url_archivo ~* '^https?://' then d.url_archivo else null end,
        'tiene_archivo', d.archivo_path is not null) order by coalesce(d.fecha_documento, d.created_at::date) desc, d.id desc)
      from control_obra.documentos d where d.obra_id = v_o.id and d.visible_cliente = true and coalesce(d.estatus,'') not in ('Eliminado','Archivado')), '[]'::jsonb),
    'estimaciones', coalesce((select jsonb_agg(jsonb_build_object('numero', e.numero_estimacion, 'fecha', coalesce(e.fecha_presentacion, e.created_at::date), 'periodo_inicio', e.periodo_inicio, 'periodo_fin', e.periodo_fin, 'avance', e.porcentaje_avance, 'total', e.total, 'neto', e.neto_a_pagar, 'estatus', e.estatus) order by e.numero_estimacion desc)
      from control_obra.estimaciones e where e.obra_id = v_o.id and coalesce(e.estatus,'') not in ('Borrador','Cancelada','Rechazada')), '[]'::jsonb),
    'plan_pagos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'concepto', x.concepto, 'monto', x.monto_total, 'cobrado', x.monto_cobrado, 'vence', x.fecha_vencimiento, 'estatus', x.estatus) order by x.fecha_vencimiento)
      from control_obra.cuentas_por_cobrar x where x.obra_id = v_o.id and coalesce(x.estatus,'') <> 'Cancelada'), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'numero', p.numero_pago, 'fecha', p.fecha_pago, 'monto', p.monto, 'metodo', p.metodo_pago, 'concepto', p.concepto, 'cuenta_id', p.cuenta_cobrar_id) order by p.fecha_pago desc)
      from control_obra.pagos_recibidos p where p.obra_id = v_o.id), '[]'::jsonb),
    'cfdis', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'serie', c.serie, 'folio', c.folio, 'fecha', c.fecha_emision, 'total', c.total, 'uuid', c.uuid, 'tiene_archivo', (c.archivo_path is not null or c.pdf_url is not null)) order by c.fecha_emision desc)
      from control_obra.cfdis_emitidos c where c.obra_id = v_o.id and coalesce(c.estatus,'') <> 'Cancelado'), '[]'::jsonb),
    -- Diario de obra: SÓLO las entradas publicadas y SÓLO los campos de cara al cliente (PRD portal v2, D1)
    'bitacora', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'fecha', b.fecha, 'clima', b.clima, 'temperatura', b.temperatura,
        'resumen', coalesce(nullif(btrim(b.resumen_cliente),''), b.actividades_realizadas), 'avance', b.avance_descripcion,
        'creada', b.created_at, 'actualizada', b.updated_at) order by b.fecha desc, b.id desc)
      from (select * from control_obra.bitacora_obra where obra_id = v_o.id and visible_cliente = true order by fecha desc, id desc limit 120) b), '[]'::jsonb),
    -- Sin cuenta no hay «última visita»: el enlace de obra recibe ceros (US-602)
    'novedades', jsonb_build_object('fotos', 0, 'documentos', 0, 'diario', 0, 'pagos_vencidos', 0, 'proximo_pago_dias', null, 'ultimo_visto_at', null),
    'generado', now());
end; $function$;
