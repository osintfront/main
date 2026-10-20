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
   supabase/migrations/20261019000004_lock_down_trigger_functions.sql
   supabase/migrations/20261019000005_location_resolution.sql
   supabase/migrations/20261019000006_location_refinement.sql
   supabase/migrations/20261020000007_home_front_alerts.sql
   supabase/migrations/20261020000008_event_lifecycle_and_manual_alerts.sql
   supabase/migrations/20261020000009_events_realtime_pulse.sql
   supabase/migrations/20261020000010_alert_area_pins_and_manual_timer.sql
   supabase/migrations/20261020000011_one_event_per_alert_area.sql
   supabase/migrations/20261020000012_merged_alert_shapes.sql
   supabase/migrations/20261020000013_event_sources_and_text_cleanup.sql
   supabase/migrations/20261020000014_intel_agents.sql
   supabase/migrations/20261020000015_intel_crawler_schedule.sql
   supabase/migrations/20261020000016_telegram_channels.sql
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

### Phase 2 — moderation (complete)
- **Dashboard** (`/admin`): published / drafts / pending / critical / active staff / created today, recent created · updated · published events, recent staff actions, quick actions.
- **Events table** (`/admin/events`): search, status, category, severity, country, verified, breaking, date range, "only mine", deleted view; publish, archive, duplicate and delete per row, all permission-aware; pagination.
- **Event editor** (`/admin/events/new`, `/admin/events/:id`): original report, event time, title, summary, category, severity, breaking, verified, source, internal notes, change history.
- **Location:** place search through a swappable geocoding module (`src/services/geocodingService.ts`, OpenStreetMap Nominatim, no key), click the map to drop a pin, drag to adjust, reverse lookup fills empty place fields, manual coordinates.
- **Workflow:** save draft · submit for review · publish · reject (reason required) · archive · back to draft · soft delete / restore, mirroring the database rules in `src/lib/eventWorkflow.ts`. Writes are conditional on the current status, so two people can't publish or reject the same event at once.

### Location resolution for imported reports (migrations 0005–0006)
- Events saved **without coordinates** are placed by the database from their place names (`location_name`, city, region, country) using the `place_gazetteer` table (~155 places in Israel, Gaza, the West Bank, Lebanon, Syria, Iran, Yemen, Iraq…), Hebrew and English, with Hebrew prefix letters (ב/ל/מ/ה…) handled.
- `location_precision` records how precise the pin is: `exact` · `city` · `region` · `country`. Region/country pins are shown with an **"Approx. location"** label on the public feed and popup.
- Every 5 minutes (`pg_cron` → `refine_event_locations`) region/country-level events whose specific place isn't in the gazetteer are looked up on OpenStreetMap Nominatim; a match is accepted only inside the same country and when the place's name matches.
- **Auto-publish:** drafts from sources listed in `app_settings.auto_publish` (default: names starting with "WhatsApp") publish themselves once they have a title, category and location. Toggle it in **Admin → Settings**.
- In the editor, publishing no longer needs a pin when a place name is filled in — the server places it on save.

### Home Front Command alerts — red alerts (migration 0007)
- **Source:** the free public feed of the Tzofar / "Tzeva Adom" app (`api.tzevaadom.co.il`), which relays Home Front Command alerts. The official `oref.org.il` feed blocks servers outside Israel, so it can't be polled from Supabase (Frankfurt). Tzofar is unofficial — **this map is not a life-safety system; people must rely on the official Home Front Command app and sirens.**
- **Polling:** pg_cron calls `hfc_ingest('live')` every 5 s and `hfc_ingest('history')` every 20 s (safety net). Every alert is stored once in `hfc_alerts` (unique per area + threat + time).
- **Polygons:** `hfc_areas` holds all ≈1,450 alert areas with their official polygons (refreshed weekly by `hfc_sync_areas()`), in PostGIS.
- **One event per alert area** (migration 0011): every alert area is its own event with its own polygon, pin, card and timer. A new alert of the same threat in the same area restarts that area's timer; the event disappears **10 minutes after its last alert**. Neighbouring areas are not merged (`app_settings.hfc_alerts.merge_km = 0`; a value above 0 turns spatial merging back on). Other settings: `ttl_minutes`, `include_drills`, `enabled`.
- **Merged shapes (display only, migration 0012):** the `active_hfc_shapes()` function unions the polygons of active alerts of the same threat that border each other, so neighbouring areas are drawn as one continuous polygon while their events, pins, cards and timers stay separate. When an area expires it drops out of the shape.
- **Public site:** reads the `active_hfc_alerts` view; a Realtime "pulse" (`hfc_pulse`) triggers an immediate refresh, with a 15 s poll as fallback. Alerts show as pulsing polygons coloured by threat with a siren pin, a "Red alert" banner on the map, cards with a countdown pinned at the top of the feed, and a "Home Front Command Alerts" category in the legend.
- **Admin → Settings:** turn the feature on/off and see when the feed was last checked successfully.

### Event lifetime, archive and manual red alerts (migration 0008)
- **24-hour live map:** a pg_cron job (every minute, `expire_events()`) moves published events to `archived` 24 hours after their event time (`app_settings.event_lifetime.hours`) and stamps `expired_at`. Red-alert events expire 10 minutes after publication.
- **Public archive** at `/archive?date=YYYY-MM-DD` (Live | Archive switch in the top bar): the `archived_events` view lists only events that expired automatically — never ones staff archived by hand.
- **Manual red alerts:** an event in the *Home Front Command Alerts* category is matched to alert areas by name (Hebrew/English/Arabic/Russian, with Hebrew prefix letters, cities split into sub-areas, gazetteer aliases such as Akko → Acre) or, failing that, by its pin. On publish it feeds the same clusters as the live feed (threat guessed from the text), so it shows as the official polygon instead of a pin. Red-alert events are always breaking.

### Push updates (migration 0009)
Every change that affects the public map (publish, edit while published, expiry to the archive, delete) bumps the one-row `events_pulse` table; red alerts bump `hfc_pulse`. The site listens to both over Supabase Realtime and refetches immediately, so visitors never need to refresh. Newly arrived events are highlighted with a "New" badge for 90 seconds. A 60-second poll remains as a safety net.

### WhatsApp ingest, duplicate reports and sources (migration 0013, `supabase/functions/whatsapp-ingest`)
- The `whatsapp-ingest` Edge Function (fed by the Chrome extension) classifies messages with Claude. A report of the **same incident within ±30 minutes** is not a new event: if it adds nothing concrete, only its source is added to the event's `sources` list (link when the message has one, otherwise the source name); if it adds concrete facts, only those facts are appended as "עדכון (HH:MM): …".
- The event window shows a **Sources** section (first report + further sources); cards show "+N sources".
- Report text is normalised on every write (`normalize_report_text`): trailing spaces/direction marks removed, runs of blank lines collapsed to one. Existing events were cleaned.
- Deploy the function with `verify_jwt = false` (it checks its own ingest token).

### News agents and the editor agent (migrations 0014–0015, `supabase/functions/intel-crawler`, `supabase/functions/_shared/editor.ts`)
- **Six country agents** — Lebanon, Yemen, Syria, Iran, International, Research institutes — each with its own list of sites from the Intelligence source list (`intel_sources`, 78 sites).
- pg_cron calls `intel-crawler` every 5 minutes; the function runs the agent that is due: every 30 minutes from 07:00 to 23:00 Israel time, every 60 minutes at night (`app_settings.intel_crawler`).
- An agent reads each site's RSS/Atom feed (found automatically) or, without a feed, the headline links on the page. The first visit only records what is already there (`baseline`), so old articles are never published. Articles older than 6 hours are skipped.
- One quick model call picks the significant Middle East items (max 5 per run); each goes to the **editor agent**, which translates, proofreads and summarises it into the house template (countries, title, one-paragraph summary, coordinates + Google Maps link, religious-text meaning, other implications, sources), checks names via English, adds roles/names, and may search **only the approved source sites**. Hebrew output with Arabic/Latin letters outside parentheses gets one correction round.
- Same story already on the map (last 12 h) → the article is added to that event's sources instead of a new event. Otherwise the event is published automatically.
- WhatsApp reports go through the same editor (in the background, a few seconds after the raw report appears).
- `events.whatsapp_text` holds the WhatsApp-ready version (staff only); the event editor shows it with a **Copy** button.
- **Admin → News agents** (`/admin/news-agents`): agents' last runs, every source with its state (RSS / page headlines / not reachable), on/off per source, add/remove sources, latest articles, and the master on/off switch.
- Sites that block automated readers (HTTP 401/403) or need a subscription are listed as "not reachable"; the agent does not try to get around blocks.
- Manual run (testing): `POST /functions/v1/intel-crawler` with header `x-cron-secret` (from `intel_config`) and body `{"agent":"lebanon","sync":true}`.

### Telegram channels (migration 0016, `supabase/functions/whatsapp-ingest/telegram.ts`)
- Public channels in `telegram_channels` (first: `@Hadashot_Bitachon`, "חדשות ביטחון בטלגרם") are read every minute from their web preview `https://t.me/s/<name>` — no bot, no login.
- pg_cron → `whatsapp-ingest` with `x-cron-secret` and `{"telegram_poll":true}` (`{"dry":true}` only parses). New posts take the WhatsApp path: classification, ±30-minute duplicates → sources, editor agent, up to 4 photos. The post's t.me link is the event's source link.
- The first read only records the newest post number; a per-channel lock stops overlapping polls.
- Admin → News agents → Telegram channels: add (link or @name), turn on/off, remove. Private groups cannot be read this way.

## Next phases
- **Phase 3:** automatic location extraction from free report text (place-name resolution already exists).
- **Phase 4:** classification Edge Function with a rule-based fallback, confidence display, duplicate detection.
- **Phase 5:** user management UI, invitation emails via an Edge Function, audit-log and history viewers.
- **Phase 6:** realtime feed, filters, category layers, marker clustering.

The placeholder pages for these routes are already wired to authentication, permissions and the database tables behind them.
