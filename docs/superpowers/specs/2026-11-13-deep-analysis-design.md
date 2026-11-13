# Deep analysis (term windows) — design (owner's answers 2026-11-13; spec awaiting review)

Project-plan row: "Deep analysis" — "Each event details will have a hyperlink opening a window
explaining the term/person/weapon. Example: Ted Cruz (hyperlink explaining who Ted Cruz is with an
image) … Heron-type (hyperlink opens a window explaining the drone type with an image and all known
information, including where the drone is used, by whom …). A manager/analyst can choose the
term/person/weapon from the text → right-click → analyze. If the term exists, it will bring the
information from the DB; if not, Opus will kick in … Plans: Max/Pro."
Owner: Ben. Part 5 of 5 in the agreed order (ask the map → several filters → free-text EEI →
several classifications → **deep analysis**). Branch `feat/deep-analysis` (from main 43a5b11).

## Goal
1. In the event details window, names of people, weapons / systems, organisations, notable places
   and military terms are links. A link opens a window that explains the term: picture, short
   summary, sections, sources, and our own events that mention it.
2. The AI editor marks the terms while it edits the report — the call it already makes, no extra
   AI call.
3. An entry is written once, on the first click, by Opus with web search and our own events; it is
   saved and served to everyone from then on, in Hebrew and English.
4. Staff can select any text in an event and choose "Analyze" to open or create an entry, and can
   edit, refresh or remove an entry.
5. The cost is bounded: a daily budget for new entries, a daily number per user, one writer per
   entry. Over a limit, existing entries stay open and the reader is told why a new one is not written.

## Decisions
- **Marks are stored per event in a small table (`event_terms`), not on the event row.** Why: the
  two public views are not rewritten again, the feed payload does not grow, and "which events
  mention this term" becomes a simple lookup.
- **Links appear in the event details window only** (headline, summary, expanded text). Feed
  cards, the map popup, the phone preview sheet, shared text and push stay plain. Why: the owner's
  text says "event details"; a card holds a 100-character summary; and the marks are loaded once
  per opened event (one small call), not for a thousand cards.
- **What is linked = the editor's marks + names of entries that already exist and appear in the
  text** (plain text match, no AI). This is also how old events get links: **no backfill**, but an
  event from before the feature links every term that already has an entry; staff can add more
  with "Analyze".
- **One entry per thing, found by name.** Every name and alias (Hebrew, English, Arabic / the
  original language) is stored normalised in `deep_aliases`; a name belongs to one entry.
  Normalising = Unicode NFKC, lower case, Hebrew points and Arabic marks removed, alef forms
  unified, one kind of quote mark and hyphen, spaces collapsed.
- **Two names for one thing do not make two entries.** When Opus finishes and the names it gives
  already belong to an entry, the clicked name is added to that entry as an alias and the new text
  is dropped.
- **A link shows whether the entry exists.** Solid underline = written, opens at once. Dotted
  underline = not written yet; the window first says "No entry yet — write it now? (uses 1 of
  your N today)". Why: nobody spends one of three daily entries by accident.
- **Readers without the feature see the same links as a locked teaser:** a click opens the
  existing sign-up (guest) / upgrade (Free) window. Same pattern as the other locked features.
- **Plans:** new key `deep_analysis`; the number = new entries per day. Guest and Free: off.
  **Pro 3, Max 10**, Intel 10 (as with `eei_text`, Intel gets what Max gets). Staff: always, no
  limit, still counted. Opening an existing entry is never counted.
- **A subscriber can only start an entry for a term that is marked on an event.** Free text goes
  to Opus only from staff ("Analyze"). Why: the feature cannot be used as a general Opus chat.
- **Model:** `claude-opus-5-5` with web search (at most 4 searches) — **no fallback model**. A
  failed write saves nothing and gives the user his daily use back.
- **Deep entries do not use "Ask the map" credits.** The Opus call is logged without the reader's
  id (purpose `deep_entry`); who asked is kept on the entry and in the daily counter. Why: one
  entry costs about as much as a Pro user's whole daily credit.
- **Budget:** `app_settings.deep_daily_budget_usd` = **5**, for everyone including staff
  (refreshes too). At most **2** entries are written at the same time, and each one in progress
  reserves **$0.50** of the budget, so the day cannot overshoot by more than about a dollar.
- **Pictures:** one free picture from Wikimedia Commons (through the Wikipedia article's lead
  image), shown with author, licence and a link to its page; plus pictures / videos of our own
  events that mention the term. No other web pictures. No free picture → no picture.
- **Staff = whoever may edit any event** (`event.edit.any`: super admin, admin, analyst).
- **Languages:** Hebrew + English through `src/i18n`; no Hebrew literals in components.

## Cost (assumptions stated; prices from `supabase/functions/_shared/usage.ts`)
- **Marking terms:** about 60–100 more output tokens per edited report. At about 1,000 reports a
  day: about **$0.05 a day** when the cheap model edits, at most about **$1 a day** if every report
  went to the strong model. Measured on the first day after go-live.
- **One new entry (Opus $5 / $25 per million tokens, $0.01 per search):** 4 searches bring roughly
  30–60 thousand tokens in, the entry in two languages is about 3,500 tokens out →
  **about $0.30–0.45**. Measured on the first real run; the $0.50 reserve is adjusted if needed.
- **$5 a day ≈ 11–16 new entries a day.** Two Max users can use the day up; say so in the
  hand-over. Opening existing entries costs nothing.

## Data model
Migration `20261113000112_deep_analysis.sql` (the words `drop` / `delete` do not appear in it, not
even in comments — see Rollout):
- `deep_entries` — shared, service-role only (RLS on, no policies):
  `id uuid primary key`, `kind` (`person` | `weapon` | `org` | `place` | `term`), `name_he`,
  `name_en`, `name_orig` (the name in its own language when that is neither, e.g. Arabic),
  `summary_he`, `summary_en`, `sections jsonb` (`[{ key, he, en }]`), `sources jsonb`
  (`[{ title, url, from: 'web' | 'event' }]`), `image jsonb`
  (`{ url, page, credit, license, license_url }` or null), `related_event_ids uuid[]` (the events
  given to the writer), `model`, `cost_usd`, `version int` (1, +1 per refresh or hand edit),
  `created_by`, `created_at`, `updated_by`, `updated_at`, `edited_at` (last hand edit),
  `prev jsonb` (the content before the last refresh or edit — one step back, by hand).
- `deep_aliases` — `alias text primary key` (normalised), `entry_id uuid not null`; index on `entry_id`.
- `deep_jobs` — one row per name being written or refreshed: `key text primary key` (normalised
  name, or `entry:<id>` for a refresh), `busy_until`, `busy_token uuid`, `started_by`,
  `fail_reason` (`failed` | `no_entry`), `retry_after`, `entry_id`.
- `event_terms` — `event_id uuid`, `key text` (normalised `name`), `keys text[]` (the normalised
  `name`, `he` and `en` — what the alias lookup uses), `kind`, `he`, `en` (the term as written in
  the Hebrew / English text; either may be empty), `name` (usual full English name), `source`
  (`ai` | `staff`), `created_at`; primary key `(event_id, key)`. Service-role only.
- Section keys (fixed, in this order; a section may be missing): `background`, `capabilities`,
  `operators`, `use`, `significance`. Labels come from i18n.
- `app_settings`: `deep_daily_budget_usd` = `5`.
- `plan_features` rows `deep_analysis`: guest `false / 0`, free `false / 0`, pro `true / 3`,
  max `true / 10`, intel `true / 10`.
- SQL functions:
  - `event_terms_for(p_event uuid) → jsonb [{ key, name, kind, surfaces, entry }]` — for anyone
    who may read the event's summary (`my_feature('event_summary')`; otherwise `[]`): the stored
    marks (`surfaces` = the term as written in Hebrew and English) with the id of their entry when
    one exists, plus existing entries one of whose aliases (4 characters or longer) appears in the
    event's headline / summary / translations (`surfaces` = those aliases). Only for a published
    or archived, not removed event. At most 12.
  - `deep_entry(p_id uuid) → jsonb` — the entry plus `events` (ids of our events that mention it:
    stored ones and events marked with one of its aliases; published / archived, newest 12). Null
    when the caller's plan lacks `deep_analysis` (`my_feature`).
  - `deep_my_quota() → jsonb { enabled, staff, used, limit, budget_left }` — for the window's
    "1 of 3 today" line and the "budget used up" message.
  - Service-role helpers: `deep_allowed(p_uid) → { enabled, staff, limit }`,
    `deep_claim(p_key, p_uid) → uuid` (4-minute lease; null when held), `deep_done(p_key, p_token,
    p_entry, p_fail)`, `deep_spent_today() → numeric` (sum of `ai_usage.cost_usd`, purpose
    `deep_entry`, Israel day), `deep_in_flight() → int`.
- Migration `20261113000113_deep_analysis_fk.sql` (its own file because it contains
  `on delete …`): foreign keys `deep_aliases.entry_id → deep_entries (cascade)`,
  `event_terms.event_id → events (cascade)`, `deep_entries.created_by / updated_by → auth.users
  (set null)`. Tidiness only: the feature works without it.
- Limits (exact): 6 marks per event; a mark 2–60 characters; name ≤ 80; 16 aliases per entry,
  each ≤ 60; summary ≤ 500 characters per language; 5 sections, each ≤ 1,200 characters per
  language; 10 sources; 20 of our events given to the writer, from the last 180 days; 12 related
  events and 6 thumbnails in the window; text selected for "Analyze" 2–80 characters.

## Server (`supabase/functions/`)
- `_shared/terms.ts` (new, pure, no imports — unit-tested): `normTerm`, the editor's term rules
  and tool property, `cleanTerms`.
- `_shared/editor.ts`: the `edited_report` tool gets an optional `terms` list (`he`, `en`, `name`,
  `kind`); the system prompt gets the term rules; `EditResult.terms` is the cleaned list. Nothing
  else in the editor changes; no model, token limit or search setting is touched.
  - Rules given to the editor: mark people with a public role (leaders, officials, commanders,
    spokesmen), named weapons / systems / platforms, organisations / units / militias, places of
    standing significance (a strait, a base, a facility — not the town where the incident
    happened) and military terms a reader may not know. Never: the dead, wounded, detained,
    witnesses or any private person; countries; generic words ("army", "a drone"); the outlet that
    reported. `he` / `en` exactly as written in the Hebrew / English headline or summary; `name` =
    the usual full English name. Usually none to three.
  - Cleaning: kind from the list; `he` must appear in the Hebrew headline + summary and `en` in the
    English ones (a mark with neither is dropped); lengths; one mark per normalised `name`; first 6.
- `_shared/eventTerms.ts` (new): `saveEventTerms(db, eventId, terms)` — replaces the event's `ai`
  marks, keeps `staff` marks, never throws. Called by `whatsapp-ingest`, `intel-crawler` and
  `event-agent` `edit` after they write the event. Not called for the report form (quick compose)
  or for the parts of a split: those get links from existing entries and from "Analyze".
- `_shared/deepInput.ts` (new, pure, no imports — unit-tested): prompts, the writer's tool,
  cleaning of the entry, which source links are allowed, the picture rule, the alias plan, the
  decision "serve / wait / refuse / start".
- `_shared/deep.ts` (new): the writer and the Wikimedia lookup.
- `event-agent` — new actions (signed-in active user; each checks `deep_allowed` first):
  - `deep_write { event_id, key, poll? }` (Pro / Max / staff) and `deep_write { event_id, text,
    lang, poll? }` (staff only: "Analyze"; also stores the mark on that event with `source 'staff'`).
    Order of checks: (1) an entry already owns one of the names → `{ entry_id }`, free; (2) a
    write is in progress → `202 { pending }`; (3) `poll` → the job's failure, never a new write;
    (4) a recent failure (`retry_after`, staff skip this) → `no_entry` / `failed`; (5) budget →
    `budget`; two writes already running → `busy`; (6) daily use (`consume_feature`) →
    `quota_exceeded`; (7) lease; start the write in the background; `202 { pending }`.
    The browser asks again every 5 seconds with `poll: true` (at most 4 minutes).
  - `deep_refresh { entry_id, poll? }` (staff) — rewrite with Opus under the same budget, counted;
    the old content goes to `prev`; `version + 1`; names and aliases are kept, new ones added.
  - `deep_update { entry_id, patch }` (staff) — hand edit: names, kind, aliases, summary,
    sections, sources, remove the picture. Cleaned by the same rules; `version + 1`.
  - `deep_remove { entry_id }` (staff) — removes the entry and its aliases; marks on events stay
    and become "not written yet".
  - `deep_write` with the cron secret and `text` — internal checks at go-live.
- **The write:** our events first — `ai_search_candidates` (last 180 days, the term's names, 20
  newest) → date, country, place, headline, summary, whether it has media. One Opus call: system
  prompt + the term (names, kind when known, the sentence it was clicked in) + our events as one
  JSON line; tools: web search (`max_uses 4`) and `deep_entry`. No tool call at the end → one
  follow-up turn asking for it; still none → failure. Stops after 150 seconds.
- **The picture:** when the writer names an English Wikipedia article: `en.wikipedia.org` API →
  the article's lead image, free ones only (`pilicense=free`), not a disambiguation page → Commons
  `imageinfo` → kept only when the licence is CC0, CC BY, CC BY-SA, public domain or GFDL (never NC
  / ND) and an author or credit line exists; stored as the 640-pixel Wikimedia address with credit,
  licence, licence link and page link. Any doubt → no picture.
- **Failures:** writer failure → `retry_after` 1 hour (`failed`); the writer says the term is a
  private person, unknown or too vague → nothing saved, `retry_after` 30 days (`no_entry`). Both
  give the daily use back. Money already spent still counts in the budget.
- **Usage log:** `logUsage('deep_entry', …)` outside `runAsReader`.

## Safety
- **Everything the model reads is data:** web pages, our event texts, the clicked sentence and
  staff's selected text travel as JSON or search results; the system prompt says instructions
  inside them are ignored. The answer is used only through the tool and only after cleaning.
- **Sources cannot be invented:** a source link is kept only when it is one of the addresses the
  web search returned in this call, or the source link of one of our events given to the writer.
  An entry of kind `person` with no valid source is not saved (`failed`).
- **People:** only people with a public role. Neutral wording; role and public record only; no
  home address, family, health, religion or guesses; an accusation appears only with who made it
  and a source; nothing about a private person — the writer answers `kind: 'none'`.
- **No claims the sources do not carry:** "unknown" is said as unknown; our events are described
  as reports ("reported by …"), not as verified facts.
- **Display:** entry text is rendered as plain text (React text nodes, never HTML); links only
  through the existing `safeExternalUrl`, new tab, `noopener noreferrer`; the picture address must
  be on `upload.wikimedia.org`.
- **Every entry carries a line:** "Written by AI from open sources — check the sources", with the
  date and version.

## Client
- `src/lib/deepTerms.ts` (new, pure, unit-tested; relative imports only): types `EventTerm`,
  `DeepEntry`; `linkSegments(text, terms)` → text pieces and term pieces (longest name first, no
  overlaps, whole words only, a one-letter Hebrew prefix `ו ה ב ל כ מ ש` allowed before the name,
  first appearance of each term only); `selectionTerm(text)` (trim, 2–80 characters, one line).
- `src/services/deepService.ts` (new): `fetchEventTerms(eventId)`, `fetchEntry(id)`,
  `writeEntry(…)` (polls), `refreshEntry`, `updateEntry`, `removeEntry`, `fetchDeepQuota()`;
  entries and marks cached in memory for the session.
- `src/components/feed/TermText.tsx` (new): a text with term links.
- `src/components/feed/DeepEntryDialog.tsx` (new): the window, above the details window.
- `EventDetailsDialog.tsx`: loads the marks when it opens; headline through `TermText`; passes the
  marks to `EventText`, which uses `TermText` for the summary and the expanded text when it gets
  them (cards pass nothing and stay as they are). Staff: right-click on selected text inside the
  event's text → a one-item menu "Analyze «…»"; on a touch screen the same button appears next to
  the selection.
- `src/lib/plans.ts`: `'deep_analysis'` in `FeatureKey`; the packages page gets one row.

## UI
- **Link:** sky-blue text with an underline — solid when the entry exists, dotted when not; a
  small lock for readers without the feature. Keyboard reachable (`button`), 36-px touch target.
- **Window:** picture (left in English, right in Hebrew; on top on a phone) with the credit line
  under it; name in the site language with the other names small; kind chip; summary; the
  sections; "In our events" — up to 12 rows (time, headline; a click opens that event) and up to 6
  thumbnails from them (the plan's media rule applies); "Sources" — numbered links; the AI line
  with date and version.
- **Not written yet:** the term, "No entry yet", the button "Write it now" with "{n} of {limit}
  left today" (staff: no number), and the note that it takes up to two minutes.
- **Writing:** spinner, "Writing the entry… up to two minutes"; the window may be closed — the
  write goes on and the link turns solid on the next open.
- **Messages:** daily number used → "You have used today's {limit} new entries. Entries that
  already exist stay open."; budget → "Today's budget for new entries is used up. Entries that
  already exist stay open."; two in progress → "Two entries are being written right now — try
  again in a minute."; `no_entry` → "There is no entry for this term."; failure → "The entry could
  not be written. Try again later."
- **Staff row in the window:** Edit (a form in the same window), Refresh ("Rewrite with AI — hand
  edits will be replaced", confirm), Remove (confirm).

## Errors and edge cases
- Two readers click the same unwritten term → one write, one daily use; the second waits.
- The reader closes the window or loses the connection during a write → the write finishes anyway.
- A mark whose text was later edited out of the event → no link (the name is not found).
- A term inside a longer term ("Hezbollah" in "Hezbollah's Radwan Force") → the longer one links.
- A removed entry → its links turn dotted; the next click may write it again.
- The plan ends → links stay, with the lock.
- An event is opened from the archive page → the same window and rules.
- Wikipedia has an article with the same name about something else → the writer is told to give
  an article title only when sure; a wrong picture is removed by staff ("remove picture").

## Out of scope
- Backfilling marks on old events with AI; links in cards, popups, push or shared text.
- A staff page listing all entries; restoring `prev` from the UI; uploading a picture by hand.
- A link to share one entry; entries in other languages; comments or reader corrections.
- Marks for quick-compose events and for the parts of a split (beyond existing-entry matches).
- Changes to the editor's models, to "expand", to "Ask the map" credits or to prices.

## Testing
- Unit, `node:test` (`node --experimental-strip-types --test`):
  - `tests/deep/terms.test.ts` — normalising (Hebrew points, Arabic marks, quote marks, case);
    cleaning the editor's marks (not in the text, unknown kind, seven marks, the same name twice,
    not a list).
  - `tests/deep/deepInput.test.ts` — the user message is JSON whatever the text says; entry
    cleaning (lengths, unknown section keys, invented and `javascript:` links, `kind 'none'`, a
    person without sources); the picture rule (NC licence, no author, non-Wikimedia address,
    disambiguation); the alias plan (merge into an existing entry, alias owned by another entry);
    the decision order (served / waiting / poll never starts / budget with reserve / busy / quota).
  - `tests/deep/deepTerms.test.ts` — `linkSegments` (prefix letter, inside a word, overlap, regex
    characters, first appearance only, empty lists), `selectionTerm`.
- Database (`supabase/tests/deep_analysis.sql`, rolled-back dry run): `anon` / `authenticated`
  cannot read the four tables; `event_terms_for` gives the entry id when an alias exists and finds
  an existing entry by text; `deep_entry` is null for a Free user and filled for Pro; the lease is
  given once; `deep_spent_today` counts only `deep_entry`.
- End-to-end, Playwright with a faked server (`tests/e2e/deep-analysis.mock.cjs <he|en>
  <desktop|phone> <pro|free|guest|staff>`): solid link opens the entry (picture credit, sections,
  sources, our events); dotted link → "Write it now" → writing → entry; quota and budget messages;
  Free → upgrade window, guest → sign-up; staff: select text → Analyze, edit, refresh, remove; an
  entry text containing `<script>` shows as text; cards have no links.
- After deploy, with the owner's yes each time: three real entries chosen by the owner (a person,
  a weapon, an organisation); he reads them; the cost of each is reported.
- `npm run typecheck` (no new errors) and `npx vite build` must pass.

## Rollout (each numbered step only after the owner approves it)
1. Work on branch `feat/deep-analysis`; local tests and the faked-server Playwright run.
2. Apply migration `112` (tables, functions, budget setting, plan rows). Nothing reads it yet.
3. Migration `113` (foreign keys). It contains `on delete`, and the confirmation prompt for such
   SQL cancels itself in the build workspace, so the owner runs it himself in the Supabase SQL
   editor (or it is skipped — the feature works without it).
4. Deploy `event-agent` (new actions; "edit" starts storing marks).
5. First real Opus entry — the owner names the term; cost reported; he reads it on the preview.
   Then two more. Prompt fixes before going on.
6. Owner approves the preview build; merge the client to `main`.
7. Deploy `whatsapp-ingest`, then `intel-crawler` (new reports get marks from here on).
8. After 50 new events: a list of the marks for the owner (too many? wrong? missing?) and the
   editor's cost before and after.

## Open questions for the owner (answers change the numbers above, not the structure)
1. **Links only in the event details window** — not in feed cards or the map popup. Agreed?
2. **Free users and guests see the links with a lock** (click → upgrade / sign-up window) instead
   of plain text. Agreed, or plain text for them?
3. **The $5 daily budget also stops staff** (new entries and refreshes) when it is used up; the
   super admin can raise the setting. Agreed, or should staff be outside the budget?
4. **$5 buys about 11–16 new entries a day**, while Pro may ask for 3 and Max for 10 each — two
   Max users can use the day up. Keep $5 / 3 / 10, or change one of them?
5. **Intel plan = 10 a day, like Max** (the plan text names only Pro and Max). Agreed?
6. **Analysts count as staff here** (anyone who may edit any event): they can analyze, edit,
   refresh and remove entries. Agreed, or admins only for refresh / remove?
7. **Migration 113** (clean-up links between tables) has to be run by you in the Supabase SQL
   editor, or skipped. Which?
