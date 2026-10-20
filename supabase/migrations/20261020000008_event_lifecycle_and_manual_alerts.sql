-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 8 — event lifetime, public archive, manual red alerts
--
-- 1. Manual red alerts: a published event in the "home-front-alerts" category
--    is matched to Home Front Command alert areas (by name, Hebrew/English,
--    gazetteer aliases such as Akko → Acre, or by its coordinates) and fed
--    into the same alert clusters as the live feed — so it is drawn as the
--    official polygon, merges with neighbouring alerts and disappears 10
--    minutes after the last alert. Events matched this way are not shown as
--    pins (the polygon replaces them).
-- 2. Every red-alert event is always breaking.
-- 3. Lifetime: published events leave the live map 24 hours after the event
--    time (red-alert events after 10 minutes) and move to status "archived"
--    with expired_at set. The public archive (archived_events view) lists
--    only events that expired this way — never ones staff archived by hand.
-- ════════════════════════════════════════════════════════════════════

-- ─── Settings ──────────────────────────────────────────────────────
insert into public.app_settings (key, value) values
  ('event_lifetime', '{"enabled": true, "hours": 24}')
on conflict (key) do nothing;

-- ─── Columns ───────────────────────────────────────────────────────
alter table public.events
  add column expired_at timestamptz,
  add column hfc_areas  text[] not null default '{}';
create index events_expiry_idx on public.events (occurred_at) where status = 'published' and deleted_at is null;
create index events_archive_idx on public.events (occurred_at desc) where status = 'archived' and expired_at is not null;

grant select (expired_at, hfc_areas) on public.events to anon;

alter table public.hfc_alerts add column event_id uuid references public.events (id) on delete set null;

-- Normalised names for fast matching (full name and the city part before " - ").
alter table public.hfc_areas
  add column names_norm text[] generated always as (array[
    public.normalize_place(name), public.normalize_place(coalesce(name_en, '')),
    public.normalize_place(coalesce(name_ar, '')), public.normalize_place(coalesce(name_ru, ''))]) stored,
  add column base_norm text[] generated always as (array[
    public.normalize_place(split_part(name, ' - ', 1)),
    public.normalize_place(split_part(coalesce(name_en, ''), ' - ', 1))]) stored;
create index hfc_areas_names_norm_idx on public.hfc_areas using gin (names_norm);
create index hfc_areas_base_norm_idx on public.hfc_areas using gin (base_norm);

-- ─── Matching an event's place to alert areas ──────────────────────
create or replace function public.hfc_match_areas(
  p_location text, p_city text, p_lat numeric, p_lng numeric, p_precision text
)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cands text[];
  v_c     text;
  v_n     text;
  v_try   text;
  v_hit   text[];
  v_found text[] := '{}';
  v_place public.place_gazetteer;
  v_pt    extensions.geometry;
begin
  -- Whole place name, city, then each comma/slash-separated part ("עכו, נהריה").
  v_cands := array[p_location, p_city]
    || coalesce((select array_agg(x) from regexp_split_to_table(coalesce(p_location, ''), '\s*[,،;|/]\s*') x), '{}');

  foreach v_c in array v_cands loop
    v_n := public.normalize_place(coalesce(v_c, ''));
    continue when char_length(v_n) < 2;
    -- Also without one Hebrew prefix letter: "בעכו" → "עכו".
    foreach v_try in array array[v_n, case when v_n ~ '^[הבלמו][א-ת]{2}' then substr(v_n, 2) end] loop
      continue when v_try is null;
      select coalesce(array_agg(a.name), '{}') into v_hit from public.hfc_areas a where a.names_norm @> array[v_try];
      if cardinality(v_hit) = 0 then
        -- A city split into several alert areas: "תל אביב" → "תל אביב - מרכז העיר", …
        select coalesce(array_agg(a.name), '{}') into v_hit from public.hfc_areas a where a.base_norm @> array[v_try];
      end if;
      if cardinality(v_hit) = 0 then
        -- Known alias from the place gazetteer: "Akko" → Acre / עכו.
        v_place := public.lookup_place(v_try);
        if v_place.id is not null then
          select coalesce(array_agg(a.name), '{}') into v_hit
          from public.hfc_areas a
          where a.names_norm && (v_place.names_norm || public.normalize_place(v_place.canonical));
        end if;
      end if;
      if cardinality(v_hit) > 0 then
        v_found := v_found || v_hit;
        exit;
      end if;
    end loop;
  end loop;

  -- No name matched: use the pin itself, if it is precise (inside or within 1 km of an area).
  if cardinality(v_found) = 0 and p_lat is not null and p_lng is not null
     and coalesce(p_precision, 'exact') in ('exact', 'city') then
    v_pt := extensions.st_setsrid(extensions.st_makepoint(p_lng::float8, p_lat::float8), 4326);
    select coalesce(array_agg(n), '{}') into v_found from (
      select a.name as n
      from public.hfc_areas a
      where extensions.st_dwithin(a.geom::extensions.geography, v_pt::extensions.geography, 1000)
      order by extensions.st_distance(a.geom::extensions.geography, v_pt::extensions.geography)
      limit 1
    ) s;
  end if;

  return array(select distinct x from unnest(v_found) x order by 1);
end;
$$;

revoke execute on function public.hfc_match_areas(text, text, numeric, numeric, text) from public, anon, authenticated;

-- Threat type from the report text (defaults to rockets/missiles).
create or replace function public.hfc_guess_threat(p_text text)
returns integer
language sql immutable set search_path = '' as $$
  select case
    when t ~* '(כטב["״'']?ם|כלי טיס|רחפן|drone|uav|hostile aircraft)' then 5
    when t ~* '(מחבלים|חדירת|infiltrat)'                               then 2
    when t ~* '(רעידת אדמה|earthquake)'                                then 3
    when t ~* '(צונאמי|tsunami)'                                       then 4
    when t ~* '(חומרים מסוכנים|חומ["״]ס|hazardous)'                    then 1
    when t ~* '(רדיולוג|radiolog)'                                     then 6
    when t ~* '(בלתי קונבנציונ|non.?conventional|unconventional)'      then 7
    else 0
  end
  from (select coalesce(p_text, '') as t) x;
$$;

revoke execute on function public.hfc_guess_threat(text) from public, anon, authenticated;

-- ─── Lifecycle trigger (after location resolution, before the guards) ──
create or replace function public.events_lifecycle()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_hfc boolean;
begin
  -- expired_at is set only by the expiry job.
  if auth.uid() is not null then
    new.expired_at := case when tg_op = 'UPDATE' then old.expired_at else null end;
  end if;
  if new.status <> 'archived' then
    new.expired_at := null;
  end if;

  select c.slug = 'home-front-alerts' into v_hfc from public.event_categories c where c.id = new.category_id;
  if coalesce(v_hfc, false) then
    new.is_breaking := true;                     -- red alerts are always breaking
    if tg_op = 'INSERT'
       or (new.location_name, new.city, new.latitude, new.longitude, new.category_id)
          is distinct from (old.location_name, old.city, old.latitude, old.longitude, old.category_id) then
      new.hfc_areas := public.hfc_match_areas(new.location_name, new.city, new.latitude, new.longitude, new.location_precision);
    elsif auth.uid() is not null then
      new.hfc_areas := old.hfc_areas;   -- clients can't set it; server maintenance can
    end if;
  else
    new.hfc_areas := '{}';
  end if;
  return new;
end;
$$;
revoke execute on function public.events_lifecycle() from public, anon, authenticated;

-- "events_b_…" runs after events_a_resolve_location and before events_before_*.
create trigger events_b_lifecycle before insert or update on public.events
  for each row execute function public.events_lifecycle();

-- ─── Publishing a red-alert event feeds the alert clusters ─────────
create or replace function public.events_hfc_alert()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ttl    interval;
  v_at     timestamptz;
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

  select make_interval(mins => greatest(1, coalesce((value ->> 'ttl_minutes')::integer, 10)))
    into v_ttl from public.app_settings where key = 'hfc_alerts';
  v_ttl := coalesce(v_ttl, interval '10 minutes');
  -- The alert counts from the event time when that is recent, otherwise from now.
  v_at := case when new.occurred_at between now() - v_ttl and now() then new.occurred_at else now() end;
  v_threat := public.hfc_guess_threat(concat_ws(' ', new.title, new.description, new.original_report_text));

  foreach v_area in array new.hfc_areas loop
    -- On an edit, only areas that were not there before.
    if tg_op = 'UPDATE' and old.status = 'published' and old.deleted_at is null and v_area = any (old.hfc_areas) then
      continue;
    end if;
    perform public.hfc_record_alert(v_area, v_threat, v_at, false, 'event:' || new.id);
  end loop;
  update public.hfc_alerts set event_id = new.id where source = 'event:' || new.id and event_id is null;
  return null;
end;
$$;
revoke execute on function public.events_hfc_alert() from public, anon, authenticated;

create trigger events_z_hfc_alert after insert or update on public.events
  for each row execute function public.events_hfc_alert();

-- ─── Expiry: live map → archive ────────────────────────────────────
create or replace function public.expire_events()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg   jsonb;
  v_hours integer;
  v_ttl   interval;
  v_n     integer;
begin
  select value into v_cfg from public.app_settings where key = 'event_lifetime';
  if not coalesce((v_cfg ->> 'enabled')::boolean, true) then return 0; end if;
  v_hours := greatest(1, coalesce((v_cfg ->> 'hours')::integer, 24));
  select make_interval(mins => greatest(1, coalesce((value ->> 'ttl_minutes')::integer, 10)))
    into v_ttl from public.app_settings where key = 'hfc_alerts';
  v_ttl := coalesce(v_ttl, interval '10 minutes');

  update public.events e
     set status = 'archived', expired_at = now()
    from (
      select e2.id
      from public.events e2
      left join public.event_categories c on c.id = e2.category_id
      where e2.status = 'published' and e2.deleted_at is null
        and case when c.slug = 'home-front-alerts'
                 then greatest(e2.occurred_at, coalesce(e2.published_at, e2.occurred_at)) + v_ttl
                 else e2.occurred_at + make_interval(hours => v_hours)
            end < now()
      order by e2.occurred_at
      limit 500
    ) x
   where e.id = x.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.expire_events() from public, anon, authenticated;

-- ─── Public read surface ───────────────────────────────────────────
-- Live map: red-alert events that became polygons are not shown as pins.
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
  e.location_precision
from public.events e
left join public.event_categories c on c.id = e.category_id and c.is_active
where e.status = 'published'
  and e.deleted_at is null
  and e.latitude is not null
  and e.longitude is not null
  and cardinality(e.hfc_areas) = 0;

-- Archive: events that expired from the live map (not ones staff pulled by hand).
create policy "events: public archive" on public.events for select to anon, authenticated
  using (status = 'archived' and expired_at is not null and deleted_at is null);

create view public.archived_events
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
  e.location_precision, e.expired_at
from public.events e
left join public.event_categories c on c.id = e.category_id and c.is_active
where e.status = 'archived'
  and e.expired_at is not null
  and e.deleted_at is null
  and e.latitude is not null
  and e.longitude is not null;
revoke all on public.archived_events from anon, authenticated;
grant select on public.archived_events to anon, authenticated;

-- ─── Schedule ──────────────────────────────────────────────────────
select cron.schedule('osintfront-expire-events', '* * * * *', $c$select public.expire_events()$c$);
