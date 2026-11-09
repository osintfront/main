-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 16 — public Telegram channels as a report feed
--
-- Each active channel is read every minute from its public web preview
-- (https://t.me/s/<username>) by the whatsapp-ingest Edge Function, and
-- every new post goes through the same pipeline as the WhatsApp feed:
-- classification, ±30-minute duplicates → sources, the editor agent, photos.
-- The first read only records where the channel is (no old posts published).
-- ════════════════════════════════════════════════════════════════════

create table public.telegram_channels (
  username       text primary key check (username ~ '^[A-Za-z0-9_]{4,64}$'),
  title          text not null default '',
  active         boolean not null default true,
  baseline_done  boolean not null default false,
  last_post_id   bigint not null default 0,
  posts_seen     integer not null default 0,
  last_run_at    timestamptz,
  last_ok_at     timestamptz,
  last_error     text,
  locked_until   timestamptz,
  created_at     timestamptz not null default now()
);

alter table public.telegram_channels enable row level security;
revoke all on public.telegram_channels from anon, authenticated;
grant select, insert, delete on public.telegram_channels to authenticated;
grant update (active) on public.telegram_channels to authenticated;
create policy "telegram channels: staff read" on public.telegram_channels for select to authenticated
  using ((select public.has_permission('dashboard.view')));
create policy "telegram channels: managers insert" on public.telegram_channels for insert to authenticated
  with check ((select public.has_permission('settings.manage')));
create policy "telegram channels: managers update" on public.telegram_channels for update to authenticated
  using ((select public.has_permission('settings.manage'))) with check ((select public.has_permission('settings.manage')));
create policy "telegram channels: managers delete" on public.telegram_channels for delete to authenticated
  using ((select public.has_permission('settings.manage')));

insert into public.telegram_channels (username, title) values ('Hadashot_Bitachon', 'חדשות ביטחון בטלגרם')
on conflict do nothing;

create or replace function public.telegram_poll_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if not exists (select 1 from public.telegram_channels where active) then return; end if;
  select value into v_secret from public.intel_config where key = 'cron_secret';
  perform net.http_post(
    url := 'https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/whatsapp-ingest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"telegram_poll": true}'::jsonb,
    timeout_milliseconds := 5000);
end $$;
revoke all on function public.telegram_poll_tick() from public, anon, authenticated;

select cron.schedule('osintfront-telegram-poll', '* * * * *', $c$select public.telegram_poll_tick()$c$);
