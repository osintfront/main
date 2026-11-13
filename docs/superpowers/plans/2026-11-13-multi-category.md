# Several classifications (multi-category): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (one executor, inline, alone). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An event keeps one main type (its icon) and gets up to two secondary types; type filters find secondary types by default with a switch to turn that off; two new types, Killed (skull) and Wounded (medical cross), exist.

**Architecture:** One new column `events.secondary_categories text[]`, kept clean by a database trigger and exposed last in both public views. The editor agent fills it inside the tool call it already makes (no extra AI call); `splitEvent.ts` keeps splitting by place and follows three small pure rules for secondaries. In the browser one helper, `eventCategorySlugs`, decides "main or any" for filters, sets, counts, push and the EEI fallback.

**Tech Stack:** React 19 + TypeScript + Tailwind 4 + Leaflet, Supabase (Postgres, Edge Functions on Deno), Vercel function `api/push.ts`, `node:test` run with `node --experimental-strip-types --test`, Playwright against a local build with a faked Supabase.

**Spec:** `docs/superpowers/specs/2026-11-13-multi-category-design.md` (approved, commit 5fb81b4). Read it first; this plan does not repeat its reasoning.

## Global Constraints

- Branch `feat/multi-category` (from `main` 466b40d). Nothing reaches `main`, the live database or a live function without the owner's yes — Task 7 has a separate **STOP** before each.
- **Deviations from the spec's rollout, and why:**
  - The two category rows are inserted **inactive** and switched on only after the site is merged. Reason: the live functions offer every *active* category to the AI, so an active row would be used at once, without the new rules, and the old site would draw it with the fallback dot.
  - The site (and `api/push.ts`, which ships with it on Vercel) is merged **before** the functions are deployed, so the first Killed event already has its skull.
  - `ai_search_candidates` and `api_events` change in the same migration as the column (they only read it); nothing is visible until events carry secondary types.
  - Hand-set secondary types survive an editor re-run: the RPC sets `ai_suggestions.manual_secondary = true` and the writers skip the column when it is set (the spec is silent; same idea as `manual_text`).
- Live order (exact): migration 109 → migration 110 → owner checks screenshots and the preview → merge → switch the two categories on → functions, one at a time → 50-event review.
- Values (exact): at most **2** secondary types; never secondary: `home-front-alerts`, `other`, `uncategorized`; main types that survive a split although no place carries them: `killed`, `wounded`, `assassination`; `wounded` is always placed after a kinetic type when the list is cut to two.
- New categories (exact): `killed` — name `Killed`, he `הרוגים`, icon `Skull`, colour `#27272a`; `wounded` — name `Wounded`, he `פצועים`, icon `MedicalCross`, colour `#701a75`. Never lucide `Cross`.
- Editor rules, in the owner's order: targeted killing → main `assassination`, secondary `killed`; deaths otherwise → main `killed`, secondary the kinetic type; deaths and wounded → main `killed`, secondary kinetic and/or `wounded`; wounded only → the strike stays main, `wounded` secondary; no kinetic type known → main `killed`, or `wounded` when nobody died. Places are tagged with the kind of the attack.
- Main type only: map icon, colour, cluster ring, legend, sound, push muting, dedupe, category learning, admin list filter, EEI server tagger. Main or secondary: type filter, sets, counts, push filters (unless `mainOnly`), EEI fallback (always), search box, ask the map, public API.
- No backfill. No new AI call anywhere. Model names and budgets are not touched.
- No Hebrew string literals in components: all text through `src/i18n/he.ts` and `en.ts`. Code, comments, commit messages in English.
- Unit tests: `node:test`, run `node --experimental-strip-types --test <file>` with the **exact file paths** listed in each task (a folder is not picked up by itself). No `@/` alias at run time in modules that tests load: relative imports with `.ts`, or `import type`.
- Type checks: `npm run typecheck` has 2 known errors (`src/components/auth/AccessDenied.tsx`, `src/services/eventAdminService.ts`) — "clean" = no new ones; `npx vite build` must succeed. Deno: copy `supabase/functions` to `/tmp/fncheck`, add `deno.json` `{"nodeModulesDir":"none"}`, run `deno check` on the touched entry files — 2 known errors (`_shared/imageHash.ts`, `_shared/layers.ts`), no new ones.
- Browser QA: no network to the site from the workspace. Copy the harness of `tests/e2e/filter-sets.mock.cjs` (env `PLAYWRIGHT_PATH=/opt/npm-tools/node_modules/playwright`, `CHROME_PATH=/usr/bin/google-chrome`; dismiss the cookie notice; random port).
- SQL tests run on the **live** database as a dry run: one `do $$ … $$` block that ends with `raise exception 'MULTI_CATEGORY_ALL_OK'`, so everything rolls back — that "error" text is the pass signal. Published test events need a `category_id`.
- Migrations: `supabase/migrations/YYYYMMDDHHMMSS_name.sql`; latest is `20261112000108_eei_cron.sql`. Applied to live only with the Supabase MCP `apply_migration`. A view is rewritten in full from its latest definition, with its current options.
- Functions deploy as a one-line stub importing `https://raw.githubusercontent.com/osintfront/main/<pushed commit>/supabase/functions/<fn>/index.ts`, `verify_jwt=false`. Live checks go through `pg_net` with the cron secret from `intel_config`.
- Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01Ka6fmoBGGuf9g4trFMvffK`.

## Review Focus

1. A Killed event whose places are tagged with the attack (`airstrike`) → every pin shows the skull, not the plane (`MapView` draws a place's own kind when it differs from the event's). Tests: Task 2 `afterSplit` / `singleKind` return `relabelPlaces`; Task 5 e2e "skull on every pin".
2. The same airstrike counted twice after a split (once as a sibling, once as a secondary of the original), or a `killed` main replaced by the kind of the first place → neither happens. Tests: Task 2 `afterSplit`.
3. The AI returns three types, the main type again, an unknown slug, `other`, `wounded` before the strike, or text instead of a list → at most two valid ones, kinetic first, nothing throws; the database gives the same answer for a writer that skips the cleaner. Tests: Task 2 `cleanSecondary`; Task 3 trigger checks.
4. Saved filters, filter sets and push filters written before this feature (no `mainOnly`), and events from a cached old view row (no `secondary_categories`) → secondary types are included, nothing crashes. Tests: Task 2 `sanitizeFilters`, `sanitizeSets`, `eventCategorySlugs` on an event without the field.
5. An analyst sets secondary types by hand, then the editor runs again on the event; or changes the main type to one of the secondary types → the hand-set list stays; the main type is never listed twice. Tests: Task 3 SQL (flag set by the RPC, trigger on `category_id` change); Task 4 writers check the flag.

---

### Task 1: The two new categories in every list

**Files:**
- Modify: `src/types/category.ts`, `src/data/categoryRegistry.ts`, `src/data/customIcons.ts*`, `src/i18n/he.ts`, `src/i18n/en.ts`, `api/_lib/pushFormat.ts`, `supabase/functions/_shared/eeiInput.ts`, `supabase/functions/_shared/splitEvent.ts`, `supabase/functions/_shared/dedupe.ts`, `supabase/functions/_shared/ask.ts`
- Test: `tests/categories/registry.test.ts` (new), `tests/eei/eeiInput.test.ts` (existing, unchanged)

**Interfaces:**
- Produces: slugs `'killed'`, `'wounded'` in `CategorySlug`; `CATEGORY_ICONS.Skull`, `CATEGORY_ICONS.MedicalCross`; `categoryRefBySlug(slug: string): CategoryRef | null` exported from `categoryRegistry.ts` (built from `DEFAULT_CATEGORIES`, `null` for an unknown slug).

- [ ] **Step 1: Write the failing test** `tests/categories/registry.test.ts` (header: `// Run: node --experimental-strip-types --test tests/categories/registry.test.ts`). It reads files as text (the registry imports React icons and is not loaded):
  - `categoryRegistry.ts` contains `{ slug: 'killed', name: 'Killed', icon: 'Skull', color: '#27272a' }` and `{ slug: 'wounded', name: 'Wounded', icon: 'MedicalCross', color: '#701a75' }`, both directly after the `assassination` line.
  - `he.ts` has `'category.killed': 'הרוגים'` and `'category.wounded': 'פצועים'`; `en.ts` has `Killed` / `Wounded`.
  - for each of `src/types/category.ts`, `api/_lib/pushFormat.ts`, `_shared/eeiInput.ts`, `_shared/splitEvent.ts`, `_shared/dedupe.ts`: the file mentions both `killed` and `wounded`.
  - `categoryRegistry.ts` does not import `Cross` from lucide (`/\bCross\b[,\s]/` has no match in the import block).
- [ ] **Step 2: Run** it and `tests/eei/eeiInput.test.ts` → the new file FAILS.
- [ ] **Step 3: Client lists.** `category.ts` slug list; registry rows and `categoryRefBySlug`; `Skull` imported from lucide and added to `CATEGORY_ICONS`; i18n keys.
- [ ] **Step 4: `MedicalCross`** in `customIcons` with `createLucideIcon('MedicalCross', [['path', { d: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z', key: 'cross' }]])` — the outline of a thick equal-armed cross on the 24×24 stroke grid, like its neighbours. Add it to `CATEGORY_ICONS`.
- [ ] **Step 5: Server and push lists.**
  - `eeiInput.ts` `CATEGORY_SLUGS`: add both.
  - `splitEvent.ts`: `HE.killed = "הרוגים"`, `HE.wounded = "פצועים"`; `EN.killed = "Killed"`, `EN.wounded = "Wounded"`.
  - `dedupe.ts` `FAMILY`: both `"kinetic"`; **not** added to `MOMENT`.
  - `ask.ts` prompt hint: `who was killed → assassination, killed`.
  - `pushFormat.ts` `CATEGORY_HE`: `killed: ['💀', 'הרוגים']`, `wounded: ['🚑', 'פצועים']`.
- [ ] **Step 6: Run** both test files → PASS; `npm run typecheck` → no new errors.
- [ ] **Step 7: Commit** `feat(categories): Killed and Wounded types in every list`.

### Task 2: Pure rules — server `secondaryCats.ts`, browser `eventCategorySlugs` and `mainOnly`

**Files:**
- Create: `supabase/functions/_shared/secondaryCats.ts` (**no imports at all**, like `_shared/askInput.ts`)
- Modify: `src/types/event.ts`, `src/lib/eventFilters.ts`, `src/lib/filterSets.ts`, `src/lib/eeiLens.ts`, `src/lib/quickReport.ts`, `src/services/composeService.ts` (type only)
- Test: `tests/categories/secondary.test.ts`, `tests/categories/quickReport.test.ts` (new); `tests/filters/eventFilters.test.ts`, `tests/filters/filterSets.test.ts`, `tests/eei/eeiLens.test.ts` (extended)

**Interfaces:**
- Produces (server, `secondaryCats.ts`):
  - `MAX_SECONDARY = 2`; `NEVER_SECONDARY: string[]`; `STICKY_MAIN: string[]` (values in Global Constraints).
  - `cleanSecondary(raw: unknown, allowed: Iterable<string>, main: string | null): string[]` — strings only, in `allowed`, not `main`, not in `NEVER_SECONDARY`, distinct, `wounded` moved to the end, first two.
  - `singleKind(a: { own: string | null; secondary: string[]; kind: string }): { secondary: string[]; relabelPlaces: boolean }` — all tagged places share `kind`. When `kind !== own`: `kind` is added to `secondary` if there is room (nothing is pushed out) and `relabelPlaces` is `true`.
  - `afterSplit(a: { own: string | null; secondary: string[]; groups: string[] }): { keepSlug: string; main: string; secondary: string[]; relabelPlaces: boolean }` — `groups` = the place kinds in order (two or more, known slugs only).
    - `keepSlug` = `own` when it is in `groups`, else `groups[0]` (today's rule).
    - `own` in `STICKY_MAIN` and not in `groups` → `main = own`; `secondary` = `keepSlug` first, then the old ones that are not in `groups`, cut to two; `relabelPlaces = true` (the kept places take `own` as their kind so the pins show the main icon).
    - otherwise → `main = keepSlug`; `secondary` = the old ones that are not in `groups` and not `main`; `relabelPlaces = false`.
- Produces (browser):
  - `PublicEvent.secondaryCategories: CategoryRef[]`; `EventInput.secondarySlugs?: string[]`; `ComposeResult.secondarySlugs: string[]`.
  - `eventCategorySlugs(e: PublicEvent, includeSecondary: boolean): string[]` in `eventFilters.ts` — main first; tolerates an event without `secondaryCategories`.
  - `EventFilters.mainOnly: boolean` (`EMPTY_FILTERS.mainOnly = false`); `SetFilter` gets it through `fromEventFilters` with no further change.
  - `splitByCategory` (same signature) follows `singleKind` / `afterSplit`: its parts carry `secondarySlugs`.

- [ ] **Step 1: Write the failing tests** `tests/categories/secondary.test.ts` (header with its run line), `ALL` = a set with the slugs used:
  - `cleanSecondary(['airstrike','airstrike','killed','nope','other',7,'uav'], ALL, 'killed')` → `['airstrike','uav']`.
  - `cleanSecondary(['wounded','airstrike','explosion'], ALL, 'killed')` → `['airstrike','explosion']`; `cleanSecondary(['wounded','airstrike'], ALL, 'killed')` → `['airstrike','wounded']`.
  - `cleanSecondary('airstrike', ALL, null)` → `[]`; `cleanSecondary(null, ALL, null)` → `[]`; `cleanSecondary(['home-front-alerts','uncategorized'], ALL, null)` → `[]`.
  - `singleKind({ own:'killed', secondary:[], kind:'airstrike' })` → `{ secondary:['airstrike'], relabelPlaces:true }`; with `secondary:['uav','wounded']` → unchanged list, `relabelPlaces:true`; `kind === own` → unchanged, `false`.
  - `afterSplit({ own:'killed', secondary:['wounded'], groups:['airstrike','artillery-shelling'] })` → `{ keepSlug:'airstrike', main:'killed', secondary:['airstrike','wounded'], relabelPlaces:true }`.
  - `afterSplit({ own:'airstrike', secondary:['artillery-shelling','killed'], groups:['airstrike','artillery-shelling'] })` → `main:'airstrike'`, `secondary:['killed']`, `relabelPlaces:false`.
  - `afterSplit({ own:'military-activity', secondary:['uav'], groups:['uav','drone'] })` → `main:'uav'`, `secondary:[]` (not sticky: today's behaviour).
  - `afterSplit({ own:null, secondary:[], groups:['uav','drone'] })` → `main:'uav'`.
- [ ] **Step 2: Extend the browser tests** (helper `ev(over)` as in `tests/filters/filterSets.test.ts`; `K = ev({ category:{slug:'killed'}, secondaryCategories:[{slug:'airstrike'}] })`):
  - `eventFilters.test.ts`: `eventCategorySlugs(K, true)` → `['killed','airstrike']`; `(K, false)` → `['killed']`; an event with no `secondaryCategories` field → `['uav']`. `matchesFilters(K, {…EMPTY_FILTERS, preset:'7d', categories:['airstrike']})` → `true`; the same with `mainOnly:true` → `false`; `categories:['killed'], mainOnly:true` → `true`. `sanitizeFilters({ categories:['uav'] }).mainOnly` → `false`; `sanitizeFilters({ mainOnly:'yes' }).mainOnly` → `false`; `activeFilterCount({…EMPTY_FILTERS, mainOnly:true})` → `0`.
  - `filterSets.test.ts`: a stored set whose filter has no `mainOnly` → `sanitizeSets` gives `mainOnly:false` and `matchesSetFilter(K, thatSet.filter)` with `categories:['airstrike']` → `true`; with `mainOnly:true` → `false`; `isEmptySet({…EMPTY_SET_FILTER, mainOnly:true})` → `true`.
  - `eeiLens.test.ts`: `topicFallback(K, { key:'t', label:'', priority:false, categories:['airstrike'], query:'' })` → `true`.
  - `tests/categories/quickReport.test.ts`: `splitByCategory` with main Killed and two places both `airstrike` → one part, `secondarySlugs:['airstrike']`, both places `category_slug:'killed'`; main Killed, places `airstrike` + `artillery-shelling` → first part keeps the Killed `categoryId`, `secondarySlugs:['airstrike']`, its places relabelled `killed`; second part Artillery with `secondarySlugs:[]`; main Airstrike with the same places → two parts, both `secondarySlugs:[]` (today's result).
- [ ] **Step 3: Run** the five files → FAIL.
- [ ] **Step 4: Implement** `secondaryCats.ts`, then the browser changes. `matchesFilters` line: `f.categories` against `eventCategorySlugs(e, !f.mainOnly)`. `topicFallback`: any of `eventCategorySlugs(e, true)`. `quickReport.ts` carries its own few lines for the two rules (it must not import from `supabase/functions`); the tests above keep both sides equal.
- [ ] **Step 5: Run** `tests/categories/secondary.test.ts`, `tests/categories/quickReport.test.ts`, `tests/filters/eventFilters.test.ts`, `tests/filters/filterSets.test.ts`, `tests/eei/eeiLens.test.ts` → PASS; `npm run typecheck` → no new errors (other files that build a `PublicEvent` get `secondaryCategories: []`).
- [ ] **Step 6: Commit** `feat(categories): pure rules for secondary types`.

### Task 3: Database — categories, column, trigger, views, functions

**Files:**
- Create: `supabase/migrations/20261113000109_killed_wounded_categories.sql`, `supabase/migrations/20261113000110_secondary_categories.sql`, `supabase/tests/multi_category.sql`

**Interfaces:**
- Produces:
  - `event_categories` rows `killed`, `wounded` with **`is_active = false`**.
  - `events.secondary_categories text[] not null default '{}'`, check `cardinality(secondary_categories) <= 2`.
  - trigger `events_clean_secondary_categories` (function `public.clean_secondary_categories()`).
  - `published_events.secondary_categories`, `archived_events.secondary_categories` (last column of each).
  - `public.set_event_secondary_categories(p_id uuid, p_slugs text[]) returns void` — granted to `authenticated`.
  - `ai_search_candidates(...)` and `api_events(...)`: same arguments; `api_events` items gain `"secondary_categories"`.

- [ ] **Step 1: Write `supabase/tests/multi_category.sql`** in the style of `supabase/tests/eei_text.sql` (users inserted into `auth.users`, roles set on `profiles`, `set local role` / `request.jwt.claims` as that file does), ending with `raise exception 'MULTI_CATEGORY_ALL_OK'`. It first sets `is_active = true` on the two new rows (rolled back with the rest). Checks, each raising its own message on failure:
  1. rows `killed` (`Skull`, `#27272a`, he `הרוגים`) and `wounded` (`MedicalCross`, `#701a75`, he `פצועים`) exist.
  2. insert a published event with main `killed` and `secondary_categories = '{airstrike,killed,airstrike,nope,other,uav}'` → stored `{airstrike,uav}`.
  3. `'{wounded,airstrike,explosion}'` → `{airstrike,explosion}`; `'{wounded,airstrike}'` → `{airstrike,wounded}`.
  4. update that event's `category_id` to `airstrike` → `airstrike` leaves the list.
  5. a secondary slug whose category is inactive is dropped.
  6. as a `viewer`: the RPC raises `42501`. As an analyst with `event.edit.any`: `set_event_secondary_categories(id, '{force-sighting}')` stores it and sets `ai_suggestions ->> 'manual_secondary' = 'true'`; three slugs → `22023`; an unknown slug → `22023`; an empty array clears the list and keeps the flag.
  7. the last column of `published_events` and of `archived_events` (by `information_schema.columns.ordinal_position`) is `secondary_categories`, and a member reading `published_events` sees `{airstrike,uav}` on the event of check 2.
  8. `ai_search_candidates(now() - interval '1 day', null, '{}', '{}', '{uav}', '{}', 50)` returns the event of check 2 (main `killed`, secondary `uav`) and, when a second test event has main `uav`, ranks that one first.
  9. `api_events` with `p_category = 'uav'` returns the event of check 2 and its item has `secondary_categories`.
- [ ] **Step 2: Write migration 109** (house-style header). `insert … values` for both rows with `is_active = false`, `sort_order` = the value of `assassination` + 1 (read it from `20261019000003_default_categories.sql` and later migrations; if taken, the next free one), descriptions: `People killed: reports whose news is the dead.` / `People wounded, when nobody was reported killed.`; `on conflict (slug) do nothing`. Also `create or replace function public.set_place_category` — the body of `20261026000056_place_edits.sql` **unchanged** except two added `when` lines in the Hebrew-name `case` (`'killed' then 'הרוגים'`, `'wounded' then 'פצועים'`), with its `revoke` / `grant` lines repeated.
- [ ] **Step 3: Write migration 110.**
  - Column and check.
  - `clean_secondary_categories()`: `before insert or update of secondary_categories, category_id on public.events`; returns early when the list is empty; keeps, in order, slugs that are active in `event_categories`, differ from the row's main slug and are not in the never-secondary list, distinct, `wounded` last, first two. `security definer`, `set search_path to ''`, execute revoked from `public, anon, authenticated` (as `20261019000004_lock_down_trigger_functions.sql` does).
  - Both views written out in full from `20261110000103_plan_tightening.sql` with `e.secondary_categories` added as the last column. Keep their options: read them on live in Task 7 before applying (`select relname, reloptions from pg_class where relname in ('published_events','archived_events')`) and write the same `with (...)`.
  - `set_event_secondary_categories`: the permission block of `set_event_category` (`20261028000070_event_category_places.sql`); `22023` when `cardinality(p_slugs) > 2` or a slug is not an active category; one `update` setting the column and `ai_suggestions = coalesce(ai_suggestions,'{}') || '{"manual_secondary":true}'`. `revoke … from public, anon`; `grant execute … to authenticated`.
  - `ai_search_candidates` from `20261023000035_ai_search.sql`: score `+2` when `e.secondary_categories && p_categories` and the main slug did not match; `topic_ok` also true on that overlap. Same `revoke`.
  - `api_events` from `20261029000072_public_api.sql`: the item gains `'secondary_categories', to_jsonb(e.secondary_categories)`; the filter becomes `p_category is null or c.slug = p_category or p_category = any(e.secondary_categories)`. Same grants.
- [ ] **Step 4: Check by reading:** each rewritten object is copied from its **latest** definition (`grep -rn "function public.<name>\|view public.<name>" supabase/migrations`); no column of the views moved; the test file names only objects that exist.
- [ ] **Step 5: Commit** `feat(categories): database — new types, secondary column, trigger, views, search`.

### Task 4: Server — editor output, prompts, writers, split

**Files:**
- Modify: `supabase/functions/_shared/editor.ts`, `_shared/categoryRules.ts`, `_shared/splitEvent.ts`, `supabase/functions/whatsapp-ingest/index.ts`, `supabase/functions/event-agent/index.ts`, `supabase/functions/intel-crawler/index.ts`
- Test: `tests/categories/secondary.test.ts` (Task 2), `tests/categories/rules.test.ts` (new, text checks)

**Interfaces:**
- Consumes: `cleanSecondary`, `singleKind`, `afterSplit` (Task 2); column `secondary_categories` and the flag `ai_suggestions.manual_secondary` (Task 3).
- Produces: `EditResult.secondary_category_slugs: string[]`; `CATEGORY_RULES` holds the killed / wounded / secondary rules; `event-agent` compose answers `secondarySlugs: string[]`.

- [ ] **Step 1: Write the failing test** `tests/categories/rules.test.ts` (reads files as text): `categoryRules.ts` contains `killed`, `wounded`, `assassination` and the words `Secondary types`; `editor.ts` contains `secondary_category_slugs` and `maxItems: 2`; each of the three entry files contains `secondary_categories` and `manual_secondary`.
- [ ] **Step 2: `categoryRules.ts`** — append to `CATEGORY_RULES`, in English, in the file's bullet style: the five owner rules of Global Constraints with one example each (`"Three killed in an airstrike on X" → main killed, secondary airstrike`; `"Airstrike on X, two wounded" → main airstrike, secondary wounded`; `a commander killed in a strike on his car → main assassination, secondary killed`); "Deaths not caused by violence (accident, illness, disaster) keep their own kind"; "A place is tagged with the kind of the attack, never killed / wounded, unless the means is unknown"; and the spec's "Secondary types" paragraph (same incident only, empty for most reports, never the main type, never a different incident in another place).
- [ ] **Step 3: `editor.ts`** — in `tool()`, when `categories.length`: property `secondary_category_slugs` `{ type: 'array', maxItems: 2, items: { type: 'string', enum: slugs }, description: 'Other kinds of the SAME incident (see the category rules). Usually empty.' }`, not required. `normalise` fills `secondary_category_slugs` with `cleanSecondary(raw.secondary_category_slugs, cats, category_slug)`. In `SYSTEM_DETAILED_PLACES` add the place rule in the prompt's own language.
- [ ] **Step 4: `splitEvent.ts`** — replace the two inline decisions with the pure rules; everything else stays.
  - one kind: `singleKind` → write `secondary_categories` and, when `relabelPlaces`, the relabelled `locations` (today's update).
  - several kinds: `afterSplit` → the original's `category_id` = `main`; headline from `HE[main]` / `EN[main]`; `secondary_categories` = its result; kept places relabelled when `relabelPlaces`. Siblings are inserted with no secondary types (the column is not in `CLONE`; do not add it).
  - an event with `ai_suggestions.manual_secondary` keeps its list (only the sibling slugs are removed).
- [ ] **Step 5: Writers** — each writes `secondary_categories: r.secondary_category_slugs` together with the places, unless the event has `ai_suggestions.manual_secondary`:
  - `whatsapp-ingest`: in the editor step, into `update` and into `PLACE_KEYS` (so it lands with the places, before the split). The triage prompt (near the artillery line) gets the main-type rules: deaths → `killed` unless a targeted killing (`assassination`); wounded only → the kind of the attack; no attack kind known → `killed` / `wounded`.
  - `event-agent`: the edit action's `update`; compose returns `secondarySlugs`.
  - `intel-crawler`: the insert row.
- [ ] **Step 6: Deno check** (Global Constraints) on `whatsapp-ingest/index.ts`, `event-agent/index.ts`, `intel-crawler/index.ts` → only the 2 known errors. If `deno` is missing, say so in the hand-over and rely on Step 7.
- [ ] **Step 7: Run** `tests/categories/rules.test.ts`, `tests/categories/secondary.test.ts`, `tests/eei/eeiInput.test.ts`, `tests/ask/askInput.test.ts`, `tests/ask/askChat.test.ts` → PASS.
- [ ] **Step 8: Commit** `feat(categories): editor returns secondary types; split keeps a Killed main`.

### Task 5: Site — data, badges, filter switch, counts, push, e2e

**Files:**
- Modify: `src/services/eventService.ts`, `src/components/common/Badges.tsx`, `src/components/feed/EventCard.tsx`, `src/components/feed/EventDetailsDialog.tsx`, `src/components/map/MapView.tsx`, `src/components/map/popupContent.ts`, `src/components/filters/FilterPanel.tsx`, `src/pages/public/MapPage.tsx`, `src/i18n/he.ts`, `src/i18n/en.ts`, `api/push.ts`, the stylesheet that holds `.ofm-category-chip` and `.ofm-popup__category`
- Create: `tests/e2e/multi-category.mock.cjs`

**Interfaces:**
- Consumes: `categoryRefBySlug` (Task 1); `eventCategorySlugs`, `EventFilters.mainOnly`, `PublicEvent.secondaryCategories` (Task 2); view column (Task 3).
- Produces: `CategoryBadge({ category, secondary?: boolean })`; i18n keys `filters.includeSecondary` (he `כולל סוגים משניים`, en `Include secondary types`), `event.alsoTypes` (he `גם: {types}`, en `Also: {types}`); DOM hooks `data-secondary-type="<slug>"` on every secondary badge and `data-testid="include-secondary"` on the switch.

- [ ] **Step 1: `eventService.ts`** — add `secondary_categories` to the column list and row type; map with `categoryRefBySlug`, drop unknown slugs and the main slug, at most two. A row without the field → `[]`.
- [ ] **Step 2: Badges.** `CategoryBadge` with `secondary`: same icon and label, outline in `--chip-color`, no fill, one size smaller text; a visually hidden `event.alsoTypes` before the first one. Shown after the main badge in `EventCard` and `EventDetailsDialog` (also for the related events listed there). `popupContent.ts`: `labels.secondary?: { slug: string; label: string; color: string }[]` rendered as outlined chips after the category chip; `MapView` passes them for the event's own pin and for its place pins.
- [ ] **Step 3: `FilterPanel.tsx`** — under the event-type chips a checkbox (`data-testid="include-secondary"`), checked when `!view.mainOnly`, `onChange` → `set({ mainOnly: !checked })`; present in the general filter and in every set (same `view` / `set`). Counts: `for (const e of without({ categories: [] })) eventCategorySlugs(e, !view.mainOnly).forEach((s) => bump(cat, s))`.
- [ ] **Step 4: `MapPage.tsx`** — `matchesQuery` gets the labels of the secondary types in its text. Sound stays on `e.category.slug`. Nothing else changes (legend, alerts, `setFilters({ categories: [slug] })`).
- [ ] **Step 5: `api/push.ts`** — add `secondary_categories` to `cols`; the lean event gets `secondaryCategories: (r.secondary_categories ?? []).map((slug) => ({ slug }))`. Muting stays `muted.has(r.category_slug)`.
- [ ] **Step 6: `tests/e2e/multi-category.mock.cjs <he|en> <desktop|phone>`** — copy the harness of `tests/e2e/filter-sets.mock.cjs` (header comment with the run line; faked Supabase; cookie notice dismissed; random port; signed in as pro). Faked events, all in the last 3 hours: **A** main `killed`, secondary `['airstrike']`, two places both tagged `killed`; **B** main `airstrike`, secondary `['wounded']`; **C** main `airstrike`, none; **D** main `artillery-shelling`, secondary `['force-sighting']`; **E** main `assassination`, secondary `['killed','airstrike']`. Assertions:
  1. card A shows the Killed badge and one `[data-secondary-type="airstrike"]`; card C shows no `[data-secondary-type]`.
  2. both pins of A carry the skull icon (the marker's SVG contains the `Skull` path; no plane icon on them).
  3. choose the type Airstrike → cards A, B, C, E stay, D goes; the Airstrike chip count is 4.
  4. clear `[data-testid="include-secondary"]` → only B and C stay; the count is 2; reload → the switch is still off.
  5. switch on again, choose only Wounded → only B; choose only Killed → A and E.
  6. the legend lists Killed with count 1 and has no Wounded row.
  7. `en`: labels read `Killed`, `Wounded`, `Include secondary types`; `he`: `הרוגים`, `פצועים`, `כולל סוגים משניים`.
  8. screenshots saved for the owner: the map with the skull pin and a hand-made Wounded-main pin, light and dark map (`/tmp/multi-category-<lang>-<theme>.png`).
- [ ] **Step 7: Run** every unit file of Tasks 1–4 plus `tests/i18n/no-hebrew-literals.test.ts`, `tests/map/lookalikes.test.ts`, `tests/infra/popup.test.ts` → PASS; `npm run typecheck` → no new errors; `npx vite build` → succeeds; the new e2e for `he desktop`, `en desktop`, `he phone` → all assertions pass; regressions `tests/e2e/filter-sets.mock.cjs` (pro), `tests/e2e/eei.mock.cjs` (pro), `tests/e2e/ask-chat.mock.cjs` → pass as before.
- [ ] **Step 8: Commit** `feat(categories): secondary badges, filter switch, counts, push`.

### Task 6: Admin editing

**Files:**
- Create: `src/components/admin/SecondaryTypesField.tsx`
- Modify: `src/services/eventAdminService.ts`, `src/components/feed/EventStaffEdit.tsx`, `src/pages/admin/EventEditorPage.tsx`, `src/pages/admin/EventsListPage.tsx`, `src/lib/quickReport.ts` (`applyCompose`), `src/i18n/he.ts`, `src/i18n/en.ts`, `tests/i18n/no-hebrew-literals.test.ts` (add the new component to `FILES`)

**Interfaces:**
- Consumes: RPC `set_event_secondary_categories` (Task 3); `ComposeResult.secondarySlugs`, `EventInput.secondarySlugs` (Task 2).
- Produces: `setEventSecondaryCategories(id: string, slugs: string[]): Promise<void>` in `eventAdminService.ts`; `AdminEvent.secondarySlugs: string[]`; `SecondaryTypesField({ value, mainSlug, categories, onChange, disabled? })` — up to two removable chips and an "add" select that hides the main type, chosen types and the never-secondary slugs; i18n keys `form.secondaryTypes`, `form.addSecondaryType`, `form.secondaryLimit` (en `Up to two secondary types`), `list.secondarySaved`.

- [ ] **Step 1: Service** — select `secondary_categories` in the admin columns; `setEventSecondaryCategories` calls the RPC and throws its message.
- [ ] **Step 2: `SecondaryTypesField`** and its keys in both languages.
- [ ] **Step 3: `EventStaffEdit.tsx`** — the field under the type select; a change saves at once through the service, with the same toast and roll-back-on-error pattern as the type select there.
- [ ] **Step 4: `EventEditorPage.tsx`** — the field in the form, bound to `input.secondarySlugs`; `applyCompose` copies `r.secondarySlugs`; after `createEvent` / `updateEvent` succeeds and the list differs from the saved one, call `setEventSecondaryCategories` for the event (for a quick-compose split: for each created part with its own `secondarySlugs`).
- [ ] **Step 5: `EventsListPage.tsx`** — read-only outlined chips next to the inline type select.
- [ ] **Step 6: Run** `tests/i18n/no-hebrew-literals.test.ts`, `tests/categories/quickReport.test.ts` → PASS; `npm run typecheck` → no new errors; `npx vite build` → succeeds; `tests/e2e/multi-category.mock.cjs he desktop` still passes.
- [ ] **Step 7: Commit** `feat(categories): staff can set secondary types`.

### Task 7: Go live, one approval at a time

**Files:**
- Modify: the project build-status doc in the repo, if one exists there (else hand the text to the owner).

- [ ] **Step 1: Final local pass** — Task 5 Step 7 and the Deno check of Task 4 Step 6. Push the branch (needed for the function stubs and the Vercel preview); no merge.
- [ ] **Step 2: STOP — ask to apply the two database changes.** Say: two new event types are added but stay switched off; one new column on events; the two public views get one more column at the end; search and the public API also look at it. Nothing changes on the site yet.
- [ ] **Step 3: Dry run, then apply.** With `execute_sql`: confirm the live definitions match what the migrations were copied from (`pg_get_viewdef` of both views against migration 103, `reloptions`, `pg_get_functiondef` of `set_place_category`, `ai_search_candidates`, `api_events`); if one differs, fix the migration from the live text first and tell the owner. Dry run in one `execute_sql` batch: `begin;` + migration 109 + migration 110 + `supabase/tests/multi_category.sql`; the final `MULTI_CATEGORY_ALL_OK` exception aborts the transaction, so everything rolls back (send `rollback;` afterwards) → that text is the pass; any other error is a failure to fix first. Then `apply_migration` 109, then 110. Verify: both rows exist with `is_active = false`; `select count(*) from published_events` answers as guest and as member; the column is last in both views; `get_advisors` shows nothing new.
- [ ] **Step 4: STOP — show the owner the icons and the preview.** Send the screenshots of Task 5 Step 6.8 (skull and medical cross, light and dark map) and ask him to open the branch preview; with his yes, give three recent live events a secondary type by hand through the new RPC path (existing types only, e.g. airstrike + force-sighting) so he sees badges, the switch and the counts. Changes he asks for (icon, colour, wording) are made and re-checked before going on.
- [ ] **Step 5: STOP — ask to merge the site.** Say: badges, the filter switch and staff editing go live; phone notifications follow the same rule; no event has Killed / Wounded yet. Merge `feat/multi-category` to `main` only after his yes; confirm with him that the live site shows the hand-set badges.
- [ ] **Step 6: STOP — ask to switch on Killed and Wounded and update the first function.** Before asking, read each function's deployed commit with `get_edge_function` and list which need a new deploy: every function that imports a touched file (`grep -ln "editor.ts\|splitEvent.ts\|categoryRules.ts\|secondaryCats.ts\|dedupe.ts\|eeiInput.ts\|ask.ts" supabase/functions/*/index.ts supabase/functions/*/*.ts`) — expected `whatsapp-ingest`, `intel-crawler`, `event-agent`, and `eei-runner` only if its import graph reaches `eeiInput.ts`. Say: from this moment new reports can get the skull and secondary types; old events stay as they are.
- [ ] **Step 7: Switch on and deploy `whatsapp-ingest`.** `update public.event_categories set is_active = true where slug in ('killed','wounded')`; deploy the stub at the pushed commit. Check through `pg_net` with the cron secret that it answers as before (the same call used for its last deploy), and in `ingest_log` that the next real posts are processed without errors.
- [ ] **Step 8: STOP — ask to update `intel-crawler`;** deploy; check its next run in its log table.
- [ ] **Step 9: STOP — ask to update `event-agent`** (it is behind "expand", "ask the map", EEI and the report form); deploy; check through `pg_net` that an existing action still answers and that an `ask` about "who was killed today" returns events. Deploy `eei-runner` under the same yes only if Step 6 listed it.
- [ ] **Step 10: STOP — ask for the 50-event review.** Say what he will get and that nothing is changed by it.
- [ ] **Step 11: Review.** After at least 50 events were created since Step 7: with `execute_sql`, list the newest 50 published events that have a secondary type or whose main type is `killed`, `wounded` or `assassination` (time, headline, main, secondary), and give four numbers for all events since Step 7: share with any secondary type; count with main `killed`; count with main `wounded`; count of strike types (airstrike, artillery, rockets, UAV) compared with the same hours a day earlier. Check against the owner's rules: deaths → main Killed with the strike secondary; wounded only → secondary; targeted killing → Assassination with Killed secondary; pins of a Killed event show the skull. Send the table and the numbers in plain language; prompt fixes he asks for go through Task 4 Step 2 and a new deploy with its own STOP.
- [ ] **Step 12: Roll-back note in the hand-over:** switch the two types off (`is_active = false`) and redeploy the three functions at their previous commits (recorded in Step 6); the column and the site can stay.
- [ ] **Step 13: Write the project-doc section** (what it does, the rules, the two migrations, the functions and their commits, how to roll back) and hand it to the owner.
