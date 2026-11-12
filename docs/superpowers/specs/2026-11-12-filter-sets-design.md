# Several filters ("filter sets") — design (owner's answers 2026-11-12; spec awaiting review)

Project-plan row (Developments & Duty): "Several filters (OR/AND)" — "several areas to cover, and
for each area a different category to look for. Example: Iran — only missile attacks OR Lebanon —
artillery or airstrikes OR a specific area in Syria — forces detection."
Owner: Ben. Part 2 of 5 in the agreed order (ask the map → **several filters** → free-text EEI →
several classifications → deep analysis).

## Goal
A user can keep several named filters ("sets") side by side and switch each one on or off:
1. Each set is a complete filter of its own: countries, one or more areas drawn on the map, event
   types, and its own time, severity, source, media, location kind, breaking / verified.
2. The map and feed show every event that fits **at least one** set that is on.
3. Each set has a colour, so the map and the feed show which set an event belongs to.
4. Nothing changes for someone who never creates a set.

## Decisions
- **A set is a full filter** (owner's answer 1). Its fields are the fields of today's filter, with
  one difference: several drawn areas instead of one.
- **Sets replace the general filter while at least one set is on.** The general filter (today's
  panel) is kept exactly as it is, is used alone when no set is on, and is *paused* — not erased —
  while a set is on. Why this option: with zero sets the code path is today's code path, so nothing
  the owner did not ask for changes; and no rule is needed for mixing two different time ranges.
- **The search box stays on top of everything.** It is not part of the filter panel today
  (`matchesQuery` in `MapPage`), and it keeps narrowing the result whether sets are on or not.
- **"Ask the map" is unchanged:** its events are narrowed by whatever filter is in force (the
  general filter, or the sets) exactly as they are narrowed by the general filter today.
- **Combining:** OR between sets. Inside a set: AND between fields, OR inside a field — the rule of
  today's filter. One addition for place, see "Matching rules".
- **Storage:** this browser only (`localStorage`). No table, no sync between devices (answer 3).
- **Plans (answer 2):** new `plan_features` key `filter_sets` with a number: Free 1, Pro / Max /
  Intel 6. **Guests: locked — pressing "Add set" opens the sign-up window.** Why: it follows the
  existing funnel (guest → sign up), a set's own time range needs the archive that guests do not
  have, and guests lose nothing they have today (general filter and drawn area stay open to them).
- **Notifications (answer 4):** unchanged. Push keeps following the general filter
  (`syncPush(filters, …)`), also while it is paused on screen.
- **No AI, no server calls** for sets. The only server change is the plan rows.
- **Live map only.** On the archive page (`mode="archive"`) the sets row is hidden and sets are
  not applied; the day picker and the general filter work as today.
- **Room for the next feature (free-text EEI):** a set may later get a text condition (one EEI
  theatre = one set: area + topic queries). The model reserves an optional `text` field; this
  feature neither shows nor matches it.

## Data model (`src/lib/filterSets.ts`, new, pure)
- `SetFilter` = the fields of `EventFilters` **without** `polygon` and `eeis`, **plus**
  `polygons: LatLng[][]`. (So: `preset`, `from`, `to`, `areas`, `categories`, `severities`,
  `sources`, `media`, `breakingOnly`, `verifiedOnly`, `placeKinds`, `polygons`.)
- `FilterSet` = `{ id: string; name: string; color: string; enabled: boolean; filter: SetFilter;
  text?: string }`. `text` is reserved for EEI and ignored here.
- `EMPTY_SET_FILTER` = `EMPTY_FILTERS` without `polygon` / `eeis`, with `polygons: []`
  (time = "Live (12h)", like a fresh general filter).
- Constants: `MAX_SETS = 6`, `MAX_POLYGONS = 3`, `MAX_POLYGON_POINTS = 200`, `MAX_NAME = 40`,
  `SET_COLORS` (6 fixed hex colours, see "Map colours").
- Functions (all pure, unit-tested):
  - `matchesSet(event, set, now)` → boolean.
  - `matchingSets(event, sets, now)` → the **enabled** sets the event fits, in list order.
  - `setsOn(sets, limit)` → the sets in force: enabled and not locked by the plan (see "Plan gating").
  - `setsArchiveRange(sets, now)` → `{ from, to } | null`.
  - `setAcceptsAlert(set, alertPoints)` → boolean (sound for Home Front Command alerts).
  - `sanitizeSets(raw)` → `FilterSet[]` (storage validation).
  - `newSet(existing, name)` → a set with a fresh id, the first unused colour, `enabled: true`.
- `src/lib/eventFilters.ts` — small additions only, no behaviour change: export `eventPoints`;
  extract the per-field cleaning inside `loadFilters` into an exported `sanitizeFilters(raw)` that
  `loadFilters` calls (same result as today). `filterSets.ts` imports it with a relative `.ts`
  path (`./eventFilters.ts`), like `src/lib/military.ts` does, so `node --test` can load it.

## Matching rules
- **Which filter is in force:** `active = setsOn(sets, limit)`. If `active` is empty → today's
  pipeline, untouched. Otherwise the general `matchesFilters` step **and** the hidden EEI step are
  skipped and replaced by "`matchingSets(event, active)` is not empty".
- **Inside a set**, an event must pass all of:
  1. Time: `timeWindow` of the set's own `preset` / `from` / `to`.
  2. Place: if the set has neither countries nor drawn areas → any place. Otherwise the event is in
     **one of the chosen countries OR inside one of the drawn areas** (any of the event's points,
     as today). This differs on purpose from the general filter, where country AND drawn area must
     both fit: in a set, "Lebanon + a drawn patch of Syria" means both places.
  3. Event types, severity, source, media, location kind, breaking, verified — same checks as
     `matchesFilters` (implemented by calling `matchesFilters` with `areas: []`, `polygon: null`).
- **A set with nothing chosen** fits every event in its time window. Allowed; the editor shows a
  one-line hint so it is not a surprise.
- **An event in several sets** is shown once; its colour is that of the first fitting set in list order.
- **Archive loading:** when sets are in force, the archive range is the union of the windows of
  the sets in force that reach past the live 24 hours: `from` = the earliest, `to` = the latest
  (one covering range, one request through the existing `useArchiveRange`). The general filter's
  time is ignored while it is paused. Guests: the existing rule stays (`archiveRange && isGuest` →
  sign-up window).
- **Sound "only what the filter shows":** events follow automatically (the list of visible ids).
  For Home Front Command alerts, while sets are in force an alert is in scope if at least one set
  accepts it: types empty or containing the alert category, and place empty, or containing
  `israel`, or one of the alert's points inside one of the set's drawn areas.

## UI (`src/components/filters/FilterPanel.tsx`, same panel: dropdown on desktop, bottom sheet on phone)
- **Scope row** at the top of the panel, under the header: chips in one line that scrolls sideways
  on phones — `General` · one chip per set (colour dot, name, number of matching events; dimmed
  when the set is off) · `+ Add set`. The chosen chip decides what the sections below edit.
- **`General` chosen:** today's panel, unchanged. While sets are in force a note appears above the
  sections: "Filter sets are on, so the general filters are paused" with a "Switch sets off" button.
- **A set chosen:** a set header, then the same sections as today bound to that set (time, areas,
  event types, severity, source, media, location, more). The option counts follow that set's own
  rules. The set header has:
  - name field (≤ 40 characters; empty → the default name);
  - On / Off switch;
  - Delete (asks once: "Delete this set?");
  - drawn areas: "Draw area" button and a list "Area 1 ✕ · Area 2 ✕" (up to 3; the button is
    disabled at 3 with a short reason).
- **Add set:** creates "Set N" (i18n default name), switched on, and selects its chip. At the
  plan's limit the button opens the gate (see "Plan gating"); at 6 it is disabled with "Up to 6 sets".
- **Drawing an area for a set:** "Draw area" closes the panel and starts the existing drawing mode
  (free shape / octagon, unchanged). `MapPage` remembers which set asked. When the shape is done it
  is added to that set, the map fits it, and the panel reopens on that set. Cancel reopens the
  panel with nothing added. Drawing from the `General` scope works as today.
- **Footer** "Show N events": unchanged (N = what the feed shows).
- **"Clear all"** (panel header and feed toolbar): clears the general filter as today **and
  switches every set off**. It never deletes a set.
- **Filters button badge (`TopNav`):** number of sets in force while sets are on; otherwise today's count.
- **Feed toolbar (`MapPage`):** while sets are in force the blue pill reads "N filter sets" (opens
  the panel), with the event count and a "Switch off" button. Without sets: today's pill.
- **Feed cards:** a small chip with the set's colour dot and name (first fitting set).
- **Actions on the map that write to the general filter** (right-click "area here", "show only
  this type" from a pin): they work as today, and if sets were in force they are switched off with a
  short notice ("Filter sets switched off"), so the result is visible.
- **Phone:** everything is inside the existing bottom sheet; touch targets ≥ 36 px like the
  current chips; no new screens.
- **Languages:** new `sets.*` keys in `src/i18n/he.ts` and `en.ts`; no Hebrew literals in components.

## Map colours (`src/components/map/MapView.tsx`, `markerIcon.ts`)
- `SET_COLORS`: six colours that are readable on the light and dark map and differ from the red
  alert areas and the sky-blue general area — violet `#7c3aed`, amber `#d97706`, emerald `#059669`,
  pink `#db2777`, cyan `#0891b2`, lime `#65a30d`. A new set takes the first colour no other set
  uses. Colours are not editable.
- New `MapView` prop `setAreas?: { points: LatLng[]; color: string }[]`: the drawn areas of the
  sets in force, outlined in the set's colour (same line style as today's area). The general area
  outline and its "Draw again / Clear" bar show only while no set is in force.
- New `MapView` prop `tints?: ReadonlyMap<string, string>` (event id → colour): pins of those
  events get a ring in that colour around the unchanged category icon. The colour is part of the
  icon cache key in `markerIcon.ts`. Cluster bubbles are not coloured.
- The existing fading of pins outside the general drawn area is not applied to sets.
- Colour is never the only signal: the feed chip carries the set's name.

## Storage and validation (`src/hooks/useFilterSets.ts`, new — same pattern as `useEeis.ts`)
- Key `ofm.filterSets.v1`; saved on every change; storage blocked → sets last for the page only.
- `sanitizeSets` on load: must be an array; each item needs a string `id`; `name` cut to 40;
  `color` must be one of `SET_COLORS` (else the first unused one); `enabled` boolean (else true);
  `filter` cleaned by `sanitizeFilters` + `polygons` (array, ≤ 3, each ≥ 3 and ≤ 200 points of two
  finite numbers; bad ones dropped); duplicate ids dropped; at most 6 kept. Anything unreadable → no sets.
- The general filter's key (`ofm.filters.v1`) and shape are untouched.
- Two tabs open: the last one to save wins (no live sync between tabs).

## Plan gating
- **Migration** `supabase/migrations/20261112000106_filter_sets_plan.sql` — rows only, same upsert
  form as `20261110000103_plan_tightening.sql` (`on conflict (feature_key, plan_id) do update`):

  | plan | enabled | limit_value | note |
  |---|---|---|---|
  | guest | false | 0 | filter sets |
  | free | true | 1 | filter sets |
  | pro | true | 6 | filter sets |
  | max | true | 6 | filter sets |
  | intel | true | 6 | filter sets |

- `src/lib/plans.ts`: add `'filter_sets'` to `FeatureKey`.
- **Limit in the browser:** `limit = hasFeature('filter_sets') ? min(featureLimit('filter_sets') ?? 6, 6) : 0`.
  So: staff → 6; **while `enforce_plans` is off everyone, guests included, gets 6** (as with every
  other feature today); if the rows are missing while plans are enforced → 0 (locked).
- **At the limit, "Add set":** guest → `openGate('signup', 'filter_sets')`; signed in →
  `openGate('upgrade', 'filter_sets')` (the existing window).
- **More saved sets than the plan allows** (plan ended, or enforcement switched on later): nothing
  is deleted. The first `limit` sets in the list work; the rest show a lock, cannot be switched on
  or edited, can be deleted. Upgrading unlocks them.
- **Enforcement is in the browser only.** Sets never reach the server and expose no extra data, so
  there is nothing to protect in the database.
- **Packages page** (`src/pages/public/PackagesPage.tsx`): one new comparison row "Filter sets"
  (guest —, Free 1, Pro 6, Max 6), read from `plan_features` like the other rows.

## Limits
- 6 sets; 3 drawn areas per set; 200 corners per area; name 40 characters.

## Wiring (`src/pages/public/MapPage.tsx`)
- `useFilterSets()` next to `useEeis()`; `activeSets = isArchive ? [] : setsOn(sets, limit)`.
- `archiveRange` = `setsArchiveRange(activeSets)` when sets are in force, else today's `needsArchive(filters)`.
- `visibleEvents`: the `matchesFilters` + EEI steps become one step that picks by `activeSets`.
- `tints` and the feed chips come from one memo (`event id → first fitting set`).
- `feedResetKey`, `soundFilterRef.active` and the `TopNav` badge take the sets into account.
- `syncPush`, `SocialSearchButton`, `OfiFab` keep reading the general filter (unchanged).
- New state `drawTarget: string | null` (the set that asked for a drawing).

## Errors and edge cases
- Storage blocked or corrupted → no sets, no error shown; the general filter works.
- A set whose country chip no longer appears in the list (a country seen only in older events)
  keeps the id; it simply matches nothing until such events are loaded.
- All sets switched off or deleted → the general filter is in force again at once, with whatever it held.
- Deleting the set being edited → the panel returns to `General`.
- Archive still loading for a set's time range → the existing "loading older events" line in that
  set's time section; live events show meanwhile.
- A set with a custom time range entirely in the past shows only archived events; if the archive
  request fails it shows none (today's behaviour of the general filter).
- Guest with sets (only possible while plans are not enforced) choosing a time past 24 hours →
  the existing sign-up window.

## Out of scope
- Push notifications by set; sync between devices or accounts; sharing / exporting sets.
- AND between sets, "exclude" sets, re-ordering sets by drag, choosing a colour.
- The free-text EEI itself (text condition, AI split) — next feature. The hidden `SHOW_EEI`
  section stays hidden and untouched.
- Sets on the archive page. Changes to the general filter's fields, prices, or other plan values.

## Testing
- Unit — `node:test`, run with `node --experimental-strip-types --test tests/filters/filterSets.test.ts`:
  OR between sets; AND between fields inside a set; own time window per set (one live, one 7 days);
  place = country OR drawn area; several drawn areas; an event with several places; empty set fits
  all in its window; disabled and plan-locked sets ignored (`setsOn`); first-fitting-set order;
  `setsArchiveRange` (none / one / union of two / all within 24 h → null); `setAcceptsAlert`;
  `sanitizeSets` (garbage, too many sets, bad polygons, bad colour, long name, duplicate ids);
  `newSet` colour choice. Plus `tests/filters/eventFilters.test.ts`: `sanitizeFilters` returns
  what `loadFilters` returned before (guards the refactor).
- Existing `tests/i18n/no-hebrew-literals.test.ts` must pass.
- End-to-end — Playwright against a local build and a faked server, in the form of
  `tests/e2e/ask-chat.mock.cjs`; saved as `tests/e2e/filter-sets.mock.cjs <he|en> <desktop|phone>`
  (all four combinations): no sets → feed equals today's; add set "Lebanon + airstrike" → only
  those events, ring colour and feed chip; add second set with a drawn area → both groups shown;
  switch one off; general-paused note and "Switch sets off"; "Clear all" keeps the sets; reload
  keeps the sets; a 7-day set triggers the archive request with the union range; Free profile →
  second "Add set" opens the upgrade window; guest (plans enforced) → sign-up window; plans not
  enforced → 6 allowed; 7th disabled.
- `npm run check` (types + build) must pass.

## Rollout
1. Work on branch `feat/filter-sets` (already checked out; it sits on top of `feat/ask-map-chat`,
   so it merges after that branch). Vercel builds a preview.
2. While `enforce_plans` is off the site works without the migration (the rows are not read). If
   plans are already enforced when the preview is tested, sets are locked for everyone except
   staff until step 4 — so in that case step 4 comes before the owner's test with a normal user.
3. Owner approves on the preview.
4. Apply migration `20261112000106_filter_sets_plan.sql` only after the owner agrees (needed before
   plans are enforced; harmless before).
5. Merge to `main`; Vercel deploys the site.
