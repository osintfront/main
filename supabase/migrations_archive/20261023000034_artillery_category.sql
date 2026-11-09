-- Osintfront · Migration 34 — category "Artillery shelling" (artillery, mortar, tank fire).
insert into public.event_categories (slug, name, description, icon, color, marker_color, sort_order, translations)
values ('artillery-shelling', 'Artillery shelling (artillery, mortar, tank fire)',
        'Artillery, mortar or tank shelling of a place. Not airstrikes (aircraft / drones).',
        'Artillery', '#b45309', '#b45309', 32, '{"he":"הפגזה ארטילרית"}')
on conflict (slug) do update set name = excluded.name, description = excluded.description, icon = excluded.icon,
  color = excluded.color, marker_color = excluded.marker_color, sort_order = excluded.sort_order,
  translations = excluded.translations, is_active = true;
