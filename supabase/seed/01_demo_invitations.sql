-- ════════════════════════════════════════════════════════════════════
-- DEMONSTRATION DATA — development only. Do not run in production.
--
-- Step 1 of 2. Creates invitations for four demo staff accounts.
-- Then create the users (Supabase Dashboard → Authentication → Users →
-- "Add user" or "Invite user") with exactly these emails. The
-- invitation trigger turns each new auth user into a profile with the
-- intended role. Choose your own passwords — none are stored here.
--
-- @example.com is reserved for documentation and never receives mail;
-- use "Add user → Auto confirm" for these, or replace the addresses with
-- real inboxes you control.
-- ════════════════════════════════════════════════════════════════════

insert into public.administrator_invitations (email, full_name, intended_role, message, token)
values
  ('demo-superadmin@example.com', 'Demo Super Admin', 'super_admin', 'Demonstration account', ''),
  ('demo-admin@example.com',      'Demo Admin',       'admin',       'Demonstration account', ''),
  ('demo-editor@example.com',     'Demo Editor',      'editor',      'Demonstration account', ''),
  ('demo-viewer@example.com',     'Demo Viewer',      'viewer',      'Demonstration account', '');
-- (token is always replaced by a server-generated value)

-- ── Your real first super admin ─────────────────────────────────────
-- In production, skip the demo rows above and run only:
--
--   insert into public.administrator_invitations (email, full_name, intended_role, token)
--   values ('you@yourdomain.com', 'Your Name', 'super_admin', '');
--
-- then invite that address from the Supabase Dashboard.
