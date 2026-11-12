// Free-text EEI (צי"ח), server side: split a pasted list, save a user's list, and the tagger —
// Haiku reads every event of the last 24 h in a theatre and marks the topics it is about.
// Theatres are shared by fingerprint, so the same list costs the same for any number of users.
// The pure rules (prompts, cleaning, fingerprints) are in eeiInput.ts.
// deno-lint-ignore-file no-explicit-any
import { callClaude } from "./editor.ts";
import {
  batches, cleanList, cleanTagOutput, israelDay, LIMITS, mayTag, PARSE_TOOL, parseCacheKey, parseSystemPrompt,
  TAG_TOOL, tagSystemPrompt, tagUserMessage, theatreSpec, type CleanTheatre, type TagEvent, type TheatreSpec,
} from "./eeiInput.ts";

type Db = any;

export const EEI_MODEL = "claude-haiku-5-5";

async function forcedTool(tool: { name: string }, system: string, user: string, purpose: string, maxTokens: number): Promise<unknown> {
  const out = await callClaude(EEI_MODEL, {
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: user }],
  }, purpose);
  return out.content?.find((x: any) => x.type === "tool_use")?.input ?? null;
}

export async function eeiBudget(db: Db): Promise<number | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "eei_daily_budget_usd").maybeSingle();
  const n = Number(data?.value);
  return data?.value == null || !Number.isFinite(n) ? null : n;
}

export async function eeiSpentToday(db: Db): Promise<number> {
  const { data } = await db.rpc("eei_spent_today");
  return Number(data ?? 0) || 0;
}

/** Split pasted text into theatres and topics. Same text (spacing aside) within 7 days → the saved split. */
export async function parseEei(db: Db, text: string): Promise<{ theatres: CleanTheatre[]; cached: boolean }> {
  const raw = text.slice(0, LIMITS.raw);
  const key = await parseCacheKey(raw);
  const { data: hit } = await db.from("ai_cache").select("result").eq("kind", "eei_parse").eq("key", key)
    .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()).maybeSingle();
  if (hit?.result?.theatres) return { theatres: (await cleanList(hit.result)).theatres, cached: true };
  const out = await forcedTool(PARSE_TOOL, parseSystemPrompt(), raw, "eei_parse", 6000);
  const list = await cleanList(out);
  if (list.theatres.length) {
    await db.from("ai_cache").upsert({ kind: "eei_parse", key, result: list, created_at: new Date().toISOString() }, { onConflict: "kind,key" });
  }
  return { theatres: list.theatres, cached: false };
}

/** Make sure every theatre exists (shared by fingerprint) and mark it as used now. */
export async function upsertTheatres(db: Db, theatres: CleanTheatre[]): Promise<void> {
  const now = new Date().toISOString();
  for (const t of theatres) {
    if (t.kind !== "theatre" || !t.hash) continue;
    const { error } = await db.from("eei_theatres").insert({ hash: t.hash, spec: theatreSpec(t), last_used_at: now });
    if (error) await db.from("eei_theatres").update({ last_used_at: now }).eq("hash", t.hash);
  }
}

/** Save a user's list; yesterday's moves to prev_*. fresh = theatres nobody has marks for yet. */
export async function saveEei(db: Db, uid: string, rawText: string, list: unknown): Promise<{ list: { theatres: CleanTheatre[] }; fresh: string[] }> {
  const clean = await cleanList(list);
  await upsertTheatres(db, clean.theatres);
  const { data: cur } = await db.from("eei_lists").select("raw_text,list").eq("user_id", uid).maybeSingle();
  const row: Record<string, unknown> = { user_id: uid, raw_text: rawText.slice(0, LIMITS.raw), list: clean, updated_at: new Date().toISOString() };
  if (cur?.list && JSON.stringify(cur.list) !== JSON.stringify(clean)) {
    row.prev_raw_text = cur.raw_text;
    row.prev_list = cur.list;
  }
  await db.from("eei_lists").upsert(row, { onConflict: "user_id" });
  const fresh: string[] = [];
  for (const t of clean.theatres) {
    if (!t.hash) continue;
    const { count } = await db.from("eei_tags").select("event_id", { count: "exact", head: true }).eq("theatre_hash", t.hash);
    if (!count) fresh.push(t.hash);
  }
  return { list: clean, fresh };
}

/**
 * Tag the theatre's unchecked events (last 24 h), up to maxEvents / maxCalls. One run per theatre at a
 * time (2-minute lease). A failed call writes nothing; 5 failures in a row pause the theatre 1 hour.
 */
export async function tagTheatre(db: Db, hash: string, maxEvents: number, maxCalls: number): Promise<{ tagged: number; calls: number; stopped?: "busy" | "budget" | "cap" | "error" }> {
  const { data: claimed } = await db.rpc("eei_claim", { p_hash: hash });
  if (!claimed) return { tagged: 0, calls: 0, stopped: "busy" };
  let tagged = 0;
  let calls = 0;
  try {
    const { data: th } = await db.from("eei_theatres").select("spec,tagged_day,tagged_count,fail_count").eq("hash", hash).maybeSingle();
    if (!th) return { tagged, calls };
    const spec = th.spec as TheatreSpec;
    const keys = (spec.topics ?? []).map((t) => t.key);
    const today = israelDay();
    let day = th.tagged_day === today ? Number(th.tagged_count ?? 0) : 0;
    const budget = await eeiBudget(db);
    while (tagged < maxEvents && calls < maxCalls) {
      if (!mayTag(await eeiSpentToday(db), budget, day)) {
        return { tagged, calls, stopped: day >= LIMITS.theatrePerDay ? "cap" : "budget" };
      }
      const want = Math.min(LIMITS.batch, maxEvents - tagged, LIMITS.theatrePerDay - day);
      const { data: rows, error } = await db.rpc("eei_pending", { p_hash: hash, p_limit: want });
      if (error) throw new Error(error.message);
      const list = (rows ?? []) as any[];
      if (!list.length) break;
      for (const batch of batches(list)) {
        const events: TagEvent[] = batch.map((r) => ({
          id: r.id, category: r.category_slug ?? "", country: r.country ?? "", place: r.location_name ?? "",
          title: r.title ?? "", description: r.description ?? "",
        }));
        let out: unknown;
        calls++;
        try {
          out = await forcedTool(TAG_TOOL, tagSystemPrompt(), tagUserMessage(spec, events), "eei_tag", 1500);
        } catch (e) {
          const fails = Number(th.fail_count ?? 0) + 1;
          th.fail_count = fails >= 5 ? 0 : fails;
          await db.from("eei_theatres").update(fails >= 5
            ? { fail_count: 0, paused_until: new Date(Date.now() + 3600_000).toISOString() }
            : { fail_count: fails }).eq("hash", hash);
          console.warn("eei tag failed", hash.slice(0, 8), String((e as Error)?.message ?? e).slice(0, 200));
          return { tagged, calls, stopped: "error" };
        }
        const marks = cleanTagOutput(out, events.length, keys);
        const now = new Date().toISOString();
        await db.from("eei_tags").upsert(
          events.map((e, i) => ({ theatre_hash: hash, event_id: e.id, topics: marks[i], tagged_at: now })),
          { onConflict: "theatre_hash,event_id", ignoreDuplicates: true },
        );
        tagged += events.length;
        day += events.length;
        th.fail_count = 0;
        await db.from("eei_theatres").update({ tagged_day: today, tagged_count: day, fail_count: 0 }).eq("hash", hash);
      }
    }
    return { tagged, calls };
  } finally {
    await db.from("eei_theatres").update({ busy_until: null }).eq("hash", hash);
  }
}

/** Every theatre used in the last 24 h, least recently tagged first, until 25 calls are used. */
export async function tick(db: Db): Promise<{ theatres: number; tagged: number; calls: number }> {
  const { data } = await db.from("eei_theatres").select("hash,tagged_day")
    .gt("last_used_at", new Date(Date.now() - 24 * 3600_000).toISOString())
    .order("tagged_day", { ascending: true, nullsFirst: true }).limit(100);
  let tagged = 0;
  let calls = 0;
  let theatres = 0;
  for (const t of (data ?? []) as { hash: string }[]) {
    if (calls >= LIMITS.callsPerTick) break;
    const r = await tagTheatre(db, t.hash, LIMITS.theatrePerDay, LIMITS.callsPerTick - calls);
    theatres++;
    tagged += r.tagged;
    calls += r.calls;
    if (r.stopped === "budget") break;
  }
  return { theatres, tagged, calls };
}
