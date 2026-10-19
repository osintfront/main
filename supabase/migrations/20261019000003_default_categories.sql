-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 3 — default event categories
-- Slugs are canonical (English). Display names are translated in the app
-- (src/i18n) and can be overridden per language via `translations`.
-- Icons are Lucide component names resolved by src/data/categoryRegistry.ts.
-- ════════════════════════════════════════════════════════════════════

insert into public.event_categories (slug, name, description, icon, color, marker_color, sort_order, translations)
values
  ('shooting-gunfire',         'Shooting / Gunfire',          'Gunfire, shots fired, armed attacks.',                     'Crosshair',      '#e11d48', '#e11d48',  10, '{"he": "ירי"}'),
  ('missile-rocket-attack',    'Missile or Rocket Attack',    'Rocket or missile launches, interceptions, sirens.',       'Rocket',         '#f97316', '#f97316',  20, '{"he": "ירי רקטות וטילים"}'),
  ('airstrike',                'Airstrike',                   'Strikes by aircraft or drones.',                           'Plane',          '#9333ea', '#9333ea',  30, '{"he": "תקיפה אווירית"}'),
  ('explosion',                'Explosion',                   'Blasts and detonations of any origin.',                    'Bomb',           '#dc2626', '#dc2626',  40, '{"he": "פיצוץ"}'),
  ('infiltration',             'Infiltration',                'Border crossings and unauthorised entry.',                 'Footprints',     '#a16207', '#a16207',  50, '{"he": "חדירה"}'),
  ('terror-security-incident', 'Terror or Security Incident', 'Terror attacks and other security incidents.',             'ShieldAlert',    '#7f1d1d', '#7f1d1d',  60, '{"he": "אירוע טרור או ביטחוני"}'),
  ('military-activity',        'Military Activity',           'Troop movements, operations, exercises.',                  'Swords',         '#4d7c0f', '#4d7c0f',  70, '{"he": "פעילות צבאית"}'),
  ('political-event',          'Political Event',             'Elections, government decisions, diplomacy.',              'Landmark',       '#2563eb', '#2563eb',  80, '{"he": "אירוע מדיני"}'),
  ('protest-civil-unrest',     'Protest or Civil Unrest',     'Demonstrations, riots, strikes.',                          'Megaphone',      '#db2777', '#db2777',  90, '{"he": "הפגנה או אי־סדר אזרחי"}'),
  ('natural-disaster',         'Natural Disaster',            'Earthquakes, floods, storms.',                             'CloudLightning', '#0d9488', '#0d9488', 100, '{"he": "אסון טבע"}'),
  ('fire',                     'Fire',                        'Wildfires, building and industrial fires.',                'Flame',          '#f59e0b', '#f59e0b', 110, '{"he": "שריפה"}'),
  ('infrastructure-incident',  'Infrastructure Incident',     'Power, water, communications and port disruptions.',       'Construction',   '#64748b', '#64748b', 120, '{"he": "תקלת תשתית"}'),
  ('cyber-incident',           'Cyber Incident',              'Cyberattacks, ransomware, attack-driven outages.',         'Cpu',            '#0891b2', '#0891b2', 130, '{"he": "אירוע סייבר"}'),
  ('transportation-incident',  'Transportation Incident',     'Road, rail, air and sea transport incidents.',             'Car',            '#4f46e5', '#4f46e5', 140, '{"he": "אירוע תחבורה"}'),
  ('humanitarian-event',       'Humanitarian Event',          'Aid deliveries, evacuations, displacement.',               'HeartHandshake', '#16a34a', '#16a34a', 150, '{"he": "אירוע הומניטרי"}'),
  ('other',                    'Other',                       'Events that fit no other category.',                       'CircleDot',      '#78716c', '#78716c', 999, '{"he": "אחר"}')
on conflict (slug) do nothing;
