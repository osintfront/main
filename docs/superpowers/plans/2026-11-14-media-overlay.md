# Translation on the picture, subtitles on the video: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a saved media reading where the reader is looking — translated text boxes drawn over the picture (Original / Translated switch) and translated subtitles on the playing video — in the site language, without changing any media file; and make a failing speech route say why.

**Architecture:** No new service and no new paid call. Claude's existing `media_reading` call also returns an approximate `box` per text; Gemini's existing transcribe call returns timed `segments`, which Claude translates line by line in the same call. Both are optional additions to the JSON already saved in `media_readings`. The browser draws boxes as page elements above the `<img>` (one plain-DOM renderer shared by the card picture and the full-screen viewer) and builds a WebVTT `<track>` from the saved lines. The speech route gains a failure `detail`, the job logs it and saves it in `media_jobs.speech_note` for staff.

**Tech Stack:** as the media-translation plan — React 19 + TypeScript + Tailwind 4, Supabase (Postgres, Edge Functions on Deno), Vercel route `api/transcribe.ts` (Node, Gemini), `claude-sonnet-5-5`, `node:test` with `node --experimental-strip-types --test`, Playwright against a local build with a faked Supabase.

**Spec:** `docs/superpowers/specs/2026-11-14-media-overlay-design.md` — read it first; its rulings, the "Saved data" shapes, the cleaning rules for timed lines, the copy table and the diagnosis are used verbatim. It extends `docs/superpowers/specs/2026-11-13-media-translation-design.md`, which stays in force (read its states table and "Privacy and safety").

## Global Constraints

- Branch `feat/media-overlay` (from `main` 4531e75). Nothing reaches `main`, the live database, a live function or Vercel without the owner's yes — Task 8 has a separate **STOP** before each, and before every read of live logs or data.
- **The media file is never changed.** No `<canvas>`, no re-encoding, no upload, no new storage object. The overlay and the subtitles are page elements; the download link and the `<img>` / `<video>` `src` stay the original address.
- **No new paid action:** no new plan key, no new `consume_feature` call, no new model call. `pickTodo` and the SQL `todo` count do not look at boxes or segments. Old readings gain them only through staff "Run again".
- Saved shapes (exact): pair `box?: [ymin, xmin, ymax, xmax]`, whole numbers, `0 ≤ min < max ≤ 1000`, each side ≥ 8; speech `segments?: [{ start, end, orig, he, en }]`, ≤ 120, `orig` ≤ 300, `he` / `en` ≤ 400. **A key that has no value is left out** (never `box: null` or `segments: []` in a saved row), so every existing `deepEqual` test keeps passing.
- Limits (exact): `MEDIA_LIMITS.maxTokens` 6000 → 8000; lines kept until 6,000 characters of speech or 120 lines; a line is 0.2–12 s, a missing end = start + 4 s; route wait handed over as `budget_ms`, the route's own deadline `min(90 s, max(10 s, budget_ms))`; note ≤ 300 characters, route `detail` ≤ 160.
- Fonts: 22 px down to 9 px; under 9 px the box is a frame without words.
- Everything a model wrote is data: boxes and lines are cleaned by the pure modules before saving and again when mapped in the browser; drawn with `textContent` / React text nodes only; `&`, `<` and `-->` are escaped in the subtitle file. The route's `detail`, the log lines and `speech_note` never contain speech text or anything about a reader.
- No OpenAI, no new API key, no Gemini key in the edge function, pictures are not sent to Google (unchanged rules of the first plan).
- No Hebrew string literals in components or `src/lib` files that draw text: all copy through `src/i18n/en.ts` and `he.ts` with the keys of the spec's copy table; Hebrew / Arabic character ranges in code are written as `\u` escapes. Code, comments and commit messages in English.
- **SQL that contains the words `drop` or `delete` lives in its own migration file.** Migration 128 and the SQL test must contain neither word anywhere, comments included.
- Unit tests: `node:test`, run with the exact path in each task. Modules that tests load have no `@/` alias and no runtime imports: `api/_lib/speechInput.ts`, `_shared/mediaInput.ts` (no imports at all); `src/lib/mediaReading.ts`, `src/lib/mediaOverlay.ts`, `src/lib/readingStore.ts` (`import type` only).
- "Clean" type check = `npm run typecheck` shows no errors beyond those on `main`; `npx vite build` succeeds. Deno check as in the first plan (copy `supabase/functions` to a scratch folder, `deno.json` `{"nodeModulesDir":"none"}`, `deno check event-agent/index.ts`).
- Browser QA harness: copy the top of `tests/e2e/media-translation.mock.cjs` (env `PLAYWRIGHT_PATH`, `CHROME_PATH`, `SETS_QA_DIST`, `SETS_QA_SHOTS`; random port; faked Supabase). No network to the live site.
- SQL tests are one `do $$ … $$` block ending in `raise exception 'MEDIA_TRANSLATION_ALL_OK'` (a dry run on live, Task 8 only).
- Commits end with the attribution lines the session gives.

## Review Focus

1. The picture is cropped (`object-cover`, `max-h-60`), tall, shown two-up, on a 390 px phone, or the window is resized → every box stays over its text and inside the picture. Tests: Task 5 `imageRect` / `boxPx`; Task 6 e2e checks 2 and 10.
2. A bad box from the model — out of range, zero area, 0–1 scale, strings, five numbers, a box on a text that came from the video → that box is not drawn, the text pair is kept, nothing throws. Tests: Task 4 `cleanBox`, `cleanReading`; Task 5 `mapTranslation`.
3. Hostile or awkward text — `<script>` in a translation, `-->` or an empty line in a subtitle, Hebrew inside an English page → shown as plain text in its own direction; the subtitle file stays valid. Tests: Task 5 `toVtt`, `textDir`; Task 6 e2e checks 7 and 8.
4. Bad timings from Gemini — out of order, overlapping, an end before its start, `MM:SS` strings, a start past the video's end, 500 lines, no lines at all → cleaned or dropped; the speech text still translates without subtitles. Tests: Task 3 `timeSec`, `cleanSegments`, `cleanSpeech`; Task 4 the fallback case.
5. An old reading, a reader without the feature, a failing route → no switch, no track, no paid run; staff see the reason, readers never do. Tests: Task 1 `routeNote`; Task 2 the SQL cases and `mapTranslation`; Task 4 `pickTodo`; Task 6 e2e checks 5 and 9; Task 7 e2e checks 12 and 13.

---

### Task 1: Speech route diagnosis — every failure gets a reason

What is known and what is not is in the spec ("Speech route diagnosis"): `off` = the route call failed (A), was skipped (B), or speech was judged off (C); the reason was never recorded, so causes 1–4 there are **likely, not confirmed**. This task records the reason; it does not change what is saved (a failed route still leaves `off` and the pictures are still read). Confirming the cause on live is Task 8.

**Files:**
- Modify: `api/_lib/speechInput.ts`, `api/transcribe.ts`, `supabase/functions/_shared/mediaInput.ts`, `supabase/functions/_shared/media.ts`
- Test: `tests/media/speechRoute.test.ts` (new)

**Interfaces:**
- Produces, in `api/_lib/speechInput.ts`:
  ```ts
  export function routeDeadlineMs(budget: unknown): number;
  export type BusyStep = 'upload_start' | 'upload' | 'file_wait' | 'generate' | 'deadline';
  export function busyDetail(step: BusyStep, status: number | null, body: unknown): string;
  ```
  - `routeDeadlineMs`: a finite number → clamped to 10,000…90,000; anything else → 90,000.
  - `busyDetail`: `step`, then the status (`null` → the words `no answer`), then, when `body` is `{ error: { status, message } }` (Gemini's error shape), the `status` string and the first 120 characters of `message`; joined by single spaces; at most 160 characters.
- Produces, in `_shared/mediaInput.ts`:
  ```ts
  export function routeNote(r: { status: number; body: unknown; error: 'timeout' | 'network' | null; waitedMs: number }): string | null;
  export function speechNotes(parts: (string | null)[]): string | null;   // distinct, joined ' | ', ≤ 300; null when empty
  ```
  - `routeNote`: `error 'timeout'` → `` `route timeout after ${waitedMs} ms` ``; `'network'` → `'route network error'`; a `200` that `cleanRoute` accepts → `null`; any other `200` → `'route 200 unknown answer'`; else `` `route ${status} ${body.error ?? ''} ${body.detail ?? ''}` `` (strings only), spaces collapsed, ≤ 200.
- Produces, in `_shared/media.ts`: `speechFor(videoUrl: string, purpose: string, ms?: number): Promise<{ out: RouteSpeech | 'failed'; note: string | null }>`; the request body becomes `{ url, budget_ms: ms - 5000 }`.
- Route behaviour: `class Busy` carries `detail: string`; every `throw new Busy()` names its step; the deadline is `Date.now() + routeDeadlineMs(b?.budget_ms)`; `502 { error: 'busy', detail }`; one `console.warn('transcribe busy', detail, bytes)` on failure and one `console.log('transcribe', state, bytes, seconds, elapsedMs)` on an answer.

- [ ] **Step 1: Write the failing tests** (header `// Run: node --experimental-strip-types --test tests/media/speechRoute.test.ts`):
  - `routeDeadlineMs(undefined) === 90000`, `(65000) → 65000`, `(5) → 10000`, `(500000) → 90000`, `('x') → 90000`, `(NaN) → 90000`.
  - `busyDetail('generate', 400, { error: { status: 'INVALID_ARGUMENT', message: 'Request payload size exceeds the limit' } }) === 'generate 400 INVALID_ARGUMENT Request payload size exceeds the limit'`; `busyDetail('generate', 429, null) === 'generate 429'`; `busyDetail('file_wait', null, null) === 'file_wait no answer'`; a 1,000-character message → length ≤ 160.
  - `routeNote({ status: 0, body: null, error: 'timeout', waitedMs: 70000 }) === 'route timeout after 70000 ms'`; `error: 'network'` → `'route network error'`; `{ status: 502, body: { error: 'busy', detail: 'generate 429 RESOURCE_EXHAUSTED' } }` → `'route 502 busy generate 429 RESOURCE_EXHAUSTED'`; `401 { error: 'unauthorized' }` → `'route 401 unauthorized'`; `404` with body `null` → `'route 404'`; `200 { state: 'ok', speech: 'x', lang: 'ar' }` → `null`; `200 { state: 'weird' }` → `'route 200 unknown answer'`; a body whose `detail` is an object → not in the note.
  - `speechNotes([null, 'a', 'a', 'b']) === 'a | b'`; `speechNotes([null]) === null`; 40 long parts → length ≤ 300.
  - The time mismatch, pinned: `speechBudgetMs(now + MEDIA_LIMITS.jobMs, now + 30_000) === 70_000` (a 30-second fetch leaves the job a 70-second wait) and `routeDeadlineMs(70_000 - 5000) === 65_000` (the route now stops inside it); `routeOutcome('failed').state === 'off'` (unchanged).
  - Wiring (files read as text): `media.ts` contains `budget_ms`, `routeNote(`, `speechNotes(` and `"media speech"`; `api/transcribe.ts` contains `routeDeadlineMs(`, `busyDetail(` and `detail`; neither file's log calls take the speech text (`/console\.(log|warn)\([^)]*speech[^_]/` does not match `api/transcribe.ts`).
- [ ] **Step 2: Run** → FAIL (missing exports).
- [ ] **Step 3: Implement** the four pure functions; the route changes above; in `media.ts`: `speechFor` as above (a caught error whose `name` is `TimeoutError` → `'timeout'`, else `'network'`), and in `translateMedia` a `notes: (string | null)[]` list — pushed once when speech is off and the run has a video (`speechConfigured() ? 'speech switch is off' : 'speech route not configured'`), `'skipped: no time left for the route'` when `speechBudgetMs` is 0, `` `video fetch: ${plan}` `` when the on-demand branch does not end in `route`, and each `speechFor` note; every non-null note is logged as `console.warn("media speech", job.eventId, item.id, note)`. The list is used in Task 2.
- [ ] **Step 4: Run** this test and `tests/media/reviewFixes.test.ts`, `tests/media/wiring.test.ts`, `tests/media/speechInput.test.ts` → PASS; type check and Deno check clean.
- [ ] **Step 5: Commit** `fix(media): the speech route says why it failed; the job logs it and hands over its time budget`.

### Task 2: Staff see the last speech reason

**Files:**
- Create: `supabase/migrations/20261114000128_media_speech_note.sql`
- Modify: `supabase/functions/_shared/media.ts`, `supabase/tests/media_translation.sql`, `src/lib/mediaReading.ts`, `src/components/feed/MediaTranslate.tsx`, `src/i18n/en.ts`, `src/i18n/he.ts`
- Test: `tests/media/mediaReading.test.ts`

**Interfaces:**
- Consumes: `speechNotes` and the `notes` list of Task 1.
- Produces: column `media_jobs.speech_note text`; `media_translation(p_event)` returns the extra key `speech_note` — the column for staff, `null` for everyone else; `MediaTranslation.speechNote: string | null` (a string, trimmed, ≤ 300, else `null`); in the panel, for staff only, `<p data-mt-staff-note>` with `t('mt.staffNote', { note })` beside "Run again".

- [ ] **Step 1: Write the failing tests.** `mediaReading.test.ts`: `mapTranslation({ items: [], speech_note: ' route 502 busy ' }).speechNote === 'route 502 busy'`; missing, `5`, `''` → `null`; 1,000 characters → 300. SQL test: after `update public.media_jobs set speech_note = 'route 502 busy'` for the test event, the staff user's `media_translation` has `speech_note = 'route 502 busy'` and the Pro reader's has a JSON `null`.
- [ ] **Step 2: Run** the unit test → FAIL.
- [ ] **Step 3: Write migration 128:** `alter table public.media_jobs add column if not exists speech_note text;` and `create or replace function public.media_translation` — the body of migration 126 with `speech_note` added to the `v_job` select and `'speech_note', case when v_staff then v_job.speech_note end` added to the answer. Neither forbidden word anywhere.
- [ ] **Step 4: Save the note in the job:** in `translateMedia`, before `media_done`, when the run had at least one video item: `db.from("media_jobs").update({ speech_note: speechNotes(notes) }).eq("event_id", job.eventId).eq("busy_token", job.token)`; its error is ignored (the job must work before migration 128 is applied). Extend the wiring check in `tests/media/speechRoute.test.ts`: `media.ts` contains `speech_note`.
- [ ] **Step 5: Map and show it** (`mediaReading.ts`, `MediaTranslate.tsx`, the key `mt.staffNote` in both dictionaries).
- [ ] **Step 6: Run** `tests/media/*.test.ts` and `tests/i18n/no-hebrew-literals.test.ts` → PASS; type check clean. The SQL test runs in Task 8.
- [ ] **Step 7: Commit** `feat(media): staff see why a video's speech was not read`.

### Task 3: Timed lines from the speech route

**Files:**
- Modify: `api/_lib/speechInput.ts`, `api/transcribe.ts`
- Test: `tests/media/speechInput.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // SPEECH_LIMITS gains: segments: 120, segmentText: 300, cueMaxSec: 12, cueDefaultSec: 4, cueMinSec: 0.2
  export interface SpeechSegment { start: number; end: number; text: string }
  export function timeSec(v: unknown): number | null;
  export function cleanSegments(raw: unknown, o: { maxChars: number; durationSec: number | null }): { segments: SpeechSegment[]; cut: boolean };
  export interface SpeechAnswer { state: 'ok' | 'none'; lang: string; speech: string; segments: SpeechSegment[]; on_screen: string[]; cut: boolean }
  export function cleanSpeech(raw: unknown, durationSec?: number | null): SpeechAnswer | null;
  ```
  - `timeSec`: a finite number ≥ 0 → itself; a string `SS(.s)`, `MM:SS(.s)` or `HH:MM:SS(.s)` → seconds; anything else → `null`.
  - `cleanSegments`: the spec's "Timed lines — cleaning rules", in that order; then at most 120 lines and stop before the summed text length passes `maxChars` — `cut: true` when anything was left out for either limit. Numbers rounded to 2 decimals.
  - `cleanSpeech`: `segments = cleanSegments(raw.segments, { maxChars: 6000, durationSec })`. With at least one line: `speech` = the lines' texts joined by `\n`, `cut` from the lines. With none: today's behaviour on `raw.speech`, `segments: []`. The four-letters rule for `state` is unchanged.
  - `SPEECH_PROMPT`: keeps every sentence it has except the two about `"speech"`; the answer shape becomes `{ "segments": [{ "start": number, "end": number, "text": string }], "language": string, "on_screen": string[] }`; it says each segment is one sentence or phrase of at most about 12 words exactly as spoken, `start` and `end` are seconds from the beginning of the video, and no speech → an empty `segments` list. It must contain `do not translate`, `exactly`, `data`, `on_screen`, `segments`, `seconds`.
- The route calls `cleanSpeech(text, seconds)`; its `200` answer therefore carries `segments`.

- [ ] **Step 1: Add the failing tests.**
  - `timeSec(12.5) === 12.5`; `'01:05'` → `65`; `'1:05.5'` → `65.5`; `'01:01:05'` → `3665`; `-1`, `'abc'`, `NaN`, `null` → `null`.
  - `cleanSegments([{ start: 5, end: 7, text: 'ب ب' }, { start: 0, end: 9, text: 'ا ا' }, { start: '00:07', text: 'ج ج' }], { maxChars: 6000, durationSec: null })` → `{ segments: [{ start: 0, end: 5, text: 'ا ا' }, { start: 5, end: 7, text: 'ب ب' }, { start: 7, end: 11, text: 'ج ج' }], cut: false }`.
  - `{ start: 0, end: 40 }` → `end 12`; `durationSec: 10` with a line starting at 11 → dropped; text `'...'` → dropped; two lines both starting at 3 → the first is dropped (under 0.2 s after the clamp); 130 lines → 120 and `cut true`; three 5-character lines with `maxChars: 12` → 2 lines, `cut true`; `cleanSegments('x', …)` and `(null, …)` → `{ segments: [], cut: false }`; a 500-character text → 300.
  - `cleanSpeech('{"segments":[{"start":0,"end":2,"text":"مرحبا بكم"},{"start":2,"end":4,"text":"في الأخبار"}],"language":"ar","on_screen":[]}')` → `state 'ok'`, `speech 'مرحبا بكم\nفي الأخبار'`, two segments. Both `segments` and `speech` given → the segments win. Only `speech` (the old shape) → `segments: []` and the speech kept. Update the existing `deepEqual` expectations with `segments: []`.
  - `SPEECH_PROMPT` contains the six phrases.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/media/speechInput.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS, with `tests/media/wiring.test.ts`; type check clean.
- [ ] **Step 5: Commit** `feat(media): the speech route returns timed lines`.

### Task 4: Edge rules — boxes and translated lines

**Files:**
- Modify: `supabase/functions/_shared/mediaInput.ts`, `supabase/functions/_shared/media.ts`
- Test: `tests/media/mediaInput.test.ts`

**Interfaces:**
- Consumes: the route answer of Task 3 (`segments: { start, end, text }[]`).
- Produces:
  ```ts
  // MEDIA_LIMITS: maxTokens 8000; gains segments: 120, segmentText: 300, boxMin: 8
  export type Box = [number, number, number, number];             // ymin, xmin, ymax, xmax — 0..1000
  export function cleanBox(v: unknown): Box | null;
  export interface TextPair { /* as today */ box?: Box }
  export interface RouteSegment { start: number; end: number; text: string }
  export interface RouteSpeech { /* as today */ segments: RouteSegment[] }
  export interface SavedSegment { start: number; end: number; orig: string; he: string; en: string }
  export interface SavedSpeech { /* as today */ segments?: SavedSegment[] }
  ```
  - `cleanBox`: an array of exactly four finite numbers. When all four are ≤ 1 and at least one is not whole (a 0–1 answer) → each × 1000. Rounded, clamped to 0…1000. `null` unless `ymax − ymin ≥ 8` and `xmax − xmin ≥ 8`.
  - `cleanPairs`: `box` set only for a pair with `from: 'frame'` and a non-null `cleanBox`; otherwise the key is absent.
  - `cleanRoute`: for state `ok`, `segments` = the entries with finite `start ≥ 0`, `end > start` and a non-empty trimmed `text` (≤ 300), first 120, order kept; otherwise `[]`. `routeOutcome('failed')` and `noSpeech` in `media.ts` carry `segments: []`.
  - `mediaUserContent`: each item's JSON gains `segments: sp.segments.map((s, k) => ({ i: k + 1, text: s.text }))` (`[]` when none); when it is not empty, `speech` is `null` (the speech is not sent twice).
  - `MEDIA_TOOL`: a text gains `box: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4 }`; `speech` gains `segments: array of { i: integer, he, en }` with `i` required.
  - `mediaSystemPrompt()` gains two lines and must contain `[ymin, xmin, ymax, xmax]`, `0 to 1000` and `segments`: (1) for each text read from the picture or still, `box` = its position as `[ymin, xmin, ymax, xmax]`, whole numbers from 0 to 1000 measured on the full image with (0, 0) at the top left, tight around that text only; leave `box` out when unsure and for texts taken from the provided on-screen list; (2) when the speech is given as numbered segments, translate each on its own and return `speech.segments` with the same numbers (`i`), Hebrew (`he`) and English (`en`); do not also fill `speech.he` / `speech.en`; still give both summaries.
  - `cleanSpeechPart` with route segments: saved `segments` = every route segment as `{ start, end, orig: text, he, en }`, the translations taken by `i` (≤ 400 each, `''` when missing); `he` / `en` of the speech = the non-empty line translations joined by `\n`, cut to 6,000 (`cut` as today). When no line has any translation → the old path on `raw.he` / `raw.en` with the `segments` key absent; when that is empty too → `unreadable` as today.
- `media.ts`: when saving, each saved segment's `he` goes through `fixTerms`.

- [ ] **Step 1: Add the failing tests.**
  - `cleanBox([100, 200, 300, 600])` → the same; `[0.1, 0.2, 0.3, 0.6]` → `[100, 200, 300, 600]`; `[-5, 0, 1200, 500]` → `[0, 0, 1000, 500]`; `[100, 200, 104, 600]` (4 high) → `null`; `[300, 200, 100, 600]` → `null`; `['1', 2, 3, 4]`, `[1, 2, 3]`, `[1, 2, 3, 4, 5]`, `null`, `'x'` → `null`.
  - `cleanReading`: a picture whose texts are `{ orig: 'ساخت ایران', lang: 'fa', he: 'תוצרת איראן', en: 'Made in Iran', box: [100, 100, 300, 600] }` and `{ orig: 'عاجل', he: 'דחוף', en: 'Urgent', box: [5, 5, 5, 5] }` → the first pair has the box, the second has no `box` key (`'box' in pair === false`). A video item whose on-screen list holds `'عاجل'` and whose pair for it carries a box → no `box` key.
  - `cleanRoute(200, { state: 'ok', speech: 'a\nb', lang: 'ar', segments: [{ start: 0, end: 2, text: 'a' }, { start: 2, end: 1, text: 'b' }, { start: 3, end: 4, text: ' ' }] })` → one segment; a state `none` answer → `segments: []`.
  - `mediaUserContent` for a video with two route segments: the item text parses to `segments: [{ i: 1, text: … }, { i: 2, text: … }]` and `speech: null`; with none → `speech` the text, `segments: []`.
  - `cleanReading` for that video with the answer `speech: { has_speech: true, segments: [{ i: 1, he: 'שלום', en: 'Hello' }, { i: 2, en: 'News' }], summary_he: 'ס', summary_en: 'S' }` → saved `segments` `[{ start, end, orig, he: 'שלום', en: 'Hello' }, { …, he: '', en: 'News' }]`, `he: 'שלום'`, `en: 'Hello\nNews'`. With `speech: { has_speech: true, he: 'הכול', en: 'All' }` (lines ignored by the model) → `he 'הכול'`, no `segments` key. With neither → state `unreadable`.
  - `pickTodo`: a read picture and a read video whose speech is `ok` are not in the result whatever their saved texts hold (the function still takes only `media_id` and `speech_state`).
  - `MEDIA_LIMITS.maxTokens === 8000`; the prompt contains the three phrases; the existing expectations gain `segments: []` on route speeches only.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/media/mediaInput.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** every `tests/media/*.test.ts` → PASS; Deno check clean.
- [ ] **Step 5: Commit** `feat(media): Claude returns a box per text and translates the speech line by line`.

### Task 5: Browser pure rules and the shared reading store

**Files:**
- Create: `src/lib/mediaOverlay.ts`, `src/lib/readingStore.ts`, `src/hooks/useEventReading.ts`
- Modify: `src/lib/mediaReading.ts`, `src/services/mediaTranslateService.ts`
- Test: `tests/media/mediaOverlay.test.ts` (new), `tests/media/mediaReading.test.ts`

**Interfaces:**
- Produces, in `src/lib/mediaReading.ts`: `export type Box = [number, number, number, number]`; `TextPair.box: Box | null`; `export interface Segment { start: number; end: number; orig: string; he: string; en: string }`; `MediaSpeech.segments: Segment[]`. `mapPair`: `box` kept only when it is four finite numbers in 0…1000 with `ymin < ymax` and `xmin < xmax`. `mapSpeech`: entries with finite `0 ≤ start < end` and string texts, first 120; else `[]`.
- Produces, in `src/lib/mediaOverlay.ts`:
  ```ts
  export interface OverlayBox { box: Box; text: string; orig: string; dir: 'rtl' | 'ltr' }
  export interface Rect { left: number; top: number; width: number; height: number }
  export function textDir(s: string): 'rtl' | 'ltr';
  export function overlayBoxes(item: MediaReadingItem | null, lang: string): OverlayBox[];
  export function imageRect(nat: { w: number; h: number }, el: { w: number; h: number }, fit: 'cover' | 'contain'): Rect;
  export function boxPx(box: Box, r: Rect): Rect;
  export function fitFont(w: number, h: number, chars: number): number | null;
  export function vttTime(sec: number): string;
  export function toVtt(segments: Segment[], lang: string): string | null;
  export function readingFor(reading: MediaTranslation | null, ids: (string | null | undefined)[]): MediaReadingItem | null;
  ```
  - `textDir`: `'rtl'` when the first letter (`\p{L}`) is in `֐-ࣿ` or `יִ-ﻼ`, else `'ltr'`.
  - `overlayBoxes`: `[]` unless `item.kind === 'image'`; one entry per pair that has a `box` and whose `pairView(p, lang).translation` is not null — `text` = that translation, `dir` = `textDir(text)`.
  - `imageRect`: the drawn image inside an element of size `el` — scale `max(el.w / nat.w, el.h / nat.h)` for `cover`, `min(…)` for `contain`, centred (the default `object-position`). Any size ≤ 0 → `{ 0, 0, el.w, el.h }`.
  - `fitFont`: the first `fs` from 22 down to 9 for which `lines = floor((h − 2) / (fs × 1.2)) ≥ 1` and `lines × floor((w − 4) / (fs × 0.55)) ≥ chars`; none → `null`.
  - `vttTime`: `HH:MM:SS.mmm`. `toVtt`: `null` when no line has text in either language; else `'WEBVTT\n\n'` and per line (text = `pick(he, en, lang)`, skipped when empty) `start --> end\ntext\n\n`, where the text has `&` → `&amp;`, `<` → `&lt;`, `-->` → `→` and runs of line breaks collapsed to one.
  - `readingFor`: the item whose `mediaId` is the first id of the list that has one.
- Produces, in `src/lib/readingStore.ts` (module-level, `import type` only): `getReading(eventId): MediaTranslation | null | undefined` (`undefined` = not loaded), `setReading(eventId, m: MediaTranslation | null): void`, `dropReading(eventId): void`, `overlayOn(eventId): boolean` (default `false`), `setOverlayOn(eventId, on: boolean): void`, `subscribeReadings(cb: () => void): () => void` (called after every set / drop / overlay change that changes something).
- `mediaTranslateService.ts`: its private `cache` map is replaced by the store (`cache.has/get/set/delete` → `getReading !== undefined` / `getReading` / `setReading` / `dropReading`); behaviour unchanged.
- Produces, in `src/hooks/useEventReading.ts`: `useEventReading(eventId: string): { reading: MediaTranslation | null; overlay: boolean; setOverlay(on: boolean): void }` through `useSyncExternalStore`. It never fetches.

- [ ] **Step 1: Write the failing tests** (`// Run: node --experimental-strip-types --test tests/media/mediaOverlay.test.ts`):
  - `imageRect({ w: 1000, h: 2000 }, { w: 300, h: 240 }, 'cover')` → `{ left: 0, top: -180, width: 300, height: 600 }`; `imageRect({ w: 1000, h: 500 }, { w: 400, h: 400 }, 'contain')` → `{ left: 0, top: 100, width: 400, height: 200 }`; `nat { w: 0, h: 0 }` → `{ left: 0, top: 0, width: 300, height: 240 }`.
  - `boxPx([100, 200, 300, 600], { left: 0, top: -180, width: 300, height: 600 })` → `{ left: 60, top: -120, width: 120, height: 120 }`.
  - `fitFont(200, 40, 10) === 22`; `fitFont(120, 30, 20) === 11`; `fitFont(60, 14, 30) === null`; `fitFont(0, 0, 5) === null`.
  - `textDir('תוצרת איראן') === 'rtl'`; `'Made in Iran'` → `'ltr'`; `'12 عاجل'` → `'rtl'`; `''` → `'ltr'`.
  - `overlayBoxes`: an image item with a boxed Persian pair, a pair without a box and a boxed pair whose `lang` is `'en'` → for `'en'` one box with `text 'Made in Iran'`, `dir 'ltr'`; for `'he'` two boxes, the first `dir 'rtl'`; a video item → `[]`; `null` → `[]`.
  - `vttTime(61.5) === '00:01:01.500'`; `vttTime(3725.04) === '01:02:05.040'`.
  - `toVtt([{ start: 0, end: 2.5, orig: 'x', he: 'שלום', en: 'Hello' }], 'en') === 'WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello\n\n'`; `'he'` → the Hebrew line; a line `en: 'a --> b\n\n<script>&'` → the cue text is `'a → b\n&lt;script>&amp;'`; a line with `he: ''` and `en: 'Only'` under `'he'` → `Only`; `toVtt([], 'en') === null`.
  - `readingFor(reading, [null, 'm-still', 'm-file'])` → the item `m-still`; no match → `null`.
  - The store: `getReading('e') === undefined`; after `setReading('e', m)` → `m` and the subscriber ran once; `setOverlayOn('e', true)` → `overlayOn('e')` and one more call; setting the same value again → no call; `dropReading('e')` → `undefined`; an unsubscribed callback is not called.
  - `mediaReading.test.ts`: `mapTranslation` keeps `box: [100, 100, 300, 600]`, gives `box: null` for `[1, 2, 3]`, `[300, 0, 100, 5]`, `[0, 0, 2000, 5]`, `'x'` and a missing key (an old reading); maps `segments`, dropping `{ start: 5, end: 2 }` and `{ start: 'a' }`; an old speech → `segments: []`.
- [ ] **Step 2: Run** both files → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** every `tests/media/*.test.ts` → PASS; type check clean.
- [ ] **Step 5: Commit** `feat(media): pure rules for the picture overlay and subtitles; one shared store for saved readings`.

### Task 6: The overlay on the picture and in the full-screen viewer

**Files:**
- Create: `src/lib/mediaOverlayDom.ts`, `tests/e2e/media-overlay.mock.cjs`
- Modify: `src/lib/lightbox.ts`, `src/index.css`, `src/components/feed/EventMedia.tsx`, `src/components/feed/MediaTranslate.tsx`, `src/i18n/en.ts`, `src/i18n/he.ts`, `tests/i18n/no-hebrew-literals.test.ts` (add `EventMedia.tsx`, `src/lib/mediaOverlayDom.ts`, `src/lib/lightbox.ts`, `src/lib/mediaOverlay.ts`)

**Interfaces:**
- Consumes: Task 5 (`overlayBoxes`, `imageRect`, `boxPx`, `fitFont`, `readingFor`, `useEventReading`, `setOverlayOn`).
- Produces:
  ```ts
  // src/lib/mediaOverlayDom.ts — plain DOM, used by React (through a ref) and by the viewer
  export function mountOverlay(host: HTMLElement, img: HTMLImageElement, boxes: OverlayBox[],
    o: { fit: 'cover' | 'contain'; interactive: boolean }): () => void;       // returns "remove"
  // src/lib/lightbox.ts
  export interface LightboxOverlay { boxes: OverlayBox[]; on: boolean; labels: { original: string; translated: string; hint: string }; onChange?: (on: boolean) => void }
  export function openLightbox(src: string, alt?: string, overlay?: LightboxOverlay): void;   // two-argument callers unchanged
  ```
  - `mountOverlay`: appends one layer `div[data-ov-layer]` (absolute, `inset: 0`, `pointer-events: none`, `overflow: hidden`) to `host` (which must be positioned). Layout: the image's rectangle relative to `host` (both `getBoundingClientRect`) → `imageRect({ naturalWidth, naturalHeight }, that size, o.fit)` shifted by that offset → per box `boxPx` → a `div[data-ov-box]` with `dir` from the box, `textContent` only, font size from `fitFont(width, height, text.length)`; `null` → no text and `data-ov-state="frame"`, else `"tr"`. Laid out again on the image's `load`, on a `ResizeObserver` of `host` and the image, and on window `resize`. `interactive`: boxes take pointer events; a click stops propagation and flips that box between translation (`"tr"`) and original (`"orig"`, `dir` from `textDir(orig)`), refitted. The returned function removes the layer and every listener.
  - Styles in `src/index.css` (`.ofm-ov__box`): position absolute, background `rgb(255 255 255 / 0.92)`, colour `#0f172a`, radius 2 px, line height 1.2, centred text, `overflow: hidden`, `overflow-wrap: anywhere`; the frame state: transparent with a 2 px sky outline; the two-button switch `.ofm-ov__switch`.
  - The viewer: with an `overlay` that has boxes, it adds a switch of two buttons `button[data-ov-mode="original"]` / `[data-ov-mode="translated"]` (text from `labels`, `aria-pressed` on the active one) and, in translated mode, the hint line; clicks on the switch and on boxes do not close the viewer; switching mounts / removes the layer (`fit: 'contain'`, `interactive: true`, host = the viewer) and calls `onChange`.
  - `EventMedia`: `const { reading, overlay, setOverlay } = useEventReading(eventId)`. For each picture `boxes = overlayBoxes(readingFor(reading, [m.id]), lang)`. With no boxes the picture renders exactly as today. With boxes: the same two-button switch over the picture's bottom-start corner (outside the enlarge button, like the download link; `aria-label` `mt.ov.switch`); in translated mode `mountOverlay(button, img, boxes, { fit: 'cover', interactive: false })` in an effect; the enlarge click calls `openLightbox(m.url, '', { boxes, on: overlay, labels, onChange: setOverlay })`.
  - `MediaTranslate`: `setOverlayOn(event.id, true)` when a run starts and when the panel is opened with the show button.

- [ ] **Step 1: Write `tests/e2e/media-overlay.mock.cjs <he|en> <desktop|phone> <pro|free|staff>`** from the harness of `media-translation.mock.cjs`. Event `A` has three media rows: picture `m-pic` (800 × 1600, a real small JPEG served by the fake so `naturalWidth` is set), picture `m-old`, and an uploaded video `m-vid` (kind `video`, no still). The saved reading: `m-pic` with the pairs `{ orig: 'ساخت ایران', lang: 'fa', he: 'תוצרת איראן', en: 'Made in Iran <script>window.__x=1</script>', box: [100, 100, 300, 600] }` and one pair without a box; `m-old` with pairs and no box; `m-vid` (kind `video`) with `speech.state 'ok'` and two `segments` (`0–2 s`, `2–4 s`, Hebrew and English); `speech_note: 'route 502 busy generate 429'` for staff only. It prints `PASS` when all hold:
  1. Before Expand: no `[data-ov-mode]` on the page.
  2. After Expand and "Translate image/video": `m-pic` has the switch, "Translated" is pressed, and exactly one `[data-ov-box]` is inside it whose rectangle is within 2 px of `boxPx([100, 100, 300, 600], imageRect(natural, client, 'cover'))` computed in the page from the `<img>`.
  3. The `<img>` `src` and the download link `href` are the original address; the page has no `<canvas>`.
  4. "Original" → no `[data-ov-box]`; "Translated" → one again.
  5. `m-old` has no switch; its pairs are still listed in the panel.
  6. Clicking `m-pic` opens the viewer with the box; clicking the box shows `ساخت ایران` with `data-ov-state="orig"` and the viewer is still open; again → the translation; Escape closes it.
  7. `en`: the box's text contains the literal `<script>`; in every run `window.__x` is undefined.
  8. `he`: the box text is `תוצרת איראן` and its computed direction is `rtl`; `en`: `ltr` — in both page directions.
  9. `free`: no switch after Expand, and no `media_translate` request was made.
  10. `phone` (390 × 844): the box lies inside the picture's rectangle and `document.documentElement.scrollWidth <= window.innerWidth`.
- [ ] **Step 2: Build and run** `he desktop pro` → FAIL at check 2.
- [ ] **Step 3: Implement** `mediaOverlayDom.ts`, the viewer change, the styles, `EventMedia`, the `MediaTranslate` line, the keys `mt.ov.translated`, `mt.ov.original`, `mt.ov.switch`, `mt.ov.hint`.
- [ ] **Step 4: Run** the e2e for `he desktop pro`, `en phone pro`, `en desktop free` → each prints `PASS` (checks 11–13 are added in Task 7); `tests/e2e/media-translation.mock.cjs he desktop pro` still passes; `tests/media/*.test.ts` and `tests/i18n/no-hebrew-literals.test.ts` → PASS; type check clean; `npx vite build` succeeds.
- [ ] **Step 5: Commit** `feat(media): translated text drawn over the picture, with an Original / Translated switch`.

### Task 7: Subtitles on the video

**Files:**
- Create: `src/components/feed/SubtitledVideo.tsx`
- Modify: `src/components/feed/EventMedia.tsx`, `src/services/eventMediaService.ts`, `src/i18n/en.ts`, `src/i18n/he.ts`, `tests/e2e/media-overlay.mock.cjs`, `tests/i18n/no-hebrew-literals.test.ts` (add `SubtitledVideo.tsx`)

**Interfaces:**
- Consumes: `toVtt`, `readingFor`, `useEventReading` (Task 5).
- Produces:
  - `EventMediaView.videos[n].posterId: string | null` — the id of the still that `thumbFor` found (the reading of an uploaded video with a still is saved under the still's id — the rule of `mediaItems`).
  - `SubtitledVideo(props: { src: string; poster?: string; autoPlay?: boolean; preload?: 'none' | 'metadata'; aspect: string; maxHeight: number; segments: Segment[] })`: the `<video>` exactly as `EventMedia` renders it today (`controls`, `playsInline`, the same classes). With `toVtt(segments, lang)` not null: a `<track kind="subtitles" default>` whose `src` is a blob address of the file (type `text/vtt`), `srcLang` = the site language, `label` = `mt.subsLabel.<lang>`, keyed by the address so a language change replaces it; the address is revoked on change and on unmount; under the video a button `button[data-sub-toggle]` (`mt.subs`, `aria-pressed`, on by default) that sets the track's `mode` to `'showing'` / `'disabled'`. With `null`: no track and no button.
  - `EventMedia`: both players become `SubtitledVideo` — uploaded videos with `segments` of `readingFor(reading, [posterId, video.id])`, on-demand videos (inside `VideoStill`, which now takes `segments`) with those of `readingFor(reading, [still.id])`; no reading → `[]`.

- [ ] **Step 1: Add the failing e2e checks:**
  11. (`pro`) the player of `m-vid` has one `track[kind="subtitles"]`; after its `load`, `video.textTracks[0].cues.length === 2`, the first cue's text is the Hebrew line under `he` and the English one under `en`, and `mode === 'showing'`; pressing the switch → `mode === 'disabled'` and `aria-pressed="false"`; pressing again → `'showing'`.
  12. With the fake switched to a reading whose speech has no `segments`: no `track`, no `[data-sub-toggle]`, and the panel still shows the speech text.
  13. `staff`: `[data-mt-staff-note]` contains `route 502 busy generate 429`; `pro`: no such element.
- [ ] **Step 2: Run** `he desktop pro` → FAIL at check 11.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the e2e for `he desktop pro`, `en phone pro`, `en desktop free`, `he desktop staff` → `PASS`; `tests/e2e/media-translation.mock.cjs` for `he desktop pro` and `he desktop staff` → `PASS`; every `tests/media/*.test.ts` and `tests/i18n/no-hebrew-literals.test.ts` → PASS; type check clean; `npx vite build` succeeds.
- [ ] **Step 5: Commit** `feat(media): translated subtitles on the video, with an on / off switch`.

### Task 8: Go live, one approval at a time

Each step is a question to the owner in plain language. No step runs without his yes. `media_audio_enabled` stays as it is until Step 7.

- [ ] **Step 1: STOP — ask to read (not change) what tonight's run left behind,** to confirm the diagnosis before anything is deployed: the Vercel runtime logs of `/api/transcribe` around the test (was it called, which status, how long); the `event-agent` logs for event `8f6dd772-…`; `ai_usage` rows with a model starting `free:gemini:` at that time (a row means the route succeeded); `select public.media_storage_usage()` with the count and total bytes of `event_media` videos. Report which of the spec's causes 1–4 the evidence supports, and say plainly if it supports none.
- [ ] **Step 2: STOP — ask to apply migration 128.** Say: one new text column and one replaced read function; nothing on the site changes. After applying, run `supabase/tests/media_translation.sql` → `MEDIA_TRANSLATION_ALL_OK`.
- [ ] **Step 3: STOP — ask to update `event-agent`** (the stub import of the pushed commit, as before). Say: it is behind Expand, "Ask the map", EEI and deep analysis; it gains boxes, translated lines and the speech reason. Record the deployed commit for roll-back; check through `pg_net` that `expand` still answers for a cached event.
- [ ] **Step 4: STOP — ask for five picture runs** on events the owner picks (Arabic, Persian, a weapon marking, a banner, a screenshot), as staff "Run again"; say the expected cost (about $0.01–0.03 each). Report each run's cost from `ai_usage` and how many texts came back with a box.
- [ ] **Step 5: STOP — ask the owner to look at the branch preview:** the five pictures in Translated mode, on a computer and on his phone. He decides: the boxes are good enough → continue; too loose → stop here and write the Gemini picture-route plan (the spec's ruling 1 fallback); the saved shape stays.
- [ ] **Step 6: STOP — ask to merge the site** (the overlay, the subtitles, the staff note and the route's reasons go live together; old readings look exactly as before).
- [ ] **Step 7: STOP — ask for one video run with speech on** (the event of tonight's test, staff "Run again"). Say that Google receives that public video on the free tier. Report: the speech state; if it is `off`, the saved reason word for word and what it means, then set the switch back to off and stop — the fix for that reason is a new, separately approved change; if it is `ok`, the number of lines, the Gemini token counts (cost 0), the Claude cost, and whether the subtitles match the speech by eye at three points of the video.
- [ ] **Step 8: STOP — ask the open questions of the spec** (re-run of recent events for boxes; overlay before Expand; storage make-room; the "off counts as new media" retry cost) and record the answers in the spec.
