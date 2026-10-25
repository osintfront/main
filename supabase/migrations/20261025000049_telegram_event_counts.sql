-- News agents page: how many events each Telegram channel produced (as the main source or
-- as an extra source), for filtering and sorting. Staff only (runs with the caller's rights).
create or replace function public.telegram_channel_event_counts()
returns table (username text, events integer)
language sql stable security invoker set search_path = '' as $$
  select lower(m[1]) as username, count(distinct e.id)::int as events
  from public.events e
  cross join lateral (
    select e.source_url as u
    union all
    select s ->> 'url' from jsonb_array_elements(case when jsonb_typeof(e.sources) = 'array' then e.sources else '[]'::jsonb end) s
  ) x
  cross join lateral regexp_match(x.u, '^https://t\.me/(?:s/)?([A-Za-z0-9_]{4,64})/\d+') m
  where e.deleted_at is null and x.u like 'https://t.me/%'
  group by 1
$$;
revoke all on function public.telegram_channel_event_counts() from public, anon;
grant execute on function public.telegram_channel_event_counts() to authenticated;
