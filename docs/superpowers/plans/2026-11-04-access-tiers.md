# Stage A — Access Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open osintfront.com to guests, add self sign-up, and enforce per-plan daily limits on "expand" and satellite in the database.

**Architecture:** Plans and limits live in `plans` / `plan_features`. A new `feature_usage` table and RPCs (`consume_feature` for edge functions, `use_feature` for the browser) count and refuse uses atomically. RLS opens a 24-hour guest view. The React app reads the effective plan (`guest` when signed out) and shows lock / sign-up / upgrade dialogs.

**Tech Stack:** Supabase Postgres (migrations in `supabase/migrations`, applied with Supabase MCP `apply_migration`), Deno edge function `event-agent`, React + TypeScript + Vite, Playwright (pre-installed) for end-to-end checks.

**Spec:** `docs/superpowers/specs/2026-11-03-access-tiers-design.md`

## Global Constraints
- Migration numbering continues after `20261029000075`; one file per task, prefix `20261104`.
- SQL functions: `security definer`, `set search_path to ''`, revoke from `public, anon` unless stated.
- Staff (`role <> 'viewer'`) are never limited. While `app_settings.enforce_plans` is false nothing is refused (counting still happens).
- Limits: free `expand_daily` 3, free `satellite` 3, "day" = Asia/Jerusalem calendar day.
- Every "expand" request counts, cached or not.
- `enforce_plans` is switched on only in Task 9, after Playwright passes.
- Deploy edge functions as the one-line stub importing `raw.githubusercontent.com/osintfront/main/<commit>/…` (see build-status doc).
- No test runner exists: SQL tests are `supabase/tests/*.sql` scripts run inside `begin; … rollback;` via Supabase MCP `execute_sql`; each assertion is `do $$ begin assert …, 'msg'; end $$;`. Frontend checks are `npm run check` + Playwright scripts in `tests/e2e/`.

## Review Focus
- Two fast clicks on "expand" with 1 use left → exactly one succeeds (atomic increment). Test in Task 2.
- User signs up by email and never confirms → still sees guest view, `use_feature` returns `signup_required`. Test in Task 4.
- Plan expired (`plan_expires_at` past) on a Pro user → treated as free (3/day). Test in Task 2.
- Guest opens `/archive` or a deep link to an event older than 24 h → sign-up prompt, no data leak. Test in Task 3 (RLS) and Task 9 (UI).
- Day boundary: uses made at 23:59 and 00:01 Israel time count on different days. Test in Task 2.

---

### Task 1: Plans data — guest plan, new limits, viewers → Pro

**Files:**
- Create: `supabase/migrations/20261104000076_guest_plan.sql`
- Test: `supabase/tests/stage_a_plans.sql`

**Interfaces:**
- Produces: plan id `guest`; feature keys `expand_daily`, `satellite` (limit_value = uses/day, null = unlimited), `ships_aircraft` enabled for all; anon `select` on `plans`, `plan_features`, and `app_settings` rows `enforce_plans|require_terms|terms_version|privacy_version`.

- [ ] **Step 1: Write the test** — asserts: `plans` has `guest` (sort 0); `plan_features(expand_daily)`: guest disabled, free 3, pro/max/intel null; `satellite`: guest disabled, free enabled 3, pro/max/intel null; `ships_aircraft` enabled for all 5 plans; `archive_days` guest 0; `count(*) from profiles where role='viewer' and plan='free'` = 0 and those users have `plan_expires_at is null`; `set local role anon; select count(*) from plan_features` > 0.
- [ ] **Step 2: Run** via `execute_sql` → FAIL (`guest` missing).
- [ ] **Step 3: Write the migration** with `on conflict … do update` so it is re-runnable. The viewers→Pro update is `update profiles set plan='pro', plan_expires_at=null where role='viewer' and plan='free'` (runs once, before sign-ups open in Task 4).
- [ ] **Step 4: Apply** with `apply_migration`; re-run test → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(db): guest plan, daily limits, viewers to Pro"`

### Task 2: Server usage counter

**Files:**
- Create: `supabase/migrations/20261104000077_feature_usage.sql`
- Test: `supabase/tests/stage_a_usage.sql`

**Interfaces:**
- Consumes: Task 1 feature keys.
- Produces:
  - table `feature_usage(user_id uuid, feature_key text, day date, count int, primary key(user_id, feature_key, day))`, RLS on, own-row select.
  - `consume_feature(p_uid uuid, p_key text) returns jsonb` — service role only.
  - `use_feature(p_key text) returns jsonb` — `consume_feature(auth.uid(), p_key)`, granted to `authenticated`.
  - `my_feature_usage() returns jsonb` — `{ "<key>": {"used": n, "limit": n|null} }` for today, granted to `authenticated`.
  - Result shape: `{ "ok": bool, "reason": null|"signup_required"|"not_in_plan"|"quota_exceeded", "used": int, "limit": int|null, "remaining": int|null }`.

- [ ] **Step 1: Write the test** — with a temp viewer profile (free, active): 3× `consume_feature(uid,'expand_daily')` → ok, remaining 2,1,0; 4th → `ok=false, reason='quota_exceeded'`; with `enforce_plans=false` the 4th → `ok=true` (counted); profile `status='pending'` → `signup_required`; `p_uid null` → `signup_required`; guest-disabled key on free plan `insights` → `not_in_plan`; Pro with `plan_expires_at = now()-'1 day'` → limit 3; staff role `analyst` → ok, limit null; `day` uses `(now() at time zone 'Asia/Jerusalem')::date`; concurrency: `select consume_feature(uid,'satellite') from generate_series(1,5)` on a fresh row yields exactly 3 `ok=true`.
- [ ] **Step 2: Run** → FAIL (function missing).
- [ ] **Step 3: Implement** — effective plan = profile plan, or `free` if expired, or `guest` if no active profile. Atomic: `insert … on conflict do update set count = feature_usage.count + 1 where feature_usage.count < v_limit or not v_enforce returning count`; no row returned ⇒ `quota_exceeded`.
- [ ] **Step 4: Apply, run test** → PASS.
- [ ] **Step 5: Commit** `feat(db): feature_usage counter and use_feature RPC`

### Task 3: Guest read access (RLS)

**Files:**
- Create: `supabase/migrations/20261104000078_guest_read.sql`
- Test: `supabase/tests/stage_a_guest_read.sql`

**Interfaces:**
- Produces: anon `select` on `events` (status `published`, `deleted_at is null`, `occurred_at > now() - interval '24 hours'`), `event_media` of those events (`ready`), `ais_vessels`, `control_areas`, `lebanon_sects`, `layer_sync`. `wadi_lines` unchanged.

- [ ] **Step 1: Write the test** — `set local role anon`: count of events older than 24 h = 0; count of published last-24 h events = same as service-role count; drafts = 0; `select from wadi_lines` returns 0 rows; `select from ais_vessels` > 0 (if table non-empty).
- [ ] **Step 2: Run** → FAIL (anon sees 0 recent events).
- [ ] **Step 3: Implement** — replace policy `events: public reads published` (currently `false`); add new anon policies on the listed tables; leave member policies untouched.
- [ ] **Step 4: Apply, run test** → PASS.
- [ ] **Step 5: Commit** `feat(db): 24h guest read access`

### Task 4: Self sign-up profiles

**Files:**
- Create: `supabase/migrations/20261104000079_self_signup.sql`
- Test: `supabase/tests/stage_a_signup.sql`

**Interfaces:**
- Produces: `handle_new_auth_user()` — no pending invitation ⇒ insert profile `role 'viewer'`, `plan 'free'`, `status` = `active` if `email_confirmed_at` not null else `pending`, `full_name` from `raw_user_meta_data->>'full_name'` or `'name'`. Invitation path unchanged.

- [ ] **Step 1: Write the test** — insert into `auth.users` (id, email, raw_user_meta_data) without confirmation → profile `viewer/free/pending`; `consume_feature(id,'expand_daily')` → `signup_required`; set `email_confirmed_at = now()` → status `active`; consume → ok. Second case with an invitation → invited role kept.
- [ ] **Step 2: Run** → FAIL (no profile created).
- [ ] **Step 3: Implement** the `if not found` branch.
- [ ] **Step 4: Apply, run test** → PASS.
- [ ] **Step 5: Commit** `feat(db): create free profile on self sign-up`

### Task 5: "Expand" counts every request

**Files:**
- Modify: `supabase/functions/event-agent/index.ts` (`expand()` ~L100-125, request router for action `expand`)

**Interfaces:**
- Consumes: `consume_feature` (Task 2).
- Produces: HTTP answers for `{action:"expand"}`: no user ⇒ `401 {error:"signup_required"}`; refused ⇒ `429 {error:"<reason>", used, limit}`; existing `quotaGate` (USD credits) still applies to non-cached generation for Pro/Max.

- [ ] **Step 1: Write the check** — `tests/e2e/expand-quota.sh`: curl the deployed function as a test free user 4× on a cached event → 200,200,200,429 `quota_exceeded`; without JWT → 401.
- [ ] **Step 2: Run** against current deploy → FAIL (4th returns 200).
- [ ] **Step 3: Implement** — call `consume_feature(uid,'expand_daily')` before the cache check; staff skip.
- [ ] **Step 4: Push, deploy stub at new commit, run check** → PASS.
- [ ] **Step 5: Commit** `feat(event-agent): count every expand`

### Task 6: Client plan state

**Files:**
- Modify: `src/lib/plans.ts`, `src/types/user.ts` (`PlanId` += `'guest'`)
- Create: `src/lib/featureUse.ts`

**Interfaces:**
- Produces:
  - `effectivePlan(null) === 'guest'`; `loadPlanConfig()` runs for guests too (anon read from Task 1).
  - `FeatureKey` += `'expand_daily'`.
  - `useFeature(key: FeatureKey): Promise<UseResult>` — calls `rpc('use_feature')`; signed-out ⇒ `{ok:false, reason:'signup_required'}` without a request; network error ⇒ `{ok:false, reason:'error'}`.
  - `useFeatureUsage(): Record<string,{used:number;limit:number|null}>` hook (refreshes after each `useFeature`).
  - `type UseResult = { ok: boolean; reason: null|'signup_required'|'not_in_plan'|'quota_exceeded'|'error'; used: number; limit: number|null; remaining: number|null }`.

- [ ] **Step 1:** `npm run check` baseline (note the 2 existing errors in `AccessDenied.tsx`, `eventAdminService.ts`; no new ones allowed).
- [ ] **Step 2: Implement** the above.
- [ ] **Step 3:** `npm run check` → no new errors.
- [ ] **Step 4: Commit** `feat(app): guest plan and useFeature client`

### Task 7: Open map + gates in the UI

**Files:**
- Modify: `src/App.tsx:74` (drop `RequireAuth` on `/`), expand button component (find via `grep -rn "event-agent\|expand" src/components/feed`), push toggle in `src/lib/push.ts` caller, satellite toggle `src/components/map/IntelLayers.tsx:523`, archive nav link in `src/components/layout/TopNav.tsx`
- Create: `src/components/plans/GateDialog.tsx`, i18n keys in `src/i18n/he.ts` / `en.ts` under `gate.*`

**Interfaces:**
- Consumes: Task 6.
- Produces: `<GateDialog kind="signup"|"upgrade" feature={FeatureKey} onClose />` — signup ⇒ buttons "הרשמה" (`/login?mode=signup`) and "כניסה"; upgrade ⇒ text "נגמרו השימושים להיום" + link to plans page (`/about#plans` until a plans page exists).

- [ ] **Step 1: Write Playwright** `tests/e2e/guest.spec.mjs` (run on the Vercel preview URL): signed out, `/` shows map + feed (no redirect to `/login`); expand click ⇒ signup dialog; satellite toggle disabled with lock; push ⇒ signup dialog; `/archive` ⇒ login.
- [ ] **Step 2: Run** against preview of current `main` → FAIL (redirect to login).
- [ ] **Step 3: Implement** — expand: `useFeature('expand_daily')` before calling `event-agent`, map `signup_required`→signup dialog, `quota_exceeded|not_in_plan`→upgrade dialog, `error`→inline retry; satellite: `setSatOn(true)` only after `useFeature('satellite').ok`; free users see "נשארו X/3 היום" under both buttons.
- [ ] **Step 4:** push a branch, get the preview URL (Vercel MCP `list_deployments` by branch), run Playwright → PASS; `npm run check` clean.
- [ ] **Step 5: Commit** `feat(app): open map for guests with sign-up and upgrade gates`

### Task 8: Sign-up screen (email + Google)

**Files:**
- Modify: `src/pages/auth/LoginPage.tsx`, `src/services/authService.ts` (add `signUp(email,password,fullName)` and `signInWithGoogle()`), `src/hooks/useAuth.tsx`
- Create: `docs/owner/google-oauth-setup.md` (Hebrew, step-by-step for the owner)

**Interfaces:**
- Produces: `/login?mode=signup` tab; `signUp` uses `emailRedirectTo: ${VITE_SITE_URL}/`; `signInWithGoogle` uses `signInWithOAuth({provider:'google', options:{redirectTo: ${VITE_SITE_URL}/}})`; after sign-up a "check your email" screen.

- [ ] **Step 1: Write Playwright** `tests/e2e/signup.spec.mjs`: `/login?mode=signup` shows name/email/password + Google button; submitting a new `+e2e` address shows the check-email screen.
- [ ] **Step 2: Run on preview** → FAIL.
- [ ] **Step 3: Implement.** Owner doc covers: Google Cloud OAuth client (Web), redirect URI `https://kbfggmvrfevstzneqfzf.supabase.co/auth/v1/callback`, paste ID/secret in Supabase → Auth → Providers → Google; Supabase → Auth → enable sign-ups + "Confirm email"; Site URL `https://osintfront.com`.
- [ ] **Step 4: Run on preview** → PASS (Google button presence only; real Google login verified by the owner).
- [ ] **Step 5: Commit** `feat(auth): self sign-up with email and Google`

### Task 9: Rollout

- [ ] **Step 1:** Owner completes `docs/owner/google-oauth-setup.md`; confirm in Supabase that sign-ups are on.
- [ ] **Step 2:** Merge to `main`; Playwright `guest`, `signup`, and a free-user script (`tests/e2e/free.spec.mjs`: 3 expands then upgrade dialog; satellite 3 turn-ons then upgrade dialog) against production.
- [ ] **Step 3:** `update app_settings set value='true' where key='enforce_plans'`; re-run all three scripts → PASS.
- [ ] **Step 4:** Update `claude/osintfront-build-status.md` in the Project (Stage A done, enforce on). Commit tests.
