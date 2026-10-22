-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 28 — categories, publishing, verification, AI usage
--  1. Categories: + assassination, force-sighting, statements;
--     "shooting" → small-arms fire; transportation-incident retired.
--  2. Publishing no longer needs coordinates (category + title only).
--     Events without a pin are listed in the feed only.
--  3. Public views: no coordinate filter, + media_kinds (filter by media).
--  4. Auto-verify: reported by two or more different mainstream outlets.
--  5. ai_usage: tokens and cost of every AI call, per day.
--  6. Learning: also learn a place set on an event that had no specific pin,
--     and Hebrew/English names typed by editors into the place database.
--  7. A draft published by hand in a foreign language is sent to the editor agent.
--  8. event_source_text(): the original report text of a published event.
-- ════════════════════════════════════════════════════════════════════

-- 1. Categories ------------------------------------------------------
update public.event_categories
   set name = 'Small-arms fire (gunfire, sweep fire, light weapons)',
       description = 'Small-arms / light-weapons fire, sweep fire, shots fired, armed attacks with guns.',
       translations = translations || '{"he":"ירי נשק קל"}'
 where slug = 'shooting-gunfire';

insert into public.event_categories (slug, name, description, icon, color, marker_color, sort_order, translations)
values
  ('assassination', 'Assassination (a named person killed in a strike)',
   'A strike that killed a named person (commander, operative, official) — the name is published.',
   'Target', '#991b1b', '#991b1b', 35, '{"he":"חיסול"}'),
  ('force-sighting', 'Forces sighting (documented forces with their location)',
   'Photos, video or reports of troops, vehicles or weapons at a stated location.',
   'Binoculars', '#15803d', '#15803d', 72, '{"he":"זיהוי כוחות"}'),
  ('statements', 'Statements (official statements, speeches, threats, quotes)',
   'Statements, speeches, threats and quotes by officials, commanders, spokespeople or clerics.',
   'MessageSquareQuote', '#1d4ed8', '#1d4ed8', 82, '{"he":"הצהרות"}')
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, icon = excluded.icon,
  color = excluded.color, marker_color = excluded.marker_color, sort_order = excluded.sort_order,
  translations = excluded.translations, is_active = true;

-- Retire transport: its events move to "other" (a hidden category would leave them without one).
update public.events
   set category_id = (select id from public.event_categories where slug = 'other')
 where category_id = (select id from public.event_categories where slug = 'transportation-incident');
update public.event_categories set is_active = false where slug = 'transportation-incident';

-- 2. Publishing without coordinates --------------------------------
alter table public.events drop constraint if exists events_publish_requirements;
alter table public.events add constraint events_publish_requirements check (
  status <> 'published' or (category_id is not null and char_length(btrim(title)) > 0)
);

-- 3. Public views -------------------------------------------------
create or replace function public.event_media_kinds(p_event uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct case
           when m.kind in ('video', 'video_thumb') then 'video'
           when m.kind = 'image' then 'image'
           else 'document' end), '{}')
  from public.event_media m where m.event_id = p_event;
$$;
grant execute on function public.event_media_kinds(uuid) to anon, authenticated;

create or replace view public.published_events as
select e.id, e.title, e.description, e.severity, e.latitude, e.longitude, e.location_name, e.country,
       e.region, e.city, e.source_name, e.source_url, e.source_type, e.occurred_at, e.published_at,
       e.updated_at, e.is_breaking, e.is_verified, e.translations, e.category_id,
       c.slug as category_slug, c.name as category_name, c.icon as category_icon,
       c.color as category_color, c.marker_color as category_marker_color,
       e.location_precision, e.sources, e.locations, e.location_name_he, e.location_name_en,
       public.event_media_kinds(e.id) as media_kinds
from public.events e
left join public.event_categories c on c.id = e.category_id and c.is_active
where e.status = 'published' and e.deleted_at is null and cardinality(e.hfc_areas) = 0;

create or replace view public.archived_events as
select e.id, e.title, e.description, e.severity, e.latitude, e.longitude, e.location_name, e.country,
       e.region, e.city, e.source_name, e.source_url, e.source_type, e.occurred_at, e.published_at,
       e.updated_at, e.is_breaking, e.is_verified, e.translations, e.category_id,
       c.slug as category_slug, c.name as category_name, c.icon as category_icon,
       c.color as category_color, c.marker_color as category_marker_color,
       e.location_precision, e.expired_at, e.sources, e.locations, e.location_name_he, e.location_name_en,
       public.event_media_kinds(e.id) as media_kinds
from public.events e
left join public.event_categories c on c.id = e.category_id and c.is_active
where e.status = 'archived' and e.expired_at is not null and e.deleted_at is null;

grant select on public.published_events, public.archived_events to anon, authenticated;

-- 4. Mainstream verification ----------------------------------------
-- An outlet is recognised by the link's domain or by its name. Two different outlets = verified.
create or replace function public.mainstream_outlet(p_name text, p_url text)
returns text language sql immutable set search_path = '' as $$
  select case
    when x ~ '(reuters)' then 'reuters'
    when x ~ '(apnews|associated press|\map\M)' then 'ap'
    when x ~ '(afp\.com|\mafp\M|france24|france 24)' then 'afp'
    when x ~ '(bbc)' then 'bbc'
    when x ~ '(cnn)' then 'cnn'
    when x ~ '(aljazeera|al jazeera|al-jazeera|الجزيرة)' then 'aljazeera'
    when x ~ '(alarabiya|al arabiya|al-arabiya|العربية)' then 'alarabiya'
    when x ~ '(alhadath|al hadath|الحدث)' then 'alhadath'
    when x ~ '(skynews|sky news|سكاي نيوز)' then 'skynews'
    when x ~ '(bloomberg)' then 'bloomberg'
    when x ~ '(wsj\.com|wall street journal)' then 'wsj'
    when x ~ '(nytimes|new york times)' then 'nyt'
    when x ~ '(washingtonpost|washington post)' then 'wapo'
    when x ~ '(theguardian|the guardian)' then 'guardian'
    when x ~ '(telegraph)' then 'telegraph'
    when x ~ '(axios)' then 'axios'
    when x ~ '(dw\.com|deutsche welle)' then 'dw'
    when x ~ '(aawsat|asharq al-awsat|الشرق الأوسط)' then 'aawsat'
    when x ~ '(ynet|ידיעות)' then 'ynet'
    when x ~ '(haaretz|הארץ)' then 'haaretz'
    when x ~ '(timesofisrael|times of israel)' then 'toi'
    when x ~ '(jpost|jerusalem post)' then 'jpost'
    when x ~ '(kan\.org\.il|כאן חדשות|\mכאן 11)' then 'kan'
    when x ~ '(mako\.co\.il|n12|חדשות 12|ערוץ 12)' then 'n12'
    when x ~ '(13tv|reshet|חדשות 13|ערוץ 13)' then 'c13'
    when x ~ '(i24)' then 'i24'
    when x ~ '(walla|וואלה)' then 'walla'
    when x ~ '(maariv|מעריב)' then 'maariv'
    when x ~ '(israelhayom|ישראל היום)' then 'israelhayom'
  end
  from (select lower(coalesce(p_name, '') || ' ' || coalesce(p_url, '')) as x) s;
$$;

create or replace function public.events_auto_verify()
returns trigger language plpgsql set search_path = '' as $$
declare v_n integer;
begin
  if new.is_verified then return new; end if;
  select count(distinct o) into v_n from (
    select public.mainstream_outlet(new.source_name, new.source_url) o
    union all
    select public.mainstream_outlet(s ->> 'name', s ->> 'url')
    from jsonb_array_elements(case when jsonb_typeof(new.sources) = 'array' then new.sources else '[]'::jsonb end) s
    where coalesce(s ->> 'kind', '') <> 'context'
  ) q where o is not null;
  if v_n >= 2 then
    new.is_verified := true;
    new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object('verified_by', 'two mainstream outlets');
  end if;
  return new;
end;
$$;
drop trigger if exists events_auto_verify on public.events;
create trigger events_auto_verify before insert or update of sources, source_name, source_url on public.events
  for each row execute function public.events_auto_verify();
revoke execute on function public.events_auto_verify() from public, anon, authenticated;

-- 5. AI usage ---------------------------------------------------------
create table if not exists public.ai_usage (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  fn            text not null,          -- whatsapp-ingest / intel-crawler / event-agent
  purpose       text not null,          -- classify / edit / filter / expand / translate
  model         text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cache_read    integer not null default 0,
  cache_write   integer not null default 0,
  web_searches  integer not null default 0,
  cost_usd      numeric(12, 6) not null default 0,
  event_id      uuid
);
create index if not exists ai_usage_at_idx on public.ai_usage (at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
drop policy if exists "ai usage: staff read" on public.ai_usage;
create policy "ai usage: staff read" on public.ai_usage for select to authenticated
  using ((select public.has_permission('dashboard.view')));

create or replace view public.ai_usage_daily with (security_invoker = true) as
select (at at time zone 'Asia/Jerusalem')::date as day, fn, purpose, model,
       count(*) as calls, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
       sum(cache_read) as cache_read, sum(cache_write) as cache_write, sum(web_searches) as web_searches,
       round(sum(cost_usd), 4) as cost_usd
from public.ai_usage group by 1, 2, 3, 4;
grant select on public.ai_usage_daily to authenticated;

-- Keep 180 days.
select cron.unschedule(jobid) from cron.job where jobname = 'ai-usage-trim';
select cron.schedule('ai-usage-trim', '17 3 * * *', $$delete from public.ai_usage where at < now() - interval '180 days'$$);

-- 6. Learning from every manual change ---------------------------------
create or replace function public.events_learn_from_correction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_key   text;
  v_from  text;
  v_to    text;
  v_gid   bigint;
begin
  if v_uid is null or new.deleted_at is not null then return null; end if;

  if new.latitude is not null
     and (old.latitude is null or abs(new.latitude - old.latitude) > 0.003 or abs(new.longitude - old.longitude) > 0.003) then
    -- Pin moved on a specific place with the same name → that name lives here.
    -- Otherwise (renamed, or the event had no specific pin) → learn the names it has now.
    foreach v_key in array case
        when old.latitude is not null and coalesce(old.location_precision, 'exact') in ('exact', 'city')
             and public.normalize_place(new.location_name) = public.normalize_place(old.location_name)
          then array[old.location_name, old.ai_suggestions ->> 'place_en']
        else array[new.location_name, new.location_name_he, new.location_name_en]
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

  -- Names typed by an editor for a place the database matched: keep them for next time.
  v_gid := nullif(new.ai_suggestions -> 'location_resolution' ->> 'geonameid', '')::bigint;
  if v_gid is not null and new.location_name_he is distinct from old.location_name_he
     and public.has_hebrew(new.location_name_he) then
    update public.geo_places set name_he = left(new.location_name_he, 120), he_from_ai = false,
           names = (select array_agg(distinct x) from unnest(names || public.normalize_place(new.location_name_he)) x)
     where geonameid = v_gid;
  end if;
  if v_gid is not null and new.location_name_en is distinct from old.location_name_en
     and coalesce(new.location_name_en, '') ~ '^[\x20-\x7E]+$' then
    update public.geo_places set name_en = left(new.location_name_en, 120),
           names = (select array_agg(distinct x) from unnest(names || public.normalize_place(new.location_name_en)) x)
     where geonameid = v_gid;
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
revoke execute on function public.events_learn_from_correction() from public, anon, authenticated;

-- 7. Foreign-language draft published by hand → editor agent ------------
create or replace function public.foreign_share(p text)
returns numeric language sql immutable set search_path = '' as $$
  select case when he + other = 0 then 0 else round(other::numeric / (he + other), 3) end
  from (select length(regexp_replace(coalesce(p, ''), '[^א-ת]', '', 'g')) he,
               length(regexp_replace(coalesce(p, ''), '[^A-Za-z؀-ۿ]', '', 'g')) other) s;
$$;

create or replace function public.events_send_to_editor()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  -- Only a person publishing (the ingest functions run their own editor).
  if auth.uid() is not null and new.status = 'published' and old.status is distinct from 'published'
     and coalesce(new.ai_suggestions ->> 'editor_model', '') = ''
     and coalesce(new.ai_suggestions ->> 'sent_to_editor', '') = ''
     and public.foreign_share(coalesce(new.title, '') || ' ' || coalesce(new.description, '')) > 0.4 then
    select value into v_secret from public.intel_config where key = 'cron_secret';
    if v_secret is null then return null; end if;
    perform net.http_post(
      url := 'https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/event-agent',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('action', 'edit', 'id', new.id),
      timeout_milliseconds := 5000);
  end if;
  return null;
end;
$$;
drop trigger if exists events_send_to_editor on public.events;
create trigger events_send_to_editor after update of status on public.events
  for each row execute function public.events_send_to_editor();
revoke execute on function public.events_send_to_editor() from public, anon, authenticated;

-- 8. Original text of a published event (the "source text" button) ------
create or replace function public.event_source_text(p_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select left(coalesce(nullif(e.original_report_text, ''), e.description), 10000)
  from public.events e
  where e.id = p_id and e.deleted_at is null and e.status in ('published', 'archived');
$$;
grant execute on function public.event_source_text(uuid) to anon, authenticated;
