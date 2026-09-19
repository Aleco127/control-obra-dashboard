-- 065 · Programa de obra: el peso de cada actividad es su costo
-- Costo de una actividad (no hito): costo_planeado; si no trae, el importe de su concepto del catálogo
-- repartido entre las actividades del mismo programa que lo comparten (si alguna de ellas trae
-- costo_planeado manda ese desglose y las demás pesan 0). Es la misma regla de pgPesos() en index.html.
-- Si ningún renglón del programa tiene costo se respeta el peso capturado a mano.

create or replace function control_obra.recalcular_pesos_programa(p_programa_id bigint)
returns void
language plpgsql
security definer
set search_path = control_obra, public
as $$
begin
  if p_programa_id is null then return; end if;
  with t as (
    select a.id,
           case
             when coalesce(a.es_hito, false) then 0
             when coalesce(a.costo_planeado, 0) > 0 then a.costo_planeado
             when a.concepto_id is not null
                  and sum(greatest(coalesce(a.costo_planeado, 0), 0)) over w = 0
               then coalesce(c.importe, 0) / count(*) over w
             else 0
           end as costo
    from control_obra.actividades_programa a
    left join control_obra.catalogo_conceptos c on c.id = a.concepto_id
    where a.programa_id = p_programa_id
    window w as (partition by coalesce(a.es_hito, false), a.concepto_id)
  ), tot as (select coalesce(sum(costo), 0) as s from t)
  update control_obra.actividades_programa a
     set peso_porcentual = round(t.costo * 100 / tot.s, 2)
    from t, tot
   where t.id = a.id and tot.s > 0
     and a.peso_porcentual is distinct from round(t.costo * 100 / tot.s, 2);
end $$;

revoke all on function control_obra.recalcular_pesos_programa(bigint) from public, anon, authenticated;

-- Actividades: dispara con las columnas que mueven el costo y con peso_porcentual (un peso a mano se corrige
-- si el programa tiene costos). pg_trigger_depth() = 0 evita que el UPDATE de la propia función lo vuelva a disparar.
create or replace function control_obra.trg_actividad_pesos()
returns trigger
language plpgsql
security definer
set search_path = control_obra, public
as $$
begin
  if tg_op <> 'INSERT' then perform control_obra.recalcular_pesos_programa(old.programa_id); end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.programa_id is distinct from old.programa_id) then
    perform control_obra.recalcular_pesos_programa(new.programa_id);
  end if;
  return null;
end $$;

revoke all on function control_obra.trg_actividad_pesos() from public, anon, authenticated;

drop trigger if exists trg_actividad_pesos_iu on control_obra.actividades_programa;
create trigger trg_actividad_pesos_iu
after insert or delete or update of costo_planeado, concepto_id, es_hito, programa_id, peso_porcentual
on control_obra.actividades_programa
for each row when (pg_trigger_depth() = 0)
execute function control_obra.trg_actividad_pesos();

-- Catálogo: cambiar cantidad o precio mueve el importe y con él los pesos de los programas que lo usan
create or replace function control_obra.trg_concepto_pesos()
returns trigger
language plpgsql
security definer
set search_path = control_obra, public
as $$
declare r record;
begin
  for r in select distinct programa_id from control_obra.actividades_programa where concepto_id = new.id loop
    perform control_obra.recalcular_pesos_programa(r.programa_id);
  end loop;
  return null;
end $$;

revoke all on function control_obra.trg_concepto_pesos() from public, anon, authenticated;

drop trigger if exists trg_concepto_pesos_u on control_obra.catalogo_conceptos;
create trigger trg_concepto_pesos_u
after update of cantidad, precio_unitario on control_obra.catalogo_conceptos
for each row when (pg_trigger_depth() = 0)
execute function control_obra.trg_concepto_pesos();

-- Poner al día los programas existentes
do $$
declare r record;
begin
  for r in select id from control_obra.programas_obra loop
    perform control_obra.recalcular_pesos_programa(r.id);
  end loop;
end $$;
