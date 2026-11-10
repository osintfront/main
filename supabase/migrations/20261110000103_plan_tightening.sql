-- Plan tightening (10 Nov 2026): new limits per plan, enforced in the database, not only in the UI.
--  · plan_features: new keys (feed delay, event opens, summary, sources, media, share, copy, search,
--    devices, idle sign-out, military assets) and updated values (expand, ask, export).
--  · my_plan() / my_feature() / my_feature_limit(): the caller's plan and its limits (staff = max,
--    signed out = guest, expired = free). While enforce_plans is false everything is allowed.
--  · published_events: delay per plan, summary / source links / source list per plan, source_count.
--  · event_media: guests none, free the first picture only.
--  · ais_vessels: guests only when their plan has ships.
--  · event_source_text: original report text for plans with source links only.
--  · register_session: several devices per plan (free 1, pro 2, max 3).
--  · push: free gets critical alerts only.

-- ── Values ───────────────────────────────────────────────────────────────────────
insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  -- minutes behind live
  ('feed_delay_min', 'guest', true, 30, 'events shown this many minutes late'),
  ('feed_delay_min', 'free',  true, 5,  'events shown this many minutes late'),
  ('feed_delay_min', 'pro',   true, 0,  'events shown this many minutes late'),
  ('feed_delay_min', 'max',   true, 0,  'events shown this many minutes late'),
  ('feed_delay_min', 'intel', true, 0,  'events shown this many minutes late'),
  -- event windows opened per day
  ('event_open', 'guest', true, 10,   'event details opened per day'),
  ('event_open', 'free',  true, 30,   'event details opened per day'),
  ('event_open', 'pro',   true, null, 'event details opened per day'),
  ('event_open', 'max',   true, null, 'event details opened per day'),
  ('event_open', 'intel', true, null, 'event details opened per day'),
  -- the summary under the headline
  ('event_summary', 'guest', false, null, 'headline only'),
  ('event_summary', 'free',  true,  null, 'headline + summary'),
  ('event_summary', 'pro',   true,  null, 'full'),
  ('event_summary', 'max',   true,  null, 'full'),
  ('event_summary', 'intel', true,  null, 'full'),
  -- link to the original source + the original report text
  ('source_link', 'guest', false, null, 'link to the original source'),
  ('source_link', 'free',  false, null, 'link to the original source'),
  ('source_link', 'pro',   true,  null, 'link to the original source'),
  ('source_link', 'max',   true,  null, 'link to the original source'),
  ('source_link', 'intel', true,  null, 'link to the original source'),
  -- corroborating sources: off = count only, 1 = names, null = names + links
  ('sources_detail', 'guest', false, null, 'count only'),
  ('sources_detail', 'free',  false, null, 'count only'),
  ('sources_detail', 'pro',   true,  1,    'names'),
  ('sources_detail', 'max',   true,  null, 'names + links'),
  ('sources_detail', 'intel', true,  null, 'names + links'),
  -- pictures and videos: off = none (blurred), n = first n pictures, null = all
  ('media', 'guest', false, null, 'blurred'),
  ('media', 'free',  true,  1,    'first picture only'),
  ('media', 'pro',   true,  null, 'all'),
  ('media', 'max',   true,  null, 'all + download'),
  ('media', 'intel', true,  null, 'all + download'),
  ('media_download', 'guest', false, null, 'download pictures'),
  ('media_download', 'free',  false, null, 'download pictures'),
  ('media_download', 'pro',   false, null, 'download pictures'),
  ('media_download', 'max',   true,  null, 'download pictures'),
  ('media_download', 'intel', true,  null, 'download pictures'),
  -- shares per day (free shares carry the site mark and a sign-up link)
  ('share_daily', 'guest', false, 0,    'shares per day'),
  ('share_daily', 'free',  true,  3,    'shares per day'),
  ('share_daily', 'pro',   true,  null, 'shares per day'),
  ('share_daily', 'max',   true,  null, 'shares per day'),
  ('share_daily', 'intel', true,  null, 'shares per day'),
  ('copy_text', 'guest', false, null, 'copy event text'),
  ('copy_text', 'free',  false, null, 'copy event text'),
  ('copy_text', 'pro',   true,  null, 'copy event text'),
  ('copy_text', 'max',   true,  null, 'copy event text'),
  ('copy_text', 'intel', true,  null, 'copy event text'),
  -- keyword search (EEI) in the feed; without it: category filters only
  ('feed_search', 'guest', false, null, 'keyword search'),
  ('feed_search', 'free',  false, null, 'keyword search'),
  ('feed_search', 'pro',   true,  null, 'keyword search'),
  ('feed_search', 'max',   true,  null, 'keyword search'),
  ('feed_search', 'intel', true,  null, 'keyword search'),
  -- signed-in devices at once
  ('devices', 'guest', false, 0,    'devices signed in at once'),
  ('devices', 'free',  true,  1,    'devices signed in at once'),
  ('devices', 'pro',   true,  2,    'devices signed in at once'),
  ('devices', 'max',   true,  3,    'devices signed in at once'),
  ('devices', 'intel', true,  3,    'devices signed in at once'),
  -- signed out after this many idle minutes (null = never)
  ('idle_logout_min', 'guest', false, null, 'idle sign-out'),
  ('idle_logout_min', 'free',  true,  30,   'idle sign-out (minutes)'),
  ('idle_logout_min', 'pro',   true,  720,  'idle sign-out (minutes)'),
  ('idle_logout_min', 'max',   true,  null, 'idle sign-out (minutes)'),
  ('idle_logout_min', 'intel', true,  null, 'idle sign-out (minutes)'),
  -- Iran military assets layer
  ('military_assets', 'guest', false, null, 'military bases layer'),
  ('military_assets', 'free',  false, null, 'military bases layer'),
  ('military_assets', 'pro',   false, null, 'military bases layer'),
  ('military_assets', 'max',   true,  null, 'military bases layer'),
  ('military_assets', 'intel', true,  null, 'military bases layer'),
  -- updated values
  ('ships_aircraft', 'guest', false, null, 'ships and aircraft'),
  ('expand_daily',   'free',  true,  1,    'expand uses per day'),
  ('expand_daily',   'pro',   true,  10,   'expand uses per day'),
  ('ai_expand_ask',  'free',  false, null, 'ask the map'),
  ('ai_expand_ask',  'max',   true,  10,   'ask the map'),
  ('data_export',    'pro',   true,  100,  'CSV rows'),
  ('push',           'free',  true,  4,    'lowest severity rank: 4 = critical only')
on conflict (feature_key, plan_id) do update
  set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note;

-- ── The caller's plan ────────────────────────────────────────────────────────────
create or replace function public.plans_enforced()
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'enforce_plans'), false);
$$;

create or replace function public.my_plan()
returns text language sql stable security definer set search_path to '' as $$
  select case
    when coalesce(auth.role(), '') = 'service_role' then 'max'
    when pr.id is null then 'guest'
    when pr.role <> 'viewer' then 'max'                        -- staff: everything
    when pr.plan <> 'free' and pr.plan_expires_at is not null and pr.plan_expires_at < now() then 'free'
    else pr.plan::text
  end
  from (select 1) one
  left join public.profiles pr on pr.id = auth.uid() and pr.status = 'active';
$$;

/** Is the feature in the caller's plan? Always true while plans are not enforced. */
create or replace function public.my_feature(p_key text)
returns boolean language sql stable security definer set search_path to '' as $$
  select not public.plans_enforced()
      or coalesce((select f.enabled from public.plan_features f where f.feature_key = p_key and f.plan_id = public.my_plan()), false);
$$;

/** The caller's limit for a feature (null = unlimited, also while plans are not enforced). */
create or replace function public.my_feature_limit(p_key text)
returns int language sql stable security definer set search_path to '' as $$
  select case when not public.plans_enforced() then null
    else (select f.limit_value from public.plan_features f where f.feature_key = p_key and f.plan_id = public.my_plan()) end;
$$;

revoke all on function public.plans_enforced(), public.my_plan(), public.my_feature(text), public.my_feature_limit(text) from public;
grant execute on function public.plans_enforced(), public.my_plan(), public.my_feature(text), public.my_feature_limit(text) to anon, authenticated;

-- ── published_events: what each plan receives ────────────────────────────────────
-- Same columns in the same order (+ source_count at the end), so existing clients keep working.
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
    case when jsonb_typeof(e.sources) = 'array' then jsonb_array_length(e.sources) else 0 end as source_count
   from events e
     left join event_categories c on c.id = e.category_id and c.is_active
  where e.status = 'published'::event_status and e.deleted_at is null and cardinality(e.hfc_areas) = 0
    and ((select is_member()) or e.occurred_at > (now() - '24:00:00'::interval))
    and coalesce(e.published_at, e.occurred_at)
        <= now() - make_interval(mins => coalesce((select public.my_feature_limit('feed_delay_min')), 0));

-- ── Pictures ─────────────────────────────────────────────────────────────────────
/** Is this media row among the first n pictures of its event? */
create or replace function public.media_within(p_id uuid, p_event uuid, p_n int)
returns boolean language sql stable security definer set search_path to '' as $$
  select p_id in (select m.id from public.event_media m
                   where m.event_id = p_event and m.ready and m.kind in ('image', 'video_thumb')
                   order by m.created_at, m.id limit greatest(p_n, 0));
$$;
revoke all on function public.media_within(uuid, uuid, int) from public;
grant execute on function public.media_within(uuid, uuid, int) to anon, authenticated;

drop policy if exists "event_media: public reads published" on public.event_media;
create policy "event_media: public reads published" on public.event_media for select to anon, authenticated
  using (ready and event_is_public(event_id)
         and ((select is_member()) or event_is_recent(event_id))
         and (select public.my_feature('media'))
         and ((select public.my_feature_limit('media')) is null or public.media_within(id, event_id, (select public.my_feature_limit('media')))));

-- ── Ships: guests only when their plan has them ──────────────────────────────────
drop policy if exists "ais: anyone reads" on public.ais_vessels;
create policy "ais: anyone reads" on public.ais_vessels for select to anon
  using ((select public.my_feature('ships_aircraft')));

-- ── Original report text: plans with source links only ───────────────────────────
create or replace function public.event_source_text(p_id uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
begin
  if not public.my_feature('source_link') then raise exception 'not_in_plan'; end if;
  return (select left(coalesce(nullif(e.original_report_text, ''), e.description), 10000)
            from public.events e
           where e.id = p_id and e.deleted_at is null and e.status in ('published', 'archived'));
end $$;

-- ── Daily counters shown in the site ─────────────────────────────────────────────
create or replace function public.my_feature_usage()
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_object_agg(f.feature_key, jsonb_build_object('used', coalesce(u.count, 0), 'limit', f.limit_value)), '{}'::jsonb)
  from public.profiles pr
  join public.plan_features f
    on f.plan_id = case when pr.plan <> 'free' and pr.plan_expires_at is not null and pr.plan_expires_at < now() then 'free' else pr.plan end
   and f.feature_key in ('expand_daily', 'satellite', 'event_open', 'share_daily')
  left join public.feature_usage u
    on u.user_id = pr.id and u.feature_key = f.feature_key and u.day = (now() at time zone 'Asia/Jerusalem')::date
  where pr.id = auth.uid();
$$;

-- ── Devices: keep the newest (limit) sessions, end the rest ──────────────────────
create or replace function public.register_session(p_device text, p_browser text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid; ended int := 0; keep int;
begin
  if auth.uid() is null or sid is null then raise exception 'not allowed'; end if;
  insert into public.user_sessions (session_id, user_id, device_type, browser)
  values (sid, auth.uid(), left(p_device, 40), left(p_browser, 60))
  on conflict (session_id) do update set last_seen = now(), device_type = excluded.device_type, browser = excluded.browser;
  if not public.is_super_admin() then
    -- Staff and plans not enforced: one device, as before. Viewers: their plan's device limit.
    keep := case when public.plans_enforced() and (select role from public.profiles where id = auth.uid()) = 'viewer'
                 then greatest(coalesce(public.my_feature_limit('devices'), 1), 1)
                 else 1 end;
    with others as (
      select session_id from public.user_sessions
       where user_id = auth.uid() and session_id <> sid and ended_at is null
       order by last_seen desc offset keep - 1
    )
    update public.user_sessions u set ended_at = now(), ended_reason = 'signed_in_elsewhere'
      from others o where u.session_id = o.session_id;
    delete from auth.sessions s
     where s.user_id = auth.uid() and s.id <> sid
       and s.id in (select session_id from public.user_sessions where user_id = auth.uid() and ended_at is not null);
    get diagnostics ended = row_count;
  end if;
  return jsonb_build_object('ok', true, 'ended', ended);
end $$;
revoke all on function public.register_session(text, text) from public, anon;
grant execute on function public.register_session(text, text) to authenticated;

-- ── Push: free = critical only ───────────────────────────────────────────────────
create or replace function public.push_set_min_severity(p_endpoint text, p_min text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_min not in ('low', 'medium', 'high', 'critical') then raise exception 'bad severity'; end if;
  if public.plans_enforced() and public.my_plan() = 'free' and p_min <> 'critical' then
    raise exception 'plan: the free plan gets critical alerts only';
  end if;
  update public.push_subscriptions set min_severity = p_min, updated_at = now()
   where endpoint = p_endpoint and user_id = auth.uid();
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.push_set_min_severity(text, text) from public, anon;
grant execute on function public.push_set_min_severity(text, text) to authenticated;

-- Free devices already subscribed below critical move up to critical.
update public.push_subscriptions ps set min_severity = 'critical', updated_at = now()
  from public.profiles pr
 where pr.id = ps.user_id and pr.role = 'viewer' and ps.min_severity <> 'critical'
   and (pr.plan = 'free' or (pr.plan_expires_at is not null and pr.plan_expires_at < now()));

-- ── archived_events: the same per-plan text, sources and links as the live feed ──
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
    case when jsonb_typeof(e.sources) = 'array' then jsonb_array_length(e.sources) else 0 end as source_count
   from events e
     left join event_categories c on c.id = e.category_id and c.is_active
  where e.status = 'archived'::event_status and e.expired_at is not null and e.deleted_at is null
    and (select is_member())
    and ((select my_archive_days()) is null or e.occurred_at > (now() - make_interval(days => (select my_archive_days()))));

-- New free subscriptions (and any change) stay on critical only.
create or replace function public.push_free_critical_only()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if public.plans_enforced() and new.min_severity <> 'critical' and exists (
       select 1 from public.profiles pr where pr.id = new.user_id and pr.role = 'viewer'
          and (pr.plan = 'free' or (pr.plan_expires_at is not null and pr.plan_expires_at < now()))) then
    new.min_severity := 'critical';
  end if;
  return new;
end $$;
drop trigger if exists push_free_critical_only on public.push_subscriptions;
create trigger push_free_critical_only before insert or update of min_severity, user_id on public.push_subscriptions
  for each row execute function public.push_free_critical_only();
