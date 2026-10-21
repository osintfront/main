-- New event types: drone (רחפן) and UAV (כטב"מ); custom infiltration icon.
-- The names carry a short hint because the AI classifier / editor choose a category by "slug (name)".
insert into public.event_categories (name, slug, description, icon, color, marker_color, is_active, sort_order, translations)
values
  ('Drone (רחפן — small quadcopter / hobby drone)', 'drone', 'Small drones and quadcopters (רחפן): sightings, drops, interceptions.', 'Quadcopter', '#0284c7', '#0284c7', true, 52, '{"he":"רחפן"}'::jsonb),
  ('UAV (כטב"מ — fixed-wing / explosive / suicide UAV, e.g. Shahed)', 'uav', 'Unmanned aerial vehicles (כטב"מ): launches, impacts, interceptions.', 'FixedWingUav', '#6d28d9', '#6d28d9', true, 54, '{"he":"כטב\"מ"}'::jsonb)
on conflict (slug) do update
  set name = excluded.name, description = excluded.description, icon = excluded.icon,
      color = excluded.color, marker_color = excluded.marker_color, is_active = true, translations = excluded.translations;

update public.event_categories set icon = 'Infiltration' where slug = 'infiltration';
