-- ════════════════════════════════════════════════════════════════════
-- DEMONSTRATION DATA — development only. Do not run in production.
--
-- Step 2 of 2. Run after the four demo users from 01_demo_invitations.sql
-- exist. Every description starts with "[Demo]"; none of this is real
-- reporting. Timestamps are relative to when the script runs.
--
-- Covers: all five statuses, Israel and the wider region, an ambiguous
-- location ("Gaza"), a critical breaking event, and a likely duplicate.
-- ════════════════════════════════════════════════════════════════════

do $$
declare
  v_editor uuid := (select id from public.profiles where email = 'demo-editor@example.com');
  v_admin  uuid := (select id from public.profiles where email = 'demo-admin@example.com');
  c        jsonb := (select jsonb_object_agg(slug, id) from public.event_categories);
begin
  if v_editor is null or v_admin is null then
    raise exception 'Create the demo users first (see 01_demo_invitations.sql).';
  end if;

  insert into public.events (
    title, description, original_report_text, category_id, suggested_category_id, status, severity,
    latitude, longitude, location_name, country, region, city,
    source_name, source_url, source_type, occurred_at, published_at,
    created_by, approved_by, is_breaking, is_verified,
    geocoding_confidence, classification_confidence, ai_suggestions, rejection_reason
  ) values
  -- 1 · Critical, breaking, published
  ('Rocket sirens activated in Ashkelon',
   '[Demo] Sirens sounded across Ashkelon and nearby communities following a reported launch from the Gaza Strip.',
   'Rocket sirens were activated in Ashkelon following a launch from Gaza.',
   (c->>'missile-rocket-attack')::uuid, (c->>'missile-rocket-attack')::uuid, 'published', 'critical',
   31.668800, 34.574300, 'Ashkelon', 'Israel', 'Southern District', 'Ashkelon',
   'Demo emergency feed', null, 'emergency_service', now() - interval '6 minutes', now() - interval '5 minutes',
   v_editor, v_admin, true, true, 0.94, 0.97, '{"demo": true}', null),

  -- 2 · Likely DUPLICATE of #1 (same place, same time, similar text) — pending review
  ('Sirens in Ashkelon after launch from Gaza',
   '[Demo] Second report of the same alert: sirens heard in Ashkelon after projectiles were launched from Gaza.',
   'Sirens heard in Ashkelon, launch from Gaza reported minutes ago.',
   (c->>'missile-rocket-attack')::uuid, (c->>'missile-rocket-attack')::uuid, 'pending_review', 'high',
   31.669300, 34.575100, 'Ashkelon', 'Israel', 'Southern District', 'Ashkelon',
   'Demo social account', null, 'social_media', now() - interval '4 minutes', null,
   v_editor, null, false, false, 0.90, 0.92, '{"demo": true}', null),

  -- 3
  ('Large wildfire reported west of Jerusalem',
   '[Demo] Firefighting teams and aircraft are working to contain a brush fire in the hills west of the city.',
   'A large wildfire was reported west of Jerusalem.',
   (c->>'fire')::uuid, (c->>'fire')::uuid, 'published', 'high',
   31.779500, 35.132500, 'Jerusalem Hills', 'Israel', 'Jerusalem District', 'Jerusalem',
   'Demo fire service', null, 'emergency_service', now() - interval '40 minutes', now() - interval '36 minutes',
   v_editor, v_admin, false, true, 0.71, 0.95, '{"demo": true}', null),

  -- 4
  ('Political demonstration outside the Knesset',
   '[Demo] Several hundred demonstrators gathered opposite the Knesset. Police describe the protest as calm.',
   'Political demonstration outside the Knesset in Jerusalem.',
   (c->>'protest-civil-unrest')::uuid, (c->>'political-event')::uuid, 'published', 'low',
   31.776700, 35.205400, 'Knesset, Givat Ram', 'Israel', 'Jerusalem District', 'Jerusalem',
   null, null, 'manual_report', now() - interval '95 minutes', now() - interval '90 minutes',
   v_admin, v_admin, false, false, 0.98, 0.64, '{"demo": true}', null),

  -- 5
  ('Reports of gunfire near Jenin refugee camp',
   '[Demo] Residents report sustained gunfire on the edge of the camp. Details are still unconfirmed.',
   'Reports of gunfire near the Jenin refugee camp.',
   (c->>'shooting-gunfire')::uuid, (c->>'shooting-gunfire')::uuid, 'published', 'high',
   32.460900, 35.291900, 'Jenin refugee camp', 'Palestinian Territories', 'Jenin Governorate', 'Jenin',
   'Demo news site', 'https://example.com/demo/jenin', 'news_website', now() - interval '2 hours', now() - interval '110 minutes',
   v_editor, v_admin, false, false, 0.88, 0.96, '{"demo": true}', null),

  -- 6
  ('Light earthquake felt near the Dead Sea',
   '[Demo] A magnitude 3.9 tremor was felt in communities around the Dead Sea. No damage reported.',
   'Earthquake felt near the Dead Sea, no damage.',
   (c->>'natural-disaster')::uuid, (c->>'natural-disaster')::uuid, 'published', 'medium',
   31.500000, 35.480000, 'Dead Sea', 'Israel', 'Southern District', '',
   'Demo seismology service', 'https://example.com/demo/quake', 'government_source', now() - interval '3 hours', now() - interval '170 minutes',
   v_admin, v_admin, false, true, 0.62, 0.99, '{"demo": true}', null),

  -- 7
  ('Power fault halts operations at Haifa port',
   '[Demo] A power failure suspended cargo handling at several terminals; crews are on site.',
   'Power outage at Haifa port, terminals stopped.',
   (c->>'infrastructure-incident')::uuid, (c->>'infrastructure-incident')::uuid, 'published', 'medium',
   32.819100, 35.001100, 'Haifa Port', 'Israel', 'Haifa District', 'Haifa',
   null, null, 'manual_report', now() - interval '4 hours', now() - interval '230 minutes',
   v_editor, v_admin, false, false, 0.93, 0.83, '{"demo": true}', null),

  -- 8
  ('Regional diplomatic meeting convenes in Amman',
   '[Demo] Delegations met in Amman to discuss border crossings and humanitarian access.',
   'Diplomatic meeting in Amman on crossings and aid.',
   (c->>'political-event')::uuid, (c->>'political-event')::uuid, 'published', 'medium',
   31.953900, 35.910600, 'Amman', 'Jordan', 'Amman Governorate', 'Amman',
   'Demo official statement', null, 'official_statement', now() - interval '5 hours', now() - interval '290 minutes',
   v_admin, v_admin, false, true, 0.97, 0.93, '{"demo": true}', null),

  -- 9
  ('Flights diverted to Larnaca after airspace closure',
   '[Demo] Several inbound flights were diverted to Larnaca International Airport during a temporary closure.',
   'Flights diverted to Larnaca airport.',
   (c->>'transportation-incident')::uuid, (c->>'transportation-incident')::uuid, 'published', 'medium',
   34.875100, 33.624900, 'Larnaca International Airport', 'Cyprus', 'Larnaca District', 'Larnaca',
   null, null, 'manual_report', now() - interval '6 hours', now() - interval '350 minutes',
   v_admin, v_admin, false, false, 0.96, 0.88, '{"demo": true}', null),

  -- 10
  ('Aid convoy crosses at Kerem Shalom',
   '[Demo] A convoy of humanitarian aid trucks passed through the Kerem Shalom crossing.',
   'Aid trucks crossed at Kerem Shalom this morning.',
   (c->>'humanitarian-event')::uuid, (c->>'humanitarian-event')::uuid, 'published', 'low',
   31.228000, 34.284000, 'Kerem Shalom crossing', 'Israel', 'Southern District', '',
   'Demo government source', null, 'government_source', now() - interval '8 hours', now() - interval '470 minutes',
   v_editor, v_admin, false, true, 0.91, 0.90, '{"demo": true}', null),

  -- 11 · Draft with coordinates
  ('Ransomware disrupts municipal services in Beersheba',
   '[Demo] Online municipal services are offline after what officials describe as a ransomware attack.',
   'Cyberattack / ransomware takes down Beersheba municipality website and payment systems.',
   (c->>'cyber-incident')::uuid, (c->>'cyber-incident')::uuid, 'draft', 'medium',
   31.252000, 34.791500, 'Beersheba', 'Israel', 'Southern District', 'Beersheba',
   null, null, 'manual_report', now() - interval '50 minutes', null,
   v_editor, null, false, false, 0.95, 0.94, '{"demo": true}', null),

  -- 12 · AMBIGUOUS location — draft without coordinates
  ('Explosion reported in Gaza',
   '[Demo] An explosion was reported. The location is ambiguous and needs an editor to choose the right match.',
   'Explosion reported in Gaza.',
   (c->>'explosion')::uuid, (c->>'explosion')::uuid, 'draft', 'high',
   null, null, 'Gaza', '', '', '',
   null, null, 'social_media', now() - interval '25 minutes', null,
   v_editor, null, false, false, 0.35, 0.91,
   '{"demo": true, "location": {"ambiguous": true, "candidates": ["Gaza City", "Gaza Strip", "Gaza Governorate"]}}', null),

  -- 13 · Rejected
  ('Unconfirmed claim of infiltration near Metula',
   '[Demo] A single unverified post claimed an infiltration near the northern border.',
   'Someone crossed the border near Metula??',
   (c->>'infiltration')::uuid, (c->>'infiltration')::uuid, 'rejected', 'high',
   33.280000, 35.578000, 'Metula', 'Israel', 'Northern District', 'Metula',
   'Demo social account', null, 'social_media', now() - interval '1 day', null,
   v_editor, null, false, false, 0.89, 0.74, '{"demo": true}',
   'Could not be corroborated by a second independent source.');

  -- 14 · Archived (was published last week)
  insert into public.events (
    title, description, original_report_text, category_id, status, severity,
    latitude, longitude, location_name, country, region, city, source_type,
    occurred_at, published_at, created_by, approved_by, is_verified, ai_suggestions
  ) values (
    'Military exercise in the Golan Heights',
    '[Demo] A scheduled exercise with increased vehicle movement in the area. Concluded.',
    'Military exercise in the Golan Heights.',
    (c->>'military-activity')::uuid, 'archived', 'low',
    33.000000, 35.750000, 'Golan Heights', 'Israel', 'Northern District', '',
    'military_source', now() - interval '7 days', now() - interval '7 days',
    v_admin, v_admin, true, '{"demo": true}'
  );

  insert into public.event_internal_notes (event_id, notes)
  select id, '[Demo] Check whether this matches the earlier Ashkelon alert before approving.'
  from public.events where title = 'Sirens in Ashkelon after launch from Gaza';
end;
$$;
