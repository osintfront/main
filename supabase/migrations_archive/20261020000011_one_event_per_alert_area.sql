-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 11 — one event per alert area
--
-- Each Home Front Command alert area is its own event: its own polygon,
-- card and 10-minute timer. A new alert in the same area (same threat)
-- restarts that area's timer; neighbouring areas are no longer merged.
-- Spatial merging can be switched back on with app_settings.hfc_alerts.merge_km > 0.
-- ════════════════════════════════════════════════════════════════════

update public.app_settings
   set value = jsonb_set(value, '{merge_km}', '0'::jsonb)
 where key = 'hfc_alerts';

create or replace function public.hfc_record_alert(
  p_area text, p_threat integer, p_at timestamptz, p_drill boolean, p_source text
)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_settings       jsonb;
  v_ttl            interval;
  v_merge_m        double precision;
  v_include_drills boolean;
  v_area           text := btrim(coalesce(p_area, ''));
  v_alert_id       bigint;
  v_geom           extensions.geometry;
  v_ids            uuid[];
  v_target         uuid;
begin
  if v_area = '' or p_at is null then return false; end if;

  select value into v_settings from public.app_settings where key = 'hfc_alerts';
  v_ttl := make_interval(mins => greatest(1, coalesce((v_settings ->> 'ttl_minutes')::integer, 10)));
  v_merge_m := greatest(0, coalesce((v_settings ->> 'merge_km')::numeric, 0)) * 1000;
  v_include_drills := coalesce((v_settings ->> 'include_drills')::boolean, false);

  insert into public.hfc_alerts (alerted_at, area_name, threat, is_drill, source)
  values (p_at, v_area, coalesce(p_threat, 8), coalesce(p_drill, false), p_source)
  on conflict (area_name, threat, alerted_at) do nothing
  returning id into v_alert_id;
  if v_alert_id is null then return false; end if;
  if coalesce(p_drill, false) and not v_include_drills then return true; end if;

  select geom into v_geom from public.hfc_areas where name = v_area;

  -- The live event of this area (same threat, within its timer).
  -- Neighbouring areas join only when spatial merging is turned on.
  select array_agg(c.id order by c.started_at, c.id) into v_ids
  from public.hfc_clusters c
  where c.threat = coalesce(p_threat, 8)
    and c.merged_into is null
    and p_at between c.started_at - v_ttl and c.last_alert_at + v_ttl
    and (case when v_merge_m > 0
              then v_area = any (c.areas)
                   or (v_geom is not null and c.geom is not null
                       and extensions.st_dwithin(c.geom::extensions.geography, v_geom::extensions.geography, v_merge_m))
              else c.areas = array[v_area]          -- only this area's own event
         end);

  if v_ids is null then
    insert into public.hfc_clusters (threat, started_at, last_alert_at, expires_at, areas, alert_count)
    values (coalesce(p_threat, 8), p_at, p_at, p_at + v_ttl, array[v_area], 1)
    returning id into v_target;
  else
    v_target := v_ids[1];
    if array_length(v_ids, 1) > 1 then
      update public.hfc_clusters t set
        areas         = (select array_agg(distinct x) from public.hfc_clusters c, unnest(c.areas) x where c.id = any (v_ids)),
        alert_count   = (select sum(c.alert_count) from public.hfc_clusters c where c.id = any (v_ids)),
        started_at    = (select min(c.started_at) from public.hfc_clusters c where c.id = any (v_ids)),
        last_alert_at = (select max(c.last_alert_at) from public.hfc_clusters c where c.id = any (v_ids))
      where t.id = v_target;
      update public.hfc_clusters set merged_into = v_target, updated_at = now() where id = any (v_ids[2:]);
      update public.hfc_alerts set cluster_id = v_target where cluster_id = any (v_ids[2:]);
    end if;
    update public.hfc_clusters set
      areas         = case when v_area = any (areas) then areas else areas || v_area end,
      alert_count   = alert_count + 1,
      started_at    = least(started_at, p_at),
      last_alert_at = greatest(last_alert_at, p_at)
    where id = v_target;
  end if;

  update public.hfc_clusters set expires_at = last_alert_at + v_ttl where id = v_target;
  update public.hfc_alerts set cluster_id = v_target where id = v_alert_id;
  perform public.hfc_refresh_cluster(v_target);
  update public.hfc_pulse set changed_at = now() where id = 1;
  return true;
end;
$$;
revoke execute on function public.hfc_record_alert(text, integer, timestamptz, boolean, text) from public, anon, authenticated;

-- Split clusters that still hold several areas into one event per area,
-- each keeping the timing of its own alerts.
create or replace function public.hfc_split_cluster(p_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_c     public.hfc_clusters;
  v_ttl   interval;
  r       record;
  v_new   uuid;
  v_first uuid;
  v_n     integer := 0;
begin
  select * into v_c from public.hfc_clusters where id = p_id;
  if v_c.id is null or cardinality(v_c.areas) < 2 then return 0; end if;
  select make_interval(mins => greatest(1, coalesce((value ->> 'ttl_minutes')::integer, 10)))
    into v_ttl from public.app_settings where key = 'hfc_alerts';
  v_ttl := coalesce(v_ttl, interval '10 minutes');

  for r in
    select a.area_name, min(a.alerted_at) as first_at, max(a.alerted_at) as last_at, count(*) as n
    from public.hfc_alerts a where a.cluster_id = p_id
    group by a.area_name order by min(a.alerted_at)
  loop
    insert into public.hfc_clusters (threat, started_at, last_alert_at, expires_at, areas, alert_count)
    values (v_c.threat, r.first_at, r.last_at, r.last_at + v_ttl, array[r.area_name], r.n)
    returning id into v_new;
    update public.hfc_alerts set cluster_id = v_new where cluster_id = p_id and area_name = r.area_name;
    perform public.hfc_refresh_cluster(v_new);
    v_first := coalesce(v_first, v_new);
    v_n := v_n + 1;
  end loop;
  update public.hfc_clusters set merged_into = v_first, updated_at = now() where id = p_id;
  update public.hfc_pulse set changed_at = now() where id = 1;
  return v_n;
end;
$$;
revoke execute on function public.hfc_split_cluster(uuid) from public, anon, authenticated;

select public.hfc_split_cluster(id)
from public.hfc_clusters
where merged_into is null and expires_at > now() and cardinality(areas) > 1;
