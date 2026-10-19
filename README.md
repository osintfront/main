# Osintfront — Live Event Map

A Liveuamap-style live conflict & event map for Israel and the Middle East, with a secure, invitation-only moderation back office.

**Stack:** React 19 · TypeScript · Tailwind CSS v4 · Lucide · Leaflet (OpenStreetMap / CARTO tiles) · React Router 7 · Supabase (Postgres, Auth, RLS)

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173
```

With no `.env.local`, the public map runs on **five bundled demo events** (labelled "Demo data") so you can try the card ↔ marker workflow immediately. `/login` and `/admin` show a setup screen instead of failing silently.

### Connect Supabase (Phase 1)

1. **Create a project** at supabase.com → copy the Project URL and the **anon/public** key.
2. `cp .env.example .env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
   - Never put the service-role key here. The app refuses to start the client if it detects one.
3. **Run the migrations, in order** (SQL editor, or `supabase db push` with the CLI):
   ```
   supabase/migrations/20261019000001_initial_schema.sql
   supabase/migrations/20261019000002_rls_policies.sql
   supabase/migrations/20261019000003_default_categories.sql
   ```
4. **Lock down sign-ups:** Authentication → Sign In / Providers → turn off "Allow new users to sign up".
   Even if left on, an uninvited user gets an auth account with **no profile and no permissions**.
5. **Set auth URLs:** Authentication → URL Configuration → Site URL = your site; add `http://localhost:5173/reset-password` (and the production equivalent) to Redirect URLs.
6. **Create your first super admin:** in the SQL editor
   ```sql
   insert into public.administrator_invitations (email, full_name, intended_role, token)
   values ('you@yourdomain.com', 'Your Name', 'super_admin', '');
   ```
   then Authentication → Users → **Invite user** with that email. The invitation trigger turns the new account into an active super-admin profile.
7. Restart `npm run dev` and sign in at `/login`.

### Demo data (development only)

Run `supabase/seed/01_demo_invitations.sql`, create the four `demo-*@example.com` users (Dashboard → Add user → Auto-confirm, your own passwords), then run `supabase/seed/02_demo_events.sql`.
You get 14 events covering all five statuses, Israel and the wider region, an ambiguous "Gaza" location, a critical breaking event and a likely duplicate.

### Verify the security model

Run `supabase/tests/rls_checks.sql` in the SQL editor after seeding. It impersonates anon / editor / viewer / admin / super admin exactly as the REST API does, runs 55 checks inside a transaction and rolls back. It ends with `ALL SECURITY CHECKS PASSED`, or stops at the first `FAIL: …`.

---

## What's built

### Public map (`/`) — no login
- Three columns: **live feed** (inline-start: left in English, right in Hebrew) · **map** with leaderboard banner above · **category legend + skyscraper** (≥1280px).
- Feed cards: time, relative age, breaking label, category badge, severity, title, summary, location, verification, source (only validated `http(s)` URLs become links), **Locate**.
- **Card → map:** smooth fly-to, zoom, popup, highlighted card. **Marker → card:** card highlighted and scrolled into view, popup opened. Selection lives in the URL (`?event=<id>`), so it can be shared and survives a reload.
- Category-coloured teardrop pins with the category's Lucide icon; critical events ringed, breaking events pulse (disabled under reduced motion).
- Search across title, description, places and category; empty, loading-skeleton and error/retry states; 60-second safe refresh (realtime arrives in Phase 6).
- Dark/light theme (tiles switch too), English/Hebrew with full RTL, phone layout with a Map/Feed switcher.
- **Ad slots:** 728×90 / 320×50 banner, 300×250 rectangle (docked under the feed on desktop, between cards on phones), 160×600 skyscraper. Fixed sizes, so filling them never shifts the layout. None appear in `/admin`.

### Phase 1 — foundation (complete)
| Requirement | Where |
|---|---|
| Supabase connection, env placeholders, setup state | `src/integrations/supabase/client.ts`, `.env.example`, `SetupNotice` |
| All tables (profiles, events, event_categories, event_history, audit_logs, administrator_invitations, + internal notes) | migration 0001 |
| 16 default categories with unique colour, icon, marker colour, Hebrew label | migration 0003, `src/data/categoryRegistry.ts`, `src/i18n` |
| Email/password login, logout, forgot & reset password, session persistence | `src/hooks/useAuth.tsx`, `src/pages/auth/*` |
| Redirect to login on session expiry, verifying-session loader, friendly access-denied page | `RequireAuth`, `AccessDenied` |
| Invitation-only accounts (no self-registration) | `handle_new_auth_user` trigger |
| Roles, statuses, central permission function | `public.role_permissions` / `has_permission` (DB) ⇄ `src/lib/permissions.ts` (UI) |
| Protected routes for every `/admin/*` path | `src/config/adminSections.ts` drives both router and sidebar |
| Row Level Security + guard triggers | migration 0002 + triggers in 0001 |
| Admin shell: fixed sidebar (desktop), collapsible rail (tablet), drawer (mobile), user menu | `src/components/admin/*` |
| MFA-ready | `authConfig.requireMfaForRoles`, AAL check in `useAuth` / `RequireAuth` |

Already enforced in the database ahead of the later phases' UI: the status workflow (valid transitions, permission per transition, publish requirements, mandatory rejection reason), server-set `published_at` / `approved_by`, immutable ownership, automatic event history and audit trail, admin/super-admin role rules, last-super-admin protection, and server-generated invitation tokens that are never readable through the API.

### Security model in one paragraph
The browser holds only the anon key. **anon** has no table privileges except listed public columns of `events` and active categories; RLS limits it to published, non-deleted rows; and the public site reads the `published_events` view, which filters again. Internal notes live in a separate staff-only table. Every write passes through `BEFORE` triggers that pin ownership to `auth.uid()`, validate transitions and check permissions, then `AFTER` triggers write history and audit rows the client cannot skip or forge. Event text is rendered via React or `textContent` only — never as HTML.

---

## Project structure

```
src/
  components/  admin/ auth/ common/ feed/ layout/ map/
  config/      map.ts (tile providers) · auth.ts · adminSections.ts (routes + nav + permissions)
  context/     ThemeContext
  data/        categoryRegistry.ts · demoEvents.ts
  hooks/       useAuth · usePermissions · useEvents · useMapSelection
  i18n/        en.ts · he.ts (typed — a missing Hebrew key is a compile error)
  integrations/supabase/client.ts
  lib/         permissions.ts
  pages/       public/ auth/ admin/
  services/    eventService · categoryService · userService · authService · auditService
  types/  utils/
supabase/
  migrations/  seed/  tests/rls_checks.sql
```

### Swapping the map provider
Everything provider-specific is in `src/config/map.ts` and `src/components/map/baseLayer.ts`. Set `VITE_MAP_TILE_PROVIDER=osm` or `carto`; the Google steps are documented at the top of `map.ts`.

> **Tile licensing:** CARTO and OpenStreetMap free tiles restrict heavy or commercial use. Because this site carries ads, move to a paid tile plan before launch.

---

## Next phases
- **Phase 2:** dashboard metrics, `/admin/events` table, `/admin/events/new` form, draft → review → publish actions.
- **Phase 3:** location extraction + modular geocoding service (Nominatim first), preview map with draggable marker.
- **Phase 4:** classification Edge Function with a rule-based fallback, confidence display, duplicate detection.
- **Phase 5:** user management UI, invitation emails via an Edge Function, audit-log and history viewers.
- **Phase 6:** realtime feed, filters, category layers, marker clustering.

The placeholder pages for these routes are already wired to authentication, permissions and the database tables behind them.
