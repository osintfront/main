-- Paid data API (events only — no ships, aircraft, areas of control, HFC alerts or media).
-- Tiers: starter (1,000/day, 60/min, internal use) and business (10,000/day, 300/min, may show to customers).
-- OFF until app_settings.api_enabled = true. Keys are created by a super admin; only a hash is stored.

insert into public.app_settings (key, value) values ('api_enabled', 'false'::jsonb) on conflict (key) do nothing;

create table if not exists public.api_tiers (
  id text primary key,
  name text not null,
  daily_limit int not null,
  per_minute int not null,
  redistribution boolean not null default false,
  sort int not null default 0
);
insert into public.api_tiers (id, name, daily_limit, per_minute, redistribution, sort) values
  ('starter', 'API Starter', 1000, 60, false, 1),
  ('business', 'API Business', 10000, 300, true, 2)
on conflict (id) do nothing;

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_email text,
  user_id uuid references auth.users(id) on delete set null,
  tier text not null references public.api_tiers(id),
  key_hash text not null unique,
  key_prefix text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);

create table if not exists public.api_usage (
  key_id uuid not null references public.api_keys(id) on delete cascade,
  day date not null,
  calls int not null default 0,
  primary key (key_id, day)
);
create table if not exists public.api_usage_minute (
  key_id uuid not null references public.api_keys(id) on delete cascade,
  minute timestamptz not null,
  calls int not null default 0,
  primary key (key_id, minute)
);

alter table public.api_tiers enable row level security;
alter table public.api_keys enable row level security;
alter table public.api_usage enable row level security;
alter table public.api_usage_minute enable row level security;
create policy "api tiers: super admin" on public.api_tiers for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy "api keys: super admin read" on public.api_keys for select to authenticated using (public.is_super_admin());
create policy "api usage: super admin read" on public.api_usage for select to authenticated using (public.is_super_admin());

-- Super admin: create a key. The full key is returned ONCE; only its hash is kept.
create or replace function public.api_create_key(p_name text, p_tier text, p_owner_email text default null, p_days int default null)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  k text := 'ofk_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from api_tiers where id = p_tier) then raise exception 'unknown tier'; end if;
  insert into api_keys (name, owner_email, tier, key_hash, key_prefix, created_by, expires_at)
  values (left(trim(p_name), 120), nullif(trim(p_owner_email), ''), p_tier,
          encode(extensions.digest(k, 'sha256'), 'hex'), left(k, 12), auth.uid(),
          case when p_days is null then null else now() + make_interval(days => p_days) end);
  return k;
end;
$$;
grant execute on function public.api_create_key(text, text, text, int) to authenticated;

create or replace function public.api_revoke_key(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  update api_keys set revoked_at = now() where id = p_id and revoked_at is null;
end;
$$;
grant execute on function public.api_revoke_key(uuid) to authenticated;

-- The API itself: GET /api/v1/events → this function (anon may call; the key is the gate).
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
      and (p_category is null or c.slug = p_category)
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
