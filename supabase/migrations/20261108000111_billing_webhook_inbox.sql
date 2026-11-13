-- Billing: an inbox for payment-provider notifications (Grow).
-- The webhook only stores what arrives here, so the real payload format can be learned from live
-- test payments. Nothing in this table grants a plan; billing_apply stays the only place that does.
-- Card-like fields are removed by the webhook before insert. Rows hold payer name, phone and email,
-- so they are server-only and deleted after 90 days.

create table if not exists public.billing_webhook_inbox (
  id bigint generated always as identity primary key,
  source text not null default 'grow',
  content_type text,
  body jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists billing_webhook_inbox_received on public.billing_webhook_inbox (received_at desc);

alter table public.billing_webhook_inbox enable row level security;
-- No policies: only service_role (the webhook) reads or writes this table.
revoke all on public.billing_webhook_inbox from anon, authenticated;

select cron.schedule('osintfront-billing-inbox-trim', '29 4 * * *',
  $c$delete from public.billing_webhook_inbox where received_at < now() - interval '90 days'$c$);
