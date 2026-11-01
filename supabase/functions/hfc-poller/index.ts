// supabase/functions/hfc-poller/index.ts
// Polls api.tzevaadom.co.il (live + history) and hands alerts to the DB in small batches
// via public.hfc_ingest_batch. Replaces the DB-side extensions.http polling (cron jobs 2 and 3).
//
// Invoked once a minute by pg_cron through net.http_post (fire and forget): the handler answers 202
// immediately and keeps working in the background (EdgeRuntime.waitUntil) for ~58 s,
// polling `live` every 15 s and `history` once per invocation.
// POST body {"once": true} runs a single pass and returns the summary (smoke tests).

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const UA = "Osintfront/1.0 (+https://main-drab-chi.vercel.app)"; // unchanged from the DB version
const URLS = {
  live: "https://api.tzevaadom.co.il/notifications",
  history: "https://api.tzevaadom.co.il/alerts-history",
} as const;
type Mode = keyof typeof URLS;

const FETCH_TIMEOUT_MS = 4000; // same as the old CURLOPT_TIMEOUT
const POLL_INTERVAL_MS = 15000;
const RUN_BUDGET_MS = 58000;
const CHUNK = 40; // cities per RPC call = one short DB transaction
// Coarse client-side window (SQL re-applies the exact 30 min / +5 min rule).
const WINDOW_PAST_S = 31 * 60;
const WINDOW_FUTURE_S = 6 * 60;

interface Row {
  time: unknown;
  threat: unknown;
  isDrill: unknown;
  cities: string[];
}
interface Summary {
  mode: Mode;
  fetched: number;
  sent: number;
  inserted: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function authorized(secret: string): Promise<boolean> {
  if (!secret) return false;
  const { data } = await db.from("intel_config").select("value").eq("key", "cron_secret").maybeSingle();
  const expected = typeof data?.value === "string" ? data.value : "";
  return expected !== "" && safeEqual(secret, expected);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const text = (await res.text()).trim();
  return text === "" ? [] : JSON.parse(text);
}

// Flatten to one row per city, drop what is clearly outside the time window, sort by (time, city).
function flatten(mode: Mode, body: unknown): Row[] {
  if (!Array.isArray(body)) return [];
  // deno-lint-ignore no-explicit-any
  const alerts: any[] = mode === "history"
    // deno-lint-ignore no-explicit-any
    ? body.flatMap((g: any) => (g && Array.isArray(g.alerts) ? g.alerts : []))
    : body;
  const nowS = Date.now() / 1000;
  const rows: Row[] = [];
  for (const a of alerts) {
    if (!a || typeof a !== "object") continue;
    const t = Number(a.time);
    if (!Number.isFinite(t) || t < nowS - WINDOW_PAST_S || t > nowS + WINDOW_FUTURE_S) continue;
    if (!Array.isArray(a.cities)) continue;
    for (const city of a.cities) {
      if (typeof city === "string") rows.push({ time: a.time, threat: a.threat, isDrill: a.isDrill, cities: [city] });
    }
  }
  rows.sort((x, y) => {
    const d = Number(x.time) - Number(y.time);
    if (d !== 0) return d;
    return x.cities[0] < y.cities[0] ? -1 : x.cities[0] > y.cities[0] ? 1 : 0;
  });
  return rows;
}

const rowKey = (r: Row) => `${r.time}|${r.threat}|${r.isDrill}|${r.cities[0]}`;

async function report(mode: Mode, ok: boolean, error?: string) {
  try {
    await db.rpc("hfc_ingest_report", { p_source: mode, p_ok: ok, p_error: error ?? null });
  } catch (e) {
    console.error("hfc_ingest_report failed", String(e));
  }
}

async function pollOnce(mode: Mode, seen: Set<string>): Promise<Summary> {
  const s: Summary = { mode, fetched: 0, sent: 0, inserted: 0 };
  try {
    const rows = flatten(mode, await fetchJson(URLS[mode]));
    s.fetched = rows.length;
    // Skip rows already delivered earlier in this invocation (the live feed repeats them every poll).
    const fresh = rows.filter((r) => !seen.has(rowKey(r)));
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const chunk = fresh.slice(i, i + CHUNK);
      const { data, error } = await db.rpc("hfc_ingest_batch", { p_mode: mode, p_items: chunk });
      if (error) throw new Error(`hfc_ingest_batch: ${error.message}`);
      for (const r of chunk) seen.add(rowKey(r));
      s.sent += chunk.length;
      s.inserted += typeof data === "number" && data > 0 ? data : 0;
    }
    await report(mode, true);
  } catch (e) {
    s.error = e instanceof Error ? e.message : String(e);
    await report(mode, false, s.error);
  }
  if (s.error || s.inserted > 0) console.log(JSON.stringify(s));
  return s;
}

async function run(once: boolean): Promise<Summary[]> {
  const { data: cfg } = await db.from("app_settings").select("value").eq("key", "hfc_alerts").maybeSingle();
  if (!cfg?.value || cfg.value.enabled !== true) return [];

  const started = Date.now();
  const seen = new Set<string>();
  const out: Summary[] = [];
  for (let tick = 0;; tick++) {
    const modes: Mode[] = tick === 0 ? ["live", "history"] : ["live"];
    out.push(...await Promise.all(modes.map((m) => pollOnce(m, seen))));
    if (once) break;
    const nextAt = started + (tick + 1) * POLL_INTERVAL_MS;
    if (nextAt - started >= RUN_BUDGET_MS) break;
    const wait = nextAt - Date.now();
    if (wait > 0) await sleep(wait);
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!(await authorized(req.headers.get("x-cron-secret") ?? ""))) return json({ error: "unauthorized" }, 401);

  let once = false;
  try {
    once = (await req.json())?.once === true;
  } catch { /* empty body */ }

  if (once) return json({ ok: true, results: await run(true) });

  const task = run(false).catch((e) => console.error("hfc-poller run failed", String(e)));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(task);
  else await task;
  return json({ accepted: true }, 202);
});
