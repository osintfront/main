-- New Terms of Use section for OFI Insights: every signed-in user must accept the updated terms again.
-- (require_terms is already true; AccountGates compares the user's last accepted version with this one.)
update public.app_settings set value = '"2026-11-06"'::jsonb where key = 'terms_version';
