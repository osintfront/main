# Several classifications (multi-category) — design (owner's answers 2026-11-13; spec awaiting review)

Project-plan row: "Several classification" — "Show 1-3 categories, for example: death by an air
plane (Death, Airstrike)"; "Tank strike towards a village from another village (Artillery strike,
forces detection)"; "The main category will be presented as the icon; by using filters could show
the sub category as well."
Owner: Ben. Part 4 of 5 in the agreed order (ask the map → several filters → free-text EEI →
**several classifications** → deep analysis). Branch `feat/multi-category` (from main 466b40d).

## Goal
1. An event has one **main** type (as today) and up to **two secondary** types.
2. The map icon, its colour, the legend and the sound follow the main type only.
3. Choosing a type in the filters also finds events that carry it as a secondary type; a switch
   turns that off.
4. A new type **Casualties (נפגעים)** exists, usable as main or secondary.
5. Nothing changes for an event without secondary types. No extra AI calls.

## Decisions
- **Split by place stays (owner's answer 2a).** A report whose places saw different kinds of
  incident is still split into sibling events (`_shared/splitEvent.ts`). Secondary types describe
  *the same incident* from another side (killed **by** an airstrike; tank fire **and** foreign
  forces seen). Rule of thumb: different places → split; same place, several sides → secondary.
- **Secondary types count in type filters by default, with a switch to turn it off (answer 1a).**
- **New category `casualties` in this spec (answer 3b)** — own section below.
- **New events only (answer 4a).** No backfill, no re-run of the editor on old events.
- **Stored as slugs on the event row**, not a link table: at most two values, and slugs are
  already how places (`locations[].category_slug`), filters and the registry name a type.
- **The database keeps the list clean, in one place.** A trigger removes the main type,
  duplicates and unknown/inactive slugs and keeps at most two. Every writer (ingest functions,
  admin form, RPC) gets the same rule, and changing the main type can never leave it listed twice.
- **The filter switch is stored inverted (`mainOnly`, default false).** Saved filter sets in
  `localStorage` and saved push filters that lack the field therefore behave as the owner chose,
  with no data migration.
- **EEI lens fallback: any type** (main or secondary), always — the same as the filters' default.
  It has no switch of its own.
- **Sound and push muting: main type only** (they follow the icon the user sees).
- **Learning from corrections: unchanged** (main type only).

## Data model (migration `…_secondary_categories.sql`, next free number)
- `events.secondary_categories text[] not null default '{}'`, check `cardinality(...) <= 2`.
- Trigger `events_clean_secondary_categories` (before insert, and before update of
  `secondary_categories` or `category_id`): keep, in order, the slugs that are active in
  `event_categories`, are not the event's main slug, are not `home-front-alerts`, `other`,
  `uncategorized`, without duplicates; first two only. Security definer, empty `search_path`,
  execute revoked from public (pattern of migration 4).
- `published_events` and `archived_events`: add `e.secondary_categories` as the **last** column.
  Write both views out in full from their latest definition (`20261110000103_plan_tightening.sql`);
  do not use text replacement. Same `security_invoker` / `security_barrier` options as today.
- RPC `set_event_secondary_categories(p_id uuid, p_slugs text[])`: the permission checks of
  `set_event_category` (`event.edit.any`, or `event.edit.own` and owner); raises `22023` on more
  than two slugs or an unknown slug; updates the column. `set_event_category` itself is unchanged
  (the trigger drops the new main type from the list).
- `ai_search_candidates`: same arguments and same returned columns. Topic match and score also
  look at secondary types: main match +3 (today), secondary match +2;
  `topic_ok` also true when `e.secondary_categories && p_categories`.
- Public API function (migration 72): the event JSON gains `secondary_categories`; `p_category`
  matches the main or a secondary type.

## How secondary types are produced (no extra AI call)
- `_shared/editor.ts`: the existing tool gets `secondary_category_slugs` (array, 0–2, enum = the
  allowed categories) whenever categories are passed (all three callers already pass them).
  `EditResult.secondary_category_slugs: string[]`; `normalise` keeps valid, distinct slugs,
  drops the result's own `category_slug`, caps at two.
- Prompt rule (added next to `CATEGORY_RULES` in `_shared/categoryRules.ts`, so every agent
  shares it): "Secondary types: only when the **same incident** is truly also of that kind
  (a person killed by an airstrike → the other of assassination / casualties / airstrike; tank
  fire together with foreign forces seen → force-sighting). Empty for most reports. Never repeat
  the main type. Do not use it for a different incident in another place — tag that place."
- Writers save the column: `whatsapp-ingest` (the editor step, `placePart`), `event-agent` edit,
  `intel-crawler` insert. `event-agent` compose returns `secondarySlugs` to the report form.
  In `whatsapp-ingest` the main type comes from the triage step, which the editor does not see;
  the trigger removes it if the editor repeats it.
- **A free signal that is thrown away today:** in `splitEventByCategory`, when all tagged places
  share one kind that differs from the event's main type, the place kind is overwritten with the
  main type. Before overwriting, add that kind to `secondary_categories` (if there is room).

## Split behaviour (`_shared/splitEvent.ts`, `src/lib/quickReport.ts` `splitParts`)
- Splitting rules are unchanged.
- After a split the **original** drops every secondary type that became a sibling (otherwise the
  same airstrike is counted twice: once as the sibling, once as a secondary).
- **Siblings start with no secondary types** (`secondary_categories` is not in `CLONE`).
- `dedupe.ts` keeps comparing main types only.

## New category: Casualties (נפגעים)
- **Meaning:** a report whose news is people killed or wounded — tolls, hospital and rescue
  reports, updated counts, deaths where the means is not known.
- **Main or secondary — what the headline is about decides:**
  - "Three killed in an airstrike on X" → main `casualties`, secondary `airstrike` (the owner's
    example).
  - "Airstrike on X", wounded mentioned in the body → main `airstrike`, secondary `casualties`.
  - A targeted killing of a named person stays `assassination` (may take `casualties` or the
    means as secondary).
  - A place is tagged `casualties` only when the means is unknown; otherwise the place keeps the
    kind of the attack (so reports are not split into "strike" and "casualties" for one place).
- **Row** (migration `…_casualties_category.sql`, pattern of `20261023000034_artillery_category.sql`,
  `on conflict (slug) do update`): slug `casualties`, name `Casualties (killed, wounded)`,
  description as above, `translations {"he":"נפגעים"}`, sort order directly after `assassination`.
- **Icon:** `HeartPulse` (lucide). The whitelist `CATEGORY_ICONS` has no fitting icon today
  (`HeartHandshake` is the humanitarian type), so `HeartPulse` is added to the whitelist — one
  import and one line. **Colour:** `#701a75` (dark magenta; the reds are all taken by other
  types). Both are shown to the owner on the preview before the editor starts using the type.
- **Every hard-coded list that needs the new slug** (found by searching `artillery-shelling`):
  - `src/types/category.ts` — the slug list.
  - `src/data/categoryRegistry.ts` — `CATEGORY_ICONS` (+`HeartPulse`) and `DEFAULT_CATEGORIES`.
  - `src/i18n/he.ts` / `en.ts` — `category.casualties`: נפגעים / Casualties.
  - `supabase/functions/_shared/eeiInput.ts` — `CATEGORY_SLUGS` (the equality test in
    `tests/eei/eeiInput.test.ts` fails until both lists match).
  - `supabase/functions/_shared/splitEvent.ts` — `HE` (`casualties: "נפגעים"`) and `EN`.
  - `supabase/functions/_shared/categoryRules.ts` — the guidance above.
  - `supabase/functions/whatsapp-ingest/index.ts` — the triage prompt's list of kinds.
  - `supabase/functions/_shared/editor.ts` — the per-place examples in `SYSTEM_DETAILED_PLACES`.
  - `supabase/functions/_shared/ask.ts` — the hint "who was killed → assassination, casualties".
  - `supabase/functions/_shared/dedupe.ts` — `FAMILY`: `casualties: "kinetic"` (a toll may be the
    same incident as the strike). **Not** in `MOMENT` (tolls are repeated for hours).
  - `api/_lib/pushFormat.ts` — emoji and Hebrew name.
  - `supabase/migrations/20261026000056_place_edits.sql` has a Hebrew name `case` by slug: the
    implementer re-creates that function with the new slug in the new migration.
- Legend, filter chips, sound menu and admin selects read the category list and need no further
  change. Test fixtures that mention slugs stay as they are.

## Client model
- `src/services/eventService.ts`: add `secondary_categories` to the selected columns and row
  type. `PublicEvent.secondaryCategories: CategoryRef[]` — each slug resolved through
  `DEFAULT_CATEGORIES` (as `MapView` already does for place kinds); unknown slugs are dropped;
  at most two.
- `src/lib/eventFilters.ts`:
  - `eventCategorySlugs(e, includeSecondary): string[]` — the one helper everyone uses.
  - `EventFilters.mainOnly: boolean` (`EMPTY_FILTERS`: false).
  - `matchesFilters`: `f.categories` is matched against `eventCategorySlugs(e, !f.mainOnly)`.
  - `activeFilterCount` does not count `mainOnly`.
- `src/lib/filterSets.ts`: `SetFilter` carries `mainOnly` too (validation accepts a missing value
  as false; `isEmptySet` ignores it). `setAcceptsAlert` is unchanged.

## Matching rules (who looks at what)
| Reader | Main only | Main or secondary |
|---|---|---|
| Map icon, colour, cluster ring, report-group line | ✔ | |
| Legend (`CategoryLegend.tsx`) | ✔ | |
| Sound (`MapPage` `isCategoryAudible`), push muting (`api/push.ts`) | ✔ | |
| Type filter, filter sets, counts in the panel | when the switch is off | ✔ default |
| Push filters (`api/push.ts` reuses `matchesFilters`) | when the switch is off | ✔ default |
| EEI lens fallback (`eeiLens.ts` `topicFallback`) | | ✔ always |
| Search box (`MapPage` `matchesQuery`) | | ✔ (secondary names join the text) |
| Ask the map (`ai_search_candidates`) | | ✔ (lower score) |
| Public API `p_category` | | ✔ |
| Dedupe, category learning, admin list filter | ✔ | |
| EEI server tagging input (`_shared/eei.ts`) | ✔ (keeps its cache) | |
| OFI | not affected (it counts lexicon terms, not event types) | |

## UI
- **Feed card, details window, map popup:** the main badge as today, then the secondary types as
  smaller outlined badges (`CategoryBadge` gets a `secondary` look: border in the type's colour,
  no fill). Screen readers hear "also: …".
- **Filter panel (`FilterPanel.tsx`), under the event types:** a checkbox "Include secondary
  types" (he: "כולל סוגים משניים"), on by default; it is shown in the general filter and in every
  set. Counts next to each type follow it: with the switch on an event counts under each of its
  types (the numbers may add up to more than the total — expected).
- **Legend:** unchanged (it explains icons).
- **Admin:**
  - `EventStaffEdit.tsx` (details window): under the type select, up to two removable chips and
    an "add secondary type" select; saved through `set_event_secondary_categories`.
  - `EventEditorPage.tsx`: the same control in the form; the compose result pre-fills it.
  - `EventsListPage.tsx`: secondary types shown as small chips next to the inline select
    (read-only there). `eventAdminService.ts` selects the new column.
- **i18n (he + en):** `category.casualties`, `filters.includeSecondary`, `event.alsoTypes`,
  `form.secondaryTypes`, `form.addSecondaryType`, `form.secondaryLimit`.

## Push (`api/push.ts`, `api/_lib/pushFormat.ts`)
The event columns it loads gain `secondary_categories`; the lean event it builds gains
`secondaryCategories`, so the shared `matchesFilters` gives the same answer as the site. The
notification text keeps naming the main type only.

## Errors and edge cases
- A slug that was deactivated later: dropped by the trigger on the next write and ignored by the
  client meanwhile.
- More than two from the AI: capped silently. More than two from a person: the RPC refuses and
  the form says "up to two".
- Main type changed to one of the secondary types: the trigger removes it from the list.
- An old client (cached bundle) ignores the extra view column.
- A saved set or push filter without `mainOnly`: treated as false (secondary types included).

## Out of scope
- Backfilling old events; re-running the editor on them.
- Learning from corrections of secondary types.
- Secondary types per place; a second icon on the map.
- Changing how reports are split; changing dedupe beyond the `FAMILY` entry.
- Sending secondary types to the EEI server tagger.

## Testing
- **SQL (`supabase/tests/multi_category.sql`, style of `eei_text.sql`):** the `casualties` row
  exists and is active; the trigger removes main / duplicates / unknown and caps at two; the RPC
  refuses a viewer and accepts an analyst; both views expose the column last; `ai_search_candidates`
  returns an event matched only by a secondary type, ranked below a main match.
- **node:test:**
  - `tests/filters/eventFilters.test.ts` — secondary match on by default, off with `mainOnly`.
  - `tests/filters/filterSets.test.ts` — the same inside a set; a stored set without the field.
  - `tests/eei/` — `topicFallback` matches a secondary type; the slug-equality test passes with
    `casualties`.
  - New `tests/categories/secondary.test.ts` — editor `normalise` (cap, distinct, main dropped) and
    the split pruning rule (extracted as a pure function for the test).
- **Playwright, mocked (`tests/e2e/multi-category.mock.cjs`, harness of `filter-sets.mock.cjs`):**
  an event "casualties + airstrike" shows two badges and the casualties icon; choosing Airstrike
  keeps it and the count includes it; clearing the checkbox hides it; Hebrew and English labels.
- `npm run build` and the existing suites stay green.

## Rollout (each step shown to the owner before the next)
1. This spec approved → implementation plan approved.
2. Migration: Casualties category (the type appears in filters and admin selects; the icon and
   colour are confirmed on the preview).
3. Migration: `secondary_categories`, trigger, views, RPC (nothing visible yet).
4. Site: badges, filter switch, counts, EEI fallback, search box — checked on the preview with a
   few events given secondary types by hand.
5. Admin editing.
6. Editor and ingest functions (prompt, writers, split pruning). The owner reviews about 50 live
   events for over-tagging and for how often the main type became Casualties.
7. Push, ask the map, public API.
