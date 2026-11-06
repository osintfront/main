-- OFI: embassy / diplomat evacuation as an indicator, and a full cycle every 8 h (the horizon stays 24 h).
--
-- Two signals:
--  * embassy_departures — US State Dept advisories RSS (already fetched for advisory_us, no extra call):
--    "ordered departure" = 2, "authorized departure" = 1, embassy "suspended operations" = 2, summed over
--    the region's countries; only a rise vs. the last 7 days scores (a drawdown that stays is old news).
--  * embassy_evacuation_news — our own collected events matching the new 'evacuation' lexicon,
--    vs. their 7-day baseline (refreshed hourly, zero cost).

alter table public.insight_lexicon drop constraint if exists insight_lexicon_category_check;
alter table public.insight_lexicon add constraint insight_lexicon_category_check
  check (category in ('escalation', 'de_escalation', 'intercept', 'proxy', 'airspace', 'threat', 'evacuation'));

insert into public.insight_signals
  (event_id, key, source_type, name_he, name_en, weight, direction, normalization, config, enabled, is_circuit_breaker, stale_after_hours)
select e.id, s.key, s.source_type, s.name_he, s.name_en, s.weight, 1, s.norm::jsonb, s.cfg::jsonb, true, false, s.stale
from public.insight_events e
cross join (values
  ('embassy_departures', 'advisory', 'פינוי סגל משגרירויות ארה"ב באזור', 'US embassy drawdowns in the region (State Dept)', 1.5,
   '{"method":"level_change"}',
   '{"country":"US","mode":"departures","countries":["Israel","Iraq","Lebanon","Jordan","Bahrain","Kuwait","Qatar","United Arab Emirates","Saudi Arabia","Oman","Syria","Yemen","Cyprus","Egypt","Turkey","Azerbaijan"]}',
   36),
  ('embassy_evacuation_news', 'internal_events', 'דיווחים על פינוי שגרירויות ודיפלומטים', 'Reports of embassy / diplomat evacuations', 1.5,
   '{"method":"ratio_vs_baseline"}', '{"categories":["evacuation"]}', 3)
) as s(key, source_type, name_he, name_en, weight, norm, cfg, stale)
where e.slug = 'iran-direct-confrontation'
on conflict do nothing;

insert into public.insight_lexicon (event_id, term, lang, category, weight)
select e.id, l.term, l.lang, 'evacuation', l.weight
from public.insight_events e
cross join (values
  ('פינוי שגרירות', 'he', 2), ('פינוי השגרירות', 'he', 2), ('פינוי שגרירויות', 'he', 2), ('פינוי דיפלומטים', 'he', 2),
  ('פינוי הדיפלומטים', 'he', 2), ('פינוי הסגל הדיפלומטי', 'he', 2), ('פינוי סגל השגרירות', 'he', 2),
  ('צמצום סגל השגרירות', 'he', 1.5), ('משפחות הדיפלומטים', 'he', 1), ('סגירת השגרירות', 'he', 1.5), ('סגירת שגרירות', 'he', 1.5),
  ('embassy evacuat', 'en', 2), ('evacuate the embassy', 'en', 2), ('evacuating the embassy', 'en', 2), ('evacuation of the embassy', 'en', 2),
  ('evacuate diplomats', 'en', 2), ('evacuating diplomats', 'en', 2), ('diplomats evacuated', 'en', 2), ('diplomatic staff', 'en', 1),
  ('ordered departure', 'en', 2), ('authorized departure', 'en', 1.5), ('non-emergency personnel', 'en', 1.5),
  ('non-essential staff', 'en', 1.5), ('non-essential personnel', 'en', 1.5), ('embassy closed', 'en', 1.5), ('closes embassy', 'en', 1.5),
  ('إجلاء السفارة', 'ar', 2), ('إجلاء موظفي السفارة', 'ar', 2), ('إجلاء الدبلوماسيين', 'ar', 2), ('سحب الدبلوماسيين', 'ar', 2),
  ('إغلاق السفارة', 'ar', 1.5)
) as l(term, lang, weight)
where e.slug = 'iran-direct-confrontation'
on conflict (event_id, term, category) do nothing;

-- Full cycle (every external source once + a new estimate) every 8 h instead of 24 h.
update public.insight_events
set refresh_interval_hours = 8,
    next_run_at = least(next_run_at, now() + interval '8 hours')
where slug = 'iran-direct-confrontation';
