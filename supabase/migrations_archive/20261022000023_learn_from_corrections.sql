-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 23 — learning from editors' corrections
--
-- Places: when an editor moves an event's pin, the place name is remembered
-- with the corrected position (learned_places). If the editor also renamed
-- the place, only the new name is learned (the old one was just wrong). From
-- then on every new report naming that place — from any feed — is put at
-- the corrected position, before and after the AI editor places it.
-- Only specific places are learned (not regions/countries), so a correction
-- of one event in "South Lebanon" never moves all of South Lebanon.
--
-- Categories: when an editor changes the category the AI chose, the case is
-- kept (category_corrections). The classifier and the news agents get the
-- latest corrections as examples to follow.
--
-- Editors can review and delete what was learned in Admin → Learning.
-- ════════════════════════════════════════════════════════════════════

create table public.learned_places (
  id               uuid primary key default gen_random_uuid(),
  name_norm        text not null unique check (name_norm <> ''),
  name             text not null,                 -- the name as the reports wrote it
  location_name    text not null default '',      -- the place the editor set
  country          text not null default '',
  latitude         numeric(9, 6) not null check (latitude between -90 and 90),
  longitude        numeric(9, 6) not null check (longitude between -180 and 180),
  times_corrected  integer not null default 1,
  times_used       integer not null default 0,
  last_used_at     timestamptz,
  learned_from     uuid references public.events (id) on delete set null,
  learned_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.category_corrections (
  id          bigserial primary key,
  event_id    uuid references public.events (id) on delete set null,
  text        text not null,
  from_slug   text not null,
  to_slug     text not null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index category_corrections_created_idx on public.category_corrections (created_at desc);

alter table public.learned_places enable row level security;
alter table public.category_corrections enable row level security;
revoke all on public.learned_places, public.category_corrections from anon, authenticated;
grant select, delete on public.learned_places, public.category_corrections to authenticated;
create policy "learned places: staff read" on public.learned_places for select to authenticated
  using ((select public.has_permission('dashboard.view')));
create policy "learned places: managers delete" on public.learned_places for delete to authenticated
  using ((select public.has_permission('settings.manage')));
create policy "category corrections: staff read" on public.category_corrections for select to authenticated
  using ((select public.has_permission('dashboard.view')));
create policy "category corrections: managers delete" on public.category_corrections for delete to authenticated
  using ((select public.has_permission('settings.manage')));

-- Learned position for a place name (Hebrew name first, then the English one).
create or replace function public.learned_place(p_name text, p_name_en text default null)
returns public.learned_places language plpgsql stable set search_path = '' as $$
declare
  v_try text;
  v_row public.learned_places;
begin
  foreach v_try in array array[
    public.normalize_place(p_name),
    case when public.normalize_place(p_name) ~ '^[הבלמו][א-ת]{2}' then substr(public.normalize_place(p_name), 2) end,
    public.normalize_place(p_name_en)
  ] loop
    continue when v_try is null or v_try = '';
    select * into v_row from public.learned_places where name_norm = v_try;
    if found then return v_row; end if;
  end loop;
  return null;
end;
$$;

-- A name is "specific" unless the gazetteer knows it as a region or a country.
create or replace function public.is_specific_place(p_name text)
returns boolean language sql stable set search_path = '' as $$
  select public.normalize_place(p_name) <> ''
     and coalesce((public.lookup_place(p_name)).kind, 'city') = 'city';
$$;

-- ─── Apply: automated writes only (feeds, AI editor, cron) ─────────
-- Runs last among the BEFORE triggers, so it also wins over automatic placing.
create or replace function public.events_apply_learned_place()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_hit  public.learned_places;
  v_ids  uuid[] := '{}';
begin
  if auth.uid() is not null then return new; end if;  -- a person set this: keep it
  if tg_op = 'UPDATE'
     and new.location_name is not distinct from old.location_name
     and new.locations is not distinct from old.locations
     and (new.latitude, new.longitude) is not distinct from (old.latitude, old.longitude) then
    return new;
  end if;

  -- Every pin of the event.
  if jsonb_typeof(new.locations) = 'array' and jsonb_array_length(new.locations) > 0 then
    select coalesce(jsonb_agg(
             case when lp.id is not null
                  then e.item || jsonb_build_object('lat', lp.latitude, 'lng', lp.longitude, 'precision', 'exact', 'learned', true)
                  else e.item end
             order by e.ord),
           '[]'::jsonb),
           coalesce(array_agg(lp.id) filter (where lp.id is not null), '{}')
      into new.locations, v_ids
    from jsonb_array_elements(new.locations) with ordinality e(item, ord)
    left join lateral (select (public.learned_place(e.item ->> 'name', e.item ->> 'name_en')).*) lp on true;
  end if;

  -- The main pin.
  v_hit := public.learned_place(new.location_name, new.ai_suggestions ->> 'place_en');
  if v_hit.id is not null then
    new.latitude := v_hit.latitude;
    new.longitude := v_hit.longitude;
    new.location_precision := 'exact';
    new.geocoding_confidence := 0.95;
    if coalesce(new.country, '') = '' and v_hit.country <> '' then new.country := v_hit.country; end if;
    new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
      'location_resolution', jsonb_build_object('method', 'learned', 'matched_on', new.location_name,
                                                 'place', v_hit.location_name, 'resolved_at', now()));
    v_ids := v_ids || v_hit.id;
  end if;

  if cardinality(v_ids) > 0 then
    update public.learned_places set times_used = times_used + 1, last_used_at = now() where id = any (v_ids);
  end if;
  return new;
end;
$$;
create trigger events_zzz_learned_place before insert or update on public.events
  for each row execute function public.events_apply_learned_place();

-- ─── Learn: a person corrected the pin or the category ─────────────
create or replace function public.events_learn_from_correction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_key   text;
  v_from  text;
  v_to    text;
begin
  if v_uid is null or new.deleted_at is not null then return null; end if;

  -- Place: pin moved by more than ~300 m on an event the system had placed on a specific place.
  if old.latitude is not null and new.latitude is not null
     and (abs(new.latitude - old.latitude) > 0.003 or abs(new.longitude - old.longitude) > 0.003)
     and coalesce(old.location_precision, 'exact') in ('exact', 'city') then
    -- Same place name, wrong position → remember the name (and its English form) at the new spot.
    -- Renamed to another place → the old name was simply wrong; remember only the new name.
    foreach v_key in array case
        when public.normalize_place(new.location_name) = public.normalize_place(old.location_name)
          then array[old.location_name, old.ai_suggestions ->> 'place_en']
        else array[new.location_name]
      end loop
      continue when v_key is null or btrim(v_key) = '' or not public.is_specific_place(v_key);
      insert into public.learned_places as lp (name_norm, name, location_name, country, latitude, longitude, learned_from, learned_by)
      values (public.normalize_place(v_key), left(v_key, 200), left(coalesce(new.location_name, ''), 200),
              left(coalesce(new.country, ''), 100), new.latitude, new.longitude, new.id, v_uid)
      on conflict (name_norm) do update
        set latitude = excluded.latitude, longitude = excluded.longitude,
            location_name = excluded.location_name, country = excluded.country,
            times_corrected = lp.times_corrected + 1, learned_from = excluded.learned_from,
            learned_by = excluded.learned_by, updated_at = now();
    end loop;
  end if;

  -- Category: changed away from what the AI chose.
  if new.category_id is distinct from old.category_id and old.category_id is not null and new.category_id is not null
     and coalesce(old.ai_suggestions ->> 'source', '') <> '' then
    select slug into v_from from public.event_categories where id = old.category_id;
    select slug into v_to from public.event_categories where id = new.category_id;
    if v_from is not null and v_to is not null and v_from <> v_to then
      insert into public.category_corrections (event_id, text, from_slug, to_slug, created_by)
      values (new.id, left(regexp_replace(coalesce(nullif(old.original_report_text, ''), old.title), '\s+', ' ', 'g'), 400),
              v_from, v_to, v_uid);
      delete from public.category_corrections
      where id in (select id from public.category_corrections order by created_at desc offset 300);
    end if;
  end if;
  return null;
end;
$$;
create trigger events_learn_from_correction after update on public.events
  for each row execute function public.events_learn_from_correction();

revoke execute on function public.events_apply_learned_place(), public.events_learn_from_correction() from public, anon, authenticated;
revoke execute on function public.learned_place(text, text), public.is_specific_place(text) from public, anon;
