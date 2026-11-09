-- Geolocation runs only when someone asks for it (a Max/Intel subscriber's "Geolocate" button,
-- or staff "Run again"). New photos are no longer queued automatically.
update public.app_settings set value = 'false'::jsonb, updated_at = now() where key = 'geoloc_auto';
update public.geoloc_jobs set status = 'skipped', finished_at = now(),
       error = 'automatic geolocation turned off; runs only on request'
 where trigger = 'auto' and status in ('queued', 'failed');
