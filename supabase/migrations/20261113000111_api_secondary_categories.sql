-- Osintfront · Migration 111 — public API: items carry their secondary types; the type filter sees them too.
-- (Split from 110 so each part can be applied on its own.)
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
