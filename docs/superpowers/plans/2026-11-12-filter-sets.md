# Several filters ("filter sets"): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user keep up to 6 named, coloured filters ("sets"), each a full filter of its own (countries, drawn areas, event types, time, severity, source, media…), and show every event that fits at least one set that is on.

**Architecture:** All rules live in one pure file, `src/lib/filterSets.ts`, unit-tested without a browser. `MapPage` holds the sets (saved in `localStorage` by a small hook) and swaps one step of its pipeline: when at least one set is in force, the sets replace the general filter; with no set, today's code path runs untouched. `FilterPanel` gets a scope row (`General` · set chips · `+ Add set`) and reuses its existing sections to edit the chosen set. The only server change is five `plan_features` rows.

**Tech Stack:** React 19 + TypeScript + Tailwind 4 + Leaflet, Supabase (one rows-only migration), `node:test` run with `node --experimental-strip-types --test`, Playwright against a local build with a faked Supabase.

**Spec:** `docs/superpowers/specs/2026-11-12-filter-sets-design.md` (approved). Read it first; this plan does not repeat its reasoning.

## Global Constraints

- Branch `feat/filter-sets` (checked out, on top of `feat/ask-map-chat`). Nothing reaches `main` or the live database without the owner's yes.
- **`app_settings.enforce_plans` is `true` on the live database.** So the migration must be applied **before** the client ships (Task 5), and only after an explicit "stop and ask the owner" step. This replaces the order written in the spec's Rollout section.
- Limits (exact): `MAX_SETS = 6`, `MAX_POLYGONS = 3` per set, `MAX_POLYGON_POINTS = 200`, `MAX_NAME = 40`.
- Colours (exact, in this order): `#7c3aed`, `#d97706`, `#059669`, `#db2777`, `#0891b2`, `#65a30d`.
- Storage key `ofm.filterSets.v1`. The general filter's key `ofm.filters.v1`, its shape and `matchesFilters` behaviour do not change.
- Plan rows `filter_sets`: guest `false / 0`, free `true / 1`, pro, max, intel `true / 6`.
- No AI calls, no Edge Function change, no new table. Push (`syncPush`), `SocialSearchButton`, `OfiFab` keep reading the general filter.
- Live map only: on `/archive` (`mode="archive"`) sets are neither shown nor applied.
- No Hebrew string literals in components: all text through `src/i18n/he.ts` and `en.ts`. Code, comments and commit messages in English.
- Unit tests: `node:test`, run `node --experimental-strip-types --test <file>`. The runner has **no `@/` alias**: pure modules under `src/lib` that tests load must import only by relative path with the `.ts` extension (as `src/lib/military.ts` does) or `import type`.
- `npm run typecheck` already reports 2 errors on this branch (`src/components/auth/AccessDenied.tsx`, `src/services/eventAdminService.ts`). "Clean" means **no new errors**. `npx vite build` must succeed.
- Browser QA cannot reach osintfront.com, Supabase or Vercel from the workspace. Playwright runs against a local build with a faked Supabase, copying the harness of `tests/e2e/ask-chat.mock.cjs` (build with `VITE_SUPABASE_URL=https://fake.supabase.co`; every Supabase request routed; env `PLAYWRIGHT_PATH=/opt/npm-tools/node_modules/playwright`, `CHROME_PATH=/usr/bin/google-chrome`).
- Migrations: `supabase/migrations/YYYYMMDDHHMMSS_name.sql`; the latest is `20261111000105_admin_email_otp.sql`. Applied to live only through the Supabase MCP `apply_migration`, after the owner approves.
- Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01Ka6fmoBGGuf9g4trFMvffK`.
- Do not commit to `main`; do not push or merge without the owner's yes (Task 5).

## Review Focus

1. Saved sets that were edited by hand, cut off, or written by another version (not an array, a set without `filter`, corners that are `NaN`, 50 sets, an unknown colour) → the page loads, the valid part is kept, nothing throws. Tests: Task 1 `sanitizeSets`.
2. More saved sets than the plan allows (plan ended, or limit 0) → nothing is deleted, only the first `limit` sets can be in force, and with limit 0 the general filter is in force. Tests: Task 1 `setsOn` / `isLocked`; Task 4 e2e as Free with 3 saved sets.
3. Two sets with time ranges far apart: the archive is loaded as one covering range, but an event that falls between the two ranges must **not** appear. Test: Task 1 `matchingSets` "between two windows".
4. An event with several places that fits two sets (one by a drawn area, one by country) → shown once, coloured by the first set in the list. Test: Task 1.
5. A drawing that ends after its set is gone, locked, or already has 3 areas (or that is cancelled) → nothing is added anywhere; the shape never lands in the general filter. Tests: Task 1 `addPolygon`; Task 4 e2e "cancel drawing".

---

### Task 1: Rules — `src/lib/filterSets.ts`

**Files:**
- Create: `src/lib/filterSets.ts`
- Modify: `src/lib/eventFilters.ts` (export `eventPoints`, line ~267; extract `sanitizeFilters` from `loadFilters`, lines ~320–337)
- Test: `tests/filters/filterSets.test.ts`, `tests/filters/eventFilters.test.ts`

**Interfaces:**
- Produces (`eventFilters.ts`, no behaviour change):
  ```ts
  export function eventPoints(e: PublicEvent): LatLng[];
  /** The cleaning loadFilters does today, on an already-parsed value. Non-object → EMPTY_FILTERS. */
  export function sanitizeFilters(raw: unknown): EventFilters;
  ```
- Produces (`filterSets.ts`; imports `./eventFilters.ts` by relative path, types by `import type`):
  ```ts
  export const MAX_SETS = 6, MAX_POLYGONS = 3, MAX_POLYGON_POINTS = 200, MAX_NAME = 40;
  export const SET_COLORS: readonly string[];            // the six colours, in the order above
  export type SetFilter = Omit<EventFilters, 'polygon' | 'eeis'> & { polygons: LatLng[][] };
  export interface FilterSet { id: string; name: string; color: string; enabled: boolean; filter: SetFilter; text?: string } // text: reserved for EEI, ignored
  export const EMPTY_SET_FILTER: SetFilter;              // EMPTY_FILTERS fields, polygons: []
  export function toEventFilters(f: SetFilter): EventFilters;                       // polygon: null, eeis: []
  export function fromEventFilters(f: EventFilters, polygons: LatLng[][]): SetFilter;
  export function matchesSetFilter(e: PublicEvent, f: SetFilter, now?: number): boolean;
  export function planSetLimit(hasFeature: boolean, limit: number | null): number;  // no feature → 0; else min(limit ?? 6, 6), never below 0
  export function isLocked(sets: FilterSet[], id: string, limit: number): boolean;  // position in the list ≥ limit
  export function setsOn(sets: FilterSet[], limit: number): FilterSet[];            // the first `limit` sets, of those the enabled ones
  export function matchingSets(e: PublicEvent, active: FilterSet[], now?: number): FilterSet[]; // list order
  export function setsArchiveRange(active: FilterSet[], now?: number): { from: string; to: string } | null;
  export function setAcceptsAlert(set: FilterSet, points: LatLng[], alertCategory: string): boolean;
  export function isEmptySet(f: SetFilter): boolean;    // nothing chosen besides time
  export function newSet(existing: FilterSet[], name: string): FilterSet;           // fresh id, first colour not in use, enabled
  export function addPolygon(sets: FilterSet[], id: string, points: LatLng[], limit: number): FilterSet[];
  export function sanitizeSets(raw: unknown): FilterSet[];
  ```
- Rules the signatures do not show:
  - `matchesSetFilter`: `matchesFilters(e, { ...toEventFilters(f), areas: [] }, now)` **and** place: no `areas` and no `polygons` → pass; else `eventAreas(e)` has one of `areas` **or** one of `eventPoints(e)` is inside one of `polygons`.
  - `setsArchiveRange`: `needsArchive(toEventFilters(set.filter), now)` per set; none → `null`; else earliest `from`, latest `to`.
  - `setAcceptsAlert`: (`categories` empty or contains `alertCategory`) **and** (no `areas` and no `polygons`, or `areas` contains `'israel'`, or a point is inside one of `polygons`).
  - `addPolygon`: returns the same array (same reference) when the id is unknown, the set is locked, the set already has 3 areas, or `points` has fewer than 3 or more than 200 corners.
  - `sanitizeSets`: per the spec's "Storage and validation" (array only; string `id`; name cut to 40; colour from `SET_COLORS` else first unused; `enabled` boolean else `true`; `filter` through `sanitizeFilters` + cleaned `polygons`; duplicate ids dropped; first 6 kept).

- [ ] **Step 1: Write the failing tests** in `tests/filters/filterSets.test.ts` (header: `// Run: node --experimental-strip-types --test tests/filters/filterSets.test.ts`). One local helper `ev(over)` builds a `PublicEvent`-shaped object (defaults: `occurredAt` one hour before a fixed `NOW`, `category: { slug: 'airstrike' }`, `severity: 'high'`, `country: 'Lebanon'`, `latitude: 33.27`, `longitude: 35.2`, `locationPrecision: 'city'`, `locationName: 'Tyre'`, `title: 'T'`); `set(over)` builds a `FilterSet` on `EMPTY_SET_FILTER`. Pass `NOW` to every call. Tests:
  - constants: the four limits and `SET_COLORS` deep-equal the values in Global Constraints.
  - `matchesSetFilter` — fields are AND: set `{ areas:['lebanon'], categories:['airstrike'] }` fits the default event; fails for `category.slug 'artillery-shelling'`; fails for `country: 'Iran'`.
  - place is OR: set `{ areas:['lebanon'], polygons:[squareAround(32.62, 36.10)] }` fits a Lebanon event **and** a `country:'Syria'` event at `32.62, 36.10`; a Syria event at `36.2, 37.15` fails.
  - several drawn areas: an event inside the second of two polygons fits.
  - several places: event whose main pin is outside but `places: [{ latitude: 32.62, longitude: 36.10 }]` is inside → fits.
  - empty set: fits any event inside its window; an event 13 hours old fails (`preset 'live'` = 12 h); `isEmptySet` is `true` for it and `false` once a category is chosen.
  - own time: set A `preset '1h'`, set B `preset '7d'`; an event 3 days old → `matchingSets` returns `[B]`.
  - **between two windows:** A `custom` 10→9 days ago, B `custom` 2→1 days ago; event 5 days old → `matchingSets(...)` is `[]`; `setsArchiveRange([A, B], NOW)` → `from` = 10 days ago, `to` = 1 day ago (ISO strings).
  - `setsArchiveRange`: `[]` → `null`; only `live` / `24h` sets → `null`; one `7d` set → `from` = `NOW − 168 h`.
  - order and once-only: event fits A (by polygon) and B (by country) → `matchingSets` is `[A, B]`; with the list reversed → `[B, A]`.
  - `planSetLimit`: `(false, 6) → 0`; `(true, null) → 6`; `(true, 1) → 1`; `(true, 99) → 6`; `(true, -3) → 0`.
  - `setsOn` / `isLocked`: three enabled sets, limit 1 → `[first]`, the 2nd and 3rd are locked; limit 0 → `[]`; a disabled first set with limit 1 → `[]` (the second does **not** move up).
  - `setAcceptsAlert` with `alertCategory 'home-front-alerts'`: empty set → `true`; `categories:['airstrike']` → `false`; `areas:['lebanon']` → `false`; `areas:['israel']` → `true`; polygon around the alert point → `true`.
  - `newSet`: on `[]` → colour `#7c3aed`, `enabled`, name as given cut to 40, `filter` deep-equals `EMPTY_SET_FILTER`; when the first two colours are used → `#059669`; two calls → different ids.
  - `addPolygon`: adds to the right set; unknown id, locked set (limit 1, second set), a set with 3 areas, 2 corners, 201 corners → `assert.equal(result, sets)` (same reference).
  - `sanitizeSets`: `null`, `'x'`, `{}` → `[]`; 50 valid sets → 6; an item without `id` dropped; an item without `filter` → kept with `EMPTY_SET_FILTER`; duplicate id → the first kept; name of 100 chars → 40; colour `'red'` → a `SET_COLORS` value no kept set uses; polygons `[[[1,2],[3,4]], [[NaN,1],[2,3],[4,5]], sq, sq, sq, sq]` → only valid ones, at most 3; `preset: 'bogus'` → `'live'`; a stored `text: 'abc'` is kept as a string.
- [ ] **Step 2: Write** `tests/filters/eventFilters.test.ts`: `sanitizeFilters(null)` and `sanitizeFilters('x')` deep-equal `EMPTY_FILTERS`; a full valid object round-trips; `{ areas: ['lebanon', 5], preset: 'nope', polygon: [[1, 2]] }` → `areas ['lebanon']`, `preset 'live'`, `polygon null`; `{ breakingOnly: 'yes' }` → `false`.
- [ ] **Step 3: Run both files** → FAIL (module / export not found).
- [ ] **Step 4: Refactor `eventFilters.ts`** — export `eventPoints`; move the body of `loadFilters` after `JSON.parse` into `sanitizeFilters`; `loadFilters` becomes parse + `sanitizeFilters` inside the same `try`.
- [ ] **Step 5: Implement `filterSets.ts`** with the signatures and rules above. No React, no `window`, no `@/` runtime import.
- [ ] **Step 6: Run both files** → PASS. `npm run typecheck` → no new errors.
- [ ] **Step 7: Commit** `feat(filters): pure rules for filter sets`.

### Task 2: Plan key — migration file, `plans.ts`, packages row

**Files:**
- Create: `supabase/migrations/20261112000106_filter_sets_plan.sql` (file only — **not applied in this task**)
- Modify: `src/lib/plans.ts` (`FeatureKey`), `src/pages/public/PackagesPage.tsx` (comparison rows, next to `pk.c.search` ~line 125), `src/components/plans/GateDialog.tsx` (only if it maps feature keys to a label — then add `filter_sets`), `src/i18n/he.ts`, `src/i18n/en.ts`

**Interfaces:**
- Produces: `FeatureKey` includes `'filter_sets'`; i18n key `pk.c.sets` (en `Filter sets`, he `סטים של סינון`).

- [ ] **Step 1: Write the migration.** A header comment in the style of `20261110000103_plan_tightening.sql`, then one `insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note)` with the five rows from Global Constraints (note `'filter sets on the map'`), ending `on conflict (feature_key, plan_id) do update set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note;`. Nothing else in the file.
- [ ] **Step 2: Add `'filter_sets'`** to `FeatureKey` in `src/lib/plans.ts`.
- [ ] **Step 3: Packages page** — one comparison row `pk.c.sets`: a plan whose row is off → the existing "no" cell; otherwise the row's `limit_value` as a number (read with the page's existing `lim` / `on` helpers). No change to the feature bullet lists.
- [ ] **Step 4: Run** `npm run typecheck` → no new errors; `npx vite build` → succeeds.
- [ ] **Step 5: Commit** `feat(plans): filter_sets plan key, migration file and packages row`.

### Task 3: Storage, pipeline, map colours, feed chip

**Files:**
- Create: `src/hooks/useFilterSets.ts`, `tests/e2e/filter-sets.mock.cjs`
- Modify: `src/pages/public/MapPage.tsx` (lines ~183–287, 470–493, 524–567, 585–616), `src/components/map/MapView.tsx` (props ~51–57; icon calls ~493, ~600, ~833; area layer ~980–998; area bar ~1226), `src/components/map/markerIcon.ts`, `src/index.css` (next to `.ofm-pin`), `src/components/feed/EventFeed.tsx`, `src/components/feed/EventCard.tsx`

**Interfaces:**
- Consumes: Task 1 exports; `hasFeature`, `featureLimit`, `usePlanVersion` from `src/lib/plans.ts`.
- Produces:
  ```ts
  // useFilterSets.ts — same pattern as src/hooks/useEeis.ts; load = sanitizeSets(JSON.parse(...)), save on every change, storage errors swallowed
  export function useFilterSets(): { sets: FilterSet[]; setSets: (next: FilterSet[] | ((prev: FilterSet[]) => FilterSet[])) => void };
  // MapView props
  setAreas?: { points: LatLng[]; color: string }[];
  tints?: ReadonlyMap<string, string>;          // event id → set colour
  // markerIcon.ts
  MarkerIconOptions.ring?: string;              // validated by safeColor; part of the cache key; adds class `has-ring` and style `--pin-ring`
  // EventFeed / EventCard
  EventFeedProps.setTags?: ReadonlyMap<string, { name: string; color: string }>;
  EventCardProps.setTag?: { name: string; color: string };
  ```
- `MapPage` values later tasks use: `sets`, `setSets`, `setLimit` (`planSetLimit(hasFeature(undefined, 'filter_sets'), featureLimit('filter_sets'))`), `activeSets` (`isArchive ? [] : setsOn(sets, setLimit)`), `switchSetsOff()` (sets every set's `enabled` to `false`; deletes nothing).

- [ ] **Step 1: `useFilterSets.ts`.**
- [ ] **Step 2: `MapPage.tsx` pipeline.** With `activeSets` empty every line below must behave exactly as today.
  - `archiveRange`: `activeSets.length ? setsArchiveRange(activeSets) : needsArchive(filters)` (still `null` in archive mode). The guest sign-up effect stays as it is.
  - `visibleEvents`: keep the `matchesQuery` step; when `activeSets.length`, replace the `matchesFilters` step **and** the EEI step by `matchingSets(e, activeSets).length > 0`.
  - One memo `setOf: Map<string, FilterSet>` (event id → first fitting set) over `visibleEvents`; from it `tints` (id → colour) and `setTags` (id → `{ name, color }`); both `undefined` when no set is in force.
  - `soundFilterRef`: `active` also true when `activeSets.length`; while sets are in force `alert = (a) => activeSets.some((s) => setAcceptsAlert(s, pointsOf(a), HFC_CATEGORY.slug))` with the alert points built as the existing code builds them.
  - `feedResetKey` includes `activeSets`. `TopNav` `filterCount` = `activeSets.length || filterCount`.
  - Feed toolbar: while sets are in force the blue pill shows `t('sets.active', { count })` and opens the panel, the count text stays, and the right-hand button is `t('sets.switchOff')` → `switchSetsOff()`. `emptyText` uses `filters.none` in both cases.
  - `onFilterCategory` and the context-menu area (`handleAreaDrawn` with no draw target): after their existing effect, if `activeSets.length` → `switchSetsOff()` and `toast.success(t('sets.switchedOff'))`.
  - `MapView`: `area={activeSets.length ? null : filters.polygon}`; `setAreas` = every polygon of every active set with its colour; `tints`. `syncPush`, `SocialSearchButton`, `OfiFab` untouched.
- [ ] **Step 3: `markerIcon.ts` + CSS.** `ring` option as in Interfaces; `.ofm-pin.has-ring .ofm-pin__body` gets a 3 px ring in `var(--pin-ring)` (box-shadow or outline — it must not change the pin's size or anchor).
- [ ] **Step 4: `MapView.tsx`.** Pass `ring: tints?.get(event.id)` at the three event-pin `createMarkerIcon` calls (not the siren pins); keep `tints` in a ref for the callbacks and re-apply icons when `tints` changes, the way the selection effect (~line 830) does. Draw `setAreas` in the drawn-area layer with the existing line style and each item's colour. The existing fade of pins outside `area` stays tied to `area` only.
- [ ] **Step 5: Feed chip.** `EventFeed` passes `setTags?.get(event.id)` to `EventCard`; the card shows a small chip (colour dot + name, truncated) beside its existing category line, with `data-set-tag`.
- [ ] **Step 6: i18n keys** (both files): `sets.active` — en `{count} filter sets`, he `{count} סטים פעילים`; `sets.switchOff` — en `Switch sets off`, he `כיבוי הסטים`; `sets.switchedOff` — en `Filter sets switched off`, he `הסטים כובו`.
- [ ] **Step 7: Start the e2e script** `tests/e2e/filter-sets.mock.cjs <he|en> <desktop|phone> <pro|free|guest>`, copying the server, routing, auth and error-collection harness of `tests/e2e/ask-chat.mock.cjs` (header comment: build and run commands, env names, "prints PASS and exits 0"). The fake must also answer:
  - `/rest/v1/app_settings` → `enforce_plans` = `true` (object for a single-row request, one-row array otherwise);
  - `/rest/v1/plan_features` → the five `filter_sets` rows, plus enabled rows for any feature that would otherwise block the feed or the event window in the test (add only what a failing check shows is needed);
  - `/rest/v1/profiles` → plan `pro` or `free` by the third argument; `guest` = no session written to `localStorage`;
  - `/rest/v1/published_events` → live fixtures, all 1–6 hours old: Lebanon `airstrike` ×2 (Tyre 33.27, 35.20; Nabatieh 33.38, 35.48), Lebanon `artillery-shelling` (Khiam 33.33, 35.61), Iran `missile-rocket-attack` (Tehran 35.69, 51.39), Iran `statements`, Syria `force-sighting` (Daraa 32.62, 36.10), Syria `airstrike` (Aleppo 36.20, 37.15), Israel `explosion` (Haifa 32.79, 34.99);
  - `/rest/v1/archived_events` → one Lebanon `airstrike` 5 days old; record every request to it (its `from` / `to` filters) for the checks.
  Checks in this task (sets are seeded into `localStorage['ofm.filterSets.v1']` by the init script, profile `pro`):
  1. No seeded sets → 8 events in the feed, no `[data-set-tag]`, no archive request.
  2. Seed A = Lebanon + `airstrike` (violet), B = Iran + `missile-rocket-attack` (amber) → exactly 3 events; each card has the right set name; a pin has class `has-ring`; the toolbar pill reads the `sets.active` text for 2.
  3. "Switch sets off" → 8 events; reload → still 8 and both sets still stored, `enabled: false`.
  4. Seed A with `preset: '7d'` → one request to `archived_events`, and the 5-day-old event appears.
  5. Seed A with a square polygon around Daraa and no country → only the Daraa event; the map has a path with stroke `#7c3aed`.
  6. `/archive` with two seeded sets → the feed is not narrowed by them.
  7. Stored value `"{not json"` → page loads, 8 events, no console error.
- [ ] **Step 8: Run** unit suites → PASS; `npm run typecheck` → no new errors; build (`VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any anon JWT> npx vite build --outDir /tmp/sets-qa/dist --emptyOutDir`) → succeeds; the script for `he desktop pro` and `en phone pro` → PASS.
- [ ] **Step 9: Commit** `feat(filters): filter sets in the map pipeline, colours on map and feed`.

### Task 4: Panel — scope row, set editor, drawing for a set, plan gate

**Files:**
- Create: `src/components/filters/FilterSetsBar.tsx` (scope row), `src/components/filters/FilterSetHeader.tsx` (name, on/off, delete, drawn areas)
- Modify: `src/components/filters/FilterPanel.tsx`, `src/pages/public/MapPage.tsx`, `src/i18n/he.ts`, `src/i18n/en.ts`, `tests/i18n/no-hebrew-literals.test.ts` (add the two new component files to `FILES`), `tests/e2e/filter-sets.mock.cjs`

**Interfaces:**
- Consumes: Task 1 exports; Task 3 `sets`, `setSets`, `setLimit`, `activeSets`, `switchSetsOff`; `openGate`, `myPlan`.
- Produces — new `FilterPanel` props (all optional, so the archive page passes none and renders today's panel):
  ```ts
  sets?: FilterSet[];
  setLimit?: number;
  onSetsChange?: (next: FilterSet[]) => void;
  scope?: string | null;                 // null = General, else a set id; state lives in MapPage so the panel reopens on the same set
  onScopeChange?: (scope: string | null) => void;
  onDrawForSet?: (id: string) => void;
  setsInForce?: boolean;
  onSwitchSetsOff?: () => void;
  ```
- e2e hooks: `data-set-scope="general" | <set id>`, `data-set-action="add" | "toggle" | "delete" | "draw" | "remove-area" | "switch-off"`, `data-set-locked` on a locked chip.
- i18n keys (en / he):
  - `sets.general` — General / כללי
  - `sets.add` — Add set / הוספת סט
  - `sets.defaultName` — Set {n} / סט {n}
  - `sets.name` — Set name / שם הסט
  - `sets.toggle` — Set on / off / הפעלה או כיבוי של הסט
  - `sets.delete` — Delete set / מחיקת הסט
  - `sets.deleteConfirm` — Delete this set? / למחוק את הסט הזה?
  - `sets.drawArea` — Draw area / ציור אזור
  - `sets.area` — Area {n} / אזור {n}
  - `sets.removeArea` — Remove area {n} / הסרת אזור {n}
  - `sets.maxAreas` — Up to 3 areas per set / עד 3 אזורים בסט
  - `sets.max` — Up to 6 sets / עד 6 סטים
  - `sets.emptyHint` — Nothing chosen yet: this set shows every event in its time range / עוד לא נבחר דבר: הסט מציג כל אירוע בטווח הזמן שלו
  - `sets.paused` — Filter sets are on, so the general filters are paused / סטים של סינון פעילים, ולכן הסינון הכללי מושהה
  - `sets.locked` — Not included in your plan / לא כלול בחבילה שלך

- [ ] **Step 1: Add both new files to `FILES`** in `tests/i18n/no-hebrew-literals.test.ts`.
- [ ] **Step 2: `FilterSetsBar.tsx`.** One row that scrolls sideways (`overflow-x-auto`, no wrap), under the panel header: `General` chip · one chip per set (colour dot, name, count of events fitting that set among the loaded events; dimmed when off; lock icon + `data-set-locked` when `isLocked`) · `+ Add set`. Chips are the panel's existing size (min height 36 px on phones).
  Add set: `sets.length < setLimit` → `newSet(sets, t('sets.defaultName', { n: sets.length + 1 }))`, append, select its scope. Otherwise, when `setLimit >= MAX_SETS` the button is disabled with title `sets.max`; else `openGate(myPlan() === 'guest' ? 'signup' : 'upgrade', 'filter_sets')`.
- [ ] **Step 3: `FilterSetHeader.tsx`.** Name input (`maxLength 40`, `dir="auto"`; an empty name is saved as the default name on blur), on/off switch (`aria-pressed`), delete (`window.confirm(t('sets.deleteConfirm'))`, then scope → General), "Draw area" (disabled at 3 with title `sets.maxAreas`) → `onDrawForSet(id)`, the list `Area n ✕`, and `sets.emptyHint` when `isEmptySet`. A locked set shows `sets.locked` and only the delete button.
- [ ] **Step 4: `FilterPanel.tsx`.** Render the bar when `sets` is passed. Introduce one local pair for the sections below: `view: EventFilters` and `apply(next: EventFilters)`.
  - General scope: `view = filters`, `apply = onChange`, matching by `matchesFilters` — today's behaviour; the existing "Draw an area" section stays. When `setsInForce`, show the `sets.paused` note with a `sets.switchOff` button above the sections.
  - Set scope: `view = toEventFilters(set.filter)`; `apply(next)` writes `fromEventFilters(next, set.filter.polygons)` into that set; the option counts use `matchesSetFilter(e, fromEventFilters(f, set.filter.polygons), now)` in place of `matchesFilters`; the general "Draw an area" section is replaced by `FilterSetHeader`; a locked set shows the header only.
  - Header "Clear all": visible when the general filter has active parts **or** `setsInForce`; it calls `onChange(EMPTY_FILTERS)` and `onSwitchSetsOff()`.
  - The hidden EEI section and `SHOW_EEI` are not touched.
- [ ] **Step 5: `MapPage.tsx`.** State `panelScope: string | null` and `drawTarget: string | null`. Pass the new props only when `!isArchive`.
  - `onDrawForSet(id)`: `setDrawTarget(id)`, then the existing `startDrawing()`.
  - `handleAreaDrawn(points)`: with a `drawTarget` → `setSets((s) => addPolygon(s, drawTarget, points, setLimit))`, fit the map to the shape through the existing `fitTo` prop, clear `drawTarget`, `setDrawMode(null)`, reopen the panel on that scope. Without a target → today's behaviour (plus Task 3's switch-off rule).
  - Drawing cancelled (`onDrawModeChange(null)` while `drawTarget` is set) → clear `drawTarget`, reopen the panel on that scope, add nothing.
  - The feed toolbar's "Clear all" (general filter) also calls `switchSetsOff()`.
  - If `panelScope` names a set that no longer exists → treat as `null`.
- [ ] **Step 6: Extend the e2e script** (UI-driven; run for each profile argument):
  1. `pro`: Add set → chip "Set 1"/"סט 1" selected; choose Lebanon + Airstrike → feed shows 2; Add a second set, choose Iran + Missile → feed shows 3; footer button count equals the feed count.
  2. Toggle set 1 off → 1 event; on again → 3.
  3. Second set → time "Last 7 days" → a request to `archived_events` whose range starts about 7 days ago; set 1 still limited to 12 h (the 5-day-old Lebanon strike does **not** appear, because only set 2 is on 7 days and it is Iran).
  4. Draw for a set: new set → "Draw area" → octagon mode → two taps around Daraa → panel reopens on that set, "Area 1" listed, feed includes the Daraa event, `localStorage['ofm.filters.v1']` still has `polygon: null`.
  5. Cancel drawing: "Draw area" → cancel → panel reopens on the set, no area added.
  6. General scope while sets are on → the paused note is visible; "Switch sets off" → 8 events, sets still listed.
  7. "Clear all" → sets off, still listed; reload → still listed.
  8. Delete a set (accept the confirm) → chip gone, scope back to General.
  9. Add sets up to 6 → the Add button is disabled; no 7th.
  10. `free`: first Add works; second Add opens the upgrade window (no second chip). With 3 sets seeded: chips 2 and 3 carry `data-set-locked`, only set 1 narrows the feed, and all 3 are still in storage after a reload.
  11. `guest`: Add opens the sign-up window; no chip is created.
  12. In `en`: no Hebrew characters inside the panel; in both languages no console errors.
- [ ] **Step 7: Run** the unit suites and `tests/i18n/no-hebrew-literals.test.ts` → PASS; `npm run typecheck` → no new errors; build → succeeds; the e2e script for `he|en` × `desktop|phone` with `pro`, and `he desktop free`, `en phone free`, `he desktop guest`, `en phone guest` → all PASS. Look at one desktop and one phone screenshot of the panel with a set open and check nothing overflows the sheet.
- [ ] **Step 8: Commit** `feat(filters): filter sets panel, drawing per set and plan gate`.

### Task 5: Migration, preview, hand-over

**Files:**
- Modify: project doc `claude/osintfront-build-status.md` (Projects tool) — one short section for this feature

- [ ] **Step 1: Final local pass.** All unit suites, the i18n test, `npm run typecheck` (no new errors), `npx vite build`, and the full e2e matrix of Task 4 Step 7 → PASS. Fix anything failing with superpowers:systematic-debugging before going on.
- [ ] **Step 2: STOP — ask the owner.** In simple words: plans are enforced on the live site, so five rows must be added to the plans table before the new screen is published; the rows are not read by the current site, so adding them changes nothing for today's users; list the five values. Ask for a yes to (a) apply the migration and (b) push the branch. Do nothing further until he answers.
- [ ] **Step 3: After the yes — apply the migration** with the Supabase MCP `apply_migration` (name `filter_sets_plan`, the exact SQL of `supabase/migrations/20261112000106_filter_sets_plan.sql`). Verify with `execute_sql`: `select plan_id, enabled, limit_value from plan_features where feature_key = 'filter_sets' order by plan_id` → 5 rows with the values in Global Constraints. If the tool is not available in the session, stop and tell the owner; do not ship the client first.
- [ ] **Step 4: Push the branch** (after the migration is verified) so Vercel builds a preview; if the preview URL cannot be read from the workspace, say so and ask the owner to open it from Vercel.
- [ ] **Step 5: Write the project-doc section** (what the feature does, limits per plan, that sets live in the browser only, the migration name and that it is applied, the e2e command) and **report to the owner** in simple words: what was checked with numbers (unit tests passed, e2e combinations passed), the preview link or how to find it, the known limits (no sync between devices, notifications still follow the general filter, one wide archive load for far-apart ranges), AI cost = none. Ask for approval to merge.
- [ ] **Step 6: Merge to `main` only after the owner approves** — and only after `feat/ask-map-chat` is merged, since this branch sits on top of it.
