// event-agent: on-demand AI work for one event.
//   {action:"expand", id}        public — the "expand" button. Writes the full text, religious
//                                meaning and other implications (Hebrew + English) once per event
//                                and caches them in events.translations; later readers get the cache.
//   {action:"edit", id}          cron secret — a foreign-language draft a person published:
//                                run the editor agent (Hebrew headline + summary, English, places).
//   {action:"translate", limit}  cron secret — backfill English/short Hebrew for older events.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { editReport, expandReport, foreignShare, formatDescription, locationsForDb, mainCountry, translateBrief, translationsFor } from "../_shared/editor.ts";
import { setUsageSink } from "../_shared/usage.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
setUsageSink(db, "event-agent");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let secret: string | null = null;
async function cronOk(req: Request) {
  if (secret === null) {
    const { data } = await db.from("intel_config").select("value").eq("key", "cron_secret").maybeSingle();
    secret = data?.value ?? "";
  }
  const given = req.headers.get("x-cron-secret") ?? "";
  return !!secret && given.length === secret.length && given === secret;
}

type Tr = Record<string, Record<string, string | undefined>>;
const asTr = (v: unknown): Tr => (v && typeof v === "object" && !Array.isArray(v) ? (v as Tr) : {});

function expandedView(tr: Tr) {
  const pick = (l: string) => tr[l]?.details ? { details: tr[l].details, religious: tr[l].religious ?? "", implications: tr[l].implications ?? "" } : null;
  return { he: pick("he"), en: pick("en") };
}

async function expand(id: string) {
  const { data: ev } = await db.from("events")
    .select("id,title,description,original_report_text,source_name,translations,ai_suggestions,status,deleted_at")
    .eq("id", id).maybeSingle();
  if (!ev || ev.deleted_at || !["published", "archived"].includes(ev.status)) return json({ error: "not found" }, 404);
  const tr = asTr(ev.translations);
  const cached = expandedView(tr);
  if (cached.he) return json({ ok: true, cached: true, ...cached });
  // One writer at a time: a second reader within a minute waits for the first.
  const started = Date.parse(String(ev.ai_suggestions?.expanding_at ?? ""));
  if (Number.isFinite(started) && Date.now() - started < 90_000) return json({ ok: true, pending: true }, 202);
  await db.from("events").update({ ai_suggestions: { ...(ev.ai_suggestions ?? {}), expanding_at: new Date().toISOString() } }).eq("id", id);
  try {
    const r = await expandReport({
      text: ev.original_report_text || ev.description || ev.title,
      title: ev.title, summary: tr.he?.summary ?? ev.description ?? "", origin: ev.source_name ?? "",
    });
    const next: Tr = {
      ...tr,
      he: { ...(tr.he ?? {}), details: r.he.details, religious: r.he.religious, implications: r.he.implications },
      en: { ...(tr.en ?? {}), details: r.en.details, religious: r.en.religious, implications: r.en.implications },
    };
    const { data: cur } = await db.from("events").select("ai_suggestions").eq("id", id).maybeSingle();
    const ai = { ...(cur?.ai_suggestions ?? {}), expand_model: r.model };
    delete (ai as Record<string, unknown>).expanding_at;
    await db.from("events").update({ translations: next, ai_suggestions: ai }).eq("id", id);
    return json({ ok: true, cached: false, ...expandedView(next) });
  } catch (e) {
    const { data: cur } = await db.from("events").select("ai_suggestions").eq("id", id).maybeSingle();
    const ai = { ...(cur?.ai_suggestions ?? {}) };
    delete (ai as Record<string, unknown>).expanding_at;
    await db.from("events").update({ ai_suggestions: ai }).eq("id", id);
    console.error("expand failed", String((e as Error)?.message ?? e).slice(0, 300));
    return json({ error: "expand failed" }, 502);
  }
}

async function edit(id: string) {
  const { data: ev } = await db.from("events")
    .select("id,title,description,original_report_text,source_name,source_url,occurred_at,country,translations,ai_suggestions,latitude")
    .eq("id", id).maybeSingle();
  if (!ev) return json({ error: "not found" }, 404);
  const ai = { ...(ev.ai_suggestions ?? {}), sent_to_editor: new Date().toISOString() };
  await db.from("events").update({ ai_suggestions: ai }).eq("id", id);
  // The text the person published (they may have edited it), else the original report.
  const text = foreignShare(`${ev.title} ${ev.description}`) > 0.4 ? `${ev.title}\n\n${ev.description}` : ev.original_report_text || `${ev.title}\n\n${ev.description}`;
  const r = await editReport({ text, mode: "whatsapp", origin: { name: ev.source_name ?? "", url: ev.source_url, sentAt: ev.occurred_at } });
  const update: Record<string, unknown> = {
    ai_suggestions: { ...ai, editor_model: r.model, countries: r.countries },
    translations: { ...asTr(ev.translations), ...translationsFor(r) },
  };
  if (r.title) update.title = r.title.slice(0, 200);
  if (r.summary) update.description = formatDescription(r);
  if (!ev.country && mainCountry(r)) update.country = mainCountry(r);
  if (ev.latitude == null) update.locations = locationsForDb(r);
  const { error } = await db.from("events").update(update).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, id, title: update.title });
}

async function translate(limit: number) {
  const { data: rows } = await db.from("events")
    .select("id,title,description,original_report_text,translations")
    .is("deleted_at", null).in("status", ["published", "archived"])
    .order("occurred_at", { ascending: false }).limit(400);
  const todo = (rows ?? []).filter((e) => !asTr(e.translations).en?.title).slice(0, limit);
  let done = 0;
  const errors: string[] = [];
  for (const e of todo) {
    try {
      const r = await translateBrief(e.title, e.description || e.original_report_text || "");
      const tr = asTr(e.translations);
      const next: Tr = {
        ...tr,
        he: { ...(tr.he ?? {}), summary: tr.he?.summary || r.summary_he, ...(foreignShare(e.title) > 0.4 ? { title: r.title_he } : {}) },
        en: { ...(tr.en ?? {}), title: r.title_en, summary: r.summary_en, description: tr.en?.description || r.summary_en },
      };
      await db.from("events").update({ translations: next }).eq("id", e.id);
      done++;
    } catch (err) {
      errors.push(String((err as Error)?.message ?? err).slice(0, 120));
      if (errors.length > 3) break;
    }
  }
  return json({ ok: true, done, left: (rows ?? []).filter((e) => !asTr(e.translations).en?.title).length - done, errors });
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error("event-agent", String((e as Error)?.message ?? e).slice(0, 300));
    return json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  const id = String(body?.id ?? "");
  if (action === "expand") {
    if (!UUID.test(id)) return json({ error: "bad id" }, 400);
    return await expand(id);
  }
  if (!(await cronOk(req))) return json({ error: "unauthorized" }, 401);
  if (action === "edit") {
    if (!UUID.test(id)) return json({ error: "bad id" }, 400);
    return await edit(id);
  }
  if (action === "translate") return await translate(Math.min(Math.max(Number(body?.limit ?? 20) | 0, 1), 60));
  return json({ error: "unknown action" }, 400);
}
