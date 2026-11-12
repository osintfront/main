# Free-text צי"ח (EEI) filter — design (owner's answers 2026-11-12; spec awaiting review)

Project-plan row (Developments & Duty): free-text EEI — "Ability to enter an EEI and filter in open
text, so it shows events only according to the EEI."
Owner: Ben. Part 3 of 5 in the agreed order (ask the map → several filters → **free-text EEI** →
several classifications → deep analysis).

## Goal
A Pro / Max user pastes the daily EEI list as he receives it (theatres, each with topics, bold =
priority). The site then shows only the events that answer the list:
1. A cheap AI splits the text once into theatres and topics; the user checks and corrects the
   result before it is saved.
2. A cheap AI reads every relevant event and marks which topics it answers (owner's answer 1).
3. Map and feed show the events marked for a topic of a theatre that is on; each card says which
   theatre and topic, with a star for priority topics.
4. The cost is bounded: capped per day, shared between users with the same list, and the feature
   falls back to keyword matching instead of breaking when a cap is reached.

## Decisions
- **Matching = AI per event, on the server** (answer 1). Keyword + event-type rules (the "simple"
  method) are kept only as the fallback.
- **One rule decides what the browser shows:** if the server has checked the event for a theatre →
  the server's answer is used; if it has not (new event in the last minutes, budget reached, AI
  failure) → the fallback rules are used. Why: nothing is missed while waiting, and "over budget"
  needs no special screen logic.
- **The unit of work is a theatre, not a list.** Each theatre (its countries + its topic texts)
  gets a fingerprint. Marks are stored per fingerprint, so users with the same theatre share one
  run, and changing one theatre re-checks only that theatre. Why: it is the cheapest sharing that
  still survives small edits.
- **Lists live on the server** (the tagger needs them), one current list per user, owner-only
  access. A side effect: the list follows the user to his phone.
- **Model:** `claude-haiku-5-5` for both the split and the tagging; **no fallback to an older,
  dearer model** — if it fails, nothing is written and the fallback rules stay in force.
- **Which events are checked:** published, not deleted, from the last 24 hours, inside the
  theatre's countries (rough server pre-filter by country name or map box), never twice for the
  same theatre fingerprint. An event edited after it was checked is not re-checked.
- **A theatre is checked only while someone uses it:** saved or opened in the last 24 hours. Why:
  an abandoned list stops costing within a day.
- **EEI lenses always look at the last 24 hours.** Other time ranges are out of scope.
- **Plans (answer 2):** new key `eei_text` — Pro, Max, Intel on (number = text splits per day);
  Free and guests locked → the existing upgrade / sign-up window. Staff always. Not counted as
  "Ask the map" credits.
- **Daily replacement (answer 3):** saving a new list replaces the current one; the replaced list
  is kept as "yesterday's" for one-click restore. Manual filter sets are never touched.
- **"חריגים ככלל" (answer 4):** a lens with no AI: critical severity **or** breaking, any country.
- **On / off switches are per browser** (which theatres and topics are on, "priority only"). Why:
  no server write for every tap.
- **Languages:** Hebrew + English through `src/i18n`; no Hebrew literals in components.

## Cost (assumptions stated; prices from `supabase/functions/_shared/usage.ts`: $0.10 / $0.50 per million tokens)
Assumptions: 500 published events a day; a list of 6 theatres × 6 topics; about 70% of events fall
in one of its theatres → 350 checks a day; about 200 tokens per event, 450 fixed tokens per call
(instructions + topics), 40 tokens out per event.
- Split of the pasted text: about 1.5k tokens in, 4k out → **$0.002**, once per distinct text.
- First pass over the last 24 hours after saving: 350 events in 9 calls → about **$0.01**.
- Through the day (every 5 minutes, mostly one event per call): 350 calls → about **$0.03**.
- **One list: about $0.04–0.05 a day (≈ $1.5 a month).** At 800 events a day: about $0.07.
- **20 lists with nothing in common: about $0.9 a day (≈ $27 a month).** 20 users with the same
  list: the price of one.
- Caps: site-wide `eei_daily_budget_usd` = **2**; per theatre **600** checked events a day.

## Data model (migration `20261112000107_eei_text.sql`)
- `eei_theatres` — shared, service-role only (RLS on, no policies):
  `hash text primary key`, `spec jsonb` (`{ name, areas[], countries[], boxes[], topics: [{ key, label }] }`),
  `created_at`, `last_used_at`, `busy_until`, `tagged_day date`, `tagged_count int`, `fail_count int`,
  `paused_until`.
- `eei_tags` — shared, service-role only: `theatre_hash` → `eei_theatres` (cascade), `event_id` →
  `events` (cascade), `topics text[] not null` (empty = checked, no topic fits), `tagged_at`;
  primary key `(theatre_hash, event_id)`; index on `tagged_at`.
- `eei_lists` — one row per user: `user_id uuid primary key` → `auth.users` (cascade), `raw_text`
  (≤ 4,000 chars), `list jsonb`, `prev_raw_text`, `prev_list`, `updated_at`, `parse_day date`,
  `parse_count int`, `save_day date`, `save_count int`. RLS: the owner may **select** his row;
  all writes go through the server function.
- `list` shape: `{ theatres: [{ hash | null, kind: 'theatre' | 'exceptional', name, areas[],
  topics: [{ key, label, priority, categories[], query }] }] }`. `categories` + `query` (the
  syntax of `src/lib/eei.ts`) are the fallback rules; they are not part of the fingerprint.
- Fingerprints (computed on the server only): topic `key` = first 8 hex of SHA-256 of the
  normalised label; theatre `hash` = SHA-256 of `"v1" + sorted area ids + sorted topic keys`.
  Normalising = lower case, one kind of quote mark, `*` removed, spaces collapsed. Priority,
  names and order do not change the fingerprint. `v1` is the tagger version: raising it re-checks.
- `app_settings`: `eei_daily_budget_usd` = `2`.
- `plan_features` rows `eei_text`: guest `false / 0`, free `false / 0`, pro, max, intel `true / 5`.
- SQL functions:
  - `eei_allowed(p_uid uuid) → jsonb { enabled, limit }` — service role only; same rules as
    `my_plan()` for a given user (staff and "plans not enforced" → enabled, no limit).
  - `eei_my_tags(p_after timestamptz default null) → jsonb { degraded, tags: [{ h, e, t, at }] }`
    — for the signed-in caller: the marks of the theatres in his list (only rows newer than
    `p_after` when given, only events of the last 24 hours), and `degraded = true` when today's
    budget is used up. Marks his theatres as used (`last_used_at = now()`). Returns nothing when
    his plan lacks `eei_text`.
  - `eei_tick()` — the scheduler body (see "Schedule").
- Limits (exact): 10 theatres per list (plus the exceptional lens), 12 topics per theatre, topic
  label ≤ 80 chars, theatre name ≤ 40, pasted text ≤ 4,000 chars, 5 splits and 10 saves per user
  per day (Israel day), 40 events per AI call, 600 checked events per theatre per day.

## Server (`supabase/functions/`)
- `_shared/eeiInput.ts` (new, pure, no Deno APIs — unit-tested): text normalising, fingerprints,
  cleaning of the split output, cleaning of the tagger output, batch building, the area →
  country-names / map-box table (copied from `AREAS` in `src/lib/eventFilters.ts`, with a test
  that the two lists have the same ids).
- `_shared/eei.ts` (new): `parseEei(db, text)`, `saveEei(db, uid, raw, list)`,
  `tagTheatre(db, hash, maxEvents)`, `spentToday(db)`.
- `event-agent` — three reader actions (signed-in user; each first checks `eei_allowed`):
  - `eei_parse { text }` → `{ theatres }` preview. Haiku, forced tool. Cached in `ai_cache`
    (`kind 'eei_parse'`, key = SHA-256 of the normalised text, 7 days) — a cache hit costs nothing
    and does not count against the 5 a day. The AI returns per theatre: name, area ids (from the
    known list; another country → `c:<English name>`), `kind`, and per topic: label (the user's
    words, cleaned), priority (bold in the source), fallback `categories` (known slugs only) and
    `query` (Hebrew + English keywords).
  - `eei_save { raw_text, list }` → cleans and caps the list, computes fingerprints, upserts
    `eei_theatres`, moves the current list to `prev_*`, stores the new one, returns it with its
    hashes. Then, in the background of the same call, runs the first pass for theatres that have no
    marks yet (at most 400 events each); whatever is left is picked up by the scheduler.
  - `eei_clear` → deletes the user's current list (keeps `prev_*`).
- `eei-runner` (new function; callers: pg_cron with header `x-cron-secret` = `intel_config.cron_secret`,
  like `ofi-runner`): action `tick` → for every theatre used in the last 24 hours and not paused:
  take the lease (`busy_until`, 2 minutes), check up to the caps, release. At most 25 AI calls per tick.
- **Tagging one batch:** the theatre name and its topics (`key` + label) and up to 40 events
  (number, category slug, country, place name, title, description — cut to 600 chars per event; the
  original report text is not sent). Forced tool `tag_events` → `{ results: [{ n, topics: [key] }] }`.
  Instruction: mark a topic only when the event is about it or bears directly on it; the same
  country alone is not enough; unsure → do not mark.
- **Prompt safety:** the list text and the event texts are data — the system prompt says that
  instructions inside them are ignored. The output is used only after cleaning: `n` must be a
  number of the batch, each key must be one of the theatre's topic keys, anything else is dropped;
  an event the model did not mention is stored as "checked, no topic". The split output is cleaned
  the same way (known area ids and category slugs only, lengths cut, counts capped).
- **Budget and caps:** before each batch: today's spend (`ai_usage`, purposes `eei_parse` +
  `eei_tag`, Israel day) < `eei_daily_budget_usd`, and the theatre's `tagged_count` today < 600.
  Over either → the batch is skipped, nothing is written (fallback rules apply in the browser).
- **Failures:** a failed call writes nothing; 5 failures in a row pause the theatre for 1 hour.
- **Usage log:** every call goes through the existing `logUsage` (`fn` `event-agent` / `eei-runner`).
- **Cleanup** (inside `eei_tick`, once a day): marks older than 8 days; theatres unused for 8 days.

## Schedule (migration `20261112000108_eei_cron.sql`, separate so it is approved separately)
- `eei_tick()` in the shape of `ofi_tick()`: returns at once when no theatre was used in the last
  24 hours (no HTTP call, no cost while nobody uses the feature); otherwise `net.http_post` to
  `eei-runner` with the cron secret.
- `cron.schedule('osintfront-eei-tick', '2-59/5 * * * *', …)` — every 5 minutes.

## Client
- `src/lib/eeiLens.ts` (new, pure, unit-tested; relative imports only):
  - types `EeiTopic`, `EeiTheatre`, `EeiList`, `EeiView { off: string[]; topicsOff: string[]; priorityOnly: boolean }`,
    `EeiTags = Map<theatre hash, Map<event id, topic keys[]>>`;
  - `topicFallback(event, topic)` — (`categories` empty or contains the event's category) and
    (`query` empty or `matchesEei`), at least one of the two not empty;
  - `theatreTopics(event, theatre, tags, view, now)` → the topics the event shows for (empty = not
    shown): last 24 hours; area rule of the browser (`eventAreas`, or any place when the theatre has
    no areas); then the server's mark when there is one for this event, else `topicFallback`;
    topics switched off are dropped; with `priorityOnly` only priority topics count. An
    `exceptional` theatre: `severity === 'critical' || isBreaking`, any country, not affected by
    `priorityOnly`;
  - `sanitizeEeiList(raw)`, `sanitizeEeiView(raw)`, `mergeTags(old, rows)`.
- `src/lib/eei.ts`: `eventText` also includes the event's translations (so Hebrew and English
  keywords both hit). Nothing else changes; the old hidden section (`SHOW_EEI`) and `useEeis` stay as they are.
- `src/services/eeiService.ts` (new): `parseEei`, `saveEei`, `clearEei`, `fetchMyList`, `fetchMyTags(after)`.
- `src/hooks/useEeiList.ts` (new): loads the list once after sign-in; loads the marks at start,
  after every live-events refresh, and every 60 seconds while a theatre is on (only rows newer
  than the last one seen); keeps `EeiView` in `localStorage` (`ofm.eeiView.v1`).
- `src/pages/public/MapPage.tsx`: the "sets in force" step also accepts an event when
  `theatreTopics` is not empty for a theatre that is on. Manual sets and EEI theatres are OR'd.
  The general filter is paused while a set **or** a theatre is on. Not applied on the archive page.
- Colours: theatres take `SET_COLORS` in order, cycling; an event that fits a manual set and a
  theatre takes the manual set's colour and shows both names.
- `src/lib/plans.ts`: `'eei_text'` in `FeatureKey`; the packages page gets one row.

## UI (`FilterPanel`, same dropdown / bottom sheet)
- **Scope row:** a `צי"ח` / `EEI` chip after `General` (a lock for plans without it → the gate).
- **No list yet:** a text box ("Paste today's EEI list"), a character counter, "Analyse".
  "Restore yesterday's list" appears when there is one.
- **Preview (before saving):** one block per theatre — name (editable), country chips (add /
  remove from the known areas), topics as rows: label (editable), star (priority), delete; "Add
  topic"; delete theatre. Buttons: "Save and apply", "Back to the text". Nothing is stored and no
  event is checked until "Save and apply".
- **List in force:** one row per theatre — colour dot, name, number of matching events, on / off;
  under it its topics as chips with their counts (tap = on / off; star on priority topics).
  Above: "Priority only" toggle. Below: "New list" (opens the text box; saving replaces), "Edit"
  (opens the preview of the current list), "Restore yesterday's list", "Remove list".
- **Status line:** "Checking events… {n} waiting" while events of the last 24 hours have no mark
  yet; "Today's AI budget is used up — matching by keywords for now" when `degraded`.
- **Feed card:** chip with the theatre's colour and name + the first topic label (star when
  priority) and "+n" for more. Map pins get the ring in the theatre's colour (existing `tints`).
- **Feed toolbar / badge / "Clear all":** theatres count like sets ("Clear all" switches them off; it
  never deletes the list).
- **Phone:** all inside the existing sheet; rows stack; targets ≥ 36 px.

## Errors and edge cases
- Split returns nothing usable (text is not a list) → "Could not read a list in this text"; the text stays in the box.
- Over the 5 splits / 10 saves a day → the existing quota message; plan missing → upgrade / sign-up window.
- Budget used up during a split → the split is refused with the existing "budget" message; a saved
  list keeps working on fallback rules.
- Offline or server error on loading marks → the last marks are kept; fallback for the rest.
- A topic the user edits → new fingerprint → that theatre is checked again (last 24 hours only).
- A theatre whose country the AI could not place → no areas → every event may be checked for it
  (still capped at 600 a day); the preview shows "all countries" so the user can fix it.
- The same event fits several theatres → shown once, coloured by the first, both names on the card.
- Plan ends → the chip is locked, the list stays stored, checking stops within 24 hours.
- User deleted → his list goes with him (cascade); shared marks age out in 8 days.

## Out of scope
- Time ranges other than the last 24 hours for EEI; several saved lists; sharing a list between users.
- Push notifications or sound by EEI; EEI on the archive page; export / reports per topic.
- Re-checking an event after it was edited; using the original (Arabic) report text or media.
- Editing the fallback keywords by hand; scheduled lists; changes to manual filter sets or prices.

## Testing
- Unit, `node:test` (`node --experimental-strip-types --test`):
  - `tests/eei/eeiInput.test.ts` — fingerprints (order, `*`, priority and spacing do not change
    them; a changed label or country does), split-output cleaning (unknown slugs / areas dropped,
    caps), tagger-output cleaning (unknown keys, numbers out of range, missing events → "no topic"),
    batches of 40, the area table has the same ids as `AREAS`, the budget / cap decision.
  - `tests/eei/eeiLens.test.ts` — mark present → used; mark with no topics → hidden even when the
    keywords fit; no mark → fallback; topic off; priority only; exceptional lens; 24-hour limit;
    browser area rule; `sanitizeEeiList` / `sanitizeEeiView` on rubbish; `mergeTags`.
  - The owner's sample list is a fixture for the cleaning tests (as a faked AI output).
- Database (`supabase/tests/`): a user cannot read another user's list; `anon` and `authenticated`
  cannot read `eei_theatres` / `eei_tags`; `eei_my_tags` returns only the caller's theatres.
- End-to-end, Playwright against a local build with a faked server (`tests/e2e/eei.mock.cjs
  <he|en> <desktop|phone> <pro|free|guest>`): paste → preview → edit → save → only marked events
  shown, chips and star; unmarked new event appears by fallback, then disappears when its empty
  mark arrives; priority only; theatre and topic off; exceptional lens; new list replaces, restore
  brings the old one back; `degraded` line; Free → upgrade window, guest → sign-up; together with a
  manual filter set (OR); Hebrew and English; phone width.
- After deploy, with the owner's yes: one real split and one real first pass on his sample list
  (expected cost about 2 cents), reading 20 marked and 20 unmarked events by eye for quality.
- `npm run typecheck` (no new errors) and `npx vite build` must pass.

## Rollout (each numbered step only after the owner approves it)
1. Work on branch `feat/eei-text`; local tests and the faked-server Playwright run.
2. Apply migration `20261112000107_eei_text.sql` (tables, functions, budget setting, plan rows).
   Harmless to the live site: nothing reads it yet.
3. Deploy `event-agent` (three new actions; existing actions unchanged) and the new `eei-runner`.
4. Real check on the owner's sample list (step above); adjust the tagger instruction if needed.
5. Apply migration `20261112000108_eei_cron.sql` (the 5-minute job; it does nothing until a list exists).
6. Owner approves on the preview build.
7. Merge the client to `main` last.
