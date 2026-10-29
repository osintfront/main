-- Social-media search by map area (Facebook, Instagram, TikTok, X), for the "intel" plan only.
-- "intel" is assigned by an admin and is never sold online. Staff (role <> viewer) may use it too.
-- X: official API (secret X_BEARER_TOKEN). Others: a data provider (Apify, secret APIFY_TOKEN);
-- which provider actor runs for which network lives in app_settings.social_providers.

alter table public.plans drop constraint if exists plans_id_check;
alter table public.plans add constraint plans_id_check check (id in ('free', 'pro', 'max', 'intel'));
insert into public.plans (id, name, sort) values ('intel', 'Intel', 4) on conflict (id) do nothing;
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('free', 'pro', 'max', 'intel'));

-- Intel gets everything Max has.
insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note)
select feature_key, 'intel', enabled, limit_value, note from public.plan_features where plan_id = 'max'
on conflict do nothing;
insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  ('social_search', 'free', false, null, 'map-area social search'),
  ('social_search', 'pro', false, null, 'map-area social search'),
  ('social_search', 'max', false, null, 'map-area social search'),
  ('social_search', 'intel', true, 40, 'searches per day')
on conflict do nothing;

insert into public.app_settings (key, value) values
  ('social_search_enabled', 'true'::jsonb),
  ('social_providers', '{
    "tiktok": {"actor": "clockworks~tiktok-scraper", "input": {"searchQueries": ["{q}"], "resultsPerPage": 20, "searchSection": "/video", "shouldDownloadVideos": false, "shouldDownloadCovers": false}},
    "instagram": {"actor": "apify~instagram-hashtag-scraper", "input": {"hashtags": ["{tag}"], "resultsLimit": 20}},
    "facebook": {"actor": null, "input": {"query": "{q}", "maxPosts": 20}}
  }'::jsonb)
on conflict (key) do nothing;

create table if not exists public.social_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  polygon jsonb not null,
  places text[] not null default '{}',
  terms text[] not null default '{}',
  hours int not null default 24,
  runs jsonb not null default '{}'::jsonb,   -- per network: {status, run_id, dataset_id, error}
  cost_usd numeric not null default 0,
  results_count int not null default 0
);
create index if not exists social_searches_user_at on public.social_searches (user_id, created_at desc);

create table if not exists public.social_results (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.social_searches(id) on delete cascade,
  platform text not null check (platform in ('x', 'facebook', 'instagram', 'tiktok')),
  post_id text not null,
  url text,
  author text,
  text text,
  posted_at timestamptz,
  media jsonb not null default '[]'::jsonb,  -- [{type, url, preview}] links only, nothing stored
  matched text,
  created_at timestamptz not null default now(),
  unique (search_id, platform, post_id)
);

alter table public.social_searches enable row level security;
alter table public.social_results enable row level security;
create policy "social searches: own or staff" on public.social_searches for select to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role <> 'viewer' and p.status = 'active'));
create policy "social results: own or staff" on public.social_results for select to authenticated
  using (exists (select 1 from public.social_searches s where s.id = search_id
    and (s.user_id = (select auth.uid()) or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role <> 'viewer' and p.status = 'active'))));

-- Places inside a drawn area (largest first), names in Hebrew, Arabic and English.
create or replace function public.places_in_polygon(p_polygon jsonb, p_limit int default 6)
returns table (name_he text, name_ar text, name_en text, population bigint)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select g.name_he, g.name_ar, coalesce(g.name_en, g.name), g.population
  from geo_places g
  where g.feature_class = 'P'
    and st_within(g.geom::geometry, st_setsrid(st_geomfromgeojson(p_polygon::text), 4326))
  order by g.population desc nulls last
  limit least(greatest(p_limit, 1), 20)
$$;
revoke all on function public.places_in_polygon(jsonb, int) from public, anon, authenticated;
