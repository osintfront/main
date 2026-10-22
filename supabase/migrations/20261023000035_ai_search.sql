-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 35 — AI search ("ask the map")
-- Candidate events for a free-text question. The event-agent turns the question
-- into filters (time, countries, categories, words), this returns the best matches
-- (public events only: published + archived), and the agent writes the answer.
-- Service role only (called by the edge function).
-- ════════════════════════════════════════════════════════════════════
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
      (case when b.cslug = any(p_categories) then 3 else 0 end)
      + (case when lower(coalesce(b.country,'')) = any(select lower(x) from unnest(p_countries) x) then 2 else 0 end)
      + (select count(*)::int from unnest(p_places) p where char_length(p) >= 2 and b.txt like '%' || lower(p) || '%')
      + (select count(*)::int from unnest(p_terms) t where char_length(t) >= 2 and b.txt like '%' || lower(t) || '%') as sc,
      (cardinality(p_countries) = 0 and cardinality(p_places) = 0)
        or lower(coalesce(b.country,'')) = any(select lower(x) from unnest(p_countries) x)
        or exists (select 1 from unnest(p_places) p where char_length(p) >= 2 and b.txt like '%' || lower(p) || '%') as place_ok,
      (cardinality(p_categories) = 0 and cardinality(p_terms) = 0)
        or b.cslug = any(p_categories)
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

-- Who asked what (rate limit + a record of questions). Service role only.
create table if not exists public.ai_search_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  question   text not null,
  results    integer not null default 0
);
create index if not exists ai_search_log_user_at on public.ai_search_log (user_id, at desc);
alter table public.ai_search_log enable row level security;
revoke all on public.ai_search_log from anon, authenticated;
