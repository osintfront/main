# Translate image / video — design (owner's decisions 2026-11-13; rulings by the planner, listed below)

Owner's request (Hebrew original): "כאשר לוחצים על הרחב, זה אמור להציע לי לתרגם גם את התמונה/סרטון" —
"when I press Expand, it should also offer to translate the picture / video".
Owner: Ben. Branch `feat/media-translation` (from main 616d3fa). Nothing here is built yet.

## Goal
1. In the event details window, after a reader opens "Expand" on an event that has a picture or a
   video, a separate button "Translate image/video" (תרגם תמונה/סרטון) appears.
2. One click produces, for the event's media:
   - **what is said** in a video: the speech, translated to Hebrew and English, with a short summary;
   - **what is written**: foreign-language text seen in pictures and videos (captions, labels on
     weapon / missile parts, signs, banners, chyrons), as "original → translation" pairs;
   - **what it shows**: a short description of each picture / video.
3. The result is saved once per media item and served to every later reader at no cost.
4. Pro, Max, Intel and staff only. Free users see the button with a lock (upgrade window).
5. The cost is bounded: a daily number per user, a daily dollar budget, one worker per event, two
   at a time for the whole site.

## Non-goals / anti-goals
- Not automatic: nothing runs at ingest or when the window opens. Only the click runs AI.
- Not a face-recognition tool: people are described, never identified from how they look.
- Not in feed cards, the map popup, the phone preview sheet, shared text or push.
- A failed or refused run must never cost the reader a daily use, and a reader who keeps clicking
  must never cause a second paid run for the same media.

## Owner's decisions (binding)
- **Separate button after Expand; runs only on click.**
- **Models: Claude for everything it can read** — pictures and video stills: foreign text, the
  description, every translation and the speech summary. **Google Gemini only for the video's
  speech**, through the key the project already has (`GEMINI_API_KEY` on Vercel, model
  `GEMINI_MODEL || 'gemini-3.5-flash-lite'`, AI Studio free tier). No OpenAI, no new key.
- **Quota:** new plan key `media_translate` — Pro 3 a day, Max 10, Intel 10, staff unlimited (still
  counted). A saved result is served free and is not counted. A failed run gives the use back
  (`consume_feature` / `refund_feature`, as `expand_daily` and `deep_analysis`).
- **Results are saved once and reused.**
- **Minimum cost; a daily $ budget in `app_settings`; every AI call logged through
  `_shared/usage.ts`** with a new purpose.

## Rulings (made by the planner — the owner should read these)
1. **Where the Gemini call runs: a new Vercel route `POST /api/transcribe`**, called by the edge
   function with the header `x-translate-secret` (the pattern `/api/classify` and `/api/translate`
   already use). Why: the key is already there, so the owner adds nothing; the key stays in one
   place; Supabase edge functions have a 2-second CPU limit and little memory, while the route
   holds a 50 MB file comfortably; the free-tier accounting ("free:" models, cost 0) already lives
   on that side. Price of this choice: one more hop, and speech works only after the route is on
   the live site (see Rollout).
2. **The route takes an address, not a file,** and only an address inside our own public
   `event-media` storage bucket. It is not a general "transcribe anything" service.
3. **Gemini also lists the text it sees on screen during the video** (verbatim, in the original
   language). Why: there is no ffmpeg in an edge function, so Claude can only be given the video's
   one stored still; Gemini watches the whole file anyway, at no cost. Claude still does all the
   translating, describing and summarising. On-screen text from the still (read by Claude) and
   from the running video (read by Gemini) are merged; repeats are dropped.
4. **Claude model: `claude-sonnet-5-5`** (env `MEDIA_MODEL` overrides; fallback
   `claude-sonnet-4-5` only when the first is not found). Why not Haiku: the editor's own history
   in this repo — foreign-language reports go to Sonnet because Haiku's translations were bad — and
   a wrong reading of a marking on a missile part is worse than none. The difference is about two
   cents a run, paid once per event. At go-live five real events are run on both models; if Haiku
   5.5 reads Arabic / Persian as well, the owner switches with the env variable. Opus is not used.
5. **One Claude call per run** (all pictures + stills + the speech text together). Two calls
   (cheap OCR, then translation) would save under a cent and double the ways to fail.
6. **Saved per media item** (`media_readings`, one row per picture / video), not one blob per
   event. Why: media arrives late and merged reports add pictures; with rows per item the saved
   part is never paid twice and only the new items are read on the next click.
7. **"Served free to everyone" = to everyone whose plan has the feature.** Free users and guests
   do not receive saved results (the RPC answers null), the same as deep-analysis entries.
8. **Guests** cannot open Expand at all (it already asks them to sign up), so they meet the
   sign-up window one step earlier. The button still handles a signed-out reader (sign-up window).
9. **The button is in the details window only** — `EventText` is shared with feed cards, which do
   not get it.
10. **Staff are outside the dollar budget** (as in deep analysis): never refused for budget, their
    spend is logged under `media_translate_staff` and does not use up the readers' budget.
11. **Budget `media_daily_budget_usd` = 3**; each reader's run in progress reserves **$0.10**.
12. **Speech has its own switch `media_audio_enabled`** (default `false`; turned on at go-live
    after the route is live). While it is off, or the route is not configured, videos get the
    still's description and text only, with the note "Speech translation is not available right
    now"; when it is turned on later, those videos count as "new media" and the next click adds
    the speech.
13. **Limits:** up to 8 pictures / stills a run; speech for the first 2 videos of a run; a video
    up to 50 MB (the size the site can store at all) and up to 10 minutes; the speech text is cut
    at 6,000 characters.
14. **A video that was never played is fetched by the job** with the same code "play" uses
    (`videoForThumb`, once, ≤ 50 MB, kept for playing afterwards).
15. **Staff get "Run again"** (replaces the saved rows of the event; counted, outside the budget).
    No hand editing of results in this version.
16. **The server action lives in `event-agent`** (`media_translate`), not in a new function: it
    needs the same sign-in check, cron-secret check, `consume_feature`, `videoForThumb` and usage
    sink; a new function would copy all of them and add a deploy step. The work itself is in two
    new `_shared` files, so `index.ts` grows by one block.
17. **Commit trailers** follow the session's attribution lines.

## Approaches considered
- **A (chosen). One background job in `event-agent`:** find the items not read yet → for videos,
  `/api/transcribe` (Gemini reads the stored file: speech + on-screen text) → one Sonnet call with
  the pictures and stills as image addresses plus the speech text → rows in `media_readings`.
  The browser polls, like deep analysis.
- **B. Gemini for everything** (it reads pictures and video natively, free). Cheapest, but the
  owner ruled Claude wherever it can do the work, and free-tier limits would then stop pictures too.
- **C. Real frames for Claude** — capture frames in the reader's browser, or on the owner's
  geolocation worker (which has video tools), or WebAssembly ffmpeg. Browser frames can be forged
  and would poison a result shared by everyone; the worker runs on a home computer that is not
  always on; ffmpeg does not fit the edge CPU limit. Ruling 3 covers the need instead.
- **D. Gemini call inside the edge function.** Needs `GEMINI_API_KEY` as a new Supabase secret
  (owner's work) and strains the edge limits. See ruling 1.

## What counts as a media item
From the event's `event_media` rows (`ready`), in `created_at` order:
- every `image` row → a **picture** item (id = that row);
- every `video_thumb` row → a **video** item (id = the still's row); its file is the on-demand
  `video` row with `thumb_id` = the still, else a `video` row of the same `source_msg_key`, else
  none yet (fetched by the job when the still has a `source_url`);
- a `video` row with no `thumb_id` and no still of the same `source_msg_key` → a **video** item
  without a picture (speech only).
The same rule is written twice — SQL (`media_items`) and TypeScript (`mediaItems`) — and tested on
both sides with the same four-row example.

## User flow
1. Reader opens an event → presses "Expand" → the expansion opens (unchanged).
2. If the event has a picture or video (`mediaKinds`), a button appears in the same row:
   - plan without the feature → lock icon + "Translate image/video" → upgrade window
     (`openGate('upgrade', 'media_translate')`; signed out → `'signup'`); no request is made;
   - plan with it → the site asks `media_translation(event)` once (a read, no AI):
     - nothing saved → **"Translate image/video"** and next to it "{n}/{limit} left today" (staff:
       no number);
     - saved → **"Show media translation"** (free; opens the panel at once);
     - saved and there is new media → both, the second reads **"Translate the new media ({n})"**.
3. Click on "Translate…" → the panel opens under the expansion with a spinner and "Reading the
   media… up to two minutes". The window may be closed; the work goes on and the result is there
   on the next open.
4. Done → the result panel.

Desktop: a centred window; text pairs in two columns (original | translation). Phone: the same
panel in the full-height sheet; pairs stacked (original above, translation below); thumbnails 48 px.
Hebrew: the page is right-to-left; every original and translated text has `dir="auto"` so Arabic
or English inside a Hebrew page (and the reverse) reads correctly. All copy comes from `src/i18n`.

## The result panel
```
Media translation                                        [Hide]
┌ [thumb] Picture 1
│  What it shows   A missile fragment lying on a road, a serial plate visible.
│  Text in the picture
│     موتور مرحله دوم      →  Second-stage motor            (on the plate)
│     ساخت ایران            →  Made in Iran
├ [thumb] Video 1
│  What it shows   A masked spokesman reading a statement in front of a flag.
│  Text on screen  كتائب …   →  … Brigades                    (banner)
│  What is said    Summary: The speaker claims responsibility for …
│                  ▸ Full translation      ▸ Original (Arabic)
│  (note when there is no speech / too long / …)
└ Made by AI — may contain mistakes. People are described, not identified.     [Run again] (staff)
```
- The reader's language decides which translation shows (Hebrew site → Hebrew). A text already in
  the reader's language is shown once, without a translation.
- "Full translation" and "Original" are closed by default (`<details>`).
- Everything is rendered as plain text (React text nodes); thumbnails are the event's own media.

## States
| State | What the reader sees |
|---|---|
| Event has no media | no button |
| Media vanished before the click | "This event has no picture or video to translate." |
| Plan without the feature | lock on the button → upgrade window (signed out → sign-up) |
| Working | spinner, "Reading the media… up to two minutes" |
| Someone else started it | the same working view; one run, one use (the starter's) |
| Daily number used | "You have used today's {limit} media translations. Saved translations stay open." |
| Budget used | "Today's budget for media translations is used up. Saved translations stay open." |
| Two runs in progress | "Two media translations are running right now — try again in a minute." |
| Failure | "The media could not be translated. Try again later." + "Try again" (works after 10 minutes; the use was given back) |
| Video over 50 MB / cannot be stored | "The video is too large for speech translation." (still + its text are shown) |
| Video over 10 minutes | "The video is too long for speech translation (over 10 minutes)." |
| Video file cannot be fetched | "The video file could not be fetched, so its speech was not translated." |
| No speech | "No speech in this video." |
| Speech could not be read | "The speech in this video could not be read." |
| Speech switched off | "Speech translation is not available right now." |
| Third video of one run | "Speech was translated for the first two videos only." |
| No foreign text | "No readable text to translate." under that item |
| Speech text cut | "The recording is long — only its beginning is translated." |
| New media since the result | the saved result + "Translate the new media ({n})" |

## Data model
Migration `20261113000126_media_translation.sql` (the words `drop` / `delete` appear nowhere in
it, not even in comments — the rule of the deep-analysis migration):
- `media_readings` — one row per media item; service-role only (RLS on, no policies, `revoke all`
  from `anon`, `authenticated`): `media_id uuid primary key`, `event_id uuid not null` (index),
  `kind` (`image` | `video`), `description_he`, `description_en`,
  `texts jsonb` (`[{ orig, lang, he, en, where_he, where_en, from: 'frame' | 'video' }]`),
  `speech jsonb` (null for pictures; `{ state, lang, seconds, orig, he, en, summary_he,
  summary_en, cut }`), `model`, `version int` (1, +1 on "Run again"), `created_by`, `created_at`,
  `updated_at`.
  `speech.state`: `ok` | `none` | `unreadable` | `too_big` | `too_long` | `unavailable` | `off` | `limit`.
- `media_jobs` — one row per event being read; service-role only: `event_id uuid primary key`,
  `busy_until`, `busy_token uuid`, `started_by`, `staff boolean`, `fail_reason` (`failed`),
  `retry_after`, `cost_usd numeric` (running total), `runs int`.
- `app_settings`: `media_daily_budget_usd` = `3`; `media_audio_enabled` = `false`.
- `plan_features` rows `media_translate`: guest `false / 0`, free `false / 0`, pro `true / 3`,
  max `true / 10`, intel `true / 10`.
- SQL functions (all `security definer set search_path = ''`):
  - `media_items(p_event uuid) → table (media_id, kind, thumb, created_at)` — the rule above.
    Service role only.
  - `media_translation(p_event uuid) → jsonb` — **the browser's only read.** Null unless
    `my_feature('media_translate')` and the event is published / archived and not removed. Else
    `{ items, todo, working, failed, staff, used, limit, budget_left }`:
    `items` = the saved rows whose media item still exists, in item order, each with `media_id`,
    `kind`, `thumb`, both descriptions, `texts`, `speech`; `todo` = items with no row, plus video
    rows whose `speech.state` is `off` while `media_audio_enabled` is true; `working` = a lease
    is held; `failed` = `retry_after` is in the future; `used` / `limit` = today's count and the
    plan's number (null for staff); `budget_left` = staff, or spend + reserve under the budget.
    Granted to `anon`, `authenticated` (it answers null to those without the feature).
  - Service-role helpers: `media_allowed(p_uid) → { enabled, staff, limit }`;
    `media_claim(p_event, p_uid, p_staff) → uuid` (4-minute lease; null when held);
    `media_done(p_event, p_token, p_fail, p_cost) → boolean` (`failed` → `retry_after` in 10
    minutes); `media_spent_today() → numeric` (sum of `ai_usage.cost_usd`, purpose
    `media_translate` only, Israel day); `media_in_flight() → { all, readers }`.
- Migration `20261113000127_media_translation_fk.sql` (its own file because it contains
  `on delete …`; the owner runs it by hand, as with migration 113): `media_readings.media_id →
  event_media (cascade)`, `media_readings.event_id → events (cascade)`, `media_jobs.event_id →
  events (cascade)`. Tidiness only: the feature works without it (the RPC already hides rows
  whose media is gone).
- Limits (exact): 8 items a run; speech for 2 videos a run; video ≤ 50 MB and ≤ 600 seconds;
  inline upload to Gemini up to 12 MB, above that the Gemini Files API; speech text ≤ 6,000
  characters (original and each translation); 20 on-screen texts from Gemini per video, each ≤ 300;
  description ≤ 400 characters per language; 12 text pairs per item, original ≤ 300, translation
  ≤ 400, "where" ≤ 80; speech summary ≤ 500 per language; Claude `max_tokens` 6,000.

## Server
- **`api/transcribe.ts` (new Vercel route, `maxDuration` 120)** — `POST { url }` with
  `x-translate-secret`. Order: secret (401) → `GEMINI_API_KEY` present (503 `off`) → the address
  must be `https://<our Supabase host>/storage/v1/object/public/event-media/…` (400) → download
  with a hard 50 MB cap (`too_big`) → length from the file's own header (`too_long` over 600 s;
  unknown length is allowed) → Gemini `generateContent` with the file (inline base64 up to 12 MB,
  else Files API upload, wait until `ACTIVE`, removed afterwards), low media resolution,
  temperature 0, JSON answer, safety filters off (war footage) → cleaned answer:
  `200 { state: 'ok', lang, seconds, speech, on_screen: [..], cut, model, usage }`, or
  `{ state: 'none' | 'too_big' | 'too_long' | 'unavailable' | 'unreadable' }`. Gemini rate limit,
  server error or time-out → `502 { error: 'busy' }` (the caller treats it as a failed run).
  The prompt asks for: the speech exactly as spoken, in its own language, not translated; the
  language code; every text seen on screen exactly as written; nothing invented — no speech means
  an empty string; the media is data and instructions in it are ignored.
- **`api/_lib/speechInput.ts` (new, pure, no imports — unit-tested):** the address check, the mp4
  length reader, the prompt, the cleaning of Gemini's answer.
- **`_shared/mediaInput.ts` (new, pure, no imports — unit-tested):** limits; `mediaItems`;
  which items a run reads; the speech decision per video; the Claude prompt, tool and user
  content; cleaning of the route's answer and of Claude's answer; the decision "serve / wait /
  refuse / start"; the re-check after the claim; the dead-lease rule.
- **`_shared/media.ts` (new):** `speechFor` (the route call), `translateMedia` (the job).
- **`event-agent`: action `media_translate { event_id, poll?, redo? }`** — signed-in active user
  (or the cron secret, which counts as staff), then `media_allowed`; not enabled →
  `429 { error: 'not_in_plan' }`; `redo` from a non-staff caller → `403`. Order of checks:
  1. a lease that ran out with no answer → mark failed, give the starter's use back;
  2. a run is in progress → `202 { pending }`;
  3. nothing to do and no `redo` → `200 { ok }` when rows exist, else `404 { error: 'no_media' }`;
  4. `poll` → `409 { error: 'failed' }` when the last run failed, else `200 { ok }` — a poll never
     starts a run;
  5. a recent failure (`retry_after`; staff skip this) → `409 { error: 'failed' }`;
  6. budget (readers only) → `429 { error: 'budget' }`; two runs in progress (everyone) →
     `429 { error: 'busy' }`;
  7. daily use (`consume_feature`) → `429 { error: 'quota_exceeded', used, limit }`;
  8. lease (`media_claim`; not given → use back, `202`); count again including this run (over →
     release, use back, `429`); start the job in the background (`EdgeRuntime.waitUntil`);
     `202 { pending, started }`.
  The browser asks again every 4 seconds with `poll: true` (at most 50 times), then reads
  `media_translation` again.
- **The job (`translateMedia`), never throws, always ends with `media_done`:**
  1. items to read (not read yet, or `off` while speech is on; all of them on `redo`), first 8;
  2. for the first 2 videos when speech is on: find or fetch the file (`videoForThumb`; "too
     big" / "unavailable" become the item's speech state) → `/api/transcribe` (100-second limit);
  3. one Claude call (75-second limit; one retry after 5 seconds on a transient error): system
     prompt + the event's headline and summary as JSON + per item its number, its picture as an
     image address (`{ type: 'image', source: { type: 'url' } }`) and, for a video, the speech
     text and Gemini's on-screen texts as JSON; forced tool `media_reading`. Skipped when there
     is nothing to show Claude (a video with no still and no speech);
  4. clean, apply the learned-terms fixes to the Hebrew, upsert the rows;
  5. `media_done` with the cost. Whole job limit 180 seconds; lease 4 minutes.
  Any failure (route busy / not reachable / refused, Claude failure, nothing usable) → nothing
  saved, `refund_feature`, `fail_reason 'failed'`, retry after 10 minutes.
- **Usage log:** not inside `runAsReader` (it must not use "Ask the map" credits). Claude:
  purpose `media_translate` (reader) or `media_translate_staff` (staff, "Run again", cron-secret
  checks). Gemini: the same purpose with model `free:gemini:<model>` and its token counts → cost 0.

## Cost (prices from `_shared/usage.ts`: Sonnet 5.5 $2 / $10 per million tokens; Gemini free tier $0)
A picture costs about 1,600 input tokens; the prompt and tool about 900.
- **One picture:** ≈ 2,700 in ($0.005) + ≈ 500 out ($0.005) → **about $0.01**.
- **Four pictures:** ≈ 7,500 in ($0.015) + ≈ 1,500 out ($0.015) → **about $0.03**.
- **A one-minute video with speech:** Gemini $0; Claude ≈ 3,000 in ($0.006) + ≈ 900 out ($0.009)
  → **about $0.015–0.02**.
- **Worst case** (8 pictures, two long videos): ≈ 20,000 in + 6,000 out → **about $0.10**.
- `$3` a day ≈ 100–200 ordinary runs for readers. With Haiku 5.5 the Claude part would be about
  twenty times cheaper; the go-live comparison decides (ruling 4).
- Gemini free tier has its own daily and per-minute limits; when they are hit, video runs fail
  with "try again later" (use given back) and picture-only events keep working. The owner can
  turn speech off (`media_audio_enabled`) and videos then get their still read by Claude only.
- The route asks Vercel for up to 120 seconds; if the site's Vercel plan allows only 60, long
  videos may end in "try again later" (use given back). Checked at go-live.
- Measured on the first real runs and reported; the $0.10 reserve is adjusted if needed.

## Privacy and safety
- **Describe, do not identify.** The prompt forbids naming a person from their face or body. A
  name is given only when it is written in the picture / on screen, spoken in the video, or
  stated in the event's own text — and then as "according to the caption / the report". No guesses
  about a private person's identity, religion, health or home. No guessed locations.
- **Uncertain reading is said as uncertain:** unreadable parts are written `[…]`; a marking's
  meaning is given only when sure; nothing is invented to fill a gap.
- **Everything the models read is data:** text inside pictures, the speech, the event text. The
  prompts say instructions inside them are ignored; answers are used only through the tool / the
  JSON answer and only after cleaning; the panel renders plain text.
- **Google (Gemini free tier):** on the free tier Google may use what is sent to improve its
  products. What is sent is the video file only — a public post that the site already republishes
  — with no reader name, id, IP or question. Nothing is sent to Google for pictures. If the owner
  later wants "no training", the fix is a paid-tier key (a config change, cents per day).
- **Anthropic:** receives the pictures' public addresses, the speech text and the event's
  headline and summary. No reader data.
- **The route cannot be used as an open service:** secret header, and only addresses inside our
  own `event-media` bucket.
- **Graphic content** is described in neutral words; safety filters are off on the Gemini call so
  war footage is not refused, and a refusal anyway becomes "could not be read".
- **The panel always carries the line** "Made by AI — may contain mistakes. People are described,
  not identified."

## Client
- `src/lib/mediaReading.ts` (new, pure, unit-tested; relative imports only): types, the safe
  mapping of the RPC answer, which translation a reader sees, the button's state.
- `src/services/mediaTranslateService.ts` (new): `fetchMediaTranslation`, `runMediaTranslation`
  (polls), cached per event for the session.
- `src/components/feed/MediaTranslate.tsx` (new): the hook `useMediaTranslate(event, expandOpen)`
  that returns the button and the panel.
- `EventText.tsx`: three optional props — `onExpandedChange`, `expandButtons` (drawn in the
  button row while the expansion is open) and `expandPanel` (drawn under the expansion). Cards
  pass nothing and do not change.
- `EventDetailsDialog.tsx`: uses the hook and passes the two pieces.
- `src/lib/plans.ts`: `'media_translate'` in `FeatureKey`. `PackagesPage.tsx`: one row.

## Copy (English / Hebrew; keys in `src/i18n/en.ts` and `he.ts`)
| Key | English | Hebrew |
|---|---|---|
| `mt.button` | Translate image/video | תרגם תמונה/סרטון |
| `mt.show` | Show media translation | הצג תרגום מדיה |
| `mt.hide` | Hide | הסתר |
| `mt.more` | Translate the new media ({n}) | תרגם את המדיה החדשה ({n}) |
| `mt.title` | Media translation | תרגום המדיה |
| `mt.working` | Reading the media… up to two minutes | קורא את המדיה… עד שתי דקות |
| `mt.image` | Picture {n} | תמונה {n} |
| `mt.video` | Video {n} | סרטון {n} |
| `mt.shows` | What it shows | מה רואים |
| `mt.texts` | Text in the picture | טקסט בתמונה |
| `mt.textsVideo` | Text on screen | טקסט על המסך |
| `mt.noTexts` | No readable text to translate. | לא נמצא טקסט קריא לתרגום. |
| `mt.said` | What is said | מה נאמר |
| `mt.summary` | Summary | תקציר |
| `mt.full` | Full translation | התרגום המלא |
| `mt.original` | Original ({lang}) | המקור ({lang}) |
| `mt.cut` | The recording is long — only its beginning is translated. | ההקלטה ארוכה — תורגמה רק תחילתה. |
| `mt.speech.none` | No speech in this video. | אין דיבור בסרטון. |
| `mt.speech.unreadable` | The speech in this video could not be read. | לא ניתן היה לפענח את הדיבור בסרטון. |
| `mt.speech.too_big` | The video is too large for speech translation. | הסרטון גדול מדי לתרגום הדיבור. |
| `mt.speech.too_long` | The video is too long for speech translation (over 10 minutes). | הסרטון ארוך מדי לתרגום הדיבור (מעל 10 דקות). |
| `mt.speech.unavailable` | The video file could not be fetched, so its speech was not translated. | לא ניתן היה להביא את קובץ הסרטון, ולכן הדיבור לא תורגם. |
| `mt.speech.off` | Speech translation is not available right now. | תרגום דיבור אינו זמין כרגע. |
| `mt.speech.limit` | Speech was translated for the first two videos only. | הדיבור תורגם רק בשני הסרטונים הראשונים. |
| `mt.quota` | You have used today's {limit} media translations. Saved translations stay open. | ניצלת את {limit} תרגומי המדיה של היום. תרגומים שמורים נשארים פתוחים. |
| `mt.budget` | Today's budget for media translations is used up. Saved translations stay open. | התקציב היומי לתרגומי מדיה נוצל. תרגומים שמורים נשארים פתוחים. |
| `mt.busy` | Two media translations are running right now — try again in a minute. | שני תרגומי מדיה רצים כרגע — נסו שוב בעוד דקה. |
| `mt.failed` | The media could not be translated. Try again later. | לא ניתן היה לתרגם את המדיה. נסו שוב מאוחר יותר. |
| `mt.retry` | Try again | נסו שוב |
| `mt.noMedia` | This event has no picture or video to translate. | לאירוע הזה אין תמונה או סרטון לתרגום. |
| `mt.aiLine` | Made by AI — may contain mistakes. People are described, not identified. | נוצר בידי AI — ייתכנו טעויות. אנשים מתוארים, לא מזוהים. |
| `mt.redo` | Run again | הרץ שוב |
| `mt.redoConfirm` | Run again with AI — the saved translation will be replaced | הרצה חוזרת עם AI — התרגום השמור יוחלף |
| `mt.lang.ar` / `fa` / `he` / `en` / `ru` / `tr` / `ku` / `ur` / `fr` | Arabic / Persian / Hebrew / English / Russian / Turkish / Kurdish / Urdu / French | ערבית / פרסית / עברית / אנגלית / רוסית / טורקית / כורדית / אורדו / צרפתית |
| `pk.c.mediaTranslate` | Image / video translation | תרגום תמונה / סרטון |
"{n}/{limit} left today" reuses the existing key `gate.left`.

## Errors and edge cases
- Two readers click the same event → one run, one daily use; the second waits.
- The reader closes the window or loses the connection → the run finishes anyway.
- A picture is removed later as a repeat of another → its saved row is no longer shown.
- A stored video is removed by the storage clean-up → the saved speech stays (it is keyed to the
  still, which stays).
- The plan ends → the button shows the lock; saved results are not sent.
- Claude leaves an item out of its answer → that item is saved with an empty description and no
  text (so it is not paid for again); every item left out → failure.
- An event with more than 8 items → the first 8 now; the rest show as "new media".
- An event opened from the archive page → the same button and rules.

## Out of scope
- Frames taken from inside the video for Claude; speech of videos that cannot be stored (over 50 MB).
- Who is speaking (speaker labels), time-coded subtitles, a subtitled video file.
- Documents (`document` media), feed cards, the map popup, push, sharing the result.
- Hand editing of a result; languages other than Hebrew and English.
- Changes to Expand, to "Ask the map" credits, to the editor's models or to prices.

## Testing
- Unit, `node:test` (`node --experimental-strip-types --test`):
  `tests/media/speechInput.test.ts` (address check, mp4 length, cleaning Gemini's answer),
  `tests/media/mediaInput.test.ts` (items, what a run reads, speech decision, prompt and user
  content are data-only, cleaning, the decision order), `tests/media/mediaReading.test.ts`
  (mapping, which translation shows, button state), `tests/media/wiring.test.ts` (the action is
  wired, not inside `runAsReader`, purposes present, no OpenAI anywhere).
- Database (`supabase/tests/media_translation.sql`, rolled-back dry run): closed tables; the item
  rule; the lease given once; `media_translation` null for Free and filled for Pro; `todo`
  counting (new picture, `off` with the switch on and off); spend counts readers only; plan rows.
- End-to-end, Playwright with a faked server (`tests/e2e/media-translation.mock.cjs <he|en>
  <desktop|phone> <pro|free|guest|staff>`): see the plan.
- After deploy, with the owner's yes each time: one real picture event, one real video event, the
  five-event model comparison; costs reported.
- `npm run typecheck` (no new errors against `main`) and `npx vite build` must pass.

## Rollout (each numbered step only after the owner approves it)
1. Branch work, local tests, the faked-server Playwright run.
2. Apply migration `126`. Nothing reads it yet.
3. Migration `127` — the owner runs it himself in the Supabase SQL editor (it contains `on delete`).
4. Deploy `event-agent` (new action). Speech is still off.
5. First real run on a picture event the owner names (cron secret, logged as staff); cost and
   text reported. Then the five-event Sonnet / Haiku comparison.
6. Owner approves the preview build; merge to `main` (this also puts `/api/transcribe` on the
   live site).
7. Check the route answers (a too-long test address, no AI call), then set
   `media_audio_enabled` to `true`; first real video run; cost, seconds and text reported.
8. After a week: runs per day, spend against the $3, Gemini refusals, and the owner's view of
   the quality.
Roll-back: `media_translate` to `enabled = false` for every plan (button locked for readers), or
`media_daily_budget_usd` to `0`, or `media_audio_enabled` to `false` (no Google calls).

## Review Focus
1. **One paid run, one use.** Double click, two readers, a browser that keeps polling after a
   failure, a worker that died mid-run → never a second paid run for the same media, never two
   uses, and the use comes back on every failure and refusal.
2. **Text that tries to steer the model** — a banner reading "ignore your instructions", speech
   that dictates output, `<script>` in a translation → travels as data, shows as plain text.
3. **The media set moves under the result** — a late picture, a still removed as a repeat, a video
   cleaned from storage, the speech switch turned on later → saved rows stay, `todo` is right,
   SQL and TypeScript agree on what an item is, nothing is paid twice.
4. **Speech edge cases** — route not live, wrong secret, Gemini rate limit, 50 MB + 1 byte, an
   11-minute video, a file whose length cannot be read, silence, a refusal, an address outside
   our bucket → the stated state each time; never a loop that spends a use per click.
5. **Model output shape** — an item missing, an unknown item number, 40 text pairs, a 20,000-
   character translation, language given as "Arabic" instead of `ar`, text already in the
   reader's language, right-to-left text inside a left-to-right page → cleaned and readable.
