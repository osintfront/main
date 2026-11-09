-- Geolocation withdrawn from production until accuracy improves: no plan gets it
-- (staff keep access through can_geolocate's role check, for testing).
update public.plan_features set enabled = false where feature_key = 'geolocation';
update public.geoloc_jobs j set status = 'skipped', finished_at = now(), error = 'geolocation withdrawn from production'
 where status = 'queued' and not exists (select 1 from public.profiles p where p.id = j.requested_by and p.role <> 'viewer');
