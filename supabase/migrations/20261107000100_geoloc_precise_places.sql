-- Geolocation: only queue events whose place is pinned to a town or an exact spot.
-- A country- or region-level pin (e.g. "Iran") leaves nothing a 12 km terrain search can use.
create or replace function public.geoloc_enqueue_media()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind not in ('image', 'video_thumb') then return new; end if;
  if not coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'geoloc_auto'), false) then
    return new;
  end if;
  if not exists (select 1 from public.events e where e.id = new.event_id and e.deleted_at is null
                   and e.latitude is not null
                   and coalesce(e.location_precision, '') in ('exact', 'city')) then
    return new;
  end if;
  insert into public.geoloc_jobs (event_id, media_id, trigger) values (new.event_id, new.id, 'auto')
  on conflict do nothing;
  return new;
end $$;

-- The worker gets the pin precision too, so it can refuse vague places itself.
create or replace function public.geoloc_claim(p_worker text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.geoloc_jobs%rowtype; e public.events%rowtype; v_media jsonb; v_video jsonb;
begin
  select * into j from public.geoloc_jobs
   where (status = 'queued' or (status = 'running' and claimed_at < now() - interval '45 minutes'))
     and attempts < 3
   order by (trigger = 'manual') desc, created_at
   limit 1 for update skip locked;
  if not found then return null; end if;
  update public.geoloc_jobs set status = 'running', worker = left(p_worker, 100), claimed_at = now(), attempts = attempts + 1
   where id = j.id;
  select * into e from public.events where id = j.event_id;
  select to_jsonb(m) - 'phash' - 'sha256' into v_media from public.event_media m where m.id = j.media_id;
  select to_jsonb(m) into v_video from public.event_media m
   where m.thumb_id = j.media_id and m.kind = 'video' and m.ready limit 1;
  return jsonb_build_object(
    'job_id', j.id, 'trigger', j.trigger, 'attempt', j.attempts + 1,
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description,
                                'original_report_text', left(e.original_report_text, 3000),
                                'latitude', e.latitude, 'longitude', e.longitude, 'location_name', e.location_name,
                                'location_precision', e.location_precision,
                                'city', e.city, 'region', e.region, 'country', e.country,
                                'locations', e.locations, 'occurred_at', e.occurred_at),
    'media', v_media, 'video', v_video);
end $$;
revoke all on function public.geoloc_claim(text) from public, anon, authenticated;
grant execute on function public.geoloc_claim(text) to service_role;

-- Clear automatic jobs already queued for vague places (manual requests are left alone).
update public.geoloc_jobs j set status = 'skipped', finished_at = now(),
       error = 'place known only to country/region level; too vague to search'
  from public.events e
 where e.id = j.event_id and j.status = 'queued' and j.trigger = 'auto'
   and (e.latitude is null or coalesce(e.location_precision, '') not in ('exact', 'city'));

-- Jobs that failed only because the quick check's answer was cut off: run them again.
update public.geoloc_jobs set status = 'queued', attempts = 0, error = null, finished_at = null
 where status = 'failed' and error like 'model returned no JSON%';
