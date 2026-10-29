-- AI limits per user (reader features: "ask the map" and "expand").
-- Every AI call made for a signed-in reader is logged with its user_id and real cost.
-- 1 credit = app_settings.ai_credit_usd (default $0.08 ≈ one average question).
-- Daily credits per plan = plan_features 'ai_expand_ask'.limit_value (null = unlimited).
-- Emergency brake: when reader AI spend today passes ai_daily_budget_usd, reader AI stops for everyone.
-- Nothing is enforced until app_settings.ai_limits_enabled = true. Staff (role <> viewer) are never limited.

alter table public.ai_usage add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists ai_usage_user_at on public.ai_usage (user_id, at) where user_id is not null;

insert into public.app_settings (key, value) values
  ('ai_limits_enabled', 'false'::jsonb),
  ('ai_credit_usd', '0.08'::jsonb),
  ('ai_daily_budget_usd', '10'::jsonb)
on conflict (key) do nothing;

update public.plan_features set enabled = true, limit_value = 1, note = 'AI credits per day' where feature_key = 'ai_expand_ask' and plan_id = 'free';
update public.plan_features set enabled = true, limit_value = 5, note = 'AI credits per day' where feature_key = 'ai_expand_ask' and plan_id = 'pro';
update public.plan_features set enabled = true, limit_value = 30, note = 'AI credits per day' where feature_key = 'ai_expand_ask' and plan_id = 'max';

-- Quota of one user (server side; also readable for oneself via my_ai_quota()).
create or replace function public.ai_quota(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean := coalesce((select value from app_settings where key = 'ai_limits_enabled') = 'true'::jsonb, false);
  v_credit numeric := coalesce((select (value #>> '{}')::numeric from app_settings where key = 'ai_credit_usd'), 0.08);
  v_budget numeric := (select (value #>> '{}')::numeric from app_settings where key = 'ai_daily_budget_usd');
  v_day timestamptz := date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem';
  p record;
  v_plan text;
  v_limit int;
  v_used numeric;
  v_spent numeric;
begin
  select role, plan, plan_expires_at into p from profiles where id = p_uid;
  v_plan := case when p.plan is distinct from 'free' and p.plan_expires_at is not null and p.plan_expires_at < now() then 'free' else coalesce(p.plan, 'free') end;
  select limit_value into v_limit from plan_features where feature_key = 'ai_expand_ask' and plan_id = v_plan;
  select coalesce(sum(cost_usd), 0) / nullif(v_credit, 0) into v_used from ai_usage where user_id = p_uid and at >= v_day;
  select coalesce(sum(cost_usd), 0) into v_spent from ai_usage where user_id is not null and at >= v_day;
  return jsonb_build_object(
    'enabled', v_enabled,
    'staff', coalesce(p.role <> 'viewer', false),
    'plan', v_plan,
    'limit', v_limit,
    'used', round(coalesce(v_used, 0), 2),
    'budget_usd', v_budget,
    'spent_today_usd', round(v_spent, 4)
  );
end;
$$;
revoke all on function public.ai_quota(uuid) from public, anon, authenticated;

create or replace function public.my_ai_quota()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$ select public.ai_quota(auth.uid()) - 'spent_today_usd' - 'budget_usd' $$;
grant execute on function public.my_ai_quota() to authenticated;
