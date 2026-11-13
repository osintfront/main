-- Osintfront · Migration 110 — secondary event types.
-- An event keeps one main type (category_id: icon, colour, sound, dedupe) and up to two more
-- (secondary_categories, slugs) that the type filter, sets, search and the public API also see.
-- The trigger cleans whatever a writer sends: active types only, not the main one, never
-- home-front-alerts / other / uncategorized, distinct, `wounded` last, at most two.

alter table public.events add column if not exists secondary_categories text[] not null default '{}';
alter table public.events drop constraint if exists events_secondary_categories_max;
alter table public.events add constraint events_secondary_categories_max check (cardinality(secondary_categories) <= 2);

create or replace function public.clean_secondary_categories()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_main text; v_out text[] := '{}'; s text;
begin
  if cardinality(coalesce(new.secondary_categories, '{}')) = 0 then
    new.secondary_categories := '{}';
    return new;
  end if;
  select c.slug into v_main from public.event_categories c where c.id = new.category_id;
  foreach s in array new.secondary_categories loop
    if s is null or s = v_main or s = any(array['home-front-alerts', 'other', 'uncategorized']) or s = any(v_out) then continue; end if;
    if not exists (select 1 from public.event_categories c where c.slug = s and c.is_active) then continue; end if;
    v_out := v_out || s;
  end loop;
  if 'wounded' = any(v_out) then v_out := array_remove(v_out, 'wounded') || 'wounded'::text; end if;
  new.secondary_categories := coalesce(v_out[1:2], '{}');
  return new;
end $$;
revoke execute on function public.clean_secondary_categories() from public, anon, authenticated;
drop trigger if exists events_clean_secondary_categories on public.events;
create trigger events_clean_secondary_categories before insert or update of secondary_categories, category_id on public.events
  for each row execute function public.clean_secondary_categories();

-- ── Views: written out from 20261110000103 with secondary_categories as the last column ──
create or replace view public.published_events as
 select e.id,
    e.title,
    case when (select public.my_feature('event_summary')) then e.description end as description,
    e.severity,
    e.latitude,
    e.longitude,
    e.location_name,
    e.country,
    e.region,
    e.city,
    case when (select public.my_plan()) = 'guest' and (select public.plans_enforced()) then null else e.source_name end as source_name,
    case when (select public.my_feature('source_link')) then e.source_url end as source_url,
    e.source_type,
    e.occurred_at,
    e.published_at,
    e.updated_at,
    e.is_breaking,
    e.is_verified,
    case when (select public.my_feature('event_summary'))
      then (((((e.translations #- '{he,details}'::text[]) #- '{he,religious}'::text[]) #- '{he,implications}'::text[]) #- '{en,details}'::text[]) #- '{en,religious}'::text[]) #- '{en,implications}'::text[]
      else coalesce((select jsonb_object_agg(k.key, jsonb_build_object('title', k.value -> 'title'))
                       from jsonb_each(case when jsonb_typeof(e.translations) = 'object' then e.translations else '{}'::jsonb end) k
                      where jsonb_typeof(k.value) = 'object'), '{}'::jsonb)
    end as translations,
    e.category_id,
    c.slug as category_slug,
    c.name as category_name,
    c.icon as category_icon,
    c.color as category_color,
    c.marker_color as category_marker_color,
    e.location_precision,
    case
      when not (select public.my_feature('sources_detail')) then '[]'::jsonb
      when (select public.my_feature_limit('sources_detail')) = 1 and jsonb_typeof(e.sources) = 'array'
        then coalesce((select jsonb_agg(s - 'url') from jsonb_array_elements(e.sources) s), '[]'::jsonb)
      else e.sources
    end as sources,
    e.locations,
    e.location_name_he,
    e.location_name_en,
    event_media_kinds(e.id) as media_kinds,
    coalesce(e.ai_suggestions ->> 'split_from'::text,
        case when jsonb_typeof(e.ai_suggestions -> 'split_into'::text) = 'array'::text then e.id::text else null::text end) as report_group,
    case when jsonb_typeof(e.sources) = 'array' then jsonb_array_length(e.sources) else 0 end as source_count,
    e.secondary_categories
   from events e
     left join event_categories c on c.id = e.category_id and c.is_active
  where e.status = 'published'::event_status and e.deleted_at is null and cardinality(e.hfc_areas) = 0
    and ((select is_member()) or e.occurred_at > (now() - '24:00:00'::interval))
    and coalesce(e.published_at, e.occurred_at)
        <= now() - make_interval(mins => coalesce((select public.my_feature_limit('feed_delay_min')), 0));

create or replace view public.archived_events as
 select e.id,
    e.title,
    case when (select public.my_feature('event_summary')) then e.description end as description,
    e.severity,
    e.latitude,
    e.longitude,
    e.location_name,
    e.country,
    e.region,
    e.city,
    e.source_name,
    case when (select public.my_feature('source_link')) then e.source_url end as source_url,
    e.source_type,
    e.occurred_at,
    e.published_at,
    e.updated_at,
    e.is_breaking,
    e.is_verified,
    (((((e.translations #- '{he,details}'::text[]) #- '{he,religious}'::text[]) #- '{he,implications}'::text[]) #- '{en,details}'::text[]) #- '{en,religious}'::text[]) #- '{en,implications}'::text[] as translations,
    e.category_id,
    c.slug as category_slug,
    c.name as category_name,
    c.icon as category_icon,
    c.color as category_color,
    c.marker_color as category_marker_color,
    e.location_precision,
    e.expired_at,
    case
      when not (select public.my_feature('sources_detail')) then '[]'::jsonb
      when (select public.my_feature_limit('sources_detail')) = 1 and jsonb_typeof(e.sources) = 'array'
        then coalesce((select jsonb_agg(s - 'url') from jsonb_array_elements(e.sources) s), '[]'::jsonb)
      else e.sources
    end as sources,
    e.locations,
    e.location_name_he,
    e.location_name_en,
    event_media_kinds(e.id) as media_kinds,
    coalesce(e.ai_suggestions ->> 'split_from'::text,
        case when jsonb_typeof(e.ai_suggestions -> 'split_into'::text) = 'array'::text then e.id::text else null::text end) as report_group,
    case when jsonb_typeof(e.sources) = 'array' then jsonb_array_length(e.sources) else 0 end as source_count,
    e.secondary_categories
   from events e
     left join event_categories c on c.id = e.category_id and c.is_active
  where e.status = 'archived'::event_status and e.expired_at is not null and e.deleted_at is null
    and (select is_member())
    and ((select my_archive_days()) is null or e.occurred_at > (now() - make_interval(days => (select my_archive_days()))));

-- ── Hand-set secondary types (admin). The editor's re-runs leave them alone (manual_secondary). ──
create or replace function public.set_event_secondary_categories(p_id uuid, p_slugs text[])
returns void language plpgsql security definer set search_path to '' as $function$
declare v_owner uuid; s text;
begin
  select e.created_by into v_owner from public.events e where e.id = p_id and e.deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not (public.has_permission('event.edit.any')
       or (public.has_permission('event.edit.own') and v_owner = auth.uid())) then
    raise exception 'You do not have permission to edit this event.' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_slugs, '{}')) > 2 then raise exception 'At most two secondary types.' using errcode = '22023'; end if;
  foreach s in array coalesce(p_slugs, '{}') loop
    if not exists (select 1 from public.event_categories c where c.slug = s and c.is_active) then
      raise exception 'Unknown category.' using errcode = '22023';
    end if;
  end loop;
  update public.events
     set secondary_categories = coalesce(p_slugs, '{}'),
         ai_suggestions = coalesce(ai_suggestions, '{}'::jsonb) || '{"manual_secondary":true}'::jsonb
   where id = p_id;
end;
$function$;
revoke execute on function public.set_event_secondary_categories(uuid, text[]) from public, anon;
grant execute on function public.set_event_secondary_categories(uuid, text[]) to authenticated;

-- ── Ask the map: a secondary type counts as a match (a little less than the main type) ──
create or replace function public.ai_search_candidates(
  p_since timestamptz,
  p_until timestamptz default null,
  p_countries text[] default '{}',
  p_places text[] default '{}',
  p_categories text[] default '{}',
  p_terms text[] default '{}',
  p_limit integer default 120
) returns table (
  id uuid, occurred_at timestamptz, title text, description text, category_slug text,
  country text, location_name text, latitude double precision, longitude double precision,
  locations jsonb, title_en text, score integer
) language sql stable security definer set search_path = '' as $$
  with base as (
    select e.*, c.slug as cslug,
      lower(coalesce(e.title,'') || ' ' || coalesce(e.description,'') || ' ' || coalesce(e.original_report_text,'') || ' ' ||
            coalesce(e.translations::text,'') || ' ' || coalesce(e.location_name,'') || ' ' || coalesce(e.locations::text,'') || ' ' ||
            coalesce(e.city,'') || ' ' || coalesce(e.region,'')) as txt
    from public.events e
    left join public.event_categories c on c.id = e.category_id
    where e.deleted_at is null
      and e.status in ('published', 'archived')
      and e.occurred_at >= p_since
      and (p_until is null or e.occurred_at < p_until)
  ), scored as (
    select b.*,
      (case when b.cslug = any(p_categories) then 3 when b.secondary_categories && p_categories then 2 else 0 end)
      + (case when lower(coalesce(b.country,'')) = any(select lower(x) from unnest(p_countries) x) then 2 else 0 end)
      + (select count(*)::int from unnest(p_places) p where char_length(p) >= 2 and b.txt like '%' || lower(p) || '%')
      + (select count(*)::int from unnest(p_terms) t where char_length(t) >= 2 and b.txt like '%' || lower(t) || '%') as sc,
      (cardinality(p_countries) = 0 and cardinality(p_places) = 0)
        or lower(coalesce(b.country,'')) = any(select lower(x) from unnest(p_countries) x)
        or exists (select 1 from unnest(p_places) p where char_length(p) >= 2 and b.txt like '%' || lower(p) || '%') as place_ok,
      (cardinality(p_categories) = 0 and cardinality(p_terms) = 0)
        or b.cslug = any(p_categories)
        or b.secondary_categories && p_categories
        or exists (select 1 from unnest(p_terms) t where char_length(t) >= 2 and b.txt like '%' || lower(t) || '%') as topic_ok
    from base b
  )
  select s.id, s.occurred_at, s.title, left(s.description, 400), s.cslug, s.country, s.location_name,
         s.latitude, s.longitude, s.locations, s.translations->'en'->>'title', s.sc
  from scored s
  where s.place_ok and s.topic_ok
  order by s.sc desc, s.occurred_at desc
  limit least(greatest(p_limit, 1), 200);
$$;
revoke execute on function public.ai_search_candidates(timestamptz, timestamptz, text[], text[], text[], text[], integer) from public, anon, authenticated;

-- ── Public API: items carry their secondary types; the type filter sees them too ──
create or replace function public.api_events(
  p_key text,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_category text default null,
  p_country text default null,
  p_limit int default 100
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_key api_keys;
  v_tier api_tiers;
  v_day int;
  v_min int;
  v_rows jsonb;
begin
  if coalesce((select value from app_settings where key = 'api_enabled') = 'true'::jsonb, false) is not true then
    return jsonb_build_object('error', 'api_not_available', 'status', 503);
  end if;
  select * into v_key from api_keys
   where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex')
     and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('error', 'invalid_key', 'status', 401); end if;
  select * into v_tier from api_tiers where id = v_key.tier;

  insert into api_usage_minute (key_id, minute, calls) values (v_key.id, date_trunc('minute', now()), 1)
  on conflict (key_id, minute) do update set calls = api_usage_minute.calls + 1 returning calls into v_min;
  if v_min > v_tier.per_minute then return jsonb_build_object('error', 'rate_limited', 'status', 429, 'retry_after', 60 - extract(second from now())::int); end if;
  insert into api_usage (key_id, day, calls) values (v_key.id, (now() at time zone 'UTC')::date, 1)
  on conflict (key_id, day) do update set calls = api_usage.calls + 1 returning calls into v_day;
  if v_day > v_tier.daily_limit then return jsonb_build_object('error', 'daily_limit_reached', 'status', 429); end if;
  update api_keys set last_used_at = now() where id = v_key.id;
  delete from api_usage_minute where minute < now() - interval '10 minutes';

  select coalesce(jsonb_agg(r order by r->>'occurred_at' desc), '[]'::jsonb) into v_rows from (
    select jsonb_strip_nulls(jsonb_build_object(
      'id', e.id,
      'occurred_at', e.occurred_at,
      'published_at', e.published_at,
      'updated_at', e.updated_at,
      'title_he', coalesce(e.translations #>> '{he,title}', e.title),
      'title_en', e.translations #>> '{en,title}',
      'summary_he', e.translations #>> '{he,summary}',
      'summary_en', e.translations #>> '{en,summary}',
      'category', c.slug,
      'secondary_categories', to_jsonb(e.secondary_categories),
      'severity', e.severity,
      'verified', e.is_verified,
      'breaking', e.is_breaking,
      'latitude', e.latitude,
      'longitude', e.longitude,
      'place_he', coalesce(e.location_name_he, e.location_name),
      'place_en', e.location_name_en,
      'country', e.country,
      'source_name', e.source_name,
      'source_url', e.source_url,
      'url', 'https://osintfront.com/?event=' || e.id
    )) r
    from events e
    left join event_categories c on c.id = e.category_id and c.is_active
    where e.status in ('published', 'archived') and e.deleted_at is null and cardinality(e.hfc_areas) = 0
      and (p_since is null or e.occurred_at >= p_since)
      and (p_until is null or e.occurred_at < p_until)
      and (p_category is null or c.slug = p_category or p_category = any(e.secondary_categories))
      and (p_country is null or e.country ilike p_country)
    order by e.occurred_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ) s;

  return jsonb_build_object(
    'data', v_rows,
    'usage', jsonb_build_object('tier', v_tier.id, 'today', v_day, 'daily_limit', v_tier.daily_limit),
    'attribution', 'Osintfront (osintfront.com)'
  );
end;
$$;
revoke all on function public.api_events(text, timestamptz, timestamptz, text, text, int) from public;
grant execute on function public.api_events(text, timestamptz, timestamptz, text, text, int) to anon, authenticated;
