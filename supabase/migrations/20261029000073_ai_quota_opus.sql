-- Reader AI moves to Opus: 1 credit = one Opus question (~$0.16). "Ask the map" is not in Free (expand only).
update public.app_settings set value = '0.16'::jsonb where key = 'ai_credit_usd';
update public.plan_features set limit_value = 1, note = 'AI credits per day (expand only)' where feature_key = 'ai_expand_ask' and plan_id = 'free';
update public.plan_features set limit_value = 3, note = 'AI credits per day' where feature_key = 'ai_expand_ask' and plan_id = 'pro';
update public.plan_features set limit_value = 5, note = 'AI credits per day' where feature_key = 'ai_expand_ask' and plan_id = 'max';
