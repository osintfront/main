-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 10 — a pin per alerted place; manual alert timer
--
-- 1. Each cluster carries the point of every alerted area (area_points),
--    so the map can mark each place, not just the cluster's centre.
-- 2. A manually published red-alert event counts as an alert at the moment
--    it is published (not the form's event time), so publishing restarts
--    the cluster's 10-minute timer in full.
-- ════════════════════════════════════════════════════════════════════

alter table public.hfc_clusters add column area_points jsonb not null default '[]'::jsonb;
grant select (area_points) on public.hfc_clusters to anon, authenticated;

create or replace function public.hfc_refresh_cluster(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_areas    text[];
  v_geom     extensions.geometry;
  v_names_en text[];
  v_zones_he text[];
  v_zones_en text[];
  v_points   jsonb;
  v_pt       extensions.geometry;
begin
  select areas into v_areas from public.hfc_clusters where id = p_id;
  if v_areas is null then return; end if;

  select extensions.st_multi(extensions.st_collectionextract(
           extensions.st_union(extensions.st_buffer(a.geom, 0.0004)), 3))
    into v_geom
  from public.hfc_areas a
  where a.name = any (v_areas) and a.geom is not null;

  select array_agg(coalesce(a.name_en, u.n) order by u.o) into v_names_en
  from unnest(v_areas) with ordinality u(n, o)
  left join public.hfc_areas a on a.name = u.n;

  select coalesce(array_agg(z.zone_he order by z.first_o), '{}'), coalesce(array_agg(z.zone_en order by z.first_o), '{}')
    into v_zones_he, v_zones_en
  from (
    select a.zone_he, max(a.zone_en) as zone_en, min(u.o) as first_o
    from unnest(v_areas) with ordinality u(n, o)
    join public.hfc_areas a on a.name = u.n
    where a.zone_he is not null
    group by a.zone_he
  ) z;

  -- One point per alerted area: the published locality point, else a point inside its polygon.
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', a.name,
           'name_en', a.name_en,
           'lat', round(coalesce(a.latitude, extensions.st_y(extensions.st_pointonsurface(a.geom)))::numeric, 5),
           'lng', round(coalesce(a.longitude, extensions.st_x(extensions.st_pointonsurface(a.geom)))::numeric, 5))
         order by u.o), '[]'::jsonb)
    into v_points
  from unnest(v_areas) with ordinality u(n, o)
  join public.hfc_areas a on a.name = u.n
  where a.latitude is not null or a.geom is not null;

  if v_geom is not null and not extensions.st_isempty(v_geom) then
    v_pt := extensions.st_pointonsurface(v_geom);
  else
    v_geom := null;
  end if;

  update public.hfc_clusters set
    geom        = v_geom,
    geojson     = case when v_geom is null then null
                       else extensions.st_asgeojson(extensions.st_simplifypreservetopology(v_geom, 0.0002), 5)::jsonb end,
    center_lat  = extensions.st_y(v_pt),
    center_lng  = extensions.st_x(v_pt),
    areas_en    = coalesce(v_names_en, '{}'),
    zones_he    = v_zones_he,
    zones_en    = v_zones_en,
    area_points = v_points,
    updated_at  = now()
  where id = p_id;
end;
$$;
revoke execute on function public.hfc_refresh_cluster(uuid) from public, anon, authenticated;

create or replace view public.active_hfc_alerts
with (security_invoker = true, security_barrier = true)
as
select id, threat, started_at, last_alert_at, expires_at, areas, areas_en, zones_he, zones_en,
       alert_count, geojson, center_lat, center_lng, area_points
from public.hfc_clusters
where merged_into is null and expires_at > now();
grant select on public.active_hfc_alerts to anon, authenticated;

-- Manual red alert = an alert at the moment of publication.
create or replace function public.events_hfc_alert()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_threat integer;
  v_area   text;
begin
  if new.status <> 'published' or new.deleted_at is not null or cardinality(new.hfc_areas) = 0 then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' and old.deleted_at is null
     and old.hfc_areas is not distinct from new.hfc_areas then
    return null;
  end if;

  v_threat := public.hfc_guess_threat(concat_ws(' ', new.title, new.description, new.original_report_text));
  foreach v_area in array new.hfc_areas loop
    if tg_op = 'UPDATE' and old.status = 'published' and old.deleted_at is null and v_area = any (old.hfc_areas) then
      continue;
    end if;
    perform public.hfc_record_alert(v_area, v_threat, now(), false, 'event:' || new.id);
  end loop;
  update public.hfc_alerts set event_id = new.id where source = 'event:' || new.id and event_id is null;
  return null;
end;
$$;
revoke execute on function public.events_hfc_alert() from public, anon, authenticated;

-- Fill area_points for clusters that are still on the map.
do $$
declare r record;
begin
  for r in select id from public.hfc_clusters where merged_into is null and expires_at > now() loop
    perform public.hfc_refresh_cluster(r.id);
  end loop;
  update public.hfc_pulse set changed_at = now() where id = 1;
end $$;

-- 3. A red-alert event with no pin (place not in the gazetteer, e.g. "מצובה")
--    or only a region/country-level guess takes the matched alert area's own
--    point, so it can be published and sits at the right place in the archive.
create or replace function public.events_lifecycle()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_hfc boolean;
  v_lat double precision;
  v_lng double precision;
begin
  if auth.uid() is not null then
    new.expired_at := case when tg_op = 'UPDATE' then old.expired_at else null end;
  end if;
  if new.status <> 'archived' then
    new.expired_at := null;
  end if;

  select c.slug = 'home-front-alerts' into v_hfc from public.event_categories c where c.id = new.category_id;
  if coalesce(v_hfc, false) then
    new.is_breaking := true;
    if tg_op = 'INSERT'
       or (new.location_name, new.city, new.latitude, new.longitude, new.category_id)
          is distinct from (old.location_name, old.city, old.latitude, old.longitude, old.category_id) then
      new.hfc_areas := public.hfc_match_areas(new.location_name, new.city, new.latitude, new.longitude, new.location_precision);
    elsif auth.uid() is not null then
      new.hfc_areas := old.hfc_areas;
    end if;
    if cardinality(new.hfc_areas) > 0
       and (new.latitude is null or new.longitude is null or coalesce(new.location_precision, 'country') in ('region', 'country')) then
      select coalesce(a.latitude, extensions.st_y(extensions.st_pointonsurface(a.geom))),
             coalesce(a.longitude, extensions.st_x(extensions.st_pointonsurface(a.geom)))
        into v_lat, v_lng
      from public.hfc_areas a where a.name = new.hfc_areas[1];
      if v_lat is not null then
        new.latitude := round(v_lat::numeric, 6);
        new.longitude := round(v_lng::numeric, 6);
        new.location_precision := 'city';
      end if;
    end if;
  else
    new.hfc_areas := '{}';
  end if;
  return new;
end;
$$;
revoke execute on function public.events_lifecycle() from public, anon, authenticated;

update public.events
   set location_precision = null, latitude = null, longitude = null
 where cardinality(hfc_areas) > 0 and location_precision in ('region', 'country');
