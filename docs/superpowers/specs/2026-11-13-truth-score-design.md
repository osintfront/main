# Truth score (source-confirmation %) — design (draft for the owner, 2026-11-13; NOT approved yet)

Owner's request (ציון אמיתות): every event / news item carries a percentage. In his words:
1. Heavy weight for official channels — IDF Spokesperson, CENTCOM and similar government / military sources.
2. Confirmation by mainstream outlets raises the score.
3. Many independent sources reporting the same event raise the score.
4. Confirmation across languages and across sides (Israeli vs Lebanese sources) raises the score.
5. When an item cites a mainstream outlet ("according to Al Jazeera …"), the system checks that
   outlet itself and scores by the result (found there / not found / could not be checked).
6. (added the same day) Visual evidence counts: footage (תיעודים) and photos attached to the
   event raise the score; the same picture reposted by many channels counts once; an old picture
   seen before on another event gives nothing and lowers the score.

Owner: Ben. Planner: Fable (this spec). Implementation: Opus, only after the owner approves.
Branch `feat/truth-score` (from main c87c1d0). The owner could not be asked questions while this was
written: every call below is the planner's, and the ones only he can make are listed at the end
under **Open decisions**, each with a recommended default. No implementation plan yet.

## Goal
1. Every published event gets a score from 5 to 99, computed by plain code (no AI) from who
   reported it and what footage came with it, and a short "why" list a reader can open.
2. The score moves by itself when a new source joins the event (merge, duplicate fold, edit).
3. A cited outlet is really checked, almost always for free, and the result is shown in words.
4. Staff can classify sources, tune the weights, and override the score of one event.
5. The whole feature costs cents a day, has its own daily budget, and is off until switched on.

## What exists today (read in the code and measured on the live database, 14 days to 2026-11-13)
- An event has one main source (`events.source_name`, `source_url`) and a list of more sources
  (`events.sources` = `[{ name, url, at, kind? }]`, at most 30, `kind: 'context'` = background
  article). Sources are added by `whatsapp-ingest` (duplicate of an existing event), by the dedupe
  agent (`_shared/dedupe.ts` folds one event into another) and by `intel-crawler`.
- **About 945 events a day.** 50% have one source, 21% two, 16% three or four, 14% five or more.
  When more sources come, half arrive within 29 minutes and 90% within 112 minutes.
- **92% of events come from Telegram** (96 active channels of 495 known), 8% from news sites. The
  busiest sources are Lebanese channels, many of them aligned with Hezbollah.
- The same channel appears under several names ("Telegram – X", "Telegram – X / cited name"), so a
  source must be recognised by its link (`t.me/<username>/…` or the site's domain), never by name.
- **The cited outlet is already detected, free.** The classifier in `whatsapp-ingest` returns
  `original_source` ("Outlet/source named in the message") and it is glued to the source name
  after " / ". 47% of events carry such a name; about **46 events a day** cite one of the 30
  outlets in today's mainstream list (Al Jazeera, Al Arabiya, Reuters, Axios, N12 …), and more
  cite official bodies ("IDF Spokesperson") and state agencies (SANA, IRNA).
- **Every Telegram message we receive is kept for about 25 days** in `whatsapp_ingest_log`
  (`msg_key = tg:<username>/<post id>`, `message_text`, `sent_at`, `event_id`). The channels of
  Al Jazeera, Al Arabiya, Al Hadath, SANA, ynet, Kan, IRNA, the IDF (`idf_telegram`) and CENTCOM
  (`U_S_CENTCOM`) are among the monitored ones. This is the free place to check a citation.
- **Pictures and video.** 48% of events have at least one picture or video still
  (`event_media`, kinds `image` and `video_thumb`), 21% have video, 8% have media from two or more
  channels. Every row has `sha256` (exact bytes) and almost every one `phash` (64-bit picture
  hash, `_shared/imageHash.ts`), and `source_msg_key` says which channel posted it. The media
  dedupe (`event-agent` `media_dedupe`, every 10 minutes, and `attachMedia` at ingest) already
  keeps one copy of each picture **per event** — so the rows that remain are different pictures.
  Nothing today looks for the same picture on **another** event: in 14 days 71 pictures (exact
  bytes) or 146 (same picture hash) had already appeared on a different event more than 24 hours
  earlier — about 1%. 61 pictures appear on three or more events (logos, portraits, file photos).
  Terrain geolocation (`geoloc_jobs`) has no accepted results at the moment.
- `intel-crawler` is **switched off** (`app_settings.intel_crawler.enabled = false`; the last row
  in `intel_items` is from 2026-11-10). The design does not depend on it.
- Today's "verified" tick: trigger `events_auto_verify` (migration 28) sets `is_verified` when
  two different outlets of `mainstream_outlet(name, url)` appear. It matches on the *name*, so a
  channel that only writes "/ Reuters" counts as Reuters. Of 349 ticks in 14 days, about 23 (7%)
  rest on a cited name and not on the outlet itself. This spec does not change the tick (see
  Open decisions 7).
- Money: editing costs about $20 a day today (`ai_usage`, purpose `edit`); a Haiku 5.5 call for
  classification costs about $0.0005. Budgets live in `app_settings` (`deep_daily_budget_usd`,
  `eei_daily_budget_usd`); plans in `plan_features` (`guest`, `free`, `pro`, `max`, `intel`).
- A push to `main` that touches `supabase/functions/**` deploys those functions by itself
  (`.github/workflows/deploy-functions.yml`), so all new server code must do nothing while the
  flags are off.

## Approaches considered
- **A. Points with caps, computed in the database (chosen).** Each kind of confirmation gives
  points; each group of points has a ceiling; the sum is the score. Why: the owner thinks in
  weights, every number can be explained in one line ("official source +55"), staff can tune the
  numbers, it costs nothing, and the same event always gets the same score.
- **B. Probability model.** Each independent source has a reliability (official 0.85, mainstream
  0.6 …) and the score is the chance that at least one is right. Mathematically tidier, but the
  result cannot be explained to a reader in a line, and "weights" stop meaning points. Rejected.
- **C. The AI reads all the reports and gives a number.** About $0.0005–$0.02 per event and per
  update, a different answer each time, and no honest "why". Rejected (cost and trust).
- **Where the formula runs:** a database trigger on the event row (chosen) or code in each Edge
  Function that writes sources. Five places write sources today; a trigger catches all of them and
  any future one, exactly like `events_auto_verify`, and updates the score in the same write.

## Decisions
- **What the number means: how well the report is confirmed by sources — not "this is true".**
  The UI name is "אימות מקורות" / "Source confirmation" with the percentage, and every breakdown
  ends with a fixed sentence saying so. The owner's working name "ציון אמיתות" stays internal
  (Open decisions 1). The score never shows 0 or 100: it is kept between 5 and 99.
- **A source is recognised by its key:** `tg:<username>` from a `t.me` link, `web:<domain>` from
  any other link (without `www.`, `m.`, `english.`, `arabic.`, `edition.`), `name:<normalised
  name>` only when there is no link. Five posts of one channel are one source.
- **Sources belong to outlets.** An outlet is the organisation: "Al Jazeera" owns
  `tg:AjaNews`, `tg:AJPalestine`, `web:aljazeera.com`, `web:aljazeera.net`. Mirror channels and
  channels of one network are put under one outlet by staff. Two sources of one outlet are never
  two confirmations.
- **Classes (per outlet):** `official` — a state's army, government or emergency body speaking for
  itself (IDF Spokesperson, CENTCOM, Israel Police, Home Front Command, Lebanese Army, UNIFIL);
  `mainstream` — news agencies and established newsrooms; `state_media` — a state's news agency or
  channel (IRNA, SANA, Press TV); `partisan` — a party's or armed group's own media and channels
  aligned with one side (Hezbollah military media, Al Mayadeen, Hamas channels); `unknown` — the
  rest. Armed groups' official outlets are `partisan`, not `official` (Open decisions 3).
- **Side (per outlet):** `israel`, `west` (US, Europe), `axis` (Iran, Hezbollah, Hamas, Houthis,
  Iraqi militias and their media), `arab` (Lebanese, Syrian, Palestinian, Gulf, pan-Arab not in
  the axis), `neutral` (news agencies, UN bodies), `unknown`. Opposing pairs: israel–axis,
  israel–arab, west–axis. With no row for a channel the side comes from
  `telegram_channels.region` (israel → israel; iran, yemen → axis; international → west; the
  others → arab).
- **Language (per source):** `he`, `ar`, `fa`, `en`, `other` — from the letters of the source's
  own text at ingest (Persian told from Arabic by پ چ ژ گ), else from the outlet's row.
- **High classes are given by people only.** `class` is written by the seed in the migration
  (the owner approves it with this spec and reviews it in rollout step 3) and by staff. The AI
  never writes `class`: it writes `suggested_class`, which counts for nothing until a staff
  member accepts it. The AI's side and language suggestions count at once.
- **Variety counts real sides only.** `neutral`, `unknown` and a missing side give no side
  points. An outlet's languages are those of all its sources in the event.
- **Independent origins — the unit that is counted.** In this order:
  1. Sources with `kind: 'context'` are ignored (as today).
  2. Sources are reduced to keys, keys to outlets.
  3. **Echo:** a source that names another outlet (`cited`) is an echo of that outlet, not a
     source of its own. Five channels writing "Reuters: …" are one origin — Reuters — and Reuters
     counts only if the citation is confirmed (next section). Common loose phrases ("Hebrew
     media", "Lebanese reports", "إعلام العدو", "מקורות לבנוניים") are seeded as pseudo-outlets
     with a side, so an Israeli channel relaying "reports in Lebanon" is not counted as an
     Israeli confirmation.
  4. **Copy:** sources with the same text key (`tk`, the first 400 characters normalised and
     hashed — the rule `telegram-worker` already uses to drop copies) or a "forwarded from" name
     are one origin: the earliest, or the channel it was forwarded from.
  5. **No link, no credit:** a source without a link (for example a name the editor wrote from
     the text) is a citation of that outlet, never an origin of a high class.
  6. A cited name that matches no outlet is ignored and the source stands for itself.
  Known limit, stated in Risks: channels that rewrite each other without credit look independent.
- **The formula (version 1; every number lives in `app_settings.truth_weights`):**

  | Part | Points | Ceiling |
  |---|---|---|
  | **A. Best origin** — the highest class among the origins | official 55 · mainstream 42 · state_media 28 · partisan 18 · unknown 12 | one value |
  | **B. More strong origins** — every other official / mainstream / state_media origin | official +15 · first mainstream +20, each further +8 · state_media +6 | 25 |
  | **C. Other independent origins** — partisan and unknown ones not counted above | +5, +4, +3 | 12 |
  | **D. Variety** — sides: an opposing pair +12, two other different sides +6; languages: two or more +4 | | 16 |
  | **F. Visual evidence** — new footage or photos (rules below) | video +8 or photo only +5 · each further independent footage origin +3, +4 when it is from an opposing side · footage checked and matching the place +4 | 12 |
  | **E. Citation not found** at the outlet | −8, once per event | |
  | **G. Old or mismatching picture** and no new footage | −6, once per event | |

  `score = clamp(A + B + C + D + F + E + G, 5, 99)`, then:
  - **One-side ceiling 45:** no official and no mainstream origin, and every origin on one side.
  - **Staff tick floor 90:** `is_verified` set by a person — true, and
    `ai_suggestions.verified_by` (which `events_auto_verify` writes) is absent.
  - **Staff override** replaces everything (below).

  | Example | Score |
  |---|---|
  | One unknown channel | 12 |
  | One partisan channel | 18 |
  | Four independent channels of one side | 30 |
  | Two Lebanese channels + one Israeli channel, Arabic and Hebrew | 18+9+12+4 = 43 |
  | One mainstream outlet | 42 |
  | Channel cites Al Jazeera, found at Al Jazeera | 42 |
  | Channel cites Al Jazeera, not found there | 18−8 = 10 |
  | Two mainstream outlets (today's tick) | 62 |
  | IDF Spokesperson alone | 55 |
  | IDF Spokesperson + a Hezbollah channel, two languages | 55+5+12+4 = 76 |
  | IDF + two mainstream outlets + other side + two languages | 55+25+12+4 = 96 |
  | One partisan channel with a new video | 18+8 = 26 |
  | One partisan channel with a picture seen on an older event | 18−6 = 12 |
  | Two Lebanese channels + one Israeli, each side with its own footage | 43+8+4 = 55 |
  | One mainstream outlet + a video from a local channel | 42+5+8 = 55 |
  | IDF + two mainstream + other side + two languages + video | 96+8 → 99 |

  **Making room for media.** Part F is new (ceiling 12). To pay for it, C went from 15 to 12
  (a fifth and sixth extra channel no longer add) and D from 20 to 16 (a third language no longer
  adds). The ceilings still add up to more than 99 (55+25+12+16+12 = 120) on purpose: there are
  several different roads to a high score, and the final clamp keeps the top at 99 whatever is
  added. A table whose ceilings sum to exactly 99 was tried and dropped: two mainstream outlets
  came out at 52 and the IDF alone at 45, against requirement 1.

- **Visual evidence (part F).**
  - **What is counted:** the event's `event_media` rows of kind `image` / `video_thumb` that
    survived the existing dedupe. The same photo reposted by ten channels is one row and counts
    once, credited to the channel whose copy was kept. Nothing new is hashed or downloaded.
  - **Each picture is one of:** *new*; *shared* — the same picture (same `sha256`, or same
    `phash`) is on another event from the last 24 hours (probably a missed duplicate or a file
    photo): no credit, no penalty; *old* — the same picture is on another event more than 24
    hours older: no credit; *stock* — the picture is on three or more other events (logo,
    portrait, file photo): no credit, no penalty.
  - **Points are per footage origin, not per file.** The origin is the outlet of the channel in
    `source_msg_key`. Ten new photos from one channel are one footage origin. The first origin
    gives +8 when it has new video, +5 for photos only. Each further origin with its own new
    pictures gives +3, or +4 when it is on an opposing side to one already counted. Ceiling 12.
  - **Old picture penalty (part G), −6 once:** the event has an *old* picture and no *new* one.
    When new footage sits next to an old picture, the old one is taken as illustration: no credit
    for it, no penalty. Why not harsher: outlets attach file photos as a matter of routine, and
    our memory of pictures starts on 2026-10-20 (Open decisions 12).
  - **Does the footage show this place? Only from data that already exists — no new paid call.**
    A small table `truth_media_checks` holds a verdict per picture: `match`, `mismatch`,
    `illustration`. Three writers: (1) staff, by hand, in the event editor; (2) terrain
    geolocation, when a job for the picture has an accepted result within 5 km of the event's
    point; (3) the planned "translate image / video" button in Expand — when it is built, its one
    Claude call also returns "does this show what the report says: yes / no / unclear", and that
    answer is stored. `match` → +4 inside the ceiling of 12; `mismatch` → the picture is treated
    as *old* (no credit, −6 when there is no other new footage); `illustration` → like *stock*.
    With no verdict the picture simply counts as unchecked footage (the +8 / +5 above).
  - **Timing.** Pictures arrive seconds to minutes after the event row and repeats are removed
    every 10 minutes, so media changes do not recompute at once: they put the event in a small
    queue and the 5-minute tick recomputes each queued event once.
  - **Dark or blank frames** (a `phash` with fewer than 8 or more than 56 bits set) are compared
    by `sha256` only, so two black video stills are not called the same picture.
- **No decay with time.** The score changes only when the sources, a citation result, the tick or
  the override change. Why: half of our events are small local reports nobody else will ever
  repeat; lowering them by the clock would punish them for being local. An archived event keeps
  its last score.
- **A confirmed citation counts as the outlet itself**, with the outlet's class, side and
  language. A citation that could not be checked gives nothing and takes nothing: the echoing
  channels count as one origin of their own best class.
- **Bands and colours:** 5–34 "single / unconfirmed" **grey**; 35–59 "partly confirmed" amber;
  60–79 "well confirmed" light green; 80–99 "confirmed by several kinds of sources" green.
  Low is grey, not red: red would say "false", and a lone report is only unconfirmed. Red is used
  only for an event staff marked "disputed".
- **First 30 minutes:** an event published less than 30 minutes ago with a score under 35 shows the words
  "Initial report" in place of the number (client side only; `truth_score.initial_minutes`).
- **Staff override** (whoever may edit any event, `event.edit.any`): in the event editor — "Set
  score" with presets *Confirmed by the desk (95)*, *Disputed (10, red)*, a free number, and a
  required note; "Clear" returns to the computed score. Stored on the event, written to
  `event_history`. The public breakdown then says "Set by the editorial desk".
- **Plans (Open decisions 5):** two keys. `truth_score` = the badge: guest off (locked chip →
  sign-up), **Free, Pro, Max, Intel on**. `truth_detail` = the "why" list and the minimum-score
  filter: guest and Free off (→ upgrade window), **Pro, Max, Intel on**. Staff: always
  everything. Names and links inside the breakdown follow the existing `sources_detail` and
  `source_link` rules (Pro sees outlet names, Max and Intel also links).
- **Where it shows:** feed card, map popup, phone preview sheet (badge only) and the event
  details window (badge + "why"). Not in push, shared text or the public API in version 1.
- **No backfill.** Events get a score from the moment computing is switched on; a staff button
  recomputes the last 48 hours after the source list or the weights change.
- **Home-front alerts** (not in `published_events`) and staff reports with no source get no score.
- **Languages:** Hebrew + English through `src/i18n`; no Hebrew literals in components.

## The citation check
Runs for a pair (event, cited outlet) when the outlet's class is `official`, `mainstream` or
`state_media`. Steps, stopping at the first that answers:
0. **The outlet is already a source of the event** (one of its keys is in the list) → confirmed.
   Free, inside the trigger, no queue.
1. **Our own log.** Posts of the outlet's monitored channels (`truth_outlets.check_tg`) in
   `whatsapp_ingest_log`, from 12 hours before the citing post to 20 minutes after it.
2. **`intel_items`** titles from the outlet's domain in the same window (only when the crawler runs).
3. **One free page read**, when steps 1–2 have no posts for that window: the outlet's public
   Telegram page (`fetchChannel` in `whatsapp-ingest/telegram.ts`, at most 3 pages back) or its
   RSS feed (`parseFeed` in `intel-crawler`; `truth_outlets.check_feed`). The result is kept
   10 minutes per outlet (`truth_outlet_cache`), so twenty citations of Al Jazeera in ten minutes
   are one read. 8-second limit; at most 4 reads at a time.
4. **Matching.** The claim = the citing post's own text (first 500 characters, from the log by
   `msg_key`) and the event's English headline. Candidates are ranked by shared numbers, place
   names and words (same idea as `_shared/dedupeMatch.ts`); the best six go on.
   - A near-identical text → **confirmed**, no AI.
   - Otherwise **one cheap model call** (`CHEAP_MODELS`, Haiku 5.5, purpose `truth_cite`, logged
     with the event id): "does one of these six items report this claim? which?". It also covers
     an Arabic claim against an English headline. The texts are sent as data; the tool returns
     only a number 0–6.
5. **Paid web search — off** (`truth_score.web_search = false`): one search limited to the
   outlet's domain (about $0.02–0.03) for events of high or critical severity whose outlet cannot
   be read otherwise. Reuters, AP, BBC, The Guardian, The Telegraph and WSJ refuse this search
   (`BLOCKED_SEARCH_DOMAINS` in `editor.ts`) and stay "could not be checked".

Results, as shown to the reader:
- `confirmed` — "Found at <outlet>" with a link to the item (link by plan).
- `not_found` — "Not found at <outlet>": the outlet's items for the whole window were read and
  none matches. −8 points. The word "false" is never used.
- `unverifiable` — "Could not be checked": no channel or feed, blocked (403), paywall with no
  headline feed, the read did not reach back to the window, or the daily budget is used up.
  No points either way.
- `pending` — not checked yet; counts as `unverifiable` in the score.

A paywall does not matter when the outlet has a headline feed: headlines are matched, the article
is never opened. A `not_found` is tried again after 30 minutes and after 2 hours (the outlet's
feed can lag), then it is final. Only live events are checked (published, under 24 hours),
highest severity first, at most 20 pairs per run.

## Cost (prices from `supabase/functions/_shared/usage.ts`; volumes measured above)
- **The score itself: $0.** Plain SQL inside the write that already happens.
- **Detecting the citation: $0.** The classifier already returns it.
- **Visual evidence: $0.** Fingerprints are already made at ingest; the new work is two indexed
  lookups per picture. The optional "matches the place" verdict rides on calls other features
  already make (geolocation, the future media-translation click) or on a staff click.
- **Checking the citation:** about 46 events a day cite an outlet of today's list; with official
  bodies and more outlets, assume about 150 pairs a day. Most end at steps 0–1 with no AI. Assume
  90 model calls a day × about 1,500 tokens in and 20 out on Haiku 5.5 ($0.10 / $0.50 per million)
  ≈ **$0.02 a day**, under **$0.10 a day** with repeats — about **$1–3 a month**.
- **Budget:** `app_settings.truth_daily_budget_usd` = **0.5**. When the day's `truth_cite` spend
  reaches it, the model step is skipped and the pair becomes "could not be checked".
- **Suggesting classes for the 495 known channels, once:** five Haiku batches ≈ $0.02.
- **Paid web search (off):** if switched on with a ceiling of 20 a day, at most about $0.60 a day.
- **Database load:** one small trigger per source change (a few lookups by primary key), one cron
  tick every 5 minutes, a handful of page reads an hour. No new work per page view: the badge
  travels with the event; the "why" is one small call per opened event.

## Data model
Migrations, next free numbers after `20261113000125` (the words `drop` / `delete` kept out of the
first file, as in deep analysis — see Rollout):
`…126_truth_score.sql` (tables, columns, functions, trigger, settings, plan rows, seed),
`…127_truth_views.sql` (the two public views), `…128_truth_fk_cron.sql` (foreign keys, cron).

- `truth_outlets` — `key text primary key` (`idf`, `aljazeera`, `generic:hebrew_media` …),
  `name_he`, `name_en`, `class` (`official` | `mainstream` | `state_media` | `partisan` |
  `unknown`), `suggested_class` (the AI's idea, counts for nothing), `side`, `aliases text[]`
  (normalised names in Hebrew, Arabic, English, Persian — what a channel may write when citing),
  `check_tg text[]`, `check_feed text`, `reviewed boolean`, `note`, `updated_by`, `updated_at`.
- `truth_source_keys` — `source_key text primary key`, `outlet_key text not null`, `lang text`.
- `truth_citations` — `event_id uuid`, `outlet_key text`, primary key on both; `cited_raw`,
  `source_key` (who cited), `claim_at`, `status` (`pending` | `confirmed` | `not_found` |
  `unverifiable`), `method` (`event_source` | `log` | `intel` | `page` | `feed` | `search`),
  `reason` (for `unverifiable`), `match_url`, `match_text` (≤ 300), `used_ai boolean`,
  `attempts smallint`, `next_try_at`, `checked_at`. Index on (`status`, `next_try_at`).
- `truth_outlet_cache` — `outlet_key`, `via`, `fetched_at`, `covers_from`, `items jsonb`
  (`[{ at, text, url }]`), `ok`, `error`; trimmed daily.
- `truth_media_checks` — `media_id uuid primary key`, `event_id`, `verdict` (`match` | `mismatch`
  | `illustration`), `by` (`staff` | `geoloc` | `media_translate`), `note`, `set_by`, `at`.
- `truth_dirty` — `event_id uuid primary key`, `at`: events whose pictures changed since the last
  tick (filled with "on conflict do nothing").
- `event_media`: two new indexes, on `(sha256)` and on `(phash)` (today's index is per event),
  and a small `after insert or update of event_id, sha256, phash or delete` trigger that only
  writes the event's id into `truth_dirty` (and nothing when `compute` is off).
- All six: RLS on, no policies (service role; staff through functions).
- `events`, new columns: `truth_score smallint` (5–99 or null), `truth_why jsonb`, `truth_at`,
  `truth_override smallint` (0–100), `truth_override_note text`, `truth_override_by uuid`,
  `truth_override_at`.
- `truth_why` (small; never sent with the feed):
  `{ v: 1, parts: [{ k: 'best', class, outlet, pts }, { k: 'strong', outlets: [], pts },
  { k: 'others', n, pts }, { k: 'sides', sides: [], pts }, { k: 'langs', langs: [], pts },
  { k: 'media', video: bool, origins: n, cross_side: bool, checked: bool, pts },
  { k: 'media_old', media_id, seen_event, seen_at, why: 'old' | 'mismatch', pts },
  { k: 'cite_not_found', outlet, pts }, { k: 'cap', to: 45 }, { k: 'staff_tick', floor: 90 }],
  origins: n, sources: n, cites: [{ outlet, status, url }],
  media: { new: n, shared: n, old: n, stock: n } }`.
- Source entries gain optional keys, written from now on: `cited` (the classifier's
  `original_source`, raw), `tk` (text key), `fwd` (forwarded-from name), `lang`. The main source's
  same four values go in `events.ai_suggestions.truth_primary`. Old entries: `cited` is read from
  the name after " / "; the rest are simply missing.
- Functions (all `set search_path = ''`):
  - `truth_norm(text)` — the same normalising as `normTerm` in `_shared/terms.ts` (NFKC, lower
    case, Hebrew points and Arabic marks removed, alef forms unified).
  - `truth_source_key(name, url)` — immutable.
  - `truth_media(event id)` → per picture: kind, footage origin (outlet, side), and *new* /
    *shared* / *old* / *stock* with the earlier event's id and date, plus any verdict. Exact
    matches on the two new indexes; no picture is opened.
  - `truth_compute(event row)` → `{ score, why }` — stable; reads the two list tables, the
    event's `truth_citations`, `truth_media(id)` and `truth_weights`. This is the whole formula,
    in one place.
  - Trigger function `events_truth_score()` — `before insert or update of sources, source_name,
    source_url, is_verified, truth_override, status`, named to run **after every other
    `before` trigger** (they run in name order; today's last is `events_zzzzzz_gaza_country`).
    Does nothing unless `truth_score.compute` is on and the event is published. It also inserts
    `pending` rows in `truth_citations` for new cited outlets (an `after` trigger for that part).
  - `truth_recompute(event id)` — service role; called when a citation result changes. One
    ordinary update of the event row (`updated_at` moves, as on any merge). It must not send the
    event to the editor again or cause a push: the builder checks what `events_send_to_editor`,
    `events_after_change` and the push sender watch, and keeps these columns out of them.
  - `truth_recompute_recent()` — staff; the last 48 hours, in batches of 200.
  - `truth_details(event id)` → the "why" for the caller: null without `truth_detail`; names
    without `sources_detail`, links without `source_link`, are left out; staff get all parts
    with points per origin.
  - `truth_spent_today()` — sum of `ai_usage.cost_usd` for purpose `truth_cite`.
  - `truth_tick()` — cron `osintfront-truth-tick`, every 5 minutes: (1) when `compute` is on,
    recomputes up to 300 events waiting in `truth_dirty` and empties them from the queue;
    `truth_recompute` writes the row only when the score or the "why" really changed; (2) when
    `citation_check` is on, there are due pairs and budget is left, calls `event-agent`
    `{action:"truth_check"}` (the `eei_tick` pattern). Otherwise nothing.
  - Staff functions for the admin screen: list / save an outlet, attach a key to an outlet,
    "sources seen in the last 7 days with no outlet" (by number of events), score distribution.
- Views `published_events` and `archived_events`: the same columns in the same order plus
  **`truth_score`** at the end = `coalesce(truth_override, truth_score)` when the caller is staff,
  or `truth_score.public` is on and `my_feature('truth_score')`; else null. The helper keys `tk`
  and `fwd` are removed from `sources` on the way out.
- `app_settings`: `truth_score` = `{ "compute": false, "public": false, "citation_check": false,
  "web_search": false, "initial_minutes": 30 }`; `truth_weights` = the table above;
  `truth_daily_budget_usd` = `0.5`.
- `plan_features`: `truth_score` and `truth_detail` rows for the five plans, as in Decisions.
- Seed: the 30 outlets of `mainstream_outlet()` as `mainstream`, with their name forms as aliases
  and their monitored Telegram channels (matched by hand from `telegram_channels` while writing
  the migration); IDF Spokesperson (`tg:idf_telegram`), CENTCOM (`tg:U_S_CENTCOM`), Israel Police,
  Home Front Command as `official`; SANA and IRNA as `state_media`; six generic pseudo-outlets.
  Seeded rows count from the start and are marked `reviewed = false` so the admin section lists
  them first; the full seed list is shown to the owner in rollout step 3.

## Server (`supabase/functions/`)
- `whatsapp-ingest/index.ts` — the four places that build a source entry and the insert of a new
  event also write `cited`, `tk`, `fwd`, `lang`. No prompt change, no new AI output.
- `_shared/dedupe.ts` (fold) — when a duplicate's main source becomes an entry of the kept event,
  its `truth_primary` values travel with it.
- `_shared/truth.ts` (new; pure parts with no imports so `node:test` loads them): `textKey`,
  `scriptLang`, `claimWindow`, `rankCandidates`, `decide` (the order of steps 0–5 as one function
  over injected readers), the model tool and prompt.
- `event-agent/index.ts` — actions `truth_check` (cron secret only; runs the queue), and
  `truth_suggest_sources` (staff; Haiku reads title + username + region of channels without a
  reviewed outlet, the `classifyChannels` pattern, and fills `suggested_class`, side, language).
- `intel-crawler` — unchanged. Its events already carry the outlet's own link.
- Media: `attachMedia`, `media_dedupe` and `dropRepeats` are **not changed** — the score reads
  what they leave. The geolocation worker's "result accepted" step writes a `truth_media_checks`
  row; the media-translation feature will do the same when it is built (one extra field in the
  call it makes anyway). Neither is needed for version 1 to work.
- Every new path returns at once when its flag is off.

## Client
- `src/types/event.ts`, `src/services/eventService.ts` — `truthScore: number | null`.
- `src/lib/truth.ts` (new, pure): band from score, "initial report" rule, the lines of the "why"
  from `truth_why` (keys → i18n texts).
- `src/components/common/TruthBadge.tsx` (new) — used by `EventCard.tsx`, the details window and
  the phone preview; `src/components/map/popupContent.ts` draws the same chip in the popup footer.
- `src/components/feed/EventDetailsDialog.tsx` — a "Source confirmation" section above the
  sources list; loads `truth_details` once per opened event; lock states through the existing
  `openGate('upgrade' | 'signup', 'truth_detail')`.
- `src/lib/eventFilters.ts`, `src/components/filters/FilterPanel.tsx` — `minTruth` (0 / 35 / 60 /
  80) per filter set, next to "verified only"; events with no score pass only at 0.
- `src/lib/plans.ts`, `src/pages/public/PackagesPage.tsx` — the two new keys.
- Admin: `NewsAgentsPage.tsx` gets a section "Source reliability" (outlets table; "seen, not
  classified" list with one-click class and side; AI suggestions to approve; "recompute last 48
  hours"); `SettingsPage.tsx` gets the four switches, the budget and the weights (numbers, with
  "back to defaults"); `EventEditorPage.tsx` shows the score, the full breakdown, the override,
  and under each picture a small choice "matches the place / does not match / illustration /
  not checked" with, for an *old* picture, a link to the earlier event.
  Outlets and keys: `event.edit.any`. Switches, budget, weights: `settings.manage`.

## UI
```
Card / popup:   [ 62% ]  light green chip, title text "Source confirmation"
                [ Initial report ]  grey, first 30 minutes under 35
                [ 🔒 % ]  guest → sign-up

Details window:
  Source confirmation — 76%  (well confirmed)
  ✓ Official source: IDF Spokesperson                         +55
  ✓ 1 more independent source                                  +5
  ✓ Reported by both sides (Israel, Lebanon)                  +12
  ✓ 2 languages (Hebrew, Arabic)                               +4
  ✓ New video footage, from 2 independent sources              +11
     (or: "✓ New photos" · "✓ Footage checked: matches the place")
  ⚠ Picture seen before, on an event from 3 Nov ↗               −6
     (shown instead of the footage line when the only pictures are old)
  ● Cites Al Jazeera — found at Al Jazeera ↗
  The score shows how well sources confirm this report. It is not a statement that
  the report is true. Official sources can also be wrong.
```
- Points are shown to staff only; readers see the lines without numbers (Open decisions 6).
- In the details window the picture itself carries a small corner mark when it is *old*
  ("seen before · 3 Nov") — for everyone who sees the picture, whatever the plan. *Shared* and
  *stock* pictures get no mark and no line.
- Hebrew: right-to-left, the percentage stays in Western digits.
- Colour is never the only signal: the chip always carries the number or words.

## Errors and edge cases
- More than 30 sources: the oldest fall off the list (as today); the score is computed from the 30.
- An event folded into another: the kept event is recomputed by the trigger; pending citations of
  the removed one go with it (cascade).
- A split report (several places): each part has the same sources and the same score.
- Staff change an outlet's class: nothing moves until "recompute last 48 hours".
- An outlet cited by its Telegram handle or address ("rodwan313", "lbdb.co"): resolved through
  keys, so it is an echo of that channel.
- Two outlets named in one message: the classifier returns one name; the other is missed (v1).
- The outlet's page is unreachable three runs in a row: its pairs become "could not be checked";
  the admin section shows the outlet in red.
- The score is computed before the pictures arrive: the event starts without part F and gains it
  at the next tick (up to 5 minutes).
- Two events are folded: the pictures move to the kept event, repeats are removed by the existing
  dedupe, the kept event goes through the queue once.
- The same picture on two events of the same day: neither gets credit for it and neither is
  penalised; if the two are later folded into one, it becomes one *new* picture and counts.
- A recycled video usually has a different still each time it is cut, so only straight
  re-forwards (same thumbnail bytes) are caught; rewritten copies are not (v1 limit).
- A picture older than our database (before 2026-10-20) cannot be recognised as old.
- Flags off after being on: stored scores stay, the views return null, the tick does nothing.
- The model answers with a number outside 0–6, or fails twice: "could not be checked".

## Out of scope
- Reading what a report says (denials, "X denies", conflicting casualty numbers) — the score
  counts sources, not content. Staff "Disputed" covers the cases that matter.
- Lowering a big claim that nobody repeated after some hours; time decay of any kind.
- A reliability history per channel (how often it was right); learning weights from staff ticks.
- Scores in push, shared text, daily summaries, "Ask the map" and the public API.
- Changing or removing the "verified" tick and `events_auto_verify`.
- Backfill of old events; checking citations of archived events.
- Several cited outlets per message; citations inside news-site articles.
- Reverse image search on the web, reading what a picture shows with AI as a default step,
  near-match (a few bits apart) search for old pictures across events, hashing whole videos.

## Testing
- Database (`supabase/tests/truth_score.sql`, rolled-back dry run, as the other files there):
  every row of the examples table gives its score; echo, copy, "no link no credit" and the
  generic pseudo-outlets; `kind: 'context'` ignored; the one-side ceiling; staff tick floor;
  override and clear; each citation status; an AI-suggested `official` does not count before
  approval; media: one video +8, photos only +5, ten photos of one channel count once, a second
  channel's own picture +3 and +4 from the opposing side, ceiling 12, *shared* gives nothing,
  *old* alone −6, *old* next to *new* no penalty, *stock* (three other events) no penalty,
  `match` +4, `mismatch` as old, a blank-frame `phash` is not a match, a media insert only writes
  `truth_dirty` and the tick recomputes once; the trigger does nothing with `compute` off and for drafts; `truth_recompute` queues
  no editor run and no push; the views give null to a guest, the score to Free; `truth_details` is null
  for Free, without links for Pro, full for staff; `anon` / `authenticated` cannot read the six
  tables; budget reached → the tick does not call out.
- Unit, `node:test` (`tests/truth/`): `truth.test.ts` — text key equals the worker's for the same
  text, script → language, claim window, candidate ranking, the decision order with fake readers
  (already a source / in the log / page read / not covered → unverifiable / covered and none →
  not_found / budget), model answer cleaning; `truthClient.test.ts` — bands, initial-report rule,
  "why" lines; `ingestWiring.test.ts` — the entries written by ingest and fold carry the new keys.
- End-to-end, Playwright with a faked server (`tests/e2e/truth-score.mock.cjs <he|en>
  <desktop|phone> <pro|free|guest|staff>`): four bands on cards and popups; "Initial report";
  the "why" section for Pro, with the footage line and the "seen before" line and corner mark;
  lock for Free and guest; minimum-score filter; staff override in the
  editor; text containing `<script>` in an outlet name shows as text.
- `npm run typecheck` (no new errors) and `npx vite build` must pass.
- After the silent stage: a distribution report and 40 real events (10 per band) for the owner to
  read and argue with — weights are tuned before anything is public.

## Rollout (each numbered step only after the owner approves it; everything starts off)
1. Build on `feat/truth-score`; local tests and the faked-server Playwright run.
2. Apply migrations 126–127 (nothing computes: `compute` off). Migration 128 has foreign keys
   with `on delete cascade`; as with deep-analysis migration 113, **the owner runs it himself in
   the Supabase SQL editor** and the constraints are then checked.
3. The owner and staff go over the seeded outlets in the admin section; run the one-time AI
   suggestion (≈ $0.02) and approve or fix the busiest 50 channels.
4. Merge to `main` (functions deploy by themselves, flags off). Deploy check: nothing changed.
5. `compute` on — **silent**: staff see scores, readers do not. Two days.
6. Distribution report + the 40 events (among them every event with an *old* picture, for the
   owner to judge whether −6 is right); tune weights; "recompute last 48 hours".
7. `citation_check` on; after one day report: pairs checked, found / not found / not checkable,
   cost. The owner reads 20 results.
8. `public` on. Free / Pro / Max as decided. Watch for a week.
- **Rollback at any step:** switch the flag off — badges disappear on the next load, the tick and
  trigger go idle. Nothing has to be undone in the database; the new columns and tables are inert.

## Risks
- **"Truth" is a promise we cannot keep.** An official statement can be wrong or deliberate; two
  agencies can repeat one bad source. The name, the fixed sentence and the 99 ceiling say what the
  number is. The terms page gets one line: the score is automatic, describes source confirmation
  only, and is not a statement of fact about any person or body. "Not found at <outlet>" is the
  strongest wording used about a citation; never "false" or "fake".
- **Most of the map will look weak.** Half of the events have one source, so roughly two thirds
  are expected to land in the grey band (to be measured in step 6). Grey instead of red, "Initial
  report" in the first half hour, and step 6 before going public are there for this.
- **The source list is a political statement.** Who is "official", who is "partisan", which side
  Al Jazeera is on — these are the owner's calls, visible to readers through the score. The list
  is his to edit, and high classes are never given by the AI alone.
- **Hidden copying.** Channels that rewrite each other without credit count as independent. The
  ceilings (12 for extra channels, 45 for one side) limit the damage; grouping networks under one
  outlet is the lasting fix and needs staff time.
- **A picture is not proof.** Without looking at it, the system cannot tell a strike video from
  a map, a screenshot or a portrait. That is why footage is worth at most 12 of 99, why the
  "why" line says "footage attached", not "footage confirms", and why the +4 exists only when
  someone or something really checked it. Old pictures are caught only if we have seen the very
  same file before; a clip re-cut from an older war passes as new.
- **Gaming.** Someone could write "according to Reuters" to borrow credit: it earns nothing until
  found at Reuters, and costs 8 points when it is not.
- **"Not found" can be our miss.** A statement made on air only, or deleted, or a feed that lags.
  The repeat checks and the small penalty (−8, not a collapse) keep this from doing real harm.
- **Database load.** The project overloaded once (October). The trigger is a handful of key
  lookups and the tick is bounded (20 pairs, 4 reads); step 5 is where this is watched.

## Open decisions for the owner (recommended default in bold)
1. **Public name.** **"אימות מקורות — 62%" / "Source confirmation"**, or "ציון אמיתות" / "Truth
   score" as he called it (stronger, legally riskier).
2. **The weights** in the table (official 55, mainstream 42, …) — **start with them and tune in
   step 6** on real events.
3. **Who is "official".** **States' armies, governments and emergency bodies only**; Hezbollah,
   Hamas and Houthi official media are "partisan" (18), state agencies such as IRNA and SANA are
   "state media" (28). Or: treat all sides' official outlets alike.
4. **The mainstream list.** **Today's 30 outlets**, plus his yes / no on adding Lebanese
   newsrooms (LBCI, MTV, Annahar, L'Orient Today, Naharnet), Sky News Arabia, Asharq News,
   Al Araby TV, Iran International, Fox News, Financial Times.
5. **Who sees it.** **Badge: Free and up (guests see a lock). "Why" + filter: Pro, Max, Intel.**
   Or everything for paying plans only.
6. **Points in the "why" list.** **Staff only**; readers see the lines without numbers.
7. **The "verified" tick.** **Leave it as it is for now**; after step 6 decide whether the tick
   should follow the new rules (which would also fix the 7% that rest on a cited name).
8. **Low scores in public.** **Show them, in grey**, with "Initial report" for the first 30
   minutes. Or hide the badge under 35.
9. **Paid web search for outlets we cannot read.** **Off.** Later, perhaps, for critical events only.
10. **Daily budget for citation checks.** **$0.50** (expected use: a few cents).
11. **Weight of footage.** **Video +8, photos +5, second independent source +3 (+4 other side),
    checked footage +4, at most 12** — modest, because nothing looks at the picture. Or heavier
    (for example video +15) once footage can really be checked.
12. **Old picture.** **No credit, and −6 only when the event has no new footage** (file photos
    are routine). Or stricter: −10 whenever any old picture is attached.
13. **"Does the footage match the place" check.** **Free sources only** (staff click,
    geolocation results, the future media-translation click). Or a paid look at every video of
    high-severity events — about $0.002–0.01 each, not recommended now.
