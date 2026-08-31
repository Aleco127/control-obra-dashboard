-- 052 · Entregables agrupados por hito (aplicada 31-ago-2026)
--
-- El cliente veia una lista plana de documentos. Ahora cada documento y cada foto
-- puede colgar del hito del programa al que pertenece, y el portal los agrupa por
-- entrega: nombre del hito, fecha, cuantos archivos trae y si ya se entrego.
-- En el programa de obra, cada hito con material publicado muestra un boton que
-- lleva a su bloque.
--
-- Lo que dejes sin actividad_id cae en "Otros documentos"; las fotos sin hito se
-- quedan en la galeria general.

alter table control_obra.documentos
  add column if not exists actividad_id integer references control_obra.actividades_programa(id) on delete set null;
alter table control_obra.fotos_obra
  add column if not exists actividad_id integer references control_obra.actividades_programa(id) on delete set null;

create index if not exists documentos_actividad_ix on control_obra.documentos (actividad_id) where actividad_id is not null;
create index if not exists fotos_obra_actividad_ix on control_obra.fotos_obra (actividad_id) where actividad_id is not null;

-- Las vistas publicas se recrean con la columna al final (cambiar el orden rompe
-- CREATE OR REPLACE con 42P16) y siempre con security_invoker.
create or replace view public.documentos with (security_invoker = true) as
 select id, obra_id, nombre, descripcion, categoria, tipo_archivo, tamano_bytes, url_archivo, version,
        fecha_documento, fecha_vencimiento, estatus, subido_por, etiquetas, notas, created_at, updated_at,
        empresa_id, visible_cliente, archivo_path, actividad_id
   from control_obra.documentos;

create or replace view public.fotos_obra with (security_invoker = true) as
 select id, obra_id, titulo, descripcion, url_foto, url_thumbnail, categoria, fecha_foto, ubicacion,
        etapa_obra, tomada_por, es_destacada, etiquetas, notas, created_at, updated_at, empresa_id, actividad_id
   from control_obra.fotos_obra;

-- control_obra.portal_payload emite ahora el id de cada actividad y el actividad_id
-- de documentos y fotos; ademas sube el tope de fotos de 24 a 60 para que ninguna
-- entrega se quede sin las suyas. Ver 052b en el historial de migraciones remoto.
