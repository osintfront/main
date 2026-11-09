-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 12 — merged alert shapes (display only)
--
-- Alerts stay one event per area (own card, pin and timer). For drawing,
-- the polygons of active alerts of the same threat that touch each other
-- are unioned into one continuous shape. Each shape lists the alert events
-- it covers. When an area's timer runs out it drops out of the union.
-- ════════════════════════════════════════════════════════════════════

-- Needed by the invoker-rights function below (public data: alert polygons).
grant select (geom) on public.hfc_clusters to anon, authenticated;

create or replace function public.active_hfc_shapes()
returns table (threat smallint, geojson jsonb, alert_ids uuid[])
language sql stable security invoker set search_path = '' as $$
  with a as (
    select c.id, c.threat, c.geom
    from public.hfc_clusters c
    where c.merged_into is null and c.expires_at > now() and c.geom is not null
  ),
  u as (
    -- Area polygons already carry a ~40 m buffer, so neighbours overlap and fuse.
    select a.threat, (extensions.st_dump(extensions.st_union(a.geom))).geom as g
    from a
    group by a.threat
  )
  select u.threat,
         extensions.st_asgeojson(extensions.st_simplifypreservetopology(u.g, 0.0002), 5)::jsonb,
         (select array_agg(a.id order by a.id) from a
           where a.threat = u.threat and extensions.st_intersects(a.geom, u.g))
  from u;
$$;
revoke execute on function public.active_hfc_shapes() from public;
grant execute on function public.active_hfc_shapes() to anon, authenticated;
