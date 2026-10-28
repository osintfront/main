-- Server-only tables (RLS on, no policies): also remove the browser roles' table rights (defense in depth).
do $$
declare t text;
begin
  foreach t in array array['ai_cache','ai_search_log','geo_staging','ingest_config','intel_config','osm_places_stage','osm_waterways',
    'place_learn_queue','push_config','search_quota_log','self_private_invitations','self_private_usage_logs',
    'self_private_users_profiles','telegram_agents','translation_cache','translation_log','whatsapp_ingest_log'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
revoke all on public.push_subscriptions from anon;
-- Hide the REST schema description (table list) — Supabase already limits it to the service key.
alter role authenticator set pgrst.openapi_mode to 'disabled';
notify pgrst, 'reload config';
