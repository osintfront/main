-- Two map layers:
--  control_areas — areas of control / presence (Israel in Lebanon and Syria, Yemen, Gaza…), copied
--    once a day from a public Google My Maps war map (event-agent action "control_sync").
--  lebanon_sects — Lebanese villages and towns by religious community, from Wikipedia's
--    "… communities in Lebanon" categories (event-agent action "sects_sync").
-- Members read both; only the server writes.
create table if not exists public.control_areas (
  id          text primary key,              -- hash of folder + name + geometry
  region      text not null,                 -- lebanon / syria / yemen / gaza
  name        text not null,
  kind        text not null check (kind in ('polygon', 'line')),
  color       text not null,                 -- #RRGGBB, as in the source map
  geometry    jsonb not null,                -- GeoJSON geometry
  folder      text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists control_areas_region_idx on public.control_areas (region);

create table if not exists public.lebanon_sects (
  title    text primary key,                 -- English Wikipedia article
  name_en  text not null,
  name_he  text,
  name_ar  text,
  lat      double precision not null,
  lng      double precision not null,
  sects    text[] not null,                  -- shia / sunni / druze / maronite / orthodox / melkite / armenian / alawite / christian
  updated_at timestamptz not null default now()
);

create table if not exists public.layer_sync (
  layer      text primary key,
  synced_at  timestamptz not null default now(),
  changed_at timestamptz,
  items      integer,
  source     text,
  detail     text
);

alter table public.control_areas enable row level security;
alter table public.lebanon_sects enable row level security;
alter table public.layer_sync enable row level security;
revoke all on public.control_areas, public.lebanon_sects, public.layer_sync from anon;
grant select on public.control_areas, public.lebanon_sects, public.layer_sync to authenticated;
drop policy if exists "control: members read" on public.control_areas;
create policy "control: members read" on public.control_areas for select to authenticated using ((select public.is_member()));
drop policy if exists "sects: members read" on public.lebanon_sects;
create policy "sects: members read" on public.lebanon_sects for select to authenticated using ((select public.is_member()));
drop policy if exists "layer sync: members read" on public.layer_sync;
create policy "layer sync: members read" on public.layer_sync for select to authenticated using ((select public.is_member()));
