// Deep analysis: the entry writer. Opus with web search reads the term, the sentence it came from
// and up to 20 of our events, and returns one entry (Hebrew + English) through the deep_entry tool.
// The answer is cleaned (deepInput.ts), a free Wikipedia picture is added, the names are joined to
// an existing entry when one already owns them, and the lease ends with deep_done. Never throws.
// The call is logged as 'deep_entry' (subscribers: counts toward the daily budget) or
// 'deep_entry_staff' (staff and internal checks: outside the budget) — not counted as the reader's "Ask the map" use.
// deno-lint-ignore-file no-explicit-any
import { callClaude, isTransient } from "./editor.ts";
import { costUsd } from "./usage.ts";
import {
  aliasPlan, cleanEntry, DEEP_LIMITS, DEEP_TOOL, deepSystemPrompt, deepUserMessage, pickImage, searchUrls,
  type CleanEntry, type DeepEvent, type DeepImage,
} from "./deepInput.ts";
import { normTerm } from "./terms.ts";

type Db = any;

export const DEEP_MODEL = Deno.env.get("DEEP_MODEL") ?? "claude-opus-5-5";
const UA = { "User-Agent": "Osintfront/1.0 (https://osintfront.com)" };

/** normalised alias → entry id, for the names that already belong to an entry. */
export async function ownersOf(db: Db, keys: string[]): Promise<Record<string, string>> {
  const list = [...new Set(keys.map(normTerm).filter((k) => k.length >= 2))];
  if (!list.length) return {};
  const { data } = await db.from("deep_aliases").select("alias,entry_id").in("alias", list);
  return Object.fromEntries(((data ?? []) as { alias: string; entry_id: string }[]).map((r) => [r.alias, r.entry_id]));
}

export async function jobState(db: Db, key: string): Promise<{ leaseHeld: boolean; failReason: "failed" | "no_entry" | null; retryLater: boolean }> {
  const { data } = await db.from("deep_jobs").select("busy_until,fail_reason,retry_after").eq("key", key).maybeSingle();
  const now = Date.now();
  return {
    leaseHeld: !!data?.busy_until && new Date(data.busy_until).getTime() > now,
    failReason: data?.fail_reason === "failed" || data?.fail_reason === "no_entry" ? data.fail_reason : null,
    retryLater: !!data?.retry_after && new Date(data.retry_after).getTime() > now,
  };
}

async function getJson(url: string): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } finally {
    clearTimeout(t);
  }
}

/** The Wikipedia lead picture, only when free and credited (pickImage). Any error → null. */
export async function wikiImage(title: string): Promise<DeepImage | null> {
  try {
    if (!title) return null;
    const q = new URLSearchParams({ action: "query", prop: "pageimages|pageprops|info", inprop: "url", piprop: "name", titles: title, redirects: "1", format: "json", origin: "*" });
    const wp = await getJson(`https://en.wikipedia.org/w/api.php?${q}`);
    const page = Object.values(wp?.query?.pages ?? {})[0] as any;
    if (!page || page.missing !== undefined || !page.pageimage) return null;
    const c = new URLSearchParams({ action: "query", titles: `File:${page.pageimage}`, prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "640", format: "json", origin: "*" });
    const cm = await getJson(`https://commons.wikimedia.org/w/api.php?${c}`);
    const file = Object.values(cm?.query?.pages ?? {})[0] as any;
    return pickImage(page, file?.imageinfo?.[0] ?? null);
  } catch {
    return null;
  }
}

export interface WriteJob { key: string; token: string; uid: string | null; staff: boolean; names: string[]; kind: string | null; sentence: string; refreshId?: string }

async function ourEvents(db: Db, names: string[]): Promise<DeepEvent[]> {
  const since = new Date(Date.now() - DEEP_LIMITS.eventsDays * 86400_000).toISOString();
  const { data } = await db.rpc("ai_search_candidates", { p_since: since, p_terms: names.filter((n) => n.length >= 2), p_limit: DEEP_LIMITS.events });
  const rows = ((data ?? []) as any[]).filter((r) => r.score > 0).slice(0, DEEP_LIMITS.events);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [{ data: evs }, { data: media }] = await Promise.all([
    db.from("events").select("id,source_url").in("id", ids),
    db.from("event_media").select("event_id").in("event_id", ids),
  ]);
  const src = new Map(((evs ?? []) as any[]).map((e) => [e.id, e.source_url as string | null]));
  const withMedia = new Set(((media ?? []) as any[]).map((m) => m.event_id));
  return rows.map((r) => ({
    id: r.id, at: r.occurred_at, country: r.country ?? "", place: r.location_name ?? "", title: r.title ?? "",
    summary: r.description ?? "", media: withMedia.has(r.id), source_url: src.get(r.id) ?? null,
  }));
}

/** One Opus turn with the 150-second limit; a transient failure is retried once after 5 s. */
async function turn(body: Record<string, unknown>, purpose: string): Promise<any> {
  const once = () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("deep call timed out")), DEEP_LIMITS.timeoutMs); });
    return Promise.race([callClaude(DEEP_MODEL, body, purpose), timeout]).finally(() => clearTimeout(timer));
  };
  try {
    return await once();
  } catch (e) {
    if (!isTransient((e as any)?.status)) throw e;
    await new Promise((r) => setTimeout(r, 5000));
    return await once();
  }
}

const content = (e: CleanEntry) => ({
  kind: e.kind, name_he: e.name_he, name_en: e.name_en, name_orig: e.name_orig, summary_he: e.summary_he, summary_en: e.summary_en,
  sections: e.sections, sources: e.sources,
});

async function addAliases(db: Db, entryId: string, add: string[]) {
  for (const alias of add) {
    const { error } = await db.from("deep_aliases").insert({ alias, entry_id: entryId });
    if (error && error.code !== "23505") console.warn("deep alias", alias, error.message);
  }
}

async function refund(db: Db, job: WriteJob) {
  if (job.uid) await db.rpc("refund_feature", { p_uid: job.uid, p_key: "deep_analysis" });
}

export async function writeEntry(db: Db, job: WriteJob): Promise<void> {
  const purpose = job.staff ? "deep_entry_staff" : "deep_entry";
  let entryId: string | null = null;
  let fail: "failed" | "no_entry" | null = "failed";
  try {
    let names = job.names;
    let old: any = null;
    if (job.refreshId) {
      const { data } = await db.from("deep_entries").select("*").eq("id", job.refreshId).maybeSingle();
      if (!data) throw new Error("entry gone");
      old = data;
      const { data: al } = await db.from("deep_aliases").select("alias").eq("entry_id", job.refreshId);
      names = [...new Set([data.name_en, data.name_he, ...names, ...((al ?? []) as any[]).map((a) => a.alias)].filter(Boolean))];
    }
    const events = await ourEvents(db, names);
    const base = {
      max_tokens: DEEP_LIMITS.maxTokens,
      system: [{ type: "text", text: deepSystemPrompt(), cache_control: { type: "ephemeral" } }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: DEEP_LIMITS.searches }, DEEP_TOOL],
    };
    const messages: any[] = [{ role: "user", content: deepUserMessage({ names, kind: job.kind ?? old?.kind ?? null, sentence: job.sentence, events }) }];
    const answers: any[] = [];
    let cost = 0;
    let out = await turn({ ...base, messages, tool_choice: { type: "auto" } }, purpose);
    answers.push(out);
    cost += costUsd(DEEP_MODEL, out.usage ?? {});
    if (out.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: out.content });
      out = await turn({ ...base, messages, tool_choice: { type: "auto" } }, purpose);
      answers.push(out);
      cost += costUsd(DEEP_MODEL, out.usage ?? {});
    }
    let call = (out.content ?? []).find((b: any) => b.type === "tool_use" && b.name === "deep_entry");
    if (!call) {
      messages.push({ role: "assistant", content: out.content });
      messages.push({ role: "user", content: "Now answer with the deep_entry tool." });
      out = await turn({ ...base, messages, tool_choice: { type: "tool", name: "deep_entry" } }, purpose);
      answers.push(out);
      cost += costUsd(DEEP_MODEL, out.usage ?? {});
      call = (out.content ?? []).find((b: any) => b.type === "tool_use" && b.name === "deep_entry");
    }
    const web = answers.flatMap((a) => searchUrls(a.content));
    const evUrls = events.map((e) => e.source_url).filter((u): u is string => !!u);
    const entry = cleanEntry(call?.input ?? null, { web, events: evUrls });
    if (entry === "none") {
      fail = "no_entry";
      return;
    }
    if (!entry) throw new Error("no usable entry");
    const image = await wikiImage(entry.wiki_title ?? "");
    const owners = await ownersOf(db, [entry.name_en, entry.name_he, entry.name_orig, ...job.names, ...entry.aliases]);
    const plan = aliasPlan([entry.name_en, entry.name_he, entry.name_orig, ...job.names, ...entry.aliases], owners, job.refreshId ?? null);
    const related = events.map((e) => e.id);
    if (job.refreshId) {
      const prev = { ...content(old), image: old.image, version: old.version };
      const { error } = await db.from("deep_entries").update({
        ...content(entry), ...(image ? { image } : {}), related_event_ids: related, model: DEEP_MODEL,
        cost_usd: Number(old.cost_usd ?? 0) + cost, version: Number(old.version ?? 1) + 1, updated_by: job.uid, updated_at: new Date().toISOString(),
        edited_at: null, prev,
      }).eq("id", job.refreshId);
      if (error) throw new Error(error.message);
      await addAliases(db, job.refreshId, plan.add);
      entryId = job.refreshId;
    } else if (plan.mergeInto) {
      // The same thing under another name: the names join the existing entry, nothing else is saved.
      await addAliases(db, plan.mergeInto, plan.add);
      entryId = plan.mergeInto;
    } else {
      const { data: ins, error } = await db.from("deep_entries").insert({
        ...content(entry), image, related_event_ids: related, model: DEEP_MODEL, cost_usd: cost, version: 1,
        created_by: job.uid, updated_by: job.uid,
      }).select("id").single();
      if (error) throw new Error(error.message);
      await addAliases(db, ins.id, plan.add);
      entryId = ins.id;
    }
    fail = null;
  } catch (e) {
    console.warn("deep write failed", job.key.slice(0, 60), String((e as Error)?.message ?? e).slice(0, 300));
    fail = "failed";
  } finally {
    if (fail) await refund(db, job).catch(() => {});
    const { error } = await db.rpc("deep_done", { p_key: job.key, p_token: job.token, p_entry: entryId, p_fail: fail });
    if (error) console.warn("deep_done", error.message);
  }
}
