// Media translation: the reading job. For the event's media items not read yet: videos go to the
// Vercel speech route (/api/transcribe — Gemini writes the speech and on-screen text down, free tier;
// the key lives only there), then ONE Claude call reads the pictures / stills and translates and
// summarises everything; one row per item is saved in media_readings. Never throws; always ends
// with media_done. A failure gives the reader's use back. Pure rules: mediaInput.ts.
// Usage log: Claude through callClaude (purpose media_translate / media_translate_staff — not an
// "Ask the map" credit); Gemini with the same purpose and model free:gemini:<model> (cost 0).
// deno-lint-ignore-file no-explicit-any
import { callClaude, fixTerms, isTransient, learnedTerms } from "./editor.ts";
import { costUsd, logUsage } from "./usage.ts";
import { TRANSLATE_API_URL } from "./translate.ts";
import { videoForThumb } from "./videoOnDemand.ts";
import {
  cleanReading, cleanRoute, MEDIA_LIMITS, MEDIA_TOOL, mediaItems, mediaSystemPrompt, mediaUserContent, needsClaude, pickTodo, refundAfterJob,
  routeNote, routeOutcome, speechBudgetMs, speechNotes, speechPlan,
  type MediaItem, type MediaRow, type RouteSpeech, type SentItem,
} from "./mediaInput.ts";

type Db = any;

export const MEDIA_MODELS: string[] = [...new Set([Deno.env.get("MEDIA_MODEL") ?? "claude-sonnet-5-5", "claude-sonnet-4-5"])];
const SECRET = Deno.env.get("TRANSLATE_SECRET") ?? "";
const ROUTE = TRANSLATE_API_URL.replace(/\/api\/translate\/?$/, "/api/transcribe");

/** The speech route is reachable: TRANSLATE_API_URL ends with /api/translate and the secret is set. */
export function speechConfigured(): boolean {
  return /\/api\/translate\/?$/.test(TRANSLATE_API_URL) && !!SECRET;
}

/** Speech is on: the route is configured and the owner's switch media_audio_enabled is true. */
export async function speechOn(db: Db): Promise<boolean> {
  if (!speechConfigured()) return false;
  const { data } = await db.from("app_settings").select("value").eq("key", "media_audio_enabled").maybeSingle();
  return data?.value === true;
}

const MEDIA_COLS = "id,kind,public_url,bytes,thumb_id,source_msg_key,source_url,video_state,ready,created_at";

/** The event's items and the saved readings' speech states (by media id: a merged event's media keeps its readings). */
export async function loadItems(
  db: Db,
  eventId: string,
): Promise<{ items: MediaItem[]; readings: { media_id: string; speech_state: string | null; speech_tries: number }[] }> {
  const { data: rows } = await db.from("event_media").select(MEDIA_COLS).eq("event_id", eventId);
  const items = mediaItems((rows ?? []) as MediaRow[]);
  const { data: reads } = items.length
    ? await db.from("media_readings").select("media_id,speech").in("media_id", items.map((i) => i.id))
    : { data: [] };
  return {
    items,
    readings: ((reads ?? []) as any[]).map((r) => ({ media_id: r.media_id, speech_state: r.speech?.state ?? null, speech_tries: Number(r.speech?.tries ?? 0) || 0 })),
  };
}

/** Gemini (through our Vercel route) writes down one stored video's speech and on-screen text. */
export async function speechFor(
  videoUrl: string,
  purpose: string,
  ms: number = MEDIA_LIMITS.routeMs,
): Promise<{ out: RouteSpeech | "failed"; note: string | null }> {
  let status = 0;
  let body: unknown = null;
  const t0 = Date.now();
  try {
    const res = await fetch(ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json", "x-translate-secret": SECRET },
      // The route stops inside our wait (budget_ms) and says why, instead of being cut off.
      body: JSON.stringify({ url: videoUrl, budget_ms: ms - 5000 }),
      signal: AbortSignal.timeout(ms),
    });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch (e) {
    const error = (e as Error)?.name === "TimeoutError" ? "timeout" : "network";
    return { out: "failed", note: routeNote({ status: 0, body: null, error, waitedMs: Date.now() - t0 }) };
  }
  const out = cleanRoute(status, body);
  const note = routeNote({ status, body, error: null, waitedMs: Date.now() - t0 });
  const b = body as any;
  if (out !== "failed" && b?.usage && typeof b?.model === "string") {
    logUsage(purpose, `free:gemini:${b.model}`, { input_tokens: Number(b.usage.input) || 0, output_tokens: Number(b.usage.output) || 0 });
  }
  return { out, note };
}

export interface MediaJob { eventId: string; token: string; uid: string | null; staff: boolean; redo: boolean }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const noSpeech = (state: RouteSpeech["state"]): RouteSpeech => ({ state, lang: "und", seconds: null, speech: "", onScreen: [], cut: false, segments: [] });

/** One Claude turn with a time limit; a transient error is retried once after 5 s; a missing model → the next one. */
async function claude(body: Record<string, unknown>, purpose: string, deadline: number): Promise<{ out: any; model: string }> {
  for (const model of MEDIA_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ms = Math.min(MEDIA_LIMITS.claudeMs, deadline - Date.now());
      if (ms < 5000) throw new Error("media job out of time");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("media call timed out")), ms); });
      try {
        return { out: await Promise.race([callClaude(model, body, purpose), timeout]), model };
      } catch (e) {
        const status = (e as any)?.status;
        if (status === 404 || /not_found_error/.test(String((e as any)?.body ?? ""))) break; // next model
        if (attempt === 0 && isTransient(status)) {
          await sleep(5000);
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw new Error("no media model available");
}

export async function translateMedia(db: Db, job: MediaJob): Promise<void> {
  const purpose = job.staff ? "media_translate_staff" : "media_translate";
  const deadline = Date.now() + MEDIA_LIMITS.jobMs;
  let cost = 0;
  let ok = false;
  let speechNote: string | null = null;
  let hadVideo = false;
  try {
    const on = await speechOn(db);
    const { items, readings } = await loadItems(db, job.eventId);
    const todo = pickTodo(items, readings, { speechOn: on, redo: job.redo });
    if (!todo.length) {
      ok = true;
      return;
    }
    const { data: ev } = await db.from("events").select("title,description,translations").eq("id", job.eventId).maybeSingle();
    const event = { title: String(ev?.title ?? ""), summary: String(ev?.translations?.he?.summary ?? ev?.description ?? "") };

    const sent: SentItem[] = [];
    let videosSoFar = 0;
    // Why a video's speech was not read (logged; saved for staff). Never speech text.
    const notes: (string | null)[] = [];
    if (!on && todo.some((t) => t.kind === "video")) notes.push(speechConfigured() ? "speech switch is off" : "speech route not configured");
    const note = (itemId: string, n: string | null) => {
      if (!n) return;
      notes.push(n);
      console.warn("media speech", job.eventId, itemId, n);
    };
    for (const [i, item] of todo.entries()) {
      const s: SentItem = { n: i + 1, id: item.id, kind: item.kind, imageUrl: item.imageUrl, speech: null };
      if (item.kind === "video") {
        let plan = speechPlan(item, { speechOn: on, videosSoFar });
        let url = item.videoUrl;
        if (plan === "fetch") {
          plan = "unavailable";
          for (let t = 0; t < 10 && Date.now() < deadline - MEDIA_LIMITS.claudeMs - 20_000; t++) {
            const v = await videoForThumb(db, item.id);
            if (v?.state === "loading") {
              await sleep(3000);
              continue;
            }
            if (v?.state === "ready") {
              const { data: file } = await db.from("event_media").select("public_url,bytes").eq("thumb_id", item.id).eq("kind", "video").eq("ready", true).maybeSingle();
              url = file?.public_url ?? v.url;
              plan = Number(file?.bytes ?? 0) > MEDIA_LIMITS.videoBytes ? "too_big" : "route";
            } else if (v?.state === "too_big") plan = "too_big";
            break;
          }
          if (plan !== "route") note(item.id, `video fetch: ${plan}`);
        }
        if (plan === "route" && url) {
          // Inside the job's time, leaving Claude its share; a failed or skipped route leaves the speech
          // 'off' (retried later) and the pictures are still read.
          const ms = speechBudgetMs(deadline, Date.now());
          const r = ms ? await speechFor(url, purpose, ms) : { out: "failed" as const, note: "skipped: no time left for the route" };
          note(item.id, r.note);
          if (r.out !== "failed") videosSoFar++;
          s.speech = routeOutcome(r.out, readings.find((x) => x.media_id === item.id)?.speech_tries ?? 0);
        } else {
          s.speech = noSpeech(plan === "route" ? "unavailable" : plan);
        }
      }
      sent.push(s);
    }
    speechNote = speechNotes(notes);
    hadVideo = todo.some((t) => t.kind === "video");

    let raw: unknown = { items: [] };
    let model = MEDIA_MODELS[0];
    if (needsClaude(sent)) {
      await learnedTerms();
      const r = await claude({
        max_tokens: MEDIA_LIMITS.maxTokens,
        system: [{ type: "text", text: mediaSystemPrompt(), cache_control: { type: "ephemeral" } }],
        tools: [MEDIA_TOOL],
        tool_choice: { type: "tool", name: "media_reading" },
        messages: [{ role: "user", content: mediaUserContent(event, sent) }],
      }, purpose, deadline);
      model = r.model;
      cost += costUsd(r.model, r.out?.usage ?? {});
      raw = (r.out?.content ?? []).find((b: any) => b.type === "tool_use" && b.name === "media_reading")?.input ?? { items: [] };
    }
    const clean = cleanReading(raw, sent);
    if (!clean) throw new Error("no usable reading");

    const { data: old } = await db.from("media_readings").select("media_id,version").in("media_id", clean.map((r) => r.media_id));
    const versions = new Map(((old ?? []) as any[]).map((o) => [o.media_id, Number(o.version ?? 1)]));
    const now = new Date().toISOString();
    const rows = clean.map((r) => ({
      media_id: r.media_id,
      event_id: job.eventId,
      kind: r.kind,
      description_he: fixTerms(r.description_he),
      description_en: r.description_en,
      texts: r.texts.map((t) => ({ ...t, he: fixTerms(t.he), where_he: fixTerms(t.where_he) })),
      speech: r.speech
        ? {
          ...r.speech,
          he: fixTerms(r.speech.he),
          summary_he: fixTerms(r.speech.summary_he),
          ...(r.speech.segments ? { segments: r.speech.segments.map((l) => ({ ...l, he: fixTerms(l.he) })) } : {}),
        }
        : null,
      model,
      version: versions.has(r.media_id) ? versions.get(r.media_id)! + 1 : 1,
      created_by: job.uid,
      updated_at: now,
    }));
    const { error } = await db.from("media_readings").upsert(rows, { onConflict: "media_id" });
    if (error) throw new Error(error.message);
    ok = true;
  } catch (e) {
    console.warn("media translate failed", job.eventId, String((e as Error)?.message ?? e).slice(0, 300));
  } finally {
    // Staff see why video speech was not read (best effort; works before migration 128 too).
    if (hadVideo) {
      await db.from("media_jobs").update({ speech_note: speechNote }).eq("event_id", job.eventId).eq("busy_token", job.token).then(() => {}, () => {});
    }
    // Ending the lease first: when it is no longer ours, the stale-lease takeover already gave the use back.
    const { data: owned, error } = await db.rpc("media_done", { p_event: job.eventId, p_token: job.token, p_fail: ok ? null : "failed", p_cost: cost });
    if (error) console.warn("media_done", error.message);
    if (refundAfterJob({ ok, uid: job.uid, owned: owned === true })) {
      await db.rpc("refund_feature", { p_uid: job.uid, p_key: "media_translate" }).then(() => {}, () => {});
    }
  }
}
