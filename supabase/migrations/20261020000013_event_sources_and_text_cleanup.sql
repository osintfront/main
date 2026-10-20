-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 13 — additional sources; clean report text
--
-- 1. events.sources: further sources that reported the same event
--    ([{name, url, at}]). A repeat report that adds nothing new is recorded
--    here instead of being pasted into the description (see the
--    whatsapp-ingest Edge Function). Public, like source_name/source_url.
-- 2. Report text is normalised on every write: trailing spaces and
--    invisible direction marks at line ends removed, runs of blank lines
--    collapsed to a single blank line, leading/trailing blank lines trimmed.
--    Existing events are cleaned too.
-- ════════════════════════════════════════════════════════════════════

alter table public.events
  add column sources jsonb not null default '[]'::jsonb
  check (jsonb_typeof(sources) = 'array');
grant select (sources) on public.events to anon;

create or replace function public.normalize_report_text(p text)
returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(
           regexp_replace(
             regexp_replace(coalesce(p, ''), '[ \t\r ​‎‏‪-‮⁦-⁩]+(\n|$)', '\1', 'g'),
             '\n{3,}', E'\n\n', 'g'),
           E' \n\t');
$$;

-- Lifecycle trigger (from migration 10) + text normalisation.
create or replace function public.events_lifecycle()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_hfc boolean;
  v_lat double precision;
  v_lng double precision;
begin
  new.description := public.normalize_report_text(new.description);

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

-- Public views gain the sources column (appended, so existing columns keep their order).
create or replace view public.published_events
with (security_invoker = true, security_barrier = true)
as
select
  e.id, e.title, e.description, e.severity, e.latitude, e.longitude,
  e.location_name, e.country, e.region, e.city,
  e.source_name, e.source_url, e.source_type,
  e.occurred_at, e.published_at, e.updated_at,
  e.is_breaking, e.is_verified, e.translations, e.category_id,
  c.slug as category_slug, c.name as category_name, c.icon as category_icon,
  c.color as category_color, c.marker_color as category_marker_color,
  e.location_precision, e.sources
from public.events e
left join public.event_categories c on c.id = e.category_id and c.is_active
where e.status = 'published'
  and e.deleted_at is null
  and e.latitude is not null
  and e.longitude is not null
  and cardinality(e.hfc_areas) = 0;

create or replace view public.archived_events
with (security_invoker = true, security_barrier = true)
as
select
  e.id, e.title, e.description, e.severity, e.latitude, e.longitude,
  e.location_name, e.country, e.region, e.city,
  e.source_name, e.source_url, e.source_type,
  e.occurred_at, e.published_at, e.updated_at,
  e.is_breaking, e.is_verified, e.translations, e.category_id,
  c.slug as category_slug, c.name as category_name, c.icon as category_icon,
  c.color as category_color, c.marker_color as category_marker_color,
  e.location_precision, e.expired_at, e.sources
from public.events e
left join public.event_categories c on c.id = e.category_id and c.is_active
where e.status = 'archived'
  and e.expired_at is not null
  and e.deleted_at is null
  and e.latitude is not null
  and e.longitude is not null;

-- ─── Existing data ─────────────────────────────────────────────────
-- Earlier merges pasted "מקור נוסף (<source>, HH:MM): <text>" into the
-- description. Those reports carried new facts, so their text stays as an
-- "עדכון" (update) without the repeated header line; the source moves to
-- the sources list; source_name keeps only the original source.
do $$
declare
  r       record;
  parts   text[];
  v_desc  text;
  v_src   jsonb;
  v_label text;
  v_time  text;
  v_body  text;
  i       int;
begin
  for r in select id, description, source_name, occurred_at from public.events where description like '%מקור נוסף (%' loop
    parts := string_to_array(r.description, E'\n\nמקור נוסף (');
    v_desc := parts[1];
    v_src := '[]'::jsonb;
    for i in 2 .. coalesce(array_length(parts, 1), 1) loop
      v_label := btrim(split_part(parts[i], ',', 1));
      v_time  := substring(parts[i] from '^[^)]*?(\d{1,2}:\d{2})\)');
      v_body  := regexp_replace(parts[i], '^[^)]*\):\s*', '');
      -- Drop a short header line ("סוריה") that only repeats the report's region.
      v_body  := regexp_replace(v_body, '^[^\n.:]{1,30}\n\s*\n', '');
      v_body  := regexp_replace(v_body, '^[\s-]+', '');
      v_desc  := v_desc || E'\n\nעדכון' || coalesce(' (' || v_time || ')', '') || ': ' || v_body;
      v_src   := v_src || jsonb_build_object(
                   'name', v_label,
                   'url', substring(v_body from 'https?://[^\s<>"'']+'),
                   'at', case when v_time is not null
                              then to_jsonb(((r.occurred_at at time zone 'Asia/Jerusalem')::date + v_time::time) at time zone 'Asia/Jerusalem')
                         end);
    end loop;
    update public.events
       set description = v_desc,
           sources     = sources || v_src,
           source_name = btrim(split_part(source_name, ' | ', 1))
     where id = r.id;
  end loop;
end $$;

-- Clean every description (the trigger normalises on write).
update public.events
   set description = public.normalize_report_text(description)
 where description is distinct from public.normalize_report_text(description);
