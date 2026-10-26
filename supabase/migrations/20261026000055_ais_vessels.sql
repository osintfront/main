-- Ships (AIS) for the map's ship layer: the latest position of each vessel in the region,
-- collected from aisstream.io by the ais-collector function (pg_cron, every minute).
-- Members read it; only the server writes. Positions older than 12 hours are removed.
create table if not exists public.ais_vessels (
  mmsi        bigint primary key,
  name        text,
  callsign    text,
  imo         bigint,
  ship_type   smallint,          -- AIS type code (30 fishing, 35 military, 60-69 passenger, 70-79 cargo, 80-89 tanker…)
  destination text,
  eta         text,
  length_m    smallint,
  lat         double precision not null,
  lng         double precision not null,
  sog         real,              -- speed over ground, knots
  cog         real,              -- course over ground, degrees
  heading     smallint,
  nav_status  smallint,
  updated_at  timestamptz not null default now(),
  static_at   timestamptz
);
create index if not exists ais_vessels_updated_idx on public.ais_vessels (updated_at desc);
create index if not exists ais_vessels_pos_idx on public.ais_vessels (lat, lng);

alter table public.ais_vessels enable row level security;
revoke all on public.ais_vessels from anon;
grant select on public.ais_vessels to authenticated;
drop policy if exists "ais: members read" on public.ais_vessels;
create policy "ais: members read" on public.ais_vessels for select to authenticated using ((select public.is_member()));

-- One call per batch from the collector: positions (insert or move) and ship details
-- (name, type, destination…) for ships already on the map.
create or replace function public.ais_upsert(p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0; v_m integer := 0;
begin
  insert into public.ais_vessels as v (mmsi, name, callsign, imo, ship_type, destination, eta, length_m, lat, lng, sog, cog, heading, nav_status, updated_at, static_at)
  select r.mmsi, nullif(r.name, ''), nullif(r.callsign, ''), r.imo, r.ship_type, nullif(r.destination, ''), nullif(r.eta, ''), r.length_m,
         r.lat, r.lng, r.sog, r.cog, r.heading, r.nav_status, coalesce(r.at, now()), case when r.ship_type is not null or r.name is not null then now() end
  from jsonb_to_recordset(p_rows) as r(mmsi bigint, name text, callsign text, imo bigint, ship_type smallint, destination text, eta text,
                                       length_m smallint, lat float8, lng float8, sog real, cog real, heading smallint, nav_status smallint, at timestamptz)
  where r.lat is not null and r.lng is not null and r.lat between -90 and 90 and r.lng between -180 and 180 and r.mmsi > 0
  on conflict (mmsi) do update set
    name = coalesce(excluded.name, v.name), callsign = coalesce(excluded.callsign, v.callsign), imo = coalesce(excluded.imo, v.imo),
    ship_type = coalesce(excluded.ship_type, v.ship_type), destination = coalesce(excluded.destination, v.destination),
    eta = coalesce(excluded.eta, v.eta), length_m = coalesce(excluded.length_m, v.length_m),
    lat = excluded.lat, lng = excluded.lng, sog = excluded.sog, cog = excluded.cog,
    heading = coalesce(excluded.heading, v.heading), nav_status = coalesce(excluded.nav_status, v.nav_status),
    updated_at = greatest(excluded.updated_at, v.updated_at), static_at = coalesce(excluded.static_at, v.static_at);
  get diagnostics v_n = row_count;

  update public.ais_vessels v set
    name = coalesce(nullif(r.name, ''), v.name), callsign = coalesce(nullif(r.callsign, ''), v.callsign), imo = coalesce(r.imo, v.imo),
    ship_type = coalesce(r.ship_type, v.ship_type), destination = coalesce(nullif(r.destination, ''), v.destination),
    eta = coalesce(nullif(r.eta, ''), v.eta), length_m = coalesce(r.length_m, v.length_m), static_at = now()
  from jsonb_to_recordset(p_rows) as r(mmsi bigint, name text, callsign text, imo bigint, ship_type smallint, destination text, eta text, length_m smallint, lat float8)
  where r.lat is null and v.mmsi = r.mmsi;
  get diagnostics v_m = row_count;

  -- Ships not heard from for 12 hours leave the map (about once an hour).
  if extract(minute from now()) < 1 then
    delete from public.ais_vessels where updated_at < now() - interval '12 hours';
  end if;
  return v_n + v_m;
end;
$$;
revoke execute on function public.ais_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.ais_upsert(jsonb) to service_role;
